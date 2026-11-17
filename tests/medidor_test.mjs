// MEDIDOR «CABEN HASTA N CARACTERES» (contrato v1.12.0, 2026-11-17). Pedido de Sam por la ventana de texto.
// Comprueba: cada bloque trae `fit` con la misma medida que decide VIDEOLAB_TEXT_DOES_NOT_FIT; si no entra, el error
// lleva `fit`; `chars_fit` es el comienzo más largo que entra, cortado en palabra; y es coherente: lo que dice que entra,
// entra, y una palabra más ya no.
// Ejecutar:  node tests/medidor_test.mjs

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { buildScene } from '../render/src/html/scene.mjs';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));
let fallos = 0;
const caso = (n, fn) => { try { fn(); console.log(`  ok  ${n}`); } catch (e) { fallos++; console.error(`  MAL ${n}\n      ${e.message}`); } };
console.log('medidor — cuánto texto cabe');

const rows = (f) => JSON.parse(readFileSync(join(RAIZ, 'docs', f), 'utf8')).rows;
const PRESETS = [...rows('text_presets_seed.json'), ...rows('html_presets_f0.json'), ...rows('html_presets_f2.json'), ...rows('html_presets_f3.json'), ...rows('html_presets_f4.json')];
const args = (tl) => ({ textLayers: tl, timeline: null, presets: PRESETS, brandId: 'marca_prueba',
  palette: [{ role: 'hueso', hex: '#FFFFFF' }, { role: 'brasa', hex: '#F2C14E' }, { role: 'carbon', hex: '#111111' }, { role: 'mar', hex: '#00AACC' }],
  typography: [{ role: 'display', font_family: 'X' }, { role: 'body', font_family: 'Y' }],
  tokens: { palette: { headline: 'hueso', subheadline: 'hueso', headline_emphasis: 'brasa' }, layout: { scrim: { palette: 'carbon' }, rule: { palette: 'mar' } } },
  safeZone: { top: 14, left: 6, right: 22, bottom: 37 }, canvas: { width: 1080, height: 1920 }, durationMs: 4000 });
const hook = (text, preset = 'hook_word_cascade') => ({ hook: { text, preset_key: preset, start_ms: 0, end_ms: 2000 } });
const enters = (text, preset) => { try { buildScene(args(hook(text, preset))); return true; } catch { return false; } };

caso('cada bloque trae fit: capa, líneas, ancho, tamaño mínimo y caracteres que caben', () => {
  const sc = buildScene(args({ ...hook('Su cuota podría cambiar'), key_titles: [{ text: '$1.67 por metro', at_ms: 2100, dur_ms: 1500, preset_key: 'key_title_zoom_words' }] }));
  const [h, k] = sc.layout.filter((b) => b.layer !== 'caption_band');
  assert.equal(h.fit.layer, 'hook'); assert.equal(h.fit.fits, true);
  assert.equal(h.fit.chars, 'Su cuota podría cambiar'.length); assert.equal(h.fit.chars_fit, h.fit.chars);
  assert.ok(h.fit.max_lines >= 1 && h.fit.max_width_px > 0 && h.fit.min_px > 0, JSON.stringify(h.fit));
  assert.equal(k.fit.layer, 'key_title'); assert.equal(k.fit.fits, true);
});

caso('si no entra, el error lleva fit con lo que cabe, cortado en palabra', () => {
  const largo = 'Esto es lo que nadie le cuenta antes de comprar un apartamento en la playa cerca del mar';
  let err;
  try { buildScene(args(hook(largo))); } catch (e) { err = e; }
  assert.ok(err, 'tenía que no entrar');
  assert.equal(err.label, 'VIDEOLAB_TEXT_DOES_NOT_FIT');
  assert.equal(err.fit.label, 'hook'); assert.equal(err.fit.fits, false);
  assert.ok(err.fit.chars_fit > 0 && err.fit.chars_fit < largo.length, JSON.stringify(err.fit));
  assert.ok(largo[err.fit.chars_fit] === ' ' || err.fit.chars_fit === largo.length, 'el corte cae entre palabras');
  // Coherente: lo que dice que cabe, entra; una palabra más, no.
  assert.ok(enters(largo.slice(0, err.fit.chars_fit)), 'el comienzo que dice que cabe no entra');
  const next = largo.indexOf(' ', err.fit.chars_fit + 1);
  assert.ok(!enters(largo.slice(0, next === -1 ? largo.length : next)), 'una palabra más también entra');
});

if (fallos) { console.error(`\n${fallos} caso(s) MAL`); process.exit(1); }
console.log('\nmedidor: todo en verde');
