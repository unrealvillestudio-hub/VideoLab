// VIDEOLAB · ENSAMBLADO — bloque PURO para los productores que entregan un CLIP (generative, avatar).
//
// El clip del proveedor (Veo o HeyGen) pasa por el mismo acabado que el render propio: lienzo exacto, 30 fps,
// capa de texto de ImageLab, subtítulos opcionales, voz y música con su sonoridad y ducking, y la misma
// especificación de salida (plan.mjs · SPEC). Así todas las salidas de VideoLab son iguales para el carril.

import { SPEC, RenderError } from './plan.mjs';

const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);

/**
 * Las imágenes de entrada. Avatar de una persona del registro: la foto de su ficha (`avatar_photo_url`), y sin
 * ella falla nombrándolo, nunca usa otra imagen en silencio. Cualquier otro caso: las del pedido. PURO.
 */
export function sourceImages({ producer, personId, person, prev, lookImageUrl = null }) {
  if (producer === 'avatar' && personId) {
    // La foto de la ficha manda; si la persona sólo tiene gemelo, la imagen del gemelo sirve para colocar el texto.
    const url = person?.avatar_photo_url || lookImageUrl;
    if (!url) throw new RenderError('VIDEOLAB_BAD_REQUEST', `la persona ${personId} no tiene foto de avatar ni gemelo en su ficha (person_blueprints.avatar_photo_url / avatar_look_id)`);
    return [{ url }];
  }
  return [prev?.image, ...(prev?.images ?? [])].filter((x) => x?.url);
}

/**
 * Márgenes sin voz del avatar (dato: `motion.avatar.lead_ms` y `tail_ms`). Con silencio antes y después de la voz,
 * el avatar empieza y termina en reposo (boca cerrada), y la portada sale de ese reposo. Devuelve los márgenes en ms,
 * el filtro de audio que los añade, las palabras desplazadas por `lead` y el segundo de la portada. PURO.
 */
export function avatarMargins({ avatar, words }) {
  const ms = (v) => Math.max(0, Math.min(3000, Math.round(Number(v) || 0)));
  const lead = ms(avatar?.lead_ms), tail = ms(avatar?.tail_ms);
  const filter = lead || tail ? `adelay=${lead}|${lead},apad=pad_dur=${(tail / 1000).toFixed(3)}` : null;
  const shifted = (words ?? []).map((w) => ({ ...w, start_ms: Number(w.start_ms) + lead, end_ms: Number(w.end_ms) + lead }));
  return { lead, tail, filter, words: shifted, posterAtS: lead ? lead / 2000 : null };
}

/** Cuántos clips de Veo hacen falta para cubrir la duración (cada uno dura `clipS`). Tope de 3. PURO. */
export function clipsNeeded(durationS, clipS = 8) {
  return Math.max(1, Math.min(3, Math.ceil(durationS / clipS)));
}

/**
 * Subtítulos ASS desde las palabras de VoiceLab ({text, start_ms, end_ms}), en grupos de hasta `maxWords`
 * palabras. El texto es el de la voz, VERBATIM. Estilo: la familia de la marca (dato) y colores del preset. PURO.
 */
/**
 * Quita de las palabras de la voz las etiquetas de interpretación entre corchetes ([sharp], [frustrated, leaning in]):
 * dirigen la voz y no se pronuncian, así que no van en pantalla. Una etiqueta puede repartirse entre varias palabras. PURO.
 */
export function spokenWords(words) {
  let depth = 0;
  const out = [];
  for (const w of words) {
    let text = '';
    for (const ch of String(w.text)) {
      if (ch === '[') depth++;
      else if (ch === ']') depth = Math.max(0, depth - 1);
      else if (depth === 0) text += ch;
    }
    text = text.trim();
    if (text) out.push({ ...w, text });
  }
  return out;
}

export function buildAss({ words: raw, canvas, style }) {
  const words = Array.isArray(raw) ? spokenWords(raw) : raw;
  if (!Array.isArray(words) || !words.length) throw new RenderError('VIDEOLAB_BAD_REQUEST', 'subtítulos sin palabras de la voz (alignment.words)');
  const maxWords = Math.max(1, num(style.max_words, 4));
  const ts = (ms) => {
    const t = Math.max(0, Math.round(ms / 10));
    const cs = t % 100, s = Math.floor(t / 100) % 60, m = Math.floor(t / 6000) % 60, h = Math.floor(t / 360000);
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
  };
  const assColor = (hex) => {
    const h = String(hex ?? '').replace('#', '');
    if (!/^[0-9a-fA-F]{6}$/.test(h)) throw new RenderError('VIDEOLAB_BAD_REQUEST', `color de subtítulo inválido: ${hex}`);
    return `&H00${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}`.toUpperCase();
  };
  const size = Math.round(canvas.height * num(style.size_pct, 4.2) / 100);
  const marginV = Math.round(canvas.height * num(style.margin_bottom_pct, 14) / 100);
  const lines = [];
  for (let i = 0; i < words.length; i += maxWords) {
    const g = words.slice(i, i + maxWords);
    const text = g.map((w) => String(w.text)).join(' ').replace(/[{}\\]/g, '');
    lines.push(`Dialogue: 0,${ts(g[0].start_ms)},${ts(g[g.length - 1].end_ms)},Sub,,0,0,0,,${text}`);
  }
  return [
    '[Script Info]', 'ScriptType: v4.00+', `PlayResX: ${canvas.width}`, `PlayResY: ${canvas.height}`, 'WrapStyle: 0', '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Sub,${style.font_family},${size},${assColor(style.color)},${assColor(style.color)},${assColor(style.outline_color)},&H00000000,` +
      `${style.bold ? -1 : 0},0,0,0,100,100,0,0,1,${num(style.outline_px, 3)},0,2,60,60,${marginV},1`,
    '', '[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    ...lines, '',
  ].join('\n');
}

/**
 * Plan de ensamblado de un clip. `inputs`: { clips: [ruta…], clipHasVoice, layer, ass, fontsDir, voice, music, out }.
 * Si `clipHasVoice` (avatar), la voz es la pista del propio clip; si no, la de VoiceLab. PURO.
 */
export function planAssemble({ preset, canvas, durationS, inputs }) {
  const clips = inputs.clips ?? [];
  if (!clips.length) throw new RenderError('VIDEOLAB_PROVIDER_FAILED', 'el proveedor no entregó clip');
  const mix = preset.audio_mix ?? {};
  const text = preset.text_treatment ?? {};
  const { width: W, height: H } = canvas;
  const args = ['-y'];
  const f = [];
  let idx = 0;
  const clipIdx = clips.map((p) => { args.push('-i', p); return idx++; });
  const layerIdx = inputs.layer ? (args.push('-loop', '1', '-t', String(durationS), '-i', inputs.layer), idx++) : null;
  const voiceIdx = !inputs.clipHasVoice && inputs.voice ? (args.push('-i', inputs.voice.path), idx++) : null;
  const musicIdx = inputs.music ? (args.push('-stream_loop', '-1', '-i', inputs.music.path), idx++) : null;

  const norm = (i) => `[${i}:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,fps=${SPEC.fps},format=yuv420p`;
  if (clipIdx.length === 1) f.push(`${norm(clipIdx[0])}[cat]`);
  else {
    clipIdx.forEach((i) => f.push(`${norm(i)}[c${i}]`));
    f.push(`${clipIdx.map((i) => `[c${i}]`).join('')}concat=n=${clipIdx.length}:v=1:a=0[cat]`);
  }
  // El clip cubre la duración: si es más corto, se sostiene el último fotograma; si es más largo, se recorta.
  f.push(`[cat]tpad=stop_mode=clone:stop_duration=${durationS},trim=0:${durationS},setpts=PTS-STARTPTS[base]`);
  let v = 'base';
  if (layerIdx != null) {
    const fadeIn = text.entry === 'fade' ? `,fade=t=in:st=0.3:d=0.4:alpha=1` : '';
    f.push(`[${layerIdx}:v]scale=${W}:${H},format=rgba${fadeIn}[txt]`);
    f.push(`[${v}][txt]overlay=0:0:format=auto[vt]`);
    v = 'vt';
  }
  if (inputs.ass) {
    const esc = (p) => String(p).replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
    f.push(`[${v}]subtitles='${esc(inputs.ass)}'${inputs.fontsDir ? `:fontsdir='${esc(inputs.fontsDir)}'` : ''}[vs]`);
    v = 'vs';
  }
  f.push(`[${v}]format=yuv420p[vout]`);

  const fmt = `aformat=sample_rates=${SPEC.audioRate}:channel_layouts=stereo`;
  const fadeOut = `afade=t=out:st=${Math.max(durationS - 0.6, 0)}:d=0.6`;
  const voiceSrc = inputs.clipHasVoice ? `${clipIdx[0]}:a` : voiceIdx != null ? `${voiceIdx}:a` : null;
  if (voiceSrc && musicIdx != null) {
    const ratio = Math.max(1, Math.round(num(mix.ducking_db, 10) / 1.5));
    f.push(`[${voiceSrc}]${fmt},loudnorm=I=${num(mix.voice_lufs, -16)}:TP=-1.5:LRA=11,asplit=2[vz][sc]`);
    f.push(`[${musicIdx}:a]${fmt},loudnorm=I=${num(mix.music_lufs, -28)}:TP=-2:LRA=11[mz]`);
    f.push(`[mz][sc]sidechaincompress=threshold=0.03:ratio=${ratio}:attack=20:release=${num(mix.fade_ms, 400)}[md]`);
    f.push(`[vz][md]amix=inputs=2:duration=first:normalize=0,apad,atrim=0:${durationS},${fadeOut}[aout]`);
  } else if (voiceSrc) {
    f.push(`[${voiceSrc}]${fmt},loudnorm=I=${num(mix.voice_lufs, -16)}:TP=-1.5:LRA=11,apad,atrim=0:${durationS},${fadeOut}[aout]`);
  } else if (musicIdx != null) {
    f.push(`[${musicIdx}:a]${fmt},loudnorm=I=${num(mix.music_lufs, -28)}:TP=-2:LRA=11,atrim=0:${durationS},${fadeOut}[aout]`);
  } else {
    f.push(`anullsrc=channel_layout=stereo:sample_rate=${SPEC.audioRate},atrim=0:${durationS}[aout]`);
  }

  args.push('-filter_complex', f.join(';'), '-map', '[vout]', '-map', '[aout]',
    '-c:v', SPEC.videoCodec, '-profile:v', 'high', '-pix_fmt', SPEC.pixelFormat, '-r', String(SPEC.fps),
    '-preset', 'medium', '-crf', '20',
    '-c:a', SPEC.audioCodec, '-b:a', SPEC.audioBitrate, '-ar', String(SPEC.audioRate), '-ac', '2',
    '-t', String(durationS), '-movflags', '+faststart', inputs.out);
  return { args };
}

// ── Cuerpos de petición a los proveedores (PUROS: la forma de la API vive aquí y se prueba sin red) ──

/** Vertex AI · Veo image-to-video (predictLongRunning). Sin storageUri: el video vuelve en la respuesta. */
export function veoRequestBody({ prompt, imageB64, mimeType = 'image/png', aspectRatio = '9:16', durationS = 8, seed }) {
  if (!prompt || !String(prompt).trim()) throw new RenderError('VIDEOLAB_BAD_REQUEST', 'el productor generative necesita previousOutputs.video_prompt');
  return {
    instances: [{ prompt: String(prompt), image: { bytesBase64Encoded: imageB64, mimeType } }],
    parameters: { aspectRatio, durationSeconds: durationS, sampleCount: 1, resizeMode: 'crop', generateAudio: false,
      personGeneration: 'allow_adult', ...(seed != null ? { seed } : {}) },
  };
}

/** De la operación terminada de Veo, los videos (bytes o URI de GCS). Falla nombrando el filtro de contenido. PURO. */
export function veoVideosFrom(op) {
  if (op?.error) throw new RenderError('VIDEOLAB_PROVIDER_FAILED', `Veo: ${op.error.message ?? JSON.stringify(op.error)}`.slice(0, 400));
  const r = op?.response ?? {};
  const vids = (r.videos ?? []).map((v) => ({ b64: v.bytesBase64Encoded ?? null, gcsUri: v.gcsUri ?? null }))
    .filter((v) => v.b64 || v.gcsUri);
  if (!vids.length) {
    throw new RenderError('VIDEOLAB_PROVIDER_FAILED', `Veo no devolvió video (filtrados: ${r.raiMediaFilteredCount ?? 0})`);
  }
  return vids;
}

const EXPRESSIVENESS = ['high', 'medium', 'low'];

/** Generador pseudoaleatorio determinista (mulberry32) a partir de un texto. PURO. */
function seeded(text) {
  let h = 2166136261;
  for (const ch of String(text)) h = Math.imul(h ^ ch.codePointAt(0), 16777619);
  return () => {
    h = (h + 0x6D2B79F5) | 0;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Dirección del avatar de un video. Si el preset trae `picks` ({categoría: n}), elige n acciones de cada categoría
 * del catálogo (`videolab_avatar_direction`: las del sistema y las de la marca) con una semilla por job, así cada
 * video rota; el motion_prompt es `base` + las acciones elegidas. Sin `picks`, devuelve la dirección tal cual.
 * Una categoría pedida sin acciones en el catálogo falla nombrándola. PURO.
 */
export function composeAvatarDirection({ avatar, catalog, seed }) {
  if (!avatar) return null;
  if (!avatar.picks) return { expressiveness: avatar.expressiveness, motion_prompt: avatar.motion_prompt, picked: [] };
  const rnd = seeded(seed);
  const picked = [];
  const sentences = [];
  const lowerFirst = (t) => t.charAt(0).toLowerCase() + t.slice(1);
  for (const [category, spec] of Object.entries(avatar.picks)) {
    // `spec` es un número (cuántas) o { n, timing: [momento…], between }: cada acción se ancla a su momento
    // («At the start of the video», «Near the end»…) y `between` dice qué pasa fuera de esos momentos.
    const cfg = typeof spec === 'object' && spec !== null ? spec : { n: spec };
    const timing = Array.isArray(cfg.timing) ? cfg.timing : [];
    const k = Math.max(0, Math.floor(Number(cfg.n ?? timing.length) || 0));
    if (!k) continue;
    const pool = (catalog ?? []).filter((r) => r.category === category && r.active !== false && String(r.text ?? '').trim());
    if (!pool.length) throw new RenderError('VIDEOLAB_BAD_REQUEST', `el catálogo de dirección del avatar no tiene acciones de «${category}»`);
    if (timing.length && timing.length < k) throw new RenderError('VIDEOLAB_BAD_REQUEST', `motion.avatar.picks.${category}: ${k} acciones y ${timing.length} momentos`);
    const bag = [...pool];
    for (let i = bag.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [bag[i], bag[j]] = [bag[j], bag[i]]; }
    const chosen = bag.slice(0, Math.min(k, bag.length));
    picked.push(...chosen);
    chosen.forEach((r, i) => {
      const t = String(r.text).trim();
      sentences.push(timing[i] ? `${String(timing[i]).trim()}, ${lowerFirst(t)}` : t);
    });
    if (cfg.between && String(cfg.between).trim()) sentences.push(String(cfg.between).trim());
  }
  const motion_prompt = [String(avatar.base ?? '').trim(), ...sentences].filter(Boolean).join(' ');
  return { expressiveness: avatar.expressiveness, motion_prompt, picked: picked.map((r) => r.id) };
}

/**
 * Motores de HeyGen y lo que cada uno admite (documentación de HeyGen, «Audio to Video», medida el 2026-11-11). Son
 * capacidades del PROVEEDOR, no de una marca: `motion_prompt` va con Avatar V y Avatar 6 en cualquier look, y con
 * Avatar IV sólo en un look de foto; `expressiveness` sólo con Avatar IV en una foto.
 */
const DEFAULT_ENGINE = 'avatar_iv';
const MOTION_PROMPT_ENGINES = ['avatar_v', 'heygen-avatar-6', 'heygen-avatar-6-turbo'];

/**
 * Qué anima HeyGen y a qué tarifa. Con un look (gemelo, avatar de estudio o de foto) se valida el motor contra los que
 * el propio look declara (`supported_api_engines`); sin look, se anima la imagen, que sólo admite Avatar IV. El
 * `rateModelId` es la fila de `ops_lab_rates`: el motor, más el tipo de look cuando no es una foto. PURO.
 */
export function avatarSubject({ lookId = null, look = null, engine = null, photoModelId }) {
  if (lookId) {
    if (!look || look.id !== lookId) throw new RenderError('VIDEOLAB_PROVIDER_FAILED', `HeyGen no devolvió el look ${lookId}`);
    if (look.status !== 'completed') throw new RenderError('VIDEOLAB_BAD_REQUEST', `el look ${lookId} no está listo en HeyGen (status ${look.status})`);
    const e = engine ?? DEFAULT_ENGINE;
    const engines = look.supported_api_engines ?? [];
    if (!engines.includes(e)) throw new RenderError('VIDEOLAB_BAD_REQUEST', `el look ${lookId} no admite el motor ${e} (admite: ${engines.join(', ') || 'ninguno'})`);
    const type = String(look.avatar_type ?? 'photo_avatar');
    const rateModelId = e.replace(/_/g, '-') + (type === 'photo_avatar' ? '' : `-${type.replace(/_/g, '-')}`);
    return { mode: 'look', lookId, engine: e, avatarType: type, rateModelId, lookImageUrl: look.preview_image_url ?? null };
  }
  if (engine && engine !== DEFAULT_ENGINE) throw new RenderError('VIDEOLAB_BAD_REQUEST', `el motor ${engine} necesita un look de HeyGen (person_blueprints.avatar_look_id); una imagen sólo se anima con ${DEFAULT_ENGINE}`);
  return { mode: 'image', lookId: null, engine: DEFAULT_ENGINE, avatarType: 'photo_avatar', rateModelId: photoModelId, lookImageUrl: null };
}

/**
 * HeyGen · POST /v3/videos con audio propio: una imagen (`type: image`, Avatar IV) o un look (`type: avatar`, motor de
 * `subject`). `direction` es dato del preset (`videolab_params.motion.avatar`): `expressiveness` (high | medium | low;
 * HeyGen usa `low` si falta) y `motion_prompt`; cada uno se envía sólo al motor que lo admite. Sin `subject` ni
 * dirección, el cuerpo es el de siempre. PURO.
 */
export function heygenRequestBody({ imageUrl, audioUrl, title, direction, subject = null }) {
  if (!audioUrl) throw new RenderError('VIDEOLAB_BAD_REQUEST', 'el productor avatar necesita la voz de VoiceLab (previousOutputs.voice.audio_url)');
  const isLook = subject?.mode === 'look';
  if (!isLook && !imageUrl) throw new RenderError('VIDEOLAB_BAD_REQUEST', 'el productor avatar necesita la imagen de la persona');
  const d = direction ?? {};
  if (d.expressiveness != null && !EXPRESSIVENESS.includes(d.expressiveness)) {
    throw new RenderError('VIDEOLAB_BAD_REQUEST', `motion.avatar.expressiveness inválido: ${d.expressiveness}`);
  }
  const engine = isLook ? subject.engine : DEFAULT_ENGINE;
  const photo = !isLook || subject.avatarType === 'photo_avatar';
  const motionPrompt = typeof d.motion_prompt === 'string' ? d.motion_prompt.trim() : '';
  const allowsMotion = MOTION_PROMPT_ENGINES.includes(engine) || (engine === DEFAULT_ENGINE && photo);
  const allowsExpr = engine === DEFAULT_ENGINE && photo;
  const who = isLook
    ? { type: 'avatar', avatar_id: subject.lookId, ...(engine === DEFAULT_ENGINE ? {} : { engine: { type: engine } }) }
    : { type: 'image', image: { type: 'url', url: imageUrl } };
  return {
    ...who, audio_url: audioUrl,
    aspect_ratio: '9:16', resolution: '1080p', fit: 'cover', ...(title ? { title } : {}),
    ...(allowsExpr && d.expressiveness ? { expressiveness: d.expressiveness } : {}),
    ...(allowsMotion && motionPrompt ? { motion_prompt: motionPrompt } : {}),
  };
}

/** Estado de HeyGen → 'pending' | 'completed' | 'failed', con la URL o el motivo. PURO. */
export function heygenStatus(data) {
  const s = String(data?.status ?? '');
  if (s === 'completed') {
    if (!data.video_url) throw new RenderError('VIDEOLAB_PROVIDER_FAILED', 'HeyGen completó sin video_url');
    return { state: 'completed', url: data.video_url, durationS: Number(data.duration ?? 0) || null };
  }
  if (s === 'failed') return { state: 'failed', reason: data.failure_message ?? data.error?.message ?? 'sin motivo' };
  return { state: 'pending' };
}
