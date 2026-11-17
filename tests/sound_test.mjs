// CAPA DE SONIDO (F0, 2026-11-17): hoja de entradas desde la escena y mezcla determinista.
// Ejecutar:  node tests/sound_test.mjs

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { digitCount, digitLandings, shotCuts, soundCues, soundMixArgs, loudnormArgs, soundKeysOf, mixGains, composeSoundSpec, effectSlots, EFFECT_FNS } from '../render/src/sound.mjs';
import { suggestSoundBed } from '../render/src/textrotation.mjs';
import { validateTextLayers } from '../render/src/textlayers.mjs';

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

const F1 = JSON.parse(readFileSync(join(RAIZ, 'docs/sound_presets_f1.json'), 'utf8')).rows;
const F2 = JSON.parse(readFileSync(join(RAIZ, 'docs/sound_presets_f2.json'), 'utf8')).rows;
caso('presets F1: 6 caracteres, claves únicas, proposed y de sistema; cada uno nombra cama y sonido por función', () => {
  assert.equal(F1.length, 6);
  assert.equal(new Set(F1.map((r) => r.preset_key)).size, 6);
  for (const r of F1) {
    assert.equal(r.status, 'proposed'); assert.equal(r.brand_id, null);
    assert.match(r.spec.bed.sound, /^bed_/);
    for (const k of soundKeysOf(r.spec)) assert.match(k, /^(sfx|bed)_[a-z0-9_]+$/);
    assert.ok(r.spec.master_by_platform.default.true_peak_db <= -2, 'tope antes de codificar');
  }
  assert.equal(new Set(F1.map((r) => r.spec.bed.sound)).size, 6, 'cada preset con su cama');
});
caso('soundKeysOf: cama y entradas, sin repetir', () => {
  assert.deepEqual(soundKeysOf(P).sort(), ['bed_soft_pulse', 'sfx_block_entry_whoosh', 'sfx_cta_chime', 'sfx_cut_swish', 'sfx_digit_tick', 'sfx_stamp_impact', 'sfx_word_pop']);
});
caso('mixGains: la voz va a la referencia y la cama queda under_voice_lu por debajo, según lo medido', () => {
  assert.deepEqual(mixGains({ spec: { voice_ref_lufs: -20, bed: { under_voice_lu: 14 } }, voiceLufs: -21.4, bedLufs: -18.8 }), { voice_db: 1.4, bed_db: -15.2 });
  assert.deepEqual(mixGains({ spec: { bed: { gain_db: -12 } }, voiceLufs: null, bedLufs: null }), { voice_db: 0, bed_db: -12 });
});
caso('pedido: text_layers.sound con preset_key (y plataforma y enabled opcionales); lo demás se rechaza', () => {
  const base = { hook: { text: 'Hola', preset_key: 'hook_x', start_ms: 0, end_ms: 1000 } };
  validateTextLayers({ ...base, sound: { preset_key: 'sound_soft_pulse', platform: 'instagram', enabled: true } });
  validateTextLayers({ ...base, sound: null });
  assert.throws(() => validateTextLayers({ ...base, sound: { preset_key: 'X Y' } }), /sound\.preset_key/);
  assert.throws(() => validateTextLayers({ ...base, sound: { preset_key: 'sound_x', enabled: 'sí' } }), /enabled/);
  assert.throws(() => validateTextLayers({ sound: { preset_key: 'sound_x' } }), /no pide ninguna capa/);
});

caso('test N+1: el código de sonido y los presets de sonido no nombran ninguna marca', () => {
  const marcas = /neurone|nscf|forum|fphs|lucien|unrealville|unrlvl|vivose|vizos|d7|diamond|ivette|patricia|irja|sam_moreno/i;
  const code = readFileSync(join(RAIZ, 'render/src/sound.mjs'), 'utf8').replace(/\/\/.*$/gm, '');
  assert.ok(!marcas.test(code), 'render/src/sound.mjs nombra una marca');
  assert.ok(!marcas.test(JSON.stringify(PRESETS)), 'docs/sound_presets_f0.json nombra una marca');
  assert.ok(!marcas.test(JSON.stringify(F1)), 'docs/sound_presets_f1.json nombra una marca');
  assert.ok(!marcas.test(JSON.stringify(F2)), 'docs/sound_presets_f2.json nombra una marca');
  for (const f of ['render/src/textrotation.mjs', 'api/text-styles.js']) {
    assert.ok(!marcas.test(readFileSync(join(RAIZ, f), 'utf8').replace(/\/\/.*$/gm, '')), `${f} nombra una marca`);
  }
  for (const r of PRESETS) assert.equal(r.brand_id, null);
});

// ── F2 (2026-11-17): fondo y efectos por separado ───────────────────────────────────────────────────────────────
const BED2 = F2.filter((r) => r.kind === 'bed'), FX2 = F2.filter((r) => r.kind === 'effects');
caso('catálogo F2: 6 de fondo (uno por cama, sin efectos) y 6 de efectos (todos los momentos, sin cama), todos proposed', () => {
  assert.equal(BED2.length, 6); assert.equal(FX2.length, 6);
  assert.equal(new Set(BED2.map((r) => r.spec.bed.sound)).size, 6);
  for (const r of BED2) { assert.ok(!r.spec.cues, r.preset_key); assert.match(r.spec.bed.sound, /^bed_/); }
  for (const r of FX2) {
    assert.ok(!r.spec.bed, r.preset_key);
    for (const fn of EFFECT_FNS) assert.ok(effectSlots(r.spec.cues, fn).length >= 1, `${r.preset_key} sin ${fn}`);
    for (const k of soundKeysOf(r.spec)) assert.match(k, /^sfx_/);
  }
  for (const r of F2) { assert.equal(r.status, 'proposed'); assert.equal(r.spec.master_by_platform.default.lufs, -14); }
  assert.deepEqual(FX2.map((r) => r.name), ['Discreto', 'Cálido', 'Brillante', 'Para cifras', 'Amable', 'Mínimo']);
  const minimo = FX2.find((r) => r.name === 'Mínimo');
  assert.deepEqual(soundKeysOf(minimo.spec).sort(), ['sfx_cta_chime', 'sfx_digit_tick']);
});
caso('composeSoundSpec: cama del fondo, momentos de los efectos, volumen y lo elegido de la librería', () => {
  const bedSpec = BED2[0].spec, fx = FX2.find((r) => r.name === 'Cálido').spec;
  const s = composeSoundSpec({ bedSpec, effectsSpec: fx, bed: { sound_key: 'bed_lofi_keys', level_lu: 2 },
    effects: { gain_db: -2, sounds_by_fn: { shot_cut: null, cta: 'sfx_cta_sparkle' } } });
  assert.equal(s.bed.sound, 'bed_lofi_keys');
  assert.equal(s.bed.under_voice_lu, bedSpec.bed.under_voice_lu - 2);
  assert.equal(s.cues.shot_cut.sound, null);
  assert.equal(s.cues.block_entry.by_layer.cta.sound, 'sfx_cta_sparkle');
  assert.equal(s.cues.block_entry.by_layer.hook.gain_db, fx.cues.block_entry.by_layer.hook.gain_db - 2);
  assert.equal(s.cues.digit_land.gain_db, fx.cues.digit_land.gain_db - 2);
  assert.equal(fx.cues.shot_cut.sound, 'sfx_cut_air_puff', 'el preset original no se toca');
  assert.ok(!soundKeysOf(s).includes('sfx_cut_air_puff'));
  assert.deepEqual(s.master_by_platform, bedSpec.master_by_platform);
});
caso('composeSoundSpec: sólo fondo (sin entradas) y sólo efectos (sin cama)', () => {
  const sb = composeSoundSpec({ bedSpec: BED2[1].spec });
  assert.ok(sb.bed && !sb.cues);
  assert.equal(soundCues({ blocks: [{ layer: 'hook', preset_key: 'h', start_ms: 0, end_ms: 1000, lines: [] }] }, null, sb).length, 0);
  const se = composeSoundSpec({ effectsSpec: FX2[0].spec });
  assert.ok(!se.bed && se.cues);
  assert.deepEqual(se.master_by_platform, FX2[0].spec.master_by_platform);
});
caso('composeSoundSpec: un momento que el preset no declara no se puede cambiar (SOUND_SLOT_MISSING)', () => {
  const sinCifra = structuredClone(FX2[0].spec); delete sinCifra.cues.digit_land;
  assert.throws(() => composeSoundSpec({ effectsSpec: sinCifra, effects: { sounds_by_fn: { digit_land: 'sfx_digit_blip' } } }), (e) => e.code === 'SOUND_SLOT_MISSING' && e.fn === 'digit_land');
});
caso('pedido v1.10.0: bed/effects con volumen y librería; rangos, prefijos, momentos y mezcla con preset_key se rechazan', () => {
  const base = { hook: { text: 'Hola', preset_key: 'hook_x', start_ms: 0, end_ms: 1000 } };
  validateTextLayers({ ...base, sound: { bed: { preset_key: 'sound_bed_soft_pulse', sound_key: 'bed_lofi_keys', level_lu: -6 },
    effects: { preset_key: 'sound_fx_warm', gain_db: 6, sounds_by_fn: { shot_cut: null, cta: 'sfx_cta_sparkle' } } } });
  validateTextLayers({ ...base, sound: { bed: { preset_key: 'sound_bed_soft_pulse' }, effects: null } });
  validateTextLayers({ ...base, sound: { bed: { enabled: false }, effects: { preset_key: 'sound_fx_warm' } } });
  const mal = (sound, re) => assert.throws(() => validateTextLayers({ ...base, sound }), re);
  mal({ preset_key: 'sound_soft_pulse', bed: { preset_key: 'sound_bed_soft_pulse' } }, /no los dos/);
  mal({ bed: {} }, /bed\.preset_key/);
  mal({ bed: { preset_key: 'sound_bed_x', level_lu: 7 } }, /level_lu/);
  mal({ bed: { preset_key: 'sound_bed_x', level_lu: 1.5 } }, /level_lu/);
  mal({ bed: { preset_key: 'sound_bed_x', sound_key: 'sfx_digit_tick' } }, /bed\.sound_key/);
  mal({ effects: { preset_key: 'sound_fx_x', gain_db: -13 } }, /gain_db/);
  mal({ effects: { preset_key: 'sound_fx_x', sounds_by_fn: { music_bed: null } } }, /momento desconocido/);
  mal({ effects: { preset_key: 'sound_fx_x', sounds_by_fn: { cta: 'bed_soft_pulse' } } }, /sounds_by_fn\.cta/);
});
caso('rotación del fondo: el preset de fondo usado hace más tiempo; validados primero; los efectos no rotan', () => {
  const rows = F2.map((r) => ({ ...r }));
  assert.equal(suggestSoundBed(rows, 'marca', []).preset_key, BED2[0].preset_key);
  assert.equal(suggestSoundBed(rows, 'marca', [[BED2[0].preset_key]]).preset_key, BED2[1].preset_key);
  const hist = BED2.slice(0, 5).map((r) => [r.preset_key]).reverse();
  assert.equal(suggestSoundBed(rows, 'marca', hist).preset_key, BED2[5].preset_key);
  assert.ok(suggestSoundBed(rows, 'marca', []).pool.every((k) => BED2.some((r) => r.preset_key === k)));
  rows.find((r) => r.preset_key === BED2[3].preset_key).status = 'validated_by_judgment';
  assert.deepEqual(suggestSoundBed(rows, 'marca', []).pool, [BED2[3].preset_key]);
  assert.equal(suggestSoundBed(FX2, 'marca', []), null);
});

if (fallos) { console.error(`\n${fallos} caso(s) MAL`); process.exit(1); }
console.log('\nsonido: todo en verde');
