import { MotionStyle } from '../core/types';

export interface MotionArchetype {
  id: string;
  label: string;
  defaultMotion: MotionStyle;
  suggestedPromptSuffix: string;
}

export const MOTION_ARCHETYPES: MotionArchetype[] = [
  {
    id: "product_reveal",
    label: "Product Reveal",
    defaultMotion: "dolly_in",
    suggestedPromptSuffix: "slow cinematic reveal, macro detail, studio lighting"
  },
  {
    id: "lifestyle_scene",
    label: "Lifestyle Scene",
    defaultMotion: "handheld",
    suggestedPromptSuffix: "natural lighting, candid movement, high quality"
  },
  {
    id: "testimonial",
    label: "Testimonial",
    defaultMotion: "static",
    suggestedPromptSuffix: "medium shot, talking to camera, soft background blur"
  },
  {
    id: "before_after",
    label: "Before & After",
    defaultMotion: "pan",
    suggestedPromptSuffix: "split screen transition, side by side comparison"
  },
  {
    id: "tutorial_step",
    label: "Tutorial Step",
    defaultMotion: "static",
    suggestedPromptSuffix: "top-down view, clear demonstration, bright lighting"
  },
  {
    id: "brand_logo",
    label: "Brand Logo",
    defaultMotion: "dolly_out",
    suggestedPromptSuffix: "clean background, logo center, professional finish"
  },
  {
    id: "ambient_loop",
    label: "Ambient Loop",
    defaultMotion: "static",
    suggestedPromptSuffix: "seamless loop, subtle background movement, atmospheric"
  },
  {
    id: "cta_closer",
    label: "CTA Closer",
    defaultMotion: "static",
    suggestedPromptSuffix: "text overlay, call to action, clean graphics"
  }
];
