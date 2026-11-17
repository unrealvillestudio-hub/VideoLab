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
import { X264 } from './x264.mjs';

export const TEXT_LAYERS = Object.freeze(['hook', 'role', 'caption', 'key_title', 'cta']);
export const ENTRIES = Object.freeze(['fade', 'pop', 'pop_words', 'mask', 'type', 'punch', 'slide', 'rise', 'draw']);
/** Entrada del rol: sutil, como mucho 350 ms y sin rebote (decisión de Sam, 2026-11-16). */
export const ROLE_MAX_ENTRY_MS = 350;
/** Palabras clave de los subtítulos por pedido (F2): la evidencia prefiere marcar el 5–15 % de las palabras. */
export const CAPTION_KEYWORDS_MAX = 12;
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
// 2026-11-16 — BLOQUES COLOCADOS A MANO (contrato v1.3.3; «bloques a mano» v1, objetivo validado por Sam). `place` =
// { x_pct, y_pct, zoom }: centro del bloque en % de la ZONA SEGURA y zoom sobre el tamaño del preset. Mismo rango de zoom
// que el `text_scale` de ImageLab. Con `place` manda el operador: el bloque no esquiva caras y se avisa si tapa una.
export const PLACE_ZOOM_MIN = 0.7;
export const PLACE_ZOOM_MAX = 1.3;
/** El spec de un preset con el zoom del operador: tamaño de partida y mínimo multiplicados. PURO. */
export function zoomSpec(spec, zoom) {
  const z = Number.isFinite(Number(zoom)) ? Number(zoom) : 1;
  if (z === 1) return spec;
  const from = num(spec.size_pct, 4);
  return { ...spec, size_pct: Math.round(from * z * 100) / 100, min_size_pct: Math.round(num(spec.min_size_pct, from) * z * 100) / 100 };
}

/** Valida una colocación. `zoomOnly`: sólo `zoom` (subtítulos). PURO. */
export function validatePlace(p, where, { zoomOnly = false } = {}) {
  if (p == null) return;
  if (!obj(p)) bad(`${where}.place debe ser un objeto { x_pct, y_pct, zoom }`);
  const z = Number(p.zoom ?? 1);
  if (!(Number.isFinite(z) && z >= PLACE_ZOOM_MIN && z <= PLACE_ZOOM_MAX)) bad(`${where}.place.zoom debe estar entre ${PLACE_ZOOM_MIN} y ${PLACE_ZOOM_MAX}`);
  if (zoomOnly) {
    if (p.x_pct != null || p.y_pct != null) bad(`${where}.place sólo admite zoom (la banda de subtítulos es fija)`);
    return;
  }
  for (const k of ['x_pct', 'y_pct']) {
    const v = Number(p[k]);
    if (p[k] == null || !(Number.isFinite(v) && v >= 0 && v <= 100)) bad(`${where}.place.${k} debe estar entre 0 y 100`);
  }
}

// 2026-11-16 — ESTILOS EN LÍNEA Y ALINEACIÓN (contrato v1.4.0; mismo vocabulario que ImageLab `text_style.<bloque>`,
// medido en ImageLab api/compose.ts 78c3fb1). Tramos LITERALES del texto del bloque: `emphasis` (resaltado: color del
// resaltado), `italic_spans` (invierte la cursiva), `bold_spans` (invierte el peso), `color_spans` (sólo color, el del
// resaltado). Hasta SPAN_MAX_TERMS tramos de ≤ SPAN_MAX_CHARS caracteres por campo, como en ImageLab.
// `emphasis_role`: rol de brand_palette para el color del resaltado del bloque. `align`: left | center | right.
export const SPAN_FIELDS = Object.freeze(['emphasis', 'italic_spans', 'bold_spans', 'color_spans']);
export const SPAN_MAX_TERMS = 3;
export const SPAN_MAX_CHARS = 60;
export const ALIGNS = Object.freeze(['left', 'center', 'right']);
export const IDENTITY_MODES = Object.freeze(['none', 'edge_left', 'edge_right', 'edge_bottom']);
const ROLE_NAME = /^[a-z0-9_]+$/;

/** Valida los campos de estilo de un bloque. `alignable`: el bloque acepta `align` (el rol no). PURO. */
export function validateBlockStyle(b, where, { alignable = true } = {}) {
  for (const f of SPAN_FIELDS) {
    const v = b[f];
    if (v == null) continue;
    if (!Array.isArray(v)) bad(`${where}.${f} debe ser una lista de tramos literales del texto`);
    if (v.length > SPAN_MAX_TERMS) bad(`${where}.${f} trae ${v.length} tramos; el máximo es ${SPAN_MAX_TERMS}`);
    v.forEach((x, k) => {
      if (!str(x)) bad(`${where}.${f}[${k}] debe ser texto no vacío`);
      if (String(x).length > SPAN_MAX_CHARS) bad(`${where}.${f}[${k}] excede ${SPAN_MAX_CHARS} caracteres`);
    });
  }
  if (b.emphasis_role != null && !(typeof b.emphasis_role === 'string' && ROLE_NAME.test(b.emphasis_role))) {
    bad(`${where}.emphasis_role debe ser el nombre de un rol de brand_palette (minúsculas, números y guion bajo)`);
  }
  if (b.align != null) {
    if (!alignable) bad(`${where}.align no aplica: el rol va siempre alineado a la izquierda`);
    if (!ALIGNS.includes(b.align)) bad(`${where}.align debe ser ${ALIGNS.join(' | ')}`);
  }
}

/**
 * Parte `text` en tramos alrededor de VARIAS subcadenas literales: cada término marca su primera aparición que no
 * se solape con un término anterior (el orden de la lista es la prioridad). Mismo algoritmo que `splitEmphasis` de
 * ImageLab. Devuelve { ranges: [[a, b]], found, missing }. PURO.
 */
export function literalRanges(text, terms) {
  const h = String(text ?? '');
  const ranges = [], found = [], missing = [];
  for (const k of terms ?? []) {
    if (!k) continue;
    let from = 0, at = -1;
    while (from <= h.length) {
      const i = h.indexOf(k, from);
      if (i < 0) break;
      if (!ranges.some(([a, b]) => i < b && i + k.length > a)) { at = i; break; }
      from = i + 1;
    }
    if (at < 0) { missing.push(k); continue; }
    ranges.push([at, at + k.length]);
    found.push(k);
  }
  return { ranges: ranges.sort((a, b) => a[0] - b[0]), found, missing };
}

/**
 * Estilo de cada carácter del texto del bloque: [{ emphasis, italic, bold, color }] (booleanos: el tramo lo pide).
 * Un término de `emphasis` que no está literal se busca, como antes de v1.4.0, por palabra normalizada (sin
 * puntuación ni mayúsculas), para no cambiar las piezas que ya existen. Lo que no se encuentra va a `missing`. PURO.
 */
export function charStyles(text, block) {
  const t = String(text ?? '');
  const flags = Array.from({ length: t.length }, () => ({ emphasis: false, italic: false, bold: false, color: false }));
  const missing = [];
  const mark = (field, key) => {
    const { ranges, missing: miss } = literalRanges(t, block?.[field] ?? []);
    for (const [a, b] of ranges) for (let i = a; i < b; i++) flags[i][key] = true;
    for (const m of miss) {
      if (field === 'emphasis') {
        const target = norm(m);
        let hit = false;
        for (const w of t.matchAll(/\S+/g)) {
          if (target && norm(w[0]) === target) { for (let i = w.index; i < w.index + w[0].length; i++) flags[i].emphasis = true; hit = true; }
        }
        if (hit) continue;
      }
      missing.push({ field, term: m });
    }
  };
  mark('emphasis', 'emphasis'); mark('italic_spans', 'italic'); mark('bold_spans', 'bold'); mark('color_spans', 'color');
  return { flags, missing };
}

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
    validateBlockStyle(h, 'hook');
    validatePlace(h.place, 'hook');
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
      validateBlockStyle(r, `roles[${i}]`, { alignable: false });
      validatePlace(r.place, `roles[${i}]`);
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
      validatePlace(c.place, 'captions', { zoomOnly: true });
      // Palabras clave de los subtítulos (F2): las que un preset con `active_word.mode: 'keywords'` marca en el acento.
      if (c.keywords != null) {
        if (!Array.isArray(c.keywords) || c.keywords.length > CAPTION_KEYWORDS_MAX
          || c.keywords.some((k) => typeof k !== 'string' || !k.trim() || k.length > SPAN_MAX_CHARS)) {
          bad(`captions.keywords: hasta ${CAPTION_KEYWORDS_MAX} textos no vacíos de hasta ${SPAN_MAX_CHARS} caracteres`);
        }
      }
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
      validateBlockStyle(k, `key_titles[${i}]`);
      validatePlace(k.place, `key_titles[${i}]`);
      layers++;
    });
  }
  if (tl.cta != null) {
    const c = tl.cta;
    if (!obj(c)) bad('text_layers.cta debe ser un objeto o null');
    txt(c.text, 'cta'); key(c.preset_key, 'cta');
    if (!nonNeg(c.at_ms)) bad('cta.at_ms debe ser ≥ 0');
    if (c.dur_ms != null && !pos(c.dur_ms)) bad('cta.dur_ms debe ser > 0');
    validateBlockStyle(c, 'cta');
    validatePlace(c.place, 'cta');
    layers++;
  }
  if (tl.identity != null) {
    const d = tl.identity;
    if (!obj(d)) bad('text_layers.identity debe ser un objeto o null');
    // v1.4.0: `identity_role` (nombre de ImageLab) manda; `strip_role` queda como ALIAS LEGACY documentado (contrato
    // §10, v1.4.0), con retiro en un PR posterior cuando ningún pedido lo use.
    for (const k of ['identity_role', 'strip_role']) {
      if (d[k] != null && !(typeof d[k] === 'string' && ROLE_NAME.test(d[k]))) bad(`identity.${k} debe ser el nombre de un rol de brand_palette`);
    }
    if (d.identity_role != null && d.strip_role != null && d.identity_role !== d.strip_role) bad('identity.identity_role y identity.strip_role (alias) dicen roles distintos');
    if (d.strip === true) layers++;
  }
  if (!layers) bad('text_layers no pide ninguna capa');
  return tl;
}

// v1.4.0 — MOTOR DE DIBUJO, eje del sistema: `spec.engine` del preset. 'ass' (libass, por defecto y respaldo) o 'html'
// (motor HTML propio, render/src/html/). Es dato del preset, nunca de una marca.
export const TEXT_ENGINES = Object.freeze(['ass', 'html']);

/** El motor del pedido: 'html' si algún preset que usa lo declara; si no, 'ass'. PURO. */
export function engineOf(tl, rows, brandId) {
  const used = [];
  if (tl?.hook) used.push([tl.hook.preset_key, 'hook']);
  for (const r of tl?.roles ?? []) if (r?.show !== false) used.push([r.preset_key, 'role']);
  if (tl?.captions && tl.captions.enabled !== false) used.push([tl.captions.preset_key, 'caption']);
  for (const k of tl?.key_titles ?? []) used.push([k.preset_key, 'key_title']);
  if (tl?.cta) used.push([tl.cta.preset_key, 'cta']);
  return used.some(([key, layer]) => resolveTextPreset(rows, key, brandId, layer).spec.engine === 'html') ? 'html' : 'ass';
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
  if (row.spec.engine != null && !TEXT_ENGINES.includes(row.spec.engine)) bad(`el preset ${key} pide un motor desconocido: ${row.spec.engine} (${TEXT_ENGINES.join(' | ')})`);
  if (layer === 'role' && num(row.spec.duration_ms, 0) > ROLE_MAX_ENTRY_MS) {
    bad(`el preset de rol ${key} entra en ${row.spec.duration_ms} ms (tope ${ROLE_MAX_ENTRY_MS} ms)`);
  }
  if (row.spec.line_weights != null) {
    const lw = row.spec.line_weights;
    if (!Array.isArray(lw) || lw.some((w) => !(Number(w) >= 100 && Number(w) <= 900))) bad(`el preset ${key}: line_weights es una lista de pesos 100–900`);
    // La medida usa el peso del bloque: una línea más gruesa que el bloque se saldría de su caja.
    if (lw.some((w) => Number(w) >= 600) && row.spec.bold !== true) bad(`el preset ${key}: con una línea en negrita en line_weights, el bloque se mide en negrita (bold: true)`);
  }
  if (layer === 'role') {
    const p = roleMotionProblem(row.spec.motion, num(row.spec.max_lines, 3));
    if (p) bad(`el preset de rol ${key}: ${p}`);
  }
  return row;
}

/**
 * La regla del rol (≤ 350 ms y sin rebote, decisión de Sam 2026-11-16) aplicada también a `spec.motion` (F2, 2026-11-17):
 * antes sólo se miraba `duration_ms`, y un preset con pistas podía entrar más lento o rebotar sin que nadie lo viera.
 * Entrada = toda pista que no sea de salida (`from: 'end'`) ni repetida; su última clave, más el escalonado del último
 * elemento, termina en ≤ 350 ms. El escalonado sólo vale por líneas (acotado por `max_lines`): por palabra o letra no se
 * puede acotar sin el texto. Curvas con rebote o sobrepaso prohibidas: back_*, elastic_*, bounce_* y spring subamortiguado.
 * Devuelve el problema o null. PURO.
 */
export function roleMotionProblem(motion, maxLines = 3) {
  if (!motion?.tracks) return null;
  const overshoot = (e) => {
    if (typeof e !== 'string') return false;
    if (/^(back|elastic|bounce)_/.test(e)) return true;
    const m = e.match(/^spring:([\d.]+),([\d.]+)(?:,([\d.]+))?$/);
    return m ? Number(m[2]) / (2 * Math.sqrt(Number(m[1]) * Number(m[3] ?? 1))) < 1 : false;
  };
  for (const tr of motion.tracks) {
    if (tr.from === 'end' || tr.repeat) continue;
    const ks = tr.keys ?? [];
    const bouncy = ks.find((k) => overshoot(k.ease));
    if (bouncy) return `la pista ${tr.target} rebota (${bouncy.ease}); el rol entra sin rebote`;
    let end = Math.max(0, ...ks.map((k) => Number(k.t) || 0));
    if (tr.stagger) {
      if (tr.target !== 'line') return `la pista ${tr.target} escalona por ${tr.target}; en el rol sólo se escalona por línea`;
      end += Number(tr.stagger.each_ms ?? 0) * Math.max(0, maxLines - 1);
    }
    if (end > ROLE_MAX_ENTRY_MS) return `la pista ${tr.target} termina su entrada en ${end} ms (tope ${ROLE_MAX_ENTRY_MS} ms)`;
  }
  return null;
}

/**
 * Las caras tipográficas que dibuja el pedido: [{ role, bold }], un elemento por rol; `bold` es true si algún preset
 * de ese rol pide negrita (entonces se baja también la negrita real de la familia). PURO.
 */
export function fontFacesNeeded(tl, rows, brandId) {
  const roles = new Map();
  const has = (item, field) => Array.isArray(item?.[field]) && item[field].length > 0;
  const add = (key, layer, item = null) => {
    const spec = resolveTextPreset(rows, key, brandId, layer).spec;
    const role = spec.font_role ?? DEFAULT_FONT_ROLE[layer];
    const prev = roles.get(role) ?? { bold: false, italic: false };
    // v1.4.0: un tramo de `bold_spans` sobre texto regular necesita la negrita real; uno de `italic_spans`, la cursiva.
    roles.set(role, { bold: prev.bold || spec.bold === true || (spec.bold !== true && has(item, 'bold_spans')), italic: prev.italic || has(item, 'italic_spans') });
  };
  if (tl?.hook) add(tl.hook.preset_key, 'hook', tl.hook);
  for (const r of tl?.roles ?? []) if (r?.show !== false) add(r.preset_key, 'role', r);
  if (tl?.captions && tl.captions.enabled !== false) add(tl.captions.preset_key, 'caption');
  for (const k of tl?.key_titles ?? []) add(k.preset_key, 'key_title', k);
  if (tl?.cta) add(tl.cta.preset_key, 'cta', tl.cta);
  return [...roles].map(([role, f]) => ({ role, bold: f.bold, ...(f.italic ? { italic: true } : {}) }));
}

/** Los roles tipográficos que necesita el pedido (para bajar sólo esas fuentes). PURO. */
export function fontRolesNeeded(tl, rows, brandId) {
  return fontFacesNeeded(tl, rows, brandId).map((f) => f.role);
}

/**
 * La medida con la cara con la que se dibuja cada texto. `faces`: { [familia]: { regular, bold } }, cada una una medida
 * de `ttfMeasure` (o null). Negrita con cara negrita real → se mide con ella, sin engrosar; negrita sin cara real → la
 * regular engrosada (lo que hace libass); sin la familia → `fallback`. PURO.
 */
export function faceMeasure(faces, fallback = estimateMeasure) {
  return (text, sizePx, o = {}) => {
    const f = faces?.[o.family];
    if (!f?.regular) return fallback(text, sizePx, o);
    if (o.italic && f.italic && !o.bold) return f.italic(text, sizePx, o);
    if (o.bold && f.bold) return f.bold(text, sizePx, { ...o, bold: false });
    return f.regular(text, sizePx, o);
  };
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
    identity: textLayers?.identity?.identity_role ?? textLayers?.identity?.strip_role ?? tokens?.identity?.palette ?? null,
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
 * interletrado (que casi siempre acorta), suma un 2 % y un 6 % más para negrita sintética (`bold: true` sólo cuando no
 * hay cara negrita real: ver `faceMeasure`). PURO sobre los bytes.
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

/**
 * Cuándo se ve cada grupo de subtítulos (F2, 2026-11-17). Una sola fuente para ASS y para el motor HTML.
 * - `spec.hold_gap_ms` (dato del preset; 0 o ausente = como antes): si la pausa hasta el grupo siguiente es ≤ ese valor,
 *   el grupo se queda en pantalla hasta que entra el siguiente. Sin esto, cada pausa corta dejaba 1–3 fotogramas sin
 *   subtítulo (parpadeo).
 * - `spec.max_cps` (dato del preset; ausente = sin tope): tope de lectura en caracteres por segundo. Un grupo que lo pasa
 *   no se corta (el karaoke sigue a la voz, que se oye): se cuenta y se avisa (`TEXT_CAPTION_FAST`). Ronda 1 de vigilancia,
 *   R1.4: las guías de lectura citan 17 cps.
 * Devuelve { times: [{ start_ms, end_ms }], fast: n, maxCps }. PURO.
 */
export function captionTimes(groups, spec, durationMs) {
  const hold = Math.max(0, num(spec?.hold_gap_ms, 0));
  const maxCps = spec?.max_cps != null ? num(spec.max_cps, 0) : null;
  let fast = 0;
  const times = groups.map((g, i) => {
    const start_ms = g[0].start_ms;
    const lastEnd = g[g.length - 1].end_ms;
    const next = groups[i + 1];
    const gap = next ? next[0].start_ms - lastEnd : Infinity;
    const end_ms = Math.min(durationMs, hold > 0 && gap >= 0 && gap <= hold ? next[0].start_ms : lastEnd);
    if (maxCps > 0) {
      const chars = g.map((w) => w.text).join(' ').length;
      const secs = Math.max(0.001, (end_ms - start_ms) / 1000);
      if (chars / secs > maxCps) fast++;
    }
    return { start_ms, end_ms };
  });
  return { times, fast, maxCps };
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
/**
 * Las palabras de cada línea del bloque medido, con sus tramos de estilo (v1.4.0): [[{ text, emphasis, runs: [{ text,
 * italic, bold, color }] }]]. `raw` es el texto que se midió (sin las llaves y barras que libass interpreta); `flags`,
 * el estilo de cada carácter de `raw` (`charStyles`). La palabra conserva la caja de presentación de la línea medida.
 * `baseBold`: el peso del bloque; un tramo de `bold_spans` lo invierte. `boldAvailable(bool)`: si existe la cara del
 * peso invertido; si no, el tramo queda con su peso (no se simula, como ImageLab) y se cuenta en `boldSkipped`. PURO.
 */
export function blockWords(m, raw, flags, { baseBold = false, boldAvailable = () => true } = {}) {
  const tokens = [...String(raw).matchAll(/\S+/g)];
  let k = 0, boldSkipped = 0;
  const lines = m.lines.map((line) => line.split(' ').filter((w) => w !== '').map((shown) => {
    const tok = tokens[k++];
    const f = tok ? flags.slice(tok.index, tok.index + tok[0].length) : [];
    const same = tok && tok[0].length === shown.length;
    const runs = [];
    for (let i = 0; i < shown.length; i++) {
      const g = same ? (f[i] ?? {}) : (f[0] ?? {});
      let bold = baseBold;
      if (g.bold) { if (boldAvailable(!baseBold)) bold = !baseBold; else boldSkipped++; }
      const st = { italic: !!g.italic, bold, color: !!(g.emphasis || g.color) };
      const last = runs[runs.length - 1];
      if (last && last.italic === st.italic && last.bold === st.bold && last.color === st.color) last.text += shown[i];
      else runs.push({ text: shown[i], ...st });
    }
    return { text: shown, emphasis: f.some((x) => x?.emphasis), runs };
  }));
  return { lines, boldSkipped };
}

/** Texto ASS de un bloque: entradas por palabra o por carácter, y los tramos de estilo de cada palabra. PURO. */
function blockText(m, spec, { words, baseColor, emphasisColor, durMs, baseBold = false }) {
  const entry = spec.entry ?? 'fade';
  const d = Math.max(0, num(spec.duration_ms, 300));
  const totalChars = m.lines.join(' ').length || 1;
  const stagger = Math.max(10, num(spec.stagger_ms, entry === 'type' ? Math.min(60, d / totalChars) : 120));
  const sf = R(num(spec.scale_from, 0.85) * 100);
  let ci = 0, wi = 0;
  const runTags = (r) => `${r.italic ? '\\i1' : ''}${r.bold !== baseBold ? (r.bold ? '\\b1' : '\\b0') : ''}${r.color ? `\\c${emphasisColor}` : ''}`;
  const resetTags = (r) => `${r.italic ? '\\i0' : ''}${r.bold !== baseBold ? (baseBold ? '\\b1' : '\\b0') : ''}${r.color ? `\\c${baseColor}` : ''}`;
  const lines = words.map((line) => line.map((w) => {
    const pieces = w.runs.map((r) => {
      const on = runTags(r), off = resetTags(r);
      let body;
      if (entry === 'type') {
        body = [...clean(r.text)].map((ch) => {
          const t = Math.min(R(ci++ * stagger), Math.max(0, durMs - 1));
          return `{\\alpha&HFF&\\t(${t},${t + 1},\\alpha&H00&)}${ch}`;
        }).join('');
      } else body = clean(r.text);
      return `${on ? `{${on}}` : ''}${body}${off ? `{${off}}` : ''}`;
    }).join('');
    if (entry === 'type') ci++;
    if (entry === 'pop_words') {
      const t = Math.min(R(wi++ * stagger), Math.max(0, durMs - 1));
      return `{\\alpha&HFF&\\fscx${sf}\\fscy${sf}\\t(${t},${t + Math.max(1, R(d))},\\alpha&H00&\\fscx100\\fscy100)}${pieces}`;
    }
    return pieces;
  }).join(' '));
  return lines.join('\\N');
}

/**
 * El plan completo: guion ASS, filtros de ffmpeg (franja de identidad), familias usadas y la geometría de cada bloque
 * (para tests y para la salida). `typography`: filas de `brand_typography` de la marca. `measure(text, px, {family,
 * bold})`: la medida (real o conservadora). PURO.
 */
export function buildTextLayers({ textLayers: tl, timeline = null, presets, brandId, palette, typography, tokens = null,
  safeZone, canvas, durationMs, measure: measureBase = estimateMeasure, faceAvail = null }) {
  // `measure` es la medida vigente: la de base, o la del bloque si trae tramos en negrita o cursiva (ver `withBlock`).
  let measure = measureBase;
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
  const drawn = [];
  const draw = (a) => {
    const { layer, key, spec, m, rect, t, textHex, emphasisHex, words, fam, align, placed = 'auto', segments = null } = a;
    // Posición por tramo de toma (v1.4.0): un evento por tramo; la entrada sólo en el primero y la salida sólo en el
    // último, para que el bloque no vuelva a entrar en cada corte.
    if (segments && segments.length > 1) {
      segments.forEach((g, k) => drawEvents({ ...a, rect: g.rect, t: { start_ms: g.start_ms, end_ms: g.end_ms },
        spec: { ...spec, ...(k > 0 ? { entry: 'fade', duration_ms: 0 } : {}), ...(k < segments.length - 1 ? { exit_ms: 0 } : {}) } }));
    } else drawEvents(a);
    const rr = (r) => ({ x: R(r.x), y: R(r.y), w: R(r.w), h: R(r.h) });
    blocks.push({ layer, preset_key: key, rect: rr(rect), start_ms: t.start_ms, end_ms: t.end_ms, size_px: m.px, lines: m.lines.length, placed, align,
      ...(segments && segments.length > 1 ? { segments: segments.map((g) => ({ start_ms: g.start_ms, end_ms: g.end_ms, rect: rr(g.rect) })) } : {}) });
    drawn.push({ layer, preset_key: key, spec, m, rect, t, textHex, emphasisHex, words, family: fam, align, placed });
  };
  const drawEvents = ({ spec, m, rect, t, textHex, emphasisHex, words, styleName, align }) => {
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
      const rx = align === 'center' ? rect.x + (rect.w - m.rule.w) / 2 : align === 'right' ? rect.x + rect.w - m.rule.w : rect.x;
      const rr = { x: rx, y: ry, w: m.rule.w, h: m.rule.th };
      const mv = motion(spec, { kind: 'rule', x: rx, y: ry, rect: rr, canvas, durMs: dur });
      events.push(`Dialogue: 1,${ts(t.start_ms)},${ts(t.end_ms)},${styleName},,0,0,0,,{\\an7${mv.tags}${mv.clipped ? '' : clipSafe}\\bord0\\shad0\\c${assColor(rhex)}\\p1}` +
        `m 0 0 l ${R(m.rule.w)} 0 ${R(m.rule.w)} ${R(m.rule.th)} 0 ${R(m.rule.th)}{\\p0}`);
    }
    const tx = align === 'center' ? content.x + content.w / 2 : align === 'right' ? content.x + content.w - m.padX - m.ext : content.x + m.padX + m.ext;
    const ty = content.y + m.padY + m.ext;
    const mv = motion(spec, { kind: 'text', x: tx, y: ty, rect, canvas, durMs: dur });
    const body = blockText(m, spec, { words, baseColor: assColor(textHex), emphasisColor: assColor(emphasisHex), durMs: dur, baseBold: m.bold });
    events.push(`Dialogue: 2,${ts(t.start_ms)},${ts(t.end_ms)},${styleName},,0,0,0,,{\\an${align === 'center' ? 8 : align === 'right' ? 9 : 7}${mv.tags}${mv.clipped ? '' : clipSafe}}${body}`);
  };

  // 1 · Banda de subtítulos (fija abajo de la zona segura): el resto se coloca respecto de ella.
  let band = null;
  let capPlan = null;
  let capWarning = null;
  if (tl.captions && tl.captions.enabled !== false) {
    const row = resolveTextPreset(presets, tl.captions.preset_key, brandId, 'caption');
    // Zoom del operador sobre los subtítulos (contrato v1.3.3): sólo tamaño; la banda sigue fija abajo.
    const spec = tl.captions.place?.zoom != null ? zoomSpec(row.spec, Number(tl.captions.place.zoom)) : row.spec;
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
    const ct = captionTimes(groups, spec, durationMs);
    capPlan = { row, spec, fam, groups, ms, times: ct.times };
    if (ct.fast) capWarning = `TEXT_CAPTION_FAST: ${ct.fast} de ${groups.length} grupos de subtítulos pasan de ${ct.maxCps} caracteres por segundo (tope de lectura del preset ${row.preset_key})`;
    blocks.push({ layer: 'caption_band', preset_key: row.preset_key, rect: band, start_ms: words[0].start_ms, end_ms: Math.min(durationMs, words[words.length - 1].end_ms) });
  }
  const margin = Math.ceil(H * ROLE_CAPTION_MARGIN_PCT / 100);
  const floorY = band ? band.y - margin : safe.y1;

  const place = (m, spec, layer, align, anchorDefault) => {
    const anchor = spec.anchor ?? anchorDefault;
    const x = align === 'center' ? safe.x + (safe.w - m.w) / 2 : align === 'right' ? safe.x1 - m.w : safe.x;
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
  const warnings = capWarning ? [capWarning] : [];
  // Un lugar libre en vertical a partir de `rect`, o null. PURO respecto de lo ya colocado.
  const rectsIn = (b, t) => (b.segments ? b.segments.filter((g) => overlapT(g, t)).map((g) => g.rect) : [b.rect]);
  const freeSpot = (rect, t) => {
    const busy = [...faces.filter((f) => f.start_ms < t.end_ms && t.start_ms < f.end_ms),
      ...blocks.filter((b) => b.layer !== 'caption_band' && overlapT(b, t)).flatMap((b) => rectsIn(b, t))];
    if (!busy.some((f) => inter(rect, f))) return rect;
    const step = Math.max(1, Math.round(H * 0.005));
    for (let d = step; d <= H; d += step) {
      for (const y of [rect.y - d, rect.y + d]) {
        if (y < safe.y || y + rect.h > floorY + 0.5) continue;
        const c = { ...rect, y };
        if (!busy.some((f) => inter(c, f))) return c;
      }
    }
    return null;
  };
  // 2026-11-16 (2) — ANTES DE CEDER, MÁS PEQUEÑO. En un primer plano vertical la cara ocupa el centro y un gancho a su
  // tamaño de partida no cabe ni arriba ni abajo (medido: re-render de la prueba del set de conversación). Se prueba el
  // bloque de su tamaño de partida hacia el mínimo del preset, de 0,4 en 0,4; el primero que tiene lugar libre se queda.
  // Si ninguno, el de tamaño de partida en su ancla, con aviso.
  const fitFree = ({ text, spec, layer, label, align, anchorDefault, t, maxW, fam }) => {
    const from = num(spec.size_pct, 4), to = Math.min(from, num(spec.min_size_pct, from));
    const sizes = [];
    for (let v = from; v > to + 1e-9; v = Math.round((v - 0.4) * 100) / 100) sizes.push(v);
    sizes.push(to);
    let first = null;
    for (const v of sizes) {
      let m, r0;
      try {
        m = measureBlock({ text, spec: { ...spec, size_pct: v }, layer, canvas, maxW, measure, family: fam });
        r0 = place(m, spec, label, align, anchorDefault);
      } catch (e) { if (v === sizes[sizes.length - 1] && !first) throw e; continue; }
      if (!first) first = { m, rect: r0 };
      const r = freeSpot(r0, t);
      if (r) return { m, rect: r, placed: 'auto' };
    }
    // F1 (v1.4.0) — POSICIÓN POR TRAMO DE TOMA. Si el bloque cruza un cambio de plano (las caras cambian dentro de su
    // tramo), puede que no haya un sitio libre para TODO el tramo pero sí uno en cada plano. Se parte el tramo en los
    // cambios de caras y, al tamaño de partida, se busca sitio en cada sub-tramo. El bloque salta de sitio justo en el
    // corte, donde el salto no se ve. Sólo si todos los sub-tramos tienen sitio; si no, el ancla con aviso, como antes.
    const cuts = [...new Set(faces.flatMap((f) => [f.start_ms, f.end_ms]).filter((x) => x > t.start_ms && x < t.end_ms))].sort((a, b) => a - b);
    if (cuts.length) {
      const edges = [t.start_ms, ...cuts, t.end_ms];
      // Mismo tamaño en todos los tramos: del de partida al mínimo, el primero que tiene sitio en TODOS.
      for (const v of sizes) {
        let m, r0;
        try {
          m = measureBlock({ text, spec: { ...spec, size_pct: v }, layer, canvas, maxW, measure, family: fam });
          r0 = place(m, spec, label, align, anchorDefault);
        } catch { continue; }
        const segments = [];
        for (let k = 0; k + 1 < edges.length; k++) {
          const sub = { start_ms: edges[k], end_ms: edges[k + 1] };
          const r = freeSpot(r0, sub);
          if (!r) { segments.length = 0; break; }
          const prevSeg = segments[segments.length - 1];
          if (prevSeg && prevSeg.rect.x === r.x && prevSeg.rect.y === r.y) prevSeg.end_ms = sub.end_ms;   // mismo sitio: se une
          else segments.push({ ...sub, rect: r });
        }
        if (segments.length > 1) return { m, rect: segments[0].rect, segments, placed: 'auto' };
        if (segments.length === 1) return { m, rect: segments[0].rect, placed: 'auto' };
      }
    }
    warnings.push(`TEXT_OVER_FACE: ${label} no tiene lugar libre de caras ni de otro texto en la zona segura, ni al tamaño mínimo; queda en el ancla de su preset`);
    return { ...first, placed: 'auto' };
  };

  // BLOQUE COLOCADO A MANO (contrato v1.3.3). El centro en % de la zona segura y el zoom sobre el preset; se acota a la
  // zona segura y por encima de los subtítulos. No esquiva: si tapa una cara o pisa otro texto en su tramo, avisa.
  const placeManual = ({ text, spec, layer, label, t, maxW, fam, place: pl }) => {
    const m = measureBlock({ text, spec: zoomSpec(spec, Number(pl.zoom ?? 1)), layer, canvas, maxW, measure, family: fam });
    if (floorY - safe.y < m.h) nofit(`${label}: el bloque mide ${m.h} px y no entra entre la zona segura y los subtítulos`);
    const cx = safe.x + safe.w * Number(pl.x_pct) / 100, cy = safe.y + safe.h * Number(pl.y_pct) / 100;
    const x0 = cx - m.w / 2, y0 = cy - m.h / 2;
    const x = Math.min(Math.max(x0, safe.x), safe.x1 - m.w), y = Math.min(Math.max(y0, safe.y), floorY - m.h);
    if (Math.abs(x - x0) > 0.5 || Math.abs(y - y0) > 0.5) warnings.push(`TEXT_PLACE_CLAMPED: ${label} se acotó a la zona segura`);
    const rect = { x, y, w: m.w, h: m.h };
    if (faces.some((f) => f.start_ms < t.end_ms && t.start_ms < f.end_ms && inter(rect, f))) warnings.push(`TEXT_PLACED_OVER_FACE: ${label} tapa una cara (lo colocó el operador)`);
    if (blocks.some((b) => b.layer !== 'caption_band' && overlapT(b, t) && inter(rect, b.rect))) warnings.push(`TEXT_PLACED_OVERLAP: ${label} pisa otro texto (lo colocó el operador)`);
    return { m, rect, placed: 'manual' };
  };

  // v1.4.0 — ESTILOS DEL BLOQUE: tramos literales (emphasis, italic_spans, bold_spans, color_spans), color del resaltado
  // (`emphasis_role`) y alineación. La medida del bloque es CONSERVADORA si trae tramos que ensanchan: el bloque entero
  // se mide también en negrita (o en cursiva) y vale el mayor ancho, así un tramo nunca saca texto de su caja.
  const alignOf = (item, spec, layer) => (layer === 'role' ? 'left'
    : ALIGNS.includes(item.align) ? item.align : spec.align === 'left' ? 'left' : spec.align === 'right' ? 'right' : 'center');
  const withBlock = (item, spec, text, label, fam) => {
    const raw = String(text).replace(/[{}\\]/g, '');
    const { flags, missing } = charStyles(raw, item);
    for (const x of missing) warnings.push(`TEXT_SPAN_NOT_FOUND: ${label}.${x.field} «${x.term}» no está literal en el texto; no se aplica`);
    const anyBold = flags.some((f) => f.bold), anyItalic = flags.some((f) => f.italic);
    const av = faceAvail?.[fam];
    if (anyItalic && faceAvail && !av?.italic) warnings.push(`TEXT_ITALIC_SYNTHESIZED: ${label}: la familia ${fam} no ofrece cursiva; se inclina la recta`);
    measure = (anyBold || anyItalic)
      ? (s, px, o = {}) => Math.max(measureBase(s, px, o), anyBold ? measureBase(s, px, { ...o, bold: !o.bold }) : 0, anyItalic ? measureBase(s, px, { ...o, italic: true }) : 0)
      : measureBase;
    let emphasisHex = color(spec.emphasis_color ?? 'accent');
    if (item.emphasis_role) {
      const row = (palette ?? []).find((p) => p?.role === item.emphasis_role);
      if (row && HEX.test(String(row.hex ?? ''))) emphasisHex = `#${String(row.hex).replace('#', '').toUpperCase()}`;
      else warnings.push(`TEXT_EMPHASIS_ROLE_UNKNOWN: ${label}.emphasis_role «${item.emphasis_role}» no está en brand_palette; se usa el resaltado del preset`);
    }
    const wordsOf = (m) => {
      const r = blockWords(m, raw, flags, { baseBold: m.bold, boldAvailable: (toBold) => (!faceAvail || !toBold ? true : !!av?.bold) });
      if (r.boldSkipped) warnings.push(`TEXT_BOLD_UNAVAILABLE: ${label}: la familia ${fam} no ofrece la negrita real; el tramo queda con su peso (no se simula)`);
      return r.lines;
    };
    return { emphasisHex, wordsOf, done: () => { measure = measureBase; } };
  };

  // 2 · Gancho.
  if (tl.hook) {
    const row = resolveTextPreset(presets, tl.hook.preset_key, brandId, 'hook');
    const spec = row.spec, fam = family(spec, 'hook');
    const align = alignOf(tl.hook, spec, 'hook');
    const st = withBlock(tl.hook, spec, tl.hook.text, 'hook', fam);
    const tH = span(Number(tl.hook.start_ms), Number(tl.hook.end_ms), 'hook');
    const hookArgs = { text: tl.hook.text, spec, layer: 'hook', label: 'hook', align, anchorDefault: 'top', t: tH,
      maxW: safe.w * num(spec.max_width_pct, 100) / 100, fam };
    const { m, rect, placed, segments } = tl.hook.place ? placeManual({ ...hookArgs, place: tl.hook.place }) : fitFree(hookArgs);
    const textHex = color(spec.color ?? 'text');
    draw({ layer: 'hook', key: row.preset_key, spec, m, rect, segments, t: tH, textHex, placed, emphasisHex: st.emphasisHex, words: st.wordsOf(m),
      styleName: styleFor(`H_${row.preset_key}`, fam, spec, m, textHex), fam, align });
    st.done();
  }

  // 3 · Títulos clave y CTA.
  for (const [i, k] of (tl.key_titles ?? []).entries()) {
    const row = resolveTextPreset(presets, k.preset_key, brandId, 'key_title');
    const spec = row.spec, fam = family(spec, 'key_title');
    const align = alignOf(k, spec, 'key_title');
    const st = withBlock(k, spec, k.text, `key_titles[${i}]`, fam);
    const tK = span(Number(k.at_ms), Number(k.at_ms) + Number(k.dur_ms), `key_titles[${i}]`);
    const kArgs = { text: k.text, spec, layer: 'key_title', label: `key_titles[${i}]`, align, anchorDefault: 'center', t: tK,
      maxW: safe.w * num(spec.max_width_pct, 100) / 100, fam };
    const { m, rect, placed, segments } = k.place ? placeManual({ ...kArgs, place: k.place }) : fitFree(kArgs);
    const textHex = color(spec.color ?? 'text');
    draw({ layer: 'key_title', key: row.preset_key, spec, m, rect, segments, t: tK, textHex, placed, emphasisHex: st.emphasisHex, words: st.wordsOf(m),
      styleName: styleFor(`K_${row.preset_key}`, fam, spec, m, textHex), fam, align });
    st.done();
  }
  if (tl.cta) {
    const row = resolveTextPreset(presets, tl.cta.preset_key, brandId, 'cta');
    const spec = row.spec, fam = family(spec, 'cta');
    const align = alignOf(tl.cta, spec, 'cta');
    const st = withBlock(tl.cta, spec, tl.cta.text, 'cta', fam);
    const at = Number(tl.cta.at_ms);
    const tC = span(at, tl.cta.dur_ms ? at + Number(tl.cta.dur_ms) : durationMs, 'cta');
    const cArgs = { text: tl.cta.text, spec, layer: 'cta', label: 'cta', align, anchorDefault: 'above_captions', t: tC,
      maxW: safe.w * num(spec.max_width_pct, 100) / 100, fam };
    const { m, rect, placed, segments } = tl.cta.place ? placeManual({ ...cArgs, place: tl.cta.place }) : fitFree(cArgs);
    const textHex = color(spec.color ?? 'text');
    draw({ layer: 'cta', key: row.preset_key, spec, m, rect, segments, t: tC, textHex, placed, emphasisHex: st.emphasisHex, words: st.wordsOf(m),
      styleName: styleFor(`C_${row.preset_key}`, fam, spec, m, textHex), fam, align });
    st.done();
  }

  // 4 · Rol de cada persona: tercio inferior, sobre los subtítulos, al borde seguro izquierdo; sube si hay una cara.
  for (const [i, r] of (tl.roles ?? []).entries()) {
    if (r.show === false) continue;
    const row = resolveTextPreset(presets, r.preset_key, brandId, 'role');
    const spec = row.spec, fam = family(spec, 'role');
    const text = str(spec.split_on) ? String(r.text).split(spec.split_on).map((s) => s.trim()).filter(Boolean).join('\n') : r.text;
    const t = span(Number(r.at_ms), Number(r.at_ms) + Number(r.dur_ms), `roles[${i}]`);
    const roleSpec = { max_lines: str(spec.split_on) ? 4 : 2, ...spec };
    const roleMaxW = safe.w * num(spec.max_width_pct, 80) / 100;
    const st = withBlock(r, spec, text, `roles[${i}]`, fam);
    // Colocado a mano (contrato v1.3.3): manda el operador, se avisa si tapa.
    if (r.place) {
      const pm = placeManual({ text, spec: roleSpec, layer: 'role', label: `roles[${i}]`, t, maxW: roleMaxW, fam, place: r.place });
      const hex = color(spec.color ?? 'text_body');
      draw({ layer: 'role', key: row.preset_key, spec, m: pm.m, rect: pm.rect, t, textHex: hex, placed: 'manual', emphasisHex: st.emphasisHex,
        words: st.wordsOf(pm.m), styleName: styleFor(`R_${row.preset_key}`, fam, spec, pm.m, hex), fam, align: 'left' });
      st.done();
      continue;
    }
    const m = measureBlock({ text, spec: roleSpec, layer: 'role', canvas, maxW: roleMaxW, measure, family: fam });
    // Obstáculos: las caras de ese tramo y los bloques ya colocados que coinciden en el tiempo.
    const busy = [...faces.filter((f) => f.start_ms < t.end_ms && t.start_ms < f.end_ms),
      ...blocks.filter((b) => b.layer !== 'caption_band' && overlapT(b, t)).map((b) => b.rect)];
    let rect = null;
    const step = Math.max(1, Math.round(H * 0.005));
    for (let y = floorY - m.h; y >= safe.y; y -= step) {
      const cand = { x: safe.x, y, w: m.w, h: m.h };
      if (!busy.some((f) => inter(cand, f))) { rect = cand; break; }
    }
    // 2026-11-16 (2) — misma política que las demás capas: sin lugar libre, el rol queda sobre los subtítulos y se avisa.
    // Antes tumbaba el render entero (lab_jobs c5a1211c): un rol no vale un video caído.
    if (!rect) {
      warnings.push(`TEXT_OVER_FACE: roles[${i}] no tiene lugar libre de caras ni de otro texto; queda sobre los subtítulos`);
      rect = { x: safe.x, y: floorY - m.h, w: m.w, h: m.h };
    }
    const textHex = color(spec.color ?? 'text_body');
    draw({ layer: 'role', key: row.preset_key, spec, m, rect, t, textHex, emphasisHex: st.emphasisHex, words: st.wordsOf(m),
      styleName: styleFor(`R_${row.preset_key}`, fam, spec, m, textHex), fam, align: 'left' });
    st.done();
  }

  // 5 · Subtítulos karaoke: un evento por palabra activa, la palabra activa en el color de acento del preset.
  if (capPlan) {
    const { spec, fam, groups, ms, row, times } = capPlan;
    const textHex = color(spec.color ?? 'text');
    const aw = obj(spec.active_word) ? spec.active_word : {};
    const activeCol = assColor(color(aw.color ?? 'accent'));
    const scale = R(num(aw.scale, 1) * 100);
    const name = styleFor(`S_${row.preset_key}`, fam, spec, ms[0], textHex);
    const cx = R(band.x + band.w / 2), by = R(band.y + band.h - (ms[0].padY + ms[0].ext));
    groups.forEach((g, gi) => {
      const m = ms[gi];
      const gStart = times[gi].start_ms, gEnd = times[gi].end_ms;
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
  // Con posición por tramo, cada tramo cuenta por separado (su sitio y su tiempo).
  const pieces = (b) => (b.segments ? b.segments : [b]);
  for (const b of blocks) for (const p of pieces(b)) if (!inside(p.rect, safe)) nofit(`${b.layer} (${b.preset_key}) sale de la zona segura`);
  for (let i = 0; i < blocks.length; i++) {
    for (let j = i + 1; j < blocks.length; j++) {
      // Dos bloques automáticos nunca se pisan; si uno lo colocó el operador, ya se avisó (TEXT_PLACED_OVERLAP).
      if (blocks[i].placed === 'manual' || blocks[j].placed === 'manual') continue;
      if (pieces(blocks[i]).some((p) => pieces(blocks[j]).some((q) => overlapT(p, q) && inter(p.rect, q.rect)))) {
        nofit(`${blocks[i].layer} (${blocks[i].preset_key}) y ${blocks[j].layer} (${blocks[j].preset_key}) se pisan entre ${Math.max(blocks[i].start_ms, blocks[j].start_ms)} y ${Math.min(blocks[i].end_ms, blocks[j].end_ms)} ms`);
      }
    }
  }

  const filters = [];
  const stripRect = identityRect({ identity: tl.identity, tokens, slots, palette, canvas, safe });
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
  return { ass, filters, families: [...families], blocks, safe, warnings, drawn, strip: stripRect };
}

/**
 * La franja de identidad (rectángulo y color): el modo y el grosor salen de `tokens.identity` de la marca; el color,
 * del rol pedido (`identity.identity_role`, o su alias legacy `strip_role`) o del de los tokens, resuelto en
 * `brand_palette`. Modos de ImageLab (v1.4.0): none | edge_left | edge_right | edge_bottom (nunca un marco cerrado).
 * `full_bleed: false` en los bordes laterales = el alto de la zona segura. Sin dato → VIDEOLAB_BAD_REQUEST. PURO.
 */
export function identityRect({ identity, tokens, slots, palette, canvas, safe }) {
  if (!identity?.strip) return null;
  const idt = tokens?.identity;
  if (!obj(idt)) bad('la marca no declara identity en imagelab_overlay_tokens (franja)');
  const mode = idt.mode ?? 'edge_left';
  if (!IDENTITY_MODES.includes(mode)) bad(`identity.mode desconocido: ${mode} (${IDENTITY_MODES.join(' | ')})`);
  if (mode === 'none') return null;
  const hex = resolveColor('identity', { slots, palette });
  if (!pos(idt.width_pct)) bad('identity.width_pct de la marca falta o no es positivo');
  // Grosor: % del lado corto del lienzo, como ImageLab (en vertical, el ancho: igual que antes de v1.4.0).
  const th = Math.max(1, Math.round(Math.min(canvas.width, canvas.height) * idt.width_pct / 100));
  if (mode === 'edge_bottom') return { x: 0, y: canvas.height - th, w: canvas.width, h: th, color: hex, mode };
  const x = mode === 'edge_left' ? 0 : canvas.width - th;
  const [y, h] = idt.full_bleed === false ? [safe.y, safe.h] : [0, canvas.height];
  return { x, y, w: th, h, color: hex, mode };
}

/** La franja como `drawbox` de ffmpeg (dibujo ASS). Sin franja → null. PURO. */
export function identityFilter(args) {
  const r = identityRect(args);
  return r ? `drawbox=x=${r.x}:y=${r.y}:w=${r.w}:h=${r.h}:color=0x${r.color.slice(1)}@1:t=fill` : null;
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
  return ['-y', '-i', input, '-vf', vf, '-map', '0:v:0', '-map', '0:a:0?', '-c:v', 'libx264', ...X264, '-pix_fmt', 'yuv420p', '-r', '30',
    '-c:a', 'aac', '-ar', '48000', '-ac', '2', '-b:a', '160k', '-movflags', '+faststart', out];
}
