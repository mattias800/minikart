import { Quaternion, Vector3 } from 'three';

export const TAU = Math.PI * 2;

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Frame-rate independent exponential smoothing towards `target`. */
export function damp(current: number, target: number, lambda: number, dt: number): number {
  return lerp(current, target, 1 - Math.exp(-lambda * dt));
}

export function dampVector(current: Vector3, target: Vector3, lambda: number, dt: number): Vector3 {
  return current.lerp(target, 1 - Math.exp(-lambda * dt));
}

export function moveToward(current: number, target: number, maxDelta: number): number {
  if (Math.abs(target - current) <= maxDelta) return target;
  return current + Math.sign(target - current) * maxDelta;
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Wraps `value` into [0, length). */
export function wrap(value: number, length: number): number {
  return ((value % length) + length) % length;
}

/** Wraps `value` into [-length/2, length/2). Useful for deltas along a loop. */
export function wrapSigned(value: number, length: number): number {
  return wrap(value + length / 2, length) - length / 2;
}

/** Removes the component of `v` along the unit vector `up` (in place). */
export function projectOnTangent(v: Vector3, up: Vector3): Vector3 {
  return v.addScaledVector(up, -v.dot(up));
}

const tmpCross = new Vector3();

/** Signed angle from `from` to `to` around `up`. Positive is counter-clockwise (a left turn). */
export function signedAngle(from: Vector3, to: Vector3, up: Vector3): number {
  tmpCross.crossVectors(from, to);
  return Math.atan2(tmpCross.dot(up), from.dot(to));
}

const tmpAxis = new Vector3();
const tmpQuat = new Quaternion();

/**
 * Moves a point on a sphere (centred at the origin) along the great circle given by a tangent
 * displacement. Any `carried` vectors (forward, velocity, ...) are parallel transported along.
 */
export function moveOnSphere(position: Vector3, displacement: Vector3, carried: readonly Vector3[] = []): void {
  const distance = displacement.length();
  if (distance < 1e-9) return;
  const radius = position.length();
  tmpAxis.crossVectors(position, displacement);
  const axisLength = tmpAxis.length();
  if (axisLength < 1e-12) return;
  tmpAxis.divideScalar(axisLength);
  tmpQuat.setFromAxisAngle(tmpAxis, distance / radius);
  position.applyQuaternion(tmpQuat).setLength(radius);
  for (const v of carried) v.applyQuaternion(tmpQuat);
}

/** Returns a new point `distance` away from `from` along the tangent `direction`. */
export function offsetOnSphere(from: Vector3, direction: Vector3, distance: number): Vector3 {
  const result = from.clone();
  moveOnSphere(result, direction.clone().multiplyScalar(distance));
  return result;
}

export type Rng = () => number;

/** Small, fast, seedable PRNG (mulberry32). */
export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randRange(rng: Rng, min: number, max: number): number {
  return min + (max - min) * rng();
}

export function randomUnitVector(rng: Rng, out: Vector3): Vector3 {
  const z = rng() * 2 - 1;
  const phi = rng() * TAU;
  const r = Math.sqrt(1 - z * z);
  return out.set(r * Math.cos(phi), r * Math.sin(phi), z);
}

function hash3(x: number, y: number, z: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 1440670441);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Trilinear value noise in [0, 1]. */
export function valueNoise3(x: number, y: number, z: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const xf = x - xi;
  const yf = y - yi;
  const zf = z - zi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const w = zf * zf * (3 - 2 * zf);
  const c000 = hash3(xi, yi, zi);
  const c100 = hash3(xi + 1, yi, zi);
  const c010 = hash3(xi, yi + 1, zi);
  const c110 = hash3(xi + 1, yi + 1, zi);
  const c001 = hash3(xi, yi, zi + 1);
  const c101 = hash3(xi + 1, yi, zi + 1);
  const c011 = hash3(xi, yi + 1, zi + 1);
  const c111 = hash3(xi + 1, yi + 1, zi + 1);
  const x00 = lerp(c000, c100, u);
  const x10 = lerp(c010, c110, u);
  const x01 = lerp(c001, c101, u);
  const x11 = lerp(c011, c111, u);
  return lerp(lerp(x00, x10, v), lerp(x01, x11, v), w);
}

/** Fractal (octaved) value noise in [0, 1]. */
export function fbm3(x: number, y: number, z: number, octaves = 4): number {
  let sum = 0;
  let amplitude = 0.5;
  let frequency = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise3(x * frequency, y * frequency, z * frequency) * amplitude;
    norm += amplitude;
    amplitude *= 0.5;
    frequency *= 2.03;
  }
  return sum / norm;
}
