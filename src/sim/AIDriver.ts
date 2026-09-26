import { Vector3 } from 'three';
import { clamp, createRng, projectOnTangent, randRange, signedAngle, wrapSigned, type Rng } from '../core/math';
import type { Kart } from './Kart';
import type { Race } from './Race';

const target = new Vector3();
const toTarget = new Vector3();
const heading = new Vector3();

/**
 * A computer driver. It follows a lane along the racing line, drifts through corners,
 * hunts item boxes, dodges bananas and uses items with a bit of personality.
 */
export class AIDriver {
  /** Multiplier on top speed; the race layers rubber-banding on top of this. */
  readonly skill: number;
  private readonly rng: Rng;
  private lane = 0;
  private laneTimer = 0;
  private itemHold = 0;
  private stuckTime = 0;
  private reverseTime = 0;
  /** How much countdown is left when this driver slams the throttle. */
  private readonly startPress: number;

  constructor(
    readonly kart: Kart,
    skill: number,
    seed: number,
  ) {
    this.skill = skill;
    this.rng = createRng(seed);
    this.startPress = randRange(this.rng, 0.1, 1.9);
  }

  countdownInput(remaining: number): void {
    this.kart.input.throttle = remaining < this.startPress;
  }

  update(dt: number, race: Race): void {
    const kart = this.kart;
    const track = race.track;
    const input = kart.input;
    input.throttle = true;
    input.brake = false;
    input.useItem = false;
    input.lookBack = false;
    if (kart.spinning) {
      input.steer = 0;
      input.drift = false;
      return;
    }

    if (this.recoverIfStuck(dt)) return;

    const lane = this.chooseLane(dt, race);
    const speed = Math.max(0, kart.forwardSpeed);
    const turn = track.turnAngle(kart.trackS + 2, 12);

    // Pure pursuit: aim at a point down the road and ask for the turn rate that arcs onto it.
    // Steer by where the kart is actually going rather than where its nose points: mid-drift the
    // two differ a lot. A longer look-ahead while drifting damps the slower-reacting slide.
    const lookahead = 3 + speed * (kart.driftActive ? 0.34 : 0.22);
    track.pointAt(kart.trackS + lookahead, lane, target);
    projectOnTangent(toTarget.subVectors(target, kart.position), kart.up).normalize();
    heading.copy(speed > 3 ? kart.velocity : kart.forward).normalize();
    const alpha = -signedAngle(heading, toTarget, kart.up);
    const desiredYaw = (2 * Math.max(speed, 4) * Math.sin(alpha)) / lookahead;

    if (kart.driftActive) {
      // Keep sliding while the corner lasts and the arc is still within reach.
      const steer = kart.steerFor(desiredYaw);
      input.drift = -turn * kart.driftDirection > 0.2 && steer * kart.driftDirection > -1.3;
      input.steer = clamp(steer, -1, 1);
    } else {
      const wantsDrift = Math.abs(turn) > 0.5 && speed > 14 && !kart.offroad;
      input.drift = wantsDrift;
      // While hopping into a drift, commit to the corner's direction.
      input.steer = wantsDrift ? -Math.sign(turn) : clamp(kart.steerFor(desiredYaw), -1, 1);
    }

    if (kart.item && kart.rouletteTime <= 0) {
      this.itemHold += dt;
      if (this.shouldUseItem(race, turn)) {
        input.useItem = true;
        this.itemHold = 0;
      }
    } else {
      this.itemHold = 0;
    }
  }

  /** Backs away from whatever the kart is wedged against. Returns true while reversing. */
  private recoverIfStuck(dt: number): boolean {
    const kart = this.kart;
    const input = kart.input;
    if (this.reverseTime > 0) {
      this.reverseTime -= dt;
      input.throttle = false;
      input.brake = true;
      input.drift = false;
      input.steer = this.lane >= 0 ? -1 : 1;
      return true;
    }
    this.stuckTime = kart.forwardSpeed < 2 && kart.stallTime <= 0 ? this.stuckTime + dt : 0;
    if (this.stuckTime > 0.8) {
      this.stuckTime = 0;
      this.reverseTime = 0.9;
    }
    return false;
  }

  private chooseLane(dt: number, race: Race): number {
    const kart = this.kart;
    const track = race.track;
    const L = track.length;
    this.laneTimer -= dt;
    if (this.laneTimer <= 0) {
      this.lane = randRange(this.rng, -0.5, 0.5) * track.halfWidth;
      this.laneTimer = randRange(this.rng, 1.5, 4.5);
    }
    let lane = this.lane;

    if (!kart.item && kart.rouletteTime <= 0) {
      // Aim for the nearest box ahead, preferring ones close to the current lane.
      let bestScore = Infinity;
      for (const box of race.itemBoxes) {
        if (!box.active) continue;
        const ahead = wrapSigned(box.s - kart.trackS, L);
        if (ahead < 2 || ahead > 30) continue;
        const score = ahead + Math.abs(box.lateral - this.lane) * 2;
        if (score < bestScore) {
          bestScore = score;
          lane = box.lateral;
        }
      }
    }

    for (const banana of race.bananas) {
      const ahead = wrapSigned(banana.s - kart.trackS, L);
      if (ahead > 0 && ahead < 14 && Math.abs(banana.lateral - lane) < 1.8) {
        lane = banana.lateral + (lane >= banana.lateral ? 2.2 : -2.2);
      }
    }
    return clamp(lane, -track.halfWidth * 0.75, track.halfWidth * 0.75);
  }

  private shouldUseItem(race: Race, turn: number): boolean {
    const kart = this.kart;
    switch (kart.item) {
      case 'mushroom':
      case 'tripleMushroom':
        return this.itemHold > 0.7 && Math.abs(turn) < 0.35;
      case 'star':
        return this.itemHold > 1;
      case 'banana':
        return this.itemHold > 6 || race.karts.some((o) => o !== kart && kart.progress - o.progress > 1 && kart.progress - o.progress < 9);
      case 'greenShell':
        return this.itemHold > 7 || race.karts.some((o) => o !== kart && this.isInSights(o));
      case 'redShell':
        return this.itemHold > (kart.rank === 1 ? 8 : 1.2);
      default:
        return false;
    }
  }

  private isInSights(other: Kart): boolean {
    const kart = this.kart;
    toTarget.subVectors(other.position, kart.position);
    const distance = toTarget.length();
    if (distance > 24 || distance < 1) return false;
    projectOnTangent(toTarget, kart.up).normalize();
    return Math.abs(signedAngle(kart.forward, toTarget, kart.up)) < 0.12;
  }
}
