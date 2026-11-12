// Estilo `podcast` (contrato v1.1.0): el plan del episodio contra el dato del estudio, los cuerpos de HeyGen por motor,
// y los cortes fijos y animados con ffmpeg real (lienzo exacto, largo exacto del tramo).
//
// Ejecutar:  node tests/podcast_test.mjs     (requiere ffmpeg)

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import * as P from '../render/src/podcast.mjs';
import { validateRequest } from '../api/_lib/execute_core.mjs';

const D = mkdtempSync(join(tmpdir(), 'videolab-podcast-'));
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
  const pl = P.planPodcast({ catalog, shots, turns, cast });
  assert.deepEqual(pl.segments.map((s) => [s.shot_id, s.mode]), [['W', 'still'], ['A1', 'animate'], ['B1', 'animate'], ['A1', 'still']]);
  assert.equal(pl.totalMs, 9000);
  assert.equal(pl.segments[2].start_ms, 5000);
  assert.deepEqual(pl.speakers, ['persona-uno', 'persona-dos']);
  assert.equal(pl.segments[0].focus_x, 0.2);
});

t('segundos a cobrar por tarifa: Avatar IV por defecto, Avatar 6 si el turno lo pide', () => {
  const pl = P.planPodcast({ catalog, shots, turns, cast });
  assert.deepEqual(P.animatedSecondsByRate(pl.segments), { 'avatar-iv': 4, 'heygen-avatar-6': 2.5 });
});

t('el motor por defecto sale del preset', () => {
  const pl = P.planPodcast({ catalog, shots, turns: [turns[0]], cast, defaultEngine: 'heygen-avatar-6-turbo' });
  assert.equal(pl.segments[1].engine.rateModelId, 'heygen-avatar-6-turbo');
});

t('incoherencias del pedido fallan antes de gastar', () => {
  throwsLabel(() => P.planPodcast({ catalog, shots, turns, cast: { S1: 'persona-uno' } }), 'VIDEOLAB_BAD_REQUEST', /S2/);
  throwsLabel(() => P.planPodcast({ catalog, shots: [shots[0]], turns, cast }), 'VIDEOLAB_BAD_REQUEST', /imagen de la toma/);
  throwsLabel(() => P.planPodcast({ catalog, shots: [...shots, { shot_id: 'Z', url: 'https://x/z.png' }], turns, cast }), 'VIDEOLAB_BAD_REQUEST', /catálogo/);
  throwsLabel(() => P.planPodcast({ catalog, shots, turns: [{ ...turns[0], cuts: [{ shot_id: 'W', at_ms: 0 }] }], cast }), 'VIDEOLAB_BAD_REQUEST', /debe verse hablar/);
  throwsLabel(() => P.planPodcast({ catalog, shots, turns: [{ ...turns[0], cuts: [{ shot_id: 'A1', at_ms: 300 }] }], cast }), 'VIDEOLAB_BAD_REQUEST', /at_ms 0/);
  throwsLabel(() => P.planPodcast({ catalog, shots, turns: [{ ...turns[0], engine: 'otro' }], cast }), 'VIDEOLAB_BAD_REQUEST', /motor/);
  throwsLabel(() => P.planPodcast({ catalog: new Map(), shots, turns, cast }), 'VIDEOLAB_BAD_REQUEST', /shot_catalog/);
});

t('cuerpos de HeyGen: Avatar IV por /v3/videos, Avatar 6 por el modelo', () => {
  const iv = P.podcastHeygenBody({ engine: P.imageEngine('avatar_iv'), imageUrl: 'i', audioUrl: 'a', title: 'x', direction: { expressiveness: 'medium' } });
  assert.equal(iv.type, 'image'); assert.equal(iv.expressiveness, 'medium'); assert.equal(iv.aspect_ratio, '9:16');
  const a6 = P.podcastHeygenBody({ engine: P.imageEngine('heygen-avatar-6'), imageUrl: 'i', audioUrl: 'a', direction: { motion_prompt: ' calm ', expressiveness: 'medium' } });
  assert.equal(a6.model, 'heygen-avatar-6'); assert.equal(a6.motion_prompt, 'calm'); assert.equal(a6.motion_expressiveness, 'default');
  assert.equal(a6.expressiveness, undefined);
});

t('la entrada acepta el podcast y exige estudio, elenco, tomas y turnos', () => {
  const base = { brandId: 'M', pieceId: '00000000-0000-4000-8000-000000000000', parentJobId: '00000000-0000-4000-8000-000000000001',
    params: { platform: 'meta_ig', format: 'reel', video_style: 'podcast', location_blueprint_id: 'loc_x', cast },
    previousOutputs: { voice_script: '', on_screen_text: [], shots, turns } };
  assert.equal(validateRequest(structuredClone(base)).params.video_style, 'podcast');
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

t('marca N+1: el módulo no nombra marcas, personas ni estudios', () => {
  // Sólo el código: los comentarios pueden citar quién aprobó una regla.
  const src = execFileSync('cat', [new URL('../render/src/podcast.mjs', import.meta.url).pathname]).toString()
    .split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  for (const w of ['ForumPHs', 'NeuroneSCF', 'Irja', 'Itzel', 'Sam ', 'loc_fphs']) assert.ok(!src.includes(w), `nombra ${w}`);
});

console.log('\npodcast: todo en verde');
