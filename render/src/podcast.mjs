// VIDEOLAB · ESTILO `podcast` (contrato v1.1.0, §4 bis) — bloque PURO.
//
// Un episodio son TURNOS: cada turno es la voz de una silla del estudio y sus CORTES, cada corte una toma del catálogo
// del estudio (`location_blueprints.raw_config.shot_catalog`). La toma es una imagen del episodio, generada una vez por
// ImageLab con las personas dentro. Regla aprobada por Sam (2026-11-11): se anima SÓLO a quien habla y SÓLO en una
// toma donde está sola en cuadro (la toma declara `animate` = su silla). Cualquier otro corte es una imagen fija con un
// acercamiento lento: nadie que escucha se anima, y no hay máscaras.
//
// Todo lo que distingue a un estudio o a una marca es dato: sillas, tomas, qué silla anima cada toma, el elenco
// (`params.cast`, silla → persona) y el motor (`turn.engine`, si no `motion.avatar.engine` del preset).
import { RenderError } from './plan.mjs';

const bad = (m) => { throw new RenderError('VIDEOLAB_BAD_REQUEST', m); };
const str = (v) => typeof v === 'string' && v.trim().length > 0;

/** Motores de HeyGen que animan una IMAGEN: por qué API van y con qué fila de `ops_lab_rates` se cobran. */
export const IMAGE_ENGINES = Object.freeze({
  avatar_iv: { api: 'videos', rateModelId: 'avatar-iv' },
  'heygen-avatar-6': { api: 'models', rateModelId: 'heygen-avatar-6' },
  'heygen-avatar-6-turbo': { api: 'models', rateModelId: 'heygen-avatar-6-turbo' },
});

export function imageEngine(engine) {
  const e = IMAGE_ENGINES[engine ?? 'avatar_iv'];
  if (!e) bad(`motor de podcast desconocido: ${engine} (admite: ${Object.keys(IMAGE_ENGINES).join(', ')})`);
  return { engine: engine ?? 'avatar_iv', ...e };
}

/** El catálogo de tomas del estudio, por id. Una toma sin id no se usa. */
export function catalogById(raw) {
  const m = new Map();
  for (const s of Array.isArray(raw) ? raw : []) if (str(s?.id)) m.set(s.id, s);
  return m;
}

/**
 * El plan del episodio: segmentos en orden, cada uno con su turno, su toma, su tramo de audio y si se anima.
 * Valida contra el dato del estudio y el elenco; cualquier incoherencia es VIDEOLAB_BAD_REQUEST antes de gastar.
 */
export function planPodcast({ catalog, shots, turns, cast, defaultEngine = null }) {
  if (!(catalog instanceof Map) || !catalog.size) bad('el estudio no declara shot_catalog');
  if (!cast || typeof cast !== 'object') bad('falta params.cast (silla → persona)');
  if (!Array.isArray(turns) || !turns.length) bad('previousOutputs.turns está vacío');
  const shotUrl = new Map();
  for (const s of Array.isArray(shots) ? shots : []) {
    if (!str(s?.shot_id) || !str(s?.url)) bad('previousOutputs.shots necesita shot_id y url');
    if (!catalog.has(s.shot_id)) bad(`la toma ${s.shot_id} no está en el catálogo del estudio`);
    shotUrl.set(s.shot_id, { url: s.url, focus_x: Number.isFinite(Number(s.focus_x)) ? Math.min(1, Math.max(0, Number(s.focus_x))) : 0.5 });
  }
  const segments = [];
  let offset = 0;
  turns.forEach((t, ti) => {
    if (!str(t?.seat) || !str(cast[t.seat])) bad(`turns[${ti}]: la silla ${t?.seat} no tiene persona en params.cast`);
    if (!str(t?.voice?.audio_url)) bad(`turns[${ti}] necesita voice.audio_url`);
    const ms = Number(t.voice.duration_ms);
    if (!(ms > 0)) bad(`turns[${ti}] necesita voice.duration_ms`);
    const cuts = Array.isArray(t.cuts) ? t.cuts : [];
    if (!cuts.length) bad(`turns[${ti}] no trae cortes`);
    if (Number(cuts[0].at_ms) !== 0) bad(`turns[${ti}]: el primer corte empieza en at_ms 0`);
    const engine = imageEngine(t.engine ?? defaultEngine);
    let animated = 0;
    cuts.forEach((c, ci) => {
      const from = Number(c.at_ms);
      const to = ci + 1 < cuts.length ? Number(cuts[ci + 1].at_ms) : ms;
      if (!(to > from) || from < 0 || to > ms) bad(`turns[${ti}].cuts[${ci}]: tramo inválido ${from}–${to} ms`);
      const shot = catalog.get(c.shot_id);
      if (!shot) bad(`turns[${ti}].cuts[${ci}]: la toma ${c.shot_id} no está en el catálogo`);
      const img = shotUrl.get(c.shot_id);
      if (!img) bad(`turns[${ti}].cuts[${ci}]: falta la imagen de la toma ${c.shot_id} en previousOutputs.shots`);
      const animate = shot.animate === t.seat;
      if (animate) animated += 1;
      segments.push({ turn: ti, seat: t.seat, person: cast[t.seat], shot_id: c.shot_id, from_ms: from, to_ms: to,
        start_ms: offset + from, mode: animate ? 'animate' : 'still', image_url: img.url, focus_x: img.focus_x,
        aspect: shot.aspect ?? '9:16', engine });
    });
    if (!animated) bad(`turns[${ti}]: ningún corte usa una toma que anime la silla ${t.seat} (quien habla debe verse hablar)`);
    offset += ms;
  });
  return { segments, totalMs: offset, speakers: [...new Set(turns.map((t) => cast[t.seat]))] };
}

/** Segundos que HeyGen va a cobrar, por fila de tarifa (para el tope y el asiento). PURO. */
export function animatedSecondsByRate(segments) {
  const m = {};
  for (const s of segments) if (s.mode === 'animate') m[s.engine.rateModelId] = (m[s.engine.rateModelId] ?? 0) + (s.to_ms - s.from_ms) / 1000;
  return m;
}

/** Cuerpo de HeyGen para animar una imagen con un tramo de audio, según la API del motor. PURO. */
export function podcastHeygenBody({ engine, imageUrl, audioUrl, title, direction = {} }) {
  const mp = str(direction.motion_prompt) ? direction.motion_prompt.trim() : null;
  if (engine.api === 'models') {
    return { model: engine.engine, reference_images: [{ type: 'url', url: imageUrl }], audio: { type: 'url', url: audioUrl },
      resolution: '1080p', motion_expressiveness: direction.motion_expressiveness === 'less' ? 'less' : 'default',
      ...(mp ? { motion_prompt: mp } : {}) };
  }
  return { type: 'image', image: { type: 'url', url: imageUrl }, audio_url: audioUrl, aspect_ratio: '9:16', resolution: '1080p',
    fit: 'cover', ...(title ? { title } : {}), ...(direction.expressiveness ? { expressiveness: direction.expressiveness } : {}),
    ...(mp ? { motion_prompt: mp } : {}) };
}

/** Filtro de ffmpeg que lleva una imagen o un clip al lienzo (cubre, con el foco horizontal de la toma). PURO. */
export function coverFilter(canvas, focusX = 0.5) {
  const { width: W, height: H } = canvas;
  return `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}:(iw-${W})*${focusX}:(ih-${H})/2,setsar=1,fps=30`;
}

/** Argumentos de ffmpeg de un corte FIJO: la imagen con un acercamiento lento, del largo exacto del tramo. PURO. */
export function stillArgs({ image, seconds, canvas, focusX = 0.5, zoomPerFrame = 0.0006, out }) {
  const { width: W, height: H } = canvas;
  const big = `scale=${Math.round(W * 1.1)}:${Math.round(H * 1.1)}:force_original_aspect_ratio=increase,crop=${Math.round(W * 1.1)}:${Math.round(H * 1.1)}:(iw-${Math.round(W * 1.1)})*${focusX}:(ih-${Math.round(H * 1.1)})/2`;
  return ['-y', '-framerate', '30', '-loop', '1', '-t', seconds.toFixed(3), '-i', image, '-vf',
    `${big},zoompan=z='1+${zoomPerFrame}*on':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${W}x${H}:fps=30,setsar=1`,
    '-t', seconds.toFixed(3), '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-r', '30', out];
}

/** Argumentos de ffmpeg de un corte ANIMADO: el clip de HeyGen al lienzo, recortado al tramo. PURO. */
export function clipArgs({ clip, seconds, canvas, focusX = 0.5, out }) {
  // HeyGen puede devolver el clip ~0,1 s más corto que el audio: se sostiene el último cuadro hasta el tramo exacto.
  return ['-y', '-i', clip, '-vf', `${coverFilter(canvas, focusX)},tpad=stop_mode=clone:stop_duration=1`, '-t', seconds.toFixed(3), '-an',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-r', '30', out];
}
