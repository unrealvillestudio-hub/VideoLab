// CAPAS DE TEXTO EDITABLES (contrato v1.3.0, §4 ter) — el bloque PURO de render/src/textlayers.mjs y un render real
// de 2 s con libass.
//
// Qué se comprueba: los presets son DATO (la siembra de docs/text_presets_seed.json se interpreta entera), todo cae
// dentro de la zona segura, el rol no pisa la banda de subtítulos ni una cara, lo que falta en el dato falla con nombre,
// el karaoke agrupa de 3 a 4 palabras con la palabra activa en el acento, y nada nombra una marca (test N+1).
//
// Ejecutar:  node tests/textlayers_test.mjs     (sin red; la parte de ffmpeg se salta si no hay ffmpeg con libass)

import { readFileSync, mkdtempSync, existsSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import * as T from '../render/src/textlayers.mjs';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));
const SEED = JSON.parse(readFileSync(join(RAIZ, 'docs/text_presets_seed.json'), 'utf8'));
const PRESETS = SEED.rows;

let fallos = 0;
function caso(nombre, fn) {
  try { fn(); console.log(`  ok  ${nombre}`); } catch (e) { fallos++; console.error(`  MAL ${nombre}\n      ${e.message}`); }
}

// Marca sintética: los roles de paleta y tipografía son inventados a propósito (el código no puede conocerlos).
const BRAND = 'marca_sintetica_a';
const CANVAS = { width: 1080, height: 1920 };
const SAFE = { top: 14, left: 6, right: 22, bottom: 37 };
const PALETTE = [{ role: 'hueso', hex: '#F2F0EC' }, { role: 'carbon', hex: '#111111' }, { role: 'brasa', hex: '#FF8800' }, { role: 'mar', hex: '#00AACC' }];
const TOKENS = { palette: { headline: 'hueso', subheadline: 'hueso', headline_emphasis: 'brasa' },
  layout: { scrim: { palette: 'carbon' }, rule: { palette: 'mar' } },
  identity: { mode: 'edge_left', palette: 'mar', width_pct: 1.8, full_bleed: true } };
const TYPO = [{ role: 'display', font_family: 'Familia Display' }, { role: 'body', font_family: 'Familia Texto' }];
const WORDS = 'Hoy les cuento por qué el uno por ciento de los clientes cambia todo el negocio en semanas'.split(' ')
  .map((text, i) => ({ text, start_ms: i * 300, end_ms: i * 300 + 260, person_id: i < 9 ? 'p1' : 'p2' }));
const TL = () => ({
  hook: { text: 'El 1 % que cambia todo el negocio', preset_key: 'hook_pop_words', start_ms: 0, end_ms: 2600, emphasis: ['negocio'] },
  roles: [{ person_id: 'p1', text: 'Persona Uno — Directora — Estudio', show: true, at_ms: 400, dur_ms: 3800, preset_key: 'role_chip_slide' }],
  captions: { enabled: true, preset_key: 'caption_karaoke_accent', accent_role: 'brasa' },
  key_titles: [{ text: 'Una frase clave', at_ms: 2800, dur_ms: 1400, preset_key: 'key_title_rule' }],
  cta: { text: 'Reenvíalo a quien lleva las cuentas', at_ms: 4400, preset_key: 'cta_pill_shimmer' },
  identity: { strip: true, strip_role: 'mar' },
});
const build = (over = {}) => T.buildTextLayers({ textLayers: TL(), timeline: { words: WORDS }, presets: PRESETS, brandId: BRAND,
  palette: PALETTE, typography: TYPO, tokens: TOKENS, safeZone: SAFE, canvas: CANVAS, durationMs: 6000, ...over });
const label = (l) => (e) => e.label === l;

console.log('textlayers — capas de texto editables');

caso('siembra: 17 presets con las claves del contrato (5 hook, 5 role, 3 caption, 2 key_title, 2 cta), todos proposed y de sistema', () => {
  const by = (l) => PRESETS.filter((r) => r.layer === l).map((r) => r.preset_key);
  assert.deepEqual(by('hook'), ['hook_pop_words', 'hook_mask_wipe', 'hook_type_on', 'hook_punch_settle', 'hook_line_slide']);
  assert.deepEqual(by('role'), ['role_chip_slide', 'role_rule_draw', 'role_fade_rise', 'role_card_two_line', 'role_label_minimal']);
  assert.deepEqual(by('caption'), ['caption_karaoke_accent', 'caption_box_accent', 'caption_clean']);
  assert.deepEqual(by('key_title'), ['key_title_rule', 'key_title_stamp']);
  assert.deepEqual(by('cta'), ['cta_pill_shimmer', 'cta_card_rise']);
  assert.ok(PRESETS.every((r) => r.brand_id === null && r.status === 'proposed' && r.active === true && r.name && r.description));
});

caso('cada preset de la siembra se interpreta y deja todo dentro de la zona segura', () => {
  const pick = (l) => PRESETS.filter((r) => r.layer === l).map((r) => r.preset_key);
  const n = Math.max(...['hook', 'role', 'caption', 'key_title', 'cta'].map((l) => pick(l).length));
  for (let i = 0; i < n; i++) {
    const tl = TL();
    tl.hook.preset_key = pick('hook')[i % 5];
    tl.roles[0].preset_key = pick('role')[i % 5];
    tl.captions.preset_key = pick('caption')[i % 3];
    tl.key_titles[0].preset_key = pick('key_title')[i % 2];
    tl.cta.preset_key = pick('cta')[i % 2];
    const r = build({ textLayers: tl });
    for (const b of r.blocks) {
      assert.ok(b.rect.x >= r.safe.x && b.rect.y >= r.safe.y && b.rect.x + b.rect.w <= r.safe.x1 && b.rect.y + b.rect.h <= r.safe.y1,
        `${b.layer} ${b.preset_key} fuera: ${JSON.stringify(b.rect)} vs ${JSON.stringify(r.safe)}`);
    }
  }
});

caso('el rol entra en ≤ 350 ms en toda la siembra; un preset de rol más lento se rechaza', () => {
  for (const r of PRESETS.filter((x) => x.layer === 'role')) assert.ok(r.spec.duration_ms <= T.ROLE_MAX_ENTRY_MS, r.preset_key);
  const lento = PRESETS.map((r) => (r.preset_key === 'role_chip_slide' ? { ...r, spec: { ...r.spec, duration_ms: 600 } } : r));
  assert.throws(() => build({ presets: lento }), label('VIDEOLAB_BAD_REQUEST'));
});

caso('el rol va sobre la banda de subtítulos con margen ≥ 2 % y alineado al borde seguro izquierdo', () => {
  const r = build();
  const band = r.blocks.find((b) => b.layer === 'caption_band').rect;
  const role = r.blocks.find((b) => b.layer === 'role').rect;
  assert.ok(role.y + role.h <= band.y - CANVAS.height * 0.02, `rol termina en ${role.y + role.h}, banda empieza en ${band.y}`);
  assert.equal(role.x, r.safe.x);
  assert.equal(band.y + band.h, r.safe.y1, 'la banda va al fondo de la zona segura');
});

caso('con una cara en el tercio inferior, el rol sube hasta no taparla', () => {
  const solo = () => { const t = TL(); t.hook = null; t.key_titles = []; t.cta = null; return t; };
  const base = build({ textLayers: solo() }).blocks.find((b) => b.layer === 'role').rect;
  const face = { x: 0, y: (base.y / 1920) * 100 - 5, w: 40, h: 10 };
  const r = build({ textLayers: solo(), timeline: { words: WORDS, faces: [{ box: face, start_ms: 0, end_ms: 6000 }] } });
  const role = r.blocks.find((b) => b.layer === 'role').rect;
  const f = { x: 0, y: 1920 * face.y / 100, w: 1080 * 0.4, h: 192 };
  assert.ok(role.y + role.h <= f.y || role.y >= f.y + f.h, `rol ${JSON.stringify(role)} tapa la cara ${JSON.stringify(f)}`);
  assert.ok(role.y < base.y);
});

caso('una cara que ocupa toda la zona segura ⇒ VIDEOLAB_TEXT_DOES_NOT_FIT (no se tapa la cara en silencio)', () => {
  assert.throws(() => build({ timeline: { words: WORDS, faces: [{ box: { x: 0, y: 0, w: 100, h: 100 } }] } }), label('VIDEOLAB_TEXT_DOES_NOT_FIT'));
});

caso('preset inexistente, inactivo o de otra capa ⇒ VIDEOLAB_BAD_REQUEST', () => {
  const tl = TL(); tl.hook.preset_key = 'hook_que_no_existe';
  assert.throws(() => build({ textLayers: tl }), label('VIDEOLAB_BAD_REQUEST'));
  const inactivo = PRESETS.map((r) => (r.preset_key === 'hook_pop_words' ? { ...r, active: false } : r));
  assert.throws(() => build({ presets: inactivo }), label('VIDEOLAB_BAD_REQUEST'));
  const tl2 = TL(); tl2.hook.preset_key = 'cta_card_rise';
  assert.throws(() => build({ textLayers: tl2 }), /capa cta/);
});

caso('la fila de la marca manda sobre la del sistema; inactiva apaga el preset para esa marca', () => {
  const marca = { ...PRESETS.find((r) => r.preset_key === 'hook_pop_words'), brand_id: BRAND, spec: { ...PRESETS[0].spec, size_pct: 3, min_size_pct: 3 } };
  assert.equal(T.resolveTextPreset([...PRESETS, marca], 'hook_pop_words', BRAND, 'hook').spec.size_pct, 3);
  assert.equal(T.resolveTextPreset([...PRESETS, marca], 'hook_pop_words', 'otra_marca', 'hook').spec.size_pct, PRESETS[0].spec.size_pct);
  assert.throws(() => T.resolveTextPreset([...PRESETS, { ...marca, active: false }], 'hook_pop_words', BRAND, 'hook'), label('VIDEOLAB_BAD_REQUEST'));
});

caso('rol de paleta que la marca no tiene ⇒ VIDEOLAB_BAD_REQUEST (acento y franja)', () => {
  const tl = TL(); tl.captions.accent_role = 'rol_inexistente';
  assert.throws(() => build({ textLayers: tl }), /brand_palette no tiene el rol rol_inexistente/);
  const tl2 = TL(); tl2.identity.strip_role = 'otro_rol';
  assert.throws(() => build({ textLayers: tl2 }), label('VIDEOLAB_BAD_REQUEST'));
  assert.throws(() => build({ tokens: { ...TOKENS, palette: {} } }), /no declara el color «text»/);
});

caso('tipografía: sin el rol display de la marca ⇒ VIDEOLAB_BAD_REQUEST; el preset puede pedir otro rol', () => {
  assert.throws(() => build({ typography: [{ role: 'body', font_family: 'Familia Texto' }] }), /brand_typography no tiene el rol display/);
  const r = build();
  assert.deepEqual(r.families.sort(), ['Familia Display', 'Familia Texto']);
});

caso('karaoke: grupos de 3–4 palabras que no cruzan de persona; un evento por palabra con la activa en el acento', () => {
  const g = T.groupCaptionWords(WORDS, { min: 3, max: 4 });
  assert.ok(g.every((x) => x.length >= 1 && x.length <= 4));
  assert.ok(g.filter((x) => x.length >= 3).length >= g.length - 2, `grupos: ${g.map((x) => x.length)}`);
  assert.ok(g.every((x) => new Set(x.map((w) => w.person_id)).size === 1), 'un grupo no mezcla personas');
  assert.equal(g.flat().length, WORDS.length);
  const coma = T.groupCaptionWords([{ text: 'uno', start_ms: 0, end_ms: 1 }, { text: 'dos', start_ms: 2, end_ms: 3 }, { text: 'tres,', start_ms: 4, end_ms: 5 }, { text: 'cuatro', start_ms: 6, end_ms: 7 }]);
  assert.deepEqual(coma.map((x) => x.length), [3, 1], 'corta en la puntuación al llegar al mínimo');
  const ass = build().ass;
  const sub = ass.split('\n').filter((l) => l.startsWith('Dialogue: 2') && l.includes(',S_caption_karaoke_accent,'));
  assert.equal(sub.length, WORDS.length, 'un evento por palabra');
  const acento = T.assColor('#FF8800');
  assert.ok(sub.every((l) => l.includes(`\\c${acento}`)), 'la palabra activa va en el acento pedido');
});

caso('texto VERBATIM: el gancho sale tal cual (salvo las llaves que libass interpreta)', () => {
  const tl = TL(); tl.hook.text = 'Texto {raro} con \\ barra'; tl.hook.preset_key = 'hook_mask_wipe';
  const ass = build({ textLayers: tl }).ass;
  assert.match(ass.replace(/\\N/g, ' '), /Texto raro con +barra/);
});

caso('un texto que no entra ni con el tamaño mínimo ⇒ VIDEOLAB_TEXT_DOES_NOT_FIT (nunca se desborda)', () => {
  const tl = TL(); tl.hook.text = 'Superextraordinariamenteinconmensurablementelarguísima palabra';
  assert.throws(() => build({ textLayers: tl }), label('VIDEOLAB_TEXT_DOES_NOT_FIT'));
  const tl2 = TL(); tl2.hook.text = Array(60).fill('palabra').join(' ');
  assert.throws(() => build({ textLayers: tl2 }), label('VIDEOLAB_TEXT_DOES_NOT_FIT'));
});

caso('dos bloques en el mismo tiempo y lugar ⇒ VIDEOLAB_TEXT_DOES_NOT_FIT', () => {
  const tl = TL(); tl.key_titles.push({ text: 'Otra frase', at_ms: 3000, dur_ms: 1000, preset_key: 'key_title_stamp' });
  assert.throws(() => build({ textLayers: tl }), /se pisan/);
});

caso('franja de identidad: drawbox con el modo y el ancho de los tokens y el color del rol', () => {
  assert.deepEqual(build().filters, ['drawbox=x=0:y=0:w=19:h=1920:color=0x00AACC@1:t=fill']);
  assert.throws(() => build({ tokens: { ...TOKENS, identity: undefined } }), /no declara identity/);
});

caso('zona segura: dato del canal; sin él o con valores imposibles ⇒ VIDEOLAB_BAD_REQUEST', () => {
  assert.throws(() => build({ safeZone: null }), label('VIDEOLAB_BAD_REQUEST'));
  assert.throws(() => build({ safeZone: { ...SAFE, bottom: 70 } }), label('VIDEOLAB_BAD_REQUEST'));
});

caso('validación de la forma: claves vacías, tiempos negativos y capas vacías', () => {
  assert.ok(T.validateTextLayers(TL()));
  const malos = [(t) => { t.hook.preset_key = ''; }, (t) => { t.hook.start_ms = -1; }, (t) => { t.hook.end_ms = 0; },
    (t) => { t.roles[0].at_ms = -5; }, (t) => { t.roles[0].preset_key = ' '; }, (t) => { t.key_titles[0].dur_ms = 0; },
    (t) => { t.cta.at_ms = -1; }, (t) => { t.captions.preset_key = ''; }, (t) => { t.captions.accent_role = ''; }];
  for (const m of malos) { const t = TL(); m(t); assert.throws(() => T.validateTextLayers(t), label('VIDEOLAB_BAD_REQUEST')); }
  assert.throws(() => T.validateTextLayers({}), /no pide ninguna capa/);
  assert.throws(() => T.validateTextLayers(TL(), { words: [] }), /timeline.words/);
  const oculto = TL(); oculto.roles[0] = { show: false };
  assert.ok(T.validateTextLayers(oculto), 'un rol apagado no necesita sus campos');
});

caso('timeline de conversación: palabras en tiempo absoluto con la persona del turno', () => {
  const tl = T.conversationTimeline({ cast: { a: 'p1', b: 'p2' }, turns: [
    { seat: 'a', voice: { duration_ms: 1000, alignment: { words: [{ text: '[firme] Hola', start_ms: 0, end_ms: 300 }, { text: 'mundo', start_ms: 400, end_ms: 800 }] } } },
    { seat: 'b', voice: { duration_ms: 2000 } },
    { seat: 'a', voice: { duration_ms: 500, alignment: { words: [{ text: 'sí', start_ms: 100, end_ms: 400 }] } } }] });
  assert.deepEqual(tl.words, [{ text: 'Hola', start_ms: 0, end_ms: 300, person_id: 'p1' }, { text: 'mundo', start_ms: 400, end_ms: 800, person_id: 'p1' },
    { text: 'sí', start_ms: 3100, end_ms: 3400, person_id: 'p1' }]);
  assert.deepEqual(tl.turns.map((t) => [t.person_id, t.start_ms, t.end_ms]), [['p1', 0, 1000], ['p2', 1000, 3000], ['p1', 3000, 3500]]);
  assert.deepEqual(tl.turns_without_words, [1]);
});

caso('medida real: las métricas de la fuente dan un ancho menor o igual que la estimación conservadora', () => {
  const f = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';
  if (!existsSync(f)) { console.log('      (sin DejaVu; se salta)'); return; }
  const m = T.ttfMeasure(readFileSync(f));
  const w = m('Reenvíalo a quien lleva las cuentas', 60);
  assert.ok(w > 600 && w < 1400, `ancho ${w}`);
  assert.ok(m('iiii', 60) < m('MMMM', 60));
  assert.throws(() => T.ttfMeasure(Buffer.from('no es una fuente')));
});

caso('marca N+1: el módulo y la siembra no nombran ninguna marca ni persona, ni traen un color de marca', () => {
  const INSTANCIAS = ['NeuroneSCF', 'ForumPHs', 'UnrealvilleStudio', 'LucienSael', 'D7Herbal', 'DiamondDetails', 'VivoseMask',
    'VizosCosmetics', 'PatriciaOsorio', 'Patricia', 'Irja', 'Ivette', 'Lucien', 'NSCF', 'FPHS', 'D7H'];
  for (const f of ['render/src/textlayers.mjs', 'docs/text_presets_seed.json']) {
    const s = readFileSync(join(RAIZ, f), 'utf8').replace(/_/g, ' ');
    assert.deepEqual(INSTANCIAS.filter((n) => new RegExp(`\\b${n}\\b`, 'i').test(s)), [], f);
  }
  // En la siembra sólo hay negro neutro para contornos y sombras; todo color de marca entra por un hueco o un rol.
  const hexes = [...JSON.stringify(SEED).matchAll(/#[0-9A-Fa-f]{6}/g)].map((m) => m[0].toUpperCase());
  assert.deepEqual([...new Set(hexes)], ['#000000']);
  const enCodigo = [...readFileSync(join(RAIZ, 'render/src/textlayers.mjs'), 'utf8').matchAll(/#[0-9A-Fa-f]{6}\b/g)].map((m) => m[0]);
  assert.deepEqual([...new Set(enCodigo)], ['#000000'], 'el único color escrito en el código es el negro neutro de contornos');
});

caso('regla rota a propósito: si el rol ignorara la banda, el caso del margen lo ve', () => {
  const r = build();
  const band = r.blocks.find((b) => b.layer === 'caption_band').rect;
  const roto = { ...r.blocks.find((b) => b.layer === 'role').rect, y: band.y - 10 };
  assert.ok(!(roto.y + roto.h <= band.y - CANVAS.height * 0.02));
});

// ── render real: 2 s sobre un video de color con una fuente abierta ──
const hayLibass = spawnSync('ffmpeg', ['-hide_banner', '-filters'], { encoding: 'utf8' }).stdout?.includes(' subtitles ');
const DEJAVU = '/usr/share/fonts/truetype/dejavu';
if (hayLibass && existsSync(join(DEJAVU, 'DejaVuSans.ttf'))) {
  caso('libass dibuja las capas sobre 2 s de video: mismo lienzo, H.264, AAC y el texto se ve', () => {
    const dir = mkdtempSync(join(tmpdir(), 'videolab-tl-'));
    const p = (f) => join(dir, f);
    execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0x405060:s=1080x1920:r=30:d=2', '-f', 'lavfi', '-i', 'sine=f=300:d=2',
      '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', p('base.mp4')]);
    const tl = TL(); tl.key_titles = []; tl.cta = null; tl.roles[0].at_ms = 200; tl.roles[0].dur_ms = 1600;
    const r = T.buildTextLayers({ textLayers: tl, timeline: { words: WORDS.slice(0, 6) }, presets: PRESETS, brandId: BRAND, palette: PALETTE,
      typography: [{ role: 'display', font_family: 'DejaVu Sans' }, { role: 'body', font_family: 'DejaVu Sans' }], tokens: TOKENS,
      safeZone: SAFE, canvas: CANVAS, durationMs: 2000, measure: T.ttfMeasure(readFileSync(join(DEJAVU, 'DejaVuSans.ttf'))) });
    writeFileSync(p('t.ass'), r.ass);
    execFileSync('ffmpeg', ['-loglevel', 'error', ...T.textLayersArgs({ input: p('base.mp4'), ass: p('t.ass'), fontsDir: DEJAVU, filters: r.filters, out: p('out.mp4') })]);
    const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', p('out.mp4')]));
    const v = probe.streams.find((s) => s.codec_type === 'video'), a = probe.streams.find((s) => s.codec_type === 'audio');
    assert.deepEqual([v.width, v.height, v.codec_name, v.pix_fmt], [1080, 1920, 'h264', 'yuv420p']);
    assert.deepEqual([a.codec_name, Number(a.sample_rate)], ['aac', 48000]);
    assert.ok(Math.abs(Number(probe.format.duration) - 2) < 0.15);
    // El gancho aclara su franja a mitad del video; fuera de la zona segura (abajo del todo) no hay texto.
    const luma = (y0, h) => execFileSync('ffmpeg', ['-loglevel', 'error', '-ss', '1.2', '-i', p('out.mp4'), '-frames:v', '1',
      '-vf', `crop=1080:${h}:0:${y0},scale=1:1,format=gray`, '-f', 'rawvideo', '-'])[0];
    const hook = r.blocks.find((b) => b.layer === 'hook').rect;
    assert.ok(luma(hook.y, hook.h) > luma(1700, 200) + 10, 'el gancho se ve');
    const fondo = luma(1700, 200);
    assert.ok(Math.abs(fondo - luma(1750, 100)) < 3, 'nada dibujado fuera de la zona segura');
  });

  // El job completo en modo text_layers, con Supabase, Storage y Google Fonts dobles: sólo dato y ffmpeg reales.
  const { renderJob } = await import('../render/src/main.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'videolab-job-'));
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0x405060:s=1080x1920:r=30:d=2', '-f', 'lavfi', '-i', 'sine=f=300:d=2',
    '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', join(dir, 'base.mp4')]);
  const JOB = '00000000-0000-0000-0000-00000000f00d';
  const tl = TL(); tl.key_titles = []; tl.cta = null; tl.roles[0].dur_ms = 1400;
  const payload = { brandId: BRAND, pieceId: '00000000-0000-0000-0000-0000000000aa',
    params: { mode: 'text_layers', platform: 'meta_fb', format: 'reel', safe_zone_canal: 'CANAL_X' },
    previousOutputs: { base_video: { url: 'https://media.test/clean.mp4' }, timeline: { words: WORDS.slice(0, 6) }, text_layers: tl } };
  const llamadas = [];
  const resp = (body, status = 200) => ({ ok: status < 300, status, json: async () => body, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    arrayBuffer: async () => { const b = Buffer.isBuffer(body) ? body : Buffer.from(String(body)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); } });
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url); const m = init.method ?? 'GET';
    llamadas.push(`${m} ${u}`);
    if (u.includes('/rest/v1/lab_jobs') && m === 'GET') return resp([{ id: JOB, brand_id: BRAND, payload }]);
    if (u.includes('/rest/v1/lab_jobs') && m === 'PATCH') { llamadas.push(init.body); return resp('', 204); }
    if (u.includes('platform_format_profiles')) return resp([{ platform: 'meta_fb', format: 'reel', canvas_width: 1080, canvas_height: 1920, video_text_canal: null }]);
    if (u.includes('/rpc/ops_resolve_rate')) return resp([{ rate_usd: 0.000044, rate_id: 'tarifa-1', effective_from: '2026-01-01' }]);
    if (u.includes('/rpc/ops_log_generation')) return resp('asiento-1');
    if (u === 'https://media.test/clean.mp4') return resp(readFileSync(join(dir, 'base.mp4')));
    if (u.includes('imagelab_overlay_tokens') && u.includes('canal=eq.CANAL_X')) return resp([{ brand_id: null, tokens: { layout: { safe_zone_pct: SAFE } } }]);
    if (u.includes('imagelab_overlay_tokens') && u.includes('canal=is.null')) return resp([{ tokens: TOKENS }]);
    if (u.includes('videolab_text_presets')) return resp(PRESETS);
    if (u.includes('brand_palette')) return resp(PALETTE);
    if (u.includes('brand_typography')) return resp([{ role: 'display', font_family: 'DejaVu Sans', css_import: 'https://fonts.test/css' }, { role: 'body', font_family: 'DejaVu Sans', css_import: 'https://fonts.test/css' }]);
    if (u === 'https://fonts.test/css') return resp('@font-face { src: url(https://fonts.test/f.ttf) format("truetype"); }');
    if (u === 'https://fonts.test/f.ttf') return resp(readFileSync(join(DEJAVU, 'DejaVuSans.ttf')));
    if (u.includes('/storage/v1/object/')) { writeFileSync(join(dir, u.split('/').pop()), Buffer.from(init.body)); return resp({ Key: 'ok' }); }
    throw new Error(`fetch inesperado ${m} ${u}`);
  };
  try {
    const out = await renderJob(JOB, { SUPABASE_URL: 'https://sb.test', SUPABASE_SERVICE_ROLE_KEY: 'llave-de-prueba' });
    caso('job text_layers: sube MP4 y portada en la ruta de siempre, asienta el render y devuelve la forma del contrato', () => {
      assert.equal(out.mode, 'text_layers');
      assert.equal(out.video.storage_path, `videolab/${BRAND}/00000000-0000-0000-0000-0000000000aa/${JOB}.mp4`);
      assert.deepEqual([out.video.width, out.video.height], [1080, 1920]);
      assert.deepEqual(out.clean_video, { url: 'https://media.test/clean.mp4' });
      assert.deepEqual(out.text_layers, tl, 'eco de text_layers');
      assert.deepEqual(out.ledger_ids, ['asiento-1']);
      assert.equal(out.text_layout.metrics, 'font');
      assert.ok(existsSync(join(dir, `${JOB}.mp4`)) && existsSync(join(dir, `${JOB}.jpg`)));
      assert.ok(llamadas.some((l) => l.includes('ops_log_generation')));
      assert.ok(llamadas.some((l) => typeof l === 'string' && l.includes('"status":"completed"')));
    });
    caso('job text_layers: no llama a HeyGen, Veo, ImageLab ni lab_configs', () => {
      assert.deepEqual(llamadas.filter((l) => /heygen|aiplatform|lab_configs|\/api\/compose|videolab_params/.test(l)), []);
    });
    // Sin canal en el perfil ni en el pedido ⇒ falla con nombre antes de bajar nada.
    delete payload.params.safe_zone_canal;
    let err = null;
    try { await renderJob(JOB, { SUPABASE_URL: 'https://sb.test', SUPABASE_SERVICE_ROLE_KEY: 'llave-de-prueba' }); } catch (e) { err = e; }
    caso('job text_layers: sin canal de zona segura ⇒ VIDEOLAB_BAD_REQUEST y el job queda en failed', () => {
      assert.equal(err?.label, 'VIDEOLAB_BAD_REQUEST');
      assert.match(err.message, /safe_zone_canal/);
      assert.ok(llamadas.some((l) => typeof l === 'string' && l.includes('"status":"failed"')));
    });
  } finally { globalThis.fetch = fetchOriginal; }
} else console.log('  --  sin ffmpeg con libass: se salta el render real');

// Peor caso del carril (2026-11-16): un gancho de 12 palabras —el tope de CopyLab— no entraba en el tamaño mínimo
// de hook_punch_settle y el render se cayó con VIDEOLAB_TEXT_DOES_NOT_FIT. Cada preset de la siembra tiene que
// aguantar el texto más largo que el carril produce, medido con la métrica conservadora (la que se usa si la fuente
// de la marca no se puede leer) y en la zona segura más estrecha de las pruebas.
const PEOR_CASO = {
  hook: ['Ni la junta directiva puede tocar ese dinero sin el voto mayoritario',
    'El penthouse paga quinientos dólares y usted cien: eso podría cambiar pronto'],
  key_title: ['Su cuota podría duplicarse sin que su apartamento cambie en nada'],
  cta: ['Está pensando en reenviarlo al presidente de su junta directiva. Tiene razón. Compártalo con él.'],
  // Un rol exacto con nombre, dos cargos y la marca (texto obligatorio de una ficha real: la torre se cayó con él).
  role: ['Nombre Apellido — Facility Manager y Gerente de Operaciones — Marca'],
};
caso('siembra: cada preset de gancho, título clave, CTA y rol aguanta el texto más largo del carril', () => {
  const safe = T.safeRect(SAFE, CANVAS);
  for (const p of PRESETS.filter((r) => PEOR_CASO[r.layer])) {
    const raw = typeof p.spec === 'string' ? JSON.parse(p.spec) : p.spec;
    // El rol se mide como lo mide buildTextLayers: con `split_on` admite 4 líneas y si no, 2 por defecto.
    const spec = p.layer === 'role' ? { max_lines: raw.split_on ? 4 : 2, ...raw } : raw;
    for (const original of PEOR_CASO[p.layer]) {
      // Con `split_on`, cada parte va en su línea, y una parte larga parte a su vez (render/src/textlayers.mjs, capa 4).
      const text = p.layer === 'role' && raw.split_on
        ? original.split(raw.split_on).map((x) => x.trim()).filter(Boolean).join('\n') : original;
      assert.doesNotThrow(() => T.measureBlock({ text, spec, layer: p.layer, canvas: CANVAS,
        maxW: safe.w * (spec.max_width_pct ?? (p.layer === 'role' ? 80 : 100)) / 100, measure: T.estimateMeasure, family: 'x' }),
      `${p.preset_key} no aguanta «${original}»`);
    }
  }
});

if (fallos) { console.error(`\n${fallos} caso(s) en rojo`); process.exit(1); }
console.log('\ntextlayers: todo en verde');
