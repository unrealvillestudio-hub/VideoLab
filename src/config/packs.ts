import { VideoPackSpec } from '../core/types';

export const VIDEO_PACKS: VideoPackSpec[] = [
  {
    id: "reel_15s",
    label: "Instagram/FB Reel (15s)",
    packType: "social",
    format: "reel_9x16",
    duration_seconds: 15,
    frames: [
      { id: "f1", label: "Hook", duration_seconds: 4, prompt: "", motion_style: "dolly_in" },
      { id: "f2", label: "Value", duration_seconds: 4, prompt: "", motion_style: "handheld" },
      { id: "f3", label: "Detail", duration_seconds: 4, prompt: "", motion_style: "pan" },
      { id: "f4", label: "CTA", duration_seconds: 3, prompt: "", motion_style: "static" },
    ]
  },
  {
    id: "reel_30s",
    label: "Instagram/FB Reel (30s)",
    packType: "social",
    format: "reel_9x16",
    duration_seconds: 30,
    frames: [
      { id: "f1", label: "Intro", duration_seconds: 5, prompt: "", motion_style: "drone" },
      { id: "f2", label: "Main 1", duration_seconds: 5, prompt: "", motion_style: "dolly_in" },
      { id: "f3", label: "Main 2", duration_seconds: 5, prompt: "", motion_style: "handheld" },
      { id: "f4", label: "Main 3", duration_seconds: 5, prompt: "", motion_style: "pan" },
      { id: "f5", label: "Summary", duration_seconds: 5, prompt: "", motion_style: "dolly_out" },
      { id: "f6", label: "CTA", duration_seconds: 5, prompt: "", motion_style: "static" },
    ]
  },
  {
    id: "youtube_short",
    label: "YouTube Short (60s)",
    packType: "social",
    format: "reel_9x16",
    duration_seconds: 60,
    frames: Array.from({ length: 8 }).map((_, i) => ({
      id: `f${i + 1}`,
      label: `Scene ${i + 1}`,
      duration_seconds: 7.5,
      prompt: "",
      motion_style: "handheld"
    }))
  },
  {
    id: "youtube_standard",
    label: "YouTube Standard (90s)",
    packType: "broadcast",
    format: "youtube_16x9",
    duration_seconds: 90,
    frames: Array.from({ length: 10 }).map((_, i) => ({
      id: `f${i + 1}`,
      label: `Scene ${i + 1}`,
      duration_seconds: 9,
      prompt: "",
      motion_style: "pan"
    }))
  },
  {
    id: "tiktok_15s",
    label: "TikTok Fast (15s)",
    packType: "social",
    format: "reel_9x16",
    duration_seconds: 15,
    frames: [
      { id: "f1", label: "Hook", duration_seconds: 5, prompt: "", motion_style: "dolly_in" },
      { id: "f2", label: "Action", duration_seconds: 5, prompt: "", motion_style: "handheld" },
      { id: "f3", label: "CTA", duration_seconds: 5, prompt: "", motion_style: "static" },
    ]
  },
  {
    id: "spot_30s",
    label: "Commercial Spot (30s)",
    packType: "broadcast",
    format: "youtube_16x9",
    duration_seconds: 30,
    frames: [
      { id: "f1", label: "Establish", duration_seconds: 6, prompt: "", motion_style: "drone" },
      { id: "f2", label: "Product", duration_seconds: 6, prompt: "", motion_style: "dolly_in" },
      { id: "f3", label: "Lifestyle", duration_seconds: 6, prompt: "", motion_style: "pan" },
      { id: "f4", label: "Benefit", duration_seconds: 6, prompt: "", motion_style: "handheld" },
      { id: "f5", label: "Logo/CTA", duration_seconds: 6, prompt: "", motion_style: "static" },
    ]
  }
];
