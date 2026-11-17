// EL MISMO PEDIDO DA EL MISMO MP4 EN CUALQUIER MÁQUINA — x264 con hilos y juego de instrucciones fijos.
//
// POR QUÉ (2026-11-17). En el job real de Cloud Run, dos ejecuciones del mismo pedido dieron MP4 distintos (con ASS y
// con el motor HTML). Medido aislando cada pieza: x264 cambia de salida con AVX-512 y con sólo SSE2; con SSSE3–AVX2 da
// la misma. Cloud Run mezcla máquinas con y sin AVX-512. render/src/x264.mjs fija hilos y nivel; esta prueba comprueba
// (1) la elección por máquina, (2) que TODA codificación libx264 del render los lleva y (3) que dos niveles de la lista
// dan el mismo archivo en una codificación real.
//
// Ejecutar:  node tests/x264_test.mjs

import { readFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { x264AsmFor, x264Args, hostCpuFlags, hostOf, HOST, X264_SAME_OUTPUT } from '../render/src/x264.mjs';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));
let fallos = 0;
function caso(nombre, fn) {
  try { fn(); console.log(`  ok  ${nombre}`); } catch (e) { fallos++; console.error(`  MAL ${nombre}\n${e.message}`); }
}
console.log('x264 — el mismo pedido da el mismo MP4 en cualquier máquina');

caso('la máquina en la salida: modelo, AVX-512 y nivel de x264, leídos de /proc/cpuinfo (contrato v1.7.1)', () => {
  const intel = 'processor\t: 0\nmodel name\t: Intel(R) Xeon(R) CPU @ 2.00GHz\nflags\t\t: fpu sse2 ssse3 sse4_2 avx avx2 avx512f avx512bw\n';
  const amd = 'processor\t: 0\nmodel name\t: AMD EPYC 7B13\nflags\t\t: fpu sse2 ssse3 sse4_2 avx avx2\n';
  assert.deepEqual(hostOf(intel), { cpu: 'Intel(R) Xeon(R) CPU @ 2.00GHz', avx512: true, x264_asm: 'avx2' });
  assert.deepEqual(hostOf(amd), { cpu: 'AMD EPYC 7B13', avx512: false, x264_asm: 'avx2' });
  assert.deepEqual(hostOf(''), { cpu: null, avx512: false, x264_asm: null });
  assert.equal(typeof HOST.avx512, 'boolean');
});

caso('main.mjs pone en text_layout la huella de lo capturado y la máquina', () => {
  const src = readFileSync(join(RAIZ, 'render/src/main.mjs'), 'utf8');
  assert.match(src, /frames_sha256: r\.digest/);
  assert.match(src, /frames_sha256: drawn\.frames_sha256 \?\? null, host: HOST/);
});

caso('nivel por máquina: con AVX-512 se usa AVX2 (nunca AVX-512); sin AVX2, el más alto de la lista; sin ninguno, null', () => {
  assert.equal(x264AsmFor(['sse2', 'ssse3', 'sse4_2', 'avx', 'avx2', 'avx512f', 'avx512bw']), 'avx2');
  assert.equal(x264AsmFor(['sse2', 'ssse3', 'sse4_2', 'avx', 'avx2', 'fma']), 'avx2');
  assert.equal(x264AsmFor(['sse2', 'ssse3', 'sse4_2', 'avx']), 'avx');
  assert.equal(x264AsmFor(['sse2', 'ssse3']), 'ssse3');
  assert.equal(x264AsmFor(['sse2']), null);
  assert.ok(!X264_SAME_OUTPUT.some(([n]) => /512/.test(n)), 'AVX-512 da otra salida: no puede estar en la lista');
  assert.deepEqual(x264Args(['avx2', 'avx512f']), ['-threads:v', '2', '-x264-params', 'asm=avx2']);
  assert.deepEqual(x264Args([]), ['-threads:v', '2']);
});

// Cada `libx264` (o SPEC.videoCodec) de render/src va seguido de los argumentos de x264.mjs.
const sitios = (src) => [...src.matchAll(/'-c:v',\s*(?:'libx264'|SPEC\.videoCodec),\s*([^,\]]+)/g)].map((m) => m[1].trim());
caso('toda codificación libx264 del render lleva hilos y nivel fijos (...X264)', () => {
  const dirs = ['render/src', 'render/src/html'];
  let total = 0;
  for (const d of dirs) for (const f of readdirSync(join(RAIZ, d)).filter((n) => n.endsWith('.mjs'))) {
    const s = sitios(readFileSync(join(RAIZ, d, f), 'utf8'));
    total += s.length;
    for (const nxt of s) assert.match(nxt, /^\.\.\.(X264|x264)$/, `${d}/${f}: libx264 sin ...X264 (sigue ${nxt})`);
  }
  assert.ok(total >= 8, `se esperaban al menos 8 codificaciones, hay ${total}`);
});
caso('la comprobación anterior ve un sitio sin los argumentos (regresión inyectada)', () => {
  assert.deepEqual(sitios("['-c:v', 'libx264', '-pix_fmt', 'yuv420p']"), ["'-pix_fmt'"]);
});

// Codificación real: dos niveles de la lista dan el mismo archivo.
const hay = spawnSync('ffmpeg', ['-version']).status === 0;
if (hay) {
  caso('codificación real: AVX2 (o el nivel de esta máquina) y SSSE3 dan el mismo MP4', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vl-x264-'));
    try {
      const enc = (args, out) => {
        const r = spawnSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=540x960:rate=30:duration=4',
          '-vf', 'noise=alls=12:allf=t+u', '-c:v', 'libx264', ...args, '-pix_fmt', 'yuv420p', join(dir, out)]);
        assert.equal(r.status, 0, String(r.stderr));
        return createHash('sha256').update(readFileSync(join(dir, out))).digest('hex');
      };
      const nivel = x264Args();
      const ssse3 = enc(x264Args(['ssse3']), 'b.mp4');
      assert.equal(enc(nivel, 'a.mp4'), ssse3, `nivel de esta máquina: ${nivel.join(' ')}`);
      // Regresión inyectada: en una máquina con AVX-512, x264 sin nivel fijo da OTRO archivo (la causa medida).
      if (hostCpuFlags().includes('avx512f')) {
        assert.notEqual(enc(['-threads:v', '2'], 'c.mp4'), ssse3, 'con AVX-512 libre, x264 debería dar otra salida');
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
} else console.log('  --  codificación real: se salta (sin ffmpeg)');

if (fallos) { console.error(`\n${fallos} caso(s) MAL`); process.exit(1); }
console.log('\nx264: todo en verde');
