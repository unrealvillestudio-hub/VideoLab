// VIDEOLAB · ENTRADA ASÍNCRONA — bloque PURO de `api/execute` (contrato v1.0.0, §1 y §2).
//
// Valida la forma del pedido, arma la fila de `lab_jobs` y el cuerpo que lanza el Cloud Run Job. Todo lo que
// distingue a una marca (estilo declarado, productor, preset, tope) lo resuelve el job desde el dato: aquí
// sólo se comprueba la forma, para que un pedido inválido no cree job (contrato §1).
//
// POR QUÉ LA FILA NACE EN `running`. El trigger `lab_jobs_trigger_worker` despacha al Edge Function
// `lab-worker` toda fila que nace en `pending` o `queued`, y ese camino no sabe hablar con el job asíncrono
// [medido 2026-11-07, `public.trigger_lab_worker`]. La ejecución se lanza en la misma petición, así que la
// fila ya está en marcha cuando se responde.

import { createSign } from 'node:crypto';

export const RUN_REGION = 'us-central1';
export const RUN_JOB = 'videolab-render';
export const INITIAL_STATUS = 'running';

const STYLES = ['product_showcase', 'product_demo', 'before_after', 'unboxing', 'ugc'];
const PRODUCERS = ['render', 'generative', 'avatar'];
const ROLES = ['headline', 'subheadline', 'cta'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class ExecuteError extends Error {
  constructor(label, message, status = 400) { super(message); this.label = label; this.status = status; }
}

const bad = (m) => { throw new ExecuteError('VIDEOLAB_BAD_REQUEST', m); };
const str = (v) => typeof v === 'string' && v.trim().length > 0;
const obj = (v) => v != null && typeof v === 'object' && !Array.isArray(v);

/** Comprueba la forma del pedido (contrato §2). Devuelve el pedido normalizado o lanza VIDEOLAB_BAD_REQUEST. PURO. */
export function validateRequest(body) {
  if (!obj(body)) bad('el cuerpo debe ser un objeto JSON');
  for (const k of ['brandId', 'pieceId', 'parentJobId']) if (!str(body[k])) bad(`falta ${k}`);
  // pieceId y parentJobId son UUID: el libro de costos (ops_log_generation.p_piece_id) y lab_jobs.parent_job_id
  // los tipan así. Un texto pasaría hasta el final del render y fallaría al asentar el costo, ya gastado.
  for (const k of ['pieceId', 'parentJobId']) if (!UUID.test(body[k])) bad(`${k} debe ser un UUID`);
  const p = body.params, prev = body.previousOutputs;
  if (!obj(p)) bad('falta params');
  if (!obj(prev)) bad('falta previousOutputs');
  if (!str(p.platform)) bad('falta params.platform');
  if (p.format !== 'reel') bad("params.format debe ser 'reel'");
  if (!STYLES.includes(p.video_style)) bad(`params.video_style inválido: ${p.video_style}`);
  if (p.producer != null && !PRODUCERS.includes(p.producer)) bad(`params.producer inválido: ${p.producer}`);
  // El motor del avatar es opcional y lo valida el job contra los que admite el look de la ficha.
  if (p.avatar_engine != null && !str(p.avatar_engine)) bad('params.avatar_engine debe ser un texto');
  if (p.duration_target_ms != null && !(Number(p.duration_target_ms) > 0)) bad('params.duration_target_ms debe ser positivo');
  if (p.canvas != null && !(obj(p.canvas) && Number(p.canvas.width) > 0 && Number(p.canvas.height) > 0)) bad('params.canvas debe traer width y height');
  if (typeof prev.voice_script !== 'string') bad('falta previousOutputs.voice_script');
  if (!Array.isArray(prev.on_screen_text)) bad('falta previousOutputs.on_screen_text');
  prev.on_screen_text.forEach((t, i) => {
    if (!obj(t) || typeof t.text !== 'string' || !ROLES.includes(t.role)) bad(`on_screen_text[${i}] necesita text y role (headline | subheadline | cta)`);
  });
  const hasImage = str(prev.image?.url) || (Array.isArray(prev.images) && prev.images.some((x) => str(x?.url)));
  // Con una persona del registro, la imagen del avatar sale de su ficha; si no, el pedido la trae.
  if (!hasImage && !str(p.person_blueprint_id)) bad('previousOutputs no trae imagen (image.url o images[].url)');
  return body;
}

/** La fila de `lab_jobs` que representa el pedido. PURO. */
export function buildJobRow(req) {
  return {
    lab: 'videolab', job_type: 'videolab', status: INITIAL_STATUS,
    brand_id: req.brandId, parent_job_id: req.parentJobId, payload: req,
    dry_run: false, created_by: 'videolab-api',
  };
}

/** URL y cuerpo de la API de Cloud Run v2 que lanza una ejecución con JOB_ID. PURO. */
export function runRequest(projectId, jobId) {
  return {
    url: `https://run.googleapis.com/v2/projects/${projectId}/locations/${RUN_REGION}/jobs/${RUN_JOB}:run`,
    body: { overrides: { containerOverrides: [{ env: [{ name: 'JOB_ID', value: jobId }] }] } },
  };
}

/** Lee la clave de la cuenta de servicio (JSON crudo o base64). Falla nombrando la variable, nunca su valor. PURO. */
export function parseServiceAccount(raw) {
  if (!str(raw)) throw new ExecuteError('VIDEOLAB_PROVIDER_FAILED', 'VIDEOLAB_RUNNER_KEY no configurado', 500);
  let txt = String(raw).trim();
  if (!txt.startsWith('{')) txt = Buffer.from(txt, 'base64').toString('utf8');
  let k;
  try { k = JSON.parse(txt); } catch { throw new ExecuteError('VIDEOLAB_PROVIDER_FAILED', 'VIDEOLAB_RUNNER_KEY no es JSON de cuenta de servicio', 500); }
  if (!k.client_email || !k.private_key || !k.project_id) throw new ExecuteError('VIDEOLAB_PROVIDER_FAILED', 'VIDEOLAB_RUNNER_KEY incompleta (client_email, private_key, project_id)', 500);
  return k;
}

/** JWT firmado para el intercambio OAuth2 de Google (RS256). PURO salvo el reloj, que entra como `nowS`. */
export function signedAssertion(key, nowS) {
  const b64u = (o) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');
  const head = b64u({ alg: 'RS256', typ: 'JWT' });
  const claim = b64u({ iss: key.client_email, scope: 'https://www.googleapis.com/auth/cloud-platform',
    aud: key.token_uri || 'https://oauth2.googleapis.com/token', iat: nowS, exp: nowS + 3600 });
  const sig = createSign('RSA-SHA256').update(`${head}.${claim}`).sign(key.private_key).toString('base64url');
  return `${head}.${claim}.${sig}`;
}
