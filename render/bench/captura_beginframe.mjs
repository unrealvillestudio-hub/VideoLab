// BANCO de la vigilancia tecnológica, ronda 1 (2026-11-16): captura por HeadlessExperimental.beginFrame
// (chrome-headless-shell con --deterministic-mode) contra Page.captureScreenshot, con la MISMA página del motor HTML y los
// mismos fotogramas. CDP crudo con el WebSocket de Node 22. NO lo usa el job: es medición.
//
// Uso: HEADLESS_SHELL=<ruta> node render/bench/captura_beginframe.mjs <scene.json> <fonts.json> <screenshot|beginframe> \
//        <primer_fotograma> <cuantos> <dir_salida>
//   scene.json: la que escribe motor_html_f0.mjs; fonts.json: [{ family, weight, format, file }].
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { scenePage } from '../src/html/page.mjs';
const [sceneFile, fontsJson, mode, from, count, outDir] = process.argv.slice(2);
const scene = JSON.parse(readFileSync(sceneFile, 'utf8'));
const fonts = JSON.parse(readFileSync(fontsJson, 'utf8')).map((f) => ({ ...f, bytes: readFileSync(f.file) }));
const html = join(outDir, 'page.html'); writeFileSync(html, scenePage(scene, fonts));
const HS = process.env.HEADLESS_SHELL;
if (!HS) { console.error('falta HEADLESS_SHELL (ruta de chrome-headless-shell)'); process.exit(2); }
const ud = mkdtempSync(join(tmpdir(), 'bf-'));
const W = scene.canvas.width, H = scene.canvas.height;
const flags = ['--remote-debugging-port=0', `--user-data-dir=${ud}`, '--no-sandbox', '--disable-gpu', '--font-render-hinting=none',
  '--disable-lcd-text', '--force-color-profile=srgb', '--hide-scrollbars', `--window-size=${W},${H}`, '--no-first-run'];
if (mode === 'beginframe') flags.push('--deterministic-mode', '--enable-begin-frame-control', '--run-all-compositor-stages-before-draw',
  '--disable-threaded-animation', '--disable-threaded-scrolling', '--disable-checker-imaging', '--disable-new-content-rendering-timeout');
const proc = spawn(HS, flags, { stdio: ['ignore', 'ignore', 'pipe'] });
const wsUrl = await new Promise((res) => proc.stderr.on('data', (d) => { const m = String(d).match(/(ws:\/\/\S+)/); if (m) res(m[1]); }));
const ws = new WebSocket(wsUrl); await new Promise((r) => ws.addEventListener('open', r));
let id = 0; const pend = new Map();
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); } });
const send = (method, params = {}, sessionId) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params, sessionId })); });
const { targetId } = await send('Target.createTarget', { url: 'about:blank', width: W, height: H, ...(mode === 'beginframe' ? { enableBeginFrameControl: true } : {}) });
const { sessionId: s } = await send('Target.attachToTarget', { targetId, flatten: true });
await send('Page.enable', {}, s); await send('Runtime.enable', {}, s);
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false }, s);
await send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } }, s);
const ev = (expr, awaitPromise = false) => send('Runtime.evaluate', { expression: expr, awaitPromise, returnByValue: true }, s);
await send('Page.navigate', { url: 'file://' + html }, s);
let ticks = 1000; const interval = 1000 / 30;
const bf = (shot) => send('HeadlessExperimental.beginFrame', { frameTimeTicks: (ticks += interval), interval, noDisplayUpdates: false, ...(shot ? { screenshot: { format: 'png' } } : {}) }, s);
// La página necesita fotogramas para cargar y pintar cuando el reloj lo controla beginFrame.
for (let i = 0; i < 400; i++) { if (mode === 'beginframe') await bf(false); const r = await ev('typeof window.__vl === "object"'); if (r.result.value) break; await new Promise((r) => setTimeout(r, 10)); }
const ready = mode === 'beginframe' ? await (async () => { for (let i = 0; i < 400; i++) { await bf(false); const r = await ev('window.__ok === true'); if (r.result.value) return true; if (i === 0) await ev('window.__vl.ready.then(v => { window.__ok = v.every(Boolean); })'); } return false; })() : (await ev('window.__vl.ready.then(v => v.every(Boolean))', true)).result.value;
if (!ready) throw new Error('fuentes sin cargar');
const hashes = []; const t0 = performance.now();
for (let i = Number(from); i < Number(from) + Number(count); i++) {
  await ev(`window.__vl.seek(${(i * 1000) / 30})`);
  let png;
  if (mode === 'beginframe') { const r = await bf(true); png = Buffer.from(r.screenshotData ?? '', 'base64'); }
  else { const r = await send('Page.captureScreenshot', { format: 'png', fromSurface: true, optimizeForSpeed: false, clip: { x: 0, y: 0, width: W, height: H, scale: 1 } }, s); png = Buffer.from(r.data, 'base64'); }
  hashes.push(createHash('sha256').update(png).digest('hex'));
  if (i === Number(from) + 30) writeFileSync(join(outDir, `${mode}_f${i}.png`), png);
}
const ms = performance.now() - t0;
console.log(JSON.stringify({ mode, frames: Number(count), ms_por_fotograma: +(ms / Number(count)).toFixed(1), vacios: hashes.filter((h, k) => !h).length, digest: createHash('sha256').update(hashes.join('\n')).digest('hex').slice(0, 16) }));
ws.close(); proc.kill('SIGKILL');
