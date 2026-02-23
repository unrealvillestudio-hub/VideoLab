import { MotionStyle, CutRhythm, VideoFormat } from '../core/types';

export const MOTION_PRESETS: { value: MotionStyle; label: string; description: string }[] = [
  { value: "static", label: "Static", description: "Fixed camera position, no movement." },
  { value: "dolly_in", label: "Dolly In", description: "Camera moves forward towards the subject." },
  { value: "dolly_out", label: "Dolly Out", description: "Camera moves backward away from the subject." },
  { value: "handheld", label: "Handheld", description: "Natural, slightly shaky movement for realism." },
  { value: "drone", label: "Drone", description: "Wide aerial movement with high perspective." },
  { value: "pan", label: "Pan", description: "Horizontal rotation from a fixed point." },
];

export const RHYTHM_PRESETS: { value: CutRhythm; label: string; durationRange: [number, number] }[] = [
  { value: "slow", label: "Cinematic Slow", durationRange: [3, 4] },
  { value: "medium", label: "Standard", durationRange: [2, 3] },
  { value: "fast", label: "Dynamic Fast", durationRange: [1, 2] },
];

export const FORMAT_PRESETS: Record<VideoFormat, { width: number; height: number; label: string }> = {
  "reel_9x16": { width: 1080, height: 1920, label: "9:16 Vertical" },
  "youtube_16x9": { width: 1920, height: 1080, label: "16:9 Landscape" },
  "square_1x1": { width: 1080, height: 1080, label: "1:1 Square" },
  "story_9x16": { width: 1080, height: 1920, label: "9:16 Story" },
};
