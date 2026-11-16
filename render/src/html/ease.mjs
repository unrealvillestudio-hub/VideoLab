// CURVAS DE VELOCIDAD del motor HTML de VideoLab (F0, 2026-11-16). Todas por fórmula pública:
// - las «Penner» (Robert Penner, «Easing Equations», 2001; las mismas que publica easings.net): sine, quad, cubic,
//   quart, quint, expo, circ, back y elastic, cada una con _in, _out e _in_out;
// - el resorte físico (oscilador armónico amortiguado), escrito `spring:rigidez,amortiguación[,masa]` (F1);
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

/**
 * RESORTE (F1, vigilancia tecnológica ronda 1, R1.2): oscilador armónico amortiguado de rigidez k, amortiguación c y
 * masa m, que parte de 0 en reposo hacia 1. Solución ANALÍTICA (fórmula cerrada, sin integrar paso a paso): mismo p,
 * mismo valor, en Node y en el navegador. ω0 = √(k/m), ζ = c / (2√(k·m)):
 *  - ζ < 1 (rebota): x(t) = 1 − e^(−ζω0t) · (cos ωd t + (ζω0/ωd) sen ωd t), con ωd = ω0√(1−ζ²);
 *  - ζ = 1 (crítico): x(t) = 1 − e^(−ω0t) · (1 + ω0t);
 *  - ζ > 1 (sobreamortiguado): x(t) = 1 − (r2·e^(r1t) − r1·e^(r2t)) / (r2 − r1), con r1,2 = −ω0(ζ ∓ √(ζ²−1)).
 * El tramo de la clave (su duración en ms) es el tiempo hasta que el resorte se asienta (envolvente < 0,1 %): la forma
 * la dan k, c y m; la velocidad, la duración del tramo. p = 1 devuelve exactamente 1.
 */
export function springEase(k, c, m = 1) {
  if (![k, c, m].every((v) => Number.isFinite(v) && v > 0)) throw new Error(`spring inválido: ${k},${c},${m}`);
  const w0 = Math.sqrt(k / m);
  const z = c / (2 * Math.sqrt(k * m));
  const LN = Math.log(1000);                                   // envolvente hasta 0,1 %
  let x, settle;
  if (z < 1) {
    const wd = w0 * Math.sqrt(1 - z * z);
    x = (t) => 1 - Math.exp(-z * w0 * t) * (Math.cos(wd * t) + (z * w0 / wd) * Math.sin(wd * t));
    settle = LN / (z * w0);
  } else if (z === 1) {
    x = (t) => 1 - Math.exp(-w0 * t) * (1 + w0 * t);
    settle = (LN + Math.log(1 + LN)) / w0;
  } else {
    const s = Math.sqrt(z * z - 1);
    const r1 = -w0 * (z - s), r2 = -w0 * (z + s);
    x = (t) => 1 - (r2 * Math.exp(r1 * t) - r1 * Math.exp(r2 * t)) / (r2 - r1);
    settle = LN / -r1;                                          // el polo lento manda
  }
  return (p) => (p <= 0 ? 0 : p >= 1 ? 1 : x(p * settle));
}

/** Resuelve el nombre de una curva del dato (`expo_out`, `bezier:0.2,0.8,0.2,1`, `spring:300,10,1`). Nombre desconocido → error. PURO. */
export function easeFn(name) {
  if (name == null) return EASES.linear;
  if (typeof name === 'string' && name.startsWith('spring:')) {
    const p = name.slice(7).split(',').map(Number);
    if (p.length < 2 || p.length > 3) throw new Error(`spring inválido: ${name} (spring:rigidez,amortiguación[,masa])`);
    return springEase(p[0], p[1], p[2] ?? 1);
  }
  if (typeof name === 'string' && name.startsWith('bezier:')) {
    const p = name.slice(7).split(',').map(Number);
    if (p.length !== 4) throw new Error(`bezier inválida: ${name}`);
    return cubicBezier(p[0], p[1], p[2], p[3]);
  }
  const f = EASES[name];
  if (!f) throw new Error(`curva desconocida: ${name}`);
  return f;
}
