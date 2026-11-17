// La fuente de la marca para los subtítulos y las capas de texto: la familia y el css_import salen de
// brand_typography (dato). Google Fonts sirve TrueType a un agente que no anuncia soporte de woff2; libass la lee de
// un directorio.
//
// El css_import puede pedir varias caras (cursiva, varios pesos) y el CSS las lista en el orden del proveedor, no en
// el que necesita el render: la cara se ELIGE por estilo y peso, nunca se toma la primera. Si el directorio tiene la
// regular y la negrita reales, libass usa la negrita real en vez de sintetizarla.
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { RenderError } from './plan.mjs';

export const REGULAR_WEIGHT = 400;
export const BOLD_WEIGHT = 700;

/**
 * Las caras que declara un CSS de @font-face: [{ style, weight: [min, max], url, ext }]. Sólo TTF/OTF (lo que libass
 * y la medida pueden leer). `font-weight` admite un valor o un rango («100 900»); sin declarar, 400. PURO.
 */
export function parseFontFaces(css) {
  const faces = [];
  for (const [, body] of String(css ?? '').matchAll(/@font-face\s*\{([^}]*)\}/g)) {
    const url = body.match(/url\((['"]?)(https:[^)'"]+\.(ttf|otf))\1\)/i);
    if (!url) continue;
    const style = (body.match(/font-style\s*:\s*([a-z-]+)/i)?.[1] ?? 'normal').toLowerCase();
    const w = (body.match(/font-weight\s*:\s*([0-9]+)(?:\s+([0-9]+))?/)?.slice(1) ?? []).filter(Boolean).map(Number);
    const weight = w.length ? [w[0], w[1] ?? w[0]] : [REGULAR_WEIGHT, REGULAR_WEIGHT];
    faces.push({ style, weight, url: url[2], ext: url[3].toLowerCase() });
  }
  return faces;
}

const dist = (face, target) => (target < face.weight[0] ? face.weight[0] - target : target > face.weight[1] ? target - face.weight[1] : 0);
const covers = (face, target) => dist(face, target) === 0;

/**
 * Elige las caras que necesita el render entre las del CSS:
 * - `regular`: estilo normal, el peso más cercano a 400 (en empate, el más pesado). Sin cara normal → falla
 *   (VIDEOLAB_BAD_REQUEST «sin cara normal»): nunca se dibuja en cursiva lo que el preset pide recto.
 * - `bold` (sólo si `bold`): estilo normal que cubra 700. Si no existe, null: el render usa la regular y libass la
 *   engrosa (negrita sintética), y la medida lo sabe.
 * PURO.
 */
export function pickFaces(faces, { family, bold = false, italic = false } = {}) {
  const normal = (faces ?? []).filter((f) => f.style === 'normal');
  if (!normal.length) {
    throw new RenderError('VIDEOLAB_BAD_REQUEST',
      `sin cara normal: css_import de ${family} no ofrece ninguna cara de estilo normal en TTF/OTF (sólo: ${(faces ?? []).map((f) => `${f.style} ${f.weight.join('-')}`).join(', ') || 'ninguna'})`);
  }
  const regular = [...normal].sort((a, b) => dist(a, REGULAR_WEIGHT) - dist(b, REGULAR_WEIGHT) || b.weight[0] - a.weight[0])[0];
  const strong = bold ? normal.find((f) => covers(f, BOLD_WEIGHT)) ?? null : null;
  // v1.4.0 (`italic_spans`): la cursiva más cercana a 400. Si la familia no la ofrece, null: el texto se inclina
  // (cursiva sintética, como ImageLab) y se avisa.
  const slanted = italic ? [...(faces ?? []).filter((f) => f.style === 'italic')]
    .sort((a, b) => dist(a, REGULAR_WEIGHT) - dist(b, REGULAR_WEIGHT) || b.weight[0] - a.weight[0])[0] ?? null : null;
  return { regular, bold: strong && strong.url !== regular.url ? strong : null, italic: slanted };
}

const fileName = (family, weight, ext) => `${family.replace(/[^A-Za-z0-9]+/g, '_')}-${weight}.${ext}`;

async function download(face, family, weight, dir) {
  const res = await fetch(face.url);
  if (!res.ok) throw new RenderError('VIDEOLAB_BAD_REQUEST', `fuente ${family} ${weight}: ${res.status}`);
  const file = join(dir, fileName(family, weight, face.ext));
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  return file;
}

/**
 * Baja al directorio las caras de la familia que el pedido dibuja: la regular siempre y la negrita real si `bold` y el
 * CSS la ofrece. Devuelve { dir, regular: { file, weight }, bold: { file, weight } | null }.
 */
export async function brandFontFaces({ cssImport, family, dir, bold = false, italic = false }) {
  if (!cssImport || !family) throw new RenderError('VIDEOLAB_BAD_REQUEST', 'la marca no declara tipografía para el texto en pantalla');
  const css = await (await fetch(cssImport, { headers: { 'User-Agent': 'Mozilla/4.0 (videolab-render)' } })).text();
  const faces = parseFontFaces(css);
  if (!faces.length) throw new RenderError('VIDEOLAB_BAD_REQUEST', `css_import de ${family} no ofrece TTF/OTF`);
  const pick = pickFaces(faces, { family, bold, italic });
  mkdirSync(dir, { recursive: true });
  const rw = covers(pick.regular, REGULAR_WEIGHT) ? REGULAR_WEIGHT : pick.regular.weight[0];
  // `url`: la del proveedor, para que la vista previa del Orchestrator cargue LA MISMA cara que mide el render.
  const regular = { file: await download(pick.regular, family, rw, dir), weight: rw, url: pick.regular.url };
  const strong = pick.bold ? { file: await download(pick.bold, family, BOLD_WEIGHT, dir), weight: BOLD_WEIGHT, url: pick.bold.url } : null;
  const slanted = pick.italic ? { file: await download(pick.italic, family, `${REGULAR_WEIGHT}i`, dir), weight: REGULAR_WEIGHT, style: 'italic', url: pick.italic.url } : null;
  return { dir, regular, bold: strong, italic: slanted };
}

export async function brandFont({ cssImport, family, dir, bold = false }) {
  return (await brandFontFaces({ cssImport, family, dir, bold })).dir;
}
