import { Vector3 } from 'three';
import { createRng, fbm3, randRange, randomUnitVector, smoothstep, type Rng } from '../core/math';
import type { Track } from './Track';

export type ObstacleKind = 'tree' | 'pine' | 'mushroom' | 'rock' | 'windmill' | 'lighthouse';
export type DecorKind = 'flower' | 'tuft' | 'bush';

/** Something solid a kart bounces off. `position` is on the planet surface (length = radius). */
export interface Obstacle {
  kind: ObstacleKind;
  position: Vector3;
  radius: number;
  scale: number;
  yaw: number;
}

/** Purely visual scenery. */
export interface Decor {
  kind: DecorKind;
  position: Vector3;
  scale: number;
  yaw: number;
  variant: number;
}

export interface ItemBoxRow {
  s: number;
  laterals: number[];
}

export interface BoostPad {
  s: number;
  lateral: number;
  length: number;
  width: number;
}

export interface WorldLayout {
  obstacles: Obstacle[];
  decor: Decor[];
  itemBoxRows: ItemBoxRow[];
  boostPads: BoostPad[];
}

/**
 * Gentle rolling hills away from the road. Used by rendering only; the physics treats the planet
 * as a perfect sphere, so the hills are kept low and well clear of the track.
 */
export function terrainHeight(direction: Vector3, distanceFromCenterline: number, halfWidth: number): number {
  const fade = smoothstep(halfWidth + 4, halfWidth + 13, distanceFromCenterline);
  if (fade <= 0) return 0;
  const n = fbm3(direction.x * 2.4 + 11.3, direction.y * 2.4 - 4.1, direction.z * 2.4 + 7.7, 3);
  return fade * (0.2 + n * 1.9);
}

export function generateWorld(track: Track, seed: number): WorldLayout {
  const rng = createRng(seed);
  const obstacles: Obstacle[] = [];
  const decor: Decor[] = [];
  const hw = track.halfWidth;
  const R = track.radius;

  const fitsObstacle = (position: Vector3, radius: number, clearance: number): boolean => {
    if (track.distanceToCenterline(position) < clearance + radius) return false;
    return obstacles.every((o) => o.position.distanceTo(position) > o.radius + radius + 0.8);
  };

  // Landmarks go in the two big open fields enclosed by the seam.
  const candidates: { position: Vector3; distance: number }[] = [];
  for (let i = 0; i < 1500; i++) {
    const position = randomUnitVector(rng, new Vector3()).multiplyScalar(R);
    candidates.push({ position, distance: track.distanceToCenterline(position) });
  }
  candidates.sort((a, b) => b.distance - a.distance);
  const first = candidates[0].position;
  const second = candidates.find((c) => c.position.distanceTo(first) > R)?.position ?? candidates[1].position;
  obstacles.push({ kind: 'windmill', position: first, radius: 1.9, scale: 1, yaw: rng() * Math.PI * 2 });
  obstacles.push({ kind: 'lighthouse', position: second, radius: 1.5, scale: 1, yaw: rng() * Math.PI * 2 });

  const scatter = (kind: ObstacleKind, count: number, baseRadius: number, clearance: number, scaleRange: [number, number]) => {
    for (let placed = 0, attempts = 0; placed < count && attempts < count * 40; attempts++) {
      const position = randomUnitVector(rng, new Vector3()).multiplyScalar(R);
      const scale = randRange(rng, scaleRange[0], scaleRange[1]);
      const radius = baseRadius * scale;
      if (!fitsObstacle(position, radius, clearance)) continue;
      obstacles.push({ kind, position, radius, scale, yaw: rng() * Math.PI * 2 });
      placed++;
    }
  };
  scatter('tree', 55, 0.65, hw + 2.6, [0.85, 1.35]);
  scatter('pine', 35, 0.55, hw + 2.6, [0.8, 1.3]);
  scatter('mushroom', 10, 0.75, hw + 2.8, [0.9, 1.4]);
  scatter('rock', 16, 0.7, hw + 2.0, [0.6, 1.2]);

  const sprinkle = (kind: DecorKind, count: number, clearance: number, scaleRange: [number, number], variants: number) => {
    for (let placed = 0, attempts = 0; placed < count && attempts < count * 10; attempts++) {
      const position = randomUnitVector(rng, new Vector3()).multiplyScalar(R);
      if (track.distanceToCenterline(position) < clearance) continue;
      if (obstacles.some((o) => o.position.distanceTo(position) < o.radius + 0.3)) continue;
      decor.push({ kind, position, scale: randRange(rng, scaleRange[0], scaleRange[1]), yaw: rng() * Math.PI * 2, variant: Math.floor(rng() * variants) });
      placed++;
    }
  };
  sprinkle('flower', 420, hw + 1.5, [0.7, 1.2], 5);
  sprinkle('tuft', 380, hw + 1.1, [0.6, 1.3], 2);
  sprinkle('bush', 45, hw + 2.2, [0.7, 1.3], 2);

  const itemBoxRows: ItemBoxRow[] = [0.2, 0.48, 0.76].map((f) => ({
    s: f * track.length,
    laterals: [-0.56, -0.19, 0.19, 0.56].map((x) => x * hw),
  }));

  return { obstacles, decor, itemBoxRows, boostPads: findBoostPads(track, itemBoxRows, rng) };
}

/** Dash panels go on the straightest bits of road, away from the start line and item boxes. */
function findBoostPads(track: Track, rows: ItemBoxRow[], rng: Rng): BoostPad[] {
  const L = track.length;
  const pads: BoostPad[] = [];
  const windows: [number, number][] = [
    [0.3, 0.44],
    [0.58, 0.72],
    [0.84, 0.95],
  ];
  for (const [from, to] of windows) {
    let bestS = from * L;
    let bestTurn = Infinity;
    for (let s = from * L; s < to * L; s += 1) {
      const nearRow = rows.some((r) => Math.abs(r.s - s) < 12);
      const turn = Math.abs(track.turnAngle(s - 6, 12));
      if (!nearRow && turn < bestTurn) {
        bestTurn = turn;
        bestS = s;
      }
    }
    pads.push({ s: bestS, lateral: (rng() < 0.5 ? -1 : 1) * track.halfWidth * 0.4, length: 2.6, width: 2.2 });
  }
  return pads;
}
