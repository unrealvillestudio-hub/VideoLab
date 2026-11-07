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
import { planRender, resolvePreset, resolveCanvas, overlayTextFrom, validateOutput, renderDurationS, RenderError, SPEC } from './plan.mjs';
import { planAssemble, buildAss, clipsNeeded } from './assemble.mjs';
import { veoClip } from './providers/veo.mjs';
import { heygenClip } from './providers/heygen.mjs';
import { brandFont } from './fonts.mjs';

const run = promisify(execFile);
const LAB = 'videolab';
const PRODUCERS = ['render', 'generative', 'avatar'];
const RATE_MODEL = 'videolab-render-cloud-run';
const SUBTITLE_DEFAULT = Object.freeze({ color: '#FFFFFF', outline_color: '#000000', role: 'body' });

const enc = encodeURIComponent;

async function ffprobe(path) {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', path]);
  return JSON.parse(stdout);
}

async function audioMs(path) {
  const p = await ffprobe(path);
  return Math.round(Number(p.format?.duration ?? 0) * 1000);
}

/**
 * Tope mensual del productor (videolab_producers.monthly_cap_usd, dato): lo gastado este mes en su modelo más lo
 * que costará esta llamada no puede pasarlo. Se comprueba ANTES de llamar al proveedor.
 */
async function capCheck(cfg, prod, model, rate, seconds) {
  if (prod.monthly_cap_usd == null) return;
  const desde = new Date(); desde.setUTCDate(1); desde.setUTCHours(0, 0, 0, 0);
  const rows = await S.select(cfg, `ops_generation_ledger?lab=eq.${LAB}&model_id=eq.${enc(model.model_id)}` +
    `&generated_at=gte.${enc(desde.toISOString())}&select=cost_usd`);
  const gastado = rows.reduce((a, r) => a + Number(r.cost_usd ?? 0), 0);
  const estimado = seconds * Number(rate.rate_usd);
  if (gastado + estimado > Number(prod.monthly_cap_usd)) {
    throw new RenderError('VIDEOLAB_SPEND_CAP', `${prod.producer}: gastado ${gastado.toFixed(2)} + ${estimado.toFixed(2)} > tope ${prod.monthly_cap_usd}`);
  }
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
    if (!PRODUCERS.includes(producer)) throw new RenderError('VIDEOLAB_PRODUCER_NOT_ACTIVE', `productor desconocido: ${producer}`);
    const [prod] = await S.select(cfg, `videolab_producers?producer=eq.${producer}&select=*`);
    if (!prod?.active) throw new RenderError('VIDEOLAB_PRODUCER_NOT_ACTIVE', `el productor ${producer} no está activo`);
    // El modelo de los productores externos sale del registro único (ops_lab_models, role = productor).
    let model = null;
    let modelRate = null;
    if (producer !== 'render') {
      [model] = await S.select(cfg, `ops_lab_models?lab=eq.${LAB}&role=eq.${producer}&active=eq.true&select=provider,model_id,location`);
      if (!model) throw new RenderError('VIDEOLAB_PRODUCER_NOT_ACTIVE', `ops_lab_models no tiene modelo activo para ${producer}`);
      modelRate = (await S.rpc(cfg, 'ops_resolve_rate', { p_lab: LAB, p_model_id: model.model_id, p_unit_type: 'per_second', p_at: new Date().toISOString().slice(0, 10) }))?.[0];
      if (!modelRate?.rate_usd) throw new RenderError('VIDEOLAB_PROVIDER_FAILED', `sin tarifa vigente de ${model.model_id}`);
    }
    // Consentimiento: una persona real (person_blueprint_id) necesita el ámbito 'avatar' vigente. Sin persona del
    // registro, la persona es sintética y no se exige.
    const personId = params.person_blueprint_id ?? null;
    if (producer === 'avatar' && personId) {
      const ok = await S.select(cfg, `person_consents?person_blueprint_id=eq.${enc(personId)}&scope=eq.avatar&authorized=is.true&revoked_at=is.null&select=id`);
      if (!ok.length) throw new RenderError('VIDEOLAB_CONSENT_MISSING', `la persona ${personId} no tiene consentimiento vigente de avatar`);
    }
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

    // Fabricación, según el productor.
    const outPath = join(work, 'out.mp4');
    let durationS;
    const providerRows = [];
    if (producer === 'render') {
      const plan = planRender({ preset, canvas, inputs: { images: imagePaths, layer, voice, music, out: outPath } });
      durationS = plan.durationS;
      await run('ffmpeg', ['-loglevel', 'error', ...plan.args], { maxBuffer: 1 << 26 });
    } else {
      let clips = [];
      let clipHasVoice = false;
      let providerSeconds = 0;
      let ass = null;
      let fontsDir = null;
      if (producer === 'generative') {
        durationS = renderDurationS({ preset, voiceMs: voice?.ms ?? null });
        const n = clipsNeeded(durationS, 8);
        await capCheck(cfg, prod, model, modelRate, n * 8);
        const imageB64 = readFileSync(frame0).toString('base64');
        for (let i = 0; i < n; i++) {
          const p = join(work, `clip${i}.mp4`);
          writeFileSync(p, await veoClip({ model: model.model_id, location: model.location || 'us-central1', prompt: prev.video_prompt,
            imageB64, durationS: 8, seed: i + 1 }));
          clips.push(p);
          providerSeconds += 8;
        }
      } else {
        if (!voice) throw new RenderError('VIDEOLAB_BAD_REQUEST', 'el productor avatar necesita la voz de VoiceLab');
        durationS = renderDurationS({ preset, voiceMs: voice.ms });
        await capCheck(cfg, prod, model, modelRate, durationS);
        const hg = await heygenClip({ imageUrl: frameUrl, audioUrl: prev.voice.audio_url, title: `videolab ${jobId}` });
        const p = join(work, 'clip0.mp4');
        writeFileSync(p, hg.bytes);
        clips = [p];
        clipHasVoice = true;
        providerSeconds = Math.round(Number((await ffprobe(p)).format?.duration ?? durationS) * 10) / 10;
        if ((preset.text_treatment ?? {}).subtitles) {
          const tt = preset.text_treatment;
          const role = tt.subtitle_role ?? SUBTITLE_DEFAULT.role;
          const [typo] = await S.select(cfg, `brand_typography?brand_id=eq.${enc(brandId)}&role=eq.${enc(role)}&select=font_family,css_import`);
          fontsDir = await brandFont({ cssImport: typo?.css_import, family: typo?.font_family, dir: join(work, 'fonts') });
          ass = join(work, 'subs.ass');
          writeFileSync(ass, buildAss({ words: prev.voice.alignment?.words, canvas, style: { font_family: typo.font_family,
            color: tt.subtitle_color ?? SUBTITLE_DEFAULT.color, outline_color: tt.subtitle_outline_color ?? SUBTITLE_DEFAULT.outline_color,
            size_pct: tt.subtitle_size_pct, margin_bottom_pct: tt.subtitle_margin_bottom_pct, max_words: tt.subtitle_max_words } }));
        }
      }
      providerRows.push({ model, rate: modelRate, seconds: providerSeconds });
      const plan = planAssemble({ preset, canvas, durationS, inputs: { clips, clipHasVoice, layer, ass, fontsDir, voice, music, out: outPath } });
      await run('ffmpeg', ['-loglevel', 'error', ...plan.args], { maxBuffer: 1 << 26 });
    }
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
    const ledgerIds = [ledgerId];
    let totalCost = cost;
    for (const r of providerRows) {
      const c = Math.round(r.seconds * Number(r.rate.rate_usd) * 1e6) / 1e6;
      totalCost += c;
      ledgerIds.push(await S.rpc(cfg, 'ops_log_generation', {
        p_lab: LAB, p_brand_id: brandId, p_job_id: jobId, p_piece_id: pieceId, p_output_type: `video_${producer}`,
        p_platform: params.platform, p_provider: r.model.provider, p_model_id: r.model.model_id, p_unit_type: 'per_second',
        p_input_units: r.seconds, p_output_units: durationS, p_cost_usd: c, p_status: 'success',
        p_rate_in: r.rate.rate_usd, p_rate_source: `ops_lab_rates:${r.rate.rate_id}`, p_rate_effective_at: r.rate.effective_from,
        p_source_app: 'videolab-render', p_billable: 'refacturable', p_modo_cobro: 'estandar',
      }));
    }

    const v = probe.streams.find((s) => s.codec_type === 'video');
    const output = {
      video: { url, storage_path: `${base}.mp4`, poster_url: posterUrl, width: v.width, height: v.height, fps: SPEC.fps,
        duration_ms: Math.round(Number(probe.format.duration) * 1000), codec: 'h264', audio: true, bytes },
      video_style: params.video_style, producer, provider: model?.provider ?? 'unrlvl', model_id: model?.model_id ?? RATE_MODEL,
      preset_source: preset.source, synthetic_person: producer === 'avatar' ? !personId : false,
      text_layer: layerMeta, unplaced_text: txt.unplaced,
      cost_usd: Math.round(totalCost * 1e6) / 1e6, ledger_ids: ledgerIds.filter(Boolean),
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
