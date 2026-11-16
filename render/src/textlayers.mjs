// VIDEOLAB · CAPAS DE TEXTO EDITABLES (contrato v1.3.0, §4 ter) — bloque PURO.
//
// Convierte el pedido de texto en pantalla (`text_layers`), los tiempos de la voz (`timeline`), los presets de
// `public.videolab_text_presets`, la paleta (`public.brand_palette`), la tipografía (`public.brand_typography`), los
// tokens de identidad de la marca (`public.imagelab_overlay_tokens`) y la zona segura del canal en UN guion ASS que
// libass dibuja sobre el video limpio, más el filtro `drawbox` de la franja de identidad.
//
// Capas: gancho (`hook`), rol de cada persona (`role`), subtítulos karaoke (`caption`), títulos clave (`key_title`),
// CTA (`cta`) y la franja de identidad. Los presets son DATO: aquí se interpreta su `spec` de forma genérica (ver
// docs/CONTRACT.md §4 ter.3); un preset nuevo es una fila, no código.
//
// Geometría (contrato §3.3 del contrato de la función):
//   · todo bloque de texto, con su caja, su contorno y su filete, cabe DENTRO de la zona segura; si no cabe ni con el
//     tamaño mínimo del preset → VIDEOLAB_TEXT_DOES_NOT_FIT (nunca se desborda ni se recorta texto);
//   · el rol nunca solapa la banda de subtítulos: va encima con un margen ≥ 2 % de la altura, ni una cara declarada
//     en `timeline.faces`; sin caras, tercio inferior sobre los subtítulos, alineado al borde seguro izquierdo;
//   · dos bloques que coinciden en el tiempo no se solapan en el espacio.
//
// MULTIMARCA: ningún nombre, color ni fuente de marca en este archivo. Todo llega por `brand_id` desde el dato, y lo
// que falta falla con nombre (VIDEOLAB_BAD_REQUEST), nunca con un valor por defecto de marca.

import { RenderError } from './plan.mjs';
import { spokenWords } from './assemble.mjs';

export const TEXT_LAYERS = Object.freeze(['hook', 'role', 'caption', 'key_title', 'cta']);
export const ENTRIES = Object.freeze(['fade', 'pop', 'pop_words', 'mask', 'type', 'punch', 'slide', 'rise', 'draw']);
/** Entrada del rol: sutil, como mucho 350 ms y sin rebote (decisión de Sam, 2026-11-16). */
export const ROLE_MAX_ENTRY_MS = 350;
/** Margen mínimo entre el rol y la banda de subtítulos, en % de la altura del lienzo. */
export const ROLE_CAPTION_MARGIN_PCT = 2;
/** Rol tipográfico por capa (contrato §3.3); el preset puede pedir otro con `font_role`. */
export const DEFAULT_FONT_ROLE = Object.freeze({ hook: 'display', key_title: 'display', cta: 'display', role: 'body', caption: 'body' });
/** Huecos de color que un preset puede nombrar; cada uno se resuelve a un rol de `brand_palette` de la marca. */
export const COLOR_SLOTS = Object.freeze(['text', 'text_body', 'accent', 'scrim', 'rule', 'identity']);

const bad = (m) => { throw new RenderError('VIDEOLAB_BAD_REQUEST', m); };
const nofit = (m) => { throw new RenderError('VIDEOLAB_TEXT_DOES_NOT_FIT', m); };
const str = (v) => typeof v === 'string' && v.trim().length > 0;
const obj = (v) => v != null && typeof v === 'object' && !Array.isArray(v);
const num = (v, d) => (v != null && Number.isFinite(Number(v)) ? Number(v) : d);
const nonNeg = (v) => v != null && Number.isFinite(Number(v)) && Number(v) >= 0;
const pos = (v) => v != null && Number.isFinite(Number(v)) && Number(v) > 0;

// ─────────────────────────── validación de la forma (la usa también api/execute) ───────────────────────────

/**
 * Comprueba la forma de `text_layers` (contrato §4 ter.1). `words` son las palabras del timeline: si los subtítulos
 * están encendidos, tienen que existir. Lanza VIDEOLAB_BAD_REQUEST. PURO.
 */
export function validateTextLayers(tl, { words = null } = {}) {
  if (!obj(tl)) bad('text_layers debe ser un objeto');
  const key = (v, where) => { if (!str(v)) bad(`${where}.preset_key vacío`); };
  const txt = (v, where) => { if (!str(v)) bad(`${where}.text vacío`); };
  let layers = 0;
  if (tl.hook != null) {
    const h = tl.hook;
    if (!obj(h)) bad('text_layers.hook debe ser un objeto o null');
    txt(h.text, 'hook'); key(h.preset_key, 'hook');
    if (!nonNeg(h.start_ms)) bad('hook.start_ms debe ser ≥ 0');
    if (!(nonNeg(h.end_ms) && Number(h.end_ms) > Number(h.start_ms))) bad('hook.end_ms debe ser mayor que start_ms');
    if (h.emphasis != null && !(Array.isArray(h.emphasis) && h.emphasis.every(str))) bad('hook.emphasis debe ser una lista de textos');
    layers++;
  }
  if (tl.roles != null) {
    if (!Array.isArray(tl.roles)) bad('text_layers.roles debe ser una lista');
    tl.roles.forEach((r, i) => {
      if (!obj(r)) bad(`roles[${i}] debe ser un objeto`);
      if (r.show === false) return;
      if (!str(r.person_id)) bad(`roles[${i}].person_id vacío`);
      txt(r.text, `roles[${i}]`); key(r.preset_key, `roles[${i}]`);
      if (!nonNeg(r.at_ms)) bad(`roles[${i}].at_ms debe ser ≥ 0`);
      if (!pos(r.dur_ms)) bad(`roles[${i}].dur_ms debe ser > 0`);
      layers++;
    });
  }
  if (tl.captions != null) {
    const c = tl.captions;
    if (!obj(c)) bad('text_layers.captions debe ser un objeto o null');
    if (c.enabled !== false) {
      key(c.preset_key, 'captions');
      if (c.accent_role != null && !str(c.accent_role)) bad('captions.accent_role debe ser un rol de brand_palette');
      if (words != null && (!Array.isArray(words) || !words.length)) bad('los subtítulos necesitan timeline.words');
      layers++;
    }
  }
  if (tl.key_titles != null) {
    if (!Array.isArray(tl.key_titles)) bad('text_layers.key_titles debe ser una lista');
    tl.key_titles.forEach((k, i) => {
      if (!obj(k)) bad(`key_titles[${i}] debe ser un objeto`);
      txt(k.text, `key_titles[${i}]`); key(k.preset_key, `key_titles[${i}]`);
      if (!nonNeg(k.at_ms)) bad(`key_titles[${i}].at_ms debe ser ≥ 0`);
      if (!pos(k.dur_ms)) bad(`key_titles[${i}].dur_ms debe ser > 0`);
      layers++;
    });
  }
  if (tl.cta != null) {
    const c = tl.cta;
    if (!obj(c)) bad('text_layers.cta debe ser un objeto o null');
    txt(c.text, 'cta'); key(c.preset_key, 'cta');
    if (!nonNeg(c.at_ms)) bad('cta.at_ms debe ser ≥ 0');
    if (c.dur_ms != null && !pos(c.dur_ms)) bad('cta.dur_ms debe ser > 0');
    layers++;
  }
  if (tl.identity != null) {
    const d = tl.identity;
    if (!obj(d)) bad('text_layers.identity debe ser un objeto o null');
    if (d.strip_role != null && !str(d.strip_role)) bad('identity.strip_role debe ser un rol de brand_palette');
    if (d.strip === true) layers++;
  }
  if (!layers) bad('text_layers no pide ninguna capa');
  return tl;
}

/** Las `preset_key` que usa el pedido, sin repetir. PURO. */
export function presetKeysOf(tl) {
  const keys = [];
  if (tl?.hook) keys.push(tl.hook.preset_key);
  for (const r of tl?.roles ?? []) if (r?.show !== false) keys.push(r.preset_key);
  if (tl?.captions && tl.captions.enabled !== false) keys.push(tl.captions.preset_key);
  for (const k of tl?.key_titles ?? []) keys.push(k.preset_key);
  if (tl?.cta) keys.push(tl.cta.preset_key);
  return [...new Set(keys.filter(str))];
}

// ─────────────────────────────────────────── presets, colores, fuentes ───────────────────────────────────────────

/**
 * El preset por `preset_key`: la fila de la marca manda; sin ella, la del sistema (`brand_id` NULL). Una fila de la
 * marca inactiva apaga el preset para esa marca (no cae a la del sistema). Inexistente, inactivo o de otra capa →
 * VIDEOLAB_BAD_REQUEST. PURO.
 */
export function resolveTextPreset(rows, key, brandId, layer) {
  const cands = (rows ?? []).filter((r) => r?.preset_key === key);
  const row = cands.find((r) => r.brand_id === brandId) ?? cands.find((r) => r.brand_id == null);
  if (!row) bad(`el preset de texto ${key} no existe en videolab_text_presets`);
  if (row.active === false || row.status === 'retired') bad(`el preset de texto ${key} no está activo`);
  if (layer && row.layer !== layer) bad(`el preset ${key} es de la capa ${row.layer}, no de ${layer}`);
  if (!obj(row.spec)) bad(`el preset ${key} no tiene spec`);
  if (row.spec.entry != null && !ENTRIES.includes(row.spec.entry)) bad(`el preset ${key} pide una entrada desconocida: ${row.spec.entry}`);
  if (layer === 'role' && num(row.spec.duration_ms, 0) > ROLE_MAX_ENTRY_MS) {
    bad(`el preset de rol ${key} entra en ${row.spec.duration_ms} ms (tope ${ROLE_MAX_ENTRY_MS} ms)`);
  }
  return row;
}

/** Los roles tipográficos que necesita el pedido (para bajar sólo esas fuentes). PURO. */
export function fontRolesNeeded(tl, rows, brandId) {
  const roles = new Set();
  const add = (key, layer) => roles.add(resolveTextPreset(rows, key, brandId, layer).spec.font_role ?? DEFAULT_FONT_ROLE[layer]);
  if (tl?.hook) add(tl.hook.preset_key, 'hook');
  for (const r of tl?.roles ?? []) if (r?.show !== false) add(r.preset_key, 'role');
  if (tl?.captions && tl.captions.enabled !== false) add(tl.captions.preset_key, 'caption');
  for (const k of tl?.key_titles ?? []) add(k.preset_key, 'key_title');
  if (tl?.cta) add(tl.cta.preset_key, 'cta');
  return [...roles];
}

/**
 * Los huecos de color → rol de `brand_palette`. Salen de los tokens de la marca (`imagelab_overlay_tokens`, fila de la
 * marca sin canal) y del pedido (`captions.accent_role`, `identity.strip_role`), que mandan. PURO.
 */
export function colorSlots({ tokens, textLayers }) {
  const pal = tokens?.palette ?? {};
  const lay = tokens?.layout ?? {};
  return {
    text: pal.headline ?? null,
    text_body: pal.subheadline ?? pal.headline ?? null,
    accent: textLayers?.captions?.accent_role ?? pal.headline_emphasis ?? lay.rule?.palette ?? null,
    scrim: lay.scrim?.palette ?? null,
    rule: lay.rule?.palette ?? null,
    identity: textLayers?.identity?.strip_role ?? tokens?.identity?.palette ?? null,
  };
}

const HEX = /^#?[0-9a-fA-F]{6}$/;

/**
 * Un color del preset → `#RRGGBB`. Admite un hueco (`text`, `accent`…), `palette:<rol>` o un hex neutro escrito en el
 * dato del preset. Un hueco sin rol en la marca, o un rol que la marca no tiene en `brand_palette` →
 * VIDEOLAB_BAD_REQUEST. PURO.
 */
export function resolveColor(ref, { slots, palette }) {
  if (!str(ref)) bad('color vacío en el preset');
  if (HEX.test(ref)) return `#${ref.replace('#', '').toUpperCase()}`;
  let role;
  if (ref.startsWith('palette:')) role = ref.slice(8);
  else if (COLOR_SLOTS.includes(ref)) {
    role = slots?.[ref];
    if (!str(role)) bad(`la marca no declara el color «${ref}» (imagelab_overlay_tokens o el pedido)`);
  } else bad(`color desconocido en el preset: ${ref}`);
  const row = (palette ?? []).find((p) => p?.role === role);
  if (!row || !HEX.test(String(row.hex ?? ''))) bad(`brand_palette no tiene el rol ${role}`);
  return `#${String(row.hex).replace('#', '').toUpperCase()}`;
}

/** `#RRGGBB` + opacidad (0–1) → color ASS `&HAABBGGRR`. PURO. */
export function assColor(hex, opacity = 1) {
  const h = String(hex).replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(h)) bad(`color inválido: ${hex}`);
  const a = Math.round(255 * (1 - Math.min(1, Math.max(0, opacity))));
  return `&H${a.toString(16).padStart(2, '0')}${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}&`.toUpperCase();
}
const assAlpha = (opacity) => `&H${Math.round(255 * (1 - Math.min(1, Math.max(0, opacity)))).toString(16).padStart(2, '0').toUpperCase()}&`;

// ─────────────────────────────────────────────── medida del texto ───────────────────────────────────────────────

/**
 * Medida CONSERVADORA (sin la fuente): ancho por clase de carácter, en em, con un margen. Sobrestima a propósito, así
 * que un texto que «cabe» con ella cabe con cualquier fuente de texto corriente. PURO.
 */
export function estimateMeasure(text, sizePx, { bold = false } = {}) {
  let em = 0;
  for (const ch of String(text)) {
    if (ch === ' ') em += 0.32;
    else if (/[iljI.,;:!'|·]/.test(ch)) em += 0.34;
    else if (/[MWmw@%]/.test(ch)) em += 1.0;
    else if (/[A-ZÁÉÍÓÚÑÜ0-9]/.test(ch)) em += 0.74;
    else em += 0.6;
  }
  return em * sizePx * (bold ? 1.08 : 1) * 1.05;
}

/**
 * Medida REAL con las métricas de la fuente (TrueType/OpenType: `cmap` formato 4 o 12 + `hmtx`). Ignora el
 * interletrado (que casi siempre acorta), suma un 2 % y un 6 % más para negrita sintética. PURO sobre los bytes.
 */
export function ttfMeasure(bytes) {
  const b = Buffer.from(bytes);
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const sig = dv.getUint32(0);
  if (sig !== 0x00010000 && sig !== 0x4f54544f && sig !== 0x74727565) throw new Error('no es TrueType/OpenType');
  const tables = {};
  for (let i = 0, n = dv.getUint16(4); i < n; i++) {
    const off = 12 + 16 * i;
    tables[b.toString('latin1', off, off + 4)] = dv.getUint32(off + 8);
  }
  for (const t of ['head', 'hhea', 'hmtx', 'cmap']) if (tables[t] == null) throw new Error(`falta la tabla ${t}`);
  const upem = dv.getUint16(tables.head + 18);
  const nh = dv.getUint16(tables.hhea + 34);
  const adv = (g) => dv.getUint16(tables.hmtx + 4 * Math.min(g, nh - 1));
  const cm = tables.cmap;
  const subs = [];
  for (let i = 0, n = dv.getUint16(cm + 2); i < n; i++) {
    const r = cm + 4 + 8 * i;
    const off = cm + dv.getUint32(r + 4);
    subs.push({ p: dv.getUint16(r), e: dv.getUint16(r + 2), off, fmt: dv.getUint16(off) });
  }
  const sub = subs.find((s) => s.fmt === 12 && (s.p === 3 || s.p === 0)) ?? subs.find((s) => s.fmt === 4 && (s.p === 3 || s.p === 0));
  if (!sub) throw new Error('cmap sin subtabla Unicode 4 o 12');
  let glyph;
  if (sub.fmt === 4) {
    const segX2 = dv.getUint16(sub.off + 6);
    const ends = sub.off + 14, starts = ends + segX2 + 2, deltas = starts + segX2, ros = deltas + segX2;
    glyph = (c) => {
      if (c > 0xffff) return 0;
      for (let i = 0; i < segX2 / 2; i++) {
        if (c > dv.getUint16(ends + 2 * i)) continue;
        const start = dv.getUint16(starts + 2 * i);
        if (c < start) return 0;
        const delta = dv.getUint16(deltas + 2 * i), ro = dv.getUint16(ros + 2 * i);
        if (!ro) return (c + delta) & 0xffff;
        const g = dv.getUint16(ros + 2 * i + ro + 2 * (c - start));
        return g ? (g + delta) & 0xffff : 0;
      }
      return 0;
    };
  } else {
    const n = dv.getUint32(sub.off + 12);
    glyph = (c) => {
      for (let i = 0; i < n; i++) {
        const g = sub.off + 16 + 12 * i;
        const s = dv.getUint32(g), e = dv.getUint32(g + 4);
        if (c >= s && c <= e) return dv.getUint32(g + 8) + (c - s);
      }
      return 0;
    };
  }
  const cache = new Map();
  const width = (ch) => {
    if (!cache.has(ch)) cache.set(ch, adv(glyph(ch.codePointAt(0))));
    return cache.get(ch);
  };
  return (text, sizePx, { bold = false } = {}) => {
    let u = 0;
    for (const ch of String(text)) u += width(ch);
    return (u / upem) * sizePx * (bold ? 1.06 : 1) * 1.02;
  };
}

/**
 * Parte el texto en líneas que caben en `maxW` (greedy por palabras). `\n` fuerza un salto. Una palabra más ancha
 * que la línea ⇒ null (no se corta texto). PURO.
 */
export function wrapText(text, maxW, measureLine) {
  const out = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const w of para.split(/\s+/).filter(Boolean)) {
      if (measureLine(w) > maxW) return null;
      const cand = line ? `${line} ${w}` : w;
      if (measureLine(cand) <= maxW) line = cand;
      else { out.push(line); line = w; }
    }
    if (line) out.push(line);
  }
  return out;
}

// ─────────────────────────────────────────────────── geometría ───────────────────────────────────────────────────

/** La zona segura en píxeles (dato `safe_zone_pct` del canal). PURO. */
export function safeRect(safeZone, canvas) {
  const z = safeZone ?? {};
  for (const k of ['top', 'left', 'right', 'bottom']) {
    if (!nonNeg(z[k]) || Number(z[k]) >= 50) bad(`safe_zone_pct.${k} inválido: ${z[k]}`);
  }
  const { width: W, height: H } = canvas;
  const x0 = Math.ceil(W * z.left / 100), x1 = Math.floor(W * (1 - z.right / 100));
  const y0 = Math.ceil(H * z.top / 100), y1 = Math.floor(H * (1 - z.bottom / 100));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0, x1, y1 };
}

const inter = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const inside = (r, s) => r.x >= s.x - 0.5 && r.y >= s.y - 0.5 && r.x + r.w <= s.x + s.w + 0.5 && r.y + r.h <= s.y + s.h + 0.5;
const overlapT = (a, b) => a.start_ms < b.end_ms && b.start_ms < a.end_ms;

/**
 * Mide un bloque de texto con su preset: tamaño (baja desde `size_pct` hasta `min_size_pct` de 0,2 en 0,2), líneas,
 * caja, contorno, sombra y filete. Si no cabe en `maxW` con `max_lines` → VIDEOLAB_TEXT_DOES_NOT_FIT. PURO.
 */
export function measureBlock({ text, spec, layer, canvas, maxW, measure, family }) {
  const { width: W, height: H } = canvas;
  const bold = spec.bold === true;
  const raw = String(text).replace(/[{}\\]/g, '');
  const shown = spec.uppercase ? raw.toLocaleUpperCase() : raw;
  const lh = num(spec.line_height, 1.2);
  const maxLines = Math.max(1, Math.round(num(spec.max_lines, layer === 'caption' ? 2 : 3)));
  const box = obj(spec.box) ? spec.box : null;
  const padX = box ? Math.round(W * num(box.pad_x_pct, 1.6) / 100) : 0;
  const padY = box ? Math.round(H * num(box.pad_y_pct, 0.8) / 100) : 0;
  const outline = obj(spec.outline) ? Math.max(1, Math.round(H * num(spec.outline.width_pct, 0.15) / 100)) : 0;
  const shadow = obj(spec.shadow) ? Math.max(0, Math.round(H * num(spec.shadow.depth_pct, 0.1) / 100)) : 0;
  const ext = outline + shadow;
  const rule = obj(spec.rule) ? {
    th: Math.max(2, Math.round(H * num(spec.rule.thickness_pct, 0.25) / 100)),
    gap: Math.round(H * num(spec.rule.gap_pct, 1) / 100),
    w: Math.min(maxW, Math.round(W * num(spec.rule.width_pct, 12) / 100)),
    position: spec.rule.position === 'below' ? 'below' : 'above',
  } : null;
  const textMax = maxW - 2 * padX - 2 * ext;
  const from = num(spec.size_pct, 4), to = Math.min(from, num(spec.min_size_pct, from));
  const ml = (px) => (s) => measure(s, px, { family, bold });
  for (let s = from; s >= to - 1e-9; s = Math.round((s - 0.2) * 100) / 100) {
    const px = Math.round(H * s / 100);
    const lines = textMax > 0 ? wrapText(shown, textMax, ml(px)) : null;
    if (!lines || lines.length > maxLines) continue;
    const widths = lines.map(ml(px));
    const textW = Math.max(...widths), textH = Math.round(lines.length * px * lh);
    const w = Math.ceil(Math.max(textW + 2 * padX + 2 * ext, rule ? rule.w : 0));
    const h = Math.ceil(textH + 2 * padY + 2 * ext + (rule ? rule.th + rule.gap : 0));
    return { text: shown, lines, widths, px, textW, textH, w, h, padX, padY, outline, shadow, ext, rule, bold, lh };
  }
  nofit(`«${String(text).slice(0, 60)}» (${layer}) no entra en ${Math.round(maxW)} px con ${maxLines} línea(s) ni con el tamaño mínimo del preset`);
}

/** Agrupa las palabras de los subtítulos de `min` a `max`, cortando en puntuación, cambio de persona o pausa. PURO. */
export function groupCaptionWords(words, { min = 3, max = 4, maxGapMs = 700 } = {}) {
  if (!(min >= 1 && max >= min && max <= 8)) bad(`agrupación de subtítulos inválida: ${min}–${max}`);
  const groups = [];
  let cur = [];
  const flush = () => { if (cur.length) groups.push(cur); cur = []; };
  for (const w of words) {
    const last = cur[cur.length - 1];
    if (last && ((w.person_id ?? null) !== (last.person_id ?? null) || Number(w.start_ms) - Number(last.end_ms) > maxGapMs)) flush();
    cur.push(w);
    if (cur.length >= max || (cur.length >= min && /[.,;:!?…]["»”)]?$/.test(String(w.text)))) flush();
  }
  flush();
  return groups;
}

/** Las palabras del timeline, sin etiquetas de interpretación y en orden. Forma inválida → VIDEOLAB_BAD_REQUEST. PURO. */
export function timelineWords(timeline) {
  const raw = timeline?.words;
  if (!Array.isArray(raw)) return [];
  raw.forEach((w, i) => {
    if (!obj(w) || typeof w.text !== 'string' || !nonNeg(w.start_ms) || !(nonNeg(w.end_ms) && Number(w.end_ms) >= Number(w.start_ms))) {
      bad(`timeline.words[${i}] necesita text, start_ms ≥ 0 y end_ms ≥ start_ms`);
    }
  });
  // Un espacio dentro de una palabra se vuelve no separable: una palabra de la voz es una palabra en pantalla.
  return spokenWords(raw).map((w) => ({ ...w, text: w.text.replace(/\s+/g, '\u00a0'), start_ms: Number(w.start_ms), end_ms: Number(w.end_ms) }))
    .sort((a, b) => a.start_ms - b.start_ms);
}

/** Las caras declaradas (`timeline.faces[]`, cajas en % del lienzo) en píxeles, con su tramo. PURO. */
export function facesPx(timeline, canvas) {
  const out = [];
  (Array.isArray(timeline?.faces) ? timeline.faces : []).forEach((f, i) => {
    const b = f?.box;
    if (!obj(b) || ![b.x, b.y, b.w, b.h].every(nonNeg)) bad(`timeline.faces[${i}].box necesita x, y, w, h en % del lienzo`);
    out.push({ x: canvas.width * b.x / 100, y: canvas.height * b.y / 100, w: canvas.width * b.w / 100, h: canvas.height * b.h / 100,
      start_ms: nonNeg(f.start_ms) ? Number(f.start_ms) : 0, end_ms: nonNeg(f.end_ms) ? Number(f.end_ms) : Infinity, person_id: f.person_id ?? null });
  });
  return out;
}

// ─────────────────────────────────────────────────── ASS ───────────────────────────────────────────────────

const ts = (ms) => {
  const t = Math.max(0, Math.round(ms / 10));
  const cs = t % 100, s = Math.floor(t / 100) % 60, m = Math.floor(t / 6000) % 60, h = Math.floor(t / 360000);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
};
/** El texto va VERBATIM; sólo se quitan los caracteres que libass interpreta como órdenes. */
const clean = (s) => String(s).replace(/[{}\\]/g, '');
const norm = (s) => String(s).toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
const R = (n) => Math.round(n);

function roundedRect(w, h, r) {
  r = Math.max(0, Math.min(r, Math.floor(Math.min(w, h) / 2)));
  if (!r) return `m 0 0 l ${w} 0 ${w} ${h} 0 ${h}`;
  const k = Math.round(r * 0.45);
  return `m ${r} 0 l ${w - r} 0 b ${w - k} 0 ${w} ${k} ${w} ${r} l ${w} ${h - r} b ${w} ${h - k} ${w - k} ${h} ${w - r} ${h} ` +
    `l ${r} ${h} b ${k} ${h} 0 ${h - k} 0 ${h - r} l 0 ${r} b 0 ${k} ${k} 0 ${r} 0`;
}

/** Etiquetas de entrada y salida para un evento. `kind`: 'text' | 'box' | 'rule'. Devuelve {tags, move}. PURO. */
function motion(spec, { kind, x, y, rect, canvas, durMs }) {
  const entry = spec.entry ?? 'fade';
  const d = Math.max(0, Math.round(num(spec.duration_ms, 300)));
  const exitMs = Math.max(0, Math.round(num(spec.exit_ms, 200)));
  const inMs = Math.min(d, Math.max(0, durMs - exitMs));
  const sf = R(num(spec.scale_from, 0.85) * 100);
  const off = R(canvas.width * num(spec.slide_from_pct, 3) / 100);
  const rise = R(canvas.height * num(spec.slide_from_pct, 1.5) / 100);
  const clipFull = `\\clip(${R(rect.x)},${R(rect.y)},${R(rect.x + rect.w)},${R(rect.y + rect.h)})`;
  let tags = '';
  let pos = `\\pos(${R(x)},${R(y)})`;
  switch (entry) {
    case 'slide': pos = `\\move(${R(x - off)},${R(y)},${R(x)},${R(y)},0,${inMs})`; tags += `\\fad(${inMs},${exitMs})`; break;
    case 'rise': pos = `\\move(${R(x)},${R(y + rise)},${R(x)},${R(y)},0,${inMs})`; tags += `\\fad(${inMs},${exitMs})`; break;
    case 'mask':
      tags += `\\clip(${R(rect.x)},${R(rect.y)},${R(rect.x) + 1},${R(rect.y + rect.h)})\\t(0,${inMs},${clipFull})\\fad(0,${exitMs})`;
      return { tags: pos + tags, clipped: true };
    case 'pop':
      tags += `\\fad(${Math.min(inMs, 120)},${exitMs})`;
      if (kind === 'text') tags += `\\fscx${sf}\\fscy${sf}\\t(0,${inMs},\\fscx100\\fscy100)`;
      break;
    case 'punch': {
      const blur = num(spec.blur_from, 4);
      tags += `\\fad(${Math.min(inMs, 80)},${exitMs})`;
      if (kind === 'text') tags += `\\fscx${R(num(spec.scale_from, 1.3) * 100)}\\fscy${R(num(spec.scale_from, 1.3) * 100)}\\blur${blur}\\t(0,${inMs},\\fscx100\\fscy100\\blur0)`;
      break;
    }
    case 'draw':
      if (kind === 'rule') return { tags: pos + `\\clip(${R(rect.x)},${R(rect.y)},${R(rect.x) + 1},${R(rect.y + rect.h)})\\t(0,${inMs},${clipFull})\\fad(0,${exitMs})`, clipped: true };
      tags += `\\fad(${inMs},${exitMs})`;
      break;
    default: tags += `\\fad(${kind === 'text' && (entry === 'type' || entry === 'pop_words') ? 0 : inMs},${exitMs})`;
  }
  return { tags: pos + tags, clipped: false };
}

/** Texto de un bloque con énfasis y entradas por palabra o por carácter. PURO. */
function blockText(m, spec, { emphasis = [], baseColor, emphasisColor, durMs }) {
  const emph = new Set(emphasis.flatMap((e) => String(e).split(/\s+/)).map(norm).filter(Boolean));
  const entry = spec.entry ?? 'fade';
  const d = Math.max(0, num(spec.duration_ms, 300));
  const totalChars = m.lines.join(' ').length || 1;
  const stagger = Math.max(10, num(spec.stagger_ms, entry === 'type' ? Math.min(60, d / totalChars) : 120));
  const sf = R(num(spec.scale_from, 0.85) * 100);
  let ci = 0, wi = 0;
  const lines = m.lines.map((line) => line.split(' ').map((word) => {
    const isEm = emph.has(norm(word));
    const col = isEm ? `{\\c${emphasisColor}}` : '';
    const back = isEm ? `{\\c${baseColor}}` : '';
    let body;
    if (entry === 'type') {
      body = [...clean(word)].map((ch) => {
        const t = Math.min(R(ci++ * stagger), Math.max(0, durMs - 1));
        return `{\\alpha&HFF&\\t(${t},${t + 1},\\alpha&H00&)}${ch}`;
      }).join('');
      ci++;
    } else if (entry === 'pop_words') {
      const t = Math.min(R(wi++ * stagger), Math.max(0, durMs - 1));
      body = `{\\alpha&HFF&\\fscx${sf}\\fscy${sf}\\t(${t},${t + Math.max(1, R(d))},\\alpha&H00&\\fscx100\\fscy100)}${clean(word)}`;
    } else body = clean(word);
    return `${col}${body}${back}`;
  }).join(' '));
  return lines.join('\\N');
}

/**
 * El plan completo: guion ASS, filtros de ffmpeg (franja de identidad), familias usadas y la geometría de cada bloque
 * (para tests y para la salida). `typography`: filas de `brand_typography` de la marca. `measure(text, px, {family,
 * bold})`: la medida (real o conservadora). PURO.
 */
export function buildTextLayers({ textLayers: tl, timeline = null, presets, brandId, palette, typography, tokens = null,
  safeZone, canvas, durationMs, measure = estimateMeasure }) {
  validateTextLayers(tl);
  if (!(pos(canvas?.width) && pos(canvas?.height))) bad('lienzo inválido');
  if (!pos(durationMs)) bad('la duración del video base es desconocida');
  const { width: W, height: H } = canvas;
  const safe = safeRect(safeZone, canvas);
  const slots = colorSlots({ tokens, textLayers: tl });
  const color = (ref) => resolveColor(ref, { slots, palette });
  const families = new Set();
  const family = (spec, layer) => {
    const role = spec.font_role ?? DEFAULT_FONT_ROLE[layer];
    const row = (typography ?? []).find((t) => t?.role === role);
    if (!str(row?.font_family)) bad(`brand_typography no tiene el rol ${role} para la marca ${brandId}`);
    families.add(row.font_family);
    return row.font_family;
  };
  const span = (start, end, what) => {
    if (start >= durationMs) bad(`${what} empieza en ${start} ms, después del final del video (${durationMs} ms)`);
    return { start_ms: start, end_ms: Math.min(end, durationMs) };
  };

  const styles = new Map();
  const events = [];
  const blocks = [];
  const styleFor = (name, fam, spec, m, textHex) => {
    if (!styles.has(name)) {
      const outCol = obj(spec.outline) ? assColor(color(spec.outline.color ?? '#000000')) : '&H00000000&';
      const shCol = obj(spec.shadow) ? assColor(color(spec.shadow.color ?? '#000000'), num(spec.shadow.alpha, 0.5)) : '&H00000000&';
      styles.set(name, `Style: ${name},${fam},${m.px},${assColor(textHex)},${assColor(textHex)},${outCol},${shCol},` +
        `${m.bold ? -1 : 0},0,0,0,100,100,${num(spec.letter_spacing_px, 0)},0,1,${m.outline},${m.shadow},7,0,0,0,1`);
    }
    return name;
  };
  const clipSafe = `\\clip(${safe.x},${safe.y},${safe.x1},${safe.y1})`;

  /** Dibuja un bloque ya colocado: caja, filete y texto. */
  const draw = ({ layer, key, spec, m, rect, t, textHex, emphasis = [], styleName, fam, align }) => {
    const dur = t.end_ms - t.start_ms;
    const ruleOff = m.rule && m.rule.position === 'above' ? m.rule.th + m.rule.gap : 0;
    const content = { x: rect.x, y: rect.y + ruleOff, w: rect.w, h: rect.h - (m.rule ? m.rule.th + m.rule.gap : 0) };
    if (obj(spec.box)) {
      const bhex = color(spec.box.color ?? 'scrim');
      const op = num(spec.box.opacity, 0.85);
      const mv = motion(spec, { kind: 'box', x: content.x, y: content.y, rect, canvas, durMs: dur });
      let loop = '';
      if (obj(spec.loop) && spec.loop.type === 'shimmer') {
        const period = Math.max(400, num(spec.loop.period_ms, 1600));
        const low = op * (1 - Math.min(0.9, num(spec.loop.intensity, 0.35)));
        for (let a = num(spec.duration_ms, 300), n = 0; a + period <= dur && n < 40; a += period, n++) {
          loop += `\\t(${R(a)},${R(a + period / 2)},\\alpha${assAlpha(low)})\\t(${R(a + period / 2)},${R(a + period)},\\alpha${assAlpha(op)})`;
        }
      }
      events.push(`Dialogue: 0,${ts(t.start_ms)},${ts(t.end_ms)},${styleName},,0,0,0,,{\\an7${mv.tags}${mv.clipped ? '' : clipSafe}\\bord0\\shad0\\blur0\\c${assColor(bhex)}\\alpha${assAlpha(op)}${loop}\\p1}` +
        `${roundedRect(R(content.w), R(content.h), R(H * num(spec.box.radius_pct, 0.6) / 100))}{\\p0}`);
    }
    if (m.rule) {
      const rhex = color(spec.rule.color ?? 'rule');
      const ry = m.rule.position === 'above' ? rect.y : rect.y + rect.h - m.rule.th;
      const rx = align === 'center' ? rect.x + (rect.w - m.rule.w) / 2 : rect.x;
      const rr = { x: rx, y: ry, w: m.rule.w, h: m.rule.th };
      const mv = motion(spec, { kind: 'rule', x: rx, y: ry, rect: rr, canvas, durMs: dur });
      events.push(`Dialogue: 1,${ts(t.start_ms)},${ts(t.end_ms)},${styleName},,0,0,0,,{\\an7${mv.tags}${mv.clipped ? '' : clipSafe}\\bord0\\shad0\\c${assColor(rhex)}\\p1}` +
        `m 0 0 l ${R(m.rule.w)} 0 ${R(m.rule.w)} ${R(m.rule.th)} 0 ${R(m.rule.th)}{\\p0}`);
    }
    const tx = align === 'center' ? content.x + content.w / 2 : content.x + m.padX + m.ext;
    const ty = content.y + m.padY + m.ext;
    const mv = motion(spec, { kind: 'text', x: tx, y: ty, rect, canvas, durMs: dur });
    const body = blockText(m, spec, { emphasis, baseColor: assColor(textHex), emphasisColor: assColor(color(spec.emphasis_color ?? 'accent')), durMs: dur });
    events.push(`Dialogue: 2,${ts(t.start_ms)},${ts(t.end_ms)},${styleName},,0,0,0,,{\\an${align === 'center' ? 8 : 7}${mv.tags}${mv.clipped ? '' : clipSafe}}${body}`);
    blocks.push({ layer, preset_key: key, rect: { x: R(rect.x), y: R(rect.y), w: R(rect.w), h: R(rect.h) }, start_ms: t.start_ms, end_ms: t.end_ms, size_px: m.px, lines: m.lines.length });
  };

  // 1 · Banda de subtítulos (fija abajo de la zona segura): el resto se coloca respecto de ella.
  let band = null;
  let capPlan = null;
  if (tl.captions && tl.captions.enabled !== false) {
    const row = resolveTextPreset(presets, tl.captions.preset_key, brandId, 'caption');
    const spec = row.spec;
    const words = timelineWords(timeline);
    if (!words.length) bad('los subtítulos necesitan timeline.words');
    const fam = family(spec, 'caption');
    const groups = groupCaptionWords(words, { min: num(spec.group_min, 3), max: num(spec.group_max, 4), maxGapMs: num(spec.max_gap_ms, 700) });
    const ms = groups.map((g) => measureBlock({ text: g.map((w) => w.text).join(' '), spec, layer: 'caption', canvas, maxW: safe.w, measure, family: fam }));
    const top = measureBlock({ text: 'Mg', spec: { ...spec, max_lines: 1 }, layer: 'caption', canvas, maxW: safe.w, measure, family: fam });
    const lines = Math.max(1, Math.round(num(spec.max_lines, 2)));
    const bandH = Math.ceil(lines * top.px * top.lh + 2 * top.padY + 2 * top.ext);
    if (bandH > safe.h) nofit('la banda de subtítulos no entra en la zona segura');
    band = { x: safe.x, y: safe.y1 - bandH, w: safe.w, h: bandH };
    capPlan = { row, spec, fam, groups, ms };
    blocks.push({ layer: 'caption_band', preset_key: row.preset_key, rect: band, start_ms: words[0].start_ms, end_ms: Math.min(durationMs, words[words.length - 1].end_ms) });
  }
  const margin = Math.ceil(H * ROLE_CAPTION_MARGIN_PCT / 100);
  const floorY = band ? band.y - margin : safe.y1;

  const place = (m, spec, layer, align, anchorDefault) => {
    const anchor = spec.anchor ?? anchorDefault;
    const x = align === 'center' ? safe.x + (safe.w - m.w) / 2 : safe.x;
    let y;
    if (anchor === 'top') y = safe.y;
    else if (anchor === 'center') y = safe.y + (floorY - safe.y - m.h) / 2;
    else if (anchor === 'above_captions' || anchor === 'lower_third') y = floorY - m.h;
    else bad(`anchor desconocido en el preset: ${anchor}`);
    const r = { x, y, w: m.w, h: m.h };
    if (r.y < safe.y || r.y + r.h > floorY + 0.5) nofit(`${layer}: el bloque mide ${m.h} px y no entra entre la zona segura y los subtítulos`);
    return r;
  };

  // 2026-11-16 — LAS CARAS MANDAN EN TODAS LAS CAPAS. Antes sólo el rol esquivaba caras: el CTA y un título clave cayeron
  // sobre la cara de quien hablaba (prueba del set de conversación, lab_jobs 178d2258). Cada bloque se coloca en el ancla de su preset y,
  // si en su tramo tapa una cara (`timeline.faces`) u otro texto, se corre en vertical —hacia arriba y hacia abajo,
  // alternando— dentro de la zona segura y sobre los subtítulos. Si no hay lugar libre, queda en su ancla y se avisa
  // (`warnings`): nunca se descarta texto en silencio.
  const faces = facesPx(timeline, canvas);
  const warnings = [];
  const dodge = (rect, t, label) => {
    const busy = [...faces.filter((f) => f.start_ms < t.end_ms && t.start_ms < f.end_ms),
      ...blocks.filter((b) => b.layer !== 'caption_band' && overlapT(b, t)).map((b) => b.rect)];
    if (!busy.some((f) => inter(rect, f))) return rect;
    const step = Math.max(1, Math.round(H * 0.005));
    for (let d = step; d <= H; d += step) {
      for (const y of [rect.y - d, rect.y + d]) {
        if (y < safe.y || y + rect.h > floorY + 0.5) continue;
        const c = { ...rect, y };
        if (!busy.some((f) => inter(c, f))) return c;
      }
    }
    warnings.push(`TEXT_OVER_FACE: ${label} no tiene lugar libre de caras en la zona segura; queda en el ancla de su preset`);
    return rect;
  };

  // 2 · Gancho.
  if (tl.hook) {
    const row = resolveTextPreset(presets, tl.hook.preset_key, brandId, 'hook');
    const spec = row.spec, fam = family(spec, 'hook');
    const align = spec.align === 'left' ? 'left' : 'center';
    const m = measureBlock({ text: tl.hook.text, spec, layer: 'hook', canvas, maxW: safe.w * num(spec.max_width_pct, 100) / 100, measure, family: fam });
    const tH = span(Number(tl.hook.start_ms), Number(tl.hook.end_ms), 'hook');
    const rect = dodge(place(m, spec, 'hook', align, 'top'), tH, 'hook');
    const textHex = color(spec.color ?? 'text');
    draw({ layer: 'hook', key: row.preset_key, spec, m, rect, t: tH, textHex,
      emphasis: tl.hook.emphasis ?? [], styleName: styleFor(`H_${row.preset_key}`, fam, spec, m, textHex), fam, align });
  }

  // 3 · Títulos clave y CTA.
  for (const [i, k] of (tl.key_titles ?? []).entries()) {
    const row = resolveTextPreset(presets, k.preset_key, brandId, 'key_title');
    const spec = row.spec, fam = family(spec, 'key_title');
    const align = spec.align === 'left' ? 'left' : 'center';
    const m = measureBlock({ text: k.text, spec, layer: 'key_title', canvas, maxW: safe.w * num(spec.max_width_pct, 100) / 100, measure, family: fam });
    const tK = span(Number(k.at_ms), Number(k.at_ms) + Number(k.dur_ms), `key_titles[${i}]`);
    const rect = dodge(place(m, spec, `key_titles[${i}]`, align, 'center'), tK, `key_titles[${i}]`);
    const textHex = color(spec.color ?? 'text');
    draw({ layer: 'key_title', key: row.preset_key, spec, m, rect, t: tK, textHex,
      styleName: styleFor(`K_${row.preset_key}`, fam, spec, m, textHex), fam, align });
  }
  if (tl.cta) {
    const row = resolveTextPreset(presets, tl.cta.preset_key, brandId, 'cta');
    const spec = row.spec, fam = family(spec, 'cta');
    const align = spec.align === 'left' ? 'left' : 'center';
    const m = measureBlock({ text: tl.cta.text, spec, layer: 'cta', canvas, maxW: safe.w * num(spec.max_width_pct, 100) / 100, measure, family: fam });
    const at = Number(tl.cta.at_ms);
    const tC = span(at, tl.cta.dur_ms ? at + Number(tl.cta.dur_ms) : durationMs, 'cta');
    const rect = dodge(place(m, spec, 'cta', align, 'above_captions'), tC, 'cta');
    const textHex = color(spec.color ?? 'text');
    draw({ layer: 'cta', key: row.preset_key, spec, m, rect, t: tC, textHex,
      styleName: styleFor(`C_${row.preset_key}`, fam, spec, m, textHex), fam, align });
  }

  // 4 · Rol de cada persona: tercio inferior, sobre los subtítulos, al borde seguro izquierdo; sube si hay una cara.
  for (const [i, r] of (tl.roles ?? []).entries()) {
    if (r.show === false) continue;
    const row = resolveTextPreset(presets, r.preset_key, brandId, 'role');
    const spec = row.spec, fam = family(spec, 'role');
    const text = str(spec.split_on) ? String(r.text).split(spec.split_on).map((s) => s.trim()).filter(Boolean).join('\n') : r.text;
    const m = measureBlock({ text, spec: { max_lines: str(spec.split_on) ? 4 : 2, ...spec }, layer: 'role', canvas,
      maxW: safe.w * num(spec.max_width_pct, 80) / 100, measure, family: fam });
    const t = span(Number(r.at_ms), Number(r.at_ms) + Number(r.dur_ms), `roles[${i}]`);
    // Obstáculos: las caras de ese tramo y los bloques ya colocados que coinciden en el tiempo.
    const busy = [...faces.filter((f) => f.start_ms < t.end_ms && t.start_ms < f.end_ms),
      ...blocks.filter((b) => b.layer !== 'caption_band' && overlapT(b, t)).map((b) => b.rect)];
    let rect = null;
    const step = Math.max(1, Math.round(H * 0.005));
    for (let y = floorY - m.h; y >= safe.y; y -= step) {
      const cand = { x: safe.x, y, w: m.w, h: m.h };
      if (!busy.some((f) => inter(cand, f))) { rect = cand; break; }
    }
    if (!rect) nofit(`roles[${i}]: no hay lugar en la zona segura que no tape una cara ni otro texto`);
    const textHex = color(spec.color ?? 'text_body');
    draw({ layer: 'role', key: row.preset_key, spec, m, rect, t, textHex, styleName: styleFor(`R_${row.preset_key}`, fam, spec, m, textHex), fam, align: 'left' });
  }

  // 5 · Subtítulos karaoke: un evento por palabra activa, la palabra activa en el color de acento del preset.
  if (capPlan) {
    const { spec, fam, groups, ms, row } = capPlan;
    const textHex = color(spec.color ?? 'text');
    const aw = obj(spec.active_word) ? spec.active_word : {};
    const activeCol = assColor(color(aw.color ?? 'accent'));
    const scale = R(num(aw.scale, 1) * 100);
    const name = styleFor(`S_${row.preset_key}`, fam, spec, ms[0], textHex);
    const cx = R(band.x + band.w / 2), by = R(band.y + band.h - (ms[0].padY + ms[0].ext));
    groups.forEach((g, gi) => {
      const m = ms[gi];
      const gStart = g[0].start_ms, gEnd = Math.min(durationMs, g[g.length - 1].end_ms);
      if (gStart >= durationMs) return;
      if (obj(spec.box)) {
        const bw = R(m.w), bh = R(m.h);
        events.push(`Dialogue: 0,${ts(gStart)},${ts(gEnd)},${name},,0,0,0,,{\\an2\\pos(${cx},${R(band.y + band.h)})${clipSafe}\\bord0\\shad0\\c${assColor(color(spec.box.color ?? 'scrim'))}` +
          `\\alpha${assAlpha(num(spec.box.opacity, 0.85))}\\p1}${roundedRect(bw, bh, R(H * num(spec.box.radius_pct, 0.6) / 100))}{\\p0}`);
      }
      // Las palabras del grupo, con los saltos de línea que midió measureBlock.
      const flat = m.lines.flatMap((line, li) => line.split(' ').map((w, wi) => ({ w, br: li > 0 && wi === 0 })));
      g.forEach((word, k) => {
        const s = word.start_ms, e = k + 1 < g.length ? g[k + 1].start_ms : gEnd;
        if (!(e > s) || s >= durationMs) return;
        const txt = flat.map((f, fi) => `${f.br ? '\\N' : (fi ? ' ' : '')}${fi === k
          ? `{\\c${activeCol}${scale !== 100 ? `\\fscx${scale}\\fscy${scale}` : ''}}${clean(f.w)}{\\c${assColor(textHex)}\\fscx100\\fscy100}`
          : clean(f.w)}`).join('');
        events.push(`Dialogue: 2,${ts(s)},${ts(Math.min(e, durationMs))},${name},,0,0,0,,{\\an2\\pos(${cx},${by})${clipSafe}\\fs${m.px}}${txt}`);
      });
    });
  }

  // 6 · Comprobaciones duras: todo dentro de la zona segura; nada se pisa en el mismo tiempo.
  for (const b of blocks) if (!inside(b.rect, safe)) nofit(`${b.layer} (${b.preset_key}) sale de la zona segura`);
  for (let i = 0; i < blocks.length; i++) {
    for (let j = i + 1; j < blocks.length; j++) {
      if (overlapT(blocks[i], blocks[j]) && inter(blocks[i].rect, blocks[j].rect)) {
        nofit(`${blocks[i].layer} (${blocks[i].preset_key}) y ${blocks[j].layer} (${blocks[j].preset_key}) se pisan entre ${Math.max(blocks[i].start_ms, blocks[j].start_ms)} y ${Math.min(blocks[i].end_ms, blocks[j].end_ms)} ms`);
      }
    }
  }

  const filters = [];
  const strip = identityFilter({ identity: tl.identity, tokens, slots, palette, canvas, safe });
  if (strip) filters.push(strip);

  const ass = [
    '[Script Info]', 'ScriptType: v4.00+', `PlayResX: ${W}`, `PlayResY: ${H}`, 'WrapStyle: 2', 'ScaledBorderAndShadow: yes', '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    ...(styles.size ? styles.values() : [`Style: Default,${[...families][0] ?? 'sans'},40,&H00FFFFFF&,&H00FFFFFF&,&H00000000&,&H00000000&,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1`]),
    '', '[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    ...events, '',
  ].join('\n');
  return { ass, filters, families: [...families], blocks, safe, warnings };
}

/**
 * La franja de identidad como `drawbox` de ffmpeg: el modo y el ancho salen de `tokens.identity` de la marca; el color,
 * del rol pedido (`identity.strip_role`) o del de los tokens, resuelto en `brand_palette`. Sin dato → VIDEOLAB_BAD_REQUEST.
 * `full_bleed` = alto completo; si no, el alto de la zona segura. PURO.
 */
export function identityFilter({ identity, tokens, slots, palette, canvas, safe }) {
  if (!identity?.strip) return null;
  const idt = tokens?.identity;
  if (!obj(idt)) bad('la marca no declara identity en imagelab_overlay_tokens (franja)');
  const hex = resolveColor('identity', { slots, palette }).slice(1);
  if (!pos(idt.width_pct)) bad('identity.width_pct de la marca falta o no es positivo');
  const w = Math.max(1, Math.round(canvas.width * idt.width_pct / 100));
  const mode = idt.mode ?? 'edge_left';
  let x;
  if (mode === 'edge_left') x = 0;
  else if (mode === 'edge_right') x = canvas.width - w;
  else bad(`identity.mode desconocido: ${mode}`);
  const [y, h] = idt.full_bleed === false ? [safe.y, safe.h] : [0, canvas.height];
  return `drawbox=x=${x}:y=${y}:w=${w}:h=${h}:color=0x${hex}@1:t=fill`;
}

/**
 * El timeline de una conversación (contrato §4 ter.2): palabras con tiempo absoluto y persona, y el tramo de cada
 * turno. Las palabras salen de `turn.voice.alignment.words` (VoiceLab); un turno sin alineación aporta su tramo pero no
 * palabras, y se nombra en `turns_without_words`. PURO.
 */
export function conversationTimeline({ turns, cast }) {
  const words = [];
  const spans = [];
  const sinPalabras = [];
  let offset = 0;
  (turns ?? []).forEach((t, ti) => {
    const ms = Number(t?.voice?.duration_ms) || 0;
    const person = cast?.[t.seat] ?? null;
    spans.push({ turn: ti, seat: t.seat, person_id: person, start_ms: offset, end_ms: offset + ms });
    const ws = Array.isArray(t?.voice?.alignment?.words) ? spokenWords(t.voice.alignment.words) : [];
    if (!ws.length) sinPalabras.push(ti);
    for (const w of ws) {
      words.push({ text: String(w.text), start_ms: offset + Math.max(0, Number(w.start_ms)), end_ms: offset + Math.min(ms, Math.max(Number(w.start_ms), Number(w.end_ms))), person_id: person });
    }
    offset += ms;
  });
  return { words, turns: spans, turns_without_words: sinPalabras };
}

/**
 * Argumentos de ffmpeg que dibujan las capas sobre un video: franja (`drawbox`) y guion ASS (libass, con las fuentes
 * de la marca en `fontsDir`). El audio se reencoda a la especificación de salida (AAC 48 kHz estéreo). PURO.
 */
export function textLayersArgs({ input, ass, fontsDir = null, filters = [], out }) {
  const esc = (p) => String(p).replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
  const vf = [...filters, `subtitles='${esc(ass)}'${fontsDir ? `:fontsdir='${esc(fontsDir)}'` : ''}`, 'format=yuv420p'].join(',');
  return ['-y', '-i', input, '-vf', vf, '-map', '0:v:0', '-map', '0:a:0?', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-r', '30',
    '-c:a', 'aac', '-ar', '48000', '-ac', '2', '-b:a', '160k', '-movflags', '+faststart', out];
}
