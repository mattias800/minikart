import { Vector3 } from 'three';

/** A closed curve on the unit sphere, parameterised by t in [0, 2π). */
export type TrackCurve = (t: number, out: Vector3) => Vector3;

function tennisSeam(t: number, out: Vector3): Vector3 {
  // With a constant k this lies exactly on the unit sphere: |p|² = (a + b)² = 1.
  // Varying k makes every lobe a little different, so we renormalise.
  const k = 0.24 + 0.05 * Math.sin(t + 0.6);
  const a = 1 - k;
  const b = k;
  const c = 2 * Math.sqrt(a * b);
  return out
    .set(a * Math.cos(t) + b * Math.cos(3 * t), a * Math.sin(t) - b * Math.sin(3 * t), c * Math.sin(2 * t))
    .normalize();
}

const seamPoint = new Vector3();
const seamAhead = new Vector3();
const seamNormal = new Vector3();

/**
 * The Grand Prix course: a tennis-ball seam that swings from pole to pole around the planet,
 * with a sideways wobble layered on top to create a few straights and tighter bends.
 */
export const seamCurve: TrackCurve = (t, out) => {
  tennisSeam(t, seamPoint);
  tennisSeam(t + 1e-4, seamAhead).sub(seamPoint);
  seamNormal.crossVectors(seamPoint, seamAhead).normalize();
  return out.copy(seamPoint).addScaledVector(seamNormal, 0.07 * Math.sin(5 * t)).normalize();
};
