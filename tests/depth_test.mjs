// TEXTO DETRÁS DE LAS PERSONAS (2026-11-17): dato del estilo, recorte, control de legibilidad y composición.
// Ejecutar:  node tests/depth_test.mjs
//  - puros: `depthOf`, fotogramas a recortar, interpolación y suavizado, cobertura, PNG en gris, grafo de ffmpeg;
//  - catálogo F4: los estilos nuevos son html, van detrás con tope 35 % y no nombran ninguna marca;
//  - con navegador: tres zonas, máscara por fotograma, control de legibilidad (delante con aviso) y composición final;
//  - con navegador y los archivos del recorte: el modelo corre y da la misma máscara dos veces.

import { readFileSync, writeFileSync, existsSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { buildScene, depthOf, DEPTH_MAX_COVER, DEPTH_LAYERS } from '../render/src/html/scene.mjs';
import { coverOf, pngOf, overlayArgs, blankPng } from '../render/src/html/capture.mjs';
import { depthFrames, modelFrames, fillAndSmooth, segAssets, SEG_SIZE } from '../render/src/html/segment.mjs';
import { validateMotion } from '../render/src/html/keyframes.mjs';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));
let fallos = 0;
const pendientes = [];
function caso(nombre, fn) {
  const fin = (e) => { if (e) { fallos++; console.error(`  MAL ${nombre}\n      ${e.message}`); } else console.log(`  ok  ${nombre}`); };
  try { const r = fn(); if (r && typeof r.then === 'function') pendientes.push(r.then(() => fin(), fin)); else fin(); } catch (e) { fin(e); }
}
console.log('texto detrás de las personas');

const rows = (f) => JSON.parse(readFileSync(join(RAIZ, 'docs', f), 'utf8')).rows;
const F4 = rows('html_presets_f4.json');
const PRESETS = [...rows('text_presets_seed.json'), ...rows('html_presets_f0.json'), ...rows('html_presets_f2.json'), ...rows('html_presets_f3.json'), ...F4];
const TYPO = [{ role: 'display', font_family: 'Prueba Display' }, { role: 'body', font_family: 'Prueba Texto' }];
const PALETTE = [{ role: 'hueso', hex: '#FFFFFF' }, { role: 'brasa', hex: '#F2C14E' }, { role: 'carbon', hex: '#111111' }, { role: 'mar', hex: '#00AACC' }];
const TOKENS = { palette: { headline: 'hueso', subheadline: 'hueso', headline_emphasis: 'brasa' }, layout: { scrim: { palette: 'carbon' }, rule: { palette: 'mar' } } };
const W = 1080, H = 1920;
const scene = (tl, durationMs = 3000) => buildScene({ textLayers: tl, timeline: null, presets: PRESETS, brandId: 'marca_prueba', palette: PALETTE,
  typography: TYPO, tokens: TOKENS, safeZone: { top: 8, left: 4, right: 4, bottom: 20 }, canvas: { width: W, height: H }, durationMs });
const HOOK = (preset = 'hook_behind_rise') => ({ hook: { text: 'Vista al mar', preset_key: preset, start_ms: 0, end_ms: 1000, emphasis: ['mar'] } });

caso('depthOf: dato del estilo; sólo gancho, título clave y CTA; tope por defecto 35 %', () => {
  assert.equal(depthOf({}, 'hook'), null);
  assert.deepEqual(depthOf({ depth: { mode: 'behind_subject' } }, 'hook'), { mode: 'behind_subject', max_cover: DEPTH_MAX_COVER });
  assert.equal(DEPTH_MAX_COVER, 0.35);
  assert.deepEqual(depthOf({ depth: { mode: 'behind_subject', max_cover: 0.2 } }, 'cta').max_cover, 0.2);
  assert.throws(() => depthOf({ depth: { mode: 'delante' } }, 'hook'), /depth\.mode/);
  assert.throws(() => depthOf({ depth: { mode: 'behind_subject' } }, 'caption'), /no vale en la capa caption/);
  assert.throws(() => depthOf({ depth: { mode: 'behind_subject', max_cover: 0 } }, 'hook'), /max_cover/);
  assert.deepEqual([...DEPTH_LAYERS], ['hook', 'key_title', 'cta']);
});

caso('catálogo F4: 4 estilos html, detrás con tope 35 %, movimiento válido, proposed y sin marcas', () => {
  assert.deepEqual(F4.map((r) => r.preset_key), ['hook_behind_rise', 'hook_behind_emerge', 'key_title_behind_rise', 'key_title_behind_cross']);
  for (const r of F4) {
    assert.equal(r.spec.engine, 'html', r.preset_key);
    assert.deepEqual(depthOf(r.spec, r.layer, r.preset_key), { mode: 'behind_subject', max_cover: 0.35 });
    validateMotion(r.spec.motion, r.preset_key);
    assert.equal(r.status, 'proposed'); assert.equal(r.brand_id, null);
  }
  const marcas = /neurone|nscf|forum|fphs|lucien|unrealville|unrlvl|vivose|vizos|d7|diamond|ivette|patricia|irja|sam_moreno/i;
  assert.ok(!marcas.test(JSON.stringify(F4)), 'docs/html_presets_f4.json nombra una marca');
  for (const f of ['render/src/html/segment.mjs', 'render/src/html/capture.mjs', 'render/src/html/scene.mjs', 'render/src/html/runtime.mjs']) {
    assert.ok(!marcas.test(readFileSync(join(RAIZ, f), 'utf8').replace(/\/\/.*$/gm, '')), `${f} nombra una marca`);
  }
});

// Barrera (2026-11-17, medido en el job real): con 2 líneas y mínimo 6 %, el gancho «Su cuota podría cambiar, y no por
// nada que usted hizo» no entraba y el job fallaba con VIDEOLAB_TEXT_DOES_NOT_FIT. Un estilo detrás tiene que admitir
// TODO texto que admita algún otro estilo de su capa: si no, la rotación o la ventana lo eligen y tumban la pieza.
caso('catálogo F4: cada estilo detrás admite todo texto que admite algún otro estilo de su capa', () => {
  const textos = ['Su cuota podría cambiar, y no por nada que usted hizo', 'Todas las unidades: $200', '$1.67 por metro cuadrado',
    'Esto cambia todo', 'La cuota extraordinaria se vota el jueves en la asamblea de propietarios', 'Ahorro real: 1.250,50 al año'];
  const SAFE = { top: 14, left: 6, right: 22, bottom: 37 };
  const fits = (preset, layer, text) => {
    const tl = layer === 'hook' ? { hook: { text, preset_key: preset, start_ms: 0, end_ms: 2000 } } : { key_titles: [{ text, at_ms: 0, dur_ms: 2000, preset_key: preset }] };
    try { buildScene({ textLayers: tl, timeline: null, presets: PRESETS, brandId: 'marca_prueba', palette: PALETTE, typography: TYPO, tokens: TOKENS,
      safeZone: SAFE, canvas: { width: W, height: H }, durationMs: 3000 }); return true; } catch { return false; }
  };
  for (const r of F4) {
    const otros = PRESETS.filter((x) => x.layer === r.layer && !F4.includes(x) && x.spec?.engine === 'html');
    for (const t of textos) {
      if (otros.some((o) => fits(o.preset_key, r.layer, t))) assert.ok(fits(r.preset_key, r.layer, t), `${r.preset_key} no admite «${t}» y otro estilo de ${r.layer} sí`);
    }
  }
});

caso('escena: el bloque lleva su profundidad; los fotogramas a recortar son los del bloque', () => {
  const sc = scene({ ...HOOK(), key_titles: [{ text: 'Piso 32', at_ms: 1500, dur_ms: 1000, preset_key: 'key_title_zoom_words' }] });
  assert.deepEqual(sc.blocks.map((b) => !!b.depth), [true, false]);
  const fr = depthFrames(sc);
  assert.equal(fr[0], 0); assert.equal(fr[fr.length - 1], 29); assert.equal(fr.length, 30);
  assert.deepEqual(depthFrames(scene({ key_titles: [{ text: 'Piso 32', at_ms: 0, dur_ms: 1000, preset_key: 'key_title_zoom_words' }] })), []);
});

caso('recorte: uno de cada dos fotogramas pasa por el modelo (más el último de cada tramo)', () => {
  assert.deepEqual(modelFrames([0, 1, 2, 3, 4, 10, 11]), [0, 2, 4, 10, 11]);
});

caso('interpolación y suavizado: enteros, lineal entre vecinos y [1, 2, 1] / 4 en el tiempo', () => {
  const raw = new Map([[0, Uint8Array.from([0, 100])], [2, Uint8Array.from([200, 100])]]);
  const out = fillAndSmooth([0, 1, 2], raw);
  // Interpolado: f1 = [100, 100]. Suavizado: f0 = (0+0+100+2)>>2 … con el extremo repetido.
  assert.deepEqual([...out.get(1)], [(0 + 200 + 200 + 2) >> 2, 100]);
  assert.deepEqual([...out.get(0)], [(0 + 0 + 100 + 2) >> 2, 100]);
  assert.deepEqual([...out.get(2)], [(100 + 400 + 200 + 2) >> 2, 100]);
});

caso('cobertura: fracción del área de las palabras que cae dentro de la persona', () => {
  const mask = { w: 4, h: 4, data: Uint8Array.from([255, 255, 0, 0, 255, 255, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]) };
  // Una palabra en el cuadrante de arriba a la izquierda (todo persona) y otra igual en el de abajo a la derecha (nada).
  assert.equal(coverOf([{ mask, rects: [[0, 0, 540, 960]] }], W, H), 1);
  assert.equal(coverOf([{ mask, rects: [[0, 0, 540, 960], [540, 960, 540, 960]] }], W, H), 0.5);
  assert.equal(coverOf([{ mask, rects: [] }], W, H), 0);
});

caso('PNG en gris: ffmpeg lo lee con los mismos valores', () => {
  const dir = mkdtempSync(join(tmpdir(), 'vl-depth-'));
  const px = Uint8Array.from({ length: 8 * 4 }, (_, i) => (i * 8) % 256);
  const f = join(dir, 'm.png');
  writeFileSync(f, pngOf(8, 4, 0, px));
  const back = execFileSync('ffmpeg', ['-loglevel', 'error', '-i', f, '-f', 'rawvideo', '-pix_fmt', 'gray', 'pipe:1']);
  assert.deepEqual([...back], [...px]);
  assert.equal(blankPng(2, 2).length > 0, true);
});

caso('grafo de ffmpeg con texto detrás: cada tramo entra en su segundo, con su máscara, entre el video y el texto de delante', () => {
  const a = overlayArgs({ input: 'in.mp4', fps: 30, out: 'o.mp4', size: { w: W, h: H }, behind: [{ dir: '/t/d0', start_s: 1.5 }, { dir: '/t/d1', start_s: 9 }] });
  const g = a[a.indexOf('-filter_complex') + 1];
  assert.deepEqual(a.slice(a.indexOf('-itsoffset'), a.indexOf('-itsoffset') + 6), ['-itsoffset', '1.5', '-framerate', '30', '-i', '/t/d0/b_%05d.png']);
  assert.ok(a.includes('/t/d1/m_%05d.png'));
  assert.match(g, /\[3:v\]scale=1080:1920:flags=bicubic,format=gray,negate\[inv0\]/);
  assert.match(g, /blend=all_mode=multiply/);
  assert.match(g, /\[0:v\]\[bm0\]overlay.*\[c0\]\[bm1\]overlay.*\[c1\]\[o\]overlay/);
  const sin = overlayArgs({ input: 'in.mp4', fps: 30, out: 'o.mp4' });
  assert.equal(sin[sin.indexOf('-filter_complex') + 1], '[1:v]format=rgba[o];[0:v][o]overlay=0:0:format=auto:eof_action=pass[m];[m]format=yuv420p[v]', 'sin texto detrás, el grafo de siempre');
});

// ── Con navegador: tres zonas, máscara por fotograma, control de legibilidad y composición ──
const { findHeadlessShell } = await import('../render/src/html/cdp.mjs');
const SHELL = findHeadlessShell();
const FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';
if (SHELL && existsSync(FONT)) {
  const { renderHtmlLayers } = await import('../render/src/html/capture.mjs');
  const fonts = TYPO.map((t) => ({ family: t.font_family, bytes: readFileSync(FONT), weight: 700, format: 'truetype' }));
  const dir = mkdtempSync(join(tmpdir(), 'vl-depth-'));
  const base = join(dir, 'base.mp4');
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `color=c=0x204060:s=${W}x${H}:r=30:d=1.2`, '-f', 'lavfi', '-i', 'sine=f=300:d=1.2',
    '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', base]);
  const sc = scene(HOOK(), 1200);
  const frames = depthFrames(sc);
  // Máscara sintética: la mitad izquierda del lienzo es «persona».
  const half = new Uint8Array(SEG_SIZE.w * SEG_SIZE.h);
  for (let y = 0; y < SEG_SIZE.h; y++) for (let x = 0; x < SEG_SIZE.w / 2; x++) half[y * SEG_SIZE.w + x] = 255;
  const maskOf = (data) => ({ w: SEG_SIZE.w, h: SEG_SIZE.h, data, png: pngOf(SEG_SIZE.w, SEG_SIZE.h, 0, data) });
  const half4 = new Map(frames.map((f) => [f, maskOf(half)]));
  const none = new Map(frames.map((f) => [f, maskOf(new Uint8Array(SEG_SIZE.w * SEG_SIZE.h))]));

  caso('con navegador: la persona tapa la mitad del texto → pasa el tope y el bloque va delante, con aviso', async () => {
    const r = await renderHtmlLayers({ scene: sc, fonts, input: base, browserPath: SHELL, mode: 'screenshot', encode: false, frames: 2, masks: half4 });
    assert.equal(r.depth[0].placed, 'front', JSON.stringify(r.depth));
    assert.ok(r.depth[0].cover > 0.35 && r.depth[0].cover < 0.8, `cobertura ${r.depth[0].cover}`);
    assert.ok(r.warnings.some((w) => w.startsWith('TEXT_BEHIND_FALLBACK')), r.warnings.join(' | '));
  });
  caso('con navegador: sin recorte, el bloque va delante y se avisa (TEXT_DEPTH_FALLBACK)', async () => {
    const r = await renderHtmlLayers({ scene: sc, fonts, input: base, browserPath: SHELL, mode: 'screenshot', encode: false, frames: 2, masks: null, maskNote: 'prueba' });
    assert.equal(r.depth[0].placed, 'front');
    assert.ok(r.warnings.some((w) => w.startsWith('TEXT_DEPTH_FALLBACK') && w.includes('prueba')), r.warnings.join(' | '));
  });
  caso('con navegador: detrás de verdad — donde está la persona no hay texto; fuera de ella, sí; y dos veces da lo mismo', async () => {
    // Máscara: una franja a la izquierda (42 % del ancho, no pasa el tope); `none` es la referencia sin persona.
    const strip = new Uint8Array(SEG_SIZE.w * SEG_SIZE.h);
    for (let y = 0; y < SEG_SIZE.h; y++) for (let x = 0; x < SEG_SIZE.w * 0.42; x++) strip[y * SEG_SIZE.w + x] = 255;
    const stripM = new Map(frames.map((f) => [f, maskOf(strip)]));
    const out = (n) => join(dir, `o${n}.mp4`);
    const r1 = await renderHtmlLayers({ scene: sc, fonts, input: base, out: out(1), browserPath: SHELL, masks: stripM });
    const r2 = await renderHtmlLayers({ scene: sc, fonts, input: base, out: out(2), browserPath: SHELL, masks: stripM });
    const r0 = await renderHtmlLayers({ scene: sc, fonts, input: base, out: out(0), browserPath: SHELL, masks: none });
    assert.equal(r1.depth[0].placed, 'behind', JSON.stringify(r1.depth));
    assert.equal(r1.digest, r2.digest);
    const sha = (f) => createHash('sha256').update(readFileSync(f)).digest('hex');
    assert.equal(sha(out(1)), sha(out(2)), 'mismo pedido → mismo MP4');
    // Fotograma del medio: el texto (blanco) se ve a la derecha de la franja y no dentro de ella.
    const grab = (f) => execFileSync('ffmpeg', ['-loglevel', 'error', '-ss', '0.8', '-i', f, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'gray', 'pipe:1'], { maxBuffer: 1 << 24 });
    const g1 = grab(out(1)), g0 = grab(out(0));
    const bright = (g, x0, x1) => { let n = 0; for (let y = 150; y < 700; y++) for (let x = x0; x < x1; x++) if (g[y * W + x] > 200) n++; return n; };
    const cut = Math.floor(W * 0.42);
    assert.ok(bright(g0, 0, cut - 8) > 500, 'sin persona, el texto se ve también a la izquierda');
    assert.equal(bright(g1, 0, cut - 8), 0, 'dentro de la persona no hay texto');
    assert.ok(bright(g1, cut + 8, W) > 500, 'fuera de la persona, el texto se ve');
  });
} else console.log('  --  pruebas con navegador: se saltan (sin chrome-headless-shell o sin DejaVu)');

// ── Con navegador y los archivos del recorte: el modelo corre y es repetible ──
const ASSETS = segAssets();
if (SHELL && ASSETS) {
  const { segmentFrames } = await import('../render/src/html/segment.mjs');
  caso('recorte con el modelo: corre en el navegador y da la misma máscara dos veces', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vl-seg-'));
    const v = join(dir, 'v.mp4');
    // Una silueta clara sobre fondo: un óvalo «cabeza» y un rectángulo «cuerpo» (sin persona real: basta con que corra).
    execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `color=c=0x8899aa:s=${W}x${H}:r=30:d=0.2`,
      '-vf', 'drawbox=x=380:y=600:w=320:h=900:color=0x302010:t=fill,drawbox=x=440:y=380:w=200:h=240:color=0xc08060:t=fill', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', v]);
    const a = await segmentFrames({ input: v, frames: [0, 1, 2, 3], fps: 30, browserPath: SHELL, assets: ASSETS });
    const b = await segmentFrames({ input: v, frames: [0, 1, 2, 3], fps: 30, browserPath: SHELL, assets: ASSETS });
    assert.deepEqual([...a.keys()], [0, 1, 2, 3]);
    for (const f of a.keys()) assert.equal(Buffer.compare(Buffer.from(a.get(f).data), Buffer.from(b.get(f).data)), 0, `fotograma ${f}`);
  });
} else console.log('  --  recorte con el modelo: se salta (sin navegador o sin los archivos de render/scripts/seg-assets.sh)');

await Promise.all(pendientes);
if (fallos) { console.error(`\n${fallos} caso(s) MAL`); process.exit(1); }
console.log('\ntexto detrás: todo en verde');
