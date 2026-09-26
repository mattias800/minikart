import { Vector3 } from 'three';
import { clamp, damp, moveOnSphere, moveToward, projectOnTangent } from '../core/math';
import type { Character, KartStats } from './characters';
import type { BoostKind, EventSink } from './events';
import type { ItemType } from './items';

/** What a driver (human or AI) wants the kart to do this step. */
export interface KartInput {
  throttle: boolean;
  brake: boolean;
  /** -1 (left) … 1 (right). */
  steer: number;
  /** Hop / drift button. */
  drift: boolean;
  useItem: boolean;
  lookBack: boolean;
}

export function createKartInput(): KartInput {
  return { throttle: false, brake: false, steer: 0, drift: false, useItem: false, lookBack: false };
}

export const KART_RADIUS = 0.9;
export const SPIN_DURATION = 1.1;
/** Seconds of drifting needed to reach each mini-turbo level (blue, orange, purple). */
export const DRIFT_THRESHOLDS = [0.7, 1.5, 2.6] as const;
const DRIFT_BOOST_DURATION = [0, 0.45, 0.9, 1.4] as const;

const GRAVITY = 30;
const HOP_SPEED = 5;
const BRAKE_DECEL = 34;
const REVERSE_ACCEL = 14;
const REVERSE_MAX = 7;
const COAST_DECEL = 6;
const BOOST_SPEED_FACTOR = 1.4;
const STAR_SPEED_FACTOR = 1.15;
const OFFROAD_SPEED_FACTOR = 0.5;
const GRIP = 9;
const DRIFT_GRIP = 4;
const AIR_GRIP = 1.5;
const MIN_DRIFT_SPEED = 8;
const DRIFT_YAW_BASE = 0.68;
const DRIFT_YAW_RANGE = 0.52;

const tmpDisplacement = new Vector3();

/**
 * A kart and everything the race needs to know about it. Karts live on the surface of a sphere
 * centred at the origin: `position` always has length = planet radius, and `forward`/`velocity`
 * are tangent to the surface. Hops are tracked separately as `height`.
 */
export class Kart {
  readonly position = new Vector3();
  readonly forward = new Vector3(0, 0, 1);
  readonly velocity = new Vector3();
  readonly up = new Vector3(0, 1, 0);
  readonly right = new Vector3(1, 0, 0);

  input: KartInput = createKartInput();
  /** Smoothed steering, used for visuals. */
  steer = 0;
  forwardSpeed = 0;
  height = 0;
  verticalSpeed = 0;
  offroad = false;
  /** Rubber-banding multiplier set by the race each step. */
  speedMultiplier = 1;

  driftActive = false;
  driftDirection = 0;
  driftCharge = 0;

  boostTime = 0;
  starTime = 0;
  spinTime = 0;
  stallTime = 0;
  invulnerableTime = 0;

  item: ItemType | null = null;
  itemCount = 0;
  rouletteTime = 0;
  itemButtonHeld = false;
  /** Countdown time remaining when the throttle was pressed, for rocket starts. */
  startCharge: number | null = null;

  // Race progress.
  trackIndex = 0;
  trackS = 0;
  lateral = 0;
  /** Unwrapped distance travelled along the track since the start line. */
  progress = 0;
  lapsCompleted = 0;
  finished = false;
  finishTime = 0;
  rank = 1;

  private driftHeld = false;

  constructor(
    readonly id: number,
    readonly character: Character,
    readonly stats: KartStats,
    readonly isPlayer: boolean,
  ) {}

  get airborne(): boolean {
    return this.height > 0;
  }

  get spinning(): boolean {
    return this.spinTime > 0;
  }

  get maxSpeed(): number {
    return this.stats.topSpeed * this.speedMultiplier;
  }

  /** 0 = no mini-turbo yet, 1 = blue, 2 = orange, 3 = purple. */
  get driftLevel(): number {
    if (!this.driftActive) return 0;
    let level = 0;
    for (const threshold of DRIFT_THRESHOLDS) if (this.driftCharge >= threshold) level++;
    return level;
  }

  place(position: Vector3, forward: Vector3): void {
    this.position.copy(position);
    this.forward.copy(forward);
    this.velocity.set(0, 0, 0);
    this.syncFrame();
  }

  applyBoost(duration: number, kind: BoostKind, emit: EventSink): void {
    const wasBoosting = this.boostTime > 0.1;
    this.boostTime = Math.max(this.boostTime, duration);
    if (wasBoosting && kind === 'pad') return;
    this.velocity.addScaledVector(this.forward, 3);
    emit({ type: 'boost', kart: this, kind });
  }

  /** Spins the kart out. Returns false if it was protected (star, recently hit). */
  hit(): boolean {
    if (this.starTime > 0 || this.invulnerableTime > 0) return false;
    this.spinTime = SPIN_DURATION;
    this.invulnerableTime = SPIN_DURATION + 0.7;
    this.velocity.multiplyScalar(0.35);
    this.verticalSpeed = 6;
    this.height = Math.max(this.height, 0.001);
    this.boostTime = 0;
    this.cancelDrift();
    return true;
  }

  step(dt: number, emit: EventSink): void {
    this.tickTimers(dt);
    const controllable = !this.spinning;
    const steer = controllable ? clamp(this.input.steer, -1, 1) : 0;
    this.steer = damp(this.steer, steer, 14, dt);

    this.updateDrift(dt, controllable, steer, emit);
    this.applySteering(dt, steer);

    // Grip pulls the velocity back in line with the nose. Most of the sideways speed is turned
    // into forward speed rather than lost, which is what keeps drifting fast.
    const grip = this.driftActive ? DRIFT_GRIP : this.airborne ? AIR_GRIP : GRIP;
    const slip = this.velocity.dot(this.right);
    const lateralSpeed = damp(slip, 0, grip, dt);
    const transfer = this.driftActive ? 0.9 : 0.5;
    let forwardSpeed = this.velocity.dot(this.forward);
    const recoveredSq = (slip * slip - lateralSpeed * lateralSpeed) * transfer;
    forwardSpeed = Math.sign(forwardSpeed) * Math.sqrt(forwardSpeed * forwardSpeed + recoveredSq);
    forwardSpeed = this.applyThrottle(dt, controllable, forwardSpeed);
    this.velocity.copy(this.forward).multiplyScalar(forwardSpeed).addScaledVector(this.right, lateralSpeed);
    this.forwardSpeed = forwardSpeed;

    this.updateVertical(dt);
    tmpDisplacement.copy(this.velocity).multiplyScalar(dt);
    moveOnSphere(this.position, tmpDisplacement, [this.forward, this.velocity]);
    this.syncFrame();
  }

  /** Re-derives the local frame after the kart has been moved around the sphere. */
  syncFrame(): void {
    this.up.copy(this.position).normalize();
    projectOnTangent(this.forward, this.up).normalize();
    projectOnTangent(this.velocity, this.up);
    this.right.crossVectors(this.forward, this.up).normalize();
  }

  private tickTimers(dt: number): void {
    this.boostTime = Math.max(0, this.boostTime - dt);
    this.starTime = Math.max(0, this.starTime - dt);
    this.spinTime = Math.max(0, this.spinTime - dt);
    this.stallTime = Math.max(0, this.stallTime - dt);
    this.invulnerableTime = Math.max(0, this.invulnerableTime - dt);
  }

  private updateDrift(dt: number, controllable: boolean, steer: number, emit: EventSink): void {
    const held = controllable && this.input.drift;
    const pressed = held && !this.driftHeld;
    this.driftHeld = held;
    const speed = this.velocity.dot(this.forward);

    if (pressed && !this.airborne && speed > 3) {
      this.verticalSpeed = HOP_SPEED;
      this.height = 0.001;
      emit({ type: 'hop', kart: this });
    }

    if (this.driftActive) {
      if (!held || speed < MIN_DRIFT_SPEED * 0.6) {
        const level = this.driftLevel;
        this.cancelDrift();
        if (held === false && controllable && level > 0) {
          this.applyBoost(DRIFT_BOOST_DURATION[level], 'drift', emit);
        }
        return;
      }
      const previousLevel = this.driftLevel;
      const tightness = Math.max(0, steer * this.driftDirection);
      this.driftCharge += dt * (1 + 0.6 * tightness) * (this.offroad ? 0.4 : 1);
      const level = this.driftLevel;
      if (level > previousLevel) emit({ type: 'driftLevel', kart: this, level });
    } else if (held && !this.airborne && Math.abs(steer) > 0.35 && speed > MIN_DRIFT_SPEED) {
      this.driftActive = true;
      this.driftDirection = Math.sign(steer);
      this.driftCharge = 0;
      emit({ type: 'driftStart', kart: this });
    }
  }

  private cancelDrift(): void {
    this.driftActive = false;
    this.driftDirection = 0;
    this.driftCharge = 0;
  }

  /** Turn rate (radians per second, positive = right) produced by a steering input. */
  yawRateFor(steer: number): number {
    if (this.driftActive) {
      // Drifting always turns into the drift; steering only widens or tightens the arc.
      const d = this.driftDirection;
      return d * this.stats.handling * (DRIFT_YAW_BASE + DRIFT_YAW_RANGE * steer * d);
    }
    return steer * this.normalYawGain();
  }

  /** The steering input that would produce `yawRate`. Unclamped, so callers can see if it is out of reach. */
  steerFor(yawRate: number): number {
    if (this.driftActive) {
      const d = this.driftDirection;
      return (d * ((yawRate * d) / this.stats.handling - DRIFT_YAW_BASE)) / DRIFT_YAW_RANGE;
    }
    const gain = this.normalYawGain();
    return Math.abs(gain) < 1e-6 ? 0 : yawRate / gain;
  }

  private normalYawGain(): number {
    const speed = this.velocity.dot(this.forward);
    const lowSpeedFactor = clamp(Math.abs(speed) / 6, 0, 1);
    const highSpeedFactor = 1 - 0.2 * clamp(Math.abs(speed) / this.stats.topSpeed, 0, 1);
    const airFactor = this.airborne ? 0.6 : 1;
    return this.stats.handling * lowSpeedFactor * highSpeedFactor * airFactor * (speed < 0 ? -1 : 1);
  }

  private applySteering(dt: number, steer: number): void {
    // A positive rotation around `up` turns left, so steering right is a negative angle.
    this.forward.applyAxisAngle(this.up, -this.yawRateFor(steer) * dt);
    this.right.crossVectors(this.forward, this.up).normalize();
  }

  private applyThrottle(dt: number, controllable: boolean, speed: number): number {
    const input = this.input;
    const slowedByGrass = this.offroad && this.boostTime <= 0 && this.starTime <= 0;
    let limit = this.maxSpeed * (slowedByGrass ? OFFROAD_SPEED_FACTOR : 1);
    if (this.starTime > 0) limit *= STAR_SPEED_FACTOR;
    const throttle = controllable && input.throttle && !input.brake && this.stallTime <= 0;
    const brake = controllable && input.brake;

    if (this.boostTime > 0) {
      speed = Math.max(speed, damp(speed, this.maxSpeed * BOOST_SPEED_FACTOR, 5, dt));
    } else if (throttle) {
      if (speed < limit) {
        const accel = this.stats.acceleration * (1 - (0.55 * Math.max(0, speed)) / limit);
        speed = Math.min(limit, speed + accel * dt);
      }
    } else if (brake) {
      speed = speed > 0.1 ? Math.max(0, speed - BRAKE_DECEL * dt) : Math.max(-REVERSE_MAX, speed - REVERSE_ACCEL * dt);
    } else {
      speed = moveToward(speed, 0, COAST_DECEL * dt);
    }

    // Too fast for the surface (coming off a boost, or onto the grass): bleed speed off smoothly.
    if (speed > limit && this.boostTime <= 0) speed = damp(speed, limit, slowedByGrass ? 4 : 1.5, dt);
    if (this.spinning) speed = damp(speed, 0, 2.5, dt);
    return speed;
  }

  private updateVertical(dt: number): void {
    if (!this.airborne && this.verticalSpeed <= 0) return;
    this.verticalSpeed -= GRAVITY * dt;
    this.height += this.verticalSpeed * dt;
    if (this.height <= 0) {
      this.height = 0;
      this.verticalSpeed = 0;
    }
  }
}
