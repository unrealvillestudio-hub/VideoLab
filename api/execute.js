// VIDEOLAB · POST /api/execute — entrada asíncrona del contrato v1.0.0 (§1).
//
// Valida el pedido, crea la fila en `lab_jobs` y lanza una ejecución del Cloud Run Job `videolab-render` con
// la cuenta de servicio de VIDEOLAB_RUNNER_KEY. Responde 202 sin esperar el render; el carril sondea `lab_jobs`.
// Variables: VIDEOLAB_RUNNER_KEY, SUPABASE_SERVICE_ROLE_KEY, y SUPABASE_URL (o VITE_SUPABASE_URL).

import { validateRequest, buildJobRow, runRequest, parseServiceAccount, signedAssertion, ExecuteError } from './_lib/execute_core.mjs';

export const config = { maxDuration: 30 };

function supabase() {
  const url = String(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/+$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!url) throw new ExecuteError('VIDEOLAB_PROVIDER_FAILED', 'SUPABASE_URL no configurado', 500);
  if (!key) throw new ExecuteError('VIDEOLAB_PROVIDER_FAILED', 'SUPABASE_SERVICE_ROLE_KEY no configurado', 500);
  return { url, headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' } };
}

async function googleToken(key) {
  const res = await fetch(key.token_uri || 'https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: signedAssertion(key, Math.floor(Date.now() / 1000)) }),
  });
  if (!res.ok) throw new ExecuteError('VIDEOLAB_PROVIDER_FAILED', `token de GCP ${res.status}`, 502);
  return (await res.json()).access_token;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ status: 'error', error_label: 'VIDEOLAB_BAD_REQUEST', error: 'sólo POST' });

  let sb, jobId = null;
  try {
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = null; } }
    const request = validateRequest(body);
    const key = parseServiceAccount(process.env.VIDEOLAB_RUNNER_KEY);
    sb = supabase();

    const ins = await fetch(`${sb.url}/rest/v1/lab_jobs?select=id`, {
      method: 'POST', headers: { ...sb.headers, Prefer: 'return=representation' }, body: JSON.stringify(buildJobRow(request)),
    });
    if (!ins.ok) throw new ExecuteError('VIDEOLAB_PROVIDER_FAILED', `lab_jobs ${ins.status} ${(await ins.text()).slice(0, 200)}`, 502);
    jobId = (await ins.json())[0].id;

    const run = runRequest(key.project_id, jobId);
    const r = await fetch(run.url, { method: 'POST',
      headers: { Authorization: `Bearer ${await googleToken(key)}`, 'Content-Type': 'application/json' }, body: JSON.stringify(run.body) });
    if (!r.ok) throw new ExecuteError('VIDEOLAB_PROVIDER_FAILED', `Cloud Run ${r.status} ${(await r.text()).slice(0, 200)}`, 502);

    return res.status(202).json({ job_id: jobId, status: 'running' });
  } catch (e) {
    const label = e instanceof ExecuteError ? e.label : 'VIDEOLAB_PROVIDER_FAILED';
    const status = e instanceof ExecuteError ? e.status : 500;
    const msg = String(e?.message ?? e).slice(0, 400);
    // Si el job ya existe y el lanzamiento falló, la fila queda en `failed`: nunca colgada en `running`.
    if (jobId && sb) {
      await fetch(`${sb.url}/rest/v1/lab_jobs?id=eq.${jobId}`, { method: 'PATCH', headers: sb.headers,
        body: JSON.stringify({ status: 'failed', error_msg: `${label}: ${msg}`, completed_at: new Date().toISOString() }) }).catch(() => {});
    }
    return res.status(status).json({ status: 'error', error_label: label, error: msg, ...(jobId ? { job_id: jobId } : {}) });
  }
}
