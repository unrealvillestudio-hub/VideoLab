// La fuente de la marca para los subtítulos y las capas de texto: la familia y el css_import salen de
// brand_typography (dato). Google Fonts sirve TrueType a un agente que no anuncia soporte de woff2; libass la lee de
// un directorio.
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { RenderError } from './plan.mjs';

/** Baja la fuente al directorio y devuelve { dir, file } (el archivo sirve para medir el texto con sus métricas). */
export async function brandFontFile({ cssImport, family, dir }) {
  if (!cssImport || !family) throw new RenderError('VIDEOLAB_BAD_REQUEST', 'la marca no declara tipografía para el texto en pantalla');
  const css = await (await fetch(cssImport, { headers: { 'User-Agent': 'Mozilla/4.0 (videolab-render)' } })).text();
  const m = css.match(/url\((https:[^)]+\.(?:ttf|otf))\)/);
  if (!m) throw new RenderError('VIDEOLAB_BAD_REQUEST', `css_import de ${family} no ofrece TTF/OTF`);
  const res = await fetch(m[1]);
  if (!res.ok) throw new RenderError('VIDEOLAB_BAD_REQUEST', `fuente ${family}: ${res.status}`);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${family.replace(/[^A-Za-z0-9]+/g, '_')}.${m[1].endsWith('.otf') ? 'otf' : 'ttf'}`);
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  return { dir, file };
}

export async function brandFont({ cssImport, family, dir }) {
  return (await brandFontFile({ cssImport, family, dir })).dir;
}
