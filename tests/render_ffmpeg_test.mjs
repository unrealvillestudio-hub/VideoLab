// RENDER PROPIO (F4) — con ffmpeg de verdad: los dos estilos del render salen con la especificación del contrato,
// la capa de texto aparece (con fundido) y la voz queda a su sonoridad. Requiere ffmpeg y ffprobe en el PATH
// (el CI los instala). Sin red.
//
// Ejecutar:  node tests/render_ffmpeg_test.mjs

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { planRender, resolvePreset, validateOutput } from '../render/src/plan.mjs';

const D = mkdtempSync(join(tmpdir(), 'videolab-render-test-'));
process.on('exit', () => rmSync(D, { recursive: true, force: true }));
const ff = (...a) => execFileSync('ffmpeg', ['-loglevel', 'error', '-y', ...a]);
const probe = (p) => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', p]));
const p = (n) => join(D, n);

// Entradas sintéticas: dos fotos de otro tamaño, una capa RGBA con un bloque claro abajo, voz y música.
ff('-f', 'lavfi', '-i', 'color=c=0x204060:s=1200x1600', '-frames:v', '1', p('img1.png'));
ff('-f', 'lavfi', '-i', 'color=c=0x806040:s=1024x1536', '-frames:v', '1', p('img2.png'));
ff('-f', 'lavfi', '-i', "color=c=white:s=1080x1920,format=rgba,geq=r='255':g='255':b='255':a='if(between(Y,1500,1700),230,0)'",
  '-frames:v', '1', p('layer.png'));
ff('-f', 'lavfi', '-i', 'sine=f=300:d=6', '-ac', '1', '-ar', '44100', p('voice.mp3'));
ff('-f', 'lavfi', '-i', 'sine=f=600:d=3', '-ar', '44100', p('music.mp3'));

const ROWS = [
  { brand_id: null, format: 'reel', video_style: 'product_showcase', active: true, duration_sec: 20,
    motion: { kind: 'push_in', zoom_from: 1, zoom_to: 1.08 }, text_treatment: { entry: 'fade' },
    audio_mix: { voice_lufs: -16, music_lufs: -28, ducking_db: 10, fade_ms: 400 } },
  { brand_id: null, format: 'reel', video_style: 'before_after', active: true, duration_sec: 8,
    motion: { kind: 'wipe', zoom_from: 1, zoom_to: 1.04 }, text_treatment: { entry: 'fade' }, audio_mix: {} },
];
const CANVAS = { width: 1080, height: 1920 };

let fallos = 0;
function caso(nombre, fn) {
  try { fn(); console.log(`  ok  ${nombre}`); } catch (e) { fallos++; console.error(`  MAL ${nombre}\n      ${e.message}`); }
}

/** Luminancia media de una franja del fotograma en el segundo `t`. */
function luma(file, t, y0, h) {
  const raw = execFileSync('ffmpeg', ['-loglevel', 'error', '-ss', String(t), '-i', file, '-frames:v', '1',
    '-vf', `crop=1080:${h}:0:${y0},scale=1:1,format=gray`, '-f', 'rawvideo', '-']);
  return raw[0];
}

console.log('render_ffmpeg — render real');

caso('product_showcase con voz, música y capa: cumple la especificación del contrato', () => {
  const { args, durationS } = planRender({ preset: resolvePreset(ROWS, 'marca_sintetica', 'product_showcase'), canvas: CANVAS,
    inputs: { images: [p('img1.png')], layer: p('layer.png'), voice: { path: p('voice.mp3'), ms: 6000 }, music: { path: p('music.mp3') }, out: p('a.mp4') } });
  ff(...args.slice(1));
  assert.deepEqual(validateOutput(probe(p('a.mp4')), CANVAS, statSync(p('a.mp4')).size), []);
  assert.ok(Math.abs(Number(probe(p('a.mp4')).format.duration) - durationS) < 0.2, 'duración = voz + cola');
});

caso('la capa entra con fundido: al principio no está, a mitad del video sí', () => {
  const antes = luma(p('a.mp4'), 0.05, 1550, 100);
  const despues = luma(p('a.mp4'), 4, 1550, 100);
  assert.ok(despues - antes > 80, `luminancia de la franja del texto ${antes} → ${despues}`);
});

caso('la voz queda a su sonoridad de marca (−16 LUFS ± 2)', () => {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', p('a.mp4'), '-af', 'ebur128', '-f', 'null', '-'], { encoding: 'utf8' });
  const log = (r.stderr.match(/Summary:[\s\S]*/) ?? [''])[0];
  const m = log.match(/I:\s+(-?\d+(\.\d+)?) LUFS/);
  assert.ok(m, 'sin medida de sonoridad');
  assert.ok(Math.abs(Number(m[1]) + 16) <= 2, `sonoridad ${m[1]} LUFS`);
});

caso('before_after sin audio: dos imágenes, barrido y pista de audio igual (silencio)', () => {
  const { args } = planRender({ preset: resolvePreset(ROWS, 'marca_sintetica', 'before_after'), canvas: CANVAS,
    inputs: { images: [p('img1.png'), p('img2.png')], layer: p('layer.png'), voice: null, music: null, out: p('b.mp4') } });
  ff(...args.slice(1));
  assert.deepEqual(validateOutput(probe(p('b.mp4')), CANVAS, statSync(p('b.mp4')).size), []);
  const ini = luma(p('b.mp4'), 0.5, 0, 400);
  const fin = luma(p('b.mp4'), 7.5, 0, 400);
  assert.notEqual(ini, fin, 'la segunda imagen reemplaza a la primera');
});

caso('regla rota a propósito: un MP4 de otro lienzo no pasa la validación', () => {
  ff('-i', p('a.mp4'), '-vf', 'scale=720:1280', '-t', '1', p('c.mp4'));
  assert.ok(validateOutput(probe(p('c.mp4')), CANVAS, statSync(p('c.mp4')).size).some((f) => f.startsWith('lienzo')));
});

if (fallos) { console.error(`\n${fallos} caso(s) en rojo`); process.exit(1); }
console.log('\nrender_ffmpeg: todo en verde');
