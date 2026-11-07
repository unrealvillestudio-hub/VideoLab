// VIDEOLAB · RENDER PROPIO — el Cloud Run Job. Una ejecución = un job de `lab_jobs` (variable JOB_ID).
//
// Orden (contrato docs/CONTRACT.md): reclama el job → resuelve preset, productor, lienzo y tarifa (todo dato;
// sin tarifa no se trabaja) → baja imagen(es) y audio → pide la capa de texto a ImageLab por su api_endpoint →
// ffmpeg → valida con ffprobe → sube MP4 y portada → asienta el costo → cierra el job. Cualquier falla deja el
// job en `failed` con su error_label.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, writeFileSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as S from './supa.mjs';
import { planRender, resolvePreset, resolveCanvas, overlayTextFrom, validateOutput, RenderError, SPEC } from './plan.mjs';

const run = promisify(execFile);
const LAB = 'videolab';
const PRODUCER = 'render';
const RATE_MODEL = 'videolab-render-cloud-run';

const enc = encodeURIComponent;

async function ffprobe(path) {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', path]);
  return JSON.parse(stdout);
}

async function audioMs(path) {
  const p = await ffprobe(path);
  return Math.round(Number(p.format?.duration ?? 0) * 1000);
}

export async function renderJob(jobId, env = process.env) {
  const t0 = Date.now();
  const cfg = S.config(env);
  const [job] = await S.select(cfg, `lab_jobs?id=eq.${enc(jobId)}&select=*`);
  if (!job) throw new Error(`job ${jobId} no existe`);
  await S.patch(cfg, 'lab_jobs', `id=eq.${enc(jobId)}`, { status: 'running', claimed_at: new Date().toISOString() });

  const req = job.payload ?? {};
  const brandId = req.brandId ?? job.brand_id;
  const params = req.params ?? {};
  const prev = req.previousOutputs ?? {};
  const pieceId = req.pieceId ?? null;
  const work = mkdtempSync(join(tmpdir(), 'videolab-'));

  try {
    if (!brandId || !params.platform || params.format !== 'reel' || !params.video_style) {
      throw new RenderError('VIDEOLAB_BAD_REQUEST', 'faltan brandId, params.platform, params.format=reel o params.video_style');
    }

    // Dato: preset, productor, lienzo, tarifa y el endpoint de ImageLab.
    const rows = await S.select(cfg, `videolab_params?format=eq.reel&video_style=eq.${enc(params.video_style)}` +
      `&or=(brand_id.is.null,brand_id.eq.${enc(brandId)})&select=*`);
    const preset = resolvePreset(rows, brandId, params.video_style);
    const producer = params.producer ?? preset.producer;
    if (producer !== PRODUCER) throw new RenderError('VIDEOLAB_PRODUCER_NOT_ACTIVE', `este job fabrica ${PRODUCER}, se pidió ${producer}`);
    const [prod] = await S.select(cfg, `videolab_producers?producer=eq.${PRODUCER}&select=*`);
    if (!prod?.active) throw new RenderError('VIDEOLAB_PRODUCER_NOT_ACTIVE', `el productor ${PRODUCER} no está activo`);
    const [profile] = await S.select(cfg, `platform_format_profiles?platform=eq.${enc(params.platform)}&format=eq.reel&active=eq.true&select=*`, 'intel');
    const canvas = resolveCanvas(params.canvas ?? null, profile);
    const rate = (await S.rpc(cfg, 'ops_resolve_rate', { p_lab: LAB, p_model_id: RATE_MODEL, p_unit_type: 'per_second', p_at: new Date().toISOString().slice(0, 10) }))?.[0];
    if (!rate?.rate_usd) throw new RenderError('VIDEOLAB_PROVIDER_FAILED', `sin tarifa vigente de ${RATE_MODEL} en ops_lab_rates`);
    const [il] = await S.select(cfg, `lab_configs?lab_key=eq.imagelab&select=api_endpoint`);
    if (!il?.api_endpoint) throw new RenderError('VIDEOLAB_PROVIDER_FAILED', 'lab_configs no tiene el api_endpoint de imagelab');

    // Entradas.
    const imgs = [prev.image, ...(prev.images ?? [])].filter((x) => x?.url);
    const imagePaths = [];
    for (const [i, im] of imgs.entries()) {
      const p = join(work, `img${i}`);
      writeFileSync(p, await S.download(im.url, `imagen ${i}`));
      imagePaths.push(p);
    }
    let voice = null;
    if (prev.voice?.audio_url) {
      const p = join(work, 'voice.audio');
      writeFileSync(p, await S.download(prev.voice.audio_url, 'voz'));
      voice = { path: p, ms: Number(prev.voice.duration_ms) || await audioMs(p) };
    }
    let music = null;
    if (prev.music?.audio_url) {
      const p = join(work, 'music.audio');
      writeFileSync(p, await S.download(prev.music.audio_url, 'música'));
      music = { path: p };
    }
    if (!imagePaths.length) throw new RenderError('VIDEOLAB_BAD_REQUEST', 'previousOutputs no trae imagen');

    // El primer fotograma al lienzo exacto (cubre y centra): sobre él decide ImageLab dónde va el texto.
    const base = `videolab/${brandId}/${pieceId ?? 'sin-pieza'}/${jobId}`;
    const frame0 = join(work, 'frame0.png');
    await run('ffmpeg', ['-loglevel', 'error', '-y', '-i', imagePaths[0], '-vf',
      `scale=${canvas.width}:${canvas.height}:force_original_aspect_ratio=increase,crop=${canvas.width}:${canvas.height}`,
      '-frames:v', '1', frame0]);
    const frameUrl = await S.upload(cfg, `${base}/frame0.png`, readFileSync(frame0), 'image/png');

    // La capa de texto: la dibuja ImageLab con las reglas de la marca. Sin titular no hay capa.
    const txt = overlayTextFrom(prev.on_screen_text);
    let layer = null;
    let layerMeta = null;
    if (txt.headline) {
      const res = await fetch(`${il.api_endpoint.replace(/\/+$/, '')}/api/compose`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brand_id: brandId, canal: String(params.platform).toUpperCase(), image_url: frameUrl,
          headline: txt.headline, ...(txt.subheadline ? { subheadline: txt.subheadline } : {}),
          ...(txt.emphasis?.length ? { emphasis: txt.emphasis } : {}), piece_id: pieceId, output: 'text_layer' }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok || !out.layer_data_url) {
        throw new RenderError('VIDEOLAB_PROVIDER_FAILED', `ImageLab compose ${res.status} ${out.error_label ?? ''} ${String(out.error ?? '').slice(0, 200)}`);
      }
      if (out.width !== canvas.width || out.height !== canvas.height) {
        throw new RenderError('VIDEOLAB_CANVAS_MISMATCH', `la capa mide ${out.width}x${out.height}`);
      }
      layer = join(work, 'layer.png');
      writeFileSync(layer, Buffer.from(String(out.layer_data_url).split(',')[1], 'base64'));
      layerMeta = { compositor_version: out.compositor_version, text_rect: out.text_rect ?? null, markers: out.markers ?? [] };
    }

    // Render.
    const outPath = join(work, 'out.mp4');
    const { args, durationS } = planRender({ preset, canvas, inputs: { images: imagePaths, layer, voice, music, out: outPath } });
    await run('ffmpeg', ['-loglevel', 'error', ...args], { maxBuffer: 1 << 26 });
    const bytes = statSync(outPath).size;
    const probe = await ffprobe(outPath);
    const fallas = validateOutput(probe, canvas, bytes);
    if (fallas.length) throw new RenderError('VIDEOLAB_OUTPUT_INVALID', fallas.join('; '));
    const poster = join(work, 'poster.jpg');
    await run('ffmpeg', ['-loglevel', 'error', '-y', '-ss', String(Math.min(1.5, durationS / 2)), '-i', outPath, '-frames:v', '1', '-q:v', '3', poster]);

    const url = await S.upload(cfg, `${base}.mp4`, readFileSync(outPath), 'video/mp4');
    const posterUrl = await S.upload(cfg, `${base}.jpg`, readFileSync(poster), 'image/jpeg');

    // Costo: segundos de cómputo del job a la tarifa vigente.
    const seconds = Math.round((Date.now() - t0) / 100) / 10;
    const cost = Math.round(seconds * Number(rate.rate_usd) * 1e6) / 1e6;
    // El libro se escribe por ops_log_generation (SECURITY DEFINER), igual que los demás labs: service_role no
    // tiene INSERT directo sobre ops_generation_ledger [medido 2026-11-07].
    const ledgerId = await S.rpc(cfg, 'ops_log_generation', {
      p_lab: LAB, p_brand_id: brandId, p_job_id: jobId, p_piece_id: pieceId, p_output_type: 'video_render',
      p_platform: params.platform, p_provider: 'google', p_model_id: RATE_MODEL, p_unit_type: 'per_second',
      p_input_units: seconds, p_output_units: durationS, p_cost_usd: cost, p_service_id: 'cloud_run',
      p_status: 'success', p_duration_ms: Date.now() - t0, p_rate_in: rate.rate_usd,
      p_rate_source: `ops_lab_rates:${rate.rate_id}`, p_rate_effective_at: rate.effective_from,
      p_source_app: 'videolab-render', p_billable: 'refacturable', p_modo_cobro: 'estandar',
    });

    const v = probe.streams.find((s) => s.codec_type === 'video');
    const output = {
      video: { url, storage_path: `${base}.mp4`, poster_url: posterUrl, width: v.width, height: v.height, fps: SPEC.fps,
        duration_ms: Math.round(Number(probe.format.duration) * 1000), codec: 'h264', audio: true, bytes },
      video_style: params.video_style, producer: PRODUCER, provider: 'unrlvl', model_id: RATE_MODEL,
      preset_source: preset.source, synthetic_person: false, text_layer: layerMeta, unplaced_text: txt.unplaced,
      cost_usd: cost, ledger_ids: [ledgerId].filter(Boolean),
    };
    await S.patch(cfg, 'lab_jobs', `id=eq.${enc(jobId)}`, { status: 'completed', output_parsed: output, completed_at: new Date().toISOString() });
    return output;
  } catch (e) {
    const label = e instanceof RenderError ? e.label : 'VIDEOLAB_PROVIDER_FAILED';
    await S.patch(cfg, 'lab_jobs', `id=eq.${enc(jobId)}`, {
      status: 'failed', error_msg: `${label}: ${String(e?.message ?? e).slice(0, 500)}`,
      output_parsed: { error_label: label }, completed_at: new Date().toISOString(),
    }).catch(() => {});
    throw e;
  }
}

// Punto de entrada del Cloud Run Job.
if (import.meta.url === `file://${process.argv[1]}`) {
  const jobId = process.env.JOB_ID;
  if (!jobId) { console.error('JOB_ID no configurado'); process.exit(2); }
  renderJob(jobId)
    .then((o) => { console.log(JSON.stringify({ job: jobId, status: 'completed', url: o.video.url, cost_usd: o.cost_usd })); })
    .catch((e) => { console.error(JSON.stringify({ job: jobId, status: 'failed', error: String(e?.message ?? e) })); process.exit(1); });
}
