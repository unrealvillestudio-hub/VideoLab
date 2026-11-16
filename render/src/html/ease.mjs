// CURVAS DE VELOCIDAD del motor HTML de VideoLab (F0, 2026-11-16). Todas por fórmula pública:
// - las «Penner» (Robert Penner, «Easing Equations», 2001; las mismas que publica easings.net): sine, quad, cubic,
//   quart, quint, expo, circ, back y elastic, cada una con _in, _out e _in_out;
// - la curva de Bézier cúbica de CSS (W3C, CSS Easing Functions Level 1, §2.2 «cubic-bezier()»), escrita como
//   `bezier:x1,y1,x2,y2`, resuelta por Newton-Raphson con respaldo de bisección (el método del propio borrador).
// Son funciones PURAS de p ∈ [0, 1] → valor (puede salirse de [0, 1] en back y elastic, a propósito).
// Este archivo no importa nada: el motor lo inyecta tal cual en la página del capturador, así que el navegador y Node
// evalúan EXACTAMENTE el mismo código.

const PI = Math.PI;
const c1 = 1.70158;
const c2 = c1 * 1.525;
const c3 = c1 + 1;
const c4 = (2 * PI) / 3;
const c5 = (2 * PI) / 4.5;

const bounceOut = (x) => {
  const n1 = 7.5625, d1 = 2.75;
  if (x < 1 / d1) return n1 * x * x;
  if (x < 2 / d1) return n1 * (x -= 1.5 / d1) * x + 0.75;
  if (x < 2.5 / d1) return n1 * (x -= 2.25 / d1) * x + 0.9375;
  return n1 * (x -= 2.625 / d1) * x + 0.984375;
};

export const EASES = Object.freeze({
  linear: (x) => x,
  sine_in: (x) => 1 - Math.cos((x * PI) / 2),
  sine_out: (x) => Math.sin((x * PI) / 2),
  sine_in_out: (x) => -(Math.cos(PI * x) - 1) / 2,
  quad_in: (x) => x * x,
  quad_out: (x) => 1 - (1 - x) * (1 - x),
  quad_in_out: (x) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2),
  cubic_in: (x) => x * x * x,
  cubic_out: (x) => 1 - Math.pow(1 - x, 3),
  cubic_in_out: (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2),
  quart_in: (x) => x * x * x * x,
  quart_out: (x) => 1 - Math.pow(1 - x, 4),
  quart_in_out: (x) => (x < 0.5 ? 8 * x * x * x * x : 1 - Math.pow(-2 * x + 2, 4) / 2),
  quint_in: (x) => x * x * x * x * x,
  quint_out: (x) => 1 - Math.pow(1 - x, 5),
  quint_in_out: (x) => (x < 0.5 ? 16 * x * x * x * x * x : 1 - Math.pow(-2 * x + 2, 5) / 2),
  expo_in: (x) => (x === 0 ? 0 : Math.pow(2, 10 * x - 10)),
  expo_out: (x) => (x === 1 ? 1 : 1 - Math.pow(2, -10 * x)),
  expo_in_out: (x) => (x === 0 ? 0 : x === 1 ? 1 : x < 0.5 ? Math.pow(2, 20 * x - 10) / 2 : (2 - Math.pow(2, -20 * x + 10)) / 2),
  circ_in: (x) => 1 - Math.sqrt(1 - x * x),
  circ_out: (x) => Math.sqrt(1 - Math.pow(x - 1, 2)),
  circ_in_out: (x) => (x < 0.5 ? (1 - Math.sqrt(1 - Math.pow(2 * x, 2))) / 2 : (Math.sqrt(1 - Math.pow(-2 * x + 2, 2)) + 1) / 2),
  back_in: (x) => c3 * x * x * x - c1 * x * x,
  back_out: (x) => 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2),
  back_in_out: (x) => (x < 0.5
    ? (Math.pow(2 * x, 2) * ((c2 + 1) * 2 * x - c2)) / 2
    : (Math.pow(2 * x - 2, 2) * ((c2 + 1) * (x * 2 - 2) + c2) + 2) / 2),
  elastic_in: (x) => (x === 0 ? 0 : x === 1 ? 1 : -Math.pow(2, 10 * x - 10) * Math.sin((x * 10 - 10.75) * c4)),
  elastic_out: (x) => (x === 0 ? 0 : x === 1 ? 1 : Math.pow(2, -10 * x) * Math.sin((x * 10 - 0.75) * c4) + 1),
  elastic_in_out: (x) => (x === 0 ? 0 : x === 1 ? 1 : x < 0.5
    ? -(Math.pow(2, 20 * x - 10) * Math.sin((20 * x - 11.125) * c5)) / 2
    : (Math.pow(2, -20 * x + 10) * Math.sin((20 * x - 11.125) * c5)) / 2 + 1),
  bounce_in: (x) => 1 - bounceOut(1 - x),
  bounce_out: bounceOut,
  bounce_in_out: (x) => (x < 0.5 ? (1 - bounceOut(1 - 2 * x)) / 2 : (1 + bounceOut(2 * x - 1)) / 2),
});

/** Bézier cúbica de CSS (P0 = 0,0 y P3 = 1,1). x1 y x2 ∈ [0, 1]. Devuelve una función PURA. */
export function cubicBezier(x1, y1, x2, y2) {
  if (![x1, y1, x2, y2].every(Number.isFinite) || x1 < 0 || x1 > 1 || x2 < 0 || x2 > 1) {
    throw new Error(`bezier inválida: ${x1},${y1},${x2},${y2}`);
  }
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sx = (t) => ((ax * t + bx) * t + cx) * t;
  const sy = (t) => ((ay * t + by) * t + cy) * t;
  const dx = (t) => (3 * ax * t + 2 * bx) * t + cx;
  const solve = (x) => {
    let t = x;
    for (let i = 0; i < 8; i++) {
      const e = sx(t) - x;
      if (Math.abs(e) < 1e-7) return t;
      const d = dx(t);
      if (Math.abs(d) < 1e-6) break;
      t -= e / d;
    }
    let lo = 0, hi = 1;
    t = x;
    for (let i = 0; i < 40; i++) {
      const v = sx(t);
      if (Math.abs(v - x) < 1e-7) return t;
      if (x > v) lo = t; else hi = t;
      t = (lo + hi) / 2;
    }
    return t;
  };
  return (x) => (x <= 0 ? 0 : x >= 1 ? 1 : sy(solve(x)));
}

/** Resuelve el nombre de una curva del dato (`expo_out`, `bezier:0.2,0.8,0.2,1`). Nombre desconocido → error. PURO. */
export function easeFn(name) {
  if (name == null) return EASES.linear;
  if (typeof name === 'string' && name.startsWith('bezier:')) {
    const p = name.slice(7).split(',').map(Number);
    if (p.length !== 4) throw new Error(`bezier inválida: ${name}`);
    return cubicBezier(p[0], p[1], p[2], p[3]);
  }
  const f = EASES[name];
  if (!f) throw new Error(`curva desconocida: ${name}`);
  return f;
}
