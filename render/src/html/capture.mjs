// EL CAPTURADOR DETERMINISTA del motor HTML de VideoLab (F0, 2026-11-16; F1: CDP crudo con beginFrame, cdp.mjs).
//
// chrome-headless-shell, lienzo del pedido, escala 1, fondo transparente. Para cada fotograma i se fija el
// tiempo t = i / fps con `window.__vl.seek(t)` y se captura un PNG con alfa por CDP. El reloj real no interviene nunca:
// el tiempo lo pone el capturador. Fuera de los tramos con texto no se captura cada fotograma: se repite el fotograma de
// reposo (la franja de identidad, si la hay, capturada una vez de la página; si no, un PNG transparente).
// Los PNG van por una tubería a ffmpeg, que los monta sobre el video limpio (la franja de identidad ya va en la página) y codifica con la
// especificación de salida del contrato (§5). Lo aprendido del núcleo de HyperFrames (Apache-2.0, ver docs/MOTOR_HTML.md):
// PNG con `optimizeForSpeed: false` (el atajo rápido aplasta el alfa) y el fondo transparente fijado UNA vez por sesión.

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { scenePage } from './page.mjs';
import { textSpans } from './scene.mjs';
import { openPage, findHeadlessShell } from './cdp.mjs';
import { RenderError } from '../plan.mjs';
import { X264 } from '../x264.mjs';

/** PNG RGBA totalmente transparente de W×H (sin navegador). PURO. */
export function blankPng(W, H) {
  return pngOf(W, H, 6, Buffer.alloc(W * H * 4));
}

/**
 * PNG de 8 bits a partir de los píxeles crudos. `colorType`: 0 (gris, 1 byte por píxel) o 6 (RGBA, 4). Sin filtros
 * (filtro 0 en cada fila): mismo píxel → mismo archivo, byte a byte. PURO.
 */
export function pngOf(W, H, colorType, pixels) {
  const bpp = colorType === 0 ? 1 : 4;
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = colorType; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((W * bpp + 1) * H);
  for (let y = 0; y < H; y++) Buffer.from(pixels.buffer, pixels.byteOffset + y * W * bpp, W * bpp).copy(raw, y * (W * bpp + 1) + 1);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/**
 * Argumentos de ffmpeg: video limpio + PNG por la entrada estándar → MP4 de la especificación (§5). PURO.
 * `x264`: hilos fijos y juego de instrucciones fijo (render/src/x264.mjs). Con otro número de hilos el MP4 sale distinto
 * byte a byte aunque los fotogramas sean idénticos (medido en la F0: 4 frente a 2 CPU); con AVX-512 también (medido en
 * el job real de la F1). Así, el mismo pedido da el mismo archivo en cualquier máquina.
 */
export function overlayArgs({ input, fps, filters = [], out, x264 = X264, behind = [], size = null }) {
  const post = [...filters, 'format=yuv420p'].join(',');
  // Texto detrás de las personas: `behind` = [{ dir, start_s }], una secuencia por tramo con bloques detrás. Cada tramo trae
  // el texto de detrás (b_%05d.png, RGBA) y la máscara de la persona (m_%05d.png, gris, blanco = persona), y entra en su
  // segundo con -itsoffset. Su alfa se multiplica por (255 − máscara), en enteros, y va ENTRE el video y el texto de
  // delante. Sin tramos, el grafo de siempre.
  const extra = [];
  let graph = '';
  let cur = '[0:v]';
  behind.forEach((sq, k) => {
    const bi = 2 + 2 * k, mi = 3 + 2 * k;
    extra.push('-itsoffset', String(sq.start_s), '-framerate', String(fps), '-i', join(sq.dir, 'b_%05d.png'),
      '-itsoffset', String(sq.start_s), '-framerate', String(fps), '-i', join(sq.dir, 'm_%05d.png'));
    graph += `[${bi}:v]format=rgba,split=2[b${k}][bb${k}];[b${k}]alphaextract[ba${k}];` +
      `[${mi}:v]scale=${size.w}:${size.h}:flags=bicubic,format=gray,negate[inv${k}];[ba${k}][inv${k}]blend=all_mode=multiply[na${k}];` +
      `[bb${k}][na${k}]alphamerge[bm${k}];${cur}[bm${k}]overlay=0:0:format=auto:eof_action=pass[c${k}];`;
    cur = `[c${k}]`;
  });
  graph += `[1:v]format=rgba[o];${cur}[o]overlay=0:0:format=auto:eof_action=pass[m];[m]${post}[v]`;
  return ['-y', '-loglevel', 'error', '-i', input, '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'png', '-i', 'pipe:0', ...extra,
    '-filter_complex', graph,
    '-map', '[v]', '-map', '0:a:0?', '-c:v', 'libx264', ...x264, '-pix_fmt', 'yuv420p', '-r', String(fps),
    '-c:a', 'aac', '-ar', '48000', '-ac', '2', '-b:a', '160k', '-movflags', '+faststart', out];
}

/**
 * Renderiza la escena sobre `input` y escribe `out`. `fonts` = [{ family, weight?, style?, bytes, format }].
 * `mode`: 'beginframe' (por defecto) o 'screenshot'. Si beginFrame no arranca (otro binario u otra versión), se
 * repite con 'screenshot' y se avisa (`warnings`): el píxel es el mismo (R1.1), así que el video no cambia.
 * `browserPath`: chrome-headless-shell (por defecto `findHeadlessShell()`). `workDir`: donde se escribe la página.
 * Devuelve tiempos, el modo usado, avisos y la huella de cada fotograma (sha256 del PNG).
 */
export async function renderHtmlLayers({ scene, fonts, input, out, browserPath = findHeadlessShell(), mode = 'beginframe', workDir,
  frames = null, onFrame = null, encode = true, masks = null, maskNote = null }) {
  const t0 = performance.now();
  if (!browserPath) throw new RenderError('VIDEOLAB_PROVIDER_FAILED', 'no hay chrome-headless-shell (HEADLESS_SHELL o una instalación de Playwright)');
  const { width: W, height: H } = scene.canvas;
  // Texto detrás de las personas: con algún bloque con `depth`, ese texto va en su propia capa (runtime.mjs).
  const regions = scene.blocks.some((b) => b.depth);
  const fps = scene.fps;
  const total = frames ?? Math.round((scene.durationMs / 1000) * fps);
  const spans = textSpans(scene);
  const inSpan = (t) => spans.some(([a, b]) => t >= a && t < b);
  const dir = workDir ?? mkdtempSync(join(tmpdir(), 'vl-html-'));
  const pageFile = join(dir, 'text_layers.html');
  writeFileSync(pageFile, scenePage(scene, fonts));
  const timings = { open_ms: 0, capture_ms: 0, encode_wait_ms: 0, total_ms: 0 };
  const warnings = [];
  const hashes = [];
  const frameMs = [];
  let captured = 0;
  let ff = null, ffDone = null, ffErr = '';
  let page = null;
  try {
    const open = (m) => openPage({ browserPath, url: pathToFileURL(pageFile).href, width: W, height: H, mode: m, fps });
    try { page = await open(mode); } catch (e) {
      if (mode !== 'beginframe') throw e;
      warnings.push(`TEXT_CAPTURE_FALLBACK: beginFrame no disponible (${String(e.message).slice(0, 160)}); se captura con captureScreenshot (mismo píxel)`);
      page = await open('screenshot');
    }
    if (!page.fonts.every(Boolean)) throw new RenderError('VIDEOLAB_PROVIDER_FAILED', `fuentes sin cargar en la página: ${JSON.stringify(scene.families)} → ${JSON.stringify(page.fonts)}`);
    const fit = await page.evaluate('window.__vl.check()');
    timings.open_ms = Math.round(performance.now() - t0);

    // Texto detrás: control de legibilidad ANTES de capturar. Sin máscaras (el recorte falló), todo va delante.
    let depth = null, behind = [];
    const behindHashes = [];
    if (regions) {
      await page.evaluate("window.__vl.layer('all')");
      depth = await depthGuard({ scene, page, masks, fps, W, H, warnings, note: maskNote });
      // Primero, sólo la capa de detrás en sus tramos, con su máscara, a disco. Después, la de delante, como siempre.
      await page.evaluate("window.__vl.layer('behind')");
      const tb = performance.now();
      behind = await captureBehind({ scene, page, masks, fps, total, dir, report: depth.report, hashes: behindHashes });
      timings.behind_ms = Math.round(performance.now() - tb);
      await page.evaluate("window.__vl.layer('front')");
    }

    if (encode) {
      ff = spawn('ffmpeg', overlayArgs({ input, fps, filters: scene.filters, out, behind, size: { w: W, h: H } }), { stdio: ['pipe', 'ignore', 'pipe'] });
      ff.stderr.on('data', (d) => { ffErr += d; });
      ffDone = new Promise((res, rej) => ff.on('close', (c) => (c === 0 ? res() : rej(new Error(`ffmpeg ${c}: ${ffErr.slice(-800)}`)))));
    }
    const write = (buf) => new Promise((res, rej) => { if (!ff) return res(); ff.stdin.write(buf, (e) => (e ? rej(e) : res())); });
    // Fotograma «de reposo» (fuera de los tramos con texto): lo que la página dibuja sin ningún bloque ni subtítulo, es
    // decir, la franja de identidad (o nada). Se captura UNA vez desde la página, no se fabrica: antes era un PNG
    // transparente, y desde que la franja se dibuja en la página (F1) desaparecía en cada pausa entre subtítulos
    // (medido 2026-11-17 en el job real: 55 fotogramas sin franja). Sin franja, es el PNG transparente de siempre.
    let blank, blankHash;
    if (scene.strip) {
      await page.evaluate('window.__vl.seek(-1)');
      blank = await page.frame(true);
    } else blank = blankPng(W, H);
    blankHash = createHash('sha256').update(blank).digest('hex');
    const tc = performance.now();
    for (let i = 0; i < total; i++) {
      const t = (i * 1000) / fps;
      let png, h;
      if (inSpan(t)) {
        const tf = performance.now();
        await page.evaluate(`window.__vl.seek(${t})`);
        png = await page.frame(true);
        h = createHash('sha256').update(png).digest('hex');
        captured++;
        frameMs.push([i, performance.now() - tf]);
      } else { png = blank; h = blankHash; }
      hashes.push(h);
      if (onFrame) await onFrame(i, png);
      await write(png);
    }
    timings.capture_ms = Math.round(performance.now() - tc);
    const te = performance.now();
    if (ff) { ff.stdin.end(); await ffDone; }
    timings.encode_wait_ms = Math.round(performance.now() - te);
    timings.total_ms = Math.round(performance.now() - t0);
    const digest = createHash('sha256').update([...hashes, ...behindHashes].join('\n')).digest('hex');
    return { frames: total, captured, mode: page.mode, warnings, timings, hashes, digest, fit, spans, frameMs, depth: depth?.report ?? null,
      depthMs: depth ? { capture_behind: timings.behind_ms ?? 0, capture_total: timings.total_ms } : null };
  } finally {
    if (ff && ff.exitCode == null) ff.kill('SIGKILL');
    if (page) await page.close();
    if (!workDir) { try { rmSync(dir, { recursive: true, force: true }); } catch { /* nada */ } }
  }
}

// ── TEXTO DETRÁS DE LAS PERSONAS (2026-11-17) ───────────────────────────────────────────────────────────────────

/**
 * Cuánto del texto tapa la persona: media, sobre los fotogramas de muestra, de la fracción del área de las palabras que
 * cae dentro de la máscara (0–1). `samples` = [{ mask: { w, h, data }, rects: [[x, y, w, h], …] }] en coordenadas del
 * lienzo W × H. PURO.
 */
export function coverOf(samples, W, H) {
  let sum = 0, n = 0;
  for (const { mask, rects } of samples) {
    if (!mask || !rects?.length) continue;
    const sx = mask.w / W, sy = mask.h / H;
    let cov = 0, area = 0;
    for (const [x, y, w, h] of rects) {
      const x0 = Math.max(0, Math.floor(x * sx)), x1 = Math.min(mask.w, Math.ceil((x + w) * sx));
      const y0 = Math.max(0, Math.floor(y * sy)), y1 = Math.min(mask.h, Math.ceil((y + h) * sy));
      let acc = 0, cnt = 0;
      for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) { acc += mask.data[yy * mask.w + xx]; cnt++; }
      if (!cnt) continue;
      const a = w * h;
      cov += (acc / cnt / 255) * a; area += a;
    }
    if (area > 0) { sum += cov / area; n++; }
  }
  return n ? Math.round((sum / n) * 1000) / 1000 : 0;
}

/**
 * Decide qué bloques con `depth` van detrás: sin máscara de sus fotogramas, o si la persona taparía más que su
 * `max_cover`, el bloque pasa delante y se avisa (TEXT_DEPTH_FALLBACK / TEXT_BEHIND_FALLBACK). La muestra es el tramo
 * central del bloque (del 20 % al 80 %), un fotograma de cada tres: la entrada y la salida no se leen.
 */
async function depthGuard({ scene, page, masks, fps, W, H, warnings, note }) {
  const report = [];
  let active = false;
  for (const b of scene.blocks.filter((x) => x.depth)) {
    const f0 = Math.ceil((b.start_ms * fps) / 1000), f1 = Math.floor(((b.end_ms - 1) * fps) / 1000);
    const lo = f0 + Math.floor((f1 - f0) * 0.2), hi = f0 + Math.ceil((f1 - f0) * 0.8);
    const missing = [];
    for (let i = f0; i <= f1; i++) if (!masks?.has(i)) missing.push(i);
    if (missing.length) {
      await page.evaluate(`window.__vl.toFront(${JSON.stringify(b.id)})`);
      warnings.push(`TEXT_DEPTH_FALLBACK: ${b.preset_key} (${b.layer}) va delante: no hay recorte de la persona${note ? ` (${note})` : ''}`);
      report.push({ id: b.id, layer: b.layer, preset_key: b.preset_key, cover: null, max_cover: b.depth.max_cover, placed: 'front' });
      continue;
    }
    const samples = [];
    for (let i = lo; i <= hi; i += 3) {
      await page.evaluate(`window.__vl.seek(${(i * 1000) / fps})`);
      const all = await page.evaluate('window.__vl.depthRects()');
      const mine = all.find((r) => r.id === b.id);
      samples.push({ mask: masks.get(i), rects: mine?.rects ?? [] });
    }
    const cover = coverOf(samples, W, H);
    const behind = cover <= b.depth.max_cover;
    if (!behind) {
      await page.evaluate(`window.__vl.toFront(${JSON.stringify(b.id)})`);
      warnings.push(`TEXT_BEHIND_FALLBACK: ${b.preset_key} (${b.layer}) va delante: la persona taparía el ${Math.round(cover * 100)} % del texto (tope ${Math.round(b.depth.max_cover * 100)} %)`);
    } else active = true;
    report.push({ id: b.id, layer: b.layer, preset_key: b.preset_key, cover, max_cover: b.depth.max_cover, placed: behind ? 'behind' : 'front' });
  }
  return { active, report };
}

/**
 * Captura la capa de detrás (sólo los bloques que quedaron detrás) en sus tramos y escribe, por tramo, el texto
 * (b_%05d.png) y la máscara (m_%05d.png) en `dir/detras_k/`. Devuelve [{ dir, start_s }] para `overlayArgs`.
 */
async function captureBehind({ scene, page, masks, fps, total, dir, report, hashes }) {
  const ids = new Set(report.filter((r) => r.placed === 'behind').map((r) => r.id));
  const ranges = scene.blocks.filter((b) => ids.has(b.id))
    .map((b) => [Math.ceil((b.start_ms * fps) / 1000), Math.min(total - 1, Math.floor(((b.end_ms - 1) * fps) / 1000))])
    .filter(([a, b]) => b >= a).sort((x, y) => x[0] - y[0]);
  const merged = [];
  for (const r of ranges) { const last = merged[merged.length - 1]; if (last && r[0] <= last[1] + 1) last[1] = Math.max(last[1], r[1]); else merged.push([...r]); }
  const out = [];
  for (const [k, [f0, f1]] of merged.entries()) {
    const d = join(dir, `detras_${k}`);
    mkdirSync(d, { recursive: true });
    for (let i = f0; i <= f1; i++) {
      await page.evaluate(`window.__vl.seek(${(i * 1000) / fps})`);
      const png = await page.frame(true);
      const n = String(i - f0).padStart(5, '0');
      writeFileSync(join(d, `b_${n}.png`), png);
      writeFileSync(join(d, `m_${n}.png`), masks.get(i).png);
      hashes.push(createHash('sha256').update(png).digest('hex'), createHash('sha256').update(masks.get(i).png).digest('hex'));
    }
    out.push({ dir: d, start_s: Math.round((f0 / fps) * 1e6) / 1e6 });
  }
  return out;
}
