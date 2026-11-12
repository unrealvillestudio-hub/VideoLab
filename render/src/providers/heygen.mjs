// HeyGen: imagen o look que habla con audio propio (POST /v3/videos; GET /v3/videos/{id}; GET /v3/avatars/looks/{id}).
// La clave llega por HEYGEN_API_KEY (Secret Manager). Sin ella, falla nombrándola.
import { heygenRequestBody, heygenStatus } from '../assemble.mjs';
import { RenderError } from '../plan.mjs';
import { podcastHeygenBody } from '../podcast.mjs';

const BASE = 'https://api.heygen.com';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function headers() {
  const key = process.env.HEYGEN_API_KEY;
  if (!key) throw new RenderError('VIDEOLAB_PROVIDER_FAILED', 'HEYGEN_API_KEY no configurado');
  return { 'x-api-key': key, 'Content-Type': 'application/json' };
}

/** El look de HeyGen (gemelo, avatar de estudio o de foto): tipo, estado y motores que admite. */
export async function heygenLook(lookId) {
  const r = await fetch(`${BASE}/v3/avatars/looks/${encodeURIComponent(lookId)}`, { headers: headers() });
  const body = await r.json().catch(() => ({}));
  if (!r.ok || !body?.data) throw new RenderError('VIDEOLAB_PROVIDER_FAILED', `HeyGen look ${lookId} ${r.status}: ${JSON.stringify(body).slice(0, 200)}`);
  return body.data;
}

export async function heygenClip({ imageUrl, audioUrl, title, direction, subject = null, timeoutMs = 840000 }) {
  const h = headers();
  const res = await fetch(`${BASE}/v3/videos`, { method: 'POST', headers: h, body: JSON.stringify(heygenRequestBody({ imageUrl, audioUrl, title, direction, subject })) });
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

/**
 * Podcast (contrato v1.1.0): anima la IMAGEN de una toma con un tramo de audio, con el motor del turno. Avatar IV va por
 * POST /v3/videos (`type: image`); Avatar 6 por el modelo POST /v3/models/avatars, que se consulta en /v3/models/videos.
 */
export async function heygenImageClip({ engine, imageUrl, audioUrl, title, direction, timeoutMs = 600000 }) {
  const h = headers();
  const isModel = engine.api === 'models';
  const res = await fetch(`${BASE}${isModel ? '/v3/models/avatars' : '/v3/videos'}`, { method: 'POST', headers: h,
    body: JSON.stringify(podcastHeygenBody({ engine, imageUrl, audioUrl, title, direction })) });
  const body = await res.json().catch(() => ({}));
  const id = body?.data?.video_id;
  if (!res.ok || !id) throw new RenderError('VIDEOLAB_PROVIDER_FAILED', `HeyGen ${engine.engine} ${res.status}: ${JSON.stringify(body).slice(0, 300)}`);
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    await sleep(10000);
    const r = await fetch(`${BASE}${isModel ? '/v3/models/videos/' : '/v3/videos/'}${encodeURIComponent(id)}`, { headers: h });
    const st = heygenStatus((await r.json().catch(() => ({})))?.data ?? {});
    if (st.state === 'failed') throw new RenderError('VIDEOLAB_PROVIDER_FAILED', `HeyGen ${engine.engine}: ${st.reason}`.slice(0, 400));
    if (st.state === 'completed') {
      const dl = await fetch(st.url);
      if (!dl.ok) throw new RenderError('VIDEOLAB_PROVIDER_FAILED', `HeyGen descarga ${dl.status}`);
      return { bytes: Buffer.from(await dl.arrayBuffer()), videoId: id };
    }
  }
  throw new RenderError('VIDEOLAB_PROVIDER_FAILED', `HeyGen no terminó a tiempo (video ${id})`);
}
