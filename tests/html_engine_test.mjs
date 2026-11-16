// MOTOR HTML (F0, 2026-11-16) — evaluador de animación, escena y capturador determinista. NO está conectado al job.
//
// Qué se comprueba:
//  - las curvas son las de la fórmula pública (extremos y un valor conocido de la Bézier de CSS);
//  - la animación es DATO y FUNCIÓN PURA DEL TIEMPO: mismo dato + mismo t → mismo estado; el escalonado, la repetición
//    y la posición por tramo de toma (`segments`) se evalúan sin reloj;
//  - la forma de `motion` se valida con el punto exacto del error;
//  - cada preset de la siembra y cada preset de prueba de la F0 se convierte en escena, y la escena NO mueve la
//    geometría: sus bloques son exactamente los de buildTextLayers (el contrato §4 ter.4 sigue mandando);
//  - DETERMINISMO: dos capturas de la misma escena dan la misma huella por fotograma (si hay Chromium y una fuente local);
//  - test N+1: el código del motor no nombra ninguna marca.
//
// Ejecutar:  node tests/html_engine_test.mjs     (sin red; la parte del navegador se salta si no hay Playwright)

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { EASES, easeFn, cubicBezier } from '../render/src/html/ease.mjs';
import { propAt, stateAt, rectAt, validateMotion, tracksFromEntry, staggerDelay } from '../render/src/html/keyframes.mjs';
import { buildScene, numberToken, textSpans } from '../render/src/html/scene.mjs';
import { scenePage } from '../render/src/html/page.mjs';
import { blankPng, overlayArgs } from '../render/src/html/capture.mjs';
import * as T from '../render/src/textlayers.mjs';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));
const SEED = JSON.parse(readFileSync(join(RAIZ, 'docs/text_presets_seed.json'), 'utf8')).rows;
const F0 = JSON.parse(readFileSync(join(RAIZ, 'docs/html_presets_f0.json'), 'utf8')).rows;
const PRESETS = [...SEED, ...F0];

let fallos = 0;
const pendientes = [];
function caso(nombre, fn) {
  const fin = (e) => { if (e) { fallos++; console.error(`  MAL ${nombre}\n      ${e.message}`); } else console.log(`  ok  ${nombre}`); };
  try { const r = fn(); if (r && typeof r.then === 'function') pendientes.push(r.then(() => fin(), fin)); else fin(); } catch (e) { fin(e); }
}

// Marca sintética: los roles de paleta y tipografía son inventados a propósito (el código no puede conocerlos).
const BRAND = 'marca_sintetica_b';
const CANVAS = { width: 1080, height: 1920 };
const SAFE = { top: 14, left: 6, right: 22, bottom: 37 };
const PALETTE = [{ role: 'hueso', hex: '#F2F0EC' }, { role: 'carbon', hex: '#111111' }, { role: 'brasa', hex: '#FF8800' }, { role: 'mar', hex: '#00AACC' }];
const TOKENS = { palette: { headline: 'hueso', subheadline: 'hueso', headline_emphasis: 'brasa' },
  layout: { scrim: { palette: 'carbon' }, rule: { palette: 'mar' } },
  identity: { mode: 'edge_left', palette: 'mar', width_pct: 1.8, full_bleed: true } };
const TYPO = [{ role: 'display', font_family: 'Familia Display' }, { role: 'body', font_family: 'Familia Texto' }];
const WORDS = 'Hoy les cuento por qué el uno por ciento de los clientes cambia todo el negocio en semanas'.split(' ')
  .map((text, i) => ({ text, start_ms: i * 300, end_ms: i * 300 + 260, person_id: i < 9 ? 'p1' : 'p2' }));
const TL = () => ({
  hook: { text: 'El 1 % que cambia todo el negocio', preset_key: 'hook_char_rise', start_ms: 0, end_ms: 2600, emphasis: ['negocio'] },
  roles: [{ person_id: 'p1', text: 'Persona Uno — Directora — Estudio', show: true, at_ms: 400, dur_ms: 3800, preset_key: 'role_label_minimal' }],
  captions: { enabled: true, preset_key: 'caption_karaoke_accent', accent_role: 'brasa' },
  key_titles: [{ text: 'Todas pagan: $1.250,50', at_ms: 2800, dur_ms: 1400, preset_key: 'key_title_counter' }],
  cta: { text: 'Reenvíalo a quien lleva las cuentas', at_ms: 4400, preset_key: 'cta_card_spring' },
  identity: { strip: true, strip_role: 'mar' },
});
const args = (over = {}) => ({ textLayers: TL(), timeline: { words: WORDS }, presets: PRESETS, brandId: BRAND, palette: PALETTE,
  typography: TYPO, tokens: TOKENS, safeZone: SAFE, canvas: CANVAS, durationMs: 6000, ...over });

console.log('motor HTML — F0');

caso('curvas: todas valen 0 en 0 y 1 en 1; la Bézier de CSS «ease» (0.25,0.1,0.25,1) da 0,8024 en 0,5', () => {
  for (const [k, f] of Object.entries(EASES)) {
    assert.ok(Math.abs(f(0)) < 1e-9, `${k}(0) = ${f(0)}`);
    assert.ok(Math.abs(f(1) - 1) < 1e-9, `${k}(1) = ${f(1)}`);
  }
  assert.ok(Math.abs(cubicBezier(0.25, 0.1, 0.25, 1)(0.5) - 0.8024) < 1e-3);
  assert.ok(Math.abs(easeFn('bezier:0.25,0.1,0.25,1')(0.5) - 0.8024) < 1e-3);
  assert.throws(() => easeFn('rebote_magico'), /curva desconocida/);
});

caso('propAt: antes de la primera clave, la primera; entre claves, la curva de la clave de llegada; después, la última', () => {
  const keys = [{ t: 100, opacity: 0 }, { t: 300, opacity: 1, ease: 'linear' }, { t: 500, y_em: 2 }];
  assert.equal(propAt(keys, 'opacity', 0), 0);
  assert.equal(propAt(keys, 'opacity', 200), 0.5);
  assert.equal(propAt(keys, 'opacity', 900), 1);
  assert.equal(propAt(keys, 'y_em', 0), 2);
  assert.equal(propAt(keys, 'scale', 200), undefined);
});

caso('stateAt es PURO y combina pistas: escalonado, repetición y salida desde el final', () => {
  const tracks = [
    { target: 'word', stagger: { each_ms: 50 }, keys: [{ t: 0, opacity: 0 }, { t: 100, opacity: 1, ease: 'linear' }] },
    { target: 'sheen', repeat: { every_ms: 1000, times: 2 }, keys: [{ t: 0, sheen: 0 }, { t: 500, sheen: 1, ease: 'linear' }] },
    { target: 'block', from: 'end', keys: [{ t: -100, opacity: 1 }, { t: 0, opacity: 0, ease: 'linear' }] },
  ];
  const block = { start_ms: 1000, end_ms: 3000 };
  const a = stateAt(tracks, 'word', 1100, block, { i: 1, n: 3 });
  const b = stateAt(tracks, 'word', 1100, block, { i: 1, n: 3 });
  assert.deepEqual(a, b);
  assert.equal(a.opacity, 0.5);                                         // la palabra 1 empieza 50 ms tarde
  assert.equal(stateAt(tracks, 'sheen', 2250, block).sheen, 0.5);       // segunda pasada
  assert.equal(stateAt(tracks, 'sheen', 3250, block).sheen, 1);         // agotadas las pasadas, queda al final
  assert.equal(stateAt(tracks, 'block', 2950, block).opacity, 0.5);
  assert.equal(staggerDelay({ each_ms: 10, order: 'center' }, 0, 5), 20);
  assert.equal(staggerDelay({ each_ms: 10, order: 'reverse' }, 0, 5), 40);
});

caso('rectAt: posición por tramo de toma, con paso suave entre tramos (bloque que cruza un corte)', () => {
  const block = { rect: { x: 0, y: 0, w: 100, h: 50 }, move_ms: 200, move_ease: 'linear', segments: [
    { start_ms: 0, end_ms: 1000, rect: { x: 0, y: 100, w: 100, h: 50 } },
    { start_ms: 1000, end_ms: 2000, rect: { x: 0, y: 500, w: 100, h: 50 } }] };
  assert.equal(rectAt(block, 500).y, 100);
  assert.equal(rectAt(block, 1100).y, 300);
  assert.equal(rectAt(block, 1500).y, 500);
  assert.deepEqual(rectAt({ rect: { x: 1, y: 2, w: 3, h: 4 } }, 99), { x: 1, y: 2, w: 3, h: 4 });
});

caso('validateMotion señala el punto exacto del error', () => {
  assert.throws(() => validateMotion({ tracks: [{ target: 'glifo', keys: [{ t: 0 }] }] }), /tracks\[0\]\.target desconocido/);
  assert.throws(() => validateMotion({ tracks: [{ target: 'word', keys: [{ t: 0, brillo: 1 }] }] }), /propiedad desconocida/);
  assert.throws(() => validateMotion({ tracks: [{ target: 'box', stagger: { each_ms: 5 }, keys: [{ t: 0 }] }] }), /stagger sólo vale/);
  assert.throws(() => validateMotion({ tracks: [{ target: 'word', keys: [{ t: 10 }, { t: 5 }] }] }), /va hacia atrás/);
  for (const r of F0) validateMotion(r.spec.motion, r.preset_key);
});

caso('cada entrada del contrato (§4 ter.3) se traduce a pistas válidas', () => {
  for (const entry of T.ENTRIES) validateMotion({ tracks: tracksFromEntry({ entry, duration_ms: 300, exit_ms: 200 }, { canvasHeight: 1920, px: 60 }) }, entry);
});

caso('cifras: prefijo, separadores y decimales se conservan', () => {
  assert.deepEqual(numberToken('$1.67'), { prefix: '$', value: 1.67, decimals: 2, decSep: '.', thouSep: null, suffix: '' });
  assert.deepEqual(numberToken('$200'), { prefix: '$', value: 200, decimals: 0, decSep: null, thouSep: null, suffix: '' });
  assert.equal(numberToken('$1.250,50').value, 1250.5);
  assert.equal(numberToken('20.000').value, 20000);
  assert.equal(numberToken('20%').suffix, '%');
  assert.equal(numberToken('cuenta'), null);
});

caso('la escena NO mueve la geometría: sus bloques son los de buildTextLayers, con los presets nuevos y con todos los de la siembra', () => {
  const s = buildScene(args());
  const p = T.buildTextLayers(args());
  assert.deepEqual(s.layout, p.blocks);
  assert.equal(s.blocks.length, p.blocks.filter((b) => b.layer !== 'caption_band').length);
  for (const b of s.blocks) {
    const g = p.blocks.find((x) => x.layer === b.layer && x.start_ms === b.start_ms);
    assert.deepEqual(b.rect, g.rect);
    assert.equal(b.px, g.size_px);
  }
  // Todos los presets de la siembra pasan por la escena (pistas derivadas de su `entry`).
  const pick = (l) => SEED.filter((r) => r.layer === l).map((r) => r.preset_key);
  for (let i = 0; i < 5; i++) {
    const tl = TL();
    tl.hook.preset_key = pick('hook')[i % 5]; tl.roles[0].preset_key = pick('role')[i % 5];
    tl.captions.preset_key = pick('caption')[i % 3]; tl.key_titles[0].preset_key = pick('key_title')[i % 2]; tl.cta.preset_key = pick('cta')[i % 2];
    const sc = buildScene(args({ textLayers: tl }));
    assert.deepEqual(sc.layout, T.buildTextLayers(args({ textLayers: tl })).blocks);
  }
  // El colocado a mano (v1.3.3) también llega tal cual.
  const tl = TL(); tl.cta.place = { x_pct: 50, y_pct: 30, zoom: 0.8 };
  const sc = buildScene(args({ textLayers: tl }));
  assert.equal(sc.blocks.find((b) => b.layer === 'cta').placed, 'manual');
  assert.deepEqual(sc.layout, T.buildTextLayers(args({ textLayers: tl })).blocks);
});

caso('la página es PURA sobre la escena (mismo pedido → mismo HTML) y no pide nada a la red', () => {
  const s = buildScene(args());
  const fonts = [{ family: 'Familia Display', bytes: Buffer.from('x'), format: 'truetype' }];
  const a = scenePage(s, fonts), b = scenePage(s, fonts);
  assert.equal(a, b);
  assert.ok(!/https?:\/\//.test(a.replace(/http:\/\/www\.w3\.org[^"']*/g, '')), 'la página no debe cargar nada por red');
  assert.ok(!/Math\.random|Date\.now|performance\.now|requestAnimationFrame|setTimeout|setInterval/.test(a), 'la página no puede leer reloj ni azar');
});

caso('tramos con texto y PNG vacío: el capturador sólo abre el navegador donde hay texto', () => {
  const s = buildScene(args());
  const sp = textSpans(s);
  assert.ok(sp.length >= 1 && sp.every(([a, b]) => b > a));
  const png = blankPng(4, 2);
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  assert.ok(overlayArgs({ input: 'a.mp4', fps: 30, out: 'b.mp4', filters: ['drawbox=x=0'] }).join(' ').includes('drawbox=x=0,format=yuv420p'));
});

caso('test N+1: el código del motor no nombra ninguna marca (sin comentarios)', () => {
  const dir = join(RAIZ, 'render/src/html');
  const marcas = /NeuroneSCF|ForumPHs|LucienSael|UnrealvilleStudio|SamPublisher|D7Herbal|VivoseMask|VizosCosmetics|DiamondDetails|PatriciaOsorio/i;
  for (const f of readdirSync(dir)) {
    const code = readFileSync(join(dir, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    assert.ok(!marcas.test(code), `${f} nombra una marca`);
  }
  assert.ok(!marcas.test(JSON.stringify(F0)), 'docs/html_presets_f0.json nombra una marca');
});

// 2026-11-16 — el banco de la F0 se rompió en main al retirarse `brandFontFile` (PR #26): ninguna prueba importaba el
// banco, así que CI no lo vio. Esta comprobación cubre la clase: cada nombre que un archivo de render/bench importa de
// render/src tiene que existir en ese módulo. No ejecuta el banco (su cuerpo corre al importarse).
caso('los bancos de render/bench importan sólo nombres que existen en render/src', async () => {
  const dir = join(RAIZ, 'render/bench');
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.mjs'))) {
    const src = readFileSync(join(dir, f), 'utf8');
    for (const [, names, rel] of src.matchAll(/import\s*\{([^}]+)\}\s*from\s*'(\.\.\/src\/[^']+)'/g)) {
      const mod = await import(new URL(rel, `file://${dir}/`).href);
      for (const n of names.split(',').map((s) => s.trim().split(/\s+as\s+/)[0]).filter(Boolean)) {
        assert.ok(n in mod, `${f} importa ${n} de ${rel}, que no lo exporta`);
      }
    }
  }
});

// DETERMINISMO con navegador real: dos capturas de la misma escena, misma huella por fotograma.
const FONT = ['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'].find(existsSync);
let chromium = null;
try { chromium = createRequire(import.meta.url)('playwright').chromium; } catch { /* sin Playwright */ }
if (chromium && FONT) {
  caso('determinismo: dos capturas de la misma escena dan la misma huella en cada fotograma', async () => {
    const { renderHtmlLayers } = await import('../render/src/html/capture.mjs');
    const typo = [{ role: 'display', font_family: 'Prueba Display' }, { role: 'body', font_family: 'Prueba Texto' }];
    const s = buildScene(args({ typography: typo }));
    const bytes = readFileSync(FONT);
    const fonts = typo.map((t) => ({ family: t.font_family, bytes, format: 'truetype' }));
    // Fotogramas con texto en movimiento: entrada del gancho, contador del título y brillo del CTA.
    const pick = [3, 9, 15, 90, 100, 140, 160, 175];
    const run = async () => {
      const hs = [];
      await renderHtmlLayers({ scene: s, fonts, chromium, encode: false, frames: 176,
        onFrame: (i, png) => { if (pick.includes(i)) hs.push(png.toString('base64').length + ':' + require_hash(png)); } });
      return hs;
    };
    const a = await run(), b = await run();
    assert.equal(a.length, pick.length);
    assert.deepEqual(a, b);
  });
} else console.log('  --  determinismo con navegador: se salta (sin Playwright o sin fuente local)');

import { createHash } from 'node:crypto';
function require_hash(buf) { return createHash('sha256').update(buf).digest('hex'); }

await Promise.all(pendientes);
if (fallos) { console.error(`\n${fallos} caso(s) MAL`); process.exit(1); }
console.log('\ntodo bien');
