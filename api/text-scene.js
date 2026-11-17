// VIDEOLAB · POST /api/text-scene — la escena de las capas de texto para la VISTA PREVIA (contrato v1.4.0, §4 ter.5).
//
// Devuelve lo que dibuja el motor HTML: la geometría ya resuelta (zona segura, caras, colocado a mano, posición por
// tramo), las palabras con sus estilos, colores, fuentes y animación como dato. Es el MISMO código que usa el job
// (render/src/textprep.mjs → buildTextLayers → buildScene), sin generar video: el Orchestrator monta la escena con el
// runtime versionado (`runtime_url`) sobre su <video> y llama a `seek(video.currentTime * 1000)`.
// Con presets del motor ASS, la escena es una aproximación del render (`fidelity: 'approximate'`).
// Variables: SUPABASE_SERVICE_ROLE_KEY, y SUPABASE_URL (o VITE_SUPABASE_URL).

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as S from '../render/src/supa.mjs';
import { resolveCanvas, RenderError } from '../render/src/plan.mjs';
import { validateTextLayers, timelineWords } from '../render/src/textlayers.mjs';
import { prepareTextLayers } from '../render/src/textprep.mjs';
import { RUNTIME_VERSION } from '../render/src/html/runtime.mjs';

export const config = { maxDuration: 30 };

const enc = encodeURIComponent;

/** Valida la forma del pedido de vista previa. Lanza RenderError VIDEOLAB_BAD_REQUEST. PURO. */
export function validateSceneRequest(body) {
  const bad = (m) => { throw new RenderError('VIDEOLAB_BAD_REQUEST', m); };
  if (!body || typeof body !== 'object') bad('el cuerpo debe ser un objeto JSON');
  if (typeof body.brandId !== 'string' || !body.brandId) bad('falta brandId');
  const params = body.params ?? {};
  if (!params.platform || params.format !== 'reel') bad('faltan params.platform o params.format=reel');
  const prev = body.previousOutputs ?? {};
  validateTextLayers(prev.text_layers, { words: timelineWords(prev.timeline) });
  const d = Number(body.duration_ms);
  if (!(Number.isFinite(d) && d > 0)) bad('duration_ms (duración del video limpio) debe ser > 0');
  return { brandId: body.brandId, params, textLayers: prev.text_layers, timeline: prev.timeline ?? null, durationMs: Math.round(d) };
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ status: 'error', error_label: 'VIDEOLAB_BAD_REQUEST', error: 'sólo POST' });
  const work = mkdtempSync(join(tmpdir(), 'vl-scene-'));
  try {
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = null; } }
    const r = validateSceneRequest(body);
    const cfg = S.config({ ...process.env, SUPABASE_URL: process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL });
    const [profile] = await S.select(cfg, `platform_format_profiles?platform=eq.${enc(r.params.platform)}&format=eq.reel&active=eq.true&select=*`, 'intel');
    const canvas = resolveCanvas(r.params.canvas ?? null, profile);
    const tlr = await prepareTextLayers({ cfg, brandId: r.brandId, params: r.params, profile, canvas, textLayers: r.textLayers,
      timeline: r.timeline, durationMs: r.durationMs, work, withScene: true });
    return res.status(200).json({
      status: 'ok',
      engine: tlr.engine,
      fidelity: tlr.engine === 'html' ? 'same_engine' : 'approximate',
      runtime_url: `/engine/${RUNTIME_VERSION}/runtime.mjs`,
      scene: tlr.scene,
      text_layout: { canal: tlr.canal, metrics: tlr.metrics, blocks: tlr.blocks, warnings: tlr.warnings, engine: tlr.engine, presets: tlr.presets },
    });
  } catch (e) {
    const label = e instanceof RenderError ? e.label : 'VIDEOLAB_PROVIDER_FAILED';
    const status = label === 'VIDEOLAB_BAD_REQUEST' || label === 'VIDEOLAB_TEXT_DOES_NOT_FIT' ? 400 : 500;
    // Medidor (v1.12.0): si el texto no entra, cuánto cabe con ese estilo.
    return res.status(status).json({ status: 'error', error_label: label, error: String(e?.message ?? e).slice(0, 400), ...(e?.fit ? { fit: e.fit } : {}) });
  } finally {
    try { rmSync(work, { recursive: true, force: true }); } catch { /* nada */ }
  }
}
