// LA ROTACIÓN DE ESTILOS DE TEXTO (F2, 2026-11-17). Objetivo validado por Sam: «5 [estilos por capa] y el carril deberá
// rotarlos entre cada generación».
//
// DÓNDE VIVE Y POR QUÉ (medido 2026-11-17): hoy nadie rota los estilos de video; el Orchestrator toma el primero de la
// lista y el carril no arma `text_layers`. El ecosistema ya tiene dos rotaciones y las dos ELIGEN UNA VEZ Y CONGELAN:
// ImageLab elige la puesta en escena del producto por semilla (estable para la misma pieza) y el carril elige la frase
// del enlace sin repetir la anterior y la guarda en la pieza. Aquí igual: VideoLab SUGIERE, por marca y capa, el estilo
// usado hace más tiempo, y quien genera (el Orchestrator hoy, el carril mañana) lo CONGELA en `text_layers`. Elegir en
// el render rompería «mismo pedido → mismo video»: volver a renderizar una pieza cambiaría su estilo.
//
// Todo es dato: el grupo de cada capa son los estilos activos de esa capa que ve la marca (la fila de la marca manda
// sobre la del sistema), con motor html y validados; si no hay, los html activos; si no, cualquier activo. PURO.

export const ROTATION_LAYERS = Object.freeze(['hook', 'role', 'caption', 'key_title', 'cta']);

/** Los estilos que ve la marca por capa (fila de la marca sobre la del sistema; sin retirados ni inactivos). PURO. */
export function visiblePresets(rows, brandId) {
  const byKey = new Map();
  for (const r of rows ?? []) {
    if (!r?.preset_key || (r.brand_id != null && r.brand_id !== brandId)) continue;
    const prev = byKey.get(r.preset_key);
    if (!prev || (r.brand_id === brandId && prev.brand_id !== brandId)) byKey.set(r.preset_key, r);
  }
  return [...byKey.values()].filter((r) => r.active !== false && r.status !== 'retired');
}

/** El grupo que rota en una capa, del más preferido al menos (dato: motor y estado). PURO. */
export function rotationPool(visible, layer) {
  const of = visible.filter((r) => r.layer === layer);
  const html = of.filter((r) => r.spec?.engine === 'html');
  const validated = html.filter((r) => String(r.status ?? '').startsWith('validated'));
  return validated.length ? validated : html.length ? html : of;
}

/**
 * La sugerencia por capa: el estilo del grupo usado hace más tiempo por la marca (nunca usado = el más antiguo).
 * `history` = estilos usados por la marca, del job MÁS RECIENTE al más antiguo: [[preset_key, …], …]
 * (de `lab_jobs.output_parsed.text_layout.presets`). Empate → menor `sort`, luego clave. Determinista. PURO.
 */
export function suggestStyles(rows, brandId, history, layers = ROTATION_LAYERS) {
  const visible = visiblePresets(rows, brandId);
  const lastSeen = new Map();
  (history ?? []).forEach((keys, i) => { for (const k of keys ?? []) if (!lastSeen.has(k)) lastSeen.set(k, i); });
  const out = {};
  for (const layer of layers) {
    const pool = rotationPool(visible, layer);
    if (!pool.length) { out[layer] = null; continue; }
    const age = (r) => (lastSeen.has(r.preset_key) ? lastSeen.get(r.preset_key) : Infinity);
    pool.sort((a, b) => (age(b) - age(a)) || (Number(a.sort ?? 100) - Number(b.sort ?? 100)) || String(a.preset_key).localeCompare(String(b.preset_key)));
    out[layer] = { preset_key: pool[0].preset_key, pool: pool.map((r) => r.preset_key) };
  }
  return out;
}
