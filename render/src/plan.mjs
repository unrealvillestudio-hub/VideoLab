// VIDEOLAB · RENDER PROPIO — bloque PURO: dato → plan de render.
//
// Qué hace: resuelve el preset de la marca (o el del sistema) y arma, sin red ni disco, los argumentos de ffmpeg
// que convierten imagen(es) + capa de texto + voz + música en el MP4 del contrato (docs/CONTRACT.md §5).
// Todo lo que distingue a una marca llega como DATO (`videolab_params`): aquí no hay ninguna marca, ninguna
// fuente y ningún color. La capa de texto la dibuja ImageLab (`/api/compose`, `output: 'text_layer'`).
//
// Determinista: la misma entrada da los mismos argumentos, carácter por carácter (lo prueba tests/render_plan_test.mjs).

export const SPEC = Object.freeze({
  fps: 30,
  videoCodec: 'libx264',
  pixelFormat: 'yuv420p',
  audioCodec: 'aac',
  audioRate: 48000,
  audioBitrate: '128k',
  maxDurationS: 60,
  maxBytes: 52428800,
});

export const RENDER_STYLES = Object.freeze(['product_showcase', 'before_after']);

export class RenderError extends Error {
  constructor(label, message) { super(message); this.label = label; }
}

/**
 * La fila que manda para (marca, estilo): la de la marca si existe (su `active` decide), si no la del sistema
 * (brand_id NULL). Sin ninguna activa ⇒ VIDEOLAB_STYLE_NOT_DECLARED. PURO.
 */
export function resolvePreset(rows, brandId, videoStyle, format = 'reel') {
  const delEstilo = (rows ?? []).filter((r) => r.format === format && r.video_style === videoStyle);
  const deMarca = delEstilo.find((r) => r.brand_id === brandId);
  const elegida = deMarca ?? delEstilo.find((r) => r.brand_id == null);
  if (!elegida || elegida.active === false) {
    throw new RenderError('VIDEOLAB_STYLE_NOT_DECLARED',
      `no hay preset activo de ${format}/${videoStyle} para la marca ni por defecto`);
  }
  return { ...elegida, source: deMarca ? 'brand' : 'system' };
}

/** Duración del video: la de la voz más una cola, o la del preset si no hay voz; nunca más que el máximo. PURO. */
export function renderDurationS({ preset, voiceMs, tailMs = 800 }) {
  const base = voiceMs != null ? (voiceMs + tailMs) / 1000 : Number(preset.duration_sec ?? 0);
  if (!(base > 0)) throw new RenderError('VIDEOLAB_BAD_REQUEST', 'sin voz y sin duración en el preset');
  return Math.min(Math.round(base * 1000) / 1000, SPEC.maxDurationS);
}

const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);

/** Filtro de movimiento de una imagen: cubre el lienzo al doble (para que el zoom no pixele) y empuja. PURO. */
export function motionFilter({ input, label, motion, canvas, frames }) {
  const { width: W, height: H } = canvas;
  const zf = num(motion?.zoom_from, 1);
  const zt = num(motion?.zoom_to, 1);
  const dz = Math.round(((zt - zf) / Math.max(frames - 1, 1)) * 1e6) / 1e6;
  return `[${input}:v]scale=${W * 2}:${H * 2}:force_original_aspect_ratio=increase,crop=${W * 2}:${H * 2},setsar=1,` +
    `zoompan=z='${zf}+${dz}*on':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${W}x${H}:fps=${SPEC.fps},` +
    `format=yuv420p[${label}]`;
}

/**
 * El plan completo. `inputs`: { images: [ruta…], layer: ruta|null, voice: {path, ms}|null, music: {path}|null, out }.
 * Devuelve { args, durationS }. PURO: no toca el disco.
 */
export function planRender({ preset, canvas, inputs }) {
  const style = preset.video_style;
  if (!RENDER_STYLES.includes(style)) {
    throw new RenderError('VIDEOLAB_PRODUCER_NOT_ACTIVE', `el render propio no fabrica ${style}`);
  }
  const imgs = inputs.images ?? [];
  const need = style === 'before_after' ? 2 : 1;
  if (imgs.length < need) throw new RenderError('VIDEOLAB_BAD_REQUEST', `${style} necesita ${need} imagen(es); llegaron ${imgs.length}`);

  const durationS = renderDurationS({ preset, voiceMs: inputs.voice?.ms ?? null });
  const frames = Math.round(durationS * SPEC.fps);
  const motion = preset.motion ?? {};
  const mix = preset.audio_mix ?? {};
  const text = preset.text_treatment ?? {};

  const args = ['-y'];
  const filters = [];
  let idx = 0;
  const imageIdx = imgs.slice(0, need).map((p) => { args.push('-loop', '1', '-t', String(durationS), '-i', p); return idx++; });
  const layerIdx = inputs.layer ? (args.push('-loop', '1', '-t', String(durationS), '-i', inputs.layer), idx++) : null;
  const voiceIdx = inputs.voice ? (args.push('-i', inputs.voice.path), idx++) : null;
  const musicIdx = inputs.music ? (args.push('-stream_loop', '-1', '-i', inputs.music.path), idx++) : null;
  const silenceIdx = voiceIdx == null && musicIdx == null
    ? (args.push('-f', 'lavfi', '-t', String(durationS), '-i', `anullsrc=channel_layout=stereo:sample_rate=${SPEC.audioRate}`), idx++)
    : null;

  // VIDEO
  if (style === 'before_after') {
    const half = Math.round((durationS / 2) * 1000) / 1000;
    const trans = 0.6;
    const halfFrames = Math.round((half + trans) * SPEC.fps);
    filters.push(motionFilter({ input: imageIdx[0], label: 'a0', motion, canvas, frames: halfFrames }));
    filters.push(motionFilter({ input: imageIdx[1], label: 'a1', motion, canvas, frames: halfFrames }));
    filters.push(`[a0][a1]xfade=transition=wipeleft:duration=${trans}:offset=${Math.max(half - trans / 2, 0)}[base]`);
  } else {
    filters.push(motionFilter({ input: imageIdx[0], label: 'base', motion, canvas, frames }));
  }
  if (layerIdx != null) {
    const fadeIn = text.entry === 'fade' ? `,fade=t=in:st=0.3:d=0.4:alpha=1` : '';
    filters.push(`[${layerIdx}:v]scale=${canvas.width}:${canvas.height},format=rgba${fadeIn}[txt]`);
    filters.push(`[base][txt]overlay=0:0:format=auto,format=yuv420p[vout]`);
  } else {
    filters.push(`[base]null[vout]`);
  }

  // AUDIO — voz y música a su sonoridad de marca; la música baja cuando habla la voz (ducking).
  const fadeOut = `afade=t=out:st=${Math.max(durationS - 0.6, 0)}:d=0.6`;
  const fmt = `aformat=sample_rates=${SPEC.audioRate}:channel_layouts=stereo`;
  if (voiceIdx != null && musicIdx != null) {
    const ratio = Math.max(1, Math.round(num(mix.ducking_db, 10) / 1.5));
    filters.push(`[${voiceIdx}:a]${fmt},loudnorm=I=${num(mix.voice_lufs, -16)}:TP=-1.5:LRA=11,asplit=2[vz][sc]`);
    filters.push(`[${musicIdx}:a]${fmt},loudnorm=I=${num(mix.music_lufs, -28)}:TP=-2:LRA=11[mz]`);
    filters.push(`[mz][sc]sidechaincompress=threshold=0.03:ratio=${ratio}:attack=20:release=${num(mix.fade_ms, 400)}[md]`);
    filters.push(`[vz][md]amix=inputs=2:duration=first:normalize=0,apad,atrim=0:${durationS},${fadeOut}[aout]`);
  } else if (voiceIdx != null) {
    filters.push(`[${voiceIdx}:a]${fmt},loudnorm=I=${num(mix.voice_lufs, -16)}:TP=-1.5:LRA=11,apad,atrim=0:${durationS},${fadeOut}[aout]`);
  } else if (musicIdx != null) {
    filters.push(`[${musicIdx}:a]${fmt},loudnorm=I=${num(mix.music_lufs, -28)}:TP=-2:LRA=11,atrim=0:${durationS},${fadeOut}[aout]`);
  } else {
    filters.push(`[${silenceIdx}:a]${fmt}[aout]`);
  }

  args.push('-filter_complex', filters.join(';'), '-map', '[vout]', '-map', '[aout]',
    '-c:v', SPEC.videoCodec, '-profile:v', 'high', '-pix_fmt', SPEC.pixelFormat, '-r', String(SPEC.fps),
    '-preset', 'medium', '-crf', '20',
    '-c:a', SPEC.audioCodec, '-b:a', SPEC.audioBitrate, '-ar', String(SPEC.audioRate), '-ac', '2',
    '-t', String(durationS), '-movflags', '+faststart', inputs.out);
  return { args, durationS };
}

/** Comprueba el MP4 contra el contrato a partir de la salida JSON de ffprobe. Devuelve la lista de fallas. PURO. */
export function validateOutput(probe, canvas, bytes) {
  const fallas = [];
  const v = (probe?.streams ?? []).find((s) => s.codec_type === 'video');
  const a = (probe?.streams ?? []).find((s) => s.codec_type === 'audio');
  if (!v) fallas.push('sin pista de video');
  else {
    if (v.codec_name !== 'h264') fallas.push(`códec ${v.codec_name}`);
    if (v.width !== canvas.width || v.height !== canvas.height) fallas.push(`lienzo ${v.width}x${v.height}`);
    if (v.pix_fmt !== SPEC.pixelFormat) fallas.push(`pix_fmt ${v.pix_fmt}`);
    const [n, d] = String(v.r_frame_rate ?? '0/1').split('/').map(Number);
    if (Math.round(n / (d || 1)) !== SPEC.fps) fallas.push(`fps ${v.r_frame_rate}`);
  }
  if (!a) fallas.push('sin pista de audio');
  else {
    if (a.codec_name !== 'aac') fallas.push(`audio ${a.codec_name}`);
    if (Number(a.sample_rate) !== SPEC.audioRate) fallas.push(`sample_rate ${a.sample_rate}`);
  }
  const dur = Number(probe?.format?.duration ?? 0);
  if (!(dur > 0) || dur > SPEC.maxDurationS + 0.5) fallas.push(`duración ${dur}`);
  if (bytes > SPEC.maxBytes) fallas.push(`tamaño ${bytes}`);
  return fallas;
}

/**
 * El texto de la capa a partir de `on_screen_text`, VERBATIM: el primer `headline` por orden es el titular y el
 * primer `subheadline` la bajada. `cta` no tiene ranura en el compositor de hoy y se devuelve aparte, sin
 * inventar dónde va. PURO.
 */
export function overlayTextFrom(onScreen) {
  const items = [...(onScreen ?? [])].sort((a, b) => Number(a.order) - Number(b.order));
  const pick = (role) => items.find((t) => t.role === role) ?? null;
  const h = pick('headline');
  const s = pick('subheadline');
  return {
    headline: h ? String(h.text) : null,
    subheadline: s ? String(s.text) : null,
    emphasis: h?.emphasis ?? [],
    unplaced: items.filter((t) => t !== h && t !== s).map((t) => ({ order: t.order, role: t.role })),
  };
}

/** El lienzo: el del perfil del formato (dato). Si el pedido trae uno distinto ⇒ VIDEOLAB_CANVAS_MISMATCH. PURO. */
export function resolveCanvas(requested, profile) {
  const fromProfile = profile && profile.canvas_width && profile.canvas_height
    ? { width: Number(profile.canvas_width), height: Number(profile.canvas_height) } : null;
  if (!fromProfile) throw new RenderError('VIDEOLAB_BAD_REQUEST', 'la plataforma no tiene perfil de formato reel con lienzo');
  if (requested && (Number(requested.width) !== fromProfile.width || Number(requested.height) !== fromProfile.height)) {
    throw new RenderError('VIDEOLAB_CANVAS_MISMATCH',
      `lienzo pedido ${requested.width}x${requested.height} ≠ perfil ${fromProfile.width}x${fromProfile.height}`);
  }
  return fromProfile;
}
