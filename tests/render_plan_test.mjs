// RENDER PROPIO (F4) — el bloque PURO: preset por dato, plan de ffmpeg determinista, texto VERBATIM, lienzo del
// perfil y ninguna marca en el código (test de la marca N+1).
//
// Ejecutar:  node tests/render_plan_test.mjs     (sin red, sin ffmpeg)

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import * as P from '../render/src/plan.mjs';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));

let fallos = 0;
function caso(nombre, fn) {
  try { fn(); console.log(`  ok  ${nombre}`); } catch (e) { fallos++; console.error(`  MAL ${nombre}\n      ${e.message}`); }
}

const DEF = { brand_id: null, format: 'reel', video_style: 'product_showcase', active: true, duration_sec: 20, producer: 'render',
  motion: { kind: 'push_in', zoom_from: 1, zoom_to: 1.08 }, text_treatment: { entry: 'fade' },
  audio_mix: { voice_lufs: -16, music_lufs: -28, ducking_db: 10, fade_ms: 400 } };
const MARCA = { ...DEF, brand_id: 'marca_sintetica_a', motion: { kind: 'push_in', zoom_from: 1, zoom_to: 1.2 } };
const CANVAS = { width: 1080, height: 1920 };

console.log('render_plan — bloque puro del render propio');

caso('preset: la fila de la marca manda; sin ella, la del sistema', () => {
  assert.equal(P.resolvePreset([DEF, MARCA], 'marca_sintetica_a', 'product_showcase').motion.zoom_to, 1.2);
  assert.equal(P.resolvePreset([DEF, MARCA], 'marca_sintetica_b', 'product_showcase').source, 'system');
});

caso('preset: la fila de la marca inactiva apaga el estilo para esa marca (no cae al del sistema)', () => {
  assert.throws(() => P.resolvePreset([DEF, { ...MARCA, active: false }], 'marca_sintetica_a', 'product_showcase'),
    (e) => e.label === 'VIDEOLAB_STYLE_NOT_DECLARED');
});

caso('preset: sin ninguna fila ⇒ VIDEOLAB_STYLE_NOT_DECLARED', () => {
  assert.throws(() => P.resolvePreset([DEF], 'x', 'unboxing'), (e) => e.label === 'VIDEOLAB_STYLE_NOT_DECLARED');
});

caso('duración: voz + cola; sin voz, la del preset; tope de 60 s', () => {
  assert.equal(P.renderDurationS({ preset: DEF, voiceMs: 6000 }), 6.8);
  assert.equal(P.renderDurationS({ preset: DEF, voiceMs: null }), 20);
  assert.equal(P.renderDurationS({ preset: DEF, voiceMs: 90000 }), 60);
});

const IN = { images: ['a.png'], layer: 'l.png', voice: { path: 'v.mp3', ms: 6000 }, music: { path: 'm.mp3' }, out: 'o.mp4' };

caso('plan determinista: misma entrada, mismos argumentos', () => {
  assert.deepEqual(P.planRender({ preset: DEF, canvas: CANVAS, inputs: IN }), P.planRender({ preset: DEF, canvas: CANVAS, inputs: IN }));
});

caso('plan: el movimiento y la mezcla salen del preset (dato), no del código', () => {
  const a = P.planRender({ preset: DEF, canvas: CANVAS, inputs: IN }).args.join(' ');
  const b = P.planRender({ preset: MARCA, canvas: CANVAS, inputs: IN }).args.join(' ');
  assert.notEqual(a, b);
  assert.match(a, /loudnorm=I=-16/);
  assert.match(a, /loudnorm=I=-28/);
  assert.match(a, /sidechaincompress/);
  assert.match(a, /overlay=0:0/);
});

caso('plan: salida del contrato (H.264, yuv420p, 30 fps, AAC 48 kHz, faststart)', () => {
  const a = P.planRender({ preset: DEF, canvas: CANVAS, inputs: IN }).args.join(' ');
  for (const s of ['-c:v libx264', '-pix_fmt yuv420p', '-r 30', '-c:a aac', '-ar 48000', '+faststart']) assert.ok(a.includes(s), s);
});

caso('plan: sin voz ni música hay pista de audio igual (silencio): TikTok exige audio', () => {
  const a = P.planRender({ preset: DEF, canvas: CANVAS, inputs: { ...IN, voice: null, music: null } }).args.join(' ');
  assert.match(a, /anullsrc/);
});

caso('plan: before_after necesita dos imágenes; el render propio no fabrica estilos de otro productor', () => {
  const ba = { ...DEF, video_style: 'before_after' };
  assert.throws(() => P.planRender({ preset: ba, canvas: CANVAS, inputs: IN }), (e) => e.label === 'VIDEOLAB_BAD_REQUEST');
  assert.match(P.planRender({ preset: ba, canvas: CANVAS, inputs: { ...IN, images: ['a', 'b'] } }).args.join(' '), /xfade/);
  assert.throws(() => P.planRender({ preset: { ...DEF, video_style: 'ugc' }, canvas: CANVAS, inputs: IN }),
    (e) => e.label === 'VIDEOLAB_PRODUCER_NOT_ACTIVE');
});

caso('texto VERBATIM: titular y bajada por orden; lo que no tiene ranura se devuelve, no se inventa', () => {
  const t = P.overlayTextFrom([{ order: 2, text: 'Compra hoy', role: 'cta' }, { order: 1, text: 'Sub  con  espacios ', role: 'subheadline' },
    { order: 0, text: 'Titular exacto.', role: 'headline', emphasis: ['exacto'] }]);
  assert.equal(t.headline, 'Titular exacto.');
  assert.equal(t.subheadline, 'Sub  con  espacios ');
  assert.deepEqual(t.emphasis, ['exacto']);
  assert.deepEqual(t.unplaced, [{ order: 2, role: 'cta' }]);
});

caso('lienzo: sale del perfil; uno distinto pedido ⇒ VIDEOLAB_CANVAS_MISMATCH; sin perfil ⇒ BAD_REQUEST', () => {
  assert.deepEqual(P.resolveCanvas(null, { canvas_width: 1080, canvas_height: 1920 }), CANVAS);
  assert.throws(() => P.resolveCanvas({ width: 720, height: 1280 }, { canvas_width: 1080, canvas_height: 1920 }),
    (e) => e.label === 'VIDEOLAB_CANVAS_MISMATCH');
  assert.throws(() => P.resolveCanvas(null, null), (e) => e.label === 'VIDEOLAB_BAD_REQUEST');
});

caso('validación del MP4: caza lienzo, códec, fps y la falta de audio', () => {
  const ok = { streams: [{ codec_type: 'video', codec_name: 'h264', width: 1080, height: 1920, pix_fmt: 'yuv420p', r_frame_rate: '30/1' },
    { codec_type: 'audio', codec_name: 'aac', sample_rate: '48000' }], format: { duration: '20.0' } };
  assert.deepEqual(P.validateOutput(ok, CANVAS, 1000), []);
  const mal = { streams: [{ ...ok.streams[0], width: 720, codec_name: 'hevc', r_frame_rate: '25/1' }], format: { duration: '20' } };
  assert.equal(P.validateOutput(mal, CANVAS, 1000).length, 4);
});

caso('marca N+1: el código del render no nombra ninguna marca ni persona', () => {
  const INSTANCIAS = ['NeuroneSCF', 'ForumPHs', 'UnrealvilleStudio', 'LucienSael', 'D7Herbal', 'DiamondDetails', 'VivoseMask',
    'VizosCosmetics', 'PatriciaOsorio', 'Patricia', 'Irja', 'Ivette', 'Lucien', 'NSCF', 'FPHS', 'D7H'];
  for (const f of ['render/src/plan.mjs', 'render/src/main.mjs', 'render/src/supa.mjs']) {
    const s = readFileSync(join(RAIZ, f), 'utf8').replace(/_/g, ' ');
    assert.deepEqual(INSTANCIAS.filter((n) => new RegExp(`\\b${n}\\b`, 'i').test(s)), [], f);
  }
});

caso('el libro se escribe por ops_log_generation, nunca con INSERT directo (service_role no lo tiene)', () => {
  const main = readFileSync(join(RAIZ, 'render/src/main.mjs'), 'utf8');
  assert.match(main, /S\.rpc\(cfg, 'ops_log_generation'/);
  assert.doesNotMatch(main, /S\.insert\(cfg, 'ops_generation_ledger'/);
});

caso('regla rota a propósito: si la fila del sistema mandara sobre la de la marca, el primer caso lo ve', () => {
  const roto = (rows, b, st) => ({ ...rows.find((r) => r.brand_id == null && r.video_style === st), source: 'system' });
  assert.notEqual(roto([DEF, MARCA], 'marca_sintetica_a', 'product_showcase').motion.zoom_to, 1.2);
});

if (fallos) { console.error(`\n${fallos} caso(s) en rojo`); process.exit(1); }
console.log('\nrender_plan: todo en verde');
