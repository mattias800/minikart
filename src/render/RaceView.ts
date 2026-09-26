import * as THREE from 'three';
import type { RaceEvent } from '../sim/events';
import type { ItemBox } from '../sim/hazards';
import type { Race } from '../sim/Race';
import { ItemModels } from './itemModels';
import { EXHAUST_OFFSETS, REAR_WHEEL_OFFSETS } from './KartModel';
import { KartView } from './KartView';
import { ParticleSystem } from './Particles';
import { placeOnSurface } from './surface';
import type { WorldView } from './WorldView';

const DRIFT_COLORS = [0xfff4d6, 0x3ab4ff, 0xff9a1a, 0xe05bff].map((c) => new THREE.Color(c));
const FLAME_COLOR = new THREE.Color(0xffb13b);
const DUST_COLOR = new THREE.Color(0x9c8a5a);
const SMOKE_COLOR = new THREE.Color(0x777777);
const HIT_COLOR = new THREE.Color(0xffe066);
const RAINBOW = [0xff4d6d, 0xffb703, 0x8ac926, 0x1982c4, 0x9b5de5].map((c) => new THREE.Color(c));

const tmp = new THREE.Vector3();
const tmpVel = new THREE.Vector3();

/** Everything dynamic in a race: karts, items and particle effects. */
export class RaceView {
  readonly group = new THREE.Group();
  readonly kartViews: KartView[];
  readonly sparks = new ParticleSystem({ capacity: 3000, additive: true, gravity: 14, drag: 2 });
  readonly smoke = new ParticleSystem({ capacity: 1500, additive: false, gravity: -1.5, drag: 1.5 });
  private readonly boxes = new Map<ItemBox, THREE.Mesh>();
  private readonly bananas = new Map<number, THREE.Object3D>();
  private readonly shells = new Map<number, THREE.Object3D>();
  private readonly models: ItemModels;
  private time = 0;

  constructor(
    private readonly race: Race,
    private readonly world: WorldView,
    models: ItemModels,
  ) {
    this.models = models;
    this.kartViews = race.karts.map((kart) => new KartView(kart));
    for (const view of this.kartViews) this.group.add(view.object);
    for (const box of race.itemBoxes) {
      const mesh = models.itemBox();
      this.boxes.set(box, mesh);
      this.group.add(mesh);
    }
    this.group.add(this.sparks.points, this.smoke.points);
  }

  setPixelScale(height: number, fov: number): void {
    this.sparks.setPixelScale(height, fov);
    this.smoke.setPixelScale(height, fov);
  }

  update(dt: number): void {
    this.time += dt;
    const R = this.race.track.radius;
    for (const view of this.kartViews) {
      const kart = view.kart;
      view.update(dt, this.world.groundHeight(kart.position, Math.abs(kart.lateral)));
      this.emitKartEffects(view, dt);
    }

    for (const [box, mesh] of this.boxes) {
      const pop = box.active ? 1 : 0;
      const scale = THREE.MathUtils.lerp(mesh.scale.x, pop, 1 - Math.exp(-10 * dt));
      mesh.visible = scale > 0.02;
      placeOnSurface(mesh, box.position, 0, R + 1.0 + Math.sin(this.time * 2 + box.id) * 0.12);
      mesh.rotateY(this.time * 1.2 + box.id);
      mesh.rotateX(0.5);
      mesh.rotateZ(0.5);
      mesh.scale.setScalar(scale);
    }

    this.syncHazards(
      this.bananas,
      this.race.bananas,
      () => this.models.banana(),
      (object, banana) => placeOnSurface(object, banana.position, banana.id, R + 0.06),
    );
    this.syncHazards(
      this.shells,
      this.race.shells,
      (shell) => this.models.shell(shell.kind),
      (object, shell) => {
        placeOnSurface(object, shell.position, this.time * 14, R + 0.1 + this.world.groundHeight(shell.position));
        if (shell.kind === 'red' && Math.random() < 0.5) {
          this.sparks.emit(object.position, tmpVel.set(0, 0, 0), RAINBOW[0], 0.25, 0.3);
        }
      },
    );

    this.sparks.update(dt);
    this.smoke.update(dt);
  }

  handleEvent(event: RaceEvent): void {
    switch (event.type) {
      case 'hit':
        this.burst(event.kart.position, event.kart.up, 26, [HIT_COLOR], 6, 0.3, 0.7);
        break;
      case 'shellBreak':
        this.burst(event.position, tmp.copy(event.position).normalize(), 18, [new THREE.Color(0xffffff), new THREE.Color(0x2ecc40)], 5, 0.25, 0.5);
        break;
      case 'itemBox':
        this.burst(event.kart.position, event.kart.up, 22, RAINBOW, 5, 0.3, 0.6);
        break;
      case 'boost':
        if (event.kind !== 'pad') this.burst(event.kart.position, event.kart.up, 10, [FLAME_COLOR], 3, 0.35, 0.4);
        break;
      case 'stall':
        for (let i = 0; i < 12; i++) this.puff(event.kart.position, event.kart.up, SMOKE_COLOR, 0.9, 1.2);
        break;
      default:
        break;
    }
  }

  dispose(): void {
    this.group.removeFromParent();
    this.sparks.clear();
    this.smoke.clear();
  }

  private emitKartEffects(view: KartView, dt: number): void {
    const kart = view.kart;
    const root = view.object;
    root.updateMatrixWorld();
    const up = kart.up;

    if (kart.driftActive && !kart.airborne) {
      const level = kart.driftLevel;
      const color = DRIFT_COLORS[level];
      const rate = level === 0 ? 20 : 70;
      for (const offset of REAR_WHEEL_OFFSETS) {
        for (let i = 0, n = chance(rate * dt); i < n; i++) {
          root.localToWorld(tmp.copy(offset));
          tmpVel.copy(kart.forward).multiplyScalar(-3 - Math.random() * 3);
          tmpVel.addScaledVector(up, 2 + Math.random() * 3).add(randomSpread(2.5));
          this.sparks.emit(tmp, tmpVel, color, level === 0 ? 0.14 : 0.24, 0.25 + Math.random() * 0.2);
        }
      }
    }

    if (kart.boostTime > 0) {
      for (const offset of EXHAUST_OFFSETS) {
        for (let i = 0, n = chance(40 * dt); i < n; i++) {
          root.localToWorld(tmp.copy(offset));
          tmpVel.copy(kart.forward).multiplyScalar(-6).addScaledVector(up, 1).add(randomSpread(1.5));
          this.sparks.emit(tmp, tmpVel, FLAME_COLOR, 0.3, 0.25);
        }
      }
    }

    if (kart.offroad && !kart.airborne && Math.abs(kart.forwardSpeed) > 4) {
      for (let i = 0, n = chance(25 * dt); i < n; i++) {
        root.localToWorld(tmp.copy(REAR_WHEEL_OFFSETS[i % 2]));
        this.smoke.emit(tmp, tmpVel.copy(up).multiplyScalar(1.5).add(randomSpread(1.2)), DUST_COLOR, 0.5, 0.6);
      }
    }

    if (kart.stallTime > 0 && chance(10 * dt) > 0) {
      root.localToWorld(tmp.copy(EXHAUST_OFFSETS[0]));
      this.puff(tmp, up, SMOKE_COLOR, 0.7, 1);
    }
  }

  private burst(position: THREE.Vector3, up: THREE.Vector3, count: number, colors: THREE.Color[], speed: number, size: number, life: number): void {
    for (let i = 0; i < count; i++) {
      tmp.copy(position).addScaledVector(up, 0.6);
      tmpVel.copy(up).multiplyScalar(speed * 0.6).add(randomSpread(speed));
      this.sparks.emit(tmp, tmpVel, colors[i % colors.length], size, life * (0.6 + Math.random() * 0.6));
    }
  }

  private puff(position: THREE.Vector3, up: THREE.Vector3, color: THREE.Color, size: number, life: number): void {
    tmp.copy(position).addScaledVector(up, 0.5);
    tmpVel.copy(up).multiplyScalar(1.2).add(randomSpread(0.8));
    this.smoke.emit(tmp, tmpVel, color, size, life);
  }

  private syncHazards<T extends { id: number }>(
    objects: Map<number, THREE.Object3D>,
    items: readonly T[],
    create: (item: T) => THREE.Object3D,
    place: (object: THREE.Object3D, item: T) => void,
  ): void {
    const alive = new Set<number>();
    for (const item of items) {
      alive.add(item.id);
      let object = objects.get(item.id);
      if (!object) {
        object = create(item);
        objects.set(item.id, object);
        this.group.add(object);
      }
      place(object, item);
    }
    for (const [id, object] of objects) {
      if (!alive.has(id)) {
        object.removeFromParent();
        objects.delete(id);
      }
    }
  }
}

/** Turns a fractional expected count into an integer, randomly rounding. */
function chance(expected: number): number {
  const whole = Math.floor(expected);
  return whole + (Math.random() < expected - whole ? 1 : 0);
}

function randomSpread(amount: number): THREE.Vector3 {
  return new THREE.Vector3((Math.random() - 0.5) * amount, (Math.random() - 0.5) * amount, (Math.random() - 0.5) * amount);
}
