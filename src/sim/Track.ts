import { Vector3 } from 'three';
import { TAU, projectOnTangent, signedAngle, wrap, wrapSigned } from '../core/math';
import type { TrackCurve } from './TrackLayout';

export interface TrackOptions {
  radius: number;
  halfWidth: number;
  samples: number;
}

/** Where something is relative to the track. */
export interface TrackLocation {
  /** Index of the nearest centreline sample. */
  index: number;
  /** Distance along the track, in [0, length). */
  s: number;
  /** Signed sideways offset from the centreline; positive is to the right. */
  lateral: number;
  /** Squared distance to the nearest sample. */
  distanceSq: number;
}

export interface TrackFrame {
  point: Vector3;
  tangent: Vector3;
  right: Vector3;
  up: Vector3;
}

export function createTrackLocation(): TrackLocation {
  return { index: 0, s: 0, lateral: 0, distanceSq: 0 };
}

export function createTrackFrame(): TrackFrame {
  return { point: new Vector3(), tangent: new Vector3(), right: new Vector3(), up: new Vector3() };
}

/** Samples searched on either side of the hint when tracking a moving object. */
const LOCAL_WINDOW = 48;

const tmp = new Vector3();
const tmpFrame = createTrackFrame();

/**
 * A closed road on the surface of a sphere, resampled so its samples are evenly spaced by arc length.
 * All queries are pure and allocation free so the simulation can call them every step.
 */
export class Track {
  readonly radius: number;
  readonly halfWidth: number;
  readonly count: number;
  readonly length: number;
  readonly spacing: number;
  readonly points: Vector3[] = [];
  readonly tangents: Vector3[] = [];
  readonly rights: Vector3[] = [];
  readonly ups: Vector3[] = [];

  constructor(curve: TrackCurve, options: TrackOptions) {
    this.radius = options.radius;
    this.halfWidth = options.halfWidth;
    this.count = options.samples;

    // Sample densely by parameter, then resample uniformly by arc length.
    const denseCount = options.samples * 8;
    const dense: Vector3[] = [];
    const cumulative = new Float64Array(denseCount + 1);
    for (let i = 0; i <= denseCount; i++) {
      dense.push(curve((i / denseCount) * TAU, new Vector3()).multiplyScalar(this.radius));
      if (i > 0) cumulative[i] = cumulative[i - 1] + dense[i].distanceTo(dense[i - 1]);
    }
    this.length = cumulative[denseCount];
    this.spacing = this.length / this.count;

    let segment = 0;
    for (let j = 0; j < this.count; j++) {
      const target = j * this.spacing;
      while (cumulative[segment + 1] < target) segment++;
      const f = (target - cumulative[segment]) / (cumulative[segment + 1] - cumulative[segment]);
      this.points.push(new Vector3().lerpVectors(dense[segment], dense[segment + 1], f).setLength(this.radius));
    }

    for (let j = 0; j < this.count; j++) {
      const up = this.points[j].clone().normalize();
      const next = this.points[(j + 1) % this.count];
      const prev = this.points[(j - 1 + this.count) % this.count];
      const tangent = projectOnTangent(next.clone().sub(prev), up).normalize();
      this.ups.push(up);
      this.tangents.push(tangent);
      this.rights.push(new Vector3().crossVectors(tangent, up).normalize());
    }
  }

  wrapS(s: number): number {
    return wrap(s, this.length);
  }

  indexAt(s: number): number {
    return Math.floor(this.wrapS(s) / this.spacing) % this.count;
  }

  /** Interpolated centreline frame at distance `s`. */
  frameAt(s: number, out: TrackFrame): TrackFrame {
    const ws = this.wrapS(s);
    const i = Math.floor(ws / this.spacing) % this.count;
    const j = (i + 1) % this.count;
    const f = ws / this.spacing - Math.floor(ws / this.spacing);
    out.point.lerpVectors(this.points[i], this.points[j], f).setLength(this.radius);
    out.up.copy(out.point).normalize();
    out.tangent.lerpVectors(this.tangents[i], this.tangents[j], f);
    projectOnTangent(out.tangent, out.up).normalize();
    out.right.crossVectors(out.tangent, out.up).normalize();
    return out;
  }

  /** A point on the surface at distance `s` along the track and `lateral` to its right. */
  pointAt(s: number, lateral: number, out: Vector3): Vector3 {
    const frame = this.frameAt(s, tmpFrame);
    return out.copy(frame.point).addScaledVector(frame.right, lateral).setLength(this.radius);
  }

  tangentAt(s: number, out: Vector3): Vector3 {
    return out.copy(this.frameAt(s, tmpFrame).tangent);
  }

  /**
   * Locates `position` relative to the track, searching around `hint` (the previous index).
   * Searching locally keeps progress continuous so nobody can "teleport" a lap ahead; if the
   * object has strayed far from the road we fall back to a global search, but only accept
   * modest jumps (a genuine shortcut) rather than half a lap.
   */
  locate(position: Vector3, hint: number, out: TrackLocation): TrackLocation {
    const n = this.count;
    let best = hint;
    let bestD = Infinity;
    for (let k = -LOCAL_WINDOW; k <= LOCAL_WINDOW; k++) {
      const i = wrap(hint + k, n);
      const d = position.distanceToSquared(this.points[i]);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    const lostThreshold = (this.halfWidth * 2.5) ** 2;
    if (bestD > lostThreshold) {
      const global = this.nearestIndex(position);
      if (Math.abs(wrapSigned(global - hint, n)) < n / 4) {
        best = global;
        bestD = position.distanceToSquared(this.points[global]);
      }
    }
    tmp.subVectors(position, this.points[best]);
    out.index = best;
    out.s = this.wrapS(best * this.spacing + tmp.dot(this.tangents[best]));
    out.lateral = tmp.dot(this.rights[best]);
    out.distanceSq = bestD;
    return out;
  }

  /** Index of the closest sample, by brute force. `stride` trades accuracy for speed. */
  nearestIndex(position: Vector3, stride = 1): number {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < this.count; i += stride) {
      const d = position.distanceToSquared(this.points[i]);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  /** Straight-line distance from `position` to the nearest point on the centreline. */
  distanceToCenterline(position: Vector3): number {
    const stride = 8;
    const coarse = this.nearestIndex(position, stride);
    let bestD = Infinity;
    for (let k = -stride; k <= stride; k++) {
      bestD = Math.min(bestD, position.distanceToSquared(this.points[wrap(coarse + k, this.count)]));
    }
    return Math.sqrt(bestD);
  }

  /** How much the road turns between `s` and `s + distance`. Positive is a left turn. */
  turnAngle(s: number, distance: number): number {
    const i0 = this.indexAt(s);
    const i1 = this.indexAt(s + distance);
    const up = this.ups[i0];
    tmp.copy(this.tangents[i1]);
    projectOnTangent(tmp, up).normalize();
    return signedAngle(this.tangents[i0], tmp, up);
  }
}
