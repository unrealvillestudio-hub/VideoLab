// VIDEOLAB · RENDER — transporte a Supabase (PostgREST y Storage). Sin lógica de negocio.
//
// La llave de servicio llega por la variable SUPABASE_SERVICE_ROLE_KEY, que el Cloud Run Job toma de Secret
// Manager. Sin ella, falla nombrándola: nunca hay valor por defecto (CC_PROTOCOL §15).

export function config(env = process.env) {
  const url = String(env.SUPABASE_URL ?? '').replace(/\/+$/, '');
  const key = env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  if (!url) throw new Error('SUPABASE_URL no configurado');
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY no configurado');
  return { url, key, bucket: env.VIDEOLAB_BUCKET || 'unrlvl-media' };
}

function headers(cfg, extra = {}) {
  return { apikey: cfg.key, Authorization: `Bearer ${cfg.key}`, ...extra };
}

// REINTENTOS DE RED (2026-11-17). Medido en producción: el job 1ccd7b6f (pieza bfb10eb3) falló a los 455 s con
// «VIDEOLAB_PROVIDER_FAILED: fetch failed», sin decir qué llamada ni por qué. Un corte de red momentáneo tumbaba un render
// de varios minutos. Ahora:
//   - las llamadas que se pueden repetir sin efecto doble (GET, PATCH, subida con x-upsert, descarga) se reintentan ante
//     un corte de red o un 502/503/504, hasta `NET_TRIES` veces, esperando `NET_WAIT_MS` × intento;
//   - las que no (POST de inserción, RPC que asienta costo) no se reintentan;
//   - el error dice qué llamada falló y la causa de red (p. ej. ECONNRESET).
export const NET_TRIES = 3;
export const NET_WAIT_MS = 1500;
const RETRY_STATUS = new Set([502, 503, 504]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** La causa legible de un error de `fetch` (undici guarda el código en `cause`). PURO. */
export function netCause(e) {
  const c = e?.cause;
  return [c?.code, c?.message ?? (typeof c === 'string' ? c : null)].filter(Boolean).join(' ') || String(e?.message ?? e);
}

/**
 * `fetch` con nombre. `retry`: si la llamada se puede repetir sin efecto doble. Devuelve la respuesta (o la última, si
 * agotó los intentos con 502/503/504); lanza con la llamada y la causa si la red no respondió.
 */
export async function fetchNamed(what, url, init = {}, { retry = false, tries = NET_TRIES, waitMs = NET_WAIT_MS } = {}) {
  const max = retry ? tries : 1;
  for (let k = 1; ; k++) {
    try {
      const res = await fetch(url, init);
      if (!(retry && RETRY_STATUS.has(res.status) && k < max)) return res;
    } catch (e) {
      if (k >= max) throw new Error(`${what}: la red no respondió tras ${k} intento(s) (${netCause(e)})`);
    }
    await sleep(waitMs * k);
  }
}

async function check(res, what) {
  if (res.ok) return res;
  const body = await res.text().catch(() => '');
  throw new Error(`${what} → ${res.status} ${body.slice(0, 300)}`);
}

/** GET de PostgREST. `schema` elige el esquema expuesto (public, intel, …). */
export async function select(cfg, path, schema = 'public') {
  const res = await fetchNamed(`GET ${path.split('?')[0]}`, `${cfg.url}/rest/v1/${path}`, { headers: headers(cfg, { 'Accept-Profile': schema }) }, { retry: true });
  await check(res, `GET ${path}`);
  return res.json();
}

export async function patch(cfg, table, filter, body) {
  const res = await fetchNamed(`PATCH ${table}`, `${cfg.url}/rest/v1/${table}?${filter}`, {
    method: 'PATCH',
    headers: headers(cfg, { 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
    body: JSON.stringify(body),
  }, { retry: true });
  await check(res, `PATCH ${table}`);
}

export async function insert(cfg, table, row) {
  const res = await fetchNamed(`POST ${table}`, `${cfg.url}/rest/v1/${table}`, {
    method: 'POST',
    headers: headers(cfg, { 'Content-Type': 'application/json', Prefer: 'return=representation' }),
    body: JSON.stringify(row),
  });
  await check(res, `POST ${table}`);
  const out = await res.json();
  return Array.isArray(out) ? out[0] : out;
}

export async function rpc(cfg, fn, args) {
  const res = await fetchNamed(`RPC ${fn}`, `${cfg.url}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: headers(cfg, { 'Content-Type': 'application/json' }),
    body: JSON.stringify(args),
  });
  await check(res, `RPC ${fn}`);
  return res.json();
}

/** Lee un objeto del bucket con la llave de servicio; si no existe, null. Se usa para la caché de clips. */
export async function readObject(cfg, path) {
  const res = await fetchNamed(`STORAGE GET ${path}`, `${cfg.url}/storage/v1/object/authenticated/${cfg.bucket}/${path}`,
    { headers: headers(cfg) }, { retry: true });
  if (res.status === 404 || res.status === 400) return null;
  await check(res, `STORAGE GET ${path}`);
  return new Uint8Array(await res.arrayBuffer());
}

/** Sube un archivo al bucket (sobrescribe) y devuelve su URL pública. */
export async function upload(cfg, path, bytes, contentType) {
  // Con x-upsert la subida se puede repetir: el mismo archivo en la misma ruta.
  const res = await fetchNamed(`STORAGE ${path}`, `${cfg.url}/storage/v1/object/${cfg.bucket}/${path}`, {
    method: 'POST',
    headers: headers(cfg, { 'Content-Type': contentType, 'x-upsert': 'true', 'Cache-Control': '3600' }),
    body: bytes,
  }, { retry: true });
  await check(res, `STORAGE ${path}`);
  return `${cfg.url}/storage/v1/object/public/${cfg.bucket}/${path}`;
}

export async function download(url, what) {
  const res = await fetchNamed(`descarga ${what}`, url, {}, { retry: true });
  await check(res, `descarga ${what}`);
  return new Uint8Array(await res.arrayBuffer());
}
