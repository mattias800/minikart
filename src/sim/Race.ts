import { Vector3 } from 'three';
import { clamp, createRng, moveOnSphere, offsetOnSphere, projectOnTangent, randRange, signedAngle, wrapSigned, type Rng } from '../core/math';
import { AIDriver } from './AIDriver';
import { deriveKartStats, type Character } from './characters';
import type { EventSink, RaceEvent } from './events';
import { Banana, ItemBox, SHELL_RADIUS, Shell, type ShellKind } from './hazards';
import { MUSHROOM_BOOST_DURATION, ROULETTE_DURATION, STAR_DURATION, itemUses, rollItem, type ItemType } from './items';
import { KART_RADIUS, Kart } from './Kart';
import { createTrackLocation, type Track } from './Track';
import type { WorldLayout } from './World';

export type RacePhase = 'countdown' | 'racing' | 'finished';

export interface RaceOptions {
  track: Track;
  world: WorldLayout;
  /** Characters in grid order: index 0 starts on pole. */
  roster: readonly Character[];
  /** Index into `roster` of the human player, or -1 for an all-AI race. */
  playerIndex: number;
  laps: number;
  countdown: number;
  speedScale: number;
  aiSkill: readonly [number, number];
  seed: number;
}

const ITEM_BOX_RESPAWN = 2.5;
const MAX_BANANAS = 24;
const BOOST_PAD_DURATION = 0.9;
const RUBBER_BAND_RANGE = 80;
const RUBBER_BAND_STRENGTH = 0.1;
/** Closing speed below which contact is a nudge rather than a bump worth reporting. */
const MIN_BUMP_SPEED = 2.5;

const tmpNormal = new Vector3();
const tmpVec = new Vector3();
const tmpLocation = createTrackLocation();

/**
 * The complete, renderer-agnostic state of a race: karts, items, rules and AI.
 * Advance it with `step(dt)` and read what happened from `drainEvents()`.
 */
export class Race {
  readonly track: Track;
  readonly world: WorldLayout;
  readonly laps: number;
  readonly karts: Kart[] = [];
  readonly player: Kart | null;
  readonly drivers = new Map<Kart, AIDriver>();
  readonly itemBoxes: ItemBox[] = [];
  bananas: Banana[] = [];
  shells: Shell[] = [];

  /** When set, the player's kart is driven by its AI too (demos, testing). */
  autopilot = false;
  phase: RacePhase = 'countdown';
  countdown: number;
  /** Seconds since the green light. */
  time = 0;

  private readonly rng: Rng;
  private events: RaceEvent[] = [];
  private nextId = 1;
  private countdownAnnounced = false;
  private readonly emit: EventSink = (event) => this.events.push(event);

  constructor(options: RaceOptions) {
    this.track = options.track;
    this.world = options.world;
    this.laps = options.laps;
    this.countdown = options.countdown;
    this.rng = createRng(options.seed);

    options.roster.forEach((character, i) => {
      const isPlayer = i === options.playerIndex;
      const kart = new Kart(i, character, deriveKartStats(character.stats, options.speedScale), isPlayer);
      this.placeOnGrid(kart, i);
      this.karts.push(kart);
      const skill = isPlayer ? 1 : randRange(this.rng, options.aiSkill[0], options.aiSkill[1]);
      this.drivers.set(kart, new AIDriver(kart, skill, options.seed * 31 + i * 7919));
    });
    this.player = this.karts.find((k) => k.isPlayer) ?? null;

    for (const row of this.world.itemBoxRows) {
      for (const lateral of row.laterals) {
        const position = this.track.pointAt(row.s, lateral, new Vector3());
        this.itemBoxes.push(new ItemBox(this.nextId++, position, this.track.wrapS(row.s), lateral));
      }
    }
    this.updateRanks();
  }

  drainEvents(): RaceEvent[] {
    const events = this.events;
    this.events = [];
    return events;
  }

  /** Karts ordered by race position. */
  get standings(): Kart[] {
    return [...this.karts].sort((a, b) => a.rank - b.rank);
  }

  step(dt: number): void {
    if (this.phase === 'countdown') {
      this.stepCountdown(dt);
      return;
    }
    this.time += dt;
    for (const kart of this.karts) {
      if (!kart.isPlayer || kart.finished || this.autopilot) this.drivers.get(kart)?.update(dt, this);
    }
    for (const kart of this.karts) {
      this.updateItemUse(kart, dt);
      kart.step(dt, this.emit);
      this.collideWithObstacles(kart);
      this.updateProgress(kart);
      this.checkBoostPads(kart);
      this.checkItemBoxes(kart);
    }
    this.collideKarts();
    this.updateItemBoxes(dt);
    this.updateBananas(dt);
    this.updateShells(dt);
    this.updateRanks();
    this.updateRubberBanding();

    const done = this.player ? this.player.finished : this.karts.every((k) => k.finished);
    if (done) this.phase = 'finished';
  }

  private placeOnGrid(kart: Kart, slot: number): void {
    const row = Math.floor(slot / 2);
    const column = slot % 2;
    const s = -4 - row * 3.4 - column * 1.7;
    const lateral = (column === 0 ? -1 : 1) * this.track.halfWidth * 0.42;
    kart.place(this.track.pointAt(s, lateral, new Vector3()), this.track.tangentAt(s, new Vector3()));
    kart.trackS = this.track.wrapS(s);
    kart.trackIndex = this.track.indexAt(s);
    kart.progress = s;
    kart.lateral = lateral;
  }

  private stepCountdown(dt: number): void {
    if (!this.countdownAnnounced) {
      this.countdownAnnounced = true;
      this.emit({ type: 'countdown', value: Math.ceil(this.countdown) });
    }
    const before = this.countdown;
    this.countdown -= dt;
    for (const kart of this.karts) {
      if (!kart.isPlayer || this.autopilot) this.drivers.get(kart)?.countdownInput(this.countdown);
      if (!kart.input.throttle) kart.startCharge = null;
      else if (kart.startCharge === null) kart.startCharge = this.countdown;
    }
    if (this.countdown > 0) {
      if (Math.ceil(before) !== Math.ceil(this.countdown)) this.emit({ type: 'countdown', value: Math.ceil(this.countdown) });
      return;
    }
    this.countdown = 0;
    this.phase = 'racing';
    this.emit({ type: 'go' });
    for (const kart of this.karts) {
      // Rocket start: hit the gas just after "2". Too early and the engine floods.
      const charge = kart.startCharge;
      if (charge === null) continue;
      if (charge <= 1.6 && charge >= 0.2) kart.applyBoost(1, 'start', this.emit);
      else if (charge > 2.4) {
        kart.stallTime = 0.9;
        this.emit({ type: 'stall', kart });
      }
    }
  }

  private updateItemUse(kart: Kart, dt: number): void {
    if (kart.rouletteTime > 0) {
      kart.rouletteTime -= dt;
      if (kart.rouletteTime <= 0) {
        kart.rouletteTime = 0;
        const item = rollItem(kart.rank, this.karts.length, this.rng);
        kart.item = item;
        kart.itemCount = itemUses(item);
        this.emit({ type: 'itemGot', kart, item });
      }
    }
    const pressed = kart.input.useItem && !kart.itemButtonHeld;
    kart.itemButtonHeld = kart.input.useItem;
    if (!pressed || !kart.item || kart.rouletteTime > 0 || kart.spinning) return;
    const item = kart.item;
    this.useItem(kart, item);
    kart.itemCount--;
    if (kart.itemCount <= 0) kart.item = null;
    this.emit({ type: 'itemUsed', kart, item });
  }

  private useItem(kart: Kart, item: ItemType): void {
    // Holding "back" while using an item throws it behind you.
    const backwards = kart.input.brake || kart.input.lookBack;
    switch (item) {
      case 'mushroom':
      case 'tripleMushroom':
        kart.applyBoost(MUSHROOM_BOOST_DURATION, 'mushroom', this.emit);
        break;
      case 'star':
        kart.starTime = STAR_DURATION;
        kart.spinTime = 0;
        break;
      case 'banana':
        this.dropBanana(kart);
        break;
      case 'greenShell':
        this.fireShell(kart, 'green', backwards);
        break;
      case 'redShell':
        this.fireShell(kart, backwards ? 'green' : 'red', backwards);
        break;
    }
  }

  private dropBanana(kart: Kart): void {
    const back = kart.forward.clone().negate();
    const position = offsetOnSphere(kart.position, back, KART_RADIUS + 1);
    this.track.locate(position, kart.trackIndex, tmpLocation);
    this.bananas.push(new Banana(this.nextId++, position, kart, tmpLocation.s, tmpLocation.lateral));
    if (this.bananas.length > MAX_BANANAS) this.bananas.shift();
  }

  private fireShell(kart: Kart, kind: ShellKind, backwards: boolean): void {
    const direction = kart.forward.clone();
    if (backwards) direction.negate();
    const position = offsetOnSphere(kart.position, direction, KART_RADIUS + 0.9);
    // The spawn point is a little further round the planet, so re-flatten the direction there.
    projectOnTangent(direction, tmpNormal.copy(position).normalize()).normalize();
    const target = kind === 'red' ? (this.karts.find((k) => k.rank === kart.rank - 1 && !k.finished) ?? null) : null;
    this.shells.push(new Shell(this.nextId++, kind, position, direction, kart, target, kart.trackIndex));
  }

  private collideWithObstacles(kart: Kart): void {
    for (const obstacle of this.world.obstacles) {
      const minDistance = KART_RADIUS + obstacle.radius;
      const distanceSq = kart.position.distanceToSquared(obstacle.position);
      if (distanceSq >= minDistance * minDistance) continue;
      const distance = Math.sqrt(distanceSq);
      projectOnTangent(tmpNormal.subVectors(kart.position, obstacle.position), kart.up);
      if (tmpNormal.lengthSq() < 1e-8) tmpNormal.copy(kart.forward).negate();
      tmpNormal.normalize();
      moveOnSphere(kart.position, tmpVec.copy(tmpNormal).multiplyScalar(minDistance - distance), [kart.forward, kart.velocity]);
      kart.syncFrame();
      const into = kart.velocity.dot(tmpNormal);
      if (into < 0) {
        kart.velocity.addScaledVector(tmpNormal, -into * 1.4).multiplyScalar(0.75);
        if (-into > MIN_BUMP_SPEED) this.emit({ type: 'bump', kart, strength: -into });
      }
    }
  }

  private collideKarts(): void {
    const karts = this.karts;
    for (let i = 0; i < karts.length; i++) {
      for (let j = i + 1; j < karts.length; j++) {
        const a = karts[i];
        const b = karts[j];
        const minDistance = KART_RADIUS * 1.8;
        const distanceSq = a.position.distanceToSquared(b.position);
        if (distanceSq >= minDistance * minDistance || Math.abs(a.height - b.height) > 1) continue;

        if (a.starTime > 0 && b.starTime <= 0 && b.hit()) this.emit({ type: 'hit', kart: b, by: 'star' });
        if (b.starTime > 0 && a.starTime <= 0 && a.hit()) this.emit({ type: 'hit', kart: a, by: 'star' });

        const distance = Math.sqrt(distanceSq);
        projectOnTangent(tmpNormal.subVectors(a.position, b.position), a.up);
        if (tmpNormal.lengthSq() < 1e-8) tmpNormal.copy(a.right);
        tmpNormal.normalize();
        const wa = a.stats.weight;
        const wb = b.stats.weight;
        const overlap = minDistance - distance;
        moveOnSphere(a.position, tmpVec.copy(tmpNormal).multiplyScalar((overlap * wb) / (wa + wb)), [a.forward, a.velocity]);
        moveOnSphere(b.position, tmpVec.copy(tmpNormal).multiplyScalar((-overlap * wa) / (wa + wb)), [b.forward, b.velocity]);
        a.syncFrame();
        b.syncFrame();

        const closing = a.velocity.dot(tmpNormal) - b.velocity.dot(tmpNormal);
        if (closing < 0) {
          const impulse = (-(1 + 0.4) * closing) / (1 / wa + 1 / wb);
          a.velocity.addScaledVector(tmpNormal, impulse / wa);
          b.velocity.addScaledVector(tmpNormal, -impulse / wb);
          if (-closing > MIN_BUMP_SPEED) {
            this.emit({ type: 'bump', kart: a, strength: -closing });
            this.emit({ type: 'bump', kart: b, strength: -closing });
          }
        }
      }
    }
  }

  private updateProgress(kart: Kart): void {
    const location = this.track.locate(kart.position, kart.trackIndex, tmpLocation);
    kart.progress += wrapSigned(location.s - kart.trackS, this.track.length);
    kart.trackS = location.s;
    kart.trackIndex = location.index;
    kart.lateral = location.lateral;
    kart.offroad = Math.abs(location.lateral) > this.track.halfWidth;
    if (kart.finished) return;

    const completed = Math.floor(kart.progress / this.track.length);
    if (completed > kart.lapsCompleted) {
      kart.lapsCompleted = completed;
      if (completed >= this.laps) {
        kart.finished = true;
        kart.finishTime = this.time;
        this.emit({ type: 'finish', kart, place: this.karts.filter((k) => k.finished).length });
      } else {
        this.emit({ type: 'lap', kart, lap: completed + 1 });
      }
    }
  }

  private checkBoostPads(kart: Kart): void {
    if (kart.airborne) return;
    for (const pad of this.world.boostPads) {
      const along = wrapSigned(kart.trackS - pad.s, this.track.length);
      if (Math.abs(along) < pad.length / 2 && Math.abs(kart.lateral - pad.lateral) < pad.width / 2) {
        kart.applyBoost(BOOST_PAD_DURATION, 'pad', this.emit);
      }
    }
  }

  private checkItemBoxes(kart: Kart): void {
    for (const box of this.itemBoxes) {
      if (!box.active || kart.position.distanceToSquared(box.position) > 1.6 * 1.6) continue;
      box.respawnTimer = ITEM_BOX_RESPAWN;
      this.emit({ type: 'itemBox', kart });
      if (!kart.item && kart.rouletteTime <= 0) kart.rouletteTime = ROULETTE_DURATION;
    }
  }

  private updateItemBoxes(dt: number): void {
    for (const box of this.itemBoxes) box.respawnTimer = Math.max(0, box.respawnTimer - dt);
  }

  private updateBananas(dt: number): void {
    for (const banana of this.bananas) {
      banana.age += dt;
      for (const kart of this.karts) {
        if (!banana.alive) break;
        if (kart === banana.owner && banana.age < 0.8) continue;
        if (kart.height > 1 || kart.position.distanceToSquared(banana.position) > (KART_RADIUS + 0.4) ** 2) continue;
        if (kart.starTime > 0) banana.alive = false;
        else if (kart.hit()) {
          banana.alive = false;
          this.emit({ type: 'hit', kart, by: 'banana' });
        }
      }
    }
    this.bananas = this.bananas.filter((b) => b.alive);
  }

  private updateShells(dt: number): void {
    for (const shell of this.shells) {
      shell.age += dt;
      if (shell.age > shell.lifetime) {
        this.breakShell(shell);
        continue;
      }
      if (shell.kind === 'red') this.steerRedShell(shell, dt);
      moveOnSphere(shell.position, tmpVec.copy(shell.direction).multiplyScalar(shell.speed * dt), [shell.direction]);
      projectOnTangent(shell.direction, tmpNormal.copy(shell.position).normalize()).normalize();
      this.collideShell(shell);
    }
    for (let i = 0; i < this.shells.length; i++) {
      for (let j = i + 1; j < this.shells.length; j++) {
        const a = this.shells[i];
        const b = this.shells[j];
        if (a.alive && b.alive && a.position.distanceToSquared(b.position) < (SHELL_RADIUS * 2) ** 2) {
          this.breakShell(a);
          this.breakShell(b);
        }
      }
    }
    this.shells = this.shells.filter((s) => s.alive);
  }

  private steerRedShell(shell: Shell, dt: number): void {
    const target = shell.target;
    if (!target || target.finished) {
      shell.target = null;
      return;
    }
    const up = tmpNormal.copy(shell.position).normalize();
    // Follow the road until the target is close, then home in.
    const aim = new Vector3();
    if (shell.position.distanceTo(target.position) > 14) {
      const location = this.track.locate(shell.position, shell.trackIndex, tmpLocation);
      shell.trackIndex = location.index;
      this.track.pointAt(location.s + 6, location.lateral * 0.5, aim);
    } else {
      aim.copy(target.position);
    }
    projectOnTangent(aim.sub(shell.position), up).normalize();
    const angle = signedAngle(shell.direction, aim, up);
    shell.direction.applyAxisAngle(up, clamp(angle, -6 * dt, 6 * dt));
  }

  private collideShell(shell: Shell): void {
    for (const obstacle of this.world.obstacles) {
      const minDistance = SHELL_RADIUS + obstacle.radius;
      if (shell.position.distanceToSquared(obstacle.position) >= minDistance * minDistance) continue;
      if (shell.kind === 'red' || shell.bounces >= 4) {
        this.breakShell(shell);
        return;
      }
      const up = tmpVec.copy(shell.position).normalize();
      const normal = projectOnTangent(new Vector3().subVectors(shell.position, obstacle.position), up).normalize();
      if (shell.direction.dot(normal) < 0) shell.direction.reflect(normal);
      moveOnSphere(shell.position, normal.multiplyScalar(minDistance - shell.position.distanceTo(obstacle.position)), [shell.direction]);
      shell.bounces++;
    }
    for (const kart of this.karts) {
      if (kart === shell.owner && shell.age < 0.5) continue;
      if (kart.height > 1.5 || kart.position.distanceToSquared(shell.position) > (KART_RADIUS + SHELL_RADIUS) ** 2) continue;
      if (kart.hit()) this.emit({ type: 'hit', kart, by: 'shell' });
      this.breakShell(shell);
      return;
    }
    for (const banana of this.bananas) {
      if (banana.alive && banana.position.distanceToSquared(shell.position) < 1) {
        banana.alive = false;
        this.breakShell(shell);
        return;
      }
    }
  }

  private breakShell(shell: Shell): void {
    if (!shell.alive) return;
    shell.alive = false;
    this.emit({ type: 'shellBreak', position: shell.position.clone() });
  }

  private updateRanks(): void {
    const sorted = [...this.karts].sort((a, b) => {
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      if (a.finished !== b.finished) return a.finished ? -1 : 1;
      return b.progress - a.progress;
    });
    sorted.forEach((kart, i) => (kart.rank = i + 1));
  }

  /** AI karts ease off when well ahead of the player and push harder when behind. */
  private updateRubberBanding(): void {
    const reference =
      this.player && !this.player.finished
        ? this.player.progress
        : this.karts.reduce((sum, k) => sum + k.progress, 0) / this.karts.length;
    for (const kart of this.karts) {
      if (kart.isPlayer && !kart.finished) continue;
      const skill = this.drivers.get(kart)?.skill ?? 1;
      const gap = clamp((kart.progress - reference) / RUBBER_BAND_RANGE, -1, 1);
      kart.speedMultiplier = skill * (1 - gap * RUBBER_BAND_STRENGTH);
    }
  }
}
