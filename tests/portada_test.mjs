// PORTADA DENTRO DEL VIDEO (contrato v1.14.0, 2026-11-19). Decisión de Sam: un fotograma del propio video, con ojos
// abiertos y boca en reposo, fijo 250 ms (dato) al inicio y al final; siempre.
// Comprueba: el dato manda (sin él, nada); los candidatos; la elección (peor cara del fotograma, empate al más temprano,
// sin caras → null); y el montaje real con ffmpeg: duración + 2 × hold, el audio corrido y la imagen fija en los extremos.
// Ejecutar:  node tests/portada_test.mjs

import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import assert from 'node:assert/strict';
import { bookendMsOf, coverCandidates, frameBadness, pickCover, bookendArgs, applyBookend, CANDIDATE_STEP_MS } from '../render/src/html/cover.mjs';

const run = promisify(execFile);
let fallos = 0;
const caso = async (n, fn) => { try { await fn(); console.log(`  ok  ${n}`); } catch (e) { fallos++; console.error(`  MAL ${n}\n      ${e.message}`); } };
console.log('portada');

await caso('el tiempo de la portada es dato del perfil: sin dato, nulo o inválido → 0 (sin portada)', () => {
  assert.equal(bookendMsOf({ video_bookend_ms: 250 }), 250);
  for (const p of [null, {}, { video_bookend_ms: null }, { video_bookend_ms: 0 }, { video_bookend_ms: -5 }, { video_bookend_ms: 'x' }]) assert.equal(bookendMsOf(p), 0);
});

await caso('candidatos cada 250 ms lejos de los bordes, con tope; un video muy corto mira el centro', () => {
  const c = coverCandidates(10000);
  assert.equal(c[0], 500); assert.equal(c[c.length - 1], 9500); assert.ok(c.every((t) => t % CANDIDATE_STEP_MS === 0));
  const largo = coverCandidates(600000);
  assert.ok(largo.length <= 120 && largo.every((t) => t % CANDIDATE_STEP_MS === 0));
  assert.deepEqual(coverCandidates(800), [400]);
});

await caso('lo malo de un fotograma es su peor cara: el ojo más cerrado + la boca abierta', () => {
  assert.equal(frameBadness([]), null);
  assert.equal(frameBadness([{ blinkL: 0.1, blinkR: 0.7, jaw: 0.2 }]), 0.9);
  assert.equal(frameBadness([{ blinkL: 0, blinkR: 0, jaw: 0 }, { blinkL: 0.6, blinkR: 0, jaw: 0 }]), 0.6);
});

await caso('elige ojos abiertos y boca cerrada; empate → el más temprano; sin caras → null', () => {
  const res = [
    { t_ms: 500, faces: [{ blinkL: 0.8, blinkR: 0.7, jaw: 0 }] },      // parpadeo
    { t_ms: 750, faces: [{ blinkL: 0, blinkR: 0, jaw: 0.5 }] },        // boca abierta
    { t_ms: 1000, faces: [] },                                          // sin cara
    { t_ms: 1250, faces: [{ blinkL: 0.02, blinkR: 0.01, jaw: 0.01 }] }, // la buena
    { t_ms: 1500, faces: [{ blinkL: 0.01, blinkR: 0.02, jaw: 0.01 }] }, // empata: pierde por tardía
  ];
  assert.deepEqual(pickCover(res), { t_ms: 1250, badness: 0.03, faces: 1 });
  assert.equal(pickCover([{ t_ms: 500, faces: [] }]), null);
});

await caso('montaje real: + 2 × hold de duración, audio corrido hold ms y la misma imagen al inicio y al final', async () => {
  const w = mkdtempSync(join(tmpdir(), 'vl-portada-'));
  const video = join(w, 'v.mp4');
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=270x480:rate=30:duration=4', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4:sample_rate=48000',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ac', '2', '-shortest', video]);
  const out = join(w, 'o.mp4');
  const scan = async ({ candidates }) => candidates.map((t) => ({ t_ms: t, faces: t === 2000 ? [{ blinkL: 0, blinkR: 0, jaw: 0 }] : [{ blinkL: 0.9, blinkR: 0.9, jaw: 0.5 }] }));
  const c = await applyBookend({ video, out, work: w, holdMs: 250, durationS: 4, fallbackAtS: 1.5, run, scan });
  assert.equal(c.method, 'face'); assert.equal(c.at_ms, 2000);
  const dur = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', out]).toString());
  assert.ok(Math.abs(dur - 4.5) < 0.06, `duración ${dur}`);
  // Audio: los primeros 200 ms en silencio (la voz arranca después de la portada).
  const vol = await run('ffmpeg', ['-hide_banner', '-t', '0.2', '-i', out, '-af', 'volumedetect', '-f', 'null', '-']).then((r) => r.stderr, (e) => String(e.stderr));
  const mv = (vol.match(/max_volume:\s*(-?[\d.]+|-inf)/) || [])[1];
  assert.ok(mv === '-inf' || Number(mv) < -60, `al inicio suena: ${mv} dB`);
  // Imagen: el primer y el último fotograma son la portada (casi iguales entre sí; el resto del video se mueve).
  const g = (pre) => execFileSync('ffmpeg', ['-loglevel', 'error', ...pre, '-i', out, '-vf', 'scale=54:96,format=gray', '-frames:v', '1', '-f', 'rawvideo', '-']);
  const a = g([]), b = g(['-sseof', '-0.1']), m = g(['-ss', '1.0']);
  assert.ok(a.length > 0 && a.length === b.length && b.length === m.length, `fotogramas vacíos: ${a.length} ${b.length} ${m.length}`);
  const diff = (x, y) => x.reduce((s, v, i) => s + Math.abs(v - y[i]), 0) / x.length;
  assert.ok(diff(a, b) < 2, `inicio y final distintos: ${diff(a, b)}`);
  assert.ok(diff(a, m) > diff(a, b), 'la portada no se distingue del video');
});

await caso('si el detector falla, la portada usa el fotograma de siempre y lo dice', async () => {
  const w = mkdtempSync(join(tmpdir(), 'vl-portada-'));
  const video = join(w, 'v.mp4');
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=270x480:rate=30:duration=2', '-f', 'lavfi', '-i', 'sine=duration=2:sample_rate=48000',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ac', '2', '-shortest', video]);
  const c = await applyBookend({ video, out: join(w, 'o.mp4'), work: w, holdMs: 250, durationS: 2, fallbackAtS: 1, run, scan: async () => { throw new Error('sin detector'); } });
  assert.equal(c.method, 'fallback'); assert.equal(c.at_ms, 1000); assert.match(c.reason, /sin detector/);
});

await caso('bookendArgs: mismo x264 del render, audio con retardo y relleno, duración total fija', () => {
  const a = bookendArgs({ video: 'v.mp4', still: 's.png', holdMs: 250, out: 'o.mp4', durationS: 10 });
  const fc = a[a.indexOf('-filter_complex') + 1];
  assert.match(fc, /concat=n=3:v=1:a=0/); assert.match(fc, /adelay=250:all=1,apad=pad_dur=0\.25/);
  assert.equal(a[a.indexOf('-t', a.indexOf('-filter_complex')) + 1], '10.5');
});

if (fallos) { console.error(`\n${fallos} caso(s) MAL`); process.exit(1); }
console.log('\nportada: todo en verde');
