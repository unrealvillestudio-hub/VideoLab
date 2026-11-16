// LA ESCENA del motor HTML de VideoLab (F0, 2026-11-16): de la geometría ya resuelta a la lista de lo que se dibuja.
//
// Regla de diseño: el motor HTML NO coloca nada. La colocación —zona segura, anti-choque, esquiva de caras, `fitFree`,
// bloques a mano con `place`— sigue siendo de `buildTextLayers` (render/src/textlayers.mjs, contrato §4 ter.4), y sus
// `blocks` (los mismos que van a `text_layout`) son la ENTRADA de este módulo. Aquí sólo se resuelve CÓMO se dibuja cada
// bloque: líneas, colores, fuentes y pistas de animación, todo desde el dato (preset, paleta, tipografía).
//
// F0: la escena se deriva re-midiendo cada bloque con el tamaño que ya fijó la geometría (mismo `measureBlock`, mismas
// métricas), así que las líneas coinciden con las del dibujo ASS. En F1 conviene que `buildTextLayers` devuelva esta
// lista directamente, para que haya una sola derivación.
//
// Test de la marca N+1: aquí no hay ninguna marca. Colores, fuentes, textos y animaciones llegan como dato.

import {
  buildTextLayers, resolveTextPreset, colorSlots, resolveColor, measureBlock, groupCaptionWords, timelineWords, zoomSpec,
  estimateMeasure, DEFAULT_FONT_ROLE,
} from '../textlayers.mjs';
import { validateMotion, tracksFromEntry } from './keyframes.mjs';

const num = (v, d) => (v != null && Number.isFinite(Number(v)) ? Number(v) : d);
const obj = (v) => v != null && typeof v === 'object' && !Array.isArray(v);
const str = (v) => typeof v === 'string' && v.trim().length > 0;
const norm = (s) => String(s).toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
// Un número dentro de una palabra («$1.67», «$200», «20%»): prefijo, cifra con sus separadores y sufijo.
const NUMBER = /^(\D*?)(\d[\d.,]*\d|\d)(\D*)$/u;

/** Partes de una palabra para el contador: { prefix, value, decimals, sep, suffix } o null. PURO. */
export function numberToken(word) {
  const m = String(word).match(NUMBER);
  if (!m) return null;
  const raw = m[2];
  // El separador decimal es el último «.» o «,» seguido de 1 o 2 cifras al final; el resto son miles.
  const dm = raw.match(/[.,](\d{1,2})$/);
  const decimals = dm ? dm[1].length : 0;
  const decSep = dm ? raw[raw.length - decimals - 1] : null;
  const intPart = dm ? raw.slice(0, raw.length - decimals - 1) : raw;
  const thouSep = (intPart.match(/[.,]/) ?? [null])[0];
  const value = Number(intPart.replace(/[.,]/g, '') + (dm ? `.${dm[1]}` : ''));
  if (!Number.isFinite(value)) return null;
  return { prefix: m[1], value, decimals, decSep, thouSep, suffix: m[3] };
}

/**
 * La escena completa. Mismos argumentos que `buildTextLayers` más `fps`. Devuelve
 * { canvas, fps, durationMs, safe, families, blocks, captions, filters, warnings, layout } — `layout` es la geometría
 * tal cual (lo que va a `text_layout.blocks`). PURO.
 */
export function buildScene({ textLayers: tl, timeline = null, presets, brandId, palette, typography, tokens = null,
  safeZone, canvas, durationMs, measure = estimateMeasure, fps = 30 }) {
  const plan = buildTextLayers({ textLayers: tl, timeline, presets, brandId, palette, typography, tokens, safeZone, canvas,
    durationMs, measure });
  const { height: H } = canvas;
  const safe = plan.safe;
  const slots = colorSlots({ tokens, textLayers: tl });
  const color = (ref) => resolveColor(ref, { slots, palette });
  const familyOf = (spec, layer) => (typography ?? []).find((t) => t?.role === (spec.font_role ?? DEFAULT_FONT_ROLE[layer]))?.font_family;

  // Las fuentes de las capas, en el orden en que buildTextLayers las colocó (hook, títulos, cta, roles).
  const sources = [];
  if (tl.hook) sources.push({ layer: 'hook', item: tl.hook, text: tl.hook.text, emphasis: tl.hook.emphasis ?? [] });
  for (const k of tl.key_titles ?? []) sources.push({ layer: 'key_title', item: k, text: k.text, emphasis: k.emphasis ?? [] });
  if (tl.cta) sources.push({ layer: 'cta', item: tl.cta, text: tl.cta.text, emphasis: tl.cta.emphasis ?? [] });
  for (const r of tl.roles ?? []) if (r.show !== false) sources.push({ layer: 'role', item: r, text: r.text, emphasis: [] });

  const placed = plan.blocks.filter((b) => b.layer !== 'caption_band');
  if (placed.length !== sources.length) throw new Error(`escena: ${placed.length} bloques colocados para ${sources.length} capas`);

  const blocks = placed.map((b, i) => {
    const src = sources[i];
    if (src.layer !== b.layer) throw new Error(`escena: el bloque ${i} es ${b.layer} y la capa es ${src.layer}`);
    const row = resolveTextPreset(presets, src.item.preset_key, brandId, src.layer);
    const zoom = src.item.place?.zoom != null ? Number(src.item.place.zoom) : 1;
    const spec0 = zoomSpec(row.spec, zoom);
    const isRole = src.layer === 'role';
    const text = isRole && str(spec0.split_on)
      ? String(src.text).split(spec0.split_on).map((s) => s.trim()).filter(Boolean).join('\n') : src.text;
    const spec = isRole ? { max_lines: str(spec0.split_on) ? 4 : 2, ...spec0 } : spec0;
    const fam = familyOf(spec, src.layer);
    const maxW = safe.w * num(spec.max_width_pct, isRole ? 80 : 100) / 100;
    // Re-medir AL TAMAÑO QUE FIJÓ LA GEOMETRÍA (size_px del bloque): mismas líneas que el dibujo ASS.
    const sizePct = (b.size_px / H) * 100;
    const m = measureBlock({ text, spec: { ...spec, size_pct: sizePct, min_size_pct: sizePct }, layer: src.layer, canvas, maxW, measure, family: fam });
    if (m.px !== b.size_px) throw new Error(`escena: ${b.layer} se re-midió a ${m.px} px y la geometría dice ${b.size_px}`);
    const align = isRole ? 'left' : (spec.align === 'left' ? 'left' : 'center');
    const emph = new Set(src.emphasis.flatMap((e) => String(e).split(/\s+/)).map(norm).filter(Boolean));
    const motion = obj(spec.motion) ? spec.motion : null;
    validateMotion(motion, `${row.preset_key}.motion`);
    const tracks = motion ? motion.tracks : tracksFromEntry(spec, { canvasHeight: H, px: m.px });
    const textHex = color(spec.color ?? (isRole ? 'text_body' : 'text'));
    return {
      id: `b${i}`, layer: b.layer, preset_key: row.preset_key, placed: b.placed ?? 'auto',
      start_ms: b.start_ms, end_ms: b.end_ms, rect: b.rect,
      family: fam, bold: m.bold, px: m.px, lh: m.lh, align,
      pad: { x: m.padX, y: m.padY }, ext: m.ext,
      lines: m.lines.map((line, li) => ({
        width: m.widths[li],
        words: line.split(' ').map((w) => ({ text: w, emphasis: emph.has(norm(w)), number: numberToken(w) })),
      })),
      colors: {
        text: textHex,
        emphasis: color(spec.emphasis_color ?? 'accent'),
        outline: obj(spec.outline) ? color(spec.outline.color ?? '#000000') : null,
        shadow: obj(spec.shadow) ? color(spec.shadow.color ?? '#000000') : null,
        box: obj(spec.box) ? color(spec.box.color ?? 'scrim') : null,
        rule: m.rule ? color(spec.rule.color ?? 'rule') : null,
        sheen: obj(motion?.sheen) ? color(motion.sheen.color ?? 'text') : null,
        mark: obj(motion?.mark) ? color(motion.mark.color ?? 'accent') : null,
      },
      outline: m.outline,
      shadow: obj(spec.shadow) ? { depth: m.shadow, alpha: num(spec.shadow.alpha, 0.5) } : null,
      box: obj(spec.box) ? { opacity: num(spec.box.opacity, 0.85), radius: Math.round(H * num(spec.box.radius_pct, 0.6) / 100) } : null,
      rule: m.rule ? { w: m.rule.w, th: m.rule.th, gap: m.rule.gap, position: m.rule.position } : null,
      sheen: obj(motion?.sheen) ? { width_pct: num(motion.sheen.width_pct, 30), opacity: num(motion.sheen.opacity, 0.35) } : null,
      // Subrayado de énfasis (sólo con `motion.mark`): alto y separación de la base en em del bloque.
      mark: obj(motion?.mark) ? { height: Math.max(2, Math.round(m.px * num(motion.mark.height_em, 0.12))), offset: Math.round(m.px * num(motion.mark.offset_em, 0.08)) } : null,
      uppercase: spec.uppercase === true,
      tracks,
    };
  });

  // Subtítulos: misma banda, mismos grupos y mismas líneas que el dibujo ASS; la palabra activa sale del tiempo.
  let captions = null;
  const band = plan.blocks.find((b) => b.layer === 'caption_band');
  if (band && tl.captions && tl.captions.enabled !== false) {
    const row = resolveTextPreset(presets, tl.captions.preset_key, brandId, 'caption');
    const spec = tl.captions.place?.zoom != null ? zoomSpec(row.spec, Number(tl.captions.place.zoom)) : row.spec;
    const fam = familyOf(spec, 'caption');
    const words = timelineWords(timeline);
    const groups = groupCaptionWords(words, { min: num(spec.group_min, 3), max: num(spec.group_max, 4), maxGapMs: num(spec.max_gap_ms, 700) });
    const aw = obj(spec.active_word) ? spec.active_word : {};
    const motion = obj(spec.motion) ? spec.motion : null;
    validateMotion(motion, `${row.preset_key}.motion`);
    captions = {
      preset_key: row.preset_key, band: band.rect, family: fam,
      colors: {
        text: color(spec.color ?? 'text'), active: color(aw.color ?? 'accent'),
        outline: obj(spec.outline) ? color(spec.outline.color ?? '#000000') : null,
        shadow: obj(spec.shadow) ? color(spec.shadow.color ?? '#000000') : null,
        box: obj(spec.box) ? color(spec.box.color ?? 'scrim') : null,
      },
      active_scale: num(aw.scale, 1),
      tracks: motion ? motion.tracks : [],
      groups: groups.map((g) => {
        const m = measureBlock({ text: g.map((w) => w.text).join(' '), spec, layer: 'caption', canvas, maxW: safe.w, measure, family: fam });
        let k = 0;
        const gEnd = Math.min(durationMs, g[g.length - 1].end_ms);
        return {
          start_ms: g[0].start_ms, end_ms: gEnd, px: m.px, lh: m.lh, bold: m.bold, outline: m.outline,
          shadow: obj(spec.shadow) ? { depth: m.shadow, alpha: num(spec.shadow.alpha, 0.5) } : null,
          pad: { x: m.padX, y: m.padY }, ext: m.ext, w: m.w, h: m.h,
          box: obj(spec.box) ? { opacity: num(spec.box.opacity, 0.85), radius: Math.round(H * num(spec.box.radius_pct, 0.6) / 100) } : null,
          lines: m.lines.map((line) => line.split(' ').map((w) => {
            const src = g[k];
            const next = g[k + 1];
            k++;
            return { text: w, start_ms: src.start_ms, end_ms: next ? next.start_ms : gEnd };
          })),
        };
      }).filter((g) => g.start_ms < durationMs),
    };
  }

  return {
    canvas, fps, durationMs, safe, families: plan.families, blocks, captions,
    filters: plan.filters, warnings: plan.warnings, layout: plan.blocks,
  };
}

/** Tramos con texto en pantalla, unidos (para capturar sólo ahí). PURO. */
export function textSpans(scene) {
  const spans = scene.blocks.map((b) => [b.start_ms, b.end_ms]);
  for (const g of scene.captions?.groups ?? []) spans.push([g.start_ms, g.end_ms]);
  spans.sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const s of spans) {
    const last = out[out.length - 1];
    if (last && s[0] <= last[1]) last[1] = Math.max(last[1], s[1]);
    else out.push([...s]);
  }
  return out;
}
