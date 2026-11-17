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

export const RUNTIME_VERSION = '1.9.0';

const r3 = (v) => Math.round(v * 1000) / 1000;
/** Rodillo: alto de la casilla de cada dígito, en líneas. 1,6 deja a los dígitos vecinos fuera de la columna en reposo. */
const ROLL_GAP = 1.6;
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
export function mount(root, scene, doc = root.ownerDocument, opts = {}) {
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
  const lh = (b) => Math.round(b.px * b.lh);
  /**
   * Cifra en rodillo (`motion.roll`, 2026-11-17). La palabra se arma con su texto final: cada dígito es una columna del
   * ancho de ese dígito (el dígito queda invisible y reserva el lugar, así la línea mide lo mismo que la geometría) con
   * una tira de dígitos encima que `seek` desplaza. La columna recorta sólo en vertical (clip-path), así un dígito más
   * ancho que pasa no se corta de lado. Prefijo, separadores y sufijo son texto quieto.
   */
  const buildRoll = (ws, w, run, b, lineH) => {
    if (run.italic != null) ws.style.fontStyle = run.italic ? 'italic' : 'normal';
    if (run.weight != null) ws.style.fontWeight = String(run.weight);
    if (run.color) ws.style.color = b.colors[run.color] ?? '';
    const final = fmtNumber(w.number, 1);
    const cols = [];
    for (const ch of final) {
      if (!/[0-9]/.test(ch)) { ws.appendChild(doc.createTextNode(b.uppercase ? ch.toLocaleUpperCase() : ch)); continue; }
      const col = span('', ws);
      Object.assign(col.style, { display: 'inline-block', position: 'relative', clipPath: 'inset(0 -50% 0 -50%)' });
      const ghost = span('', col, ch); ghost.style.visibility = 'hidden';
      const strip = span('', col);
      Object.assign(strip.style, { position: 'absolute', left: '0px', top: '0px', width: '100%', textAlign: 'center' });
      cols.push({ strip, digit: Number(ch) });
    }
    // Cada dígito de la tira ocupa ROLL_GAP líneas: el dígito queda arriba de su casilla (misma línea base que el texto)
    // y el hueco debajo deja a los vecinos fuera de la columna. Con casillas de una línea se asomaban por arriba y abajo.
    const stepH = Math.round(lineH * ROLL_GAP);
    const steps = (d) => b.roll.turns * 10 + d;
    for (const c of cols) {
      c.steps = steps(c.digit);
      for (let k = 0; k <= c.steps; k++) { const d = span('', c.strip, String(k % 10)); Object.assign(d.style, { display: 'block', height: stepH + 'px' }); }
    }
    ws._roll = { cols, stepH };
  };
  const W = scene.canvas.width, H = scene.canvas.height;
  // CAPAS (texto detrás de las personas, runtime 1.9.0): con `opts.regions` y algún bloque con `depth`, esos bloques van
  // en una capa aparte y `setLayer` elige qué se ve: 'front' (todo menos lo de detrás), 'behind' (sólo lo de detrás) o
  // 'all'. El capturador toma cada capa por separado y ffmpeg recorta la de detrás con la máscara de la persona
  // (render/src/html/capture.mjs). Sin `opts.regions` (la vista previa del Orchestrator), todo se dibuja delante.
  const regions = !!opts.regions && scene.blocks.some((b) => b.depth);
  Object.assign(root.style, { position: root.style.position || 'relative', width: W + 'px', height: H + 'px', overflow: 'hidden' });

  // Franja de identidad (dato de la marca): un rectángulo fijo, siempre visible.
  let st = null;
  if (scene.strip) {
    st = abs(el('', root));
    Object.assign(st.style, { left: scene.strip.x + 'px', top: scene.strip.y + 'px', width: scene.strip.w + 'px', height: scene.strip.h + 'px', background: scene.strip.color });
  }

  // Capa del texto, recortada a la zona segura (contrato §4 ter.4: «cada evento lleva además un recorte a la zona
  // segura»; el dibujo ASS lo hace con \clip). Sin este recorte, una entrada que agranda el bloque (p. ej. un sello que
  // entra a 1,25×) salía un instante de la zona segura y tapaba la franja (medido en la F2, 2026-11-17). La franja va
  // fuera de esta capa: nada del texto la tapa.
  const layer = abs(el('', root));
  Object.assign(layer.style, { width: W + 'px', height: H + 'px' });
  const safeClip = scene.safe ? 'inset(' + scene.safe.y + 'px ' + (W - scene.safe.x - scene.safe.w) + 'px ' + (H - scene.safe.y - scene.safe.h) + 'px ' + scene.safe.x + 'px)' : null;
  if (safeClip) layer.style.clipPath = safeClip;
  // Con capas: la de detrás, del mismo tamaño y con el mismo recorte a la zona segura.
  let back = null;
  if (regions) {
    back = abs(el('', root));
    Object.assign(back.style, { width: W + 'px', height: H + 'px', display: 'none' });
    if (safeClip) back.style.clipPath = safeClip;
  }

  // ───── bloques ─────
  const built = scene.blocks.map((b) => {
    const has = (t) => b.tracks.some((tr) => tr.target === t);
    const wrap = abs(el('', regions && b.depth ? back : layer));
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
      if (ln.weight != null) line.style.fontWeight = String(ln.weight);
      line.style.top = (content.y + b.pad.y + b.ext + li * Math.round(b.px * b.lh)) + 'px';
      if (b.align === 'left') line.style.left = (b.pad.x + b.ext) + 'px';
      else Object.assign(line.style, { left: (b.pad.x + b.ext) + 'px', width: (b.rect.w - 2 * (b.pad.x + b.ext)) + 'px', textAlign: b.align });
      units.line.push(line);
      ln.words.forEach((w, wi) => {
        if (wi) line.appendChild(doc.createTextNode(' '));
        const ws = unit(span('', line));
        // Tramos con estilo dentro de la palabra (cursiva, negrita, color): cada uno, su <span>.
        let runs = w.runs ?? [{ text: w.text }];
        // Una cifra con rodillo se arma aparte (sólo si la palabra es un tramo; con varios tramos, cuenta como siempre).
        if (w.number && b.roll && runs.length === 1) { buildRoll(ws, w, runs[0], b, lh(b)); runs = []; }
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
    const wrap = abs(el('', layer));
    const cx = cap.band.x + cap.band.w / 2;
    const bottom = cap.band.y + cap.band.h;
    Object.assign(wrap.style, { left: (cx - g.w / 2) + 'px', top: (bottom - g.h) + 'px', width: g.w + 'px', height: g.h + 'px' });
    if (g.box) { const bx = abs(el('', wrap)); Object.assign(bx.style, { width: g.w + 'px', height: g.h + 'px', borderRadius: g.box.radius + 'px', background: hex(cap.colors.box, g.box.opacity) }); }
    const words = [];
    g.lines.forEach((ln, li) => {
      const line = el('', wrap);
      lineStyle(line, { family: cap.family, px: g.px, lh: g.lh, bold: g.bold, outline: g.outline, outlineColor: cap.colors.outline, shadow: g.shadow, shadowColor: cap.colors.shadow });
      Object.assign(line.style, { left: '0px', width: g.w + 'px', textAlign: 'center', top: (g.pad.y + g.ext + li * Math.round(g.px * g.lh)) + 'px', color: cap.colors.text });
      ln.forEach((w, wi) => {
        if (wi) line.appendChild(doc.createTextNode(' '));
        const s = unit(span('', line, w.text)); s._w = w; words.push(s);
        // Caja detrás de la palabra que suena (active_word.box): una capa propia, detrás del texto y sin mover la línea.
        if (cap.active_box) {
          const b = cap.active_box;
          const mk = abs(span('', s));
          Object.assign(mk.style, { left: -r3(b.pad_x_em * g.px) + 'px', top: -r3(b.pad_y_em * g.px) + 'px',
            width: 'calc(100% + ' + r3(2 * b.pad_x_em * g.px) + 'px)', height: 'calc(100% + ' + r3(2 * b.pad_y_em * g.px) + 'px)',
            borderRadius: r3(b.radius_em * g.px) + 'px', background: hex(b.color, b.opacity), zIndex: '-1', display: 'none' });
          Object.assign(s.style, { position: 'relative', isolation: 'isolate' });
          s._box = mk;
        }
      });
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
        // Sin pista de énfasis, el color lo ponen los tramos (`runs`). Con pista, el tinte anima la palabra entera.
        if (hasEm) {
          node.style.color = mix(b.colors.text, b.colors.emphasis, Math.max(0, Math.min(1, s.tint)));
          const base = stateAt(b.tracks, 'word', t, b, { i: k.units.word.indexOf(node), n: k.units.word.length });
          apply(node, { ...s, opacity: s.opacity * base.opacity, x_em: s.x_em + base.x_em, y_em: s.y_em + base.y_em, scale: s.scale * base.scale }, em);
        }
        if (node._mark) node._mark.style.transform = 'scaleX(' + r3(Math.max(0, Math.min(1, s.mark))) + ')';
      });
      k.units.number.forEach((node, i) => {
        const s = stateAt(b.tracks, 'number', t, b, { i, n: k.units.number.length });
        const c = Math.max(0, Math.min(1, s.count));
        if (node._roll) {
          // Cada cifra avanza con el contador, la de la izquierda primero; `lag` la retrasa respecto de la anterior.
          const { cols, stepH } = node._roll;
          const lag = Math.min(b.roll.lag, cols.length > 1 ? 0.9 / (cols.length - 1) : 0);
          const span1 = 1 - lag * Math.max(0, cols.length - 1);
          cols.forEach((col, j) => {
            const p = Math.max(0, Math.min(1, (c - j * lag) / span1));
            col.strip.style.transform = 'translateY(' + r3(-p * col.steps * stepH) + 'px)';
          });
        } else node.textContent = fmtNumber(node._w.number, c);
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
        const marked = cap.keywords_only ? !!w.keyword : active;   // qué palabra lleva el acento
        node.style.fontSize = active && cap.active_scale !== 1 && (!cap.keywords_only || w.keyword) ? r3(c.g.px * cap.active_scale) + 'px' : '';
        apply(node, stateAt(cap.tracks, 'word', t, gb, { i, n: c.words.length }), c.g.px);
        // Salto al sonar (active_word.pop): sube y vuelve en `ms`, con un seno (sin rebote). Se suma al transform de las pistas.
        if (cap.pop && active && (!cap.keywords_only || w.keyword)) {
          const k = Math.min(1, Math.max(0, (t - w.start_ms) / cap.pop.ms));
          const sc = 1 + (cap.pop.scale - 1) * Math.sin(Math.PI * k);
          if (sc !== 1) node.style.transform = (node.style.transform ? node.style.transform + ' ' : '') + 'scale(' + r3(sc) + ')';
        }
        // Palabra a palabra al decirse (reveal: 'spoken'): lo que aún no se dijo no se ve.
        if (cap.reveal === 'spoken' && t < w.start_ms) node.style.opacity = '0';
        node.style.color = marked ? cap.colors.active : cap.colors.text;
        if (node._box) node._box.style.display = active && (!cap.keywords_only || w.keyword) ? 'block' : 'none';
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

  /** Qué capa se ve: 'front' (todo menos lo de detrás), 'behind' (sólo lo de detrás) o 'all'. */
  function setLayer(which) {
    if (!back) return false;
    const front = which !== 'behind', behind = which !== 'front';
    layer.style.display = front ? 'block' : 'none';
    if (st) st.style.display = front ? 'block' : 'none';
    back.style.display = behind ? 'block' : 'none';
    return true;
  }

  /** Cajas de las palabras de los bloques que van detrás y están en pantalla, en coordenadas del lienzo. */
  function depthRects() {
    if (!back) return [];
    const o = back.getBoundingClientRect();
    return built.filter((k) => k.wrap.parentNode === back && k.wrap.style.display !== 'none').map((k) => ({
      id: k.b.id,
      rects: k.units.word.map((n) => { const r = n.getBoundingClientRect(); return [r.left - o.left, r.top - o.top, r.width, r.height]; }),
    }));
  }

  /** Pasa un bloque de detrás a delante (el texto quedaría ilegible detrás de la persona). */
  function toFront(id) {
    const k = built.find((x) => x.b.id === id);
    if (k && back && k.wrap.parentNode === back) layer.appendChild(k.wrap);
  }

  return { seek, check, prepare, destroy, setLayer, depthRects, toFront, regions };
}
