// F5 — productores generative (Veo) y avatar (HeyGen): las peticiones a los proveedores (sin red), y el
// ensamblado del clip con ffmpeg real: lienzo, capa, subtítulos, voz del clip o de VoiceLab, especificación.
//
// Ejecutar:  node tests/assemble_test.mjs     (requiere ffmpeg con libass; el CI lo instala)

import { execFileSync } from 'node:child_process';
import { mkdtempSync, statSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import * as A from '../render/src/assemble.mjs';
import { validateOutput } from '../render/src/plan.mjs';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));
const D = mkdtempSync(join(tmpdir(), 'videolab-assemble-'));
process.on('exit', () => rmSync(D, { recursive: true, force: true }));
const p = (n) => join(D, n);
const ff = (...a) => execFileSync('ffmpeg', ['-loglevel', 'error', '-y', ...a]);
const probe = (f) => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', f]));
const CANVAS = { width: 1080, height: 1920 };
const PRESET = { video_style: 'product_demo', text_treatment: { entry: 'fade' }, audio_mix: { voice_lufs: -16, music_lufs: -28, ducking_db: 10, fade_ms: 400 } };

let fallos = 0;
function caso(nombre, fn) {
  try { fn(); console.log(`  ok  ${nombre}`); } catch (e) { fallos++; console.error(`  MAL ${nombre}\n      ${e.message}`); }
}

console.log('assemble — productores generative y avatar');

caso('Veo: cuerpo image-to-video 9:16, 8 s, sin audio propio, imagen en base64', () => {
  const b = A.veoRequestBody({ prompt: 'manos que aplican el producto', imageB64: 'QUJD', durationS: 8, seed: 2 });
  assert.equal(b.instances[0].image.bytesBase64Encoded, 'QUJD');
  assert.equal(b.parameters.aspectRatio, '9:16');
  assert.equal(b.parameters.durationSeconds, 8);
  assert.equal(b.parameters.generateAudio, false);
  assert.equal(b.parameters.seed, 2);
  assert.throws(() => A.veoRequestBody({ prompt: '  ', imageB64: 'x' }), (e) => e.label === 'VIDEOLAB_BAD_REQUEST');
});

caso('Veo: la respuesta da bytes o gcsUri; vacía (filtro de contenido) ⇒ PROVIDER_FAILED con el conteo', () => {
  assert.equal(A.veoVideosFrom({ done: true, response: { videos: [{ bytesBase64Encoded: 'AA' }] } })[0].b64, 'AA');
  assert.equal(A.veoVideosFrom({ done: true, response: { videos: [{ gcsUri: 'gs://b/o.mp4' }] } })[0].gcsUri, 'gs://b/o.mp4');
  assert.throws(() => A.veoVideosFrom({ done: true, response: { raiMediaFilteredCount: 1, videos: [] } }), /filtrados: 1/);
  assert.throws(() => A.veoVideosFrom({ done: true, error: { message: 'cuota' } }), /cuota/);
});

caso('Veo: clips para cubrir la duración (8 s cada uno, tope 3)', () => {
  assert.equal(A.clipsNeeded(6.8), 1);
  assert.equal(A.clipsNeeded(20), 3);
  assert.equal(A.clipsNeeded(60), 3);
});

caso('HeyGen: imagen que habla con audio propio, 9:16 1080p (forma medida en developers.heygen.com, 2026-11-07)', () => {
  const b = A.heygenRequestBody({ imageUrl: 'https://x/f.png', audioUrl: 'https://x/v.mp3' });
  assert.deepEqual(b.image, { type: 'url', url: 'https://x/f.png' });
  assert.equal(b.type, 'image');
  assert.equal(b.audio_url, 'https://x/v.mp3');
  assert.equal(b.aspect_ratio, '9:16');
  assert.equal(b.resolution, '1080p');
  assert.throws(() => A.heygenRequestBody({ imageUrl: 'x', audioUrl: null }), (e) => e.label === 'VIDEOLAB_BAD_REQUEST');
  assert.deepEqual(A.heygenStatus({ status: 'waiting' }), { state: 'pending' });
  assert.equal(A.heygenStatus({ status: 'completed', video_url: 'u', duration: 6 }).url, 'u');
  assert.equal(A.heygenStatus({ status: 'failed', failure_message: 'no face' }).reason, 'no face');
});

caso('HeyGen: la dirección del avatar (expresividad y movimiento) viaja si el preset la trae; mal escrita, falla', () => {
  const base = { imageUrl: 'https://x/f.png', audioUrl: 'https://x/v.mp3' };
  const sin = A.heygenRequestBody(base);
  assert.ok(!('expressiveness' in sin) && !('motion_prompt' in sin));
  const con = A.heygenRequestBody({ ...base, direction: { expressiveness: 'high', motion_prompt: '  cejas que se elevan, parpadeo natural  ' } });
  assert.equal(con.expressiveness, 'high');
  assert.equal(con.motion_prompt, 'cejas que se elevan, parpadeo natural');
  assert.throws(() => A.heygenRequestBody({ ...base, direction: { expressiveness: 'altísima' } }), /expressiveness inválido/);
});

caso('dirección del avatar: rota por job desde el catálogo, respeta cuántas de cada categoría, y sin catálogo falla', () => {
  const cat = [];
  for (const c of ['hands', 'hair', 'face']) for (let i = 0; i < 6; i++) cat.push({ id: `${c}${i}`, category: c, text: `${c} acción ${i}.` });
  const avatar = { expressiveness: 'high', base: 'Base.', picks: { hands: 3, hair: 1, face: 2 } };
  const a = A.composeAvatarDirection({ avatar, catalog: cat, seed: 'job-1' });
  assert.equal(a.picked.length, 6);
  assert.equal(a.picked.filter((x) => x.startsWith('hair')).length, 1);
  assert.equal(a.picked.filter((x) => x.startsWith('hands')).length, 3);
  assert.ok(a.motion_prompt.startsWith('Base. '));
  assert.deepEqual(A.composeAvatarDirection({ avatar, catalog: cat, seed: 'job-1' }), a, 'misma semilla, misma elección');
  const distintas = new Set(['job-2', 'job-3', 'job-4', 'job-5'].map((s) => A.composeAvatarDirection({ avatar, catalog: cat, seed: s }).picked.join()));
  assert.ok(distintas.size >= 3, 'jobs distintos rotan la elección');
  assert.throws(() => A.composeAvatarDirection({ avatar, catalog: cat.filter((r) => r.category !== 'hair'), seed: 'x' }), /no tiene acciones de «hair»/);
  assert.deepEqual(A.composeAvatarDirection({ avatar: { expressiveness: 'low', motion_prompt: 'fijo' }, catalog: [], seed: 'x' }),
    { expressiveness: 'low', motion_prompt: 'fijo', picked: [] });
});

caso('subtítulos: el texto de la voz VERBATIM, en grupos, con la familia de la marca (dato)', () => {
  const words = [['Hola', 0, 300], ['esto', 320, 600], ['es', 620, 700], ['una', 720, 900], ['prueba.', 920, 1400]]
    .map(([text, start_ms, end_ms]) => ({ text, start_ms, end_ms }));
  const ass = A.buildAss({ words, canvas: CANVAS, style: { font_family: 'Familia Sintetica', color: '#FFFFFF', outline_color: '#000000', max_words: 4 } });
  assert.match(ass, /Style: Sub,Familia Sintetica,/);
  assert.match(ass, /Dialogue: 0,0:00:00.00,0:00:00.90,Sub,,0,0,0,,Hola esto es una/);
  assert.match(ass, /Dialogue: 0,0:00:00.92,0:00:01.40,Sub,,0,0,0,,prueba\./);
  assert.throws(() => A.buildAss({ words: [], canvas: CANVAS, style: {} }), (e) => e.label === 'VIDEOLAB_BAD_REQUEST');
});

// ── ffmpeg real ───────────────────────────────────────────────────────────────────────────────────
ff('-f', 'lavfi', '-i', 'testsrc2=s=720x1280:r=24:d=8', '-pix_fmt', 'yuv420p', p('veo.mp4'));
ff('-f', 'lavfi', '-i', 'testsrc2=s=1080x1920:r=25:d=6', '-f', 'lavfi', '-i', 'sine=f=220:d=6', '-shortest', '-pix_fmt', 'yuv420p', '-c:a', 'aac', p('avatar.mp4'));
ff('-f', 'lavfi', '-i', "color=c=white:s=1080x1920,format=rgba,geq=r='255':g='255':b='255':a='if(between(Y,100,300),230,0)'", '-frames:v', '1', p('layer.png'));
ff('-f', 'lavfi', '-i', 'sine=f=300:d=10', '-ac', '1', '-ar', '44100', p('voice.mp3'));
ff('-f', 'lavfi', '-i', 'sine=f=600:d=3', '-ar', '44100', p('music.mp3'));

caso('generative: dos clips de 720p a 24 fps salen a 1080×1920, 30 fps, con voz y música', () => {
  const { args } = A.planAssemble({ preset: PRESET, canvas: CANVAS, durationS: 10.8,
    inputs: { clips: [p('veo.mp4'), p('veo.mp4')], clipHasVoice: false, layer: p('layer.png'), voice: { path: p('voice.mp3') }, music: { path: p('music.mp3') }, out: p('g.mp4') } });
  ff(...args.slice(1));
  assert.deepEqual(validateOutput(probe(p('g.mp4')), CANVAS, statSync(p('g.mp4')).size), []);
  assert.ok(Math.abs(Number(probe(p('g.mp4')).format.duration) - 10.8) < 0.2);
});

const DEJAVU = '/usr/share/fonts/truetype/dejavu';
caso('avatar: la voz es la del clip, con subtítulos quemados y la duración de la voz', () => {
  const ass = p('s.ass');
  writeFileSync(ass, A.buildAss({ words: [{ text: 'Hola', start_ms: 0, end_ms: 2000 }, { text: 'mundo', start_ms: 2000, end_ms: 5000 }],
    canvas: CANVAS, style: { font_family: 'DejaVu Sans', color: '#FFFFFF', outline_color: '#000000' } }));
  const { args } = A.planAssemble({ preset: { ...PRESET, video_style: 'ugc' }, canvas: CANVAS, durationS: 6.8,
    inputs: { clips: [p('avatar.mp4')], clipHasVoice: true, layer: null, ass, fontsDir: existsSync(DEJAVU) ? DEJAVU : null, voice: null, music: { path: p('music.mp3') }, out: p('a.mp4') } });
  assert.ok(!args.includes(p('voice.mp3')), 'no se usa la voz externa: la del clip manda');
  ff(...args.slice(1));
  assert.deepEqual(validateOutput(probe(p('a.mp4')), CANVAS, statSync(p('a.mp4')).size), []);
  // Los subtítulos aparecen: el borde inferior del fotograma cambia con y sin ellos.
  const fr = (f) => execFileSync('ffmpeg', ['-loglevel', 'error', '-ss', '1', '-i', f, '-frames:v', '1', '-vf', 'crop=1080:300:0:1500,format=gray', '-f', 'rawvideo', '-']);
  ff('-i', p('avatar.mp4'), '-t', '2', '-vf', 'fps=30', p('sin.mp4'));
  assert.notDeepEqual(fr(p('a.mp4')), fr(p('sin.mp4')));
});

caso('marca N+1: el ensamblado y los proveedores no nombran ninguna marca ni persona', () => {
  const INSTANCIAS = ['NeuroneSCF', 'ForumPHs', 'UnrealvilleStudio', 'LucienSael', 'D7Herbal', 'Patricia', 'Irja', 'Ivette', 'Lucien', 'NSCF', 'FPHS', 'D7H'];
  for (const f of ['render/src/assemble.mjs', 'render/src/providers/veo.mjs', 'render/src/providers/heygen.mjs', 'render/src/fonts.mjs', 'render/src/main.mjs']) {
    const s = readFileSync(join(RAIZ, f), 'utf8').replace(/_/g, ' ');
    assert.deepEqual(INSTANCIAS.filter((n) => new RegExp(`\\b${n}\\b`, 'i').test(s)), [], f);
  }
});

caso('subtítulos: las etiquetas de interpretación de la voz no salen en pantalla, aunque abarquen varias palabras', () => {
  const words = [['[frustrated,', 0, 10], ['leaning', 10, 20], ['in]', 20, 30], ['The', 40, 200], ['ritual.', 210, 500], ['[sharp]', 510, 520], ['And', 530, 700]]
    .map(([text, start_ms, end_ms]) => ({ text, start_ms, end_ms }));
  assert.deepEqual(A.spokenWords(words).map((w) => w.text), ['The', 'ritual.', 'And']);
  const ass = A.buildAss({ words, canvas: CANVAS, style: { font_family: 'x', color: '#FFFFFF', outline_color: '#000000' } });
  const dialogos = ass.split('\n').filter((l) => l.startsWith('Dialogue:')).join('\n');
  assert.doesNotMatch(dialogos, /\[|\]|leaning/);
  assert.match(ass, /Dialogue: 0,0:00:00.04,0:00:00.70,Sub,,0,0,0,,The ritual\. And/);
});

caso('avatar de una persona del registro: la foto sale de su ficha; sin foto, falla; sin persona, las del pedido', () => {
  const prev = { image: { url: 'https://x/pedido.png' } };
  assert.deepEqual(A.sourceImages({ producer: 'avatar', personId: 'p1', person: { avatar_photo_url: 'https://x/ficha.jpg' }, prev }), [{ url: 'https://x/ficha.jpg' }]);
  assert.throws(() => A.sourceImages({ producer: 'avatar', personId: 'p1', person: { avatar_photo_url: null }, prev }), /no tiene foto de avatar/);
  assert.deepEqual(A.sourceImages({ producer: 'avatar', personId: null, person: undefined, prev }), [{ url: 'https://x/pedido.png' }]);
  assert.deepEqual(A.sourceImages({ producer: 'render', personId: 'p1', person: undefined, prev }), [{ url: 'https://x/pedido.png' }]);
});

caso('regla rota a propósito: sin subtítulos válidos (color mal escrito) el ensamblado no arranca', () => {
  assert.throws(() => A.buildAss({ words: [{ text: 'a', start_ms: 0, end_ms: 1 }], canvas: CANVAS, style: { font_family: 'x', color: 'blanco', outline_color: '#000000' } }),
    /color de subtítulo inválido/);
});

if (fallos) { console.error(`\n${fallos} caso(s) en rojo`); process.exit(1); }
console.log('\nassemble: todo en verde');
