// VIDEOLAB · GET /api/text-styles?brandId=… — el estilo SUGERIDO por capa para una generación nueva (rotación, F2).
//
// Devuelve, por capa, el estilo usado hace más tiempo por la marca (render/src/textrotation.mjs) y el grupo que rota.
// Quien genera (el Orchestrator) toma la sugerencia como estilo por defecto y la CONGELA en `text_layers`: así volver a
// renderizar la misma pieza da el mismo video. Sólo cuentan los jobs de una pieza real (con pieceId) y completados.
// Variables: SUPABASE_SERVICE_ROLE_KEY, y SUPABASE_URL (o VITE_SUPABASE_URL).

import * as S from '../render/src/supa.mjs';
import { suggestStyles, ROTATION_LAYERS } from '../render/src/textrotation.mjs';

export const config = { maxDuration: 15 };
export const HISTORY_LIMIT = 200;
const enc = encodeURIComponent;

/** El historial por job (del más reciente al más antiguo) a partir de las filas de lab_jobs. PURO. */
export function historyOf(rows) {
  return (rows ?? []).map((r) => (Array.isArray(r?.presets) ? r.presets.filter((k) => typeof k === 'string') : []));
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ status: 'error', error_label: 'VIDEOLAB_BAD_REQUEST', error: 'sólo GET' });
  const brandId = String(req.query?.brandId ?? '').trim();
  if (!brandId) return res.status(400).json({ status: 'error', error_label: 'VIDEOLAB_BAD_REQUEST', error: 'falta brandId' });
  try {
    const cfg = S.config({ ...process.env, SUPABASE_URL: process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL });
    const rows = await S.select(cfg, `videolab_text_presets?or=(brand_id.is.null,brand_id.eq.${enc(brandId)})&select=preset_key,layer,brand_id,active,status,sort,spec`);
    const jobs = await S.select(cfg, `lab_jobs?lab=eq.videolab&brand_id=eq.${enc(brandId)}&status=eq.completed&payload->>pieceId=not.is.null` +
      `&order=completed_at.desc&limit=${HISTORY_LIMIT}&select=presets:output_parsed->text_layout->presets`);
    const history = historyOf(jobs);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ status: 'ok', brandId, suggested: suggestStyles(rows, brandId, history, ROTATION_LAYERS),
      basis: { jobs_considered: history.length, rule: 'least_recently_used' } });
  } catch (e) {
    return res.status(500).json({ status: 'error', error_label: 'VIDEOLAB_PROVIDER_FAILED', error: String(e?.message ?? e).slice(0, 400) });
  }
}
