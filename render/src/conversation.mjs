// VIDEOLAB · ESTILO `conversation` (contrato v1.1.0, §4 bis) — bloque PURO.
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
  if (!e) bad(`motor de conversación desconocido: ${engine} (admite: ${Object.keys(IMAGE_ENGINES).join(', ')})`);
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
export function planConversation({ catalog, shots, turns, cast, defaultEngine = null, technique = null }) {
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
    // Sin cortes en el pedido, los arma la técnica (v1.2.0).
    const cuts = Array.isArray(t.cuts) && t.cuts.length ? t.cuts
      : (technique ? cutsFromTechnique({ technique, catalog, shots, seat: t.seat, cast, durationMs: ms }) : []);
    if (!cuts.length) bad(`turns[${ti}] no trae cortes y el pedido no nombra una técnica`);
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
        aspect: shot.aspect ?? '9:16', engine, move: animate ? (technique?.moves?.speaker ?? null) : null });
    });
    if (!animated) bad(`turns[${ti}]: ningún corte usa una toma que anime la silla ${t.seat} (quien habla debe verse hablar)`);
    offset += ms;
  });
  return { segments, totalMs: offset, speakers: [...new Set(turns.map((t) => cast[t.seat]))], technique_id: technique?.technique_id ?? null };
}

/** Segundos que HeyGen va a cobrar, por fila de tarifa (para el tope y el asiento). PURO. */
export function animatedSecondsByRate(segments) {
  const m = {};
  for (const s of segments) if (s.mode === 'animate') m[s.engine.rateModelId] = (m[s.engine.rateModelId] ?? 0) + (s.to_ms - s.from_ms) / 1000;
  return m;
}

/** Cuerpo de HeyGen para animar una imagen con un tramo de audio, según la API del motor. PURO. */
export function conversationHeygenBody({ engine, imageUrl, audioUrl, title, direction = {} }) {
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
export function clipArgs({ clip, seconds, canvas, focusX = 0.5, move = null, out }) {
  // HeyGen puede devolver el clip ~0,1 s más corto que el audio: se sostiene el último cuadro hasta el tramo exacto.
  return ['-y', '-i', clip, '-vf', `${coverFilter(canvas, focusX)},tpad=stop_mode=clone:stop_duration=1${move ? `,${speakerMoveFilter(move, canvas)}` : ''}`, '-t', seconds.toFixed(3), '-an',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-r', '30', out];
}

// ── TÉCNICAS DE ESCENA (contrato v1.2.0) ──
// Una técnica validada (`public.videolab_scene_techniques`, clave `technique_id`) dice CÓMO se corta una conversación:
// una secuencia de ROLES de cámara relativos a quien habla, el largo de cada corte y el movimiento. El estudio dice qué
// toma cumple cada rol. Así, un turno sin cortes los recibe de la técnica, y una técnica nueva es una fila, no código.
//
// Roles (eje del sistema, nombrados por función):
//   · speaker  — una toma que anima la silla de quien habla (sale animada).
//   · listener — una toma que anima la silla de otra persona del elenco (sale fija: escucha).
//   · wide     — una toma que no anima a nadie (plano abierto, detrás de cámaras, sobre el hombro).
// Cada paso puede pedir encuadres preferidos (`framing`, del `shot_catalog`: close, medium, table, ots, wide…).
export const CUT_ROLES = Object.freeze(['speaker', 'listener', 'wide']);

/** Las tomas que cumplen un paso de la técnica, en orden de preferencia de encuadre. PURO. */
export function shotsForStep(step, { catalog, available, seat, cast }) {
  const role = step?.role;
  if (!CUT_ROLES.includes(role)) bad(`rol de corte desconocido: ${role} (admite: ${CUT_ROLES.join(', ')})`);
  const occupied = new Set(Object.keys(cast ?? {}).filter((k) => str(cast[k])));
  const ok = [...catalog.values()].filter((s) => available.has(s.id)).filter((s) => {
    if (role === 'speaker') return s.animate === seat;
    if (role === 'listener') return str(s.animate) && s.animate !== seat && occupied.has(s.animate);
    return !str(s.animate);
  });
  const pref = Array.isArray(step.framing) ? step.framing : [];
  const rank = (s) => { const i = pref.indexOf(s.framing); return i < 0 ? pref.length : i; };
  const sorted = ok.sort((a, b) => rank(a) - rank(b));
  // Se rota sólo entre las tomas del mejor encuadre disponible: la preferencia manda sobre la variedad.
  return sorted.filter((x) => rank(x) === rank(sorted[0]));
}

/**
 * Los cortes de un turno según la técnica: recorre `cut_plan.sequence` en ciclo, cada paso con su largo (`ms`, si no
 * `cut_plan.cut_ms`), y rota entre las tomas que cumplen el paso. Un resto menor que `min_cut_ms` se suma al corte
 * anterior. El primer corte siempre es de quien habla (se ve hablar desde el principio). PURO y determinista.
 */
export function cutsFromTechnique({ technique, catalog, shots, seat, cast, durationMs }) {
  const plan = technique?.cut_plan ?? {};
  const seq = Array.isArray(plan.sequence) && plan.sequence.length ? plan.sequence : [{ role: 'speaker' }];
  const cutMs = Number(plan.cut_ms) > 0 ? Number(plan.cut_ms) : 3000;
  const minMs = Number(plan.min_cut_ms) > 0 ? Number(plan.min_cut_ms) : 1200;
  const available = new Set((shots ?? []).map((s) => s.shot_id));
  const ctx = { catalog, available, seat, cast };
  const used = new Map();
  const pick = (step) => {
    const list = shotsForStep(step, ctx);
    if (!list.length) return null;
    const k = `${step.role}|${(step.framing ?? []).join(',')}`;
    const n = used.get(k) ?? 0; used.set(k, n + 1);
    return list[n % list.length].id;
  };
  const first = pick({ role: 'speaker', framing: seq.find((x) => x.role === 'speaker')?.framing });
  if (!first) bad(`la técnica ${technique?.technique_id ?? ''} no encuentra ninguna toma que anime la silla ${seat}`);
  const cuts = [];
  let t = 0;
  let i = seq[0]?.role === 'speaker' ? 1 : 0;
  cuts.push({ shot_id: first, at_ms: 0 });
  t = Number(seq[0]?.role === 'speaker' && seq[0].ms > 0 ? seq[0].ms : cutMs);
  let guard = 0;
  while (t < durationMs - minMs && guard++ < 200) {
    const step = seq[i % seq.length]; i += 1;
    const id = pick(step);
    if (!id) continue;
    if (id === cuts[cuts.length - 1].shot_id) { t += Number(step.ms) > 0 ? Number(step.ms) : cutMs; continue; }
    cuts.push({ shot_id: id, at_ms: Math.round(t) });
    t += Number(step.ms) > 0 ? Number(step.ms) : cutMs;
  }
  return cuts;
}

/** El movimiento de cámara de la técnica para los cortes de quien habla: deriva lenta en horizontal (paneo y
 *  reencuadre fino) como filtro de ffmpeg sobre el clip ya al lienzo. Sin movimiento, nada. PURO. */
export function speakerMoveFilter(move, canvas) {
  if (!move || move.type !== 'drift') return '';
  const amp = Math.min(0.15, Math.max(0, Number(move.amplitude ?? 0.05)));
  const period = Math.max(2, Number(move.period_s ?? 8));
  const { width: W, height: H } = canvas;
  const cw = Math.round(W * (1 - amp)) & ~1, ch = Math.round(H * (1 - amp)) & ~1;
  return `crop=${cw}:${ch}:(iw-${cw})/2*(1+sin(2*PI*t/${period})):(ih-${ch})/2,scale=${W}:${H},setsar=1`;
}
