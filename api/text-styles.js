// VIDEOLAB · GET /api/text-styles?brandId=… — el estilo SUGERIDO por capa para una generación nueva (rotación, F2).
// Desde el sonido F2 (2026-11-17) sugiere además el preset de FONDO (`suggested.sound_bed`): el fondo rota, los efectos
// no (decisión de Sam). Si la lectura del sonido falla, el texto se sugiere igual y `sound_bed` sale null.
//
// Devuelve, por capa, el estilo usado hace más tiempo por la marca (render/src/textrotation.mjs) y el grupo que rota.
// Quien genera (el Orchestrator) toma la sugerencia como estilo por defecto y la CONGELA en `text_layers`: así volver a
// renderizar la misma pieza da el mismo video. Sólo cuentan los jobs de una pieza real (con pieceId) y completados.
// Variables: SUPABASE_SERVICE_ROLE_KEY, y SUPABASE_URL (o VITE_SUPABASE_URL).

import * as S from '../render/src/supa.mjs';
import { suggestStyles, suggestSoundBed, ROTATION_LAYERS } from '../render/src/textrotation.mjs';

export const config = { maxDuration: 15 };
export const HISTORY_LIMIT = 200;
const enc = encodeURIComponent;

/** El historial por job (del más reciente al más antiguo) a partir de las filas de lab_jobs. PURO. */
export function historyOf(rows) {
  return (rows ?? []).map((r) => (Array.isArray(r?.presets) ? r.presets.filter((k) => typeof k === 'string') : []));
}

/** Los presets de fondo usados por job (del más reciente al más antiguo), de las filas de lab_jobs. PURO. */
export function bedHistoryOf(rows) {
  return (rows ?? []).map((r) => (typeof r?.bed === 'string' ? [r.bed] : []));
}

/** La sugerencia de fondo; null si la lectura falla (el texto no depende del sonido). */
async function soundBedSuggestion(cfg, brandId) {
  try {
    const rows = await S.select(cfg, `videolab_sound_presets?kind=eq.bed&or=(brand_id.is.null,brand_id.eq.${enc(brandId)})&select=preset_key,kind,brand_id,active,status,sort,spec`);
    // Política sonora de la marca y nivel de cada sonido (2026-11-19). La fila de la marca del sonido manda sobre la de sistema.
    // Código primero, dato después: si la tabla o la columna aún no existen, se rota como antes (sin política).
    let policy = null, lib = [];
    try {
      [policy] = await S.select(cfg, `videolab_sound_policy?brand_id=eq.${enc(brandId)}&select=bed_tiers_allowed`);
      const keys = [...new Set(rows.map((r) => r.spec?.bed?.sound).filter(Boolean))];
      if (policy && keys.length) lib = await S.select(cfg, `voicelab_sound_library?sound_key=in.(${keys.map(enc).join(',')})&active=is.true&or=(brand_id.is.null,brand_id.eq.${enc(brandId)})&select=sound_key,brand_id,tier`);
    } catch { policy = null; lib = []; }
    const tierOf = (k) => (lib.find((x) => x.sound_key === k && x.brand_id === brandId) ?? lib.find((x) => x.sound_key === k))?.tier ?? null;
    const jobs = await S.select(cfg, `lab_jobs?lab=eq.videolab&brand_id=eq.${enc(brandId)}&status=eq.completed&payload->>pieceId=not.is.null` +
      `&output_parsed->text_layout->sound->bed=not.is.null&order=completed_at.desc&limit=${HISTORY_LIMIT}&select=bed:output_parsed->text_layout->sound->bed->>preset_key`);
    return suggestSoundBed(rows, brandId, bedHistoryOf(jobs), { policy: policy ?? null, tierOf });
  } catch {
    return null;
  }
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
    const suggested = suggestStyles(rows, brandId, history, ROTATION_LAYERS);
    suggested.sound_bed = await soundBedSuggestion(cfg, brandId);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ status: 'ok', brandId, suggested,
      basis: { jobs_considered: history.length, rule: 'least_recently_used' } });
  } catch (e) {
    return res.status(500).json({ status: 'error', error_label: 'VIDEOLAB_PROVIDER_FAILED', error: String(e?.message ?? e).slice(0, 400) });
  }
}
