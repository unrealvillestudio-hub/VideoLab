// CAPA DE SONIDO (F0, 2026-11-17): hoja de entradas desde la escena y mezcla determinista.
// Ejecutar:  node tests/sound_test.mjs

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { digitCount, digitLandings, shotCuts, soundCues, soundMixArgs, loudnormArgs } from '../render/src/sound.mjs';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));
let fallos = 0;
const caso = (n, fn) => { try { fn(); console.log(`  ok  ${n}`); } catch (e) { fallos++; console.error(`  MAL ${n}\n      ${e.message}`); } };
console.log('sonido — hoja de entradas y mezcla');

const PRESETS = JSON.parse(readFileSync(join(RAIZ, 'docs/sound_presets_f0.json'), 'utf8')).rows;
const P = PRESETS[0].spec;
// Bloque de rodillo mínimo: «$1.67», cuenta de 0 a 1 entre 100 y 1100 ms, lineal.
const rodillo = (start = 1000) => ({ layer: 'key_title', preset_key: 'key_title_odometer', start_ms: start, end_ms: start + 2600,
  roll: { turns: 1, lag: 0.12 }, lines: [{ words: [{ text: 'Cuesta' }, { text: '$1.67', number: { prefix: '$', value: 1.67, decimals: 2, decSep: '.', thouSep: null, suffix: '' } }] }],
  tracks: [{ target: 'number', keys: [{ t: 100, count: 0 }, { t: 1100, count: 1 }] }] });

caso('cifras como se escriben: 1.250,50 → 6; 1.67 → 3; 200 → 3; 0,5 → 2', () => {
  assert.equal(digitCount({ value: 1250.5, decimals: 2 }), 6);
  assert.equal(digitCount({ value: 1.67, decimals: 2 }), 3);
  assert.equal(digitCount({ value: 200, decimals: 0 }), 3);
  assert.equal(digitCount({ value: 0.5, decimals: 1 }), 2);
});

caso('rodillo: cada cifra cae en orden, la última al terminar la cuenta (misma fórmula que el runtime)', () => {
  const t = digitLandings(rodillo(1000));
  assert.equal(t.length, 3);
  for (let j = 1; j < t.length; j++) assert.ok(t[j] > t[j - 1], `en orden: ${t}`);
  // n = 3, lag 0,12 → la 1.ª llega con el avance en 0,76 (t = 1000 + 100 + 760) y la última en 1 (t = 2100).
  assert.deepEqual(t, [1860, 1980, 2100]);
  assert.deepEqual(digitLandings({ ...rodillo(), roll: null }), []);
});

caso('cortes de toma: cada cambio de shot_id, sin repetir y sin el 0', () => {
  const tl = { faces: [{ shot_id: 'A', start_ms: 0 }, { shot_id: 'B', start_ms: 3000 }, { shot_id: 'B', start_ms: 3000 }, { shot_id: 'A', start_ms: 9000 }] };
  assert.deepEqual(shotCuts(tl), [3000, 9000]);
  assert.deepEqual(shotCuts({}), []);
});

caso('hoja de entradas: por capa, por estilo de texto (gana el estilo), cifras y cortes; ordenada; sin función → no suena', () => {
  const scene = { blocks: [
    { layer: 'hook', preset_key: 'hook_x', start_ms: 0, end_ms: 2000, lines: [], tracks: [] },
    { layer: 'key_title', preset_key: 'key_title_stamp_spring', start_ms: 5000, end_ms: 7000, lines: [], tracks: [] },
    rodillo(10000),
    { layer: 'lower_third_desconocida', preset_key: 'x', start_ms: 12000, end_ms: 13000, lines: [], tracks: [] },
  ] };
  const cues = soundCues(scene, { faces: [{ shot_id: 'A', start_ms: 0 }, { shot_id: 'B', start_ms: 4000 }] }, P);
  assert.deepEqual(cues.map((c) => c.sound), ['sfx_block_entry_whoosh', 'sfx_cut_swish', 'sfx_stamp_impact', 'sfx_block_entry_whoosh', 'sfx_digit_tick', 'sfx_digit_tick', 'sfx_digit_tick']);
  assert.equal(cues[0].at_ms, 0, 'un desfase negativo al inicio no da tiempo negativo');
  for (let k = 1; k < cues.length; k++) assert.ok(cues[k].at_ms >= cues[k - 1].at_ms);
});

caso('dos entradas del mismo sonido más juntas que min_gap_ms se funden', () => {
  const scene = { blocks: [] };
  const tl = { faces: [{ shot_id: 'A', start_ms: 0 }, { shot_id: 'B', start_ms: 1000 }, { shot_id: 'A', start_ms: 1500 }, { shot_id: 'B', start_ms: 3000 }] };
  assert.deepEqual(soundCues(scene, tl, P).map((c) => c.at_ms + 60), [1000, 3000]);   // min_gap 800 ms: el corte de 1500 se funde
});

caso('mezcla: voz entera, cama en bucle con ducking, cada efecto con adelay en su milisegundo, amix sin normalizar', () => {
  const cues = [{ at_ms: 1860, sound: 'sfx_digit_tick', gain_db: -16 }];
  const a = soundMixArgs({ video: 'v.mp4', durationS: 10, preset: P, cues, files: { bed_soft_pulse: 'cama.wav', sfx_digit_tick: 'tic.wav' }, out: 'm.wav' });
  const fc = a[a.indexOf('-filter_complex') + 1];
  assert.ok(a.includes('-stream_loop'));
  assert.match(fc, /sidechaincompress/);
  assert.match(fc, /adelay=1860\|1860/);
  assert.match(fc, /amix=inputs=3:duration=first:normalize=0/);
  assert.throws(() => soundMixArgs({ video: 'v', durationS: 1, preset: P, cues: [{ at_ms: 0, sound: 'falta', gain_db: 0 }], files: {}, out: 'x' }), /sin archivo/);
});

caso('sonoridad final: dos pasadas, la segunda lineal con lo medido; objetivo por plataforma desde el dato', () => {
  const t = P.master_by_platform.instagram;
  assert.match(loudnormArgs({ input: 'm.wav', target: t }).join(' '), /loudnorm=I=-14:TP=-2:LRA=11:print_format=json/);
  const m = { input_i: '-21.4', input_tp: '-5.2', input_lra: '4.8', input_thresh: '-31.6', target_offset: '0.1' };
  assert.match(loudnormArgs({ input: 'm.wav', target: t, measured: m, out: 'o.wav' }).join(' '), /measured_I=-21\.4.*linear=true/);
});

caso('test N+1: el código de sonido y los presets de sonido no nombran ninguna marca', () => {
  const marcas = /neurone|nscf|forum|fphs|lucien|unrealville|unrlvl|vivose|vizos|d7|diamond|ivette|patricia|irja|sam_moreno/i;
  const code = readFileSync(join(RAIZ, 'render/src/sound.mjs'), 'utf8').replace(/\/\/.*$/gm, '');
  assert.ok(!marcas.test(code), 'render/src/sound.mjs nombra una marca');
  assert.ok(!marcas.test(JSON.stringify(PRESETS)), 'docs/sound_presets_f0.json nombra una marca');
  for (const r of PRESETS) assert.equal(r.brand_id, null);
});

if (fallos) { console.error(`\n${fallos} caso(s) MAL`); process.exit(1); }
console.log('\nsonido: todo en verde');
