/**
 * VideoLabContext.tsx
 * React context that loads all VideoLab data from Supabase on mount.
 * Falls back to hardcoded config automatically if Supabase is unreachable.
 *
 * Usage:
 *   <VideoLabProvider>
 *     <StoryboardModule />
 *   </VideoLabProvider>
 *
 *   const { brands, persons, locations, isLoading } = useVideoLab();
 */

import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { loadVideoLabData, VideoLabBrand, VideoLabData, FALLBACK_DATA } from '../services/videoLabLoader';
import { PersonBlueprint, LocationBlueprint } from '../core/types';

// ---------------------------------------------------------------------------
// CONTEXT SHAPE
// ---------------------------------------------------------------------------

interface VideoLabContextValue {
  brands: VideoLabBrand[];
  persons: PersonBlueprint[];
  locations: LocationBlueprint[];
  isLoading: boolean;
  error: string | null;
  source: 'supabase' | 'fallback' | null;
}

const VideoLabContext = createContext<VideoLabContextValue>({
  brands: [],
  persons: [],
  locations: [],
  isLoading: true,
  error: null,
  source: null,
});

// ---------------------------------------------------------------------------
// PROVIDER
// ---------------------------------------------------------------------------

interface VideoLabProviderProps {
  children: ReactNode;
}

export function VideoLabProvider({ children }: VideoLabProviderProps) {
  const [data, setData] = useState<VideoLabData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<'supabase' | 'fallback' | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      setError(null);

      try {
        const loaded = await loadVideoLabData();

        if (!cancelled) {
          setData(loaded);
          setSource('supabase');
          console.info(
            `[VideoLabContext] Supabase loaded — ${loaded.brands.length} brands, ` +
            `${loaded.persons.length} persons, ${loaded.locations.length} locations`
          );
        }
      } catch (err: any) {
        if (!cancelled) {
          console.warn('[VideoLabContext] Supabase failed, using fallback:', err.message);
          setData(FALLBACK_DATA);
          setSource('fallback');
          setError(err.message);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, []);

  const value: VideoLabContextValue = {
    brands: data?.brands ?? [],
    persons: data?.persons ?? [],
    locations: data?.locations ?? [],
    isLoading,
    error,
    source,
  };

  return (
    <VideoLabContext.Provider value={value}>
      {children}
    </VideoLabContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// HOOK
// ---------------------------------------------------------------------------

export function useVideoLab(): VideoLabContextValue {
  const ctx = useContext(VideoLabContext);
  if (!ctx) throw new Error('useVideoLab must be used inside <VideoLabProvider>');
  return ctx;
}
