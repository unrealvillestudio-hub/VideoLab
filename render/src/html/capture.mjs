// EL CAPTURADOR DETERMINISTA del motor HTML de VideoLab (F0, 2026-11-16) — opción (a), propio.
//
// Chromium sin pantalla (Playwright), lienzo del pedido, escala 1, fondo transparente. Para cada fotograma i se fija el
// tiempo t = i / fps con `window.__vl.seek(t)` y se captura un PNG con alfa por CDP. El reloj real no interviene nunca:
// el tiempo lo pone el capturador. Fuera de los tramos con texto no se abre el navegador: se repite un PNG transparente.
// Los PNG van por una tubería a ffmpeg, que los monta sobre el video limpio con la franja de identidad y codifica con la
// especificación de salida del contrato (§5). Lo aprendido del núcleo de HyperFrames (Apache-2.0, ver docs/MOTOR_HTML.md):
// PNG con `optimizeForSpeed: false` (el atajo rápido aplasta el alfa) y el fondo transparente fijado UNA vez por sesión.

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { scenePage } from './page.mjs';
import { textSpans } from './scene.mjs';

/** PNG RGBA totalmente transparente de W×H (sin navegador). PURO. */
export function blankPng(W, H) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((W * 4 + 1) * H);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/**
 * Argumentos de ffmpeg: video limpio + PNG por la entrada estándar → MP4 de la especificación (§5). PURO.
 * `threads` FIJO a propósito: x264 elige sus hilos según las CPU de la máquina, y con otro número de hilos el MP4 sale
 * distinto byte a byte aunque los fotogramas sean idénticos (medido en la F0: misma huella de fotogramas con 4 y con 2
 * CPU, MP4 distinto). Con los hilos fijos, el mismo pedido da el mismo archivo en cualquier máquina.
 */
export function overlayArgs({ input, fps, filters = [], out, threads = 2 }) {
  const post = [...filters, 'format=yuv420p'].join(',');
  return ['-y', '-loglevel', 'error', '-i', input, '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'png', '-i', 'pipe:0',
    '-filter_complex', `[1:v]format=rgba[o];[0:v][o]overlay=0:0:format=auto:eof_action=pass[m];[m]${post}[v]`,
    '-map', '[v]', '-map', '0:a:0?', '-c:v', 'libx264', '-threads:v', String(threads), '-pix_fmt', 'yuv420p', '-r', String(fps),
    '-c:a', 'aac', '-ar', '48000', '-ac', '2', '-b:a', '160k', '-movflags', '+faststart', out];
}

/**
 * Renderiza la escena sobre `input` y escribe `out`. `fonts` = [{ family, bytes, format }]. Devuelve tiempos,
 * fotogramas capturados y la huella de cada fotograma (sha256 del PNG) para comprobar el determinismo.
 * `chromium` = el `chromium` de Playwright (se inyecta: el módulo no lo importa, así el resto del render no lo necesita).
 */
export async function renderHtmlLayers({ scene, fonts, input, out, chromium, frames = null, onFrame = null, encode = true }) {
  const t0 = performance.now();
  const { width: W, height: H } = scene.canvas;
  const fps = scene.fps;
  const total = frames ?? Math.round((scene.durationMs / 1000) * fps);
  const spans = textSpans(scene);
  const inSpan = (t) => spans.some(([a, b]) => t >= a && t < b);
  const browser = await chromium.launch({ args: ['--font-render-hinting=none', '--disable-lcd-text', '--force-color-profile=srgb', '--disable-gpu'] });
  const timings = { launch_ms: 0, load_ms: 0, capture_ms: 0, encode_wait_ms: 0, total_ms: 0 };
  const hashes = [];
  const frameMs = [];
  let captured = 0;
  let ff = null, ffDone = null, ffErr = '';
  try {
    timings.launch_ms = Math.round(performance.now() - t0);
    const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await page.route('**/*', (r) => (r.request().url().startsWith('data:') ? r.continue() : r.abort()));   // sin red
    const tl = performance.now();
    await page.setContent(scenePage(scene, fonts), { waitUntil: 'load' });
    const ok = await page.evaluate(() => window.__vl.ready);
    if (!ok.every(Boolean)) throw new Error(`fuentes sin cargar en la página: ${JSON.stringify(scene.families)} → ${JSON.stringify(ok)}`);
    const fit = await page.evaluate(() => window.__vl.check());
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
    timings.load_ms = Math.round(performance.now() - tl);

    if (encode) {
      ff = spawn('ffmpeg', overlayArgs({ input, fps, filters: scene.filters, out }), { stdio: ['pipe', 'ignore', 'pipe'] });
      ff.stderr.on('data', (d) => { ffErr += d; });
      ffDone = new Promise((res, rej) => ff.on('close', (c) => (c === 0 ? res() : rej(new Error(`ffmpeg ${c}: ${ffErr.slice(-800)}`)))));
    }
    const write = (buf) => new Promise((res, rej) => { if (!ff) return res(); ff.stdin.write(buf, (e) => (e ? rej(e) : res())); });
    const blank = blankPng(W, H);
    const blankHash = createHash('sha256').update(blank).digest('hex');
    const tc = performance.now();
    for (let i = 0; i < total; i++) {
      const t = (i * 1000) / fps;
      let png, h;
      if (inSpan(t)) {
        const tf = performance.now();
        await page.evaluate((ms) => window.__vl.seek(ms), t);
        const r = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true, optimizeForSpeed: false, captureBeyondViewport: false, clip: { x: 0, y: 0, width: W, height: H, scale: 1 } });
        png = Buffer.from(r.data, 'base64');
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
    const digest = createHash('sha256').update(hashes.join('\n')).digest('hex');
    return { frames: total, captured, timings, hashes, digest, fit, spans, frameMs };
  } finally {
    if (ff && ff.exitCode == null) ff.kill('SIGKILL');
    await browser.close();
  }
}
