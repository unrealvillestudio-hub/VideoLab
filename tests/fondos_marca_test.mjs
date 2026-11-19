// FONDOS POR MARCA Y PORTADA CON GANCHO (contrato v1.15.0, 2026-11-19).
// Encargo de Sam: «Construye la librería de NSCF con esas 3» (pistas producidas aprobadas) y «Portada con hook».
// Comprueba: la política sonora de la marca filtra el fondo que rota (sin política, todo como antes); el fundido de
// salida es dato del preset (sin él, la mezcla no cambia); y la portada se busca en el tramo del gancho.
// Ejecutar:  node tests/fondos_marca_test.mjs

import assert from 'node:assert/strict';
import { suggestSoundBed } from '../render/src/textrotation.mjs';
import { soundMixArgs } from '../render/src/sound.mjs';
import { coverCandidates, hookWindowOf } from '../render/src/html/cover.mjs';

let fallos = 0;
const caso = (n, fn) => { try { fn(); console.log(`  ok  ${n}`); } catch (e) { fallos++; console.error(`  MAL ${n}\n      ${e.message}`); } };
console.log('fondos por marca y portada con gancho');

const bed = (preset_key, sound, brand_id = null, sort = 100) => ({ preset_key, kind: 'bed', brand_id, active: true, status: 'validated_by_judgment', sort, spec: { bed: { sound } } });
const ROWS = [bed('sound_bed_a', 'bed_a'), bed('sound_bed_b', 'bed_b'), bed('marca_bed_x', 'bed_x', 'marca'), bed('marca_bed_y', 'bed_y', 'marca'), bed('otra_bed_z', 'bed_z', 'otra')];
const TIER = { bed_a: 'synth', bed_b: 'synth', bed_x: 'produced', bed_y: 'produced' };
const tierOf = (k) => TIER[k] ?? null;

caso('sin política, rotan todos los fondos que ve la marca (como antes)', () => {
  const s = suggestSoundBed(ROWS, 'marca', []);
  assert.deepEqual(new Set(s.pool), new Set(['sound_bed_a', 'sound_bed_b', 'marca_bed_x', 'marca_bed_y']));
});

caso('con política de la marca, sólo rotan los niveles admitidos, y siguen rotando por antigüedad', () => {
  const policy = { bed_tiers_allowed: ['produced'] };
  const s = suggestSoundBed(ROWS, 'marca', [], { policy, tierOf });
  assert.deepEqual(new Set(s.pool), new Set(['marca_bed_x', 'marca_bed_y']));
  const s2 = suggestSoundBed(ROWS, 'marca', [[s.preset_key]], { policy, tierOf });
  assert.notEqual(s2.preset_key, s.preset_key);
  assert.ok(!s.pool.includes('otra_bed_z'), 'un fondo de otra marca nunca entra');
});

caso('el fundido de salida es dato del preset; sin él, la mezcla es idéntica a la de antes', () => {
  const base = { video: 'v.mp4', durationS: 30, cues: [], files: { bed_x: 'x.mp3' }, out: 'o.wav', gains: { voice_db: 0, bed_db: -12 } };
  const sin = soundMixArgs({ ...base, preset: { bed: { sound: 'bed_x' } } });
  const fc = (a) => a[a.indexOf('-filter_complex') + 1];
  assert.ok(!fc(sin).includes('afade'));
  const con = soundMixArgs({ ...base, preset: { bed: { sound: 'bed_x', fade_out_ms: 1500 } } });
  assert.match(fc(con), /atrim=0:30,afade=t=out:st=28\.5:d=1\.5,volume=-12dB/);
});

caso('portada con gancho: la ventana va del 40 % del gancho a 100 ms antes de que salga; sin gancho, null', () => {
  assert.deepEqual(hookWindowOf([{ layer: 'caption_band', start_ms: 0, end_ms: 9000 }, { layer: 'hook', start_ms: 0, end_ms: 3000 }]), { from: 1200, to: 2900 });
  assert.equal(hookWindowOf([{ layer: 'cta', start_ms: 0, end_ms: 3000 }]), null);
  assert.equal(hookWindowOf(null), null);
});

caso('candidatos dentro de la ventana del gancho, alineados a 250 ms; sin ventana válida, el video entero', () => {
  assert.deepEqual(coverCandidates(30000, { window: { from: 1200, to: 2900 } }), [1250, 1500, 1750, 2000, 2250, 2500, 2750]);
  const todo = coverCandidates(30000, { window: { from: 5000, to: 4000 } });
  assert.equal(todo[0], 500);
});

if (fallos) { console.error(`\n${fallos} caso(s) MAL`); process.exit(1); }
console.log('\nfondos por marca: todo en verde');
