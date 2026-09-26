export type HatStyle = 'cap' | 'helmet' | 'ears' | 'antenna' | 'spikes' | 'crown' | 'bow' | 'propeller';

/** Stats on a 1–5 scale, like a character select screen. */
export interface CharacterStats {
  speed: number;
  acceleration: number;
  handling: number;
  weight: number;
}

export interface Character {
  id: string;
  name: string;
  /** Kart body and hat colour. */
  color: number;
  /** Trim colour (hubcaps, overalls). */
  accent: number;
  skin: number;
  hat: HatStyle;
  stats: CharacterStats;
}

/** Physical tuning derived from a character's stats. */
export interface KartStats {
  topSpeed: number;
  acceleration: number;
  /** Turn rate in radians per second at full lock. */
  handling: number;
  /** Relative mass used when karts bump into each other. */
  weight: number;
}

export const CHARACTERS: readonly Character[] = [
  { id: 'pip', name: 'Pip', color: 0xe8413a, accent: 0xffffff, skin: 0xffd3a8, hat: 'cap', stats: { speed: 3, acceleration: 3, handling: 3, weight: 3 } },
  { id: 'mochi', name: 'Mochi', color: 0xff7eb6, accent: 0xfff1a8, skin: 0xfff3ee, hat: 'ears', stats: { speed: 2, acceleration: 5, handling: 4, weight: 1 } },
  { id: 'bolt', name: 'Bolt', color: 0xffc928, accent: 0x333a45, skin: 0xffd3a8, hat: 'helmet', stats: { speed: 5, acceleration: 2, handling: 2, weight: 4 } },
  { id: 'ziggy', name: 'Ziggy', color: 0x8e5cff, accent: 0x49f0c6, skin: 0xb6f29a, hat: 'antenna', stats: { speed: 3, acceleration: 4, handling: 5, weight: 2 } },
  { id: 'rex', name: 'Rex', color: 0x35b24a, accent: 0xfff6d5, skin: 0x8fd672, hat: 'spikes', stats: { speed: 4, acceleration: 2, handling: 3, weight: 5 } },
  { id: 'nova', name: 'Nova', color: 0x22c3e6, accent: 0xffffff, skin: 0xf2c19b, hat: 'crown', stats: { speed: 4, acceleration: 3, handling: 3, weight: 3 } },
  { id: 'coco', name: 'Coco', color: 0xff8c2b, accent: 0x6b3b1f, skin: 0xc98b5e, hat: 'bow', stats: { speed: 2, acceleration: 4, handling: 4, weight: 2 } },
  { id: 'blu', name: 'Blu', color: 0x2f5ee8, accent: 0xffd23f, skin: 0xffe0bd, hat: 'propeller', stats: { speed: 3, acceleration: 3, handling: 4, weight: 3 } },
];

export function deriveKartStats(stats: CharacterStats, speedScale: number): KartStats {
  return {
    topSpeed: (22.6 + stats.speed * 0.7) * speedScale,
    acceleration: (14 + stats.acceleration * 2.4) * speedScale,
    handling: 1.8 + stats.handling * 0.1,
    weight: 0.7 + stats.weight * 0.15,
  };
}
