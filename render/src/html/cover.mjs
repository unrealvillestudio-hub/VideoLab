// LA PORTADA DENTRO DEL VIDEO (contrato v1.14.0, 2026-11-19).
//
// Decisión de Sam (2026-11-19, reportada por la sesión C): «Los thumbnails solo duran milisegundos para que antes de que
// corra el video se proyecte la imagen estática correcta (no con la boca abierta o los ojos cerrados), deberá elegirlos
// del mismo video. propongo 250ms.» y «SIEMPRE»: en todos los estilos.
//
// Qué hace: elige un fotograma del propio video con todas las caras con los ojos abiertos y la boca en reposo, y lo pone
// fijo `hold_ms` al inicio y `hold_ms` al final. La voz y el audio se desplazan `hold_ms`. El póster es ese fotograma.
// `hold_ms` es DATO: `intel.platform_format_profiles.video_bookend_ms` (NULL o 0 = sin portada; nunca una cifra aquí).
//
// Cómo elige: el detector de puntos de la cara de MediaPipe (`face_landmarker`, Apache-2.0, fijado por sha256 en
// render/scripts/seg-assets.sh) da, por cara, `eyeBlinkLeft`, `eyeBlinkRight` y `jawOpen` (0–1). Lo malo de un fotograma
// es la peor de sus caras: max(parpadeo de un ojo) + boca abierta. Gana el de menor valor; empate → el más temprano.
// Sin caras en ningún candidato (p. ej. un producto), o sin el detector, el fotograma de siempre (el reposo del avatar o
// 1,5 s) y la salida lo dice (`method`).

import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { tmpdir } from 'node:os';
import { openPage, findHeadlessShell } from './cdp.mjs';
import { segAssets } from './segment.mjs';
import { X264 } from '../x264.mjs';

/** El archivo del detector de caras, en la carpeta de los recursos del recorte. */
export const COVER_MODEL = 'face_landmarker.task';
/** Paso base entre candidatos (ms): el video se decodifica una vez a 1000 / paso fotogramas por segundo. */
export const CANDIDATE_STEP_MS = 250;
/** Tamaño al que se mira cada candidato (vertical 9:16; el detector reescala). */
export const COVER_SIZE = Object.freeze({ w: 360, h: 640 });

/** `hold_ms` de la portada según el perfil del formato (dato). Entero ≥ 0; ausente, NULL o inválido → 0. PURO. */
export function bookendMsOf(profile) {
  const v = Number(profile?.video_bookend_ms);
  return Number.isFinite(v) && v > 0 ? Math.round(v) : 0;
}

/**
 * Los momentos candidatos (ms): cada `stepMs` desde `edgeMs` hasta `durationMs - edgeMs`, con a lo sumo `max` (si hay
 * más, se agranda el paso). Sin margen suficiente, el centro. PURO.
 */
export function coverCandidates(durationMs, { stepMs = CANDIDATE_STEP_MS, edgeMs = 500, max = 120 } = {}) {
  const from = edgeMs, to = durationMs - edgeMs;
  if (!(to > from)) return [Math.max(0, Math.round(durationMs / 2))];
  const step = Math.max(stepMs, Math.ceil((to - from) / Math.max(1, max - 1) / stepMs) * stepMs);
  const out = [];
  for (let t = from; t <= to && out.length < max; t += step) out.push(t);
  return out;
}

/** Lo malo de un fotograma: la peor de sus caras, parpadeo (el ojo más cerrado) + boca abierta, a 3 decimales. PURO. */
export function frameBadness(faces) {
  if (!Array.isArray(faces) || !faces.length) return null;
  let worst = 0;
  for (const f of faces) worst = Math.max(worst, Math.max(f.blinkL ?? 0, f.blinkR ?? 0) + (f.jaw ?? 0));
  return Math.round(worst * 1000) / 1000;
}

/**
 * El mejor candidato: `results` = [{ t_ms, faces }]. Menor `frameBadness`; empate → el más temprano. Sin caras en
 * ninguno → null. PURO.
 */
export function pickCover(results) {
  let best = null;
  for (const r of results ?? []) {
    const b = frameBadness(r.faces);
    if (b == null) continue;
    if (!best || b < best.badness || (b === best.badness && r.t_ms < best.t_ms)) best = { t_ms: r.t_ms, badness: b, faces: r.faces.length };
  }
  return best;
}

/**
 * Argumentos de ffmpeg para poner la portada: `still` fijo `holdMs` antes y después de `video`; la voz se desplaza
 * `holdMs` y se rellena con silencio al final. Mismo x264 que el resto del render (mismo pedido → mismo MP4). PURO.
 */
export function bookendArgs({ video, still, holdMs, out, fps = 30, durationS }) {
  const h = holdMs / 1000;
  const norm = `fps=${fps},format=yuv420p,setsar=1`;
  return ['-loglevel', 'error', '-y', '-i', video, '-loop', '1', '-t', String(h), '-i', still, '-loop', '1', '-t', String(h), '-i', still,
    '-filter_complex', `[1:v]${norm}[a];[2:v]${norm}[b];[0:v]${norm}[m];[a][m][b]concat=n=3:v=1:a=0[v];` +
      `[0:a]adelay=${holdMs}:all=1,apad=pad_dur=${h}[au]`,
    '-map', '[v]', '-map', '[au]', '-c:v', 'libx264', ...X264, '-pix_fmt', 'yuv420p', '-r', String(fps),
    '-c:a', 'aac', '-ar', '48000', '-ac', '2', '-b:a', '160k', '-t', String(durationS + 2 * h), '-movflags', '+faststart', out];
}

/** Los recursos del detector: la carpeta del recorte, si además trae el modelo de caras. null si falta algo. */
export function coverAssets(env = process.env) {
  const root = segAssets(env);
  return root && existsSync(join(root, COVER_MODEL)) ? root : null;
}

const PAGE = `<!doctype html><html><head><meta charset="utf-8"></head><body><script type="module">
import { FilesetResolver, FaceLandmarker } from './vision_bundle.mjs';
let lm = null;
window.__vl = { ready: (async () => {
  const fs = await FilesetResolver.forVisionTasks('./wasm');
  lm = await FaceLandmarker.createFromOptions(fs, { baseOptions: { modelAssetPath: './face_landmarker.task', delegate: 'CPU' },
    runningMode: 'IMAGE', numFaces: 4, outputFaceBlendshapes: true, outputFacialTransformationMatrixes: false });
  return [];
})() };
window.__faces = (b64, w, h) => {
  const bin = atob(b64), px = new Uint8ClampedArray(bin.length);
  for (let i = 0; i < bin.length; i++) px[i] = bin.charCodeAt(i);
  const r = lm.detect(new ImageData(px, w, h));
  return (r.faceBlendshapes || []).map((c) => {
    const g = (n) => { const x = c.categories.find((k) => k.categoryName === n); return x ? Math.round(x.score * 1000) / 1000 : 0; };
    return { blinkL: g('eyeBlinkLeft'), blinkR: g('eyeBlinkRight'), jaw: g('jawOpen') };
  });
};
</script></body></html>`;

/**
 * Mira los candidatos de `input` con el detector y devuelve [{ t_ms, faces }]. Lanza si algo falla: el llamador usa el
 * fotograma de siempre.
 */
export async function scanFaces({ input, candidates, browserPath = findHeadlessShell(), assets = coverAssets(), size = COVER_SIZE }) {
  if (!assets) throw new Error(`faltan los archivos del detector de caras (${COVER_MODEL})`);
  if (!browserPath) throw new Error('no hay chrome-headless-shell');
  const dir = mkdtempSync(join(tmpdir(), 'vl-cover-'));
  writeFileSync(join(dir, 'cover.html'), PAGE);
  const types = { '.mjs': 'text/javascript', '.js': 'text/javascript', '.wasm': 'application/wasm', '.html': 'text/html' };
  const server = createServer((req, res) => {
    const rel = normalize(decodeURIComponent(String(req.url).split('?')[0])).replace(/^(\.\.[/\\])+/, '');
    const file = rel === '/cover.html' ? join(dir, 'cover.html') : join(assets, rel);
    if (!file.startsWith(assets) && file !== join(dir, 'cover.html')) { res.writeHead(404); return res.end(); }
    try { const b = readFileSync(file); res.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream' }); res.end(b); }
    catch { res.writeHead(404); res.end(); }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  let page = null;
  try {
    page = await openPage({ browserPath, url: `http://127.0.0.1:${server.address().port}/cover.html`, width: 64, height: 64, mode: 'screenshot', blockNetwork: false, timeoutMs: 120000 });
    const out = [];
    const fb = size.w * size.h * 4;
    // Una sola pasada: el video a `1000 / CANDIDATE_STEP_MS` fotogramas por segundo; el fotograma k es el momento k × paso.
    const want = new Set(candidates);
    const fps = 1000 / CANDIDATE_STEP_MS;
    const ff = spawn('ffmpeg', ['-loglevel', 'error', '-i', input, '-vf', `fps=${fps},scale=${size.w}:${size.h}:flags=area`,
      '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    ff.stderr.on('data', (d) => { err += d; });
    let buf = Buffer.alloc(0), k = 0;
    for await (const chunk of ff.stdout) {
      buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
      while (buf.length >= fb) {
        const frame = buf.subarray(0, fb);
        buf = buf.subarray(fb);
        const t = k * CANDIDATE_STEP_MS;
        if (want.has(t)) {
          const faces = await page.evaluate(`window.__faces(${JSON.stringify(Buffer.from(frame).toString('base64'))}, ${size.w}, ${size.h})`);
          out.push({ t_ms: t, faces: Array.isArray(faces) ? faces : [] });
        }
        k++;
      }
    }
    await new Promise((res, rej) => (ff.exitCode != null ? (ff.exitCode === 0 ? res() : rej(new Error(err))) : ff.on('close', (c) => (c === 0 ? res() : rej(new Error(`ffmpeg ${c}: ${err.slice(-200)}`))))));
    return out;
  } finally {
    if (page) await page.close();
    server.close();
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* nada */ }
  }
}

/**
 * La portada completa sobre `video` (MP4 ya terminado, con audio): elige el fotograma, lo pone `holdMs` antes y después
 * y deja el resultado en `out`. Devuelve { still (PNG), at_ms, method: 'face' | 'fallback', badness, faces, reason }.
 * `fallbackAtS`: el fotograma de siempre (reposo del avatar o 1,5 s). `run`: execFile prometido.
 */
export async function applyBookend({ video, out, work, holdMs, durationS, fallbackAtS, run, fps = 30, scan = scanFaces }) {
  const durationMs = Math.round(durationS * 1000);
  let pick = null, reason = null;
  try {
    pick = pickCover(await scan({ input: video, candidates: coverCandidates(durationMs) }));
    if (!pick) reason = 'ningún candidato con cara';
  } catch (e) { reason = String(e?.message ?? e).slice(0, 160); }
  const atMs = pick ? pick.t_ms : Math.round(fallbackAtS * 1000);
  const still = join(work, 'portada.png');
  await run('ffmpeg', ['-loglevel', 'error', '-y', '-ss', String(atMs / 1000), '-i', video, '-frames:v', '1', still]);
  await run('ffmpeg', bookendArgs({ video, still, holdMs, out, fps, durationS }), { maxBuffer: 1 << 26 });
  return { still, at_ms: atMs, hold_ms: holdMs, method: pick ? 'face' : 'fallback', badness: pick?.badness ?? null, faces: pick?.faces ?? 0, reason };
}
