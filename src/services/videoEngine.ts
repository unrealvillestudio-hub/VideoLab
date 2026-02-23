import { StoryboardFrame, BrandProfile, VideoFormat, MotionStyle, VideoPackSpec, VideoPackRequest } from '../core/types';

/**
 * Utility for retrying failed API calls with exponential backoff.
 * Specifically handles 429 (Rate Limit) and 503 (Service Unavailable).
 */
export async function withRetry<T>(fn: () => Promise<T>, retries = 3, delay = 1000): Promise<T> {
  try {
    return await fn();
  } catch (error: any) {
    const status = error?.status || error?.response?.status;
    if (retries > 0 && (status === 429 || status === 503)) {
      console.warn(`[VideoEngine] Request failed with ${status}. Retrying in ${delay}ms... (${retries} left)`);
      await new Promise(resolve => setTimeout(resolve, delay));
      return withRetry(fn, retries - 1, delay * 2);
    }
    throw error;
  }
}

/**
 * Constructs a highly descriptive text prompt for a single video frame.
 * Integrates brand identity, motion style, and technical constraints.
 */
export function generateVideoFramePrompt(params: {
  frame: StoryboardFrame,
  brand: BrandProfile,
  packFormat: VideoFormat,
  motionStyle: MotionStyle
}): string {
  const { frame, brand, packFormat, motionStyle } = params;
  
  const formatDesc = packFormat.includes('9x16') ? "vertical mobile orientation" : "cinematic widescreen";
  const motionDesc = {
    static: "fixed camera, no movement",
    dolly_in: "smooth camera push-in towards the subject",
    dolly_out: "smooth camera pull-back away from the subject",
    handheld: "dynamic handheld camera movement with natural shake",
    drone: "wide aerial drone shot with sweeping movement",
    pan: "smooth horizontal camera pan"
  }[motionStyle];

  const promptParts = [
    `[Video Frame: ${frame.label}]`,
    `Scene: ${frame.prompt}`,
    `Brand Context: ${brand.name} (${brand.industry}), ${brand.visualStyle} aesthetic.`,
    `Target Audience: ${brand.targetAudience}.`,
    `Technical: ${formatDesc}, ${motionDesc}.`,
    `Tone: ${brand.tone || 'professional'}.`,
    frame.text_overlay ? `Overlay Text: "${frame.text_overlay}"` : ""
  ].filter(Boolean);

  return promptParts.join(" | ");
}

/**
 * Builds the complete request payload for a multi-frame video pack.
 */
export function buildVideoPackRequest(pack: VideoPackSpec, brand: BrandProfile): VideoPackRequest {
  return {
    packId: pack.id,
    format: pack.format,
    brandName: brand.name,
    totalDuration: pack.duration_seconds,
    frames: pack.frames.map(frame => ({
      id: frame.id,
      prompt: generateVideoFramePrompt({
        frame,
        brand,
        packFormat: pack.format,
        motionStyle: frame.motion_style
      }),
      duration: frame.duration_seconds,
      motion: frame.motion_style
    }))
  };
}
