// LA PÁGINA del motor HTML de VideoLab (F0, 2026-11-16): una sola página que dibuja TODA la escena y expone
// `window.__vl.seek(ms)`. `seek` es una función pura del tiempo: borra y vuelve a fijar el estilo de cada elemento a
// partir de la escena y del evaluador de keyframes. Sin animaciones CSS, sin transiciones, sin temporizadores, sin red:
// las fuentes van dentro de la página (data: URL) y el evaluador es el MISMO código que corre en Node (ease.mjs y
// keyframes.mjs, inyectados tal cual).

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
 * El HTML de la escena. `fonts` = [{ family, bytes (Buffer), format: 'truetype' | 'opentype' }]. PURO sobre sus
 * argumentos (mismo pedido → mismo HTML, byte a byte).
 */
export function scenePage(scene, fonts) {
  const faces = fonts.map((f) => `@font-face{font-family:${JSON.stringify(f.family)};src:url(data:font/${f.format === 'opentype' ? 'otf' : 'ttf'};base64,${Buffer.from(f.bytes).toString('base64')}) format(${JSON.stringify(f.format)});font-weight:400;font-style:normal;font-display:block}`).join('\n');
  const { width: W, height: H } = scene.canvas;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
${faces}
html,body{margin:0;padding:0;background:transparent;overflow:hidden;width:${W}px;height:${H}px}
#root{position:absolute;left:0;top:0;width:${W}px;height:${H}px;overflow:hidden}
.abs{position:absolute;left:0;top:0;transform-origin:50% 50%}
.line{position:absolute;white-space:pre;font-synthesis:weight style;font-kerning:normal;text-rendering:geometricPrecision}
.u{display:inline-block;transform-origin:50% 80%}
*{animation:none!important;transition:none!important;caret-color:transparent}
</style></head><body><div id="root"></div>
<script>
${inline('./ease.mjs')}
${inline('./keyframes.mjs')}
const SCENE = ${JSON.stringify(scene).replace(/</g, '\\u003c')};
${RUNTIME}
</script></body></html>`;
}

// El tiempo de ejecución de la página. Construye el DOM una vez; `seek` sólo fija estilos.
const RUNTIME = String.raw`
const root = document.getElementById('root');
const el = (cls, parent) => { const d = document.createElement('div'); d.className = cls; parent.appendChild(d); return d; };
const span = (cls, parent, text) => { const s = document.createElement('span'); s.className = cls; if (text != null) s.textContent = text; parent.appendChild(s); return s; };
const hex = (h, a = 1) => { const n = parseInt(h.slice(1), 16); return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')'; };
const mix = (a, b, p) => { const x = parseInt(a.slice(1), 16), y = parseInt(b.slice(1), 16); const c = (s) => Math.round(((x >> s) & 255) + ((((y >> s) & 255) - ((x >> s) & 255)) * p)); return 'rgb(' + c(16) + ',' + c(8) + ',' + c(0) + ')'; };
const r3 = (v) => Math.round(v * 1000) / 1000;

function textStyle(node, o) {
  node.style.fontFamily = JSON.stringify(o.family);
  node.style.fontSize = o.px + 'px';
  node.style.lineHeight = Math.round(o.px * o.lh) + 'px';
  node.style.fontWeight = o.bold ? '700' : '400';
  if (o.outline && o.outlineColor) { node.style.webkitTextStroke = (2 * o.outline) + 'px ' + o.outlineColor; node.style.paintOrder = 'stroke fill'; }
  if (o.shadow && o.shadowColor) node.style.textShadow = o.shadow.depth + 'px ' + o.shadow.depth + 'px 0 ' + hex(o.shadowColor, o.shadow.alpha);
}

// Aplica un estado del evaluador a un nodo. em = tamaño del bloque en px.
function apply(node, s, em, extra) {
  const tf = [];
  if (s.x_em || s.y_em) tf.push('translate(' + r3(s.x_em * em) + 'px,' + r3(s.y_em * em) + 'px)');
  if (s.rotate_deg) tf.push('rotate(' + r3(s.rotate_deg) + 'deg)');
  const sx = s.scale * s.scale_x, sy = s.scale * s.scale_y;
  if (sx !== 1 || sy !== 1) tf.push('scale(' + r3(sx) + ',' + r3(sy) + ')');
  node.style.transform = tf.join(' ');
  node.style.opacity = String(r3(Math.max(0, Math.min(1, s.opacity))));
  node.style.filter = s.blur_em > 0 ? 'blur(' + r3(s.blur_em * em) + 'px)' : '';
  const c = [s.clip_t, s.clip_r, s.clip_b, s.clip_l];
  node.style.clipPath = c.some((v) => v > 0) ? 'inset(' + c.map((v) => r3(Math.max(0, Math.min(1, v)) * 100) + '%').join(' ') + ')' : '';
  if (extra) extra(s);
}

function fmtNumber(n, c) {
  const v = n.value * c;
  let [i, d] = v.toFixed(n.decimals).split('.');
  if (n.thouSep) i = i.replace(/\B(?=(\d{3})+(?!\d))/g, n.thouSep);
  return n.prefix + i + (d ? (n.decSep || '.') + d : '') + n.suffix;
}

// ───── construcción de los bloques ─────
const built = SCENE.blocks.map((b) => {
  const has = (t) => b.tracks.some((tr) => tr.target === t);
  const wrap = el('abs', root);
  wrap.style.width = b.rect.w + 'px'; wrap.style.height = b.rect.h + 'px';
  const ruleOff = b.rule && b.rule.position === 'above' ? b.rule.th + b.rule.gap : 0;
  const content = { y: ruleOff, h: b.rect.h - (b.rule ? b.rule.th + b.rule.gap : 0) };
  let box = null, sheen = null;
  if (b.box) {
    box = el('abs', wrap);
    Object.assign(box.style, { top: content.y + 'px', width: b.rect.w + 'px', height: content.h + 'px', borderRadius: b.box.radius + 'px', background: hex(b.colors.box, b.box.opacity), overflow: 'hidden' });
    if (b.sheen) {
      sheen = el('abs', box);
      const sw = b.rect.w * b.sheen.width_pct / 100;
      Object.assign(sheen.style, { width: sw + 'px', height: content.h + 'px', background: 'linear-gradient(100deg, transparent 0%, ' + hex(b.colors.sheen, b.sheen.opacity) + ' 50%, transparent 100%)' });
      sheen._w = sw;
    }
  }
  let rule = null;
  if (b.rule) {
    rule = el('abs', wrap);
    const rx = b.align === 'center' ? (b.rect.w - b.rule.w) / 2 : 0;
    const ry = b.rule.position === 'above' ? 0 : b.rect.h - b.rule.th;
    Object.assign(rule.style, { left: rx + 'px', top: ry + 'px', width: b.rule.w + 'px', height: b.rule.th + 'px', background: b.colors.rule, transformOrigin: b.align === 'center' ? '50% 50%' : '0 50%' });
  }
  const text = el('abs', wrap);
  Object.assign(text.style, { width: b.rect.w + 'px', height: b.rect.h + 'px', color: b.colors.text });
  const units = { line: [], word: [], char: [], emphasis: [], number: [] };
  const splitChars = has('char');
  b.lines.forEach((ln, li) => {
    const line = el('line', text);
    textStyle(line, { family: b.family, px: b.px, lh: b.lh, bold: b.bold, outline: b.outline, outlineColor: b.colors.outline, shadow: b.shadow, shadowColor: b.colors.shadow });
    const top = content.y + b.pad.y + b.ext + li * Math.round(b.px * b.lh);
    line.style.top = top + 'px';
    if (b.align === 'center') { line.style.left = '0px'; line.style.width = b.rect.w + 'px'; line.style.textAlign = 'center'; }
    else line.style.left = (b.pad.x + b.ext) + 'px';
    units.line.push(line);
    ln.words.forEach((w, wi) => {
      if (wi) line.appendChild(document.createTextNode(' '));
      const ws = span('u', line);
      const shown = b.uppercase ? w.text.toLocaleUpperCase() : w.text;
      if (splitChars && !w.number) { for (const ch of shown) units.char.push(span('u', ws, ch)); }
      else ws.textContent = shown;
      ws._w = w;
      units.word.push(ws);
      if (w.emphasis) {
        units.emphasis.push(ws);
        if (b.mark) { const mk = span('abs', ws); mk.style.cssText += ';left:0;top:auto;bottom:' + b.mark.offset + 'px;height:' + b.mark.height + 'px;width:100%;background:' + b.colors.mark + ';transform-origin:0 50%;z-index:-1'; ws.style.position = 'relative'; ws.style.isolation = 'isolate'; ws._mark = mk; }
      }
      if (w.number) units.number.push(ws);
    });
  });
  return { b, wrap, box, sheen, rule, text, units };
});

// ───── construcción de los subtítulos ─────
const cap = SCENE.captions;
const capBuilt = cap ? cap.groups.map((g) => {
  const wrap = el('abs', root);
  const cx = cap.band.x + cap.band.w / 2;
  const bottom = cap.band.y + cap.band.h;
  Object.assign(wrap.style, { left: (cx - g.w / 2) + 'px', top: (bottom - g.h) + 'px', width: g.w + 'px', height: g.h + 'px' });
  if (g.box) { const bx = el('abs', wrap); Object.assign(bx.style, { width: g.w + 'px', height: g.h + 'px', borderRadius: g.box.radius + 'px', background: hex(cap.colors.box, g.box.opacity) }); }
  const words = [];
  g.lines.forEach((ln, li) => {
    const line = el('line', wrap);
    textStyle(line, { family: cap.family, px: g.px, lh: g.lh, bold: g.bold, outline: g.outline, outlineColor: cap.colors.outline, shadow: g.shadow, shadowColor: cap.colors.shadow });
    Object.assign(line.style, { left: '0px', width: g.w + 'px', textAlign: 'center', top: (g.pad.y + g.ext + li * Math.round(g.px * g.lh)) + 'px', color: cap.colors.text });
    ln.forEach((w, wi) => { if (wi) line.appendChild(document.createTextNode(' ')); const s = span('u', line, w.text); s._w = w; words.push(s); });
  });
  return { g, wrap, words };
}) : [];

// ───── seek: el estado de todo en el tiempo t (ms) ─────
function seek(t) {
  for (const k of built) {
    const { b } = k;
    const on = t >= b.start_ms && t < b.end_ms;
    k.wrap.style.display = on ? 'block' : 'none';
    if (!on) continue;
    const r = rectAt(b, t);
    k.wrap.style.left = r3(r.x) + 'px'; k.wrap.style.top = r3(r.y) + 'px';
    const em = b.px;
    apply(k.wrap, stateAt(b.tracks, 'block', t, b), em);
    if (k.box) apply(k.box, stateAt(b.tracks, 'box', t, b), em);
    if (k.sheen) { const s = stateAt(b.tracks, 'sheen', t, b); k.sheen.style.display = s.sheen >= 0 && s.sheen <= 1 ? 'block' : 'none'; k.sheen.style.transform = 'translateX(' + r3(-k.sheen._w + s.sheen * (b.rect.w + k.sheen._w)) + 'px)'; }
    if (k.rule) apply(k.rule, stateAt(b.tracks, 'rule', t, b), em);
    apply(k.text, stateAt(b.tracks, 'text', t, b), em);
    for (const name of ['line', 'word', 'char']) {
      const list = k.units[name];
      list.forEach((node, i) => apply(node, stateAt(b.tracks, name, t, b, { i, n: list.length }), em));
    }
    const hasEm = b.tracks.some((tr) => tr.target === 'emphasis');
    k.units.emphasis.forEach((node, i) => {
      const s = stateAt(b.tracks, 'emphasis', t, b, { i, n: k.units.emphasis.length });
      const tint = hasEm ? s.tint : 1;
      node.style.color = mix(b.colors.text, b.colors.emphasis, Math.max(0, Math.min(1, tint)));
      if (hasEm) { const base = stateAt(b.tracks, 'word', t, b, { i: k.units.word.indexOf(node), n: k.units.word.length }); apply(node, { ...s, opacity: s.opacity * base.opacity, x_em: s.x_em + base.x_em, y_em: s.y_em + base.y_em, scale: s.scale * base.scale }, em); }
      if (node._mark) node._mark.style.transform = 'scaleX(' + r3(Math.max(0, Math.min(1, s.mark))) + ')';
    });
    k.units.number.forEach((node, i) => {
      const s = stateAt(b.tracks, 'number', t, b, { i, n: k.units.number.length });
      node.textContent = fmtNumber(node._w.number, Math.max(0, Math.min(1, s.count)));
    });
  }
  for (const c of capBuilt) {
    const on = t >= c.g.start_ms && t < c.g.end_ms;
    c.wrap.style.display = on ? 'block' : 'none';
    if (!on) continue;
    const gb = { start_ms: c.g.start_ms, end_ms: c.g.end_ms };
    apply(c.wrap, stateAt(cap.tracks, 'block', t, gb), c.g.px);
    c.words.forEach((node, i) => {
      const w = node._w;
      const active = t >= w.start_ms && t < w.end_ms;
      const s = stateAt(cap.tracks, 'word', t, gb, { i, n: c.words.length });
      if (active) s.scale *= cap.active_scale;
      apply(node, s, c.g.px);
      node.style.color = active ? cap.colors.active : cap.colors.text;
    });
  }
}

// Comprobación de la medida: ancho real de cada línea en el navegador contra el que midió la geometría.
function check() {
  const out = [];
  for (const k of built) {
    k.wrap.style.display = 'block';
    k.units.line.forEach((line, i) => {
      const range = document.createRange(); range.selectNodeContents(line);
      out.push({ id: k.b.id, layer: k.b.layer, line: i, dom: Math.round(range.getBoundingClientRect().width), measured: Math.round(k.b.lines[i].width) });
    });
    k.wrap.style.display = 'none';
  }
  return out;
}

// Una cifra que cuenta cambia de ancho mientras cuenta: se le reserva el ancho de su valor final para que la línea no
// se mueva. Se hace una sola vez, con las fuentes ya cargadas.
function prepare() {
  for (const k of built) {
    k.wrap.style.display = 'block';
    for (const node of k.units.number) { node.style.minWidth = Math.ceil(node.getBoundingClientRect().width) + 'px'; node.style.textAlign = 'center'; }
    k.wrap.style.display = 'none';
  }
}

window.__vl = { seek, check, ready: document.fonts.ready.then(() => { prepare(); return SCENE.families.map((f) => document.fonts.check('40px ' + JSON.stringify(f))); }) };
`;
