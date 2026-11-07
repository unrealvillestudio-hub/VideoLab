// HeyGen: imagen que habla con audio propio (POST /v3/videos, Avatar IV por defecto; GET /v3/videos/{id}).
// La clave llega por HEYGEN_API_KEY (Secret Manager). Sin ella, falla nombrándola.
import { heygenRequestBody, heygenStatus } from '../assemble.mjs';
import { RenderError } from '../plan.mjs';

const BASE = 'https://api.heygen.com';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function heygenClip({ imageUrl, audioUrl, title, timeoutMs = 840000 }) {
  const key = process.env.HEYGEN_API_KEY;
  if (!key) throw new RenderError('VIDEOLAB_PROVIDER_FAILED', 'HEYGEN_API_KEY no configurado');
  const h = { 'x-api-key': key, 'Content-Type': 'application/json' };
  const res = await fetch(`${BASE}/v3/videos`, { method: 'POST', headers: h, body: JSON.stringify(heygenRequestBody({ imageUrl, audioUrl, title })) });
  const body = await res.json().catch(() => ({}));
  const id = body?.data?.video_id;
  if (!res.ok || !id) throw new RenderError('VIDEOLAB_PROVIDER_FAILED', `HeyGen ${res.status}: ${JSON.stringify(body).slice(0, 300)}`);
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    await sleep(10000);
    const r = await fetch(`${BASE}/v3/videos/${encodeURIComponent(id)}`, { headers: h });
    const d = (await r.json().catch(() => ({})))?.data ?? {};
    const st = heygenStatus(d);
    if (st.state === 'failed') throw new RenderError('VIDEOLAB_PROVIDER_FAILED', `HeyGen: ${st.reason}`.slice(0, 400));
    if (st.state === 'completed') {
      const dl = await fetch(st.url);
      if (!dl.ok) throw new RenderError('VIDEOLAB_PROVIDER_FAILED', `HeyGen descarga ${dl.status}`);
      return { bytes: Buffer.from(await dl.arrayBuffer()), videoId: id };
    }
  }
  throw new RenderError('VIDEOLAB_PROVIDER_FAILED', `HeyGen no terminó a tiempo (video ${id})`);
}
