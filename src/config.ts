/** Global tuning knobs. Everything in world units (1 unit ≈ half a kart length). */

export const WORLD = {
  /** Radius of the (very) tiny planet the race takes place on. */
  planetRadius: 28,
  /** Half of the road width. */
  trackHalfWidth: 4.4,
  /** Number of evenly spaced samples along the track centreline. */
  trackSamples: 2400,
  seed: 20260927,
} as const;

export const RACE = {
  laps: 5,
  racerCount: 8,
  countdownSeconds: 3,
} as const;

/** Fixed simulation step. Rendering interpolates nothing; 120 Hz is smooth enough. */
export const SIM_STEP = 1 / 120;

export type EngineClass = '50cc' | '100cc' | '150cc';

export interface EngineClassSettings {
  speedScale: number;
  /** Range of AI skill multipliers applied to their top speed. */
  aiSkill: readonly [number, number];
}

export const ENGINE_CLASSES: Record<EngineClass, EngineClassSettings> = {
  '50cc': { speedScale: 0.85, aiSkill: [0.86, 0.93] },
  '100cc': { speedScale: 1.0, aiSkill: [0.92, 0.98] },
  '150cc': { speedScale: 1.14, aiSkill: [0.97, 1.02] },
};
