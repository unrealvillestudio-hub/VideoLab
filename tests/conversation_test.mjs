// Estilo `conversation` (contrato v1.1.0): el plan del episodio contra el dato del estudio, los cuerpos de HeyGen por motor,
// y los cortes fijos y animados con ffmpeg real (lienzo exacto, largo exacto del tramo).
//
// Ejecutar:  node tests/conversation_test.mjs     (requiere ffmpeg)

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import * as P from '../render/src/conversation.mjs';
import { validateRequest } from '../api/_lib/execute_core.mjs';

const D = mkdtempSync(join(tmpdir(), 'videolab-conversation-'));
process.on('exit', () => rmSync(D, { recursive: true, force: true }));
const ff = (...a) => execFileSync('ffmpeg', ['-loglevel', 'error', '-y', ...a]);
const probe = (f) => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', f]));
const t = (name, fn) => { fn(); console.log(`  ok  ${name}`); };
const throwsLabel = (fn, label, re) => assert.throws(fn, (e) => e.label === label && (!re || re.test(e.message)));

// Un estudio inventado: los ids de silla, toma y persona no son de ninguna marca.
const catalog = P.catalogById([
  { id: 'A1', animate: 'S1', aspect: '9:16' },
  { id: 'B1', animate: 'S2', aspect: '9:16' },
  { id: 'W', animate: null, aspect: '16:9' },
]);
const shots = [{ shot_id: 'A1', url: 'https://x/a1.png' }, { shot_id: 'B1', url: 'https://x/b1.png' }, { shot_id: 'W', url: 'https://x/w.png', focus_x: 0.2 }];
const cast = { S1: 'persona-uno', S2: 'persona-dos' };
const turns = [
  { seat: 'S1', voice: { audio_url: 'https://x/t1.mp3', duration_ms: 5000 }, cuts: [{ shot_id: 'W', at_ms: 0 }, { shot_id: 'A1', at_ms: 1000 }] },
  { seat: 'S2', engine: 'heygen-avatar-6', voice: { audio_url: 'https://x/t2.mp3', duration_ms: 4000 }, cuts: [{ shot_id: 'B1', at_ms: 0 }, { shot_id: 'A1', at_ms: 2500 }] },
];

t('el plan anima sólo a quien habla en su toma; lo demás es fijo', () => {
  const pl = P.planConversation({ catalog, shots, turns, cast });
  assert.deepEqual(pl.segments.map((s) => [s.shot_id, s.mode]), [['W', 'still'], ['A1', 'animate'], ['B1', 'animate'], ['A1', 'still']]);
  assert.equal(pl.totalMs, 9000);
  assert.equal(pl.segments[2].start_ms, 5000);
  assert.deepEqual(pl.speakers, ['persona-uno', 'persona-dos']);
  assert.equal(pl.segments[0].focus_x, 0.2);
});

t('segundos a cobrar por tarifa: Avatar IV por defecto, Avatar 6 si el turno lo pide', () => {
  const pl = P.planConversation({ catalog, shots, turns, cast });
  assert.deepEqual(P.animatedSecondsByRate(pl.segments), { 'avatar-iv': 4, 'heygen-avatar-6': 2.5 });
});

t('el motor por defecto sale del preset', () => {
  const pl = P.planConversation({ catalog, shots, turns: [turns[0]], cast, defaultEngine: 'heygen-avatar-6-turbo' });
  assert.equal(pl.segments[1].engine.rateModelId, 'heygen-avatar-6-turbo');
});

t('incoherencias del pedido fallan antes de gastar', () => {
  throwsLabel(() => P.planConversation({ catalog, shots, turns, cast: { S1: 'persona-uno' } }), 'VIDEOLAB_BAD_REQUEST', /S2/);
  throwsLabel(() => P.planConversation({ catalog, shots: [shots[0]], turns, cast }), 'VIDEOLAB_BAD_REQUEST', /imagen de la toma/);
  throwsLabel(() => P.planConversation({ catalog, shots: [...shots, { shot_id: 'Z', url: 'https://x/z.png' }], turns, cast }), 'VIDEOLAB_BAD_REQUEST', /catálogo/);
  throwsLabel(() => P.planConversation({ catalog, shots, turns: [{ ...turns[0], cuts: [{ shot_id: 'W', at_ms: 0 }] }], cast }), 'VIDEOLAB_BAD_REQUEST', /debe verse hablar/);
  throwsLabel(() => P.planConversation({ catalog, shots, turns: [{ ...turns[0], cuts: [{ shot_id: 'A1', at_ms: 300 }] }], cast }), 'VIDEOLAB_BAD_REQUEST', /at_ms 0/);
  throwsLabel(() => P.planConversation({ catalog, shots, turns: [{ ...turns[0], engine: 'otro' }], cast }), 'VIDEOLAB_BAD_REQUEST', /motor/);
  throwsLabel(() => P.planConversation({ catalog: new Map(), shots, turns, cast }), 'VIDEOLAB_BAD_REQUEST', /shot_catalog/);
});

t('cuerpos de HeyGen: Avatar IV por /v3/videos, Avatar 6 por el modelo', () => {
  const iv = P.conversationHeygenBody({ engine: P.imageEngine('avatar_iv'), imageUrl: 'i', audioUrl: 'a', title: 'x', direction: { expressiveness: 'medium' } });
  assert.equal(iv.type, 'image'); assert.equal(iv.expressiveness, 'medium'); assert.equal(iv.aspect_ratio, '9:16');
  const a6 = P.conversationHeygenBody({ engine: P.imageEngine('heygen-avatar-6'), imageUrl: 'i', audioUrl: 'a', direction: { motion_prompt: ' calm ', expressiveness: 'medium' } });
  assert.equal(a6.model, 'heygen-avatar-6'); assert.equal(a6.motion_prompt, 'calm'); assert.equal(a6.motion_expressiveness, 'default');
  assert.equal(a6.expressiveness, undefined);
});

t('la entrada acepta la conversación y exige estudio, elenco, tomas y turnos', () => {
  const base = { brandId: 'M', pieceId: '00000000-0000-4000-8000-000000000000', parentJobId: '00000000-0000-4000-8000-000000000001',
    params: { platform: 'meta_ig', format: 'reel', video_style: 'conversation', location_blueprint_id: 'loc_x', cast },
    previousOutputs: { voice_script: '', on_screen_text: [], shots, turns } };
  assert.equal(validateRequest(structuredClone(base)).params.video_style, 'conversation');
  const sin = structuredClone(base); delete sin.params.location_blueprint_id;
  throwsLabel(() => validateRequest(sin), 'VIDEOLAB_BAD_REQUEST', /estudio/);
  const sinT = structuredClone(base); sinT.previousOutputs.turns = [];
  throwsLabel(() => validateRequest(sinT), 'VIDEOLAB_BAD_REQUEST', /turns/);
});

t('ffmpeg: corte fijo y corte animado salen al lienzo y al largo exacto del tramo', () => {
  const canvas = { width: 1080, height: 1920 };
  const img = join(D, 'img.png'); ff('-f', 'lavfi', '-i', 'color=c=gray:s=1344x768', '-frames:v', '1', img);
  const clip = join(D, 'clip.mp4'); ff('-f', 'lavfi', '-i', 'testsrc=s=1080x1920:r=25:d=1.9', '-pix_fmt', 'yuv420p', clip);
  const s1 = join(D, 's1.mp4'); ff(...P.stillArgs({ image: img, seconds: 1.2, canvas, focusX: 0.2, out: s1 }).slice(1));
  const s2 = join(D, 's2.mp4'); ff(...P.clipArgs({ clip, seconds: 2.0, canvas, out: s2 }).slice(1));
  for (const [f, sec] of [[s1, 1.2], [s2, 2.0]]) {
    const pr = probe(f); const v = pr.streams.find((x) => x.codec_type === 'video');
    assert.equal(v.width, 1080); assert.equal(v.height, 1920);
    assert.ok(Math.abs(Number(pr.format.duration) - sec) < 0.07, `${f}: ${pr.format.duration} ≠ ${sec}`);
  }
});

// ── Técnicas de escena (v1.2.0) ──
const cat2 = P.catalogById([
  { id: 'S1C', animate: 'S1', framing: 'close' }, { id: 'S1M', animate: 'S1', framing: 'medium' },
  { id: 'S2C', animate: 'S2', framing: 'close' }, { id: 'OTS', animate: null, framing: 'ots' }, { id: 'WIDE', animate: null, framing: 'wide' },
]);
const shots2 = ['S1C', 'S1M', 'S2C', 'OTS', 'WIDE'].map((id) => ({ shot_id: id, url: `https://x/${id}.png` }));
const tecnica = { technique_id: 'T-PRUEBA', cut_plan: { cut_ms: 2000, min_cut_ms: 800, sequence: [
  { role: 'speaker', framing: ['close'] }, { role: 'listener' }, { role: 'speaker', framing: ['medium'] }, { role: 'wide', framing: ['wide'] } ] },
  moves: { speaker: { type: 'drift', amplitude: 0.05, period_s: 8 } } };

t('la técnica arma los cortes: empieza en quien habla y recorre los roles', () => {
  const cuts = P.cutsFromTechnique({ technique: tecnica, catalog: cat2, shots: shots2, seat: 'S1', cast, durationMs: 9000 });
  assert.deepEqual(cuts.map((c) => [c.shot_id, c.at_ms]), [['S1C', 0], ['S2C', 2000], ['S1M', 4000], ['WIDE', 6000], ['S1C', 8000]]);
});

t('un resto corto se suma al corte anterior (no hay cortes de menos de min_cut_ms)', () => {
  const cuts = P.cutsFromTechnique({ technique: tecnica, catalog: cat2, shots: shots2, seat: 'S1', cast, durationMs: 4500 });
  assert.deepEqual(cuts.map((c) => c.shot_id), ['S1C', 'S2C']);
});

t('turnos sin cortes: el plan usa la técnica y marca el movimiento sólo en quien habla', () => {
  const pl = P.planConversation({ catalog: cat2, shots: shots2, cast, technique: tecnica,
    turns: [{ seat: 'S2', voice: { audio_url: 'https://x/a.mp3', duration_ms: 5000 } }] });
  assert.equal(pl.technique_id, 'T-PRUEBA');
  assert.equal(pl.segments[0].shot_id, 'S2C'); assert.equal(pl.segments[0].mode, 'animate'); assert.equal(pl.segments[0].move.type, 'drift');
  assert.ok(pl.segments.filter((g) => g.mode === 'still').every((g) => g.move === null));
});

t('sin cortes ni técnica, o sin toma de quien habla, falla antes de gastar', () => {
  throwsLabel(() => P.planConversation({ catalog: cat2, shots: shots2, cast, turns: [{ seat: 'S1', voice: { audio_url: 'a', duration_ms: 3000 } }] }), 'VIDEOLAB_BAD_REQUEST', /técnica/);
  throwsLabel(() => P.cutsFromTechnique({ technique: tecnica, catalog: cat2, shots: shots2.filter((s) => !s.shot_id.startsWith('S1')), seat: 'S1', cast, durationMs: 3000 }), 'VIDEOLAB_BAD_REQUEST', /ninguna toma/);
  throwsLabel(() => P.shotsForStep({ role: 'otro' }, { catalog: cat2, available: new Set(), seat: 'S1', cast }), 'VIDEOLAB_BAD_REQUEST', /rol/);
});

t('ffmpeg: el movimiento de quien habla mantiene el lienzo y el largo del tramo', () => {
  const canvas = { width: 1080, height: 1920 };
  const clip = join(D, 'clipm.mp4'); ff('-f', 'lavfi', '-i', 'testsrc=s=1080x1920:r=30:d=2', '-pix_fmt', 'yuv420p', clip);
  const o = join(D, 'mv.mp4'); ff(...P.clipArgs({ clip, seconds: 2, canvas, move: tecnica.moves.speaker, out: o }).slice(1));
  const pr = probe(o); const v = pr.streams.find((x) => x.codec_type === 'video');
  assert.equal(v.width, 1080); assert.equal(v.height, 1920); assert.ok(Math.abs(Number(pr.format.duration) - 2) < 0.07);
});

t('marca N+1: el módulo no nombra marcas, personas ni estudios', () => {
  // Sólo el código: los comentarios pueden citar quién aprobó una regla.
  const src = execFileSync('cat', [new URL('../render/src/conversation.mjs', import.meta.url).pathname]).toString()
    .split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  for (const w of ['ForumPHs', 'NeuroneSCF', 'Irja', 'Itzel', 'Sam ', 'loc_fphs']) assert.ok(!src.includes(w), `nombra ${w}`);
});

console.log('\nconversation: todo en verde');
