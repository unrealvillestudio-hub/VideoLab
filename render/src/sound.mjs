// CAPA DE SONIDO DE VIDEOLAB (F0, 2026-11-17) — dónde suena cada efecto y cómo se mezcla.
//
// Reparto validado por Sam (2026-11-17): VoiceLab es dueño de la librería de sonidos (sintetizados por código, licencia
// propia, sin regalías) y VideoLab la consume. Aquí sólo vive lo que es del render: la HOJA DE ENTRADAS (qué sonido,
// en qué milisegundo) y la MEZCLA (voz + cama con ducking + efectos + sonoridad final).
//
// La hoja sale de la MISMA escena que dibuja el motor HTML: el inicio de cada bloque, el instante en que cada cifra
// del rodillo cae en su valor (misma fórmula que runtime.mjs) y los cortes de toma del timeline. El preset de sonido
// es DATO: qué sonido va a cada función, con qué ganancia y desfase, y la sonoridad final por plataforma. El código no
// conoce ninguna marca.

import { stateAt } from './html/keyframes.mjs';

const num = (v, d) => (v != null && Number.isFinite(Number(v)) ? Number(v) : d);

/** Cifras de un número tal como se escriben (sin separadores): 1.250,50 → 6; 1.67 → 3; 200 → 3. PURO. */
export function digitCount(n) {
  return String(Math.floor(Math.abs(n.value))).length + (n.decimals ?? 0);
}

/**
 * Instantes (ms) en que cada cifra del rodillo cae en su valor, para un bloque con `roll`. Misma fórmula que el
 * `seek` del runtime: la cifra j llega cuando el avance del contador alcanza j·lag + (1 − lag·(n−1)). PURO.
 */
export function digitLandings(block) {
  if (!block.roll) return [];
  const out = [];
  const nums = block.lines.flatMap((l) => l.words).filter((w) => w.number);
  nums.forEach((w, i) => {
    const n = digitCount(w.number);
    const lag = Math.min(block.roll.lag, n > 1 ? 0.9 / (n - 1) : 0);
    const span1 = 1 - lag * Math.max(0, n - 1);
    const need = Array.from({ length: n }, (_, j) => j * lag + span1);
    let j = 0;
    for (let t = block.start_ms; t <= block.end_ms && j < n; t++) {
      const c = Math.max(0, Math.min(1, stateAt(block.tracks, 'number', t, block, { i, n: nums.length }).count));
      while (j < n && c >= need[j] - 1e-9) { out.push(t); j++; }
    }
  });
  return out;
}

/** Cortes de toma (ms) del timeline: cada cambio de `shot_id` entre caras consecutivas, sin el 0. PURO. */
export function shotCuts(timeline) {
  const faces = [...(timeline?.faces ?? [])].sort((a, b) => a.start_ms - b.start_ms);
  const cuts = [];
  for (let k = 1; k < faces.length; k++) if (faces[k].shot_id !== faces[k - 1].shot_id && faces[k].start_ms > 0) cuts.push(faces[k].start_ms);
  return [...new Set(cuts)];
}

/**
 * La hoja de entradas: [{ at_ms, sound, gain_db, cue }] ordenada por tiempo. `preset.cues` es dato:
 *   { block_entry: { by_layer: { hook: {...}, key_title: {...}, cta: {...} }, by_text_preset: { <preset_key>: {...} } },
 *     digit_land: {...}, shot_cut: {...} }
 * donde cada {...} es { sound, gain_db?, offset_ms?, min_gap_ms? }. Una función sin entrada en el preset no suena. PURO.
 */
export function soundCues(scene, timeline, preset) {
  const cues = [];
  const push = (at, c, cue) => { if (c?.sound) cues.push({ at_ms: Math.max(0, Math.round(at + num(c.offset_ms, 0))), sound: c.sound, gain_db: num(c.gain_db, -18), cue }); };
  const entry = preset?.cues?.block_entry ?? {};
  for (const b of scene.blocks) {
    const c = entry.by_text_preset?.[b.preset_key] ?? entry.by_layer?.[b.layer];
    push(b.start_ms, c, `${b.layer}:${b.preset_key}`);
    for (const t of digitLandings(b)) push(t, preset?.cues?.digit_land, `digit:${b.preset_key}`);
  }
  for (const t of shotCuts(timeline)) push(t, preset?.cues?.shot_cut, 'shot_cut');
  cues.sort((a, b) => a.at_ms - b.at_ms || a.sound.localeCompare(b.sound));
  // Dos entradas del mismo sonido más juntas que su `min_gap_ms` se funden en una (evita metralla de tics o roces).
  const gapOf = (s) => {
    const all = [entry.by_layer, entry.by_text_preset].flatMap((m) => Object.values(m ?? {})).concat([preset?.cues?.digit_land, preset?.cues?.shot_cut]);
    return num(all.find((c) => c?.sound === s)?.min_gap_ms, 60);
  };
  const last = {};
  return cues.filter((c) => {
    if (last[c.sound] != null && c.at_ms - last[c.sound] < gapOf(c.sound)) return false;
    last[c.sound] = c.at_ms;
    return true;
  });
}

/**
 * Argumentos de ffmpeg (sólo audio) que mezclan la voz del video con la cama y los efectos. `files`: { sonido: ruta }.
 * La voz va entera; la cama se repite, baja con la voz (sidechain) y se recorta a la duración; cada efecto entra con
 * `adelay` en su milisegundo. `amix normalize=0`: el nivel no depende de cuántos sonidos haya. Sale WAV PCM sin
 * normalizar (la sonoridad final se fija en una segunda pasada lineal, `loudnormArgs`). PURO.
 */
export function soundMixArgs({ video, durationS, preset, cues, files, out }) {
  const fmt = 'aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo';
  const args = ['-y', '-loglevel', 'error', '-i', video];
  const f = [];
  let idx = 1;
  const bed = preset?.bed?.sound ? files[preset.bed.sound] : null;
  if (bed) {
    args.push('-stream_loop', '-1', '-i', bed);
    const ratio = Math.max(1, Math.round(num(preset.bed.duck_db, 8) / 1.5));
    f.push(`[0:a]${fmt},asplit=2[voz][sc]`);
    f.push(`[${idx}:a]${fmt},atrim=0:${durationS},volume=${num(preset.bed.gain_db, -26)}dB[cama0]`);
    f.push(`[cama0][sc]sidechaincompress=threshold=0.02:ratio=${ratio}:attack=30:release=${num(preset.bed.release_ms, 500)}[cama]`);
    idx++;
  } else f.push(`[0:a]${fmt}[voz]`);
  const labels = ['[voz]', ...(bed ? ['[cama]'] : [])];
  cues.forEach((c, k) => {
    const path = files[c.sound];
    if (!path) throw new Error(`sonido sin archivo en la librería: ${c.sound}`);
    args.push('-i', path);
    f.push(`[${idx}:a]${fmt},volume=${c.gain_db}dB,adelay=${c.at_ms}|${c.at_ms}[e${k}]`);
    labels.push(`[e${k}]`);
    idx++;
  });
  f.push(`${labels.join('')}amix=inputs=${labels.length}:duration=first:normalize=0,atrim=0:${durationS}[mez]`);
  args.push('-filter_complex', f.join(';'), '-map', '[mez]', '-c:a', 'pcm_s16le', '-ar', '48000', '-ac', '2', out);
  return args;
}

/** Sonoridad final por plataforma (dato): primera pasada mide, segunda aplica en modo lineal. PURO. */
export function loudnormArgs({ input, target, measured = null, out = null }) {
  const I = num(target?.lufs, -14), TP = num(target?.true_peak_db, -1.5), LRA = num(target?.lra, 11);
  if (!measured) return ['-hide_banner', '-i', input, '-af', `loudnorm=I=${I}:TP=${TP}:LRA=${LRA}:print_format=json`, '-f', 'null', '-'];
  const m = measured;
  return ['-y', '-loglevel', 'error', '-i', input, '-af',
    `loudnorm=I=${I}:TP=${TP}:LRA=${LRA}:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`,
    '-ar', '48000', '-c:a', 'pcm_s16le', out];
}
