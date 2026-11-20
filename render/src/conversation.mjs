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
import { X264 } from './x264.mjs';

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
/**
 * LAS CARAS DE CADA TOMA, EN EL LIENZO (2026-11-16). ImageLab (`/api/compose` modo `faces`) devuelve las cajas en
 * fracciones de la IMAGEN de la toma; el render la escala para cubrir el lienzo y la recorta con `focus_x` (`coverFilter`).
 * Aquí se aplica la misma cuenta y cada caja queda en % del lienzo, con el tramo del segmento que muestra esa toma, y con
 * un margen (`marginPct`, % del lienzo) por el movimiento del avatar y del encuadre. Una caja fuera del lienzo se descarta.
 * `faces` por URL: `{ width, height, boxes: [{ x0, y0, x1, y1 }] }`. Sin dato de una URL, ese segmento no aporta caras. PURO.
 */
export function facesOnCanvas({ segments, facesByUrl, canvas, marginPct = 3 }) {
  const { width: W, height: H } = canvas;
  const out = [];
  for (const sg of segments ?? []) {
    const f = facesByUrl?.[sg.image_url];
    if (!f || !(f.width > 0) || !(f.height > 0) || !Array.isArray(f.boxes)) continue;
    const k = Math.max(W / f.width, H / f.height);
    const sw = f.width * k, sh = f.height * k;
    const fx = Number.isFinite(Number(sg.focus_x)) ? Math.min(1, Math.max(0, Number(sg.focus_x))) : 0.5;
    const ox = (sw - W) * fx, oy = (sh - H) / 2;
    const mx = W * marginPct / 100, my = H * marginPct / 100;
    const start = Number(sg.start_ms), end = start + (Number(sg.to_ms) - Number(sg.from_ms));
    for (const b of f.boxes) {
      const x0 = Math.max(0, b.x0 * sw - ox - mx), x1 = Math.min(W, b.x1 * sw - ox + mx);
      const y0 = Math.max(0, b.y0 * sh - oy - my), y1 = Math.min(H, b.y1 * sh - oy + my);
      if (!(x1 > x0 && y1 > y0)) continue;
      const r = (v) => Math.round(v * 100) / 100;
      out.push({ box: { x: r(x0 / W * 100), y: r(y0 / H * 100), w: r((x1 - x0) / W * 100), h: r((y1 - y0) / H * 100) },
        start_ms: start, end_ms: end, shot_id: sg.shot_id ?? null });
    }
  }
  return out;
}

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
    '-t', seconds.toFixed(3), '-an', '-c:v', 'libx264', ...X264, '-pix_fmt', 'yuv420p', '-r', '30', out];
}

/** Argumentos de ffmpeg de un corte ANIMADO: el clip de HeyGen al lienzo, recortado al tramo. PURO. */
export function clipArgs({ clip, seconds, canvas, focusX = 0.5, move = null, out }) {
  // HeyGen puede devolver el clip ~0,1 s más corto que el audio: se sostiene el último cuadro hasta el tramo exacto.
  return ['-y', '-i', clip, '-vf', `${coverFilter(canvas, focusX)},tpad=stop_mode=clone:stop_duration=1${move ? `,${speakerMoveFilter(move, canvas)}` : ''}`, '-t', seconds.toFixed(3), '-an',
    '-c:v', 'libx264', ...X264, '-pix_fmt', 'yuv420p', '-r', '30', out];
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

/**
 * Quién necesita consentimiento de avatar entre quienes hablan (contrato §4: «si es real o sintética es dato»).
 * `people` = filas de `person_blueprints` ({ id, person_kind }). Una persona `synthetic` no tiene a nadie que consienta;
 * `real` o sin marcar (NULL) sí lo necesita: el lado seguro. Quien habla y no está en el registro → VIDEOLAB_BAD_REQUEST.
 * PURO.
 */
export function speakersNeedingConsent(speakers, people) {
  const byId = new Map((people ?? []).map((p) => [p.id, p]));
  const missing = speakers.filter((pid) => !byId.has(pid));
  if (missing.length) bad(`params.cast nombra personas que no están en person_blueprints: ${missing.join(', ')}`);
  return {
    need: speakers.filter((pid) => byId.get(pid).person_kind !== 'synthetic'),
    synthetic: speakers.filter((pid) => byId.get(pid).person_kind === 'synthetic'),
  };
}

// ─────────────────────────────────────── cortes en paralelo y caché de clips (v1.16.0) ───────────────────────────────────────
// 2026-11-19, job cf23e27a (10 cortes): los clips de HeyGen se pedían uno detrás de otro (45–60 s cada uno), el render llegó
// al tope de 840 s y HeyGen cobró los 10 clips sin que quedara asiento, porque el costo se escribía al final. Ahora:
//   - los cortes se fabrican en paralelo, hasta `videolab_producers.max_parallel_clips` (dato; sin él, CLIP_PARALLEL_DEFAULT);
//   - cada clip pagado se asienta en cuanto llega, aunque el job falle después;
//   - cada clip se guarda en una caché direccionada por contenido: un reintento con la misma voz, la misma toma, el mismo
//     motor y la misma dirección lo reutiliza sin volver a pagar.

/** Llamadas simultáneas a HeyGen cuando el productor no lo declara. */
export const CLIP_PARALLEL_DEFAULT = 4;
/** Tope duro: nunca más de esto a la vez, aunque el dato diga otra cosa. */
export const CLIP_PARALLEL_MAX = 8;
/** Versión de la clave de caché: si cambia lo que define un clip, se sube y la caché vieja deja de coincidir. */
export const CLIP_CACHE_VERSION = 1;

/** Cuántos cortes a la vez, del dato del productor, acotado a [1, CLIP_PARALLEL_MAX]. PURO. */
export function clipParallelOf(prod) {
  const n = Math.round(Number(prod?.max_parallel_clips));
  return Number.isFinite(n) && n >= 1 ? Math.min(CLIP_PARALLEL_MAX, n) : CLIP_PARALLEL_DEFAULT;
}

/** JSON con claves ordenadas: la misma dirección escrita en otro orden da la misma clave. PURO. */
export function stableJson(v) {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stableJson(v[k])}`).join(',')}}`;
  return JSON.stringify(v ?? null);
}

/**
 * Lo que define un clip animado: motor, imagen de la toma, dirección del avatar y el tramo de voz (huella del audio
 * completo del turno + milisegundos de inicio y fin; no los bytes del MP3 recortado, que dependen del codificador). Dos
 * cortes con lo mismo producen el mismo clip, así que comparten clave. `sha256` se inyecta (node:crypto). PURO.
 */
export function clipCacheKey({ engine, imageUrl, direction, turnAudioSha256, fromMs, toMs }, sha256) {
  if (!str(engine?.rateModelId) || !str(imageUrl) || !/^[0-9a-f]{64}$/.test(String(turnAudioSha256))
    || !(Number.isFinite(fromMs) && Number.isFinite(toMs) && toMs > fromMs)) bad('clave de caché de clip incompleta');
  return sha256(stableJson({ v: CLIP_CACHE_VERSION, engine: engine.rateModelId, image_url: imageUrl, direction: direction ?? {},
    audio: { turn_sha256: turnAudioSha256, from_ms: Math.round(fromMs), to_ms: Math.round(toMs) } }));
}

/** Ruta de la caché de clips en el bucket. Común a todas las marcas: la clave ya separa contenido distinto. PURO. */
export const clipCachePath = (key) => `videolab/cache/clips/${key}.mp4`;

/**
 * Corre `fn(item, index)` sobre todos los elementos con a lo sumo `limit` a la vez; devuelve los resultados en el orden de
 * entrada. Ante el primer error deja de lanzar nuevos y lo propaga cuando terminan los que ya estaban en curso.
 */
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  let failed = null;
  const worker = async () => {
    while (failed == null && next < items.length) {
      const i = next++;
      try { out[i] = await fn(items[i], i); } catch (e) { failed ??= e; }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  if (failed != null) throw failed;
  return out;
}
