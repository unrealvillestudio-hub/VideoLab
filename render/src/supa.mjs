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

async function check(res, what) {
  if (res.ok) return res;
  const body = await res.text().catch(() => '');
  throw new Error(`${what} → ${res.status} ${body.slice(0, 300)}`);
}

/** GET de PostgREST. `schema` elige el esquema expuesto (public, intel, …). */
export async function select(cfg, path, schema = 'public') {
  const res = await fetch(`${cfg.url}/rest/v1/${path}`, { headers: headers(cfg, { 'Accept-Profile': schema }) });
  await check(res, `GET ${path}`);
  return res.json();
}

export async function patch(cfg, table, filter, body) {
  const res = await fetch(`${cfg.url}/rest/v1/${table}?${filter}`, {
    method: 'PATCH',
    headers: headers(cfg, { 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
    body: JSON.stringify(body),
  });
  await check(res, `PATCH ${table}`);
}

export async function insert(cfg, table, row) {
  const res = await fetch(`${cfg.url}/rest/v1/${table}`, {
    method: 'POST',
    headers: headers(cfg, { 'Content-Type': 'application/json', Prefer: 'return=representation' }),
    body: JSON.stringify(row),
  });
  await check(res, `POST ${table}`);
  const out = await res.json();
  return Array.isArray(out) ? out[0] : out;
}

export async function rpc(cfg, fn, args) {
  const res = await fetch(`${cfg.url}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: headers(cfg, { 'Content-Type': 'application/json' }),
    body: JSON.stringify(args),
  });
  await check(res, `RPC ${fn}`);
  return res.json();
}

/** Sube un archivo al bucket (sobrescribe) y devuelve su URL pública. */
export async function upload(cfg, path, bytes, contentType) {
  const res = await fetch(`${cfg.url}/storage/v1/object/${cfg.bucket}/${path}`, {
    method: 'POST',
    headers: headers(cfg, { 'Content-Type': contentType, 'x-upsert': 'true', 'Cache-Control': '3600' }),
    body: bytes,
  });
  await check(res, `STORAGE ${path}`);
  return `${cfg.url}/storage/v1/object/public/${cfg.bucket}/${path}`;
}

export async function download(url, what) {
  const res = await fetch(url);
  await check(res, `descarga ${what}`);
  return new Uint8Array(await res.arrayBuffer());
}
