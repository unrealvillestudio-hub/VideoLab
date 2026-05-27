/**
 * VideoLab — POST /api/execute
 * v1 — Kling AI text2video, AbortController 270s, CORS *
 *
 * Mirrors the ImageLab handler pattern. Kling is async (submit → poll), so the
 * handler submits then polls within the 270s upstream budget. If the job is
 * not done in time, returns the task_id with status='pending' so the client
 * can call again with mode='poll'.
 */

import crypto from 'node:crypto';

declare const process: { env: Record<string, string | undefined> };

// NOTE: do NOT add a VITE_* fallback here. Kling credentials must stay server-side;
// any var prefixed with VITE_ is opt-in to be exposed in the client bundle by Vite.
const KLING_ACCESS_KEY = () => process.env.KLING_ACCESS_KEY ?? '';
const KLING_SECRET_KEY = () => process.env.KLING_SECRET_KEY ?? '';
const KLING_BASE_URL   = () => process.env.KLING_BASE_URL ?? 'https://api-singapore.klingai.com';
const KLING_MODEL      = () => process.env.KLING_MODEL ?? 'kling-v1';

const UPSTREAM_TIMEOUT_MS = 270_000;
const POLL_INTERVAL_MS    = 5_000;

type MotionStyle = 'static' | 'dolly_in' | 'dolly_out' | 'handheld' | 'drone' | 'pan';
type VideoFormat = 'reel_9x16' | 'youtube_16x9' | 'square_1x1' | 'story_9x16';

interface VideoPackFrame {
  id: string;
  prompt: string;
  duration: number;
  motion: MotionStyle;
  text_overlay?: string;
}

interface VideoPackRequest {
  mode?: 'submit' | 'poll';
  packId?: string;
  format?: VideoFormat;
  brandName?: string;
  totalDuration?: number;
  frames?: VideoPackFrame[];
  // direct single-frame shortcut (skips frames[])
  prompt?: string;
  negativePrompt?: string;
  aspectRatio?: string;
  duration?: number;
  cfgScale?: number;
  // poll mode
  taskId?: string;
}

// --- JWT (HS256) for Kling auth ---------------------------------------------

function b64url(buf: Buffer | string): string {
  return (typeof buf === 'string' ? Buffer.from(buf) : buf).toString('base64url');
}

function signKlingJWT(): string {
  const accessKey = KLING_ACCESS_KEY();
  const secretKey = KLING_SECRET_KEY();
  if (!accessKey || !secretKey) throw new Error('Kling credentials missing (KLING_ACCESS_KEY / KLING_SECRET_KEY)');

  const header  = { alg: 'HS256', typ: 'JWT' };
  const now     = Math.floor(Date.now() / 1000);
  const payload = { iss: accessKey, exp: now + 1800, nbf: now - 5 };

  const data = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const sig  = crypto.createHmac('sha256', secretKey).update(data).digest('base64url');
  return `${data}.${sig}`;
}

// --- Helpers ----------------------------------------------------------------

function formatToAspect(format?: VideoFormat | string): string {
  if (!format) return '16:9';
  if (format.includes('9x16')) return '9:16';
  if (format.includes('16x9')) return '16:9';
  if (format.includes('1x1'))  return '1:1';
  return '16:9';
}

function clampKlingDuration(seconds?: number): '5' | '10' {
  // Kling accepts duration 5 or 10
  return (seconds ?? 5) > 5 ? '10' : '5';
}

async function klingFetch(path: string, init: RequestInit, signal: AbortSignal): Promise<any> {
  const token = signKlingJWT();
  const res = await fetch(`${KLING_BASE_URL()}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
    signal,
  });
  const text = await res.text();
  let json: any;
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  if (!res.ok) throw new Error(`Kling ${path} -> ${res.status}: ${text.slice(0, 500)}`);
  if (json.code && json.code !== 0 && json.code !== '0') {
    throw new Error(`Kling ${path} -> code ${json.code}: ${json.message ?? text.slice(0, 200)}`);
  }
  return json;
}

// --- Submit / Poll ----------------------------------------------------------

async function submitText2Video(req: VideoPackRequest, signal: AbortSignal): Promise<string> {
  const firstFrame = req.frames?.[0];
  const prompt = (req.prompt ?? firstFrame?.prompt ?? '').trim();
  if (!prompt) throw new Error('prompt is required (either body.prompt or body.frames[0].prompt)');

  const aspectRatio = req.aspectRatio ?? formatToAspect(req.format);
  const duration    = clampKlingDuration(req.duration ?? firstFrame?.duration ?? req.totalDuration);

  const body: Record<string, any> = {
    model_name: KLING_MODEL(),
    prompt: prompt.slice(0, 2500),
    cfg_scale: req.cfgScale ?? 0.5,
    mode: 'std',
    duration,
    aspect_ratio: aspectRatio,
  };
  if (req.negativePrompt) body.negative_prompt = req.negativePrompt.slice(0, 2500);

  const result = await klingFetch('/v1/videos/text2video', {
    method: 'POST',
    body: JSON.stringify(body),
  }, signal);

  const taskId = result?.data?.task_id;
  if (!taskId) throw new Error(`Kling submit: no task_id in response (${JSON.stringify(result).slice(0, 300)})`);
  return taskId;
}

async function pollTask(taskId: string, signal: AbortSignal): Promise<{ status: string; videoUrl?: string; raw: any }> {
  const result = await klingFetch(`/v1/videos/text2video/${encodeURIComponent(taskId)}`, { method: 'GET' }, signal);
  const status   = result?.data?.task_status;
  const videoUrl = result?.data?.task_result?.videos?.[0]?.url;
  return { status, videoUrl, raw: result };
}

async function submitAndWait(req: VideoPackRequest): Promise<any> {
  const controller = new AbortController();
  const timeout    = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  const start      = Date.now();

  try {
    const taskId = await submitText2Video(req, controller.signal);

    while (Date.now() - start < UPSTREAM_TIMEOUT_MS - POLL_INTERVAL_MS) {
      await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
      const { status, videoUrl, raw } = await pollTask(taskId, controller.signal);
      if (status === 'succeed' && videoUrl) {
        return { status: 'ok', task_id: taskId, video_url: videoUrl, kling_response: raw };
      }
      if (status === 'failed') {
        return { status: 'error', task_id: taskId, error: 'Kling task failed', kling_response: raw };
      }
    }
    return {
      status: 'pending',
      task_id: taskId,
      message: `Job submitted but did not complete within ${UPSTREAM_TIMEOUT_MS / 1000}s. Re-call with { mode: 'poll', taskId }.`,
    };
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`Kling API timeout after ${UPSTREAM_TIMEOUT_MS / 1000}s`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

async function pollOnly(taskId: string): Promise<any> {
  const controller = new AbortController();
  const timeout    = setTimeout(() => controller.abort(), 30_000);
  try {
    const { status, videoUrl, raw } = await pollTask(taskId, controller.signal);
    return {
      status: status === 'succeed' && videoUrl ? 'ok' : (status === 'failed' ? 'error' : 'pending'),
      task_id: taskId,
      task_status: status,
      video_url: videoUrl ?? null,
      kling_response: raw,
    };
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('Kling poll timeout after 30s');
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

// --- Handler ----------------------------------------------------------------

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: CORS });
  }

  let body: VideoPackRequest;
  try { body = await req.json(); }
  catch { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: CORS }); }

  try {
    if (body.mode === 'poll') {
      if (!body.taskId) {
        return new Response(JSON.stringify({ error: 'taskId is required for mode=poll' }), { status: 400, headers: CORS });
      }
      const result = await pollOnly(body.taskId);
      return new Response(JSON.stringify(result), { status: 200, headers: CORS });
    }

    const result = await submitAndWait(body);
    return new Response(JSON.stringify(result), { status: 200, headers: CORS });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: msg, status: 'error' }), { status: 500, headers: CORS });
  }
}
