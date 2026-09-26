import { Vector3 } from 'three';
import type { Kart } from './Kart';

export class ItemBox {
  /** Seconds until the box reappears after being picked up. */
  respawnTimer = 0;

  constructor(
    readonly id: number,
    readonly position: Vector3,
    readonly s: number,
    readonly lateral: number,
  ) {}

  get active(): boolean {
    return this.respawnTimer <= 0;
  }
}

export class Banana {
  alive = true;
  age = 0;

  constructor(
    readonly id: number,
    readonly position: Vector3,
    readonly owner: Kart,
    readonly s: number,
    readonly lateral: number,
  ) {}
}

export type ShellKind = 'green' | 'red';

export const SHELL_RADIUS = 0.45;

export class Shell {
  alive = true;
  age = 0;
  bounces = 0;
  readonly speed: number;
  readonly lifetime: number;

  constructor(
    readonly id: number,
    readonly kind: ShellKind,
    readonly position: Vector3,
    readonly direction: Vector3,
    readonly owner: Kart,
    public target: Kart | null,
    public trackIndex: number,
  ) {
    this.speed = kind === 'green' ? 36 : 34;
    // Green shells live long enough to lap the tiny planet and come back to haunt you.
    this.lifetime = kind === 'green' ? 6 : 8;
  }
}
