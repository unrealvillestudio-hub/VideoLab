// EL TIEMPO DE EJECUCIÓN DEL MOTOR HTML (F1, 2026-11-16) — lo que dibuja una escena en un navegador.
//
// Un solo código para los dos usos:
//  - el capturador del job (render/src/html/page.mjs lo mete en la página, junto con ease.mjs y keyframes.mjs);
//  - la vista previa del Orchestrator, que lo importa como módulo ES versionado desde VideoLab y lo monta sobre su
//    <video>, llamando a `seek(video.currentTime * 1000)` en cada fotograma.
// Mismo código y misma escena → mismo dibujo. `mount` construye el DOM una vez; `seek(t)` fija TODOS los estilos desde
// cero a partir de la escena y del evaluador de keyframes: el estado no depende del fotograma anterior.
// Este módulo no lee reloj, ni azar, ni red. Las fuentes las pone quien lo monta: la página del capturador las lleva
// dentro (data: URL); la vista previa llama a `loadFonts(scene)`, que usa las URL de `scene.fonts`.

import { stateAt, rectAt } from './keyframes.mjs';

export const RUNTIME_VERSION = '1.4.0';

const r3 = (v) => Math.round(v * 1000) / 1000;
const hex = (h, a = 1) => { const n = parseInt(h.slice(1), 16); return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')'; };
const mix = (a, b, p) => {
  const x = parseInt(a.slice(1), 16), y = parseInt(b.slice(1), 16);
  const c = (s) => Math.round(((x >> s) & 255) + ((((y >> s) & 255) - ((x >> s) & 255)) * p));
  return 'rgb(' + c(16) + ',' + c(8) + ',' + c(0) + ')';
};

/** Aplica un estado del evaluador a un nodo. `em` = tamaño del bloque en px. */
function apply(node, s, em) {
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
}

function fmtNumber(n, c) {
  const v = n.value * c;
  let [i, d] = v.toFixed(n.decimals).split('.');
  if (n.thouSep) i = i.replace(/\B(?=(\d{3})+(?!\d))/g, n.thouSep);
  return n.prefix + i + (d ? (n.decSep || '.') + d : '') + n.suffix;
}

/** Carga las fuentes de la escena por URL (vista previa). Devuelve, por familia, si quedó disponible. */
export async function loadFonts(scene, doc = document) {
  const faces = (scene.fonts ?? []).filter((f) => f.url);
  await Promise.all(faces.map(async (f) => {
    const ff = new FontFace(f.family, `url(${JSON.stringify(f.url)})`, { weight: String(f.weight ?? 400), style: f.style ?? 'normal' });
    doc.fonts.add(await ff.load());
  }));
  await doc.fonts.ready;
  return (scene.families ?? []).map((fam) => doc.fonts.check('40px ' + JSON.stringify(fam)));
}

/**
 * Monta la escena dentro de `root` (un elemento del tamaño del lienzo, en px del lienzo; la vista previa lo escala
 * con CSS). Devuelve { seek(ms), check(), prepare(), destroy() }.
 */
export function mount(root, scene, doc = root.ownerDocument) {
  const el = (cls, parent) => { const d = doc.createElement('div'); d.className = cls; parent.appendChild(d); return d; };
  const span = (cls, parent, text) => { const s = doc.createElement('span'); s.className = cls; if (text != null) s.textContent = text; parent.appendChild(s); return s; };
  const abs = (node) => { Object.assign(node.style, { position: 'absolute', left: '0px', top: '0px', transformOrigin: '50% 50%' }); return node; };
  const unit = (node) => { Object.assign(node.style, { display: 'inline-block', transformOrigin: '50% 80%' }); return node; };
  const lineStyle = (node, o) => {
    Object.assign(node.style, { position: 'absolute', whiteSpace: 'pre', fontSynthesis: 'weight style', fontKerning: 'normal',
      textRendering: 'geometricPrecision', fontFamily: JSON.stringify(o.family), fontSize: o.px + 'px',
      lineHeight: Math.round(o.px * o.lh) + 'px', fontWeight: o.bold ? '700' : '400' });
    if (o.outline && o.outlineColor) { node.style.webkitTextStroke = (2 * o.outline) + 'px ' + o.outlineColor; node.style.paintOrder = 'stroke fill'; }
    if (o.shadow && o.shadowColor) node.style.textShadow = o.shadow.depth + 'px ' + o.shadow.depth + 'px 0 ' + hex(o.shadowColor, o.shadow.alpha);
  };
  const W = scene.canvas.width, H = scene.canvas.height;
  Object.assign(root.style, { position: root.style.position || 'relative', width: W + 'px', height: H + 'px', overflow: 'hidden' });

  // Franja de identidad (dato de la marca): un rectángulo fijo, siempre visible.
  if (scene.strip) {
    const st = abs(el('', root));
    Object.assign(st.style, { left: scene.strip.x + 'px', top: scene.strip.y + 'px', width: scene.strip.w + 'px', height: scene.strip.h + 'px', background: scene.strip.color });
  }

  // ───── bloques ─────
  const built = scene.blocks.map((b) => {
    const has = (t) => b.tracks.some((tr) => tr.target === t);
    const wrap = abs(el('', root));
    wrap.style.width = b.rect.w + 'px'; wrap.style.height = b.rect.h + 'px';
    const ruleOff = b.rule && b.rule.position === 'above' ? b.rule.th + b.rule.gap : 0;
    const content = { y: ruleOff, h: b.rect.h - (b.rule ? b.rule.th + b.rule.gap : 0) };
    let box = null, sheen = null;
    if (b.box) {
      box = abs(el('', wrap));
      Object.assign(box.style, { top: content.y + 'px', width: b.rect.w + 'px', height: content.h + 'px', borderRadius: b.box.radius + 'px', background: hex(b.colors.box, b.box.opacity), overflow: 'hidden' });
      if (b.sheen) {
        sheen = abs(el('', box));
        const sw = b.rect.w * b.sheen.width_pct / 100;
        Object.assign(sheen.style, { width: sw + 'px', height: content.h + 'px', background: 'linear-gradient(100deg, transparent 0%, ' + hex(b.colors.sheen, b.sheen.opacity) + ' 50%, transparent 100%)' });
        sheen._w = sw;
      }
    }
    let rule = null;
    if (b.rule) {
      rule = abs(el('', wrap));
      const rx = b.align === 'center' ? (b.rect.w - b.rule.w) / 2 : b.align === 'right' ? b.rect.w - b.rule.w : 0;
      const ry = b.rule.position === 'above' ? 0 : b.rect.h - b.rule.th;
      Object.assign(rule.style, { left: rx + 'px', top: ry + 'px', width: b.rule.w + 'px', height: b.rule.th + 'px', background: b.colors.rule,
        transformOrigin: b.align === 'center' ? '50% 50%' : b.align === 'right' ? '100% 50%' : '0 50%' });
    }
    const text = abs(el('', wrap));
    Object.assign(text.style, { width: b.rect.w + 'px', height: b.rect.h + 'px', color: b.colors.text });
    const units = { line: [], word: [], char: [], emphasis: [], number: [] };
    const splitChars = has('char');
    b.lines.forEach((ln, li) => {
      const line = el('', text);
      lineStyle(line, { family: b.family, px: b.px, lh: b.lh, bold: b.bold, outline: b.outline, outlineColor: b.colors.outline, shadow: b.shadow, shadowColor: b.colors.shadow });
      line.style.top = (content.y + b.pad.y + b.ext + li * Math.round(b.px * b.lh)) + 'px';
      if (b.align === 'left') line.style.left = (b.pad.x + b.ext) + 'px';
      else Object.assign(line.style, { left: (b.pad.x + b.ext) + 'px', width: (b.rect.w - 2 * (b.pad.x + b.ext)) + 'px', textAlign: b.align });
      units.line.push(line);
      ln.words.forEach((w, wi) => {
        if (wi) line.appendChild(doc.createTextNode(' '));
        const ws = unit(span('', line));
        // Tramos con estilo dentro de la palabra (cursiva, negrita, color): cada uno, su <span>.
        const runs = w.runs ?? [{ text: w.text }];
        for (const run of runs) {
          const shown = b.uppercase ? run.text.toLocaleUpperCase() : run.text;
          const target = runs.length > 1 || run.italic != null || run.weight != null || run.color ? span('', ws) : ws;
          if (run.italic != null) target.style.fontStyle = run.italic ? 'italic' : 'normal';
          if (run.weight != null) target.style.fontWeight = String(run.weight);
          if (run.color) target.style.color = b.colors[run.color] ?? '';
          if (splitChars && !w.number) { for (const ch of shown) units.char.push(unit(span('', target, ch))); }
          else target.appendChild(doc.createTextNode(shown));
        }
        ws._w = w;
        units.word.push(ws);
        if (w.emphasis) {
          units.emphasis.push(ws);
          if (b.mark) {
            const mk = abs(span('', ws));
            Object.assign(mk.style, { top: 'auto', bottom: b.mark.offset + 'px', height: b.mark.height + 'px', width: '100%', background: b.colors.mark, transformOrigin: '0 50%', zIndex: '-1' });
            Object.assign(ws.style, { position: 'relative', isolation: 'isolate' });
            ws._mark = mk;
          }
        }
        if (w.number) units.number.push(ws);
      });
    });
    return { b, wrap, box, sheen, rule, text, units };
  });

  // ───── subtítulos ─────
  const cap = scene.captions;
  const capBuilt = cap ? cap.groups.map((g) => {
    const wrap = abs(el('', root));
    const cx = cap.band.x + cap.band.w / 2;
    const bottom = cap.band.y + cap.band.h;
    Object.assign(wrap.style, { left: (cx - g.w / 2) + 'px', top: (bottom - g.h) + 'px', width: g.w + 'px', height: g.h + 'px' });
    if (g.box) { const bx = abs(el('', wrap)); Object.assign(bx.style, { width: g.w + 'px', height: g.h + 'px', borderRadius: g.box.radius + 'px', background: hex(cap.colors.box, g.box.opacity) }); }
    const words = [];
    g.lines.forEach((ln, li) => {
      const line = el('', wrap);
      lineStyle(line, { family: cap.family, px: g.px, lh: g.lh, bold: g.bold, outline: g.outline, outlineColor: cap.colors.outline, shadow: g.shadow, shadowColor: cap.colors.shadow });
      Object.assign(line.style, { left: '0px', width: g.w + 'px', textAlign: 'center', top: (g.pad.y + g.ext + li * Math.round(g.px * g.lh)) + 'px', color: cap.colors.text });
      ln.forEach((w, wi) => { if (wi) line.appendChild(doc.createTextNode(' ')); const s = unit(span('', line, w.text)); s._w = w; words.push(s); });
    });
    return { g, wrap, words };
  }) : [];

  /** El estado de todo en el tiempo t (ms). */
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
      if (k.sheen) {
        const s = stateAt(b.tracks, 'sheen', t, b);
        k.sheen.style.display = s.sheen >= 0 && s.sheen <= 1 ? 'block' : 'none';
        k.sheen.style.transform = 'translateX(' + r3(-k.sheen._w + s.sheen * (b.rect.w + k.sheen._w)) + 'px)';
      }
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
        if (hasEm) {
          const base = stateAt(b.tracks, 'word', t, b, { i: k.units.word.indexOf(node), n: k.units.word.length });
          apply(node, { ...s, opacity: s.opacity * base.opacity, x_em: s.x_em + base.x_em, y_em: s.y_em + base.y_em, scale: s.scale * base.scale }, em);
        }
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
        // La palabra activa crece con el TAMAÑO de letra, no con transform: la línea se recoloca y la palabra no se
        // come el espacio de al lado.
        node.style.fontSize = active && cap.active_scale !== 1 ? r3(c.g.px * cap.active_scale) + 'px' : '';
        apply(node, stateAt(cap.tracks, 'word', t, gb, { i, n: c.words.length }), c.g.px);
        node.style.color = active ? cap.colors.active : cap.colors.text;
      });
    }
  }

  /** Ancho real de cada línea contra el que midió la geometría. */
  function check() {
    const out = [];
    for (const k of built) {
      k.wrap.style.display = 'block';
      k.units.line.forEach((line, i) => {
        const range = doc.createRange(); range.selectNodeContents(line);
        out.push({ id: k.b.id, layer: k.b.layer, line: i, dom: Math.round(range.getBoundingClientRect().width), measured: Math.round(k.b.lines[i].width) });
      });
      k.wrap.style.display = 'none';
    }
    return out;
  }

  /** Una cifra que cuenta cambia de ancho: se le reserva el de su valor final. Una vez, con las fuentes cargadas. */
  function prepare() {
    for (const k of built) {
      k.wrap.style.display = 'block';
      for (const node of k.units.number) { node.style.minWidth = Math.ceil(node.getBoundingClientRect().width) + 'px'; node.style.textAlign = 'center'; }
      k.wrap.style.display = 'none';
    }
  }

  function destroy() { while (root.firstChild) root.removeChild(root.firstChild); }

  return { seek, check, prepare, destroy };
}
