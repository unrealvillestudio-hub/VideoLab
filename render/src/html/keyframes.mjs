// ANIMACIÓN COMO DATO — el evaluador del motor HTML de VideoLab (F0, 2026-11-16).
//
// Una animación es una lista de PISTAS (`tracks`) escrita en el dato del preset (`spec.motion.tracks`). Cada pista
// apunta a una parte del bloque y lleva fotogramas clave en milisegundos:
//
//   { target: 'block' | 'box' | 'rule' | 'text' | 'line' | 'word' | 'char' | 'emphasis' | 'number' | 'sheen',
//     from: 'start' | 'end',                     // el tiempo de las claves cuenta desde el inicio o desde el final
//     stagger?: { each_ms, order?: 'forward' | 'reverse' | 'center' },   // sólo line, word, char, emphasis, number
//     repeat?: { every_ms, times? },             // repite la pista (latidos, brillos) mientras el bloque vive
//     keys: [{ t, ease?, <prop>: valor, ... }] }  // ease = curva del tramo que TERMINA en esa clave
//
// Propiedades: opacity, x_em, y_em (desplazamiento en em del tamaño del bloque), scale, scale_x, scale_y, rotate_deg,
// blur_em, clip_l, clip_r, clip_t, clip_b (recorte 0–1 desde cada borde), tint (0 = color de base, 1 = color de
// énfasis), sheen (posición 0–1 del brillo), count (0–1, avance del contador en los números) y mark (0–1, cuánto
// del subrayado de énfasis está dibujado, de izquierda a derecha).
//
// Todo es una FUNCIÓN PURA DEL TIEMPO: mismo dato + mismo t → mismo estado. No hay reloj, ni azar, ni estado entre
// fotogramas. Este archivo sólo importa ease.mjs, y los dos se inyectan tal cual en la página del capturador.

import { easeFn } from './ease.mjs';

export const TARGETS = Object.freeze(['block', 'box', 'rule', 'text', 'line', 'word', 'char', 'emphasis', 'number', 'sheen']);
export const UNIT_TARGETS = Object.freeze(['line', 'word', 'char', 'emphasis', 'number']);
export const PROPS = Object.freeze({
  opacity: 1, x_em: 0, y_em: 0, scale: 1, scale_x: 1, scale_y: 1, rotate_deg: 0, blur_em: 0,
  clip_l: 0, clip_r: 0, clip_t: 0, clip_b: 0, tint: 0, sheen: -1, count: 1, mark: 0,
});

/** Comprueba la forma de `motion` (lanza con el punto exacto). PURO. */
export function validateMotion(motion, where = 'motion') {
  if (motion == null) return;
  if (typeof motion !== 'object' || !Array.isArray(motion.tracks)) throw new Error(`${where}.tracks debe ser una lista`);
  if (motion.roll != null) {
    // Contador dígito a dígito (rodillo, 2026-11-17): cada cifra gira `turns` vueltas completas antes de caer en su valor;
    // `lag` es cuánto del avance del contador (0–1) se retrasa cada cifra respecto de la anterior, de izquierda a derecha.
    const r = motion.roll;
    if (typeof r !== 'object' || Array.isArray(r)) throw new Error(`${where}.roll debe ser un objeto`);
    if (r.turns != null && !(Number.isInteger(Number(r.turns)) && r.turns >= 0 && r.turns <= 4)) throw new Error(`${where}.roll.turns debe ser un entero de 0 a 4`);
    if (r.lag != null && !(Number(r.lag) >= 0 && Number(r.lag) <= 0.3)) throw new Error(`${where}.roll.lag debe estar entre 0 y 0,3`);
  }
  motion.tracks.forEach((tr, i) => {
    const w = `${where}.tracks[${i}]`;
    if (!TARGETS.includes(tr?.target)) throw new Error(`${w}.target desconocido: ${tr?.target}`);
    if (tr.from != null && !['start', 'end'].includes(tr.from)) throw new Error(`${w}.from debe ser start o end`);
    if (tr.stagger != null) {
      if (!UNIT_TARGETS.includes(tr.target)) throw new Error(`${w}.stagger sólo vale en ${UNIT_TARGETS.join(', ')}`);
      if (!(Number(tr.stagger.each_ms) >= 0)) throw new Error(`${w}.stagger.each_ms debe ser ≥ 0`);
      if (tr.stagger.order != null && !['forward', 'reverse', 'center'].includes(tr.stagger.order)) throw new Error(`${w}.stagger.order desconocido`);
    }
    if (tr.repeat != null && !(Number(tr.repeat.every_ms) > 0)) throw new Error(`${w}.repeat.every_ms debe ser > 0`);
    if (!Array.isArray(tr.keys) || !tr.keys.length) throw new Error(`${w}.keys vacío`);
    let prev = -Infinity;
    tr.keys.forEach((k, j) => {
      if (!Number.isFinite(Number(k?.t))) throw new Error(`${w}.keys[${j}].t no es un número`);
      if (Number(k.t) < prev) throw new Error(`${w}.keys[${j}].t va hacia atrás`);
      prev = Number(k.t);
      if (k.ease != null) easeFn(k.ease);
      for (const p of Object.keys(k)) {
        if (p === 't' || p === 'ease') continue;
        if (!(p in PROPS)) throw new Error(`${w}.keys[${j}].${p}: propiedad desconocida`);
        if (!Number.isFinite(Number(k[p]))) throw new Error(`${w}.keys[${j}].${p} no es un número`);
      }
    });
  });
}

/** Valor de UNA propiedad de una pista en el tiempo local `t` (ms). Antes de la primera clave, la primera; después de la última, la última. PURO. */
export function propAt(keys, prop, t) {
  let prev = null;
  for (const k of keys) {
    if (!(prop in k)) continue;
    const kt = Number(k.t);
    if (t < kt) {
      if (!prev) return Number(k[prop]);
      const span = kt - prev.t;
      const p = span > 0 ? (t - prev.t) / span : 1;
      const e = easeFn(k.ease)(Math.min(1, Math.max(0, p)));
      return prev.v + (Number(k[prop]) - prev.v) * e;
    }
    prev = { t: kt, v: Number(k[prop]) };
  }
  return prev ? prev.v : undefined;
}

/** Retraso de la unidad `i` de `n` según el escalonado. PURO. */
export function staggerDelay(stagger, i, n) {
  if (!stagger) return 0;
  const each = Number(stagger.each_ms) || 0;
  const order = stagger.order ?? 'forward';
  if (order === 'reverse') return (n - 1 - i) * each;
  if (order === 'center') return Math.abs(i - (n - 1) / 2) * each;
  return i * each;
}

/**
 * Estado de una parte del bloque en el tiempo absoluto `t` (ms). `block` = { start_ms, end_ms }; para las unidades
 * (line, word, char, …), `unit` = { i, n }. Combina todas las pistas de ese objetivo: opacidad y escalas se multiplican,
 * desplazamientos y giros se suman, recortes y desenfoque toman el máximo, tinte y brillo el último que lo declara. PURO.
 */
export function stateAt(tracks, target, t, block, unit = null) {
  const s = { ...PROPS };
  let touched = false;
  for (const tr of tracks ?? []) {
    if (tr.target !== target) continue;
    touched = true;
    const base = tr.from === 'end' ? block.end_ms : block.start_ms;
    let local = t - base - (unit ? staggerDelay(tr.stagger, unit.i, unit.n) : 0);
    if (tr.repeat && local > 0) {
      const every = Number(tr.repeat.every_ms);
      const times = tr.repeat.times != null ? Number(tr.repeat.times) : Infinity;
      const k = Math.floor(local / every);
      if (k < times) local -= k * every;
      else local = Infinity;   // pasadas las repeticiones, queda en su última clave
    }
    for (const p of Object.keys(PROPS)) {
      const v = propAt(tr.keys, p, local);
      if (v === undefined) continue;
      if (p === 'opacity' || p === 'scale' || p === 'scale_x' || p === 'scale_y') s[p] *= v;
      else if (p === 'x_em' || p === 'y_em' || p === 'rotate_deg') s[p] += v;
      else if (p.startsWith('clip_') || p === 'blur_em') s[p] = Math.max(s[p], v);
      else s[p] = v;
    }
  }
  s.touched = touched;
  return s;
}

/**
 * Rectángulo del bloque en el tiempo `t`. Un bloque puede declarar `segments` (posición por tramo de toma: cuando cambia
 * el plano, el bloque se va a otro sitio). El paso de un tramo al siguiente dura `move_ms` desde el inicio del tramo
 * nuevo, con la curva `move_ease`. Sin `segments`, el `rect` fijo. PURO.
 */
export function rectAt(block, t) {
  const segs = block.segments;
  if (!Array.isArray(segs) || !segs.length) return block.rect;
  let idx = segs.findIndex((s) => t >= s.start_ms && t < s.end_ms);
  if (idx < 0) idx = t < segs[0].start_ms ? 0 : segs.length - 1;
  const cur = segs[idx];
  const moveMs = Number(block.move_ms ?? 0);
  if (idx === 0 || !(moveMs > 0) || t >= cur.start_ms + moveMs) return cur.rect;
  const p = easeFn(block.move_ease ?? 'cubic_in_out')(Math.max(0, (t - cur.start_ms) / moveMs));
  const a = segs[idx - 1].rect, b = cur.rect;
  return { x: a.x + (b.x - a.x) * p, y: a.y + (b.y - a.y) * p, w: a.w + (b.w - a.w) * p, h: a.h + (b.h - a.h) * p };
}

/**
 * Pistas por defecto para un preset que no trae `motion`: traduce `entry`, `duration_ms`, `exit_ms` y `slide_from_pct`
 * (contrato §4 ter.3) a pistas, para que el motor HTML dibuje cualquier preset existente con su misma intención.
 * PURO.
 */
export function tracksFromEntry(spec, { canvasHeight, px }) {
  const entry = spec.entry ?? 'fade';
  const d = Math.max(0, Number(spec.duration_ms ?? 300));
  const out = Math.max(0, Number(spec.exit_ms ?? 200));
  const tracks = [{ target: 'block', from: 'end', keys: [{ t: -out, opacity: 1 }, { t: 0, opacity: 0, ease: 'quad_in' }] }];
  const fadeIn = { target: 'block', keys: [{ t: 0, opacity: 0 }, { t: d, opacity: 1, ease: 'cubic_out' }] };
  const em = (pctOfH) => (canvasHeight * pctOfH / 100) / Math.max(1, px);
  switch (entry) {
    case 'rise':
      tracks.push(fadeIn, { target: 'block', keys: [{ t: 0, y_em: em(Number(spec.slide_from_pct ?? 1.5)) }, { t: d, y_em: 0, ease: 'cubic_out' }] });
      break;
    case 'slide':
      tracks.push(fadeIn, { target: 'block', keys: [{ t: 0, x_em: -em(Number(spec.slide_from_pct ?? 3)) }, { t: d, x_em: 0, ease: 'cubic_out' }] });
      break;
    case 'mask':
      tracks.push({ target: 'block', keys: [{ t: 0, clip_r: 1 }, { t: d, clip_r: 0, ease: 'cubic_out' }] });
      break;
    case 'pop':
      tracks.push(fadeIn, { target: 'text', keys: [{ t: 0, scale: Number(spec.scale_from ?? 0.85) }, { t: d, scale: 1, ease: 'back_out' }] });
      break;
    case 'punch':
      tracks.push(fadeIn, { target: 'text', keys: [{ t: 0, scale: Number(spec.scale_from ?? 1.3), blur_em: 0.08 }, { t: d, scale: 1, blur_em: 0, ease: 'expo_out' }] });
      break;
    case 'pop_words':
      tracks.push({ target: 'word', stagger: { each_ms: Number(spec.stagger_ms ?? 120) }, keys: [{ t: 0, opacity: 0, scale: Number(spec.scale_from ?? 0.85) }, { t: d, opacity: 1, scale: 1, ease: 'back_out' }] });
      break;
    case 'type':
      tracks.push({ target: 'char', stagger: { each_ms: Number(spec.stagger_ms ?? 40) }, keys: [{ t: 0, opacity: 0 }, { t: 1, opacity: 1 }] });
      break;
    case 'draw':
      tracks.push(fadeIn, { target: 'rule', keys: [{ t: 0, clip_r: 1 }, { t: d, clip_r: 0, ease: 'cubic_out' }] });
      break;
    default:
      tracks.push(fadeIn);
  }
  return tracks;
}
