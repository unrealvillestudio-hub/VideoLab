// CONTRATO v1.4.0 DE LAS CAPAS DE TEXTO (F1 del motor HTML, 2026-11-16).
//
// Qué se comprueba:
//  - los estilos en línea usan el vocabulario y la semántica de ImageLab (`text_style.<bloque>`, medido en ImageLab
//    api/compose.ts 78c3fb1): tramos LITERALES, primera aparición sin solaparse, hasta 3 de ≤ 60 caracteres; cursiva y
//    negrita INVIERTEN; color sólo cambia el color; la negrita que no existe no se simula y se avisa;
//  - `align` left | center | right; el rol siempre a la izquierda;
//  - la franja con `identity_role` (y `strip_role` como alias) y los modos none | edge_left | edge_right | edge_bottom;
//  - `spec.engine` elige el motor; el job dibuja con HTML, y si el HTML falla, con ASS y lo dice;
//  - la etiqueta del dibujo (`text_layout.engine`, `capture`, `presets`) sale en la salida.
//
// Ejecutar:  node tests/text_v14_test.mjs     (sin red; el job con navegador se salta si no hay chrome-headless-shell)

import { readFileSync, mkdtempSync, existsSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import * as T from '../render/src/textlayers.mjs';
import * as F from '../render/src/fonts.mjs';
import { buildScene } from '../render/src/html/scene.mjs';
import { findHeadlessShell } from '../render/src/html/cdp.mjs';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));
const SEED = JSON.parse(readFileSync(join(RAIZ, 'docs/text_presets_seed.json'), 'utf8')).rows;
const F0 = JSON.parse(readFileSync(join(RAIZ, 'docs/html_presets_f0.json'), 'utf8')).rows;
const PRESETS = [...SEED, ...F0];

let fallos = 0;
const pendientes = [];
function caso(nombre, fn) {
  const fin = (e) => { if (e) { fallos++; console.error(`  MAL ${nombre}\n      ${e.message}`); } else console.log(`  ok  ${nombre}`); };
  try { const r = fn(); if (r && typeof r.then === 'function') pendientes.push(r.then(() => fin(), fin)); else fin(); } catch (e) { fin(e); }
}

// Marca sintética: roles de paleta y tipografía inventados (el código no puede conocerlos).
const BRAND = 'marca_sintetica_c';
const CANVAS = { width: 1080, height: 1920 };
const SAFE = { top: 14, left: 6, right: 22, bottom: 37 };
const PALETTE = [{ role: 'hueso', hex: '#F2F0EC' }, { role: 'carbon', hex: '#111111' }, { role: 'brasa', hex: '#FF8800' }, { role: 'mar', hex: '#00AACC' }, { role: 'oliva', hex: '#667744' }];
const TOKENS = { palette: { headline: 'hueso', subheadline: 'hueso', headline_emphasis: 'brasa' },
  layout: { scrim: { palette: 'carbon' }, rule: { palette: 'mar' } },
  identity: { mode: 'edge_left', palette: 'mar', width_pct: 1.8, full_bleed: true } };
const TYPO = [{ role: 'display', font_family: 'Familia Display' }, { role: 'body', font_family: 'Familia Texto' }];
const WORDS = 'Hoy les cuento por qué el uno por ciento de los clientes cambia todo el negocio en semanas'.split(' ')
  .map((text, i) => ({ text, start_ms: i * 300, end_ms: i * 300 + 260, person_id: i < 9 ? 'p1' : 'p2' }));
const TL = () => ({
  hook: { text: 'El 1 % que cambia todo el negocio', preset_key: 'hook_mask_wipe', start_ms: 0, end_ms: 2600, emphasis: ['negocio'] },
  roles: [{ person_id: 'p1', text: 'Persona Uno — Directora — Estudio', show: true, at_ms: 400, dur_ms: 3800, preset_key: 'role_label_minimal' }],
  captions: { enabled: true, preset_key: 'caption_karaoke_accent', accent_role: 'brasa' },
  key_titles: [{ text: 'Una frase clave', at_ms: 2800, dur_ms: 1400, preset_key: 'key_title_rule' }],
  cta: { text: 'Reenvíalo a quien lleva las cuentas', at_ms: 4400, preset_key: 'cta_card_rise' },
  identity: { strip: true, strip_role: 'mar' },
});
const args = (over = {}) => ({ textLayers: TL(), timeline: { words: WORDS }, presets: PRESETS, brandId: BRAND, palette: PALETTE,
  typography: TYPO, tokens: TOKENS, safeZone: SAFE, canvas: CANVAS, durationMs: 6000, ...over });
const bad = (fn, re) => assert.throws(fn, (e) => e.label === 'VIDEOLAB_BAD_REQUEST' && re.test(e.message));

console.log('capas de texto — contrato v1.4.0');

caso('tramos literales: primera aparición sin solaparse, en el orden de la lista (mismo algoritmo que ImageLab)', () => {
  assert.deepEqual(T.literalRanges('la cuota y la cuota', ['cuota', 'cuota']).ranges, [[3, 8], [14, 19]]);
  assert.deepEqual(T.literalRanges('Su cuota cambia', ['cuota cambia', 'cuota']), { ranges: [[3, 15]], found: ['cuota cambia'], missing: ['cuota'] });
  assert.deepEqual(T.literalRanges('Su cuota', ['Cuota']).missing, ['Cuota'], 'distingue mayúsculas, como ImageLab');
});

caso('estilo por carácter: emphasis literal y, si no está literal, por palabra normalizada (como antes de v1.4.0)', () => {
  const a = T.charStyles('Su cuota, hoy', { emphasis: ['cuota'] });
  assert.deepEqual(a.flags.map((f) => (f.emphasis ? 1 : 0)).join(''), '0001111100000');
  const b = T.charStyles('Su CUOTA, hoy', { emphasis: ['cuota'] });
  assert.ok(b.flags.slice(3, 9).every((f) => f.emphasis), 'por palabra normalizada: «CUOTA,» entera');
  assert.deepEqual(b.missing, []);
  const c = T.charStyles('Su cuota', { italic_spans: ['nada'], bold_spans: ['Su'], color_spans: ['uota'] });
  assert.deepEqual(c.missing, [{ field: 'italic_spans', term: 'nada' }]);
  assert.ok(c.flags[0].bold && c.flags[1].bold && !c.flags[2].bold);
  assert.ok(c.flags[4].color && !c.flags[3].color);
});

caso('validación: límites de ImageLab (3 tramos de ≤ 60), emphasis_role con forma de rol, align sólo donde aplica', () => {
  const tl = TL();
  tl.hook.italic_spans = ['a', 'b', 'c', 'd'];
  bad(() => T.validateTextLayers(tl), /hook\.italic_spans trae 4 tramos/);
  tl.hook.italic_spans = ['x'.repeat(61)];
  bad(() => T.validateTextLayers(tl), /excede 60/);
  delete tl.hook.italic_spans; tl.hook.emphasis_role = 'Brasa Oscura';
  bad(() => T.validateTextLayers(tl), /emphasis_role debe ser el nombre de un rol/);
  delete tl.hook.emphasis_role; tl.roles[0].align = 'center';
  bad(() => T.validateTextLayers(tl), /roles\[0\]\.align no aplica/);
  delete tl.roles[0].align; tl.cta.align = 'justify';
  bad(() => T.validateTextLayers(tl), /cta\.align debe ser left \| center \| right/);
  delete tl.cta.align; tl.identity = { strip: true, identity_role: 'mar', strip_role: 'brasa' };
  bad(() => T.validateTextLayers(tl), /dicen roles distintos/);
});

caso('align: right pega el bloque al borde seguro derecho; el ASS lo dibuja con \\an9', () => {
  const tl = TL(); tl.key_titles[0].align = 'right';
  const r = T.buildTextLayers(args({ textLayers: tl }));
  const k = r.blocks.find((b) => b.layer === 'key_title');
  assert.equal(k.align, 'right');
  assert.equal(k.rect.x + k.rect.w, r.safe.x1);
  assert.ok(/\{\\an9\\pos\(/.test(r.ass.split('\n').find((l) => l.startsWith('Dialogue: 2') && l.includes('frase'))));
});

caso('estilos en el ASS: cursiva \\i1, negrita \\b1, color del resaltado con emphasis_role; vuelven al estado del bloque', () => {
  const tl = TL();
  Object.assign(tl.cta, { italic_spans: ['quien'], bold_spans: ['cuentas'], color_spans: ['Reenvíalo'], emphasis_role: 'oliva' });
  const r = T.buildTextLayers(args({ textLayers: tl, faceAvail: { 'Familia Display': { bold: true, italic: true } } }));
  const line = r.ass.split('\n').find((l) => l.includes('quien'));
  assert.ok(line.includes('{\\i1}quien{\\i0}'), line);
  assert.ok(/\{\\c&H00447766&\}Reenvíalo\{\\c&H00ECF0F2&\}/.test(line), 'color del resaltado = oliva');
  // cta_card_rise es negrita: el tramo de bold_spans la INVIERTE a regular.
  assert.ok(line.includes('{\\b0}cuentas{\\b1}'), line);
});

caso('avisos con el sentido de ImageLab: tramo no encontrado, negrita que no existe (no se simula), cursiva sintética, rol desconocido', () => {
  const tl = TL();
  Object.assign(tl.key_titles[0], { italic_spans: ['frase'], bold_spans: ['clave', 'no está'], emphasis_role: 'no_existe' });
  // key_title_rule es negrita → bold_spans pide 400 (siempre existe). Para probar la negrita ausente, un bloque regular:
  Object.assign(tl.roles[0], { bold_spans: ['Directora'] });
  const r = T.buildTextLayers(args({ textLayers: tl, faceAvail: { 'Familia Display': { bold: true, italic: false }, 'Familia Texto': { bold: false, italic: false } } }));
  const w = r.warnings.join('\n');
  assert.ok(/TEXT_SPAN_NOT_FOUND: key_titles\[0\]\.bold_spans «no está»/.test(w), w);
  assert.ok(/TEXT_ITALIC_SYNTHESIZED: key_titles\[0\]/.test(w), w);
  assert.ok(/TEXT_EMPHASIS_ROLE_UNKNOWN: key_titles\[0\]\.emphasis_role «no_existe»/.test(w), w);
  assert.ok(/TEXT_BOLD_UNAVAILABLE: roles\[0\]/.test(w), w);
  const role = r.ass.split('\n').find((l) => l.includes('Directora'));
  assert.ok(!role.includes('\\b1'), 'la negrita que no existe no se simula');
});

caso('medida conservadora: un bloque con bold_spans o italic_spans nunca mide menos que sin ellos', () => {
  const tl = TL(); tl.cta.preset_key = 'cta_pill_shimmer';
  const base = T.buildTextLayers(args({ textLayers: tl })).blocks.find((b) => b.layer === 'cta');
  tl.cta.bold_spans = ['quien lleva']; tl.cta.italic_spans = ['cuentas'];
  const con = T.buildTextLayers(args({ textLayers: tl })).blocks.find((b) => b.layer === 'cta');
  assert.ok(con.rect.w >= base.rect.w, `${con.rect.w} < ${base.rect.w}`);
});

caso('franja: identity_role manda (strip_role es alias); modos none, edge_left, edge_right y edge_bottom', () => {
  const tl = TL(); tl.identity = { strip: true, identity_role: 'oliva' };
  const safe = T.safeRect(SAFE, CANVAS);
  const slots = T.colorSlots({ tokens: TOKENS, textLayers: tl });
  const rect = (mode, full_bleed = true) => T.identityRect({ identity: tl.identity, tokens: { ...TOKENS, identity: { mode, width_pct: 1.8, full_bleed } },
    slots, palette: PALETTE, canvas: CANVAS, safe });
  assert.deepEqual(rect('edge_left'), { x: 0, y: 0, w: 19, h: 1920, color: '#667744', mode: 'edge_left' });
  assert.equal(rect('edge_right').x, 1080 - 19);
  assert.deepEqual(rect('edge_bottom'), { x: 0, y: 1920 - 19, w: 1080, h: 19, color: '#667744', mode: 'edge_bottom' });
  assert.equal(rect('none'), null);
  assert.deepEqual([rect('edge_left', false).y, rect('edge_left', false).h], [safe.y, safe.h]);
  bad(() => rect('marco'), /identity\.mode desconocido/);
  const legacy = T.colorSlots({ tokens: TOKENS, textLayers: { identity: { strip: true, strip_role: 'brasa' } } });
  assert.equal(legacy.identity, 'brasa', 'strip_role sigue valiendo como alias');
});

caso('motor por preset: engine html en un preset elige html; un motor desconocido es BAD_REQUEST', () => {
  assert.equal(T.engineOf(TL(), PRESETS, BRAND), 'ass');
  const tl = TL(); tl.hook.preset_key = 'hook_char_rise';
  assert.equal(T.engineOf(tl, PRESETS, BRAND), 'html');
  const rows = [...PRESETS, { preset_key: 'hook_raro', layer: 'hook', brand_id: null, active: true, status: 'proposed', spec: { engine: 'flash' } }];
  tl.hook.preset_key = 'hook_raro';
  bad(() => T.engineOf(tl, rows, BRAND), /motor desconocido: flash/);
});

caso('caras que pide el pedido: bold_spans sobre texto regular pide la negrita real; italic_spans, la cursiva', () => {
  const tl = TL(); tl.roles[0].bold_spans = ['Uno']; tl.roles[0].italic_spans = ['Estudio'];
  const need = T.fontFacesNeeded(tl, PRESETS, BRAND);
  assert.deepEqual(need.find((n) => n.role === 'body'), { role: 'body', bold: true, italic: true });
  const css = (st, w, id) => `@font-face { font-style: ${st}; font-weight: ${w}; src: url(https://f.invalid/${id}.ttf) format("truetype"); }`;
  const faces = F.parseFontFaces([css('italic', 400, 'i4'), css('normal', 400, 'n4'), css('italic', 700, 'i7')].join('\n'));
  assert.equal(F.pickFaces(faces, { family: 'x', italic: true }).italic.url, 'https://f.invalid/i4.ttf');
  assert.equal(F.pickFaces(faces, { family: 'x' }).italic, null, 'sin italic_spans no se baja la cursiva');
});

caso('escena: las palabras llevan sus tramos (cursiva, peso, color) y la franja va en la escena, no como drawbox', () => {
  const tl = TL(); tl.hook.preset_key = 'hook_char_rise'; tl.hook.italic_spans = ['cambia']; tl.identity = { strip: true, identity_role: 'oliva' };
  const sc = buildScene(args({ textLayers: tl }));
  const words = sc.blocks.find((b) => b.layer === 'hook').lines.flatMap((l) => l.words);
  assert.deepEqual(words.find((w) => w.text === 'cambia').runs, [{ text: 'cambia', italic: true }]);
  assert.deepEqual(words.find((w) => w.text === 'negocio').runs, [{ text: 'negocio', color: 'emphasis' }]);
  assert.deepEqual(sc.strip, { x: 0, y: 0, w: 19, h: 1920, color: '#667744', mode: 'edge_left' });
  assert.deepEqual(sc.filters, []);
});

caso('posición por tramo de toma: sin sitio para todo el tramo pero sí en cada plano, el bloque cambia de sitio en el corte', () => {
  // Plano A (0–1000 ms): una cara tapa la mitad de arriba de la zona segura; plano B (1000–2000 ms), la de abajo.
  // Ningún sitio sirve para todo el tramo; en cada plano, sí.
  const faces = [{ box: { x: 0, y: 14, w: 100, h: 26 }, start_ms: 0, end_ms: 1000 }, { box: { x: 0, y: 40, w: 100, h: 23 }, start_ms: 1000, end_ms: 2000 }];
  const tl = { key_titles: [{ text: 'Una frase clave', at_ms: 500, dur_ms: 1000, preset_key: 'key_title_rule' }] };
  const r = T.buildTextLayers(args({ textLayers: tl, timeline: { faces }, durationMs: 2000 }));
  const k = r.blocks.find((b) => b.layer === 'key_title');
  assert.equal(k.segments?.length, 2, JSON.stringify(k) + r.warnings.join(' | '));
  assert.deepEqual(k.segments.map((g) => [g.start_ms, g.end_ms]), [[500, 1000], [1000, 1500]]);
  const facePx = T.facesPx({ faces }, CANVAS);
  const hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  assert.ok(!hit(k.segments[0].rect, facePx[0]) && !hit(k.segments[1].rect, facePx[1]), 'cada tramo libra la cara de su plano');
  assert.deepEqual(k.rect, k.segments[0].rect);
  assert.ok(!r.warnings.some((w) => w.startsWith('TEXT_OVER_FACE')), r.warnings.join(' | '));
  // ASS: un evento de texto por tramo; la entrada sólo en el primero.
  const ev = r.ass.split('\n').filter((l) => l.startsWith('Dialogue: 2') && l.includes('frase'));
  assert.equal(ev.length, 2);
  assert.ok(ev[0].includes('\\fad(350,0)') && ev[1].includes('\\fad(0,250)'), ev.join('\n'));
  // Escena: el mismo bloque con sus tramos; el runtime lo cambia de sitio en el corte.
  const sc = buildScene(args({ textLayers: tl, timeline: { faces }, durationMs: 2000 }));
  const b = sc.blocks[0];
  assert.deepEqual(b.segments, k.segments);
});

// ── El job con el motor HTML (y su respaldo), con Supabase, Storage y fuentes dobles ──────────────────────────────────
const DEJAVU = '/usr/share/fonts/truetype/dejavu';
const hayLibass = spawnSync('ffmpeg', ['-hide_banner', '-filters'], { encoding: 'utf8' }).stdout?.includes(' subtitles ');
const SHELL = findHeadlessShell();
if (hayLibass && SHELL && existsSync(join(DEJAVU, 'DejaVuSans.ttf'))) {
  const { renderJob } = await import('../render/src/main.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'videolab-v14-'));
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0x405060:s=1080x1920:r=30:d=2', '-f', 'lavfi', '-i', 'sine=f=300:d=2',
    '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', join(dir, 'base.mp4')]);
  const JOB = '00000000-0000-0000-0000-00000000f14a';
  const tl = TL(); tl.key_titles = []; tl.cta = null; tl.roles[0].dur_ms = 1400; tl.hook.preset_key = 'hook_char_rise';
  tl.hook.italic_spans = ['cambia']; tl.identity = { strip: true, identity_role: 'mar' };
  const payload = { brandId: BRAND, pieceId: '00000000-0000-0000-0000-0000000000bb',
    params: { mode: 'text_layers', platform: 'meta_fb', format: 'reel', safe_zone_canal: 'CANAL_X' },
    previousOutputs: { base_video: { url: 'https://media.test/clean.mp4' }, timeline: { words: WORDS.slice(0, 6) }, text_layers: tl } };
  const resp = (body, status = 200) => ({ ok: status < 300, status, json: async () => body, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    arrayBuffer: async () => { const b = Buffer.isBuffer(body) ? body : Buffer.from(String(body)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); } });
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url); const m = init.method ?? 'GET';
    if (u.includes('/rest/v1/lab_jobs') && m === 'GET') return resp([{ id: JOB, brand_id: BRAND, payload }]);
    if (u.includes('/rest/v1/lab_jobs') && m === 'PATCH') return resp('', 204);
    if (u.includes('platform_format_profiles')) return resp([{ platform: 'meta_fb', format: 'reel', canvas_width: 1080, canvas_height: 1920, video_text_canal: null }]);
    if (u.includes('/rpc/ops_resolve_rate')) return resp([{ rate_usd: 0.000044, rate_id: 'tarifa-1', effective_from: '2026-01-01' }]);
    if (u.includes('/rpc/ops_log_generation')) return resp('asiento-1');
    if (u === 'https://media.test/clean.mp4') return resp(readFileSync(join(dir, 'base.mp4')));
    if (u.includes('imagelab_overlay_tokens') && u.includes('canal=eq.CANAL_X')) return resp([{ brand_id: null, tokens: { layout: { safe_zone_pct: SAFE } } }]);
    if (u.includes('imagelab_overlay_tokens') && u.includes('canal=is.null')) return resp([{ tokens: TOKENS }]);
    if (u.includes('videolab_text_presets')) return resp(PRESETS);
    if (u.includes('brand_palette')) return resp(PALETTE);
    if (u.includes('brand_typography')) return resp([{ role: 'display', font_family: 'DejaVu Sans', css_import: 'https://fonts.test/css' }, { role: 'body', font_family: 'DejaVu Sans', css_import: 'https://fonts.test/css' }]);
    if (u === 'https://fonts.test/css') return resp(['italic 400 f-i', 'normal 400 f', 'normal 700 f-b']
      .map((x) => x.split(' ')).map(([st, w, f]) => `@font-face { font-style: ${st}; font-weight: ${w}; src: url(https://fonts.test/${f}.ttf) format("truetype"); }`).join('\n'));
    if (u === 'https://fonts.test/f.ttf') return resp(readFileSync(join(DEJAVU, 'DejaVuSans.ttf')));
    if (u === 'https://fonts.test/f-b.ttf') return resp(readFileSync(join(DEJAVU, 'DejaVuSans-Bold.ttf')));
    // La cursiva: cualquier TTF válido sirve (el sistema puede no traer la oblicua de DejaVu).
    if (u === 'https://fonts.test/f-i.ttf') return resp(readFileSync(join(DEJAVU, 'DejaVuSans.ttf')));
    if (u.includes('/storage/v1/object/')) { writeFileSync(join(dir, u.split('/').pop()), Buffer.from(init.body)); return resp({ Key: 'ok' }); }
    throw new Error(`fetch inesperado ${m} ${u}`);
  };
  const env = { SUPABASE_URL: 'https://sb.test', SUPABASE_SERVICE_ROLE_KEY: 'llave-de-prueba' };
  try {
    const out = await renderJob(JOB, env);
    caso('job con un preset html: dibuja con el motor HTML (beginFrame) y la salida lleva la etiqueta del dibujo', () => {
      assert.equal(out.text_layout.engine, 'html', JSON.stringify(out.text_layout.warnings));
      assert.equal(out.text_layout.capture, 'beginframe', out.text_layout.warnings.join(' | '));
      assert.deepEqual(out.text_layout.presets, ['hook_char_rise', 'role_label_minimal', 'caption_karaoke_accent']);
      assert.ok(existsSync(join(dir, `${JOB}.mp4`)));
    });
    // Respaldo: sin navegador, el mismo pedido sale con ASS y lo dice.
    const prev = process.env.HEADLESS_SHELL;
    process.env.HEADLESS_SHELL = join(dir, 'no-existe');
    try {
      const out2 = await renderJob(JOB, env);
      caso('si el motor HTML falla, la pieza sale con ASS y text_layout lo dice (TEXT_ENGINE_FALLBACK)', () => {
        assert.equal(out2.text_layout.engine, 'ass');
        assert.equal(out2.text_layout.capture, null);
        assert.ok(out2.text_layout.warnings.some((w) => w.startsWith('TEXT_ENGINE_FALLBACK')), out2.text_layout.warnings.join(' | '));
      });
    } finally { if (prev == null) delete process.env.HEADLESS_SHELL; else process.env.HEADLESS_SHELL = prev; }
  } finally { globalThis.fetch = fetchOriginal; }
} else console.log('  --  job con el motor HTML: se salta (sin libass, sin chrome-headless-shell o sin DejaVu)');

// F2 (2026-11-17) — subtítulos: el grupo se queda hasta el siguiente si la pausa es corta (hold_gap_ms) y se avisa si pasa
// el tope de lectura (max_cps). Una sola fuente de tiempos para ASS y HTML.
caso('subtítulos: hold_gap_ms cubre las pausas cortas, no las largas; max_cps cuenta y avisa; sin los campos, como antes', () => {
  const w = (text, s, e) => ({ text, start_ms: s, end_ms: e });
  const g = [[w('Hola', 0, 300), w('mundo', 300, 600)], [w('otra', 900, 1200), w('vez', 1200, 1500)], [w('fin', 3000, 3300)]];
  assert.deepEqual(T.captionTimes(g, {}, 5000).times.map((t) => t.end_ms), [600, 1500, 3300]);
  assert.deepEqual(T.captionTimes(g, { hold_gap_ms: 400 }, 5000).times.map((t) => t.end_ms), [900, 1500, 3300]);
  const rapido = [[w('Palabras', 0, 100), w('muy', 100, 200), w('rápidas', 200, 300)]];
  assert.equal(T.captionTimes(rapido, { max_cps: 17 }, 5000).fast, 1);
  assert.equal(T.captionTimes(rapido, {}, 5000).fast, 0);
});
{
  const F2 = JSON.parse(readFileSync(join(RAIZ, 'docs/html_presets_f2.json'), 'utf8')).rows;
  caso('subtítulos: el aviso TEXT_CAPTION_FAST sale en text_layout, y ASS y HTML usan los mismos tiempos de grupo', () => {
    const tl = { captions: { enabled: true, preset_key: 'caption_html_word_pop', accent_role: 'brasa' } };
    const a = args({ textLayers: tl, presets: [...PRESETS, ...F2] });
    const words = [];
    'una frase que se dice muy pero muy rápido para probar el tope de lectura'.split(' ').forEach((t, i) => words.push({ text: t, start_ms: i * 90, end_ms: i * 90 + 80, person_id: 'p1' }));
    a.timeline = { words };
    const plan = T.buildTextLayers(a);
    assert.ok(plan.warnings.some((x) => x.startsWith('TEXT_CAPTION_FAST')), plan.warnings.join(' | '));
    const sc = buildScene(a);
    const { times } = T.captionTimes(T.groupCaptionWords(T.timelineWords(a.timeline), { min: 3, max: 4, maxGapMs: 700 }), F2.find((r) => r.preset_key === 'caption_html_word_pop').spec, a.durationMs);
    assert.deepEqual(sc.captions.groups.map((x) => [x.start_ms, x.end_ms]), times.map((x) => [x.start_ms, x.end_ms]));
  });
}

// VISTA PREVIA (§4 ter.5): el módulo servido es el mismo archivo del motor, sólo esa lista cerrada y sólo la versión vigente.
{
  const { engineFile } = await import('../api/engine.js');
  const { validateSceneRequest } = await import('../api/text-scene.js');
  const { RUNTIME_VERSION } = await import('../render/src/html/runtime.mjs');
  caso('GET /engine/<versión>/<módulo>: sirve el archivo tal cual; otra versión u otro archivo → 404', () => {
    const ok = engineFile(RUNTIME_VERSION, 'runtime.mjs');
    assert.equal(ok.status, 200);
    assert.equal(ok.body, readFileSync(new URL('../render/src/html/runtime.mjs', import.meta.url), 'utf8'));
    assert.equal(engineFile(RUNTIME_VERSION, 'keyframes.mjs').status, 200);
    assert.equal(engineFile('0.0.0', 'runtime.mjs').status, 404);
    for (const f of ['page.mjs', 'capture.mjs', '../textlayers.mjs', 'constructor', '__proto__']) assert.equal(engineFile(RUNTIME_VERSION, f).status, 404, f);
  });
  caso('POST /api/text-scene valida la forma del pedido antes de leer nada', () => {
    const tl = { hook: { text: 'Una frase', preset_key: 'hook_char_rise', start_ms: 0, end_ms: 1000 } };
    const base = { brandId: 'marca-prueba', params: { platform: 'instagram', format: 'reel' }, previousOutputs: { text_layers: tl, timeline: null }, duration_ms: 3000 };
    const r = validateSceneRequest(base);
    assert.equal(r.durationMs, 3000);
    assert.equal(r.brandId, 'marca-prueba');
    const malo = (b, m) => assert.throws(() => validateSceneRequest(b), (e) => e.label === 'VIDEOLAB_BAD_REQUEST' || /text_layers/.test(e.message), m);
    malo(null, 'cuerpo nulo');
    malo({ ...base, brandId: '' }, 'sin marca');
    malo({ ...base, params: { platform: 'instagram', format: 'story' } }, 'formato no reel');
    malo({ ...base, duration_ms: 0 }, 'duración 0');
  });
}

// ROTACIÓN (F2): VideoLab sugiere el estilo usado hace más tiempo, por marca y capa; quien genera lo congela.
{
  const R = await import('../render/src/textrotation.mjs');
  const { historyOf } = await import('../api/text-styles.js');
  const F2 = JSON.parse(readFileSync(join(RAIZ, 'docs/html_presets_f2.json'), 'utf8')).rows;
  const val = (rows) => rows.map((r) => ({ ...r, status: 'validated_by_judgment' }));
  const rows = [...SEED, ...val(F0), ...val(F2)];
  caso('rotación: sin historial, el primero del grupo validado html por sort; nunca un estilo ASS si hay html validados', () => {
    const s = R.suggestStyles(rows, BRAND, []);
    for (const l of R.ROTATION_LAYERS) {
      assert.ok(s[l], l);
      assert.equal(s[l].pool.length, 5, `${l}: 5 estilos html por capa`);
      assert.ok(s[l].pool.every((k) => rows.find((r) => r.preset_key === k).spec.engine === 'html'), l);
    }
  });
  caso('rotación: recorre los 5 sin repetir y vuelve a empezar por el usado hace más tiempo', () => {
    const hist = [];
    const vistos = [];
    for (let i = 0; i < 7; i++) {
      const s = R.suggestStyles(rows, BRAND, hist);
      vistos.push(s.hook.preset_key);
      hist.unshift([s.hook.preset_key, s.cta.preset_key]);
    }
    assert.equal(new Set(vistos.slice(0, 5)).size, 5, vistos.join(' '));
    assert.equal(vistos[5], vistos[0]);
    assert.equal(vistos[6], vistos[1]);
  });
  caso('rotación: la fila de la marca manda; un estilo retirado o inactivo no entra; proposed sólo si no hay validados', () => {
    const hook = rows.filter((r) => r.layer === 'hook' && r.spec.engine === 'html');
    const retirado = { ...hook[0], brand_id: BRAND, status: 'retired' };
    const s = R.suggestStyles([...rows, retirado], BRAND, []);
    assert.ok(!s.hook.pool.includes(hook[0].preset_key));
    const soloPropuestos = [...SEED, ...F0, ...F2];
    assert.equal(R.suggestStyles(soloPropuestos, BRAND, []).hook.pool.length, 5);
    assert.ok(!R.suggestStyles([...SEED], BRAND, []).hook.pool.some((k) => k.includes('html')));
  });
  caso('rotación: el historial sale de text_layout.presets de cada job; filas raras no rompen', () => {
    assert.deepEqual(historyOf([{ presets: ['a', 'b'] }, { presets: null }, {}, { presets: ['c', 3] }]), [['a', 'b'], [], [], ['c']]);
  });
}

await Promise.all(pendientes);
if (fallos) { console.error(`\n${fallos} caso(s) MAL`); process.exit(1); }
console.log('\ntext_v14: todo en verde');
