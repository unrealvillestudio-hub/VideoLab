// EL NAVEGADOR DEL MOTOR HTML (F1, 2026-11-16): chrome-headless-shell manejado por CDP crudo (WebSocket de Node 22),
// sin Playwright ni Puppeteer. Dos modos de captura, que dan EL MISMO PÍXEL (medido en la vigilancia tecnológica,
// ronda 1, R1.1: misma huella en 240 fotogramas por tramo):
//  - 'beginframe': HeadlessExperimental.beginFrame con --deterministic-mode. El compositor sólo avanza cuando lo pide
//    el capturador. Un 33 % más rápido (medido).
//  - 'screenshot': Page.captureScreenshot. Es el respaldo: si beginFrame no está (otro binario, otra versión), se usa
//    éste y se avisa.
// Fondo transparente fijado una vez por sesión; PNG con optimizeForSpeed:false, porque el atajo rápido aplasta el alfa
// (aprendido del núcleo de HyperFrames, Apache-2.0; ver docs/MOTOR_HTML.md §2.1).

import { spawn } from 'node:child_process';
import { existsSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir, homedir } from 'node:os';

export const CAPTURE_MODES = Object.freeze(['beginframe', 'screenshot']);

/**
 * La ruta de chrome-headless-shell: HEADLESS_SHELL si está; si no, la que dejó `playwright install --only-shell` en
 * PLAYWRIGHT_BROWSERS_PATH, /ms-playwright, /opt/pw-browsers o ~/.cache/ms-playwright (la versión más alta). null si no hay.
 */
export function findHeadlessShell(env = process.env) {
  if (env.HEADLESS_SHELL) return existsSync(env.HEADLESS_SHELL) ? env.HEADLESS_SHELL : null;
  const roots = [env.PLAYWRIGHT_BROWSERS_PATH, '/ms-playwright', '/opt/pw-browsers', join(homedir(), '.cache', 'ms-playwright')].filter(Boolean);
  for (const root of roots) {
    if (!existsSync(root)) continue;
    const dirs = readdirSync(root).filter((d) => /^chromium_headless_shell-\d+$/.test(d))
      .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
    for (const d of dirs) {
      const bin = join(root, d, 'chrome-headless-shell-linux64', 'chrome-headless-shell');
      if (existsSync(bin)) return bin;
    }
  }
  return null;
}

/**
 * Abre el navegador y una pestaña del tamaño del lienzo con la página `url` (file:// o data:). Devuelve
 * { mode, frame(withShot) → Buffer|null, evaluate(expr, awaitPromise), close() }. Lanza si el navegador no arranca o si
 * el modo pedido no funciona; el llamador decide el respaldo.
 */
export async function openPage({ browserPath, url, width, height, mode = 'beginframe', fps = 30, timeoutMs = 30000 }) {
  if (!CAPTURE_MODES.includes(mode)) throw new Error(`modo de captura desconocido: ${mode}`);
  const userDir = mkdtempSync(join(tmpdir(), 'vl-cdp-'));
  const flags = ['--remote-debugging-port=0', `--user-data-dir=${userDir}`, '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    '--font-render-hinting=none', '--disable-lcd-text', '--force-color-profile=srgb', '--hide-scrollbars', '--no-first-run',
    '--mute-audio', `--window-size=${width},${height}`];
  if (mode === 'beginframe') {
    flags.push('--deterministic-mode', '--enable-begin-frame-control', '--run-all-compositor-stages-before-draw',
      '--disable-threaded-animation', '--disable-threaded-scrolling', '--disable-checker-imaging', '--disable-new-content-rendering-timeout');
  }
  const proc = spawn(browserPath, flags, { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  const cleanup = () => { try { proc.kill('SIGKILL'); } catch { /* ya cerrado */ } try { rmSync(userDir, { recursive: true, force: true }); } catch { /* nada */ } };
  try {
    const wsUrl = await new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error(`el navegador no abrió CDP en ${timeoutMs} ms: ${stderr.slice(-300)}`)), timeoutMs);
      proc.on('exit', (c) => { clearTimeout(t); rej(new Error(`el navegador salió con ${c}: ${stderr.slice(-300)}`)); });
      proc.stderr.on('data', (d) => { stderr += d; const m = String(stderr).match(/DevTools listening on (ws:\/\/\S+)/); if (m) { clearTimeout(t); res(m[1]); } });
    });
    const ws = new WebSocket(wsUrl);
    await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', () => rej(new Error('CDP: no conecta'))); });
    let id = 0;
    const pend = new Map();
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data);
      if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(`CDP ${p.method}: ${JSON.stringify(m.error)}`)) : p.res(m.result); }
    });
    const send = (method, params = {}, sessionId) => new Promise((res, rej) => {
      const i = ++id;
      const t = setTimeout(() => { pend.delete(i); rej(new Error(`CDP ${method}: sin respuesta en ${timeoutMs} ms`)); }, timeoutMs);
      pend.set(i, { method, res: (v) => { clearTimeout(t); res(v); }, rej: (e) => { clearTimeout(t); rej(e); } });
      ws.send(JSON.stringify({ id: i, method, params, sessionId }));
    });
    const { targetId } = await send('Target.createTarget', { url: 'about:blank', width, height, ...(mode === 'beginframe' ? { enableBeginFrameControl: true } : {}) });
    const { sessionId: s } = await send('Target.attachToTarget', { targetId, flatten: true });
    await send('Page.enable', {}, s);
    await send('Runtime.enable', {}, s);
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }, s);
    await send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } }, s);
    // Sin red: la página trae todo dentro. Cualquier petición que no sea file:// o data: se corta.
    await send('Network.enable', {}, s);
    await send('Network.setBlockedURLs', { urls: ['http://*', 'https://*', 'ws://*', 'wss://*'] }, s);
    const evaluate = async (expression, awaitPromise = false) => {
      const r = await send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true }, s);
      if (r.exceptionDetails) throw new Error(`página: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
      return r.result.value;
    };
    const interval = 1000 / fps;
    let ticks = 1000;
    const frame = async (shot) => {
      if (mode === 'beginframe') {
        const r = await send('HeadlessExperimental.beginFrame', { frameTimeTicks: (ticks += interval), interval, noDisplayUpdates: false,
          ...(shot ? { screenshot: { format: 'png' } } : {}) }, s);
        if (!shot) return null;
        if (!r.screenshotData) throw new Error('beginFrame no devolvió imagen');
        return Buffer.from(r.screenshotData, 'base64');
      }
      if (!shot) return null;
      const r = await send('Page.captureScreenshot', { format: 'png', fromSurface: true, optimizeForSpeed: false, captureBeyondViewport: false,
        clip: { x: 0, y: 0, width, height, scale: 1 } }, s);
      return Buffer.from(r.data, 'base64');
    };
    await send('Page.navigate', { url }, s);
    // Con beginFrame el compositor sólo pinta cuando se le pide: la carga avanza a fuerza de fotogramas sin imagen.
    const until = async (expr) => {
      for (let i = 0; i < 600; i++) {
        if (mode === 'beginframe') await frame(false);
        if (await evaluate(expr).catch(() => false)) return true;
        if (mode !== 'beginframe') await new Promise((r) => setTimeout(r, 10));
      }
      return false;
    };
    if (!(await until('typeof window.__vl === "object"'))) throw new Error('la página no cargó el motor');
    await evaluate('window.__vl.ready.then((v) => { window.__vlFonts = v; })');
    if (!(await until('Array.isArray(window.__vlFonts)'))) throw new Error('las fuentes no terminaron de cargar');
    const fonts = await evaluate('window.__vlFonts');
    // Primer fotograma con imagen: si el modo no funciona, falla aquí, antes de capturar nada del video.
    await frame(true);
    return {
      mode, fonts, frame, evaluate,
      close: async () => { try { ws.close(); } catch { /* nada */ } cleanup(); },
    };
  } catch (e) {
    cleanup();
    throw e;
  }
}
