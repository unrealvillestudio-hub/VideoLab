// F6 — POST /api/execute: valida la forma, crea la fila en `lab_jobs` sin despertar a `lab-worker`, lanza el
// Cloud Run Job y responde 202. Sin red: `fetch` es un doble que registra las llamadas.
//
// Ejecutar:  node tests/execute_test.mjs

import { generateKeyPairSync, createVerify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import * as C from '../api/_lib/execute_core.mjs';
import handler from '../api/execute.js';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));
let fallos = 0;
async function caso(nombre, fn) {
  try { await fn(); console.log(`  ok  ${nombre}`); } catch (e) { fallos++; console.error(`  MAL ${nombre}\n      ${e.message}`); }
}

const PEDIDO = () => ({
  brandId: 'MarcaSintetica', pieceId: '00000000-0000-0000-0000-0000000000aa', parentJobId: '00000000-0000-0000-0000-000000000001',
  params: { platform: 'meta_ig', format: 'reel', video_style: 'product_showcase' },
  previousOutputs: { voice_script: 'hola', on_screen_text: [{ order: 1, text: 'Titular', role: 'headline' }], image: { url: 'https://x/i.png' } },
});
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const SA = { client_email: 'invoker@proyecto.iam.gserviceaccount.com', project_id: 'proyecto-x',
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) };

console.log('execute — entrada asíncrona');

await caso('un pedido válido pasa; cada campo obligatorio ausente da VIDEOLAB_BAD_REQUEST', () => {
  assert.equal(C.validateRequest(PEDIDO()).brandId, 'MarcaSintetica');
  const quitar = [(r) => delete r.brandId, (r) => delete r.parentJobId, (r) => { r.pieceId = 'prueba-f6-render'; }, (r) => { r.parentJobId = 'job-1'; }, (r) => { r.params.format = 'story'; },
    (r) => { r.params.video_style = 'otro'; }, (r) => { r.params.producer = 'kling'; }, (r) => delete r.previousOutputs.voice_script,
    (r) => { r.previousOutputs.on_screen_text[0].role = 'titulo'; }, (r) => delete r.previousOutputs.image];
  for (const q of quitar) { const r = PEDIDO(); q(r); assert.throws(() => C.validateRequest(r), (e) => e.label === 'VIDEOLAB_BAD_REQUEST'); }
  const conPersona = PEDIDO(); delete conPersona.previousOutputs.image; conPersona.params.person_blueprint_id = 'persona-1';
  assert.equal(C.validateRequest(conPersona).params.person_blueprint_id, 'persona-1');
  assert.throws(() => C.validateRequest(null), (e) => e.label === 'VIDEOLAB_BAD_REQUEST');
  const conMotor = PEDIDO(); conMotor.params.avatar_engine = 'avatar_v';
  assert.equal(C.validateRequest(conMotor).params.avatar_engine, 'avatar_v');
  const motorMalo = PEDIDO(); motorMalo.params.avatar_engine = 7;
  assert.throws(() => C.validateRequest(motorMalo), /avatar_engine/);
});

await caso('la fila nace en running (el trigger de lab-worker sólo despacha pending y queued)', () => {
  const row = C.buildJobRow(PEDIDO());
  assert.equal(row.status, 'running');
  assert.ok(!['pending', 'queued'].includes(row.status));
  assert.deepEqual([row.lab, row.job_type, row.parent_job_id], ['videolab', 'videolab', PEDIDO().parentJobId]);
  assert.deepEqual(row.payload, PEDIDO());
});

await caso('el lanzamiento va a la API de Cloud Run v2 con JOB_ID en las variables', () => {
  const r = C.runRequest('proyecto-x', 'job-1');
  assert.equal(r.url, 'https://run.googleapis.com/v2/projects/proyecto-x/locations/us-central1/jobs/videolab-render:run');
  assert.deepEqual(r.body.overrides.containerOverrides[0].env, [{ name: 'JOB_ID', value: 'job-1' }]);
});

await caso('la clave se lee en JSON o base64, y el JWT se firma con ella (RS256 verificable)', () => {
  assert.equal(C.parseServiceAccount(JSON.stringify(SA)).project_id, 'proyecto-x');
  assert.equal(C.parseServiceAccount(Buffer.from(JSON.stringify(SA)).toString('base64')).client_email, SA.client_email);
  assert.throws(() => C.parseServiceAccount(''), /VIDEOLAB_RUNNER_KEY no configurado/);
  const [h, c, s] = C.signedAssertion(SA, 1000).split('.');
  assert.equal(JSON.parse(Buffer.from(c, 'base64url')).exp, 4600);
  assert.ok(createVerify('RSA-SHA256').update(`${h}.${c}`).verify(publicKey, Buffer.from(s, 'base64url')));
});

// ── el handler completo con un fetch doble ──
function resDoble() {
  const r = { code: 0, body: null };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.end = () => r;
  return r;
}
function entorno(runOk = true) {
  process.env.VIDEOLAB_RUNNER_KEY = JSON.stringify(SA);
  process.env.SUPABASE_URL = 'https://sb.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'llave-de-prueba';
  const llamadas = [];
  globalThis.fetch = async (url, init = {}) => {
    llamadas.push({ url: String(url), init });
    const ok = (b, s = 200) => ({ ok: s < 300, status: s, json: async () => b, text: async () => JSON.stringify(b) });
    if (String(url).includes('/rest/v1/lab_jobs?select=id')) return ok([{ id: 'job-xyz' }], 201);
    if (String(url).includes('oauth2.googleapis.com')) return ok({ access_token: 't' });
    if (String(url).includes('run.googleapis.com')) return runOk ? ok({ name: 'op' }) : ok({ error: 'denegado' }, 403);
    if (String(url).includes('/rest/v1/lab_jobs?id=eq.')) return ok({}, 204);
    throw new Error(`fetch inesperado ${url}`);
  };
  return llamadas;
}

await caso('202 { job_id, status } tras crear la fila y lanzar la ejecución', async () => {
  const ll = entorno();
  const res = resDoble();
  await handler({ method: 'POST', body: PEDIDO() }, res);
  assert.equal(res.code, 202);
  assert.deepEqual(res.body, { job_id: 'job-xyz', status: 'running' });
  assert.equal(JSON.parse(ll[0].init.body).status, 'running');
  assert.match(ll[2].url, /videolab-render:run$/);
});

await caso('pedido inválido: 400 y ninguna llamada (no se crea job)', async () => {
  const ll = entorno();
  const res = resDoble();
  const p = PEDIDO(); delete p.pieceId;
  await handler({ method: 'POST', body: p }, res);
  assert.equal(res.code, 400);
  assert.equal(res.body.error_label, 'VIDEOLAB_BAD_REQUEST');
  assert.equal(ll.length, 0);
});

await caso('regla rota a propósito: si Cloud Run rechaza, la fila queda en failed y no colgada en running', async () => {
  const ll = entorno(false);
  const res = resDoble();
  await handler({ method: 'POST', body: PEDIDO() }, res);
  assert.equal(res.code, 502);
  assert.equal(res.body.job_id, 'job-xyz');
  const parche = ll.find((l) => l.url.includes('lab_jobs?id=eq.job-xyz'));
  assert.equal(JSON.parse(parche.init.body).status, 'failed');
});

await caso('un solo tope: contrato max_run_ms = MAX_RUN_MS del job = --task-timeout del despliegue; el vigía llega antes', async () => {
  const { MAX_RUN_MS, WATCHDOG_MS } = await import('../render/src/main.mjs');
  const contrato = JSON.parse(readFileSync(join(RAIZ, 'contract/videolab.contract.json'), 'utf8'));
  const deploy = readFileSync(join(RAIZ, 'docs/DEPLOY_RENDER.md'), 'utf8');
  assert.equal(contrato.transport.max_run_ms, MAX_RUN_MS);
  assert.equal(Number(deploy.match(/--task-timeout (\d+)/)[1]) * 1000, MAX_RUN_MS);
  assert.ok(WATCHDOG_MS < MAX_RUN_MS);
  assert.ok(contrato.error_labels.includes('VIDEOLAB_TIMEOUT'));
});

await caso('marca N+1: la entrada no nombra ninguna marca ni persona', () => {
  const INSTANCIAS = ['NeuroneSCF', 'ForumPHs', 'UnrealvilleStudio', 'LucienSael', 'D7Herbal', 'Patricia', 'Irja', 'Ivette', 'Lucien', 'NSCF', 'FPHS', 'D7H'];
  for (const f of ['api/execute.js', 'api/_lib/execute_core.mjs']) {
    const s = readFileSync(join(RAIZ, f), 'utf8').replace(/_/g, ' ');
    assert.deepEqual(INSTANCIAS.filter((n) => new RegExp(`\\b${n}\\b`, 'i').test(s)), [], f);
  }
});

if (fallos) { console.error(`\n${fallos} caso(s) en rojo`); process.exit(1); }
console.log('\nexecute: todo en verde');
