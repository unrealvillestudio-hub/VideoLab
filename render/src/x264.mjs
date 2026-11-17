// EL MISMO PEDIDO DA EL MISMO MP4 EN CUALQUIER MÁQUINA DE CLOUD RUN (2026-11-17).
//
// Medido en el job real (motor HTML F1): dos ejecuciones del mismo pedido dieron MP4 distintos, con ASS y con HTML. El
// audio era idéntico; el video divergía desde un fotograma y se arrastraba hasta el siguiente fotograma clave. La
// causa, medida aislando cada pieza con sus propias banderas: x264 da OTRA salida cuando usa AVX-512 (y otra con sólo
// SSE2); con SSSE3, SSE4.2, AVX, FMA3 o AVX2 la salida es la misma byte a byte. Cloud Run reparte las ejecuciones entre
// máquinas con y sin AVX-512, así que el video dependía de la máquina. El número de hilos también cambia la salida
// (1 ≠ 2), así que se fija.
//
// Este módulo da los argumentos de x264 que hacen el video reproducible: hilos fijos y el juego de instrucciones más
// alto de esa lista que tenga la máquina. Nunca AVX-512. Cada codificación libx264 del render los lleva (lo comprueba
// tests/x264_test.mjs).

import { readFileSync } from 'node:fs';

/** Niveles de x264 que dan la MISMA salida (medido 2026-11-17), del más rápido al más lento: [nivel x264, bandera de /proc/cpuinfo]. */
export const X264_SAME_OUTPUT = Object.freeze([['avx2', 'avx2'], ['avx', 'avx'], ['sse4.2', 'sse4_2'], ['ssse3', 'ssse3']]);
export const X264_THREADS = 2;

/** El nivel para una máquina con estas banderas de CPU, o null si no tiene ninguno de la lista. PURO. */
export function x264AsmFor(cpuFlags) {
  const has = new Set(cpuFlags);
  return X264_SAME_OUTPUT.find(([, flag]) => has.has(flag))?.[0] ?? null;
}

/** Las banderas de CPU de esta máquina (Linux). Vacío si no se pueden leer. */
export function hostCpuFlags() {
  try {
    const line = readFileSync('/proc/cpuinfo', 'utf8').split('\n').find((l) => l.startsWith('flags'));
    return line ? line.split(':')[1].trim().split(/\s+/) : [];
  } catch { return []; }
}

/** Argumentos de ffmpeg que van justo después de `-c:v libx264`. PURO sobre las banderas. */
export function x264Args(cpuFlags = hostCpuFlags()) {
  const asm = x264AsmFor(cpuFlags);
  return ['-threads:v', String(X264_THREADS), ...(asm ? ['-x264-params', `asm=${asm}`] : [])];
}

/** Los de esta máquina, calculados una vez. */
export const X264 = Object.freeze(x264Args());

/**
 * La máquina que dibujó, para la salida (`text_layout.host`). PURO sobre el texto de /proc/cpuinfo.
 * Por qué existe (2026-11-17): con x264 ya fijado, dos ejecuciones del mismo pedido en Cloud Run volvieron a dar MP4
 * distintos con el motor HTML, y Cloud Run mezcla Intel con AVX-512 y AMD sin AVX-512 en una misma ejecución (medido).
 * Sin saber en qué máquina corrió cada job y la huella de lo que capturó, la diferencia no se puede atribuir.
 */
export function hostOf(cpuinfo) {
  const lines = String(cpuinfo ?? '').split('\n');
  const field = (name) => lines.find((l) => l.startsWith(name))?.split(':').slice(1).join(':').trim() ?? null;
  const flags = (field('flags') ?? '').split(/\s+/).filter(Boolean);
  return { cpu: field('model name'), avx512: flags.includes('avx512f'), x264_asm: x264AsmFor(flags) };
}

/** La de esta máquina, una vez. */
export const HOST = Object.freeze((() => { try { return hostOf(readFileSync('/proc/cpuinfo', 'utf8')); } catch { return hostOf(''); } })());
