// LA PÁGINA del capturador del motor HTML de VideoLab (F0 2026-11-16; F1: el dibujo vive en runtime.mjs): una sola
// página que monta la escena con `mount` y expone `window.__vl.seek(ms)`. Sin animaciones CSS, sin transiciones, sin
// temporizadores, sin red: las fuentes van dentro de la página (data: URL) y ease.mjs, keyframes.mjs y runtime.mjs se
// inyectan TAL CUAL (el mismo código que importa la vista previa del Orchestrator).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = (f) => fileURLToPath(new URL(f, import.meta.url));

/** El código de un módulo sin `import`/`export`, para meterlo en un <script> clásico. */
function inline(file) {
  return readFileSync(here(file), 'utf8')
    .replace(/^import .*$/gm, '')
    .replace(/^export (const|function|async function)/gm, '$1');
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/**
 * El HTML de la escena. `fonts` = [{ family, weight?: 400 | 700, bytes (Buffer), format: 'truetype' | 'opentype' }]:
 * una entrada por cara REAL que baja fonts.mjs. Con la negrita real presente, el navegador la usa; sin ella, sintetiza
 * la negrita sobre la regular (`font-synthesis`), y la medida ya lo cuenta (`faceMeasure`). PURO sobre sus argumentos
 * (mismo pedido → mismo HTML, byte a byte).
 */
export function scenePage(scene, fonts) {
  const faces = fonts.map((f) => `@font-face{font-family:${JSON.stringify(f.family)};src:url(data:font/${f.format === 'opentype' ? 'otf' : 'ttf'};base64,${Buffer.from(f.bytes).toString('base64')}) format(${JSON.stringify(f.format)});font-weight:${f.weight ?? 400};font-style:${f.style ?? 'normal'};font-display:block}`).join('\n');
  const { width: W, height: H } = scene.canvas;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
${faces}
html,body{margin:0;padding:0;background:transparent;overflow:hidden;width:${W}px;height:${H}px}
#root{position:absolute;left:0;top:0}
*{animation:none!important;transition:none!important;caret-color:transparent}
</style></head><body><div id="root"></div>
<script>
${inline('./ease.mjs')}
${inline('./keyframes.mjs')}
${inline('./runtime.mjs')}
const SCENE = ${JSON.stringify(scene).replace(/</g, '\\u003c')};
const VL = mount(document.getElementById('root'), SCENE, document);
window.__vl = { seek: VL.seek, check: VL.check,
  ready: document.fonts.ready.then(() => { VL.prepare(); return SCENE.families.map((f) => document.fonts.check('40px ' + JSON.stringify(f))); }) };
</script></body></html>`;
}
