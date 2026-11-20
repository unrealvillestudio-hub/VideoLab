// v1.16.0 — conversación: cortes en paralelo, clave de caché de clips y tope de llamadas simultáneas.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { clipParallelOf, clipCacheKey, clipCachePath, mapLimit, stableJson, CLIP_PARALLEL_DEFAULT, CLIP_PARALLEL_MAX } from '../render/src/conversation.mjs';

let n = 0;
const caso = async (nombre, fn) => { await fn(); n += 1; console.log(`ok · ${nombre}`); };
const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const A = 'a'.repeat(64);

await caso('el tope de llamadas simultáneas sale del dato del productor y se acota', () => {
  assert.equal(clipParallelOf({}), CLIP_PARALLEL_DEFAULT);
  assert.equal(clipParallelOf(null), CLIP_PARALLEL_DEFAULT);
  assert.equal(clipParallelOf({ max_parallel_clips: 2 }), 2);
  assert.equal(clipParallelOf({ max_parallel_clips: 50 }), CLIP_PARALLEL_MAX);
  assert.equal(clipParallelOf({ max_parallel_clips: 0 }), CLIP_PARALLEL_DEFAULT);
});

await caso('la clave de caché no depende del orden de la dirección y sí de cada insumo', () => {
  const base = { engine: { rateModelId: 'avatar-iv' }, imageUrl: 'https://x/toma.png', direction: { a: 1, b: { c: 2, d: 3 } }, turnAudioSha256: A, fromMs: 2000, toMs: 4280 };
  const k = clipCacheKey(base, sha256);
  assert.match(k, /^[0-9a-f]{64}$/);
  assert.equal(clipCacheKey({ ...base, direction: { b: { d: 3, c: 2 }, a: 1 } }, sha256), k);
  assert.notEqual(clipCacheKey({ ...base, turnAudioSha256: 'b'.repeat(64) }, sha256), k);
  assert.notEqual(clipCacheKey({ ...base, toMs: 4300 }, sha256), k);
  assert.notEqual(clipCacheKey({ ...base, imageUrl: 'https://x/otra.png' }, sha256), k);
  assert.notEqual(clipCacheKey({ ...base, engine: { rateModelId: 'heygen-avatar-6' } }, sha256), k);
  assert.notEqual(clipCacheKey({ ...base, direction: { a: 2, b: { c: 2, d: 3 } } }, sha256), k);
  assert.equal(clipCachePath(k), `videolab/cache/clips/${k}.mp4`);
  assert.throws(() => clipCacheKey({ ...base, turnAudioSha256: 'x' }, sha256), /incompleta/);
  assert.throws(() => clipCacheKey({ ...base, toMs: 1000 }, sha256), /incompleta/);
  assert.equal(stableJson({ b: 1, a: [2, { d: 1, c: 0 }] }), '{"a":[2,{"c":0,"d":1}],"b":1}');
});

await caso('mapLimit respeta el tope, conserva el orden y propaga el error', async () => {
  let enCurso = 0, maximo = 0;
  const r = await mapLimit([5, 1, 4, 2, 3, 0], 3, async (x, i) => {
    enCurso += 1; maximo = Math.max(maximo, enCurso);
    await new Promise((ok) => setTimeout(ok, x * 5));
    enCurso -= 1;
    return `${i}:${x}`;
  });
  assert.deepEqual(r, ['0:5', '1:1', '2:4', '3:2', '4:3', '5:0']);
  assert.equal(maximo, 3);
  let lanzados = 0;
  await assert.rejects(mapLimit([1, 2, 3, 4, 5, 6], 2, async (x) => { lanzados += 1; if (x === 2) throw new Error('falla'); await new Promise((ok) => setTimeout(ok, 20)); }), /falla/);
  assert.ok(lanzados < 6, 'tras el error no se lanzan cortes nuevos');
});

console.log(`conversacion_paralela_test: ${n} casos ok`);
