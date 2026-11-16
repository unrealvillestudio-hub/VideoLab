// BANCO DE LA F0 del motor HTML (2026-11-16). NO forma parte del job: no lo importa main.mjs ni el Dockerfile.
//
// Uso:
//   node render/bench/motor_html_f0.mjs <fixture.json> <video_limpio.mp4> <dir_salida> [--runs 2] [--presets docs/html_presets_f0.json]
//     [--swap hook=hook_char_rise,cta=cta_card_spring,key_titles.0=key_title_counter] [--ass] [--frames N]
//
// El fixture lleva lo mismo que lee prepareTextLayers en el job (text_layers, timeline, presets, paleta, tipografía,
// tokens, zona segura, lienzo, duración) más `brandId`. El banco no conoce ninguna marca: todo llega por el fixture.
// Escribe en <dir_salida>: html_run<N>.mp4, hashes_run<N>.txt, ass.mp4 (con --ass) y medidas.json.

import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { buildScene } from '../src/html/scene.mjs';
import { renderHtmlLayers } from '../src/html/capture.mjs';
import { buildTextLayers, ttfMeasure, estimateMeasure, textLayersArgs } from '../src/textlayers.mjs';
import { brandFontFile } from '../src/fonts.mjs';

const args = process.argv.slice(2);
const opt = (name, d = null) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : d; };
const flag = (name) => args.includes(`--${name}`);
const [fixturePath, input, outDir] = args;
if (!fixturePath || !input || !outDir) { console.error('uso: motor_html_f0.mjs <fixture.json> <video_limpio.mp4> <dir_salida> [opciones]'); process.exit(2); }
mkdirSync(outDir, { recursive: true });

const fx = JSON.parse(readFileSync(fixturePath, 'utf8'));
const extra = opt('presets') ? JSON.parse(readFileSync(opt('presets'), 'utf8')).rows : [];
const presets = [...fx.presets, ...extra];
const tl = structuredClone(fx.textLayers);
// --swap capa=preset: cambia el preset de una capa del pedido (sólo el banco; el pedido real no se toca).
for (const pair of (opt('swap') ?? '').split(',').filter(Boolean)) {
  const [path, key] = pair.split('=');
  const [layer, idx] = path.split('.');
  const target = idx != null ? tl[layer][Number(idx)] : tl[layer];
  if (!target) throw new Error(`--swap: no existe ${path}`);
  target.preset_key = key;
}

// Fuentes: las mismas que baja el job (fonts.mjs), con sus métricas reales.
const fontsDir = join(outDir, 'fonts');
const measures = {};
const fonts = [];
for (const t of fx.typography) {
  const { file } = await brandFontFile({ cssImport: t.css_import, family: t.font_family, dir: fontsDir });
  const bytes = readFileSync(file);
  measures[t.font_family] = ttfMeasure(bytes);
  fonts.push({ family: t.font_family, bytes, format: file.endsWith('.otf') ? 'opentype' : 'truetype' });
}
const measure = (text, px, o) => (measures[o?.family] ?? estimateMeasure)(text, px, o);
const base = { textLayers: tl, timeline: fx.timeline, presets, brandId: fx.brandId, palette: fx.palette, typography: fx.typography,
  tokens: fx.tokens, safeZone: fx.safeZone, canvas: fx.canvas, durationMs: fx.durationMs, measure };

const tScene = performance.now();
const scene = buildScene({ ...base, fps: 30 });
const sceneMs = Math.round(performance.now() - tScene);
const usedFonts = fonts.filter((f) => scene.families.includes(f.family));
writeFileSync(join(outDir, 'scene.json'), JSON.stringify({ ...scene, layout: scene.layout }, null, 1));

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const runs = Number(opt('runs', 2));
const frames = opt('frames') ? Number(opt('frames')) : null;
const result = { fixture: resolve(fixturePath), input: resolve(input), cpus: (await import('node:os')).cpus().length, scene_ms: sceneMs,
  layout: scene.layout, warnings: scene.warnings, runs: [] };
for (let r = 1; r <= runs; r++) {
  const out = join(outDir, `html_run${r}.mp4`);
  const res = await renderHtmlLayers({ scene, fonts: usedFonts, input, out, chromium, frames });
  writeFileSync(join(outDir, `hashes_run${r}.txt`), res.hashes.join('\n') + '\n');
  const mp4sha = execFileSync('sha256sum', [out]).toString().split(' ')[0];
  result.runs.push({ run: r, ...res.timings, frames: res.frames, captured: res.captured, frames_digest: res.digest, mp4_sha256: mp4sha,
    mp4_bytes: statSync(out).size, fit: r === 1 ? res.fit : undefined, spans: r === 1 ? res.spans : undefined });
  console.log(`run ${r}: total ${res.timings.total_ms} ms · captura ${res.timings.capture_ms} ms · ${res.captured}/${res.frames} fotogramas · huella ${res.digest.slice(0, 16)} · mp4 ${mp4sha.slice(0, 16)}`);
}
if (runs >= 2) {
  const a = readFileSync(join(outDir, 'hashes_run1.txt'), 'utf8').split('\n'), b = readFileSync(join(outDir, 'hashes_run2.txt'), 'utf8').split('\n');
  result.frames_identical = a.length === b.length && a.every((h, i) => h === b[i]);
  result.frames_different = a.filter((h, i) => h !== b[i]).length;
  result.mp4_identical = result.runs[0].mp4_sha256 === result.runs[1].mp4_sha256;
}

// Referencia: el dibujo actual (ASS + libass) con el MISMO pedido, medido igual.
if (flag('ass')) {
  const plan = buildTextLayers(base);
  const assFile = join(outDir, 'text_layers.ass');
  writeFileSync(assFile, plan.ass);
  const t = performance.now();
  execFileSync('ffmpeg', ['-loglevel', 'error', ...textLayersArgs({ input, ass: assFile, fontsDir, filters: plan.filters, out: join(outDir, 'ass.mp4') })]);
  result.ass = { total_ms: Math.round(performance.now() - t), mp4_bytes: statSync(join(outDir, 'ass.mp4')).size };
  console.log(`ass: ${result.ass.total_ms} ms`);
}
writeFileSync(join(outDir, 'medidas.json'), JSON.stringify(result, null, 1));
console.log(JSON.stringify({ frames_identical: result.frames_identical, mp4_identical: result.mp4_identical, warnings: result.warnings }));
