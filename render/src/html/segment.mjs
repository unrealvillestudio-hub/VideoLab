// EL RECORTE DE LA PERSONA para el texto detrás de los sujetos (2026-11-17).
//
// Encargo de Sam: «la posibilidad del efecto que anima el texto por detrás de los sujetos en los videos»; objetivo F1
// confirmado («sí al objetivo F1, VideoLab, tope 35 %»). El recorte vive en el render de VideoLab: es cuadro a cuadro y va
// pegado al dibujo del texto.
//
// Motor: el segmentador de Google MediaPipe (`@mediapipe/tasks-vision`, Apache-2.0) con su modelo multiclase de personas
// (`selfie_multiclass_256x256`, Apache-2.0), corriendo en el MISMO chrome-headless-shell del motor HTML (WASM en CPU).
// Sin regalías y sin red en el render: la imagen trae los archivos fijados por su sha256 (render/scripts/seg-assets.sh).
// Persona = pelo + piel del cuerpo + piel de la cara + ropa (clases 1–4); el fondo y los accesorios no cuentan.
// Medido el 2026-11-17 sobre el video de prueba con dos personas: el modelo rápido (`selfie_segmenter`) recorta en bloques; el
// multiclase recorta bien a las dos personas, pelo incluido (~0,4 s por cuadro en CPU, misma máscara en dos corridas).
//
// Sólo se recortan los fotogramas de los bloques que van detrás, uno de cada dos (`SEG_STRIDE`): los intermedios se
// interpolan, y todos se suavizan en el tiempo con [1, 2, 1] / 4 para que el borde no tiemble. Enteros: mismo video →
// mismas máscaras.

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { openPage } from './cdp.mjs';
import { pngOf } from './capture.mjs';

/** Tamaño de la máscara (el del modelo, en vertical 9:16); el navegador la escala al lienzo con filtro bilineal. */
export const SEG_SIZE = Object.freeze({ w: 288, h: 512 });
/** Uno de cada `SEG_STRIDE` fotogramas pasa por el modelo; los demás se interpolan. */
export const SEG_STRIDE = 2;
/** Archivos del recorte y su sha256 (los fija render/scripts/seg-assets.sh). */
export const SEG_FILES = Object.freeze(['vision_bundle.mjs', 'wasm/vision_wasm_internal.js', 'wasm/vision_wasm_internal.wasm', 'selfie_multiclass_256x256.tflite']);

/** La carpeta con los archivos del recorte: SEG_ASSETS, /opt/vl-seg o ~/.cache/vl-seg. null si falta alguno. */
export function segAssets(env = process.env) {
  const roots = [env.SEG_ASSETS, '/opt/vl-seg', join(homedir(), '.cache', 'vl-seg')].filter(Boolean);
  for (const r of roots) if (SEG_FILES.every((f) => existsSync(join(r, f)))) return r;
  return null;
}

/** Fotogramas que necesitan máscara: los de los bloques con `depth`, de su primer a su último fotograma. PURO. */
export function depthFrames(scene) {
  const out = new Set();
  for (const b of scene.blocks.filter((x) => x.depth)) {
    const f0 = Math.ceil((b.start_ms * scene.fps) / 1000), f1 = Math.floor(((b.end_ms - 1) * scene.fps) / 1000);
    for (let i = f0; i <= f1; i++) out.add(i);
  }
  return [...out].sort((a, b) => a - b);
}

/** Tramos consecutivos de una lista ordenada de fotogramas. PURO. */
function runsOf(frames) {
  const runs = [];
  for (const f of frames) {
    const last = runs[runs.length - 1];
    if (last && f === last[last.length - 1] + 1) last.push(f); else runs.push([f]);
  }
  return runs;
}

/** Qué fotogramas pasan por el modelo: uno de cada `stride` en cada tramo, más el último. PURO. */
export function modelFrames(frames, stride = SEG_STRIDE) {
  const out = [];
  for (const run of runsOf(frames)) run.forEach((f, k) => { if (k % stride === 0 || k === run.length - 1) out.push(f); });
  return out;
}

/**
 * Completa y suaviza: interpola linealmente los fotogramas sin modelo entre sus vecinos con modelo y suaviza cada tramo en
 * el tiempo con [1, 2, 1] / 4 (los extremos, con su único vecino). Enteros con redondeo fijo. `raw`: Map fotograma →
 * Uint8Array. Devuelve Map fotograma → Uint8Array para todos los `frames`. PURO.
 */
export function fillAndSmooth(frames, raw) {
  const full = new Map();
  for (const run of runsOf(frames)) {
    const known = run.filter((f) => raw.has(f));
    for (const f of run) {
      if (raw.has(f)) { full.set(f, raw.get(f)); continue; }
      const a = known.filter((k) => k < f).pop(), b = known.find((k) => k > f);
      const A = raw.get(a ?? b), B = raw.get(b ?? a);
      const wb = a != null && b != null ? (f - a) / (b - a) : 0;
      const out = new Uint8Array(A.length);
      for (let k = 0; k < A.length; k++) out[k] = Math.round(A[k] * (1 - wb) + B[k] * wb);
      full.set(f, out);
    }
    const src = run.map((f) => full.get(f));
    run.forEach((f, j) => {
      const p = src[j - 1] ?? src[j], c = src[j], n = src[j + 1] ?? src[j];
      const out = new Uint8Array(c.length);
      for (let k = 0; k < c.length; k++) out[k] = (p[k] + 2 * c[k] + n[k] + 2) >> 2;
      full.set(f, out);
    });
  }
  return full;
}

const PAGE = `<!doctype html><html><head><meta charset="utf-8"></head><body><script type="module">
import { FilesetResolver, ImageSegmenter } from './vision_bundle.mjs';
let seg = null;
window.__vl = { ready: (async () => {
  const fs = await FilesetResolver.forVisionTasks('./wasm');
  seg = await ImageSegmenter.createFromOptions(fs, { baseOptions: { modelAssetPath: './selfie_multiclass_256x256.tflite', delegate: 'CPU' },
    runningMode: 'VIDEO', outputConfidenceMasks: true, outputCategoryMask: false });
  return [];
})() };
// Persona = clases 1–4 (pelo, piel del cuerpo, piel de la cara, ropa). Curva: bajo 0,3 es fondo, sobre 0,7 es persona.
window.__seg = (b64, w, h, ts) => {
  const bin = atob(b64), px = new Uint8ClampedArray(bin.length);
  for (let i = 0; i < bin.length; i++) px[i] = bin.charCodeAt(i);
  const r = seg.segmentForVideo(new ImageData(px, w, h), ts);
  const m = r.confidenceMasks, cls = [1, 2, 3, 4].map((c) => m[c].getAsFloat32Array());
  const out = new Uint8Array(w * h);
  for (let k = 0; k < out.length; k++) {
    let p = 0; for (const a of cls) p += a[k];
    p = Math.min(1, Math.max(0, (p - 0.3) / 0.4));
    out[k] = Math.round(p * 255);
  }
  r.close();
  let s = ''; for (let i = 0; i < out.length; i += 8192) s += String.fromCharCode.apply(null, out.subarray(i, i + 8192));
  return btoa(s);
};
</script></body></html>`;

/**
 * Las máscaras de los fotogramas `frames` del video `input` (fps del lienzo). Devuelve Map fotograma →
 * { w, h, data: Uint8Array, url: data:image/png } (blanco = persona). Lanza si algo falla: el llamador pone delante.
 */
export async function segmentFrames({ input, frames, fps, browserPath, assets = segAssets(), size = SEG_SIZE, stride = SEG_STRIDE }) {
  if (!frames.length) return new Map();
  if (!assets) throw new Error('faltan los archivos del recorte (SEG_ASSETS)');
  const want = new Set(modelFrames(frames, stride));
  const dir = mkdtempSync(join(tmpdir(), 'vl-seg-'));
  writeFileSync(join(dir, 'seg.html'), PAGE);
  const types = { '.mjs': 'text/javascript', '.js': 'text/javascript', '.wasm': 'application/wasm', '.html': 'text/html' };
  const server = createServer((req, res) => {
    const rel = normalize(decodeURIComponent(String(req.url).split('?')[0])).replace(/^(\.\.[/\\])+/, '');
    const file = rel === '/seg.html' ? join(dir, 'seg.html') : join(assets, rel);
    if (!file.startsWith(assets) && file !== join(dir, 'seg.html')) { res.writeHead(404); return res.end(); }
    try { const b = readFileSync(file); res.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream' }); res.end(b); }
    catch { res.writeHead(404); res.end(); }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  let page = null, ff = null;
  try {
    page = await openPage({ browserPath, url: `http://127.0.0.1:${server.address().port}/seg.html`, width: 64, height: 64, mode: 'screenshot', fps, blockNetwork: false, timeoutMs: 120000 });
    const last = frames[frames.length - 1];
    const fb = size.w * size.h * 4;
    ff = spawn('ffmpeg', ['-loglevel', 'error', '-i', input, '-frames:v', String(last + 1), '-vf', `scale=${size.w}:${size.h}:flags=area`,
      '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    ff.stderr.on('data', (d) => { err += d; });
    const raw = new Map();
    let buf = Buffer.alloc(0), idx = 0;
    for await (const chunk of ff.stdout) {
      buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
      while (buf.length >= fb) {
        const frame = buf.subarray(0, fb);
        buf = buf.subarray(fb);
        if (want.has(idx)) {
          const b64 = await page.evaluate(`window.__seg(${JSON.stringify(frame.toString('base64'))}, ${size.w}, ${size.h}, ${(idx * 1000) / fps})`);
          raw.set(idx, new Uint8Array(Buffer.from(b64, 'base64')));
        }
        idx++;
      }
    }
    await new Promise((res, rej) => (ff.exitCode != null ? (ff.exitCode === 0 ? res() : rej(new Error(err))) : ff.on('close', (c) => (c === 0 ? res() : rej(new Error(`ffmpeg ${c}: ${err.slice(-300)}`))))));
    const missing = [...want].filter((f) => !raw.has(f));
    if (missing.length) throw new Error(`el video no tiene los fotogramas ${missing.slice(0, 3).join(', ')}…`);
    const full = fillAndSmooth(frames, raw);
    const out = new Map();
    for (const [f, data] of full) out.set(f, { w: size.w, h: size.h, data, url: `data:image/png;base64,${pngOf(size.w, size.h, 0, data).toString('base64')}` });
    return out;
  } finally {
    if (ff && ff.exitCode == null) ff.kill('SIGKILL');
    if (page) await page.close();
    server.close();
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* nada */ }
  }
}
