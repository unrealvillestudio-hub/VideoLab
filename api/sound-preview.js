// VIDEOLAB · POST /api/sound-preview — la ESCUCHA EXACTA de la mezcla, antes de aplicar (contrato v1.12.0, §4 ter.10).
//
// Decisión de Sam (2026-11-17): «las dos escuchas»; opción A confirmada: en Vercel. Recibe el mismo pedido que
// `/api/text-scene` (con `text_layers.sound`) más el video limpio, y devuelve SÓLO el audio mezclado: la voz del video,
// el fondo y los efectos, con la misma composición, hoja de entradas, ganancias y sonoridad final que el render, porque
// usa el MISMO código (`render/src/soundmix.mjs`). No dibuja el video y no asienta costo.
// ffmpeg: el binario de `ffmpeg-static` 5.1 (la misma rama que el job, Debian bookworm); sin él, el del sistema.
// Variables: SUPABASE_SERVICE_ROLE_KEY, y SUPABASE_URL (o VITE_SUPABASE_URL).

import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as S from '../render/src/supa.mjs';
import { resolveCanvas, RenderError } from '../render/src/plan.mjs';
import { prepareTextLayers } from '../render/src/textprep.mjs';
import { resolveSound, mixSound, measureLoudness } from '../render/src/soundmix.mjs';
import { validateSceneRequest } from './text-scene.js';

export const config = { maxDuration: 60 };
const run = promisify(execFile);
const enc = encodeURIComponent;

/** El binario de ffmpeg: el de `ffmpeg-static` si está instalado; si no, `ffmpeg` del sistema. */
export async function ffmpegBin() {
  try { const m = await import('ffmpeg-static'); return m.default || 'ffmpeg'; } catch { return 'ffmpeg'; }
}

/** Valida el pedido: el de `/api/text-scene` con `text_layers.sound` y `previousOutputs.base_video.url`. PURO. */
export function validatePreviewRequest(body) {
  const r = validateSceneRequest(body);
  const bad = (m) => { throw new RenderError('VIDEOLAB_BAD_REQUEST', m); };
  if (!r.textLayers?.sound) bad('falta text_layers.sound: no hay sonido que escuchar');
  const url = body.previousOutputs?.base_video?.url;
  if (typeof url !== 'string' || !/^https:\/\//.test(url)) bad('falta previousOutputs.base_video.url (el video limpio, https)');
  return { ...r, baseUrl: url };
}

/** Duración (s) del video según ffmpeg (sin ffprobe). */
async function durationOf(ffmpeg, path) {
  const e = await run(ffmpeg, ['-hide_banner', '-i', path], { maxBuffer: 1 << 24 }).then(() => null, (x) => x);
  const m = String(e?.stderr ?? '').match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
  if (!m) throw new Error('no se pudo leer la duración del video');
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ status: 'error', error_label: 'VIDEOLAB_BAD_REQUEST', error: 'sólo POST' });
  const t0 = Date.now();
  const work = mkdtempSync(join(tmpdir(), 'vl-sound-'));
  try {
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = null; } }
    const r = validatePreviewRequest(body);
    const cfg = S.config({ ...process.env, SUPABASE_URL: process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL });
    const ffmpeg = await ffmpegBin();
    const sound = r.textLayers.sound;
    const resolved = await resolveSound({ cfg, brandId: r.brandId, sound });
    if (!resolved) throw new RenderError('VIDEOLAB_BAD_REQUEST', 'text_layers.sound no hace sonar nada (todo apagado)');
    // La escena: la misma que dibuja el render; de ella salen los momentos de los efectos.
    const [profile] = await S.select(cfg, `platform_format_profiles?platform=eq.${enc(r.params.platform)}&format=eq.reel&active=eq.true&select=*`, 'intel');
    const canvas = resolveCanvas(r.params.canvas ?? null, profile);
    const tlr = await prepareTextLayers({ cfg, brandId: r.brandId, params: r.params, profile, canvas, textLayers: r.textLayers,
      timeline: r.timeline, durationMs: r.durationMs, work, withScene: true });
    const video = join(work, 'base.mp4');
    writeFileSync(video, await S.download(r.baseUrl, 'video limpio'));
    const m = await mixSound({ cfg, brandId: r.brandId, ...resolved, sound, platform: r.params.platform, scene: tlr.scene ?? { blocks: tlr.blocks },
      timeline: r.timeline, video, work, run, ffmpeg, durationS: await durationOf(ffmpeg, video) });
    // Mismo códec y tasa que el audio del render.
    const m4a = join(work, 'escucha.m4a');
    await run(ffmpeg, ['-y', '-loglevel', 'error', '-i', m.master, '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-ac', '2', '-movflags', '+faststart', m4a]);
    const final = await measureLoudness(m4a, run, ffmpeg);
    const bytes = readFileSync(m4a);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({
      status: 'ok',
      audio: { mime: 'audio/mp4', base64: bytes.toString('base64'), bytes: bytes.length },
      sound: { ...resolved.chosen, platform: m.platform, cues: m.cues.length, sounds: m.keys, voice_lufs: m.voice.lufs, gains: m.gains, master: final },
      elapsed_ms: Date.now() - t0,
    });
  } catch (e) {
    const label = e instanceof RenderError ? e.label : 'VIDEOLAB_PROVIDER_FAILED';
    const status = label === 'VIDEOLAB_BAD_REQUEST' || label === 'VIDEOLAB_TEXT_DOES_NOT_FIT' ? 400 : 500;
    return res.status(status).json({ status: 'error', error_label: label, error: String(e?.message ?? e).slice(0, 400), ...(e?.fit ? { fit: e.fit } : {}) });
  } finally {
    try { rmSync(work, { recursive: true, force: true }); } catch { /* nada */ }
  }
}
