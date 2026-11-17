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
import * as F from '../render/src/fonts.mjs';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));
const SEED = JSON.parse(readFileSync(join(RAIZ, 'docs/text_presets_seed.json'), 'utf8'));
const PRESETS = SEED.rows;
// F2 (2026-11-17): los estilos html del catálogo también aguantan el peor caso (abajo).
const F2 = [...JSON.parse(readFileSync(join(RAIZ, 'docs/html_presets_f2.json'), 'utf8')).rows,
  ...JSON.parse(readFileSync(join(RAIZ, 'docs/html_presets_f3.json'), 'utf8')).rows];   // F3 (rodillo) también aguanta el peor caso

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

// 2026-11-16 (2) — política única: sin lugar libre, el texto queda en su ancla y se AVISA (nunca se descarta ni tumba el
// render). Antes el rol caía con VIDEOLAB_TEXT_DOES_NOT_FIT y el video entero se perdía (lab_jobs c5a1211c).
caso('una cara que ocupa toda la zona segura ⇒ cada capa queda en su ancla y avisa TEXT_OVER_FACE (no se tapa en silencio)', () => {
  const p = build({ timeline: { words: WORDS, faces: [{ box: { x: 0, y: 0, w: 100, h: 100 } }] } });
  for (const l of ['hook', 'key_titles[0]', 'cta', 'roles[0]']) assert.ok(p.warnings.some((w) => w.startsWith(`TEXT_OVER_FACE: ${l} `)), `avisa ${l}`);
  assert.equal(p.blocks.filter((b) => ['hook', 'key_title', 'cta', 'role'].includes(b.layer)).length, 4, 'ningún texto se descarta');
});

caso('antes de ceder, más pequeño: el gancho baja de tamaño para caber sobre la cara', () => {
  const base = build();
  const h0 = base.blocks.find((b) => b.layer === 'hook');
  const safe = base.safe;
  // Cara desde 3/4 del alto del gancho hasta el fondo: a su tamaño no cabe ni arriba ni abajo.
  const top = h0.rect.y + h0.rect.h * 0.75;
  const face = { box: { x: 0, y: (top / 1920) * 100, w: 100, h: ((1920 - top) / 1920) * 100 }, start_ms: 0, end_ms: 2600 };
  const p = build({ timeline: { words: WORDS, faces: [face] } });
  const h1 = p.blocks.find((b) => b.layer === 'hook');
  assert.ok(h1.size_px < h0.size_px, 'el gancho se achicó');
  assert.ok(h1.rect.y + h1.rect.h <= top + 0.5 && h1.rect.y >= safe.y - 0.5, 'cabe entre la zona segura y la cara');
  assert.ok(!p.warnings.some((w) => w.startsWith('TEXT_OVER_FACE: hook ')), 'el gancho no avisa: encontró lugar');
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

// 2026-11-16 — dos bloques en el mismo tiempo: el segundo se corre en vertical (antes chocaban y el render se caía).
caso('dos bloques en el mismo tiempo: el segundo se corre y no se pisan', () => {
  const tl = TL(); tl.key_titles.push({ text: 'Otra frase', at_ms: 3000, dur_ms: 1000, preset_key: 'key_title_stamp' });
  const p = build({ textLayers: tl });
  const k = p.blocks.filter((b) => b.layer === 'key_title');
  assert.equal(k.length, 2);
  const [a, c] = k.map((b) => b.rect);
  assert.ok(!(a.x < c.x + c.w && c.x < a.x + a.w && a.y < c.y + c.h && c.y < a.y + a.h), 'los dos títulos no se pisan');
});

caso('sin lugar libre en el mismo tiempo ⇒ aviso y VIDEOLAB_TEXT_DOES_NOT_FIT (la comprobación dura sigue)', () => {
  const tl = TL();
  for (let i = 0; i < 12; i++) tl.key_titles.push({ text: `Frase número ${i} bastante larga para ocupar`, at_ms: 3000, dur_ms: 1000, preset_key: 'key_title_stamp' });
  assert.throws(() => build({ textLayers: tl }), /se pisan|no entra|TEXT_DOES_NOT_FIT/);
});

// 2026-11-16 — LAS CARAS MANDAN EN TODAS LAS CAPAS: el título y el CTA se corren para no tapar una cara de su tramo.
caso('título clave y CTA esquivan la cara declarada de su tramo; fuera del tramo, quedan en su ancla', () => {
  const base = build();
  const k0 = base.blocks.find((b) => b.layer === 'key_title').rect;
  const kt = TL().key_titles[0];
  // Una cara justo donde cae el título, en su tramo.
  const face = { box: { x: (k0.x / 1080) * 100, y: (k0.y / 1920) * 100, w: (k0.w / 1080) * 100, h: (k0.h / 1920) * 100 },
    start_ms: kt.at_ms, end_ms: kt.at_ms + kt.dur_ms };
  const p = build({ timeline: { words: WORDS, faces: [face] } });
  const k1 = p.blocks.find((b) => b.layer === 'key_title').rect;
  assert.notEqual(k1.y, k0.y, 'el título se corrió');
  assert.equal(p.warnings.length, 0);
  // La misma cara en otro tramo no mueve nada.
  const lejos = build({ timeline: { words: WORDS, faces: [{ ...face, start_ms: 90000, end_ms: 91000 }] } });
  assert.equal(lejos.blocks.find((b) => b.layer === 'key_title').rect.y, k0.y);
});

// 2026-11-16 — BLOQUES COLOCADOS A MANO (contrato v1.3.3).
caso('place: validación de rango y forma; subtítulos sólo admiten zoom', () => {
  const tl = () => TL();
  const t1 = tl(); t1.hook.place = { x_pct: 50, y_pct: 50, zoom: 1.5 };
  assert.throws(() => build({ textLayers: t1 }), /zoom debe estar entre 0.7 y 1.3/);
  const t2 = tl(); t2.cta.place = { x_pct: 120, y_pct: 50, zoom: 1 };
  assert.throws(() => build({ textLayers: t2 }), /x_pct debe estar entre 0 y 100/);
  const t3 = tl(); t3.captions.place = { x_pct: 10, y_pct: 10, zoom: 1 };
  assert.throws(() => build({ textLayers: t3 }), /sólo admite zoom/);
  const t4 = tl(); t4.key_titles[0].place = 'arriba';
  assert.throws(() => build({ textLayers: t4 }), /place debe ser un objeto/);
});

caso('place: el centro cae donde dice, el zoom cambia el tamaño y el bloque queda marcado manual', () => {
  const base = build();
  const k0 = base.blocks.find((b) => b.layer === 'key_title');
  const tl = TL(); tl.key_titles[0].place = { x_pct: 50, y_pct: 20, zoom: 1.2 };
  const p = build({ textLayers: tl });
  const k = p.blocks.find((b) => b.layer === 'key_title');
  assert.equal(k.placed, 'manual'); assert.equal(k0.placed, 'auto');
  assert.ok(k.size_px > k0.size_px, 'el zoom agrandó el texto');
  const safe = p.safe;
  const cy = k.rect.y + k.rect.h / 2, cx = k.rect.x + k.rect.w / 2;
  assert.ok(Math.abs(cy - (safe.y + safe.h * 0.2)) <= 1 || p.warnings.some((w) => w.startsWith('TEXT_PLACE_CLAMPED: key_titles[0]')));
  assert.ok(Math.abs(cx - (safe.x + safe.w * 0.5)) <= 1);
});

caso('place en una esquina ⇒ se acota a la zona segura y avisa; sobre una cara ⇒ se queda y avisa', () => {
  const tl = TL(); tl.cta.place = { x_pct: 100, y_pct: 0, zoom: 1 };
  const p = build({ textLayers: tl });
  const c = p.blocks.find((b) => b.layer === 'cta');
  assert.ok(p.warnings.some((w) => w.startsWith('TEXT_PLACE_CLAMPED: cta')));
  assert.ok(c.rect.x + c.rect.w <= p.safe.x1 + 0.5 && c.rect.y >= p.safe.y - 0.5);
  const tf = TL(); tf.key_titles[0].place = { x_pct: 50, y_pct: 50, zoom: 1 };
  const kt = tf.key_titles[0];
  const q = build({ textLayers: tf, timeline: { words: WORDS, faces: [{ box: { x: 0, y: 0, w: 100, h: 100 }, start_ms: kt.at_ms, end_ms: kt.at_ms + kt.dur_ms }] } });
  assert.ok(q.warnings.some((w) => w.startsWith('TEXT_PLACED_OVER_FACE: key_titles[0]')));
  assert.equal(q.blocks.find((b) => b.layer === 'key_title').placed, 'manual');
});

caso('rol y subtítulos: el rol colocado a mano se respeta; el zoom de subtítulos agranda la banda', () => {
  const tl = TL(); tl.roles[0].place = { x_pct: 80, y_pct: 30, zoom: 0.8 };
  const p = build({ textLayers: tl });
  assert.equal(p.blocks.find((b) => b.layer === 'role').placed, 'manual');
  const base = build();
  const tz = TL(); tz.captions.place = { zoom: 1.3 };
  const z = build({ textLayers: tz });
  const bh = (x) => x.blocks.find((b) => b.layer === 'caption_band').rect.h;
  assert.ok(bh(z) > bh(base), 'banda más alta con zoom');
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

// ── Caras de la fuente: se eligen por estilo y peso, nunca «la primera url» del CSS ────────────────────────────────────
// El proveedor lista las caras en su orden (cursivas primero, el peso ligero primero). CSS sintético: sin red y sin marca.
const face = (style, weight, id) => `@font-face {\n  font-family: 'Familia Sintetica';\n  font-style: ${style};\n  font-weight: ${weight};\n  src: url(https://fuentes.invalid/${id}.ttf) format('truetype');\n}\n`;
const CSS_DISPLAY = face('italic', 400, 'i400') + face('italic', 500, 'i500') + face('normal', 400, 'n400') + face('normal', 500, 'n500');
const CSS_TEXTO = face('normal', 300, 'n300') + face('normal', 400, 'n400') + face('normal', 500, 'n500') + face('normal', 600, 'n600') + face('normal', 700, 'n700');
const id = (f) => f && f.url.match(/\/(\w+)\.ttf$/)[1];

caso('caras: la regular es la normal más cercana a 400, aunque el CSS liste antes una cursiva o una ligera', () => {
  assert.equal(F.parseFontFaces(CSS_DISPLAY).length, 4);
  assert.equal(id(F.pickFaces(F.parseFontFaces(CSS_DISPLAY), { family: 'x' }).regular), 'n400');
  assert.equal(id(F.pickFaces(F.parseFontFaces(CSS_TEXTO), { family: 'x' }).regular), 'n400');
  // Sin 400: la más cercana; en empate, la más pesada.
  assert.equal(id(F.pickFaces(F.parseFontFaces(face('normal', 300, 'n300') + face('normal', 500, 'n500')), { family: 'x' }).regular), 'n500');
  assert.equal(id(F.pickFaces(F.parseFontFaces(face('italic', 400, 'i400') + face('normal', 600, 'n600')), { family: 'x' }).regular), 'n600');
});

caso('caras: la negrita es la normal 700 si el preset la pide y existe; si no existe, null (negrita sintética)', () => {
  const t = F.pickFaces(F.parseFontFaces(CSS_TEXTO), { family: 'x', bold: true });
  assert.deepEqual([id(t.regular), id(t.bold)], ['n400', 'n700']);
  assert.equal(F.pickFaces(F.parseFontFaces(CSS_TEXTO), { family: 'x', bold: false }).bold, null);
  assert.equal(F.pickFaces(F.parseFontFaces(CSS_DISPLAY), { family: 'x', bold: true }).bold, null);
  // Una cursiva 700 no sirve de negrita.
  assert.equal(F.pickFaces(F.parseFontFaces(CSS_DISPLAY + face('italic', 700, 'i700')), { family: 'x', bold: true }).bold, null);
  // Una fuente variable (rango de pesos) en un solo archivo: regular, sin segunda cara.
  const v = F.pickFaces(F.parseFontFaces(face('normal', '100 900', 'var')), { family: 'x', bold: true });
  assert.deepEqual([id(v.regular), v.bold], ['var', null]);
});

caso('caras: sin ninguna cara normal ⇒ VIDEOLAB_BAD_REQUEST «sin cara normal» (nunca se dibuja en cursiva)', () => {
  const soloCursiva = face('italic', 400, 'i400') + face('italic', 700, 'i700');
  assert.throws(() => F.pickFaces(F.parseFontFaces(soloCursiva), { family: 'Familia Sintetica' }),
    (e) => e.label === 'VIDEOLAB_BAD_REQUEST' && /sin cara normal/.test(e.message) && /Familia Sintetica/.test(e.message));
});

caso('medida por cara: la negrita con cara real se mide con ella sin engrosar; sin cara real, la regular engrosada', () => {
  const calls = [];
  const fake = (name) => (t, px, o = {}) => { calls.push([name, !!o.bold]); return 1; };
  const m = T.faceMeasure({ A: { regular: fake('regA'), bold: fake('boldA') }, B: { regular: fake('regB'), bold: null } }, fake('est'));
  m('x', 10, { family: 'A', bold: true }); m('x', 10, { family: 'A', bold: false });
  m('x', 10, { family: 'B', bold: true }); m('x', 10, { family: 'Z', bold: true });
  assert.deepEqual(calls, [['boldA', false], ['regA', false], ['regB', true], ['est', true]]);
});

caso('caras que pide el pedido: un rol pide negrita si algún preset de ese rol la pide', () => {
  const rows = [
    { preset_key: 'p_hook', brand_id: null, layer: 'hook', active: true, spec: { font_role: 'r_display', bold: true } },
    { preset_key: 'p_cap', brand_id: null, layer: 'caption', active: true, spec: { font_role: 'r_texto', bold: false } },
    { preset_key: 'p_cta', brand_id: null, layer: 'cta', active: true, spec: { font_role: 'r_texto' } }];
  const tl = { hook: { preset_key: 'p_hook', text: 'a' }, captions: { preset_key: 'p_cap' }, cta: { preset_key: 'p_cta', text: 'b' } };
  assert.deepEqual(T.fontFacesNeeded(tl, rows, BRAND), [{ role: 'r_display', bold: true }, { role: 'r_texto', bold: false }]);
  assert.deepEqual(T.fontRolesNeeded(tl, rows, BRAND), ['r_display', 'r_texto']);
});

{
  // La descarga baja la cara elegida (no la primera url) y la negrita real al mismo directorio, para libass.
  const real = globalThis.fetch;
  const pedidas = [];
  globalThis.fetch = async (url) => {
    pedidas.push(String(url));
    if (String(url).startsWith('https://css.invalid/')) return new Response(CSS_DISPLAY + CSS_TEXTO.replace(/n(\d00)/g, 't$1'));
    return new Response(Buffer.from(String(url).match(/\/(\w+)\.ttf$/)[1]));
  };
  try {
    const dir = mkdtempSync(join(tmpdir(), 'caras-'));
    const got = await F.brandFontFaces({ cssImport: 'https://css.invalid/a', family: 'Familia Sintetica', dir, bold: true });
    caso('descarga: baja la regular normal 400 y la negrita normal 700, y nada más', () => {
      assert.equal(readFileSync(got.regular.file, 'utf8'), 'n400');
      assert.equal(readFileSync(got.bold.file, 'utf8'), 't700');
      assert.deepEqual(pedidas.slice(1).sort(), ['https://fuentes.invalid/n400.ttf', 'https://fuentes.invalid/t700.ttf']);
      assert.ok(got.regular.file.startsWith(dir) && got.bold.file.startsWith(dir));
    });
  } finally { globalThis.fetch = real; }
}

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
    // Como el proveedor real: la cursiva y la ligera primero. El job tiene que bajar la normal 400 y la negrita 700.
    if (u === 'https://fonts.test/css') return resp(['italic 400 f-i', 'normal 300 f-l', 'normal 400 f', 'normal 700 f-b']
      .map((x) => x.split(' ')).map(([st, w, f]) => `@font-face { font-style: ${st}; font-weight: ${w}; src: url(https://fonts.test/${f}.ttf) format("truetype"); }`).join('\n'));
    if (u === 'https://fonts.test/f.ttf') return resp(readFileSync(join(DEJAVU, 'DejaVuSans.ttf')));
    if (u === 'https://fonts.test/f-b.ttf') return resp(readFileSync(join(DEJAVU, 'DejaVuSans-Bold.ttf')));
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
    caso('job text_layers: baja la cara normal 400 y la negrita real 700, nunca la cursiva ni la ligera que el CSS lista antes', () => {
      const fuentes = [...new Set(llamadas.filter((l) => typeof l === 'string' && /\.ttf$/.test(l)))].sort();
      assert.deepEqual(fuentes, ['GET https://fonts.test/f-b.ttf', 'GET https://fonts.test/f.ttf']);
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
  for (const p of [...PRESETS, ...F2].filter((r) => PEOR_CASO[r.layer])) {
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
