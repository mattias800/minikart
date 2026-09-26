import * as THREE from 'three';
import { clamp, damp } from '../core/math';
import { SPIN_DURATION, type Kart } from '../sim/Kart';
import { WHEEL_RADIUS, buildKartModel, type KartModel } from './KartModel';
import { orientToFrame } from './surface';

const ROAD_LIFT = 0.05;

/** Keeps a kart model in sync with its simulated kart, adding purely visual flourishes. */
export class KartView {
  readonly model: KartModel;
  private driftYaw = 0;
  private roll = 0;
  private squash = 0;
  private wasAirborne = false;
  private readonly baseColor: THREE.Color;
  private time = 0;

  constructor(readonly kart: Kart) {
    this.model = buildKartModel(kart.character);
    this.baseColor = new THREE.Color(kart.character.color);
  }

  get object(): THREE.Group {
    return this.model.root;
  }

  /** `ground` is the terrain height under the kart (non-zero only on the hills). */
  update(dt: number, ground: number): void {
    const kart = this.kart;
    const { root, body, wheels, frontPivots, flames, bodyMaterial } = this.model;
    this.time += dt;

    root.position.copy(kart.up).multiplyScalar(kart.position.length() + ROAD_LIFT + ground + kart.height);
    orientToFrame(root, kart.forward, kart.up);

    // Mid-drift the nose swings into the corner and the body leans out.
    const targetYaw = kart.driftActive ? -kart.driftDirection * (0.32 + 0.12 * kart.steer * kart.driftDirection) : 0;
    this.driftYaw = damp(this.driftYaw, targetYaw, 10, dt);
    // Positive roll tips the top towards local -X (the right), so lean outwards with negative values.
    const targetRoll = kart.driftActive ? -kart.driftDirection * 0.12 : -kart.steer * 0.05 * clamp(kart.forwardSpeed / 20, 0, 1);
    this.roll = damp(this.roll, targetRoll, 8, dt);
    const spin = kart.spinning ? (1 - kart.spinTime / SPIN_DURATION) * Math.PI * 4 : 0;
    root.rotateY(this.driftYaw + spin);
    body.rotation.z = this.roll;

    // Squash on landing, a little engine wobble otherwise.
    if (this.wasAirborne && !kart.airborne) this.squash = 1;
    this.wasAirborne = kart.airborne;
    this.squash = damp(this.squash, 0, 9, dt);
    const wobble = Math.sin(this.time * 38) * 0.008 * clamp(kart.forwardSpeed / 10, 0, 1);
    body.scale.set(1 + this.squash * 0.12, 1 - this.squash * 0.18 + wobble, 1 + this.squash * 0.08);

    const spinRate = kart.forwardSpeed / WHEEL_RADIUS;
    for (const wheel of wheels) wheel.rotation.x += spinRate * dt;
    for (const pivot of frontPivots) pivot.rotation.y = -kart.steer * 0.45;

    const boosting = kart.boostTime > 0;
    for (const flame of flames) {
      flame.visible = boosting;
      if (boosting) flame.scale.set(1, 0.8 + Math.random() * 0.6, 1);
    }

    if (kart.starTime > 0) {
      bodyMaterial.color.setHSL((this.time * 1.5) % 1, 0.9, 0.55);
      bodyMaterial.emissive.setHSL((this.time * 1.5 + 0.5) % 1, 1, 0.3);
    } else {
      bodyMaterial.color.copy(this.baseColor);
      bodyMaterial.emissive.setRGB(0, 0, 0);
    }

    // Flicker while invulnerable after a hit.
    root.visible = kart.invulnerableTime <= 0 || kart.spinning || Math.floor(this.time * 20) % 2 === 0;
    this.model.animateExtras(dt, kart.forwardSpeed);
  }
}
