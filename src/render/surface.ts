import * as THREE from 'three';
import type { Track } from '../sim/Track';
import { createTrackFrame } from '../sim/Track';

const Y_AXIS = new THREE.Vector3(0, 1, 0);
const tmpUp = new THREE.Vector3();
const tmpQuat = new THREE.Quaternion();
const tmpYaw = new THREE.Quaternion();
const tmpScale = new THREE.Vector3();
const tmpPos = new THREE.Vector3();
const tmpBasis = new THREE.Matrix4();

/**
 * A transform that stands an object upright on the planet above `position`, rotated by `yaw`,
 * with its origin `radius` away from the planet centre.
 */
export function surfaceMatrix(position: THREE.Vector3, yaw: number, scale: number, radius: number, out: THREE.Matrix4): THREE.Matrix4 {
  tmpUp.copy(position).normalize();
  tmpQuat.setFromUnitVectors(Y_AXIS, tmpUp);
  tmpYaw.setFromAxisAngle(tmpUp, yaw);
  tmpQuat.premultiply(tmpYaw);
  tmpPos.copy(tmpUp).multiplyScalar(radius);
  return out.compose(tmpPos, tmpQuat, tmpScale.setScalar(scale));
}

export function placeOnSurface(object: THREE.Object3D, position: THREE.Vector3, yaw: number, radius: number): void {
  surfaceMatrix(position, yaw, 1, radius, object.matrix);
  object.matrix.decompose(object.position, object.quaternion, object.scale);
}

/**
 * Sets an object's orientation from a tangent frame: local +Z = forward, +Y = up.
 * (+X therefore points left, matching three.js' right-handed convention.)
 */
export function orientToFrame(object: THREE.Object3D, forward: THREE.Vector3, up: THREE.Vector3): void {
  const left = tmpPos.crossVectors(up, forward).normalize();
  object.quaternion.setFromRotationMatrix(tmpBasis.makeBasis(left, up, forward));
}

export interface RibbonOptions {
  from: number;
  to: number;
  lateralFrom: number;
  lateralTo: number;
  lateralSegments: number;
  /** Height above the planet surface. */
  lift: number;
  /** Track distance covered by one repeat of the texture's V axis. */
  vLength: number;
}

const frame = createTrackFrame();

/** A strip of geometry that follows the track over the curved planet surface. */
export function buildRibbon(track: Track, options: RibbonOptions): THREE.BufferGeometry {
  const { from, to, lateralFrom, lateralTo, lateralSegments, lift, vLength } = options;
  const steps = Math.max(1, Math.ceil((to - from) / track.spacing));
  const columns = lateralSegments + 1;
  const positions = new Float32Array((steps + 1) * columns * 3);
  const normals = new Float32Array((steps + 1) * columns * 3);
  const uvs = new Float32Array((steps + 1) * columns * 2);
  const p = new THREE.Vector3();
  for (let i = 0; i <= steps; i++) {
    const s = from + ((to - from) * i) / steps;
    track.frameAt(s, frame);
    for (let j = 0; j < columns; j++) {
      const lateral = lateralFrom + ((lateralTo - lateralFrom) * j) / lateralSegments;
      p.copy(frame.point).addScaledVector(frame.right, lateral).setLength(track.radius + lift);
      const k = i * columns + j;
      p.toArray(positions, k * 3);
      p.normalize().toArray(normals, k * 3);
      uvs[k * 2] = j / lateralSegments;
      uvs[k * 2 + 1] = (s - from) / vLength;
    }
  }
  const indices: number[] = [];
  for (let i = 0; i < steps; i++) {
    for (let j = 0; j < lateralSegments; j++) {
      const a = i * columns + j;
      const b = (i + 1) * columns + j;
      const c = a + 1;
      const d = b + 1;
      // Counter-clockwise seen from above (right × forward = up).
      indices.push(a, c, b, c, d, b);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  return geometry;
}
