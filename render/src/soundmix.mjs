// LA MEZCLA DE SONIDO, compartida por el job y la escucha previa (2026-11-17).
//
// Sam pidió escuchar la mezcla antes de aplicarla («las dos escuchas»; opción A confirmada: en Vercel). Para que lo que
// se escucha sea lo que sale en el video, el job (`render/src/main.mjs`, `soundLayer`) y la escucha (`api/sound-preview.js`)
// usan ESTE módulo: mismos presets, misma composición, misma hoja de entradas, mismas ganancias y misma sonoridad final.
// Lo único que cambia es el final: el job remplaza el audio del MP4; la escucha devuelve sólo el audio.

import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as S from './supa.mjs';
import { RenderError } from './plan.mjs';
import { soundCues, soundMixArgs, loudnormArgs, soundKeysOf, mixGains, composeSoundSpec } from './sound.mjs';

const enc = encodeURIComponent;

/**
 * Qué pide `text_layers.sound` (contrato v1.10.0, §4 ter.8). Forma v1.9.0 `{ preset_key }`: un preset de cualquier
 * familia, entero. Forma v1.10.0: `bed` y `effects` por separado; una familia ausente, null o `enabled: false` no suena.
 * Devuelve null si no suena nada. PURO.
 */
export function soundRequestOf(sound) {
  if (!sound || sound.enabled === false) return null;
  const familias = sound.bed !== undefined || sound.effects !== undefined;
  if (!familias) return { legacy: true, preset_key: sound.preset_key, bed: null, effects: null };
  const on = (f) => (f && f.enabled !== false ? f : null);
  const bed = on(sound.bed), effects = on(sound.effects);
  return bed || effects ? { legacy: false, preset_key: null, bed, effects } : null;
}

/** Sonoridad integrada y pico verdadero (ebur128) del audio de `path`. `run`: execFile prometido. */
export async function measureLoudness(path, run, ffmpeg = 'ffmpeg') {
  const { stderr } = await run(ffmpeg, ['-hide_banner', '-nostats', '-i', path, '-af', 'ebur128=peak=true', '-f', 'null', '-'], { maxBuffer: 1 << 26 });
  const sum = String(stderr).slice(String(stderr).lastIndexOf('Summary:'));
  const n = (re) => { const m = sum.match(re); return m ? Number(m[1]) : null; };
  return { lufs: n(/I:\s+(-?[\d.]+) LUFS/), true_peak_db: n(/Peak:\s+(-?[\d.]+) dBFS/) };
}

/**
 * Resuelve el pedido de sonido: lee los presets (`videolab_sound_presets`; la fila de la marca gana), comprueba la
 * familia y compone el spec de la mezcla (`composeSoundSpec`). Devuelve null si no suena nada, o { req, spec, chosen }.
 * Errores del pedido → RenderError VIDEOLAB_BAD_REQUEST.
 */
export async function resolveSound({ cfg, brandId, sound }) {
  const req = soundRequestOf(sound);
  if (!req) return null;
  const wanted = req.legacy ? [req.preset_key] : [req.bed?.preset_key, req.effects?.preset_key].filter(Boolean);
  const rows = await S.select(cfg, `videolab_sound_presets?preset_key=in.(${wanted.map((k) => enc(k)).join(',')})&active=eq.true&or=(brand_id.is.null,brand_id.eq.${enc(brandId)})&select=*`);
  const presetOf = (key, kind) => {
    const of = rows.filter((r) => r.preset_key === key);
    const row = of.find((r) => r.brand_id === brandId) ?? of.find((r) => r.brand_id == null);
    if (!row || row.status === 'retired') throw new RenderError('VIDEOLAB_BAD_REQUEST', `el preset de sonido ${key} no existe o no está activo`);
    if (kind && (row.kind ?? 'mixed') !== kind) throw new RenderError('VIDEOLAB_BAD_REQUEST', `el preset de sonido ${key} es de la familia ${row.kind ?? 'mixed'}, no ${kind}`);
    return row;
  };
  if (req.legacy) {
    const row = presetOf(req.preset_key, null);
    return { req, spec: row.spec, chosen: { preset_key: row.preset_key, bed: null, effects: null } };
  }
  const bedRow = req.bed ? presetOf(req.bed.preset_key, 'bed') : null;
  const fxRow = req.effects ? presetOf(req.effects.preset_key, 'effects') : null;
  let spec;
  try {
    spec = composeSoundSpec({ bedSpec: bedRow?.spec ?? null, effectsSpec: fxRow?.spec ?? null, bed: req.bed ?? {}, effects: req.effects ?? {} });
  } catch (e) {
    if (e?.code === 'SOUND_SLOT_MISSING') throw new RenderError('VIDEOLAB_BAD_REQUEST', `${e.message} (${fxRow.preset_key})`);
    throw e;
  }
  return { req, spec, chosen: {
    preset_key: null,
    bed: bedRow ? { preset_key: bedRow.preset_key, sound_key: spec.bed?.sound ?? null, level_lu: req.bed.level_lu ?? 0 } : null,
    effects: fxRow ? { preset_key: fxRow.preset_key, gain_db: req.effects.gain_db ?? 0, sounds_by_fn: req.effects.sounds_by_fn ?? {} } : null,
  } };
}

/**
 * La mezcla: pide a VoiceLab (por su `api_endpoint`, modo `sound`) los archivos y verifica el sha256 de cada uno; arma la
 * hoja de entradas desde la escena (`soundCues`); lleva la voz del video a la referencia; mezcla cama con ducking y
 * efectos; fija la sonoridad final de la plataforma en dos pasadas. Devuelve { master (WAV), keys, cues, voice, gains,
 * platform }. Un sonido que la librería no tiene o de otra función → RenderError; lo demás lanza Error.
 * `run`: execFile prometido; `ffmpeg`/`ffprobe`: rutas de los binarios (en Vercel, los de la función).
 */
export async function mixSound({ cfg, jobId = null, brandId, req, spec, sound, platform, scene, timeline, video, work, run,
  ffmpeg = 'ffmpeg', ffprobe = 'ffprobe', durationS: knownDuration = null }) {
  const keys = soundKeysOf(spec);
  const files = {}, lib = {};
  if (keys.length) {
    const [vl] = await S.select(cfg, `lab_configs?lab_key=eq.voicelab&select=api_endpoint`);
    if (!vl?.api_endpoint) throw new Error('lab_configs no tiene el api_endpoint de voicelab');
    // El modo `sound` sólo lee la librería y no cuesta: se puede repetir ante un corte de red.
    const res = await S.fetchNamed('VoiceLab sound', `${vl.api_endpoint.replace(/\/+$/, '')}/api/execute`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brandId, stage: { mode: 'sound' }, params: { sounds: keys }, parent_job_id: jobId }),
    }, { retry: true });
    const out = await res.json().catch(() => ({}));
    if (res.status === 422 && out.error_label === 'SOUND_NOT_FOUND') throw new RenderError('VIDEOLAB_BAD_REQUEST', `sonido pedido que la librería no tiene: ${String(out.error ?? '').slice(0, 160)}`);
    if (!res.ok || !Array.isArray(out.sounds)) throw new Error(`VoiceLab ${res.status} ${out.error_label ?? ''} ${String(out.error ?? '').slice(0, 160)}`);
    for (const snd of out.sounds) lib[snd.key] = snd;
    // Lo elegido de la librería tiene que ser de la función del momento (la cama, música de fondo).
    const fnOf = (k) => lib[k]?.fn;
    if (req.bed?.sound_key && fnOf(req.bed.sound_key) && fnOf(req.bed.sound_key) !== 'music_bed') throw new RenderError('VIDEOLAB_BAD_REQUEST', `${req.bed.sound_key} no es un sonido de fondo (es ${fnOf(req.bed.sound_key)})`);
    for (const [fn, k] of Object.entries(req.effects?.sounds_by_fn ?? {})) {
      if (k && fnOf(k) && fnOf(k) !== fn) throw new RenderError('VIDEOLAB_BAD_REQUEST', `${k} es un sonido de ${fnOf(k)}, no de ${fn}`);
    }
    for (const snd of out.sounds) {
      const bytes = await S.download(snd.url, `sonido ${snd.key}`);
      const h = createHash('sha256').update(bytes).digest('hex');
      if (h !== snd.sha256) throw new Error(`la huella de ${snd.key} no coincide (${h.slice(0, 12)} ≠ ${String(snd.sha256).slice(0, 12)})`);
      files[snd.key] = join(work, `${snd.key}.wav`);
      writeFileSync(files[snd.key], bytes);
    }
  }
  // La escucha previa (Vercel, sin ffprobe) pasa la duración; el job la lee con ffprobe.
  const durationS = knownDuration ?? Number(JSON.parse((await run(ffprobe, ['-v', 'error', '-show_format', '-of', 'json', video])).stdout).format.duration);
  const voice = await measureLoudness(video, run, ffmpeg);
  const gains = mixGains({ spec, voiceLufs: voice.lufs, bedLufs: lib[spec?.bed?.sound]?.loudness_lufs });
  const cues = soundCues(scene, timeline, spec);
  const mix = join(work, 'mezcla.wav'), master = join(work, 'master.wav');
  await run(ffmpeg, soundMixArgs({ video, durationS, preset: spec, cues, files, out: mix, gains }), { maxBuffer: 1 << 26 });
  const plat = sound.platform ?? platform;
  const target = spec.master_by_platform?.[plat] ?? spec.master_by_platform?.default ?? {};
  const { stderr } = await run(ffmpeg, loudnormArgs({ input: mix, target }), { maxBuffer: 1 << 26 });
  const txt = String(stderr);
  const measured = JSON.parse(txt.slice(txt.lastIndexOf('{'), txt.lastIndexOf('}') + 1));
  await run(ffmpeg, loudnormArgs({ input: mix, target, measured, out: master }), { maxBuffer: 1 << 26 });
  return { master, keys, cues, voice, gains, platform: plat };
}
