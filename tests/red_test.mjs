// REINTENTOS DE RED del render (2026-11-17). Medido en producción: el job 1ccd7b6f falló con «fetch failed» a los 455 s,
// sin decir qué llamada ni por qué. Comprueba: lo que se puede repetir se reintenta ante un corte o un 502/503/504; lo
// que no (inserción, RPC de costo) no se repite; el error nombra la llamada y la causa.
// Ejecutar:  node tests/red_test.mjs

import assert from 'node:assert/strict';
import * as S from '../render/src/supa.mjs';

let fallos = 0;
const caso = async (n, fn) => { try { await fn(); console.log(`  ok  ${n}`); } catch (e) { fallos++; console.error(`  MAL ${n}\n      ${e.message}`); } };
console.log('red — reintentos del render');

const cfg = { url: 'https://sb.test', key: 'k', bucket: 'b' };
const corte = () => Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }) });
const ok = (body = '[]', status = 200) => new Response(body, { status });
const original = globalThis.fetch;
const con = async (respuestas, fn) => {
  let n = 0;
  globalThis.fetch = async () => { const r = respuestas[Math.min(n, respuestas.length - 1)]; n++; if (r instanceof Error) throw r; return r(); };
  try { await fn(); } finally { globalThis.fetch = original; }
  return n;
};
const rapido = { tries: 3, waitMs: 1 };

await caso('una lectura se reintenta tras un corte y sigue', async () => {
  let out;
  const n = await con([corte(), () => ok('[{"a":1}]')], async () => { out = await (await S.fetchNamed('GET x', 'u', {}, { retry: true, ...rapido })).json(); });
  assert.equal(n, 2); assert.deepEqual(out, [{ a: 1 }]);
});
await caso('un 503 se reintenta; un 400 no', async () => {
  let res;
  assert.equal(await con([() => ok('', 503), () => ok('[]')], async () => { res = await S.fetchNamed('GET x', 'u', {}, { retry: true, ...rapido }); }), 2);
  assert.equal(res.status, 200);
  assert.equal(await con([() => ok('', 400)], async () => { res = await S.fetchNamed('GET x', 'u', {}, { retry: true, ...rapido }); }), 1);
  assert.equal(res.status, 400);
});
await caso('agotados los intentos, el error nombra la llamada y la causa de red', async () => {
  await con([corte()], async () => {
    await assert.rejects(S.fetchNamed('STORAGE videolab/x.mp4', 'u', {}, { retry: true, ...rapido }), /STORAGE videolab\/x\.mp4: la red no respondió tras 3 intento\(s\) \(ECONNRESET socket hang up\)/);
  });
});
await caso('lo que no se puede repetir (inserción, RPC) no se reintenta', async () => {
  const n = await con([corte(), () => ok('[]')], async () => {
    await assert.rejects(S.rpc(cfg, 'ops_log_generation', {}), /RPC ops_log_generation: la red no respondió tras 1 intento/);
  });
  assert.equal(n, 1);
});
await caso('select, subida y descarga usan los reintentos (un corte no tumba el job)', async () => {
  // Con la espera por defecto el caso tardaría segundos: basta con ver que el segundo intento llega.
  const n1 = await con([corte(), () => ok('[{"x":1}]')], async () => { assert.deepEqual(await S.select(cfg, 't?id=eq.1'), [{ x: 1 }]); });
  assert.equal(n1, 2);
  const n2 = await con([corte(), () => ok('{}')], async () => { assert.match(await S.upload(cfg, 'v/x.mp4', new Uint8Array(1), 'video/mp4'), /object\/public\/b\/v\/x\.mp4/); });
  assert.equal(n2, 2);
  const n3 = await con([corte(), () => ok('abc')], async () => { assert.equal((await S.download('u', 'video')).length, 3); });
  assert.equal(n3, 2);
});

if (fallos) { console.error(`\n${fallos} caso(s) MAL`); process.exit(1); }
console.log('\nred: todo en verde');
