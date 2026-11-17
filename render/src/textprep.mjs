// VIDEOLAB · CAPAS DE TEXTO — la preparación compartida (F1, 2026-11-16): lee el dato de la marca, baja y mide sus
// fuentes, arma la geometría y, si algún preset lo pide, la escena del motor HTML. La usan el job de render
// (render/src/main.mjs) y la vista previa (api/text-scene.js): el MISMO código, así la vista previa y el render ven la
// misma geometría. Se movió de main.mjs sin cambiar su comportamiento.

import { writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as S from './supa.mjs';
import { RenderError, SPEC } from './plan.mjs';
import { brandFontFaces } from './fonts.mjs';
import { buildScene } from './html/scene.mjs';
import { presetKeysOf, fontFacesNeeded, faceMeasure, buildTextLayers, ttfMeasure, estimateMeasure, engineOf } from './textlayers.mjs';

const enc = encodeURIComponent;

/**
 * Capas de texto editables (contrato v1.3.0, §4 ter): lee el dato de la marca (presets, paleta, tipografía, tokens de
 * identidad y la zona segura del canal), baja sus fuentes y arma el guion ASS. Todo ANTES de gastar en proveedores.
 * El canal de la zona segura sale del perfil de la plataforma (`platform_format_profiles.video_text_canal`, migración
 * 20261116130000 de unrlvl-iid-functions; no `image_canal`, que es el canal de los presets de imagen); si el perfil no lo
 * declara, del pedido (`params.safe_zone_canal`); sin ninguno → VIDEOLAB_BAD_REQUEST.
 */
export async function prepareTextLayers({ cfg, brandId, params, profile, canvas, textLayers, timeline, durationMs, work, withScene = false }) {
  const canal = profile?.video_text_canal ?? params.safe_zone_canal ?? null;
  if (!canal) throw new RenderError('VIDEOLAB_BAD_REQUEST', `el perfil de ${params.platform}/reel no declara canal de zona segura: el pedido necesita params.safe_zone_canal`);
  const zonas = await S.select(cfg, `imagelab_overlay_tokens?canal=eq.${enc(canal)}&active=eq.true&or=(brand_id.is.null,brand_id.eq.${enc(brandId)})&select=brand_id,tokens`);
  const zona = zonas.find((z) => z.brand_id === brandId) ?? zonas.find((z) => z.brand_id == null);
  const safeZone = zona?.tokens?.layout?.safe_zone_pct;
  if (!safeZone) throw new RenderError('VIDEOLAB_BAD_REQUEST', `imagelab_overlay_tokens no tiene safe_zone_pct para el canal ${canal}`);
  const [marca] = await S.select(cfg, `imagelab_overlay_tokens?brand_id=eq.${enc(brandId)}&canal=is.null&active=eq.true&select=tokens`);
  const keys = presetKeysOf(textLayers);
  const presets = keys.length ? await S.select(cfg, `videolab_text_presets?preset_key=in.(${keys.map((k) => `"${enc(k)}"`).join(',')})` +
    `&or=(brand_id.is.null,brand_id.eq.${enc(brandId)})&select=*`) : [];
  const palette = await S.select(cfg, `brand_palette?brand_id=eq.${enc(brandId)}&select=role,hex`);
  const typography = await S.select(cfg, `brand_typography?brand_id=eq.${enc(brandId)}&select=role,font_family,css_import`);
  // Las caras de los roles que piden los presets (la regular y, si un preset pide negrita, la negrita real), elegidas
  // por estilo y peso, y cada texto medido con la cara con la que se dibuja. Si una no se puede leer, la medida
  // conservadora (sobrestima: nunca deja texto fuera de la zona segura).
  const fontsDir = join(work, 'fonts');
  const needs = new Map();
  for (const { role, bold, italic } of fontFacesNeeded(textLayers, presets, brandId)) {
    const row = typography.find((t) => t.role === role);
    if (!row?.font_family || !row?.css_import) throw new RenderError('VIDEOLAB_BAD_REQUEST', `brand_typography no tiene el rol ${role} (familia y css_import) para la marca ${brandId}`);
    const prev = needs.get(row.font_family);
    needs.set(row.font_family, { row, bold: (prev?.bold ?? false) || bold, italic: (prev?.italic ?? false) || !!italic });
  }
  const faces = {};
  const faceAvail = {};
  const fontFiles = [];
  let metrics = 'font';
  const read = (file) => { try { return ttfMeasure(readFileSync(file)); } catch { metrics = 'estimate'; return null; } };
  for (const [family, { row, bold, italic }] of needs) {
    const got = await brandFontFaces({ cssImport: row.css_import, family, dir: fontsDir, bold, italic });
    const regular = read(got.regular.file);
    // Negrita real presente pero ilegible: libass la dibuja igual, así que se mide con la estimación conservadora.
    const strong = regular && got.bold ? read(got.bold.file) ?? ((t, px) => estimateMeasure(t, px, { bold: true })) : null;
    const slanted = regular && got.italic ? read(got.italic.file) : null;
    faces[family] = { regular, bold: strong, italic: slanted };
    faceAvail[family] = { bold: !!got.bold, italic: !!got.italic };
    for (const [f, weight, style] of [[got.regular, got.regular.weight, 'normal'], [got.bold, 700, 'normal'], [got.italic, 400, 'italic']]) {
      if (f) fontFiles.push({ family, weight, style, file: f.file, url: f.url ?? null, format: f.file.endsWith('.otf') ? 'opentype' : 'truetype' });
    }
  }
  const measure = faceMeasure(faces, estimateMeasure);
  const args = { textLayers, timeline, presets, brandId, palette, typography, tokens: marca?.tokens ?? null,
    safeZone, canvas, durationMs, measure, faceAvail };
  const plan = buildTextLayers(args);
  const ass = join(work, 'text_layers.ass');
  writeFileSync(ass, plan.ass);
  // v1.4.0 — MOTOR DE DIBUJO: si algún preset del pedido declara `engine: 'html'`, todo el texto del pedido se dibuja
  // con el motor HTML (los presets sin `motion` se traducen desde su `entry`); si no, ASS como hasta v1.3.3.
  const engine = engineOf(textLayers, presets, brandId);
  // `withScene`: la vista previa pide la escena siempre (con presets ASS es una aproximación, y lo dice).
  const scene = engine === 'html' || withScene ? buildScene({ ...args, fps: SPEC.fps,
    fonts: fontFiles.filter((f) => f.url).map(({ family, weight, style, url }) => ({ family, weight, style, url })) }) : null;
  return { ass, fontsDir, filters: plan.filters, blocks: plan.blocks, warnings: plan.warnings ?? [], metrics, canal, engine, scene, fontFiles,
    presets: presetKeysOf(textLayers) };
}
