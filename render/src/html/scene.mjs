// LA ESCENA del motor HTML de VideoLab (F0, 2026-11-16): de la geometría ya resuelta a la lista de lo que se dibuja.
//
// Regla de diseño: el motor HTML NO coloca nada. La colocación —zona segura, anti-choque, esquiva de caras, `fitFree`,
// bloques a mano con `place`— sigue siendo de `buildTextLayers` (render/src/textlayers.mjs, contrato §4 ter.4), y sus
// `blocks` (los mismos que van a `text_layout`) son la ENTRADA de este módulo. Aquí sólo se resuelve CÓMO se dibuja cada
// bloque: líneas, colores, fuentes y pistas de animación, todo desde el dato (preset, paleta, tipografía).
//
// F0 derivaba la escena re-midiendo cada bloque; desde F1 la toma de `plan.drawn` (lo que `buildTextLayers` resolvió al
// dibujar: medida, líneas, palabras con sus tramos de estilo, colores, alineación y posición por tramo de toma), así que
// hay una sola derivación y el ASS y el HTML dibujan lo mismo. Los subtítulos siguen midiéndose aquí con la misma
// función que el dibujo ASS.
//
// Test de la marca N+1: aquí no hay ninguna marca. Colores, fuentes, textos y animaciones llegan como dato.

import {
  buildTextLayers, resolveTextPreset, colorSlots, resolveColor, measureBlock, groupCaptionWords, timelineWords, zoomSpec,
  estimateMeasure, DEFAULT_FONT_ROLE,
  captionTimes,
} from '../textlayers.mjs';
import { validateMotion, tracksFromEntry } from './keyframes.mjs';

const num = (v, d) => (v != null && Number.isFinite(Number(v)) ? Number(v) : d);
const obj = (v) => v != null && typeof v === 'object' && !Array.isArray(v);
const str = (v) => typeof v === 'string' && v.trim().length > 0;
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

/** Una palabra para comparar con las palabras clave: minúsculas, sin signos alrededor. PURO. */
export const normWord = (w) => String(w ?? '').toLocaleLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');

/**
 * La escena completa. Mismos argumentos que `buildTextLayers` más `fps`. Devuelve
 * { canvas, fps, durationMs, safe, families, blocks, captions, filters, warnings, layout } — `layout` es la geometría
 * tal cual (lo que va a `text_layout.blocks`). PURO.
 */
export function buildScene({ textLayers: tl, timeline = null, presets, brandId, palette, typography, tokens = null,
  safeZone, canvas, durationMs, measure = estimateMeasure, faceAvail = null, fps = 30, fonts = [] }) {
  const plan = buildTextLayers({ textLayers: tl, timeline, presets, brandId, palette, typography, tokens, safeZone, canvas,
    durationMs, measure, faceAvail });
  const { height: H } = canvas;
  const safe = plan.safe;
  const slots = colorSlots({ tokens, textLayers: tl });
  const color = (ref) => resolveColor(ref, { slots, palette });
  const familyOf = (spec, layer) => (typography ?? []).find((t) => t?.role === (spec.font_role ?? DEFAULT_FONT_ROLE[layer]))?.font_family;

  const placed = plan.blocks.filter((b) => b.layer !== 'caption_band');

  // F1: la escena toma lo que `buildTextLayers` ya resolvió al dibujar (`plan.drawn`: medida, líneas, palabras con sus
  // tramos de estilo, colores y alineación). Una sola derivación: el motor HTML y el ASS dibujan lo mismo.
  if (plan.drawn.length !== placed.length) throw new Error(`escena: ${plan.drawn.length} bloques dibujados para ${placed.length} colocados`);
  const blocks = placed.map((b, i) => {
    const d = plan.drawn[i];
    if (d.layer !== b.layer || d.preset_key !== b.preset_key) throw new Error(`escena: el bloque ${i} es ${b.layer} y lo dibujado es ${d.layer}`);
    const { spec, m } = d;
    const motion = obj(spec.motion) ? spec.motion : null;
    validateMotion(motion, `${d.preset_key}.motion`);
    const tracks = motion ? motion.tracks : tracksFromEntry(spec, { canvasHeight: H, px: m.px });
    return {
      id: `b${i}`, layer: b.layer, preset_key: d.preset_key, placed: b.placed ?? 'auto',
      start_ms: b.start_ms, end_ms: b.end_ms, rect: b.rect, ...(b.segments ? { segments: b.segments, move_ms: b.move_ms, move_ease: b.move_ease } : {}),
      family: d.family, bold: m.bold, px: m.px, lh: m.lh, align: d.align,
      pad: { x: m.padX, y: m.padY }, ext: m.ext,
      lines: d.words.map((ws, li) => ({
        width: m.widths[li],
        // Peso por línea (F2, `spec.line_weights`, p. ej. [700, 400]: nombre fuerte y cargo más ligero). La medida se hizo
        // con el peso del bloque (negrita), que es el más ancho: una línea más ligera nunca se sale de su caja.
        ...(Array.isArray(spec.line_weights) && spec.line_weights[li] != null ? { weight: Number(spec.line_weights[li]) } : {}),
        words: ws.map((w) => ({
          text: w.text, emphasis: w.emphasis, number: numberToken(w.text),
          runs: w.runs.map((r) => ({ text: r.text, ...(r.italic ? { italic: true } : {}),
            ...(r.bold !== m.bold ? { weight: r.bold ? 700 : 400 } : {}), ...(r.color ? { color: 'emphasis' } : {}) })),
        })),
      })),
      colors: {
        text: d.textHex,
        emphasis: d.emphasisHex,
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
      uppercase: false,          // las palabras ya llegan con la caja de presentación
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
    const { times } = captionTimes(groups, spec, durationMs);   // mismos tiempos que el dibujo ASS (hold_gap_ms)
    const aw = obj(spec.active_word) ? spec.active_word : {};
    const motion = obj(spec.motion) ? spec.motion : null;
    validateMotion(motion, `${row.preset_key}.motion`);
    const kw = new Set((Array.isArray(tl.captions.keywords) ? tl.captions.keywords : []).flatMap((k) => String(k).split(/\s+/)).map(normWord).filter(Boolean));
    captions = {
      preset_key: row.preset_key, band: band.rect, family: fam,
      colors: {
        text: color(spec.color ?? 'text'), active: color(aw.color ?? 'accent'),
        outline: obj(spec.outline) ? color(spec.outline.color ?? '#000000') : null,
        shadow: obj(spec.shadow) ? color(spec.shadow.color ?? '#000000') : null,
        box: obj(spec.box) ? color(spec.box.color ?? 'scrim') : null,
      },
      active_scale: num(aw.scale, 1),
      // F2 (2026-11-17, ronda 2 de vigilancia: las mecánicas de subtítulos más usadas del mercado). Todo opcional y dato:
      //  - active_word.box: caja (píldora) detrás de la palabra que suena;
      //  - active_word.pop: salto de escala de la palabra al empezar a sonar (sube y vuelve, sin rebote);
      //  - reveal: 'spoken': cada palabra aparece cuando se dice (no el grupo entero de golpe);
      //  - active_word.mode: 'keywords': sólo las palabras clave del pedido (`captions.keywords`) van en el acento —la
      //    evidencia independiente prefiere marcar el 5–15 % de las palabras, no todas—.
      active_box: obj(aw.box) ? { color: color(aw.box.color ?? 'accent'), opacity: num(aw.box.opacity, 1),
        radius_em: num(aw.box.radius_em, 0.18), pad_x_em: num(aw.box.pad_x_em, 0.12), pad_y_em: num(aw.box.pad_y_em, 0.02) } : null,
      pop: obj(aw.pop) ? { scale: num(aw.pop.scale, 1.12), ms: Math.max(1, num(aw.pop.ms, 180)) } : null,
      reveal: spec.reveal === 'spoken' ? 'spoken' : 'group',
      keywords_only: aw.mode === 'keywords',
      tracks: motion ? motion.tracks : [],
      groups: groups.map((g, gi) => {
        const m = measureBlock({ text: g.map((w) => w.text).join(' '), spec, layer: 'caption', canvas, maxW: safe.w, measure, family: fam });
        let k = 0;
        const gEnd = times[gi].end_ms;
        return {
          start_ms: times[gi].start_ms, end_ms: gEnd, px: m.px, lh: m.lh, bold: m.bold, outline: m.outline,
          shadow: obj(spec.shadow) ? { depth: m.shadow, alpha: num(spec.shadow.alpha, 0.5) } : null,
          pad: { x: m.padX, y: m.padY }, ext: m.ext, w: m.w, h: m.h,
          box: obj(spec.box) ? { opacity: num(spec.box.opacity, 0.85), radius: Math.round(H * num(spec.box.radius_pct, 0.6) / 100) } : null,
          lines: m.lines.map((line) => line.split(' ').map((w) => {
            const src = g[k];
            const next = g[k + 1];
            k++;
            return { text: w, start_ms: src.start_ms, end_ms: next ? next.start_ms : gEnd, keyword: kw.has(normWord(w)) };
          })),
        };
      }).filter((g) => g.start_ms < durationMs),
    };
  }

  return {
    // `fonts`: [{ family, weight, style, url }] — sólo para la vista previa (loadFonts); el capturador las lleva dentro.
    canvas, fps, durationMs, safe, families: plan.families, fonts, blocks, captions,
    // La franja la dibuja la página (y la vista previa): no va como drawbox de ffmpeg en el motor HTML.
    strip: plan.strip, filters: [], warnings: plan.warnings, layout: plan.blocks,
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
