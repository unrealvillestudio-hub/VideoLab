// La fuente de la marca para los subtítulos: la familia y el css_import salen de brand_typography (dato).
// Google Fonts sirve TrueType a un agente que no anuncia soporte de woff2; libass la lee de un directorio.
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { RenderError } from './plan.mjs';

export async function brandFont({ cssImport, family, dir }) {
  if (!cssImport || !family) throw new RenderError('VIDEOLAB_BAD_REQUEST', 'la marca no declara tipografía para subtítulos');
  const css = await (await fetch(cssImport, { headers: { 'User-Agent': 'Mozilla/4.0 (videolab-render)' } })).text();
  const m = css.match(/url\((https:[^)]+\.(?:ttf|otf))\)/);
  if (!m) throw new RenderError('VIDEOLAB_BAD_REQUEST', `css_import de ${family} no ofrece TTF/OTF`);
  const res = await fetch(m[1]);
  if (!res.ok) throw new RenderError('VIDEOLAB_BAD_REQUEST', `fuente ${family}: ${res.status}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${family.replace(/[^A-Za-z0-9]+/g, '_')}.ttf`), Buffer.from(await res.arrayBuffer()));
  return dir;
}
