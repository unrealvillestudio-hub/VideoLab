// ZONA SEGURA ELEGIDA POR EL OPERADOR — `text_layers.safe_override` (contrato v1.13.0, 2026-11-18).
// Pedido de Sam: «necesito poder agrandar o mover un poco las zonas seguras […] a riesgo del operador […] la posibilidad de
// ir al máximo posible a mi discreción». Comprueba: sin el campo, todo igual; con el campo, la zona del operador manda en
// la colocación (automática y a mano), la banda de subtítulos y el medidor; la de la marca sigue en `safe_brand`; avisa.
// Ejecutar:  node tests/zona_segura_test.mjs

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { buildScene } from '../render/src/html/scene.mjs';
import { validateTextLayers } from '../render/src/textlayers.mjs';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));
let fallos = 0;
const caso = (n, fn) => { try { fn(); console.log(`  ok  ${n}`); } catch (e) { fallos++; console.error(`  MAL ${n}\n      ${e.message}`); } };
console.log('zona segura del operador');

const rows = (f) => JSON.parse(readFileSync(join(RAIZ, 'docs', f), 'utf8')).rows;
const PRESETS = [...rows('text_presets_seed.json'), ...rows('html_presets_f0.json'), ...rows('html_presets_f2.json'), ...rows('html_presets_f3.json'), ...rows('html_presets_f4.json')];
const MARCA = { top: 14, left: 6, right: 22, bottom: 37 };
const args = (tl) => ({ textLayers: tl, timeline: null, presets: PRESETS, brandId: 'marca_prueba',
  palette: [{ role: 'hueso', hex: '#FFFFFF' }, { role: 'brasa', hex: '#F2C14E' }, { role: 'carbon', hex: '#111111' }, { role: 'mar', hex: '#00AACC' }],
  typography: [{ role: 'display', font_family: 'X' }, { role: 'body', font_family: 'Y' }],
  tokens: { palette: { headline: 'hueso', subheadline: 'hueso', headline_emphasis: 'brasa' }, layout: { scrim: { palette: 'carbon' }, rule: { palette: 'mar' } } },
  safeZone: MARCA, canvas: { width: 1080, height: 1920 }, durationMs: 4000 });
const hook = (text, extra = {}) => ({ hook: { text, preset_key: 'hook_word_cascade', start_ms: 0, end_ms: 2000, ...extra } });
const AMPLIA = { top: 2, left: 2, right: 2, bottom: 2 };
const avisa = (sc) => sc.warnings.some((w) => w.startsWith('TEXT_SAFE_ZONE_OVERRIDDEN'));

caso('sin safe_override (ausente o null) todo queda como hoy: safe = safe_brand y no avisa', () => {
  for (const tl of [hook('Su cuota podría cambiar'), { ...hook('Su cuota podría cambiar'), safe_override: null }]) {
    const sc = buildScene(args(tl));
    assert.deepEqual(sc.safe, sc.safe_brand);
    assert.equal(sc.safe_brand.x, Math.ceil(1080 * 6 / 100));
    assert.ok(!avisa(sc));
  }
});

caso('con safe_override, scene.safe es la del operador, safe_brand la de la marca, y avisa', () => {
  const sc = buildScene(args({ ...hook('Su cuota podría cambiar'), safe_override: AMPLIA }));
  assert.deepEqual([sc.safe.x, sc.safe.y, sc.safe.x1, sc.safe.y1], [Math.ceil(1080 * 0.02), Math.ceil(1920 * 0.02), Math.floor(1080 * 0.98), Math.floor(1920 * 0.98)]);
  assert.equal(sc.safe_brand.x, Math.ceil(1080 * 6 / 100));
  assert.ok(avisa(sc), sc.warnings.join(' | '));
});

caso('un bloque a mano llega hasta el borde del video con left 0; con la zona de la marca se queda en su borde', () => {
  const pegado = { place: { x_pct: 0, y_pct: 30, zoom: 1 } };
  const marca = buildScene(args(hook('Su cuota', pegado))).layout.find((b) => b.layer === 'hook');
  const borde = buildScene(args({ ...hook('Su cuota', pegado), safe_override: { top: 0, left: 0, right: 0, bottom: 0 } })).layout.find((b) => b.layer === 'hook');
  assert.equal(Math.round(marca.rect.x), Math.ceil(1080 * 6 / 100));
  assert.equal(Math.round(borde.rect.x), 0);
});

caso('el medidor y «no cabe» usan la zona efectiva: un gancho que no entra en la de la marca entra en una más ancha', () => {
  const largo = 'Esto es lo que nadie le cuenta antes de comprar un apartamento en la playa cerca del mar';
  assert.throws(() => buildScene(args(hook(largo))), /VIDEOLAB_TEXT_DOES_NOT_FIT|no cabe|no entra/i);
  const sc = buildScene(args({ ...hook(largo), safe_override: { top: 2, left: 1, right: 1, bottom: 2 } }));
  const h = sc.layout.find((b) => b.layer === 'hook');
  assert.equal(h.fit.fits, true);
  assert.ok(h.fit.max_width_px > (1080 * (1 - 0.28)), JSON.stringify(h.fit));
});

caso('forma inválida es un error del pedido: lado ≥ 50, negativo, ausente o no objeto', () => {
  for (const z of [{ ...AMPLIA, top: 50 }, { ...AMPLIA, left: -1 }, { top: 2, left: 2, right: 2 }, 'todo']) {
    assert.throws(() => validateTextLayers({ ...hook('Hola'), safe_override: z }), /safe_override/);
  }
});

if (fallos) { console.error(`\n${fallos} caso(s) MAL`); process.exit(1); }
console.log('\nzona segura: todo en verde');
