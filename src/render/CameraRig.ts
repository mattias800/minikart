import * as THREE from 'three';
import { clamp, damp, dampVector } from '../core/math';
import type { Kart } from '../sim/Kart';

export type CameraMode = 'orbit' | 'chase' | 'intro' | 'finish';

const CHASE_DISTANCE = 6.4;
const CHASE_HEIGHT = 2.9;
const LOOK_AHEAD = 3.5;
const BASE_FOV = 68;
const INTRO_DURATION = 3;

const tmpPos = new THREE.Vector3();
const tmpLook = new THREE.Vector3();
const tmpUp = new THREE.Vector3();
const tmpForward = new THREE.Vector3();
const tmpRight = new THREE.Vector3();

/**
 * Drives the camera: a slow planet orbit for menus, a fly-in intro, a springy chase cam while
 * racing, and a victory lap around the player at the finish.
 */
export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  mode: CameraMode = 'orbit';
  private readonly position = new THREE.Vector3(0, 0, 90);
  private readonly look = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly forward = new THREE.Vector3(0, 0, 1);
  private modeTime = 0;
  private fov = BASE_FOV;
  private shake = 0;
  private readonly introFrom = new THREE.Vector3();
  private readonly introFromUp = new THREE.Vector3();

  constructor(
    aspect: number,
    private readonly planetRadius: number,
  ) {
    this.camera = new THREE.PerspectiveCamera(BASE_FOV, aspect, 0.1, 1200);
  }

  get fieldOfView(): number {
    return this.fov;
  }

  setMode(mode: CameraMode): void {
    if (mode === 'intro') {
      this.introFrom.copy(this.position);
      this.introFromUp.copy(this.up);
    }
    this.mode = mode;
    this.modeTime = 0;
  }

  get introFinished(): boolean {
    return this.mode !== 'intro' || this.modeTime >= INTRO_DURATION;
  }

  addShake(amount: number): void {
    this.shake = Math.min(1, this.shake + amount);
  }

  /** Jumps straight to the chase position behind a kart. */
  snapBehind(kart: Kart): void {
    this.forward.copy(kart.forward);
    this.chaseTarget(kart, false, this.position, this.look, this.up);
    this.apply();
  }

  update(dt: number, target: Kart | null, lookBack = false): void {
    this.modeTime += dt;
    let targetFov = BASE_FOV;
    switch (this.mode) {
      case 'orbit':
        this.orbitTarget(this.modeTime, tmpPos, tmpUp);
        this.position.copy(tmpPos);
        this.up.copy(tmpUp);
        this.look.set(0, 0, 0);
        break;
      case 'intro': {
        if (!target) break;
        const t = clamp(this.modeTime / INTRO_DURATION, 0, 1);
        const e = t * t * (3 - 2 * t);
        this.forward.copy(target.forward);
        this.chaseTarget(target, false, tmpPos, tmpLook, tmpUp);
        // Swing in from space along an arc, so the planet stays in view.
        this.position.copy(this.introFrom).lerp(tmpPos, e);
        const lift = Math.sin(e * Math.PI) * this.planetRadius * 0.6;
        this.position.addScaledVector(tmpUp, lift * (1 - e));
        this.look.set(0, 0, 0).lerp(tmpLook, Math.min(1, e * 1.4));
        this.up.copy(this.introFromUp).lerp(tmpUp, e).normalize();
        break;
      }
      case 'chase':
        if (!target) break;
        dampVector(this.forward, target.forward, 5, dt).normalize();
        this.chaseTarget(target, lookBack, tmpPos, tmpLook, tmpUp);
        dampVector(this.position, tmpPos, lookBack ? 30 : 12, dt);
        this.look.copy(tmpLook);
        dampVector(this.up, tmpUp, 8, dt).normalize();
        if (target.boostTime > 0) targetFov = BASE_FOV + 12;
        else if (target.starTime > 0) targetFov = BASE_FOV + 6;
        break;
      case 'finish': {
        if (!target) break;
        const angle = this.modeTime * 0.45;
        tmpUp.copy(target.up);
        tmpForward.copy(target.forward);
        tmpRight.crossVectors(tmpForward, tmpUp);
        tmpPos
          .copy(target.position)
          .addScaledVector(tmpUp, 3.2)
          .addScaledVector(tmpForward, Math.cos(angle) * 7)
          .addScaledVector(tmpRight, Math.sin(angle) * 7);
        dampVector(this.position, tmpPos, 3, dt);
        this.look.copy(target.position).addScaledVector(tmpUp, 0.8);
        dampVector(this.up, tmpUp, 4, dt).normalize();
        break;
      }
    }
    this.fov = damp(this.fov, targetFov, 4, dt);
    this.shake = damp(this.shake, 0, 6, dt);
    this.apply();
  }

  private apply(): void {
    this.camera.position.copy(this.position);
    if (this.shake > 0.01) {
      const s = this.shake * 0.25;
      this.camera.position.x += (Math.random() - 0.5) * s;
      this.camera.position.y += (Math.random() - 0.5) * s;
      this.camera.position.z += (Math.random() - 0.5) * s;
    }
    this.camera.up.copy(this.up);
    this.camera.lookAt(this.look);
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
  }

  private chaseTarget(kart: Kart, lookBack: boolean, position: THREE.Vector3, look: THREE.Vector3, up: THREE.Vector3): void {
    up.copy(kart.up);
    const forward = tmpForward.copy(this.forward);
    forward.addScaledVector(up, -forward.dot(up)).normalize();
    const sign = lookBack ? -1 : 1;
    // The ground drops away fast on a tiny planet, so aim slightly down at the kart.
    position.copy(kart.position).addScaledVector(up, CHASE_HEIGHT).addScaledVector(forward, -CHASE_DISTANCE * sign);
    look.copy(kart.position).addScaledVector(up, 1.1).addScaledVector(forward, LOOK_AHEAD * sign);
  }

  private orbitTarget(time: number, position: THREE.Vector3, up: THREE.Vector3): void {
    const angle = time * 0.12;
    const distance = this.planetRadius * 2.9;
    position.set(Math.cos(angle) * distance, Math.sin(time * 0.07) * distance * 0.45, Math.sin(angle) * distance);
    up.set(0, 1, 0);
  }
}
