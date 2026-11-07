// Veo por Vertex AI: image-to-video asíncrono (predictLongRunning → fetchPredictOperation).
import { accessToken, projectId } from './gcp.mjs';
import { veoRequestBody, veoVideosFrom } from '../assemble.mjs';
import { RenderError } from '../plan.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function veoClip({ model, location, prompt, imageB64, durationS, seed, timeoutMs = 600000 }) {
  const token = await accessToken();
  const project = await projectId();
  const base = `https://${location}-aiplatform.googleapis.com/v1/projects/${project}/locations/${location}/publishers/google/models/${model}`;
  const h = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const start = await fetch(`${base}:predictLongRunning`, { method: 'POST', headers: h,
    body: JSON.stringify(veoRequestBody({ prompt, imageB64, durationS, seed })) });
  const op = await start.json().catch(() => ({}));
  if (!start.ok || !op.name) throw new RenderError('VIDEOLAB_PROVIDER_FAILED', `Veo ${start.status}: ${JSON.stringify(op).slice(0, 300)}`);
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    await sleep(10000);
    const res = await fetch(`${base}:fetchPredictOperation`, { method: 'POST', headers: h, body: JSON.stringify({ operationName: op.name }) });
    const st = await res.json().catch(() => ({}));
    if (!res.ok) throw new RenderError('VIDEOLAB_PROVIDER_FAILED', `Veo sondeo ${res.status}: ${JSON.stringify(st).slice(0, 300)}`);
    if (st.done) {
      const [v] = veoVideosFrom(st);
      if (v.b64) return Buffer.from(v.b64, 'base64');
      const m = /^gs:\/\/([^/]+)\/(.+)$/.exec(v.gcsUri);
      const dl = await fetch(`https://storage.googleapis.com/storage/v1/b/${m[1]}/o/${encodeURIComponent(m[2])}?alt=media`,
        { headers: { Authorization: `Bearer ${token}` } });
      if (!dl.ok) throw new RenderError('VIDEOLAB_PROVIDER_FAILED', `Veo descarga ${dl.status}`);
      return Buffer.from(await dl.arrayBuffer());
    }
  }
  throw new RenderError('VIDEOLAB_PROVIDER_FAILED', 'Veo no terminó a tiempo');
}
