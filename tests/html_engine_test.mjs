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
const F2 = JSON.parse(readFileSync(join(RAIZ, 'docs/html_presets_f2.json'), 'utf8')).rows;
const PRESETS = [...SEED, ...F0, ...F2];

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

caso('resorte (F1): 0 en 0 y 1 en 1; con poca amortiguación pasa de 1 (rebota); crítico o sobreamortiguado, nunca', () => {
  const max = (f) => { let m = 0; for (let i = 0; i <= 2000; i++) m = Math.max(m, f(i / 2000)); return m; };
  for (const s of ['spring:300,10,1', 'spring:300,40,1', 'spring:100,20', 'spring:170,26,1']) {
    const f = easeFn(s);
    assert.equal(f(0), 0, s); assert.equal(f(1), 1, s);
    assert.ok(Math.abs(f(0.999) - 1) < 0.01, `${s} no se asentó al final del tramo: ${f(0.999)}`);
  }
  assert.ok(max(easeFn('spring:300,10,1')) > 1.2, 'con amortiguación 10 debe rebotar');
  assert.ok(max(easeFn('spring:300,40,1')) <= 1 + 1e-9, 'con amortiguación 40 no debe rebotar');
  assert.ok(max(easeFn('spring:100,20,1')) <= 1 + 1e-9, 'crítico: no rebota');
  assert.equal(easeFn('spring:300,10,1')(0.37), easeFn('spring:300,10,1')(0.37));
  assert.throws(() => easeFn('spring:300'), /spring inválido/);
  assert.throws(() => easeFn('spring:0,10,1'), /spring inválido/);
  validateMotion({ tracks: [{ target: 'block', keys: [{ t: 0, y_em: 1 }, { t: 600, y_em: 0, ease: 'spring:300,12,1' }] }] });
});

caso('el núcleo que importa la vista previa (ease, keyframes, runtime) no depende de Node ni de nada fuera de sí', () => {
  const permitido = { 'ease.mjs': [], 'keyframes.mjs': ['./ease.mjs'], 'runtime.mjs': ['./keyframes.mjs'] };
  for (const [f, deps] of Object.entries(permitido)) {
    const src = readFileSync(join(RAIZ, 'render/src/html', f), 'utf8');
    const imports = [...src.matchAll(/^import .* from '([^']+)';$/gm)].map((m) => m[1]);
    assert.deepEqual(imports, deps, `${f} importa ${imports.join(', ')}`);
    assert.ok(!/\b(process|Buffer|require)\b[.(]/.test(src.replace(/\/\/.*$/gm, '')), `${f} usa algo de Node`);
  }
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
  for (const r of [...F0, ...F2]) validateMotion(r.spec.motion, r.preset_key);
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

// F2 (2026-11-17, objetivo validado por Sam): 5 estilos html por capa, rotables entre generaciones.
caso('catálogo F2: 5 estilos html por capa (F0 + F2), claves únicas, todos proposed y de sistema', () => {
  const html = [...F0, ...F2];
  const porCapa = {};
  for (const r of html) { assert.equal(r.spec.engine, 'html', r.preset_key); porCapa[r.layer] = (porCapa[r.layer] ?? 0) + 1; }
  assert.deepEqual(porCapa, { hook: 5, role: 5, caption: 5, key_title: 5, cta: 5 });
  assert.equal(new Set([...SEED, ...html].map((r) => r.preset_key)).size, SEED.length + html.length, 'clave repetida');
  for (const r of F2) { assert.equal(r.status, 'proposed'); assert.equal(r.brand_id, null); }
});
caso('catálogo F2: cada rol entra en ≤ 350 ms y sin rebote, también con sus pistas (y la barrera ve un rol que rebota)', () => {
  for (const r of F2.filter((x) => x.layer === 'role')) assert.equal(T.roleMotionProblem(r.spec.motion, r.spec.max_lines), null, r.preset_key);
  const malo = { ...F2.find((x) => x.layer === 'role'), preset_key: 'rol_que_rebota' };
  malo.spec = { ...malo.spec, motion: { tracks: [{ target: 'block', keys: [{ t: 0, scale: 0.8 }, { t: 300, scale: 1, ease: 'back_out' }] }] } };
  assert.throws(() => T.resolveTextPreset([malo], 'rol_que_rebota', BRAND, 'role'), /rebota/);
});
caso('catálogo F2: cada estilo arma su escena en su capa sin mover la geometría', () => {
  const slot = { hook: (tl, k) => { tl.hook.preset_key = k; }, role: (tl, k) => { tl.roles[0].preset_key = k; },
    caption: (tl, k) => { tl.captions.preset_key = k; }, key_title: (tl, k) => { tl.key_titles[0].preset_key = k; }, cta: (tl, k) => { tl.cta.preset_key = k; } };
  for (const r of F2) {
    const tl = TL(); slot[r.layer](tl, r.preset_key);
    const a = args({ textLayers: tl });
    const s = buildScene(a);
    assert.deepEqual(s.layout, T.buildTextLayers(a).blocks, r.preset_key);
    if (r.layer === 'caption') assert.ok(s.captions?.tracks?.length, `${r.preset_key}: subtítulos sin pistas`);
    else assert.ok(s.blocks.some((b) => b.preset_key === r.preset_key || b.layer === r.layer), r.preset_key);
  }
});

caso('test N+1: el código del motor no nombra ninguna marca (sin comentarios)', () => {
  const dir = join(RAIZ, 'render/src/html');
  const marcas = /NeuroneSCF|ForumPHs|LucienSael|UnrealvilleStudio|SamPublisher|D7Herbal|VivoseMask|VizosCosmetics|DiamondDetails|PatriciaOsorio/i;
  for (const f of readdirSync(dir)) {
    const code = readFileSync(join(dir, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    assert.ok(!marcas.test(code), `${f} nombra una marca`);
  }
  assert.ok(!marcas.test(JSON.stringify(F0)), 'docs/html_presets_f0.json nombra una marca');
  assert.ok(!marcas.test(JSON.stringify(F2)), 'docs/html_presets_f2.json nombra una marca');
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

// DETERMINISMO con navegador real (chrome-headless-shell por CDP crudo, F1).
//  1) dos capturas de la misma escena dan la misma huella en cada fotograma;
//  2) beginFrame y captureScreenshot dan EL MISMO PÍXEL (vigilancia R1.1): el respaldo no cambia el video.
const FONT = ['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'].find(existsSync);
const { findHeadlessShell } = await import('../render/src/html/cdp.mjs');
const SHELL = findHeadlessShell();
if (SHELL && FONT) {
  const { renderHtmlLayers } = await import('../render/src/html/capture.mjs');
  const typo = [{ role: 'display', font_family: 'Prueba Display' }, { role: 'body', font_family: 'Prueba Texto' }];
  const sc = buildScene(args({ typography: typo }));
  const bytes = readFileSync(FONT);
  const fonts = typo.map((t) => ({ family: t.font_family, bytes, format: 'truetype' }));
  // Fotogramas con texto en movimiento: entrada del gancho, contador del título y brillo del CTA.
  const pick = [3, 9, 15, 90, 100, 140, 160, 175];
  const run = async (mode) => {
    const hs = [];
    const r = await renderHtmlLayers({ scene: sc, fonts, browserPath: SHELL, mode, encode: false, frames: 176,
      onFrame: (i, png) => { if (pick.includes(i)) hs.push(require_hash(png)); } });
    return { hs, mode: r.mode, warnings: r.warnings };
  };
  caso('determinismo: dos capturas de la misma escena dan la misma huella en cada fotograma', async () => {
    const a = await run('beginframe'), b = await run('beginframe');
    assert.equal(a.mode, 'beginframe', `capturó en ${a.mode}: ${a.warnings.join(' | ')}`);
    assert.equal(a.hs.length, pick.length);
    assert.deepEqual(a.hs, b.hs);
  });
  caso('beginFrame y captureScreenshot dan el mismo píxel en cada fotograma (el respaldo no cambia el video)', async () => {
    const a = await run('beginframe'), b = await run('screenshot');
    assert.equal(b.mode, 'screenshot');
    assert.deepEqual(a.hs, b.hs);
  });
  // SIN MEMORIA (F1, 2026-11-16): llegar a un fotograma saltando da el mismo píxel que llegar en orden. Sin
  // --disable-partial-raster el compositor reutilizaba tiles del fotograma anterior y el 175 salía distinto (medido).
  // La vista previa salta cada vez que el operador mueve el cabezal: sin esta propiedad no sería fiel.
  caso('sin memoria: saltar a un fotograma da el mismo píxel que llegar a él en orden', async () => {
    const { scenePage } = await import('../render/src/html/page.mjs');
    const { openPage } = await import('../render/src/html/cdp.mjs');
    const { mkdtempSync, writeFileSync: wf, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const dir = mkdtempSync(join(tmpdir(), 'vl-salto-'));
    wf(join(dir, 'p.html'), scenePage(sc, fonts));
    const page = await openPage({ browserPath: SHELL, url: `file://${dir}/p.html`, width: 1080, height: 1920, mode: 'screenshot' });
    const hs = [];
    try {
      await page.evaluate('window.__vl.ready');
      for (const i of [...pick].reverse()) { await page.evaluate(`window.__vl.seek(${(i * 1000) / 30})`); hs.unshift(require_hash(await page.frame(true))); }
    } finally { await page.close(); rmSync(dir, { recursive: true, force: true }); }
    const seq = await run('screenshot');
    assert.deepEqual(hs, seq.hs);
  });
  // UNA FAMILIA QUE SÓLO SE DIBUJA EN NEGRITA (F2, 2026-11-17). Con su cara regular declarada pero sin usar, el navegador no
  // la cargaba y la comprobación de fuentes daba falso: el motor HTML fallaba y la pieza caía a ASS.
  const BOLD = ['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'].find(existsSync);
  if (BOLD) caso('una familia sólo en negrita (con su cara regular declarada) carga y se captura', async () => {
    const tl = { hook: TL().hook };   // hook_char_rise es negrita: la familia display sólo se usa en negrita
    const s2 = buildScene(args({ typography: typo, durationMs: 1000, textLayers: tl }));
    const f2 = [{ family: typo[0].font_family, bytes, format: 'truetype' },
      { family: typo[0].font_family, bytes: readFileSync(BOLD), format: 'truetype', weight: 700 }];
    const r = await renderHtmlLayers({ scene: s2, fonts: f2, browserPath: SHELL, mode: 'screenshot', encode: false, frames: 3 });
    assert.equal(r.captured, 3);
  });
  // LA FRANJA NO SE APAGA EN LAS PAUSAS (2026-11-17). Fuera de los tramos con texto el capturador repite un fotograma de
  // reposo; era un PNG transparente y, desde que la franja se dibuja en la página, se apagaba en cada pausa entre
  // subtítulos (medido en el job real: 55 fotogramas sin franja). El reposo sale ahora de la página: la franja sigue ahí.
  caso('la franja de identidad sigue en los fotogramas sin texto (pausas entre subtítulos)', async () => {
    // Sólo gancho (0–2,6 s) y franja, en 4 s: de 2,6 s en adelante es una pausa sin texto.
    const sc = buildScene(args({ typography: typo, durationMs: 4000, textLayers: { hook: TL().hook, identity: TL().identity } }));
    assert.ok(sc.strip, 'la escena de prueba lleva franja');
    const spans = textSpans(sc);
    const total = Math.round((sc.durationMs / 1000) * sc.fps);
    const enSpan = (i) => spans.some(([a, b]) => (i * 1000) / sc.fps >= a && (i * 1000) / sc.fps < b);
    const pausa = [...Array(total).keys()].find((i) => !enSpan(i));
    const conTexto = [...Array(total).keys()].find((i) => enSpan(i));
    assert.ok(pausa != null && conTexto != null, 'la escena de prueba necesita una pausa sin texto');
    const pngs = {};
    await renderHtmlLayers({ scene: sc, fonts, browserPath: SHELL, mode: 'screenshot', encode: false, frames: Math.max(pausa, conTexto) + 1,
      onFrame: (i, png) => { if (i === pausa || i === conTexto) pngs[i] = png; } });
    // El color del píxel en medio de la franja, leído con ffmpeg (sin dependencias de PNG en Node).
    const { spawnSync } = await import('node:child_process');
    const px = (png) => {
      const x = Math.floor(sc.strip.x + sc.strip.w / 2), y = Math.floor(sc.strip.y + sc.strip.h / 2);
      const r = spawnSync('ffmpeg', ['-v', 'error', '-f', 'png_pipe', '-i', 'pipe:0', '-vf', `crop=1:1:${x}:${y}`, '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1'], { input: png });
      return [...r.stdout].map((v) => v.toString(16).padStart(2, '0')).join('');
    };
    const esperado = sc.strip.color.replace('#', '').toLowerCase() + 'ff';
    assert.equal(px(pngs[conTexto]), esperado, 'con texto');
    assert.equal(px(pngs[pausa]), esperado, `en la pausa (fotograma ${pausa})`);
  });
  // RECORTE A LA ZONA SEGURA (F2, 2026-11-17; contrato §4 ter.4). Una entrada que agranda el bloque no sale de la zona
  // segura ni tapa la franja: el sello entra a 1,25× y antes cubría la franja un par de fotogramas (medido en una muestra).
  caso('una entrada que agranda el bloque no pinta fuera de la zona segura ni tapa la franja', async () => {
    const tl = { key_titles: [{ text: 'Una frase clave bastante larga para el sello', at_ms: 0, dur_ms: 1500, preset_key: 'key_title_stamp_spring' }],
      identity: TL().identity };
    const s3 = buildScene(args({ typography: typo, durationMs: 1500, textLayers: tl }));
    const b = s3.blocks[0];
    assert.ok(b.rect.w * 1.25 > s3.safe.w, 'el sello agrandado tiene que pasar del ancho seguro para que la prueba valga');
    const pngs = {};
    await renderHtmlLayers({ scene: s3, fonts, browserPath: SHELL, mode: 'screenshot', encode: false, frames: 3, onFrame: (i, png) => { pngs[i] = png; } });
    const { spawnSync } = await import('node:child_process');
    const px = (png, x, y) => [...spawnSync('ffmpeg', ['-v', 'error', '-f', 'png_pipe', '-i', 'pipe:0', '-vf', `crop=1:1:${x}:${y}`, '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1'], { input: png }).stdout];
    const y = Math.round(b.rect.y + b.rect.h / 2);
    assert.equal(px(pngs[1], s3.safe.x - 3, y)[3], 0, 'fuera de la zona segura no se pinta');
    const sx = Math.floor(s3.strip.x + s3.strip.w / 2);
    assert.equal(Buffer.from(px(pngs[1], sx, y)).toString('hex'), s3.strip.color.slice(1).toLowerCase() + 'ff', 'la franja sigue intacta');
  });
  // SUBTÍTULOS DE MERCADO (F2, ronda 2): caja en la palabra activa, aparición al decirse, salto al sonar y sólo palabras
  // clave. Se comprueba en un navegador real leyendo el DOM después de `seek` (el runtime es el mismo del job).
  caso('subtítulos de mercado: caja en la palabra activa, aparición al decirse, salto al sonar y sólo palabras clave', async () => {
    const { scenePage } = await import('../render/src/html/page.mjs');
    const { openPage } = await import('../render/src/html/cdp.mjs');
    const { mkdtempSync, writeFileSync: wf, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const probe = async (preset, extra = {}) => {
      const tl = { captions: { enabled: true, preset_key: preset, accent_role: 'brasa', ...extra } };
      const s4 = buildScene(args({ typography: typo, durationMs: 3000, textLayers: tl }));
      const dir = mkdtempSync(join(tmpdir(), 'vl-cap-'));
      wf(join(dir, 'p.html'), scenePage(s4, fonts));
      const page = await openPage({ browserPath: SHELL, url: `file://${dir}/p.html`, width: 1080, height: 1920, mode: 'screenshot' });
      try {
        await page.evaluate('window.__vl.ready');
        await page.evaluate('window.__vl.seek(100)');   // suena la 1.ª palabra («Hoy», 0–260 ms); la 2.ª empieza en 300
        return JSON.parse(await page.evaluate(`JSON.stringify([...document.querySelectorAll('#root span')].filter((x) => x.parentElement.tagName === 'DIV').slice(0, 3).map((x) => ({
          t: x.firstChild?.textContent, op: x.style.opacity, color: getComputedStyle(x).color, tf: x.style.transform,
          box: x.querySelector('span') ? x.querySelector('span').style.display : null })))`));
      } finally { await page.close(); rmSync(dir, { recursive: true, force: true }); }
    };
    const box = await probe('caption_html_word_box');
    assert.equal(box[0].box, 'block', 'la palabra que suena lleva su caja');
    assert.equal(box[1].box, 'none', 'la que no suena, no');
    const rev = await probe('caption_html_bold_reveal');
    assert.notEqual(rev[0].op, '0', 'la palabra dicha se ve');
    assert.equal(rev[1].op, '0', 'la que aún no se dijo, no');
    assert.match(rev[0].tf, /scale\(1\.\d+/, 'salta al sonar');
    const kw = await probe('caption_html_keywords', { keywords: ['cuento'] });
    // «Hoy» suena pero no es palabra clave: color de texto; «cuento» es clave: en el acento aunque no suene todavía.
    assert.notEqual(kw[0].color, kw[2].color, JSON.stringify(kw));
    assert.equal(kw[2].color, 'rgb(255, 136, 0)');
  });
  // VISTA PREVIA FIEL (F1): el runtime cargado como módulo ES por HTTP —como lo carga el Orchestrator, desde
  // /engine/<versión>/runtime.mjs servido por api/engine.js— dibuja EL MISMO PÍXEL que la página del capturador del job.
  caso('vista previa: el runtime servido como módulo ES dibuja el mismo píxel que el capturador del job', async () => {
    const { createServer } = await import('node:http');
    const { default: engine } = await import('../api/engine.js');
    const { RUNTIME_VERSION } = await import('../render/src/html/runtime.mjs');
    const { openPage } = await import('../render/src/html/cdp.mjs');
    const faces = fonts.map((f) => `@font-face{font-family:${JSON.stringify(f.family)};src:url(data:font/ttf;base64,${f.bytes.toString('base64')}) format("truetype");font-weight:400;font-style:normal;font-display:block}`).join('\n');
    const preview = `<!doctype html><html><head><meta charset="utf-8"><style>${faces}
html,body{margin:0;padding:0;background:transparent;overflow:hidden;width:1080px;height:1920px}#root{position:absolute;left:0;top:0}
*{animation:none!important;transition:none!important;caret-color:transparent}</style></head><body><div id="root"></div>
<script type="module">
import { mount } from '/engine/${RUNTIME_VERSION}/runtime.mjs';
const SCENE = ${JSON.stringify(sc).replace(/</g, '\\u003c')};
const VL = mount(document.getElementById('root'), SCENE, document);
window.__vl = { seek: VL.seek, check: VL.check, ready: document.fonts.ready.then(() => { VL.prepare(); return SCENE.families.map((f) => document.fonts.check('40px ' + JSON.stringify(f))); }) };
</script></body></html>`;
    const srv = createServer((req, res) => {
      const m = req.url.match(/^\/engine\/([^/]+)\/([^/?]+)$/);
      if (m) {
        // El mismo manejador que publica Vercel, con un `res` mínimo.
        const out = { code: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, send(b) { res.writeHead(this.code, this.headers); res.end(b); } };
        return engine({ query: { version: m[1], file: m[2] } }, out);
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(preview);
    });
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    const page = await openPage({ browserPath: SHELL, url: `http://127.0.0.1:${srv.address().port}/`, width: 1080, height: 1920, mode: 'screenshot', blockNetwork: false });
    const hs = [];
    try {
      for (const i of pick) { await page.evaluate(`window.__vl.seek(${(i * 1000) / 30})`); hs.push(require_hash(await page.frame(true))); }
    } finally { await page.close(); srv.close(); }
    const job = await run('screenshot');
    assert.deepEqual(hs, job.hs);
  });
} else console.log('  --  determinismo con navegador: se salta (sin chrome-headless-shell o sin fuente local)');

import { createHash } from 'node:crypto';
function require_hash(buf) { return createHash('sha256').update(buf).digest('hex'); }

await Promise.all(pendientes);
if (fallos) { console.error(`\n${fallos} caso(s) MAL`); process.exit(1); }
console.log('\ntodo bien');
