import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { moveOnSphere, signedAngle, wrapSigned } from './math';

describe('moveOnSphere', () => {
  it('keeps the point on the sphere and transports tangent vectors', () => {
    const position = new Vector3(0, 10, 0);
    const forward = new Vector3(0, 0, -1);
    for (let i = 0; i < 1000; i++) moveOnSphere(position, forward.clone().multiplyScalar(0.1), [forward]);
    expect(position.length()).toBeCloseTo(10, 6);
    expect(forward.dot(position.clone().normalize())).toBeCloseTo(0, 6);
  });

  it('travels the right distance along a great circle', () => {
    const position = new Vector3(0, 10, 0);
    moveOnSphere(position, new Vector3(0, 0, -Math.PI * 5));
    expect(position.y).toBeCloseTo(0, 6);
    expect(position.z).toBeCloseTo(-10, 6);
  });
});

describe('signedAngle', () => {
  it('is positive for a left turn', () => {
    const up = new Vector3(0, 1, 0);
    const forward = new Vector3(0, 0, -1);
    const left = new Vector3(-1, 0, 0);
    expect(signedAngle(forward, left, up)).toBeCloseTo(Math.PI / 2);
  });
});

describe('wrapSigned', () => {
  it('maps deltas across the seam into the short way round', () => {
    expect(wrapSigned(95, 100)).toBeCloseTo(-5);
    expect(wrapSigned(-95, 100)).toBeCloseTo(5);
  });
});
