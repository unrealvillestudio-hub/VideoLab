/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// --- GENERIC TYPES (ImageLab Heritage) ---

export type TabId = 'generate' | 'library' | 'history' | 'settings';

export type LibraryAssetKind = 'video' | 'image' | 'audio';

export type PersonType = 'realistic' | 'cinematic' | 'stylized' | 'anime' | '3d_render';

export type AspectRatio = '1:1' | '16:9' | '9:16' | '4:3' | '3:4';

export type CreativityLevel = 'low' | 'medium' | 'high' | 'maximum';

export type VarietyStrength = 'subtle' | 'moderate' | 'strong' | 'extreme';

export interface DebugMetadata {
  seed?: number;
  model_version?: string;
  generation_time_ms?: number;
  steps?: number;
  guidance_scale?: number;
  [key: string]: any;
}

export interface LibraryAsset {
  id: string;
  kind: LibraryAssetKind;
  url: string;
  thumbUrl?: string;
  prompt: string;
  timestamp: number;
  metadata?: DebugMetadata;
  tags?: string[];
}

export interface SessionOutput {
  id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress: number;
  error?: string;
  result?: LibraryAsset;
  brand?: string;
  pack?: string;
  request?: VideoPackRequest;
  timestamp?: number;
}

export const ASPECT_RATIOS: { label: string; value: AspectRatio }[] = [
  { label: '1:1 Square', value: '1:1' },
  { label: '16:9 Cinematic', value: '16:9' },
  { label: '9:16 Vertical', value: '9:16' },
  { label: '4:3 Classic', value: '4:3' },
  { label: '3:4 Portrait', value: '3:4' },
];

export const VARIANT_OPTIONS: { label: string; value: VarietyStrength }[] = [
  { label: 'Subtle', value: 'subtle' },
  { label: 'Moderate', value: 'moderate' },
  { label: 'Strong', value: 'strong' },
  { label: 'Extreme', value: 'extreme' },
];

export interface ValidationError {
  field: string;
  message: string;
}

export type PreflightStatus = 'idle' | 'checking' | 'ready' | 'error';

// --- VIDEOLAB SPECIALTY TYPES ---

export type MotionStyle = "static" | "dolly_in" | "dolly_out" | "handheld" | "drone" | "pan";

export type VideoFormat = "reel_9x16" | "youtube_16x9" | "square_1x1" | "story_9x16";

export type CutRhythm = "slow" | "medium" | "fast" | "dynamic";

export interface StoryboardFrame {
  id: string;
  label: string;
  duration_seconds: number;
  prompt: string;
  motion_style: MotionStyle;
  text_overlay?: string;
}

export interface VideoPackSpec {
  id: string;
  label: string;
  packType: string;
  format: VideoFormat;
  duration_seconds: number;
  frames: StoryboardFrame[];
}

export interface VideoOutput {
  id: string;
  label: string;
  videoUrl: string;
  thumbUrl: string;
  storyboard: StoryboardFrame[];
  metadata?: DebugMetadata;
}

export interface BrandProfile {
  name: string;
  industry: string;
  visualStyle: string;
  targetAudience: string;
  colors?: string[];
  tone?: string;
}

export interface VideoPackRequest {
  packId: string;
  format: VideoFormat;
  brandName: string;
  totalDuration: number;
  frames: {
    id: string;
    prompt: string;
    duration: number;
    motion: MotionStyle;
    speaker?: string;
    text_overlay?: string;
  }[];
}

export type ArchetypeId = 
  "studio_setup" | "car_front" | "car_rear" | 
  "street_interview" | "salon_workshop" | "event_stage" | 
  "single_talking_head";

export interface PersonBlueprint {
  id: string;
  brandId: string;
  displayName: string;
  role_default: "HOST" | "GUEST" | "BOTH";
  status: "active" | "draft";
  imagelab: {
    description: string;
    style: string;
    realism_level: string;
    skin_detail: string;
    film_look: string;
    lens_preset: string;
    depth_of_field: string;
    avatar_preset?: string;
    has_reference_photos: boolean;
    reference_photos_path: string;
  };
  voicelab: {
    voice_id: string;
    language: string;
    emotion_base: string;
    speed: number;
    script_style: string;
    speaking_style: string;
  };
  expertise: string;
  compliance_notes?: string;
  compatible_archetypes: string[];
}

export interface LocationBlueprint {
  id: string;
  brandId: string;
  displayName: string;
  locationType: "salon" | "workshop" | "exterior_urban" | 
                "exterior_coastal" | "event_stage" | "studio" | "residential";
  city: string;
  country: string;
  status: "active" | "draft";
  visual: {
    description: string;
    materials: string[];
    color_palette: string[];
    lighting: string;
    time_of_day_best: string;
    signature_elements: string[];
  };
  has_reference_photos: boolean;
  reference_photos_path: string;
  imagelab: {
    realism_level: string;
    film_look: string;
    lens_preset: string;
    depth_of_field: string;
    framing: string;
  };
  compatible_archetypes: ArchetypeId[];
  recommended_angles: string[];
}

export interface StoryboardExport {
  version: "VP_1.0";
  episode_id: string;
  brand_id: string;
  archetype: ArchetypeId;
  personas: {
    a?: { id: string; role: string };
    b?: { id: string; role: string };
  };
  location_id: string;
  brief: string;
  videolab_params: {
    motion_style: MotionStyle;
    cut_rhythm: CutRhythm;
    music_mood: string;
  };
  frames: StoryboardFrame[];
}
