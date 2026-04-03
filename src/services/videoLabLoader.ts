/**
 * videoLabLoader.ts
 * Loads VideoLab data from Supabase with automatic fallback to hardcoded config.
 * Pattern: same as ImageLab brandLoader.ts — raw fetch, no SDK, parallel queries.
 */

import { PersonBlueprint, LocationBlueprint } from '../core/types';
import { BRANDS } from '../config/brands';
import { PERSON_BLUEPRINTS } from '../config/personBlueprints';
import { LOCATION_BLUEPRINTS } from '../config/locationBlueprints';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

// ---------------------------------------------------------------------------
// TYPES
// ---------------------------------------------------------------------------

/**
 * VideoLabBrand — the shape VideoLab uses internally.
 * Compatible with BrandProfile (videoEngine.ts uses name/industry/visualStyle/tone).
 * Extends it with id (for Supabase FK matching) and videolab-specific defaults.
 */
export interface VideoLabBrand {
  id: string;                  // canonical Supabase PK — use this for filtering persons/locations
  name: string;                // display_name — used in prompt generation
  industry: string;
  visualStyle: string;         // visual_identity / imagelab_visual_identity
  targetAudience: string;      // icp / buyer_persona
  tone: string;                // tono_base
  // Videolab defaults (auto-applied when brand is selected)
  motionStyleDefault: string;
  durationDefault: number;
  aspectRatio: string;
  musicMood: string;
  modelPreferred: string;
  cutRhythm: string;
}

export interface VideoLabData {
  brands: VideoLabBrand[];
  persons: PersonBlueprint[];
  locations: LocationBlueprint[];
}

// ---------------------------------------------------------------------------
// MAPPERS — Supabase row → app type
// ---------------------------------------------------------------------------

function mapBrand(row: any): VideoLabBrand {
  return {
    id: row.id,
    name: row.display_name,
    industry: row.industry || 'general',
    visualStyle: row.visual_identity || row.imagelab_visual_identity || '',
    targetAudience: row.icp || row.buyer_persona || '',
    tone: row.tono_base || 'professional',
    motionStyleDefault: row.videolab_motion_style_default || 'static',
    durationDefault: row.videolab_duration_default || 15,
    aspectRatio: row.videolab_aspect_ratio || '9:16',
    musicMood: row.videolab_music_mood || 'none',
    modelPreferred: row.videolab_model_preferred || 'kling',
    cutRhythm: row.videolab_cut_rhythm || 'medium',
  };
}

function mapPerson(row: any): PersonBlueprint {
  // raw_config may contain the full hardcoded blueprint if it was migrated
  const raw = row.raw_config || {};

  return {
    id: row.blueprint_id || row.id,
    brandId: row.brand_id,
    displayName: row.display_name,
    role_default: row.role_default || 'BOTH',
    status: row.status || 'active',
    imagelab: {
      description: row.imagelab_description || raw.imagelab?.description || '',
      style: row.imagelab_style || raw.imagelab?.style || '',
      realism_level: row.imagelab_realism || raw.imagelab?.realism_level || 'editorial_clean',
      skin_detail: raw.imagelab?.skin_detail || 'realistic',
      film_look: row.imagelab_film_look || raw.imagelab?.film_look || 'digital_clean',
      lens_preset: row.imagelab_lens || raw.imagelab?.lens_preset || '50mm_lifestyle',
      depth_of_field: row.imagelab_dof || raw.imagelab?.depth_of_field || 'shallow',
      has_reference_photos: row.has_reference_photos || false,
      reference_photos_path: raw.imagelab?.reference_photos_path || '',
    },
    voicelab: {
      voice_id: raw.voicelab?.voice_id || 'TBD',
      language: raw.voicelab?.language || 'es-ES',
      emotion_base: raw.voicelab?.emotion_base || 'warm',
      speed: raw.voicelab?.speed || 1.0,
      script_style: raw.voicelab?.script_style || 'conversational',
      speaking_style: row.speaking_style || raw.voicelab?.speaking_style || '',
    },
    expertise: row.expertise || raw.expertise || '',
    compliance_notes: row.compliance_notes || raw.compliance_notes || '',
    compatible_archetypes: row.compatible_archetypes || raw.compatible_archetypes || [],
  };
}

function mapLocation(row: any): LocationBlueprint {
  const raw = row.raw_config || {};

  return {
    id: row.blueprint_id || row.id,
    // loc_generic_event_stage is stored under PatriciaOsorioPersonal in DB but belongs to all brands
    brandId: row.blueprint_id === 'loc_generic_event_stage' ? 'GENERIC' : row.brand_id,
    displayName: row.display_name,
    locationType: row.location_type || 'generic',
    city: row.city || '',
    country: row.country || '',
    status: row.status || 'active',
    visual: {
      description: row.visual_description || '',
      materials: row.materials || [],
      color_palette: row.color_palette || [],
      lighting: row.lighting || '',
      time_of_day_best: row.time_of_day_best || '',
      signature_elements: row.signature_elements || [],
    },
    has_reference_photos: row.has_reference_photos || false,
    reference_photos_path: raw.reference_photos_path || '',
    imagelab: {
      realism_level: row.imagelab_realism || 'editorial_clean',
      film_look: row.imagelab_film_look || 'digital_clean',
      lens_preset: row.imagelab_lens || '50mm_lifestyle',
      depth_of_field: row.imagelab_dof || 'shallow',
      framing: row.imagelab_framing || 'rule_of_thirds',
    },
    compatible_archetypes: row.compatible_archetypes || [],
    recommended_angles: row.recommended_angles || [],
  };
}

// ---------------------------------------------------------------------------
// FALLBACK — converts hardcoded BRANDS to VideoLabBrand shape
// ---------------------------------------------------------------------------

function hardcodedBrandsToVideoLab(): VideoLabBrand[] {
  return BRANDS
    .filter(b => b.id !== 'new')
    .map(b => ({
      id: b.id,
      name: b.displayName,
      industry: b.industry || 'general',
      visualStyle: b.visualIdentity || '',
      targetAudience: '',
      tone: 'professional',
      motionStyleDefault: 'static',
      durationDefault: 15,
      aspectRatio: '9:16',
      musicMood: 'none',
      modelPreferred: 'kling',
      cutRhythm: 'medium',
    }));
}

// ---------------------------------------------------------------------------
// SUPABASE FETCH — raw fetch, no SDK (matches pattern of all other labs)
// ---------------------------------------------------------------------------

async function sbFetch(table: string, params: string): Promise<any[]> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${params}`, {
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${ANON_KEY}`,
      'Content-Type': 'application/json',
    },
  });
  if (!res.ok) throw new Error(`[VideoLabLoader] ${table} fetch failed: ${res.status}`);
  return res.json();
}

// ---------------------------------------------------------------------------
// MAIN LOADER
// ---------------------------------------------------------------------------

/**
 * Loads all VideoLab data from Supabase in parallel (4 queries).
 * Throws on failure — caller should handle with fallback.
 */
export async function loadVideoLabData(): Promise<VideoLabData> {
  const [brandsRaw, personsRaw, locationsRaw] = await Promise.all([
    // Brands with videolab params configured + relevant fields for prompt generation
    sbFetch(
      'brands',
      [
        'select=id,display_name,industry,visual_identity,imagelab_visual_identity,icp,buyer_persona,tono_base',
        ',videolab_motion_style_default,videolab_duration_default,videolab_aspect_ratio',
        ',videolab_music_mood,videolab_model_preferred,videolab_cut_rhythm',
        '&videolab_motion_style_default=not.is.null',
        '&status=eq.active',
        '&id=neq.DEFAULT',
        '&order=display_name.asc',
      ].join('')
    ),
    // All active person blueprints
    sbFetch(
      'person_blueprints',
      [
        'select=id,blueprint_id,brand_id,display_name,role_default,status',
        ',imagelab_description,imagelab_style,imagelab_realism,imagelab_film_look',
        ',imagelab_lens,imagelab_dof,has_reference_photos,compatible_archetypes',
        ',speaking_style,expertise,compliance_notes,raw_config',
        '&active=eq.true',
        '&order=brand_id.asc,display_name.asc',
      ].join('')
    ),
    // All active location blueprints
    sbFetch(
      'location_blueprints',
      [
        'select=id,blueprint_id,brand_id,display_name,location_type,city,country,status',
        ',visual_description,materials,color_palette,lighting,time_of_day_best,signature_elements',
        ',imagelab_realism,imagelab_film_look,imagelab_lens,imagelab_dof,imagelab_framing',
        ',compatible_archetypes,recommended_angles,has_reference_photos,raw_config',
        '&active=eq.true',
        '&order=brand_id.asc,display_name.asc',
      ].join('')
    ),
  ]);

  return {
    brands: brandsRaw.map(mapBrand),
    persons: personsRaw.map(mapPerson),
    locations: locationsRaw.map(mapLocation),
  };
}

// ---------------------------------------------------------------------------
// FILTER HELPERS (replaces hardcoded getBlueprintsByBrand / getLocationsByBrand)
// ---------------------------------------------------------------------------

export function getPersonsByBrand(persons: PersonBlueprint[], brandId: string): PersonBlueprint[] {
  return persons.filter(p => p.brandId === brandId && p.status === 'active');
}

export function getLocationsByBrandId(locations: LocationBlueprint[], brandId: string): LocationBlueprint[] {
  return locations.filter(
    l => (l.brandId === brandId || l.brandId === 'GENERIC') && l.status === 'active'
  );
}

// ---------------------------------------------------------------------------
// FALLBACK DATA (used when Supabase is unavailable)
// ---------------------------------------------------------------------------

export const FALLBACK_DATA: VideoLabData = {
  brands: hardcodedBrandsToVideoLab(),
  persons: PERSON_BLUEPRINTS,
  locations: LOCATION_BLUEPRINTS,
};
