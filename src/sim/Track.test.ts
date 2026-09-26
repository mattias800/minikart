import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { createCircuit } from './setup';
import { createTrackLocation } from './Track';

const { track, world } = createCircuit();

describe('Track', () => {
  it('lies on the planet surface with evenly spaced samples', () => {
    for (const p of track.points) expect(p.length()).toBeCloseTo(track.radius, 6);
    for (let i = 0; i < track.count; i++) {
      const d = track.points[i].distanceTo(track.points[(i + 1) % track.count]);
      expect(d).toBeGreaterThan(track.spacing * 0.95);
      expect(d).toBeLessThan(track.spacing * 1.05);
    }
  });

  it('never runs close to itself, so the road cannot overlap', () => {
    let minSeparation = Infinity;
    for (let i = 0; i < track.count; i += 4) {
      for (let j = 0; j < track.count; j += 4) {
        const arc = Math.min(Math.abs(i - j), track.count - Math.abs(i - j)) * track.spacing;
        if (arc > 30) minSeparation = Math.min(minSeparation, track.points[i].distanceTo(track.points[j]));
      }
    }
    expect(minSeparation).toBeGreaterThan(track.halfWidth * 2 + 6);
  });

  it('locates points by distance along and offset across the road', () => {
    const location = createTrackLocation();
    const s = track.length * 0.3;
    const p = track.pointAt(s, 2, new Vector3());
    track.locate(p, track.indexAt(s) + 10, location);
    expect(location.s).toBeCloseTo(s, 1);
    expect(location.lateral).toBeCloseTo(2, 1);
  });
});

describe('World layout', () => {
  it('keeps obstacles off the road', () => {
    for (const o of world.obstacles) expect(track.distanceToCenterline(o.position)).toBeGreaterThan(track.halfWidth + o.radius + 1);
  });

  it('places item boxes and boost pads', () => {
    expect(world.itemBoxRows.length).toBeGreaterThan(0);
    expect(world.boostPads.length).toBeGreaterThan(0);
  });
});
