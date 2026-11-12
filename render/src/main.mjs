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
import { planAssemble, buildAss, clipsNeeded, sourceImages, composeAvatarDirection, avatarMargins, avatarSubject } from './assemble.mjs';
import { veoClip } from './providers/veo.mjs';
import { heygenClip, heygenLook, heygenImageClip } from './providers/heygen.mjs';
import { planPodcast, catalogById, animatedSecondsByRate, stillArgs, clipArgs } from './podcast.mjs';
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
  // El tope es del productor: suma todo lo que asentó ese productor en el mes, con cualquier motor o tarifa.
  const rows = await S.select(cfg, `ops_generation_ledger?lab=eq.${LAB}&output_type=eq.video_${enc(prod.producer)}` +
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
    const isPodcast = params.video_style === 'podcast';
    const personId = isPodcast ? null : (params.person_blueprint_id ?? null);
    if (producer === 'avatar' && personId) {
      const ok = await S.select(cfg, `person_consents?person_blueprint_id=eq.${enc(personId)}&scope=eq.avatar&authorized=is.true&revoked_at=is.null&select=id`);
      if (!ok.length) throw new RenderError('VIDEOLAB_CONSENT_MISSING', `la persona ${personId} no tiene consentimiento vigente de avatar`);
    }
    // La foto del avatar de una persona del registro sale de su ficha (person_blueprints.avatar_photo_url).
    const [person] = producer === 'avatar' && personId
      ? await S.select(cfg, `person_blueprints?id=eq.${enc(personId)}&select=avatar_photo_url,avatar_look_id`) : [];
    // Qué anima HeyGen: el look de la ficha (gemelo) con el motor del pedido o del preset, o la foto con Avatar IV.
    // La tarifa sale del motor y del tipo de look (ops_lab_rates), no de la fila genérica del productor.
    let subject = null;
    if (producer === 'avatar' && !isPodcast) {
      const lookId = person?.avatar_look_id ?? null;
      const look = lookId ? await heygenLook(lookId) : null;
      subject = avatarSubject({ lookId, look, engine: params.avatar_engine ?? preset.motion?.avatar?.engine ?? null, photoModelId: model.model_id });
      if (subject.rateModelId !== model.model_id) {
        modelRate = (await S.rpc(cfg, 'ops_resolve_rate', { p_lab: LAB, p_model_id: subject.rateModelId, p_unit_type: 'per_second', p_at: new Date().toISOString().slice(0, 10) }))?.[0];
        if (!modelRate?.rate_usd) throw new RenderError('VIDEOLAB_PROVIDER_FAILED', `sin tarifa vigente de ${subject.rateModelId} en ops_lab_rates`);
        model = { ...model, model_id: subject.rateModelId };
      }
    }
    const [profile] = await S.select(cfg, `platform_format_profiles?platform=eq.${enc(params.platform)}&format=eq.reel&active=eq.true&select=*`, 'intel');
    const canvas = resolveCanvas(params.canvas ?? null, profile);
    const rate = (await S.rpc(cfg, 'ops_resolve_rate', { p_lab: LAB, p_model_id: RATE_MODEL, p_unit_type: 'per_second', p_at: new Date().toISOString().slice(0, 10) }))?.[0];
    if (!rate?.rate_usd) throw new RenderError('VIDEOLAB_PROVIDER_FAILED', `sin tarifa vigente de ${RATE_MODEL} en ops_lab_rates`);
    const [il] = await S.select(cfg, `lab_configs?lab_key=eq.imagelab&select=api_endpoint`);
    if (!il?.api_endpoint) throw new RenderError('VIDEOLAB_PROVIDER_FAILED', 'lab_configs no tiene el api_endpoint de imagelab');

    // Podcast (v1.1.0): el estudio, sus tomas y el elenco son dato; el plan se valida entero ANTES de gastar.
    let pod = null;
    if (isPodcast) {
      if (producer !== 'avatar') throw new RenderError('VIDEOLAB_BAD_REQUEST', 'el podcast se fabrica con el productor avatar');
      const locId = params.location_blueprint_id;
      const [loc] = locId ? await S.select(cfg, `location_blueprints?blueprint_id=eq.${enc(locId)}&active=eq.true&select=blueprint_id,raw_config`) : [];
      if (!loc) throw new RenderError('VIDEOLAB_BAD_REQUEST', `el estudio ${locId} no existe o no está activo`);
      // La marca tiene que tener el estudio declarado (brand_locations). `active` es del carril, no de VideoLab.
      const [link] = await S.select(cfg, `brand_locations?brand_id=eq.${enc(brandId)}&location_blueprint_id=eq.${enc(locId)}&select=id`);
      if (!link) throw new RenderError('VIDEOLAB_BAD_REQUEST', `la marca ${brandId} no tiene el estudio ${locId}`);
      const plan = planPodcast({ catalog: catalogById(loc.raw_config?.shot_catalog), shots: prev.shots, turns: prev.turns,
        cast: params.cast, defaultEngine: preset.motion?.avatar?.engine ?? null });
      for (const pid of plan.speakers) {
        const ok = await S.select(cfg, `person_consents?person_blueprint_id=eq.${enc(pid)}&scope=eq.avatar&authorized=is.true&revoked_at=is.null&select=id`);
        if (!ok.length) throw new RenderError('VIDEOLAB_CONSENT_MISSING', `la persona ${pid} no tiene consentimiento vigente de avatar`);
      }
      const rates = {};
      for (const rid of Object.keys(animatedSecondsByRate(plan.segments))) {
        rates[rid] = (await S.rpc(cfg, 'ops_resolve_rate', { p_lab: LAB, p_model_id: rid, p_unit_type: 'per_second', p_at: new Date().toISOString().slice(0, 10) }))?.[0];
        if (!rates[rid]?.rate_usd) throw new RenderError('VIDEOLAB_PROVIDER_FAILED', `sin tarifa vigente de ${rid} en ops_lab_rates`);
      }
      pod = { plan, rates };
    }

    // Entradas.
    const imgs = isPodcast ? [{ url: pod.plan.segments[0].image_url }]
      : sourceImages({ producer, personId, person, prev, lookImageUrl: subject?.lookImageUrl ?? null });
    const imagePaths = [];
    for (const [i, im] of imgs.entries()) {
      const p = join(work, `img${i}`);
      writeFileSync(p, await S.download(im.url, `imagen ${i}`));
      imagePaths.push(p);
    }
    let avatarDirection = null;
    let margins = null;
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
    if (isPodcast) {
      // El tope del productor, con lo que va a cobrar cada motor.
      const secs = animatedSecondsByRate(pod.plan.segments);
      const estimado = Object.entries(secs).reduce((a, [rid, sec]) => a + sec * Number(pod.rates[rid].rate_usd), 0);
      if (prod.monthly_cap_usd != null) {
        const desde = new Date(); desde.setUTCDate(1); desde.setUTCHours(0, 0, 0, 0);
        const rows = await S.select(cfg, `ops_generation_ledger?lab=eq.${LAB}&output_type=eq.video_${enc(producer)}&generated_at=gte.${enc(desde.toISOString())}&select=cost_usd`);
        const gastado = rows.reduce((a, r) => a + Number(r.cost_usd ?? 0), 0);
        if (gastado + estimado > Number(prod.monthly_cap_usd)) throw new RenderError('VIDEOLAB_SPEND_CAP', `${producer}: gastado ${gastado.toFixed(2)} + ${estimado.toFixed(2)} > tope ${prod.monthly_cap_usd}`);
      }
      const direction = preset.motion?.avatar ?? {};
      const turnAudio = [];
      for (const [ti, t] of prev.turns.entries()) {
        const p = join(work, `turn${ti}.audio`);
        writeFileSync(p, await S.download(t.voice.audio_url, `voz del turno ${ti}`));
        turnAudio.push(p);
      }
      const parts = [];
      const shotFile = new Map();
      for (const [si, seg] of pod.plan.segments.entries()) {
        const seconds = (seg.to_ms - seg.from_ms) / 1000;
        const out = join(work, `seg${si}.mp4`);
        if (seg.mode === 'animate') {
          // El tramo de voz de este corte, subido para que HeyGen lo lea.
          const cut = join(work, `seg${si}.mp3`);
          await run('ffmpeg', ['-loglevel', 'error', '-y', '-i', turnAudio[seg.turn], '-ss', (seg.from_ms / 1000).toFixed(3), '-to', (seg.to_ms / 1000).toFixed(3), '-ar', '44100', '-b:a', '160k', cut]);
          const audioUrl = await S.upload(cfg, `${base}/seg${si}.mp3`, readFileSync(cut), 'audio/mpeg');
          const hg = await heygenImageClip({ engine: seg.engine, imageUrl: seg.image_url, audioUrl, title: `videolab ${jobId} ${si}`, direction });
          const clip = join(work, `seg${si}_hg.mp4`);
          writeFileSync(clip, hg.bytes);
          const hgS = Math.round(Number((await ffprobe(clip)).format?.duration ?? seconds) * 10) / 10;
          providerRows.push({ model: { provider: 'heygen', model_id: seg.engine.rateModelId }, rate: pod.rates[seg.engine.rateModelId], seconds: hgS });
          await run('ffmpeg', ['-loglevel', 'error', ...clipArgs({ clip, seconds, canvas, focusX: seg.focus_x, out })]);
        } else {
          if (!shotFile.has(seg.image_url)) {
            const img = join(work, `shot${shotFile.size}`);
            writeFileSync(img, await S.download(seg.image_url, `toma ${seg.shot_id}`));
            shotFile.set(seg.image_url, img);
          }
          await run('ffmpeg', ['-loglevel', 'error', ...stillArgs({ image: shotFile.get(seg.image_url), seconds, canvas, focusX: seg.focus_x,
            zoomPerFrame: Number(preset.motion?.podcast?.still_zoom_per_frame ?? 0.0006), out })]);
        }
        parts.push(out);
      }
      // Montaje: los cortes en orden, la voz de los turnos seguida, y la capa de texto encima si la hay.
      const list = join(work, 'parts.txt');
      writeFileSync(list, parts.map((x) => `file '${x}'`).join('\n'));
      const joined = join(work, 'joined.mp4');
      await run('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', joined]);
      const audioIn = turnAudio.flatMap((a) => ['-i', a]);
      const aChain = turnAudio.map((_, i) => `[${i + 1}:a]aresample=48000,aformat=channel_layouts=stereo[a${i}]`).join(';');
      const aCat = `${turnAudio.map((_, i) => `[a${i}]`).join('')}concat=n=${turnAudio.length}:v=0:a=1[aout]`;
      const vChain = layer ? `[0:v][${turnAudio.length + 1}:v]overlay=0:0,format=yuv420p[vout]` : `[0:v]format=yuv420p[vout]`;
      await run('ffmpeg', ['-loglevel', 'error', '-y', '-i', joined, ...audioIn, ...(layer ? ['-i', layer] : []),
        '-filter_complex', `${aChain};${aCat};${vChain}`, '-map', '[vout]', '-map', '[aout]',
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-r', '30', '-c:a', 'aac', '-ar', '48000', '-ac', '2', '-b:a', '160k',
        '-shortest', '-movflags', '+faststart', outPath], { maxBuffer: 1 << 26 });
      durationS = pod.plan.totalMs / 1000;
    } else if (producer === 'render') {
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
        margins = avatarMargins({ avatar: preset.motion?.avatar ?? null, words: prev.voice.alignment?.words });
        let avatarAudioUrl = prev.voice.audio_url;
        if (margins.filter) {
          const padded = join(work, 'voice_margins.mp3');
          await run('ffmpeg', ['-loglevel', 'error', '-y', '-i', voice.path, '-af', margins.filter, '-ar', '44100', '-b:a', '128k', padded]);
          avatarAudioUrl = await S.upload(cfg, `${base}/voice_margins.mp3`, readFileSync(padded), 'audio/mpeg');
        }
        durationS = renderDurationS({ preset, voiceMs: voice.ms + margins.lead + margins.tail });
        await capCheck(cfg, prod, model, modelRate, durationS);
        const catalog = preset.motion?.avatar?.picks
          ? await S.select(cfg, `videolab_avatar_direction?active=eq.true&or=(brand_id.is.null,brand_id.eq.${enc(brandId)})&select=id,brand_id,category,text`)
          : [];
        avatarDirection = composeAvatarDirection({ avatar: preset.motion?.avatar ?? null, catalog, seed: jobId });
        const hg = await heygenClip({ imageUrl: frameUrl, audioUrl: avatarAudioUrl, title: `videolab ${jobId}`, direction: avatarDirection, subject });
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
          writeFileSync(ass, buildAss({ words: margins.words.length ? margins.words : prev.voice.alignment?.words, canvas, style: { font_family: typo.font_family,
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
    await run('ffmpeg', ['-loglevel', 'error', '-y', '-ss', String(margins?.posterAtS ?? Math.min(1.5, durationS / 2)), '-i', outPath, '-frames:v', '1', '-q:v', '3', poster]);

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
      podcast: pod ? { location_blueprint_id: params.location_blueprint_id, segments: pod.plan.segments.map((g) => ({ turn: g.turn, seat: g.seat, shot_id: g.shot_id, mode: g.mode, start_ms: g.start_ms, ms: g.to_ms - g.from_ms, engine: g.mode === 'animate' ? g.engine.engine : null })) } : null,
      preset_source: preset.source, synthetic_person: producer === 'avatar' ? !personId : false,
      avatar_direction: avatarDirection ? { expressiveness: avatarDirection.expressiveness ?? null, picked: avatarDirection.picked } : null,
      avatar_subject: subject ? { mode: subject.mode, engine: subject.engine, look_id: subject.lookId, avatar_type: subject.avatarType } : null,
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

// Tope de una ejecución (contrato §1): el Cloud Run Job se despliega con --task-timeout igual a MAX_RUN_MS.
// Un minuto antes, el vigía cierra el job en `failed` con VIDEOLAB_TIMEOUT, para que ninguna fila quede en
// `running` cuando Cloud Run mate la tarea. Si la tarea muere por otra causa (memoria), el carril aplica el
// mismo tope desde `created_at`.
export const MAX_RUN_MS = 900_000;
export const WATCHDOG_MS = MAX_RUN_MS - 60_000;

// Punto de entrada del Cloud Run Job.
if (import.meta.url === `file://${process.argv[1]}`) {
  const jobId = process.env.JOB_ID;
  if (!jobId) { console.error('JOB_ID no configurado'); process.exit(2); }
  setTimeout(async () => {
    await S.patch(S.config(), 'lab_jobs', `id=eq.${enc(jobId)}&status=eq.running`, {
      status: 'failed', error_msg: `VIDEOLAB_TIMEOUT: el render superó ${WATCHDOG_MS / 1000} s`,
      output_parsed: { error_label: 'VIDEOLAB_TIMEOUT' }, completed_at: new Date().toISOString(),
    }).catch(() => {});
    console.error(JSON.stringify({ job: jobId, status: 'failed', error: 'VIDEOLAB_TIMEOUT' }));
    process.exit(1);
  }, WATCHDOG_MS).unref();
  renderJob(jobId)
    .then((o) => { console.log(JSON.stringify({ job: jobId, status: 'completed', url: o.video.url, cost_usd: o.cost_usd })); })
    .catch((e) => { console.error(JSON.stringify({ job: jobId, status: 'failed', error: String(e?.message ?? e) })); process.exit(1); });
}
