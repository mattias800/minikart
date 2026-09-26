import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { Character, HatStyle } from '../sim/characters';

/**
 * A kart with its driver, built from primitives. Local space: +Z forward, +Y up, +X left,
 * origin on the ground between the wheels.
 */
export interface KartModel {
  root: THREE.Group;
  /** Everything above the wheels; tilted and bounced for juice. */
  body: THREE.Group;
  wheels: THREE.Object3D[];
  frontPivots: THREE.Object3D[];
  flames: THREE.Mesh[];
  bodyMaterial: THREE.MeshStandardMaterial;
  /** Per-frame animation of hat extras (propellers, antennae…). */
  animateExtras: (dt: number, speed: number) => void;
}

export const WHEEL_RADIUS = 0.3;
export const REAR_WHEEL_OFFSETS = [new THREE.Vector3(0.68, 0.05, -0.62), new THREE.Vector3(-0.68, 0.05, -0.62)];
export const EXHAUST_OFFSETS = [new THREE.Vector3(0.24, 0.62, -1.15), new THREE.Vector3(-0.24, 0.62, -1.15)];

const materialCache = new Map<string, THREE.MeshStandardMaterial>();

function mat(color: THREE.ColorRepresentation, roughness = 0.55, metalness = 0.05): THREE.MeshStandardMaterial {
  const key = `${new THREE.Color(color).getHexString()}-${roughness}-${metalness}`;
  let material = materialCache.get(key);
  if (!material) {
    material = new THREE.MeshStandardMaterial({ color, roughness, metalness });
    materialCache.set(key, material);
  }
  return material;
}

function mesh(geometry: THREE.BufferGeometry, material: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(geometry, material);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

export function buildKartModel(character: Character): KartModel {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  // Each kart owns its body material so a star can make it shimmer.
  const bodyMaterial = new THREE.MeshStandardMaterial({ color: character.color, roughness: 0.35, metalness: 0.1 });
  const dark = mat(0x2a2d36, 0.7);
  const chrome = mat(0xc9ced6, 0.25, 0.8);
  const accent = mat(character.accent, 0.5);

  // Chassis.
  body.add(mesh(new RoundedBoxGeometry(1.2, 0.34, 1.75, 3, 0.12), bodyMaterial, 0, 0.38, 0));
  body.add(mesh(new RoundedBoxGeometry(0.86, 0.26, 0.55, 3, 0.1), bodyMaterial, 0, 0.36, 0.98));
  body.add(mesh(new RoundedBoxGeometry(1.14, 0.14, 0.2, 2, 0.06), dark, 0, 0.24, 1.22));
  body.add(mesh(new RoundedBoxGeometry(1.46, 0.12, 0.5, 2, 0.05), dark, 0, 0.28, 0));
  // Racing stripe over the nose.
  body.add(mesh(new THREE.BoxGeometry(0.24, 0.03, 0.9), accent, 0, 0.5, 0.82));
  // Seat and engine.
  const seat = mesh(new RoundedBoxGeometry(0.62, 0.5, 0.18, 2, 0.06), dark, 0, 0.72, -0.42);
  seat.rotation.x = -0.25;
  body.add(seat);
  body.add(mesh(new RoundedBoxGeometry(0.8, 0.36, 0.46, 2, 0.08), chrome, 0, 0.62, -0.82));
  const flames: THREE.Mesh[] = [];
  const flameMaterial = new THREE.MeshBasicMaterial({ color: 0xffa726, transparent: true, opacity: 0.9, toneMapped: false });
  for (const offset of EXHAUST_OFFSETS) {
    const pipe = mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.36, 10), chrome, offset.x, offset.y, offset.z + 0.12);
    pipe.rotation.x = Math.PI / 2;
    body.add(pipe);
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.6, 10).translate(0, -0.3, 0), flameMaterial);
    flame.rotation.x = Math.PI / 2;
    flame.position.copy(offset);
    flame.visible = false;
    flames.push(flame);
    body.add(flame);
  }
  // Rear spoiler.
  body.add(mesh(new RoundedBoxGeometry(1.34, 0.06, 0.34, 2, 0.02), bodyMaterial, 0, 1.0, -1.02));
  for (const x of [-0.45, 0.45]) body.add(mesh(new THREE.BoxGeometry(0.06, 0.34, 0.1), dark, x, 0.82, -1.0));
  // Steering wheel.
  const steeringWheel = mesh(new THREE.TorusGeometry(0.15, 0.035, 8, 20), dark, 0, 0.82, 0.32);
  steeringWheel.rotation.x = -0.9;
  body.add(steeringWheel);

  // Wheels.
  const wheels: THREE.Object3D[] = [];
  const frontPivots: THREE.Object3D[] = [];
  const tire = mat(0x1d1f24, 0.9);
  const hubcap = mat(character.accent, 0.35, 0.3);
  for (const [x, z] of [
    [0.68, 0.62],
    [-0.68, 0.62],
    [0.68, -0.62],
    [-0.68, -0.62],
  ]) {
    const pivot = new THREE.Group();
    pivot.position.set(x, WHEEL_RADIUS, z);
    const wheel = new THREE.Group();
    const rear = z < 0;
    const width = rear ? 0.34 : 0.28;
    const t = mesh(new THREE.CylinderGeometry(WHEEL_RADIUS, WHEEL_RADIUS, width, 18), tire);
    t.rotation.z = Math.PI / 2;
    const cap = mesh(new THREE.CylinderGeometry(0.15, 0.15, width + 0.02, 12), hubcap);
    cap.rotation.z = Math.PI / 2;
    const bolt = mesh(new THREE.BoxGeometry(width + 0.04, 0.06, 0.2), chrome);
    wheel.add(t, cap, bolt);
    pivot.add(wheel);
    root.add(pivot);
    wheels.push(wheel);
    if (!rear) frontPivots.push(pivot);
  }

  const animateExtras = buildDriver(body, character);
  root.traverse((o) => {
    if (o instanceof THREE.Mesh && o.material !== flameMaterial) o.castShadow = true;
  });
  return { root, body, wheels, frontPivots, flames, bodyMaterial, animateExtras };
}

function buildDriver(body: THREE.Group, character: Character): (dt: number, speed: number) => void {
  const driver = new THREE.Group();
  driver.position.set(0, 0.62, -0.22);
  body.add(driver);
  const skin = mat(character.skin, 0.6);
  const shirt = mat(character.accent, 0.6);
  const color = mat(character.color, 0.45);

  driver.add(mesh(new THREE.CapsuleGeometry(0.24, 0.22, 4, 12), shirt, 0, 0.3, 0));
  driver.add(mesh(new THREE.SphereGeometry(0.12, 10, 8), color, 0, 0.35, 0.2));
  for (const x of [-0.24, 0.24]) {
    const arm = mesh(new THREE.CapsuleGeometry(0.07, 0.34, 4, 8), shirt, x * 0.9, 0.36, 0.28);
    arm.rotation.x = Math.PI / 2 - 0.35;
    arm.rotation.z = -x * 0.9;
    driver.add(arm);
    driver.add(mesh(new THREE.SphereGeometry(0.08, 8, 6), mat(0xffffff, 0.6), x * 0.55, 0.26, 0.52));
  }

  const head = new THREE.Group();
  head.position.set(0, 0.78, 0.02);
  driver.add(head);
  head.add(mesh(new THREE.SphereGeometry(0.3, 20, 16), skin));
  const white = mat(0xffffff, 0.3);
  const black = mat(0x15151a, 0.3);
  for (const x of [-0.1, 0.1]) {
    const eye = mesh(new THREE.SphereGeometry(0.075, 12, 10), white, x, 0.04, 0.25);
    eye.scale.set(0.9, 1.25, 0.6);
    head.add(eye);
    head.add(mesh(new THREE.SphereGeometry(0.04, 10, 8), black, x, 0.05, 0.3));
  }
  head.add(mesh(new THREE.SphereGeometry(0.06, 10, 8), mat(new THREE.Color(character.skin).multiplyScalar(0.9), 0.6), 0, -0.05, 0.3));
  return buildHat(head, character.hat, color, mat(character.accent, 0.4));
}

function buildHat(head: THREE.Group, style: HatStyle, color: THREE.Material, accent: THREE.Material): (dt: number, speed: number) => void {
  const dome = (radius: number, material: THREE.Material, y = 0.02) => mesh(new THREE.SphereGeometry(radius, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), material, 0, y, 0);
  const noop = () => {};
  switch (style) {
    case 'cap': {
      head.add(dome(0.315, color));
      const brim = mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.04, 16, 1, false, -Math.PI / 2, Math.PI), color, 0, 0.06, 0.2);
      head.add(brim);
      head.add(mesh(new THREE.CircleGeometry(0.09, 16), accent, 0, 0.2, 0.25));
      return noop;
    }
    case 'helmet': {
      const shell = mesh(new THREE.SphereGeometry(0.34, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.62), color);
      head.add(shell);
      const visor = mesh(new THREE.SphereGeometry(0.345, 20, 8, -Math.PI * 0.35, Math.PI * 0.7, Math.PI * 0.28, Math.PI * 0.16), mat(0x2b3a55, 0.1, 0.6));
      head.add(visor);
      head.add(mesh(new THREE.BoxGeometry(0.05, 0.12, 0.5), accent, 0, 0.33, -0.02));
      return noop;
    }
    case 'ears': {
      for (const x of [-0.14, 0.14]) {
        const ear = mesh(new THREE.CapsuleGeometry(0.07, 0.36, 4, 10), color, x, 0.42, -0.04);
        ear.rotation.z = -x * 1.4;
        head.add(ear);
      }
      return noop;
    }
    case 'antenna': {
      const bobbles: THREE.Object3D[] = [];
      for (const x of [-0.12, 0.12]) {
        const stalk = new THREE.Group();
        stalk.position.set(x, 0.24, 0);
        stalk.rotation.z = -x * 2;
        stalk.add(mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.34, 6), mat(0x333333), 0, 0.17, 0));
        stalk.add(mesh(new THREE.SphereGeometry(0.07, 10, 8), accent, 0, 0.36, 0));
        head.add(stalk);
        bobbles.push(stalk);
      }
      let t = 0;
      return (dt, speed) => {
        t += dt * (4 + speed * 0.3);
        bobbles.forEach((b, i) => (b.rotation.x = Math.sin(t + i) * 0.25 - 0.2));
      };
    }
    case 'spikes': {
      for (let i = 0; i < 4; i++) {
        const angle = 0.5 - i * 0.45;
        const spike = mesh(new THREE.ConeGeometry(0.07, 0.2, 6), accent, 0, Math.cos(angle) * 0.3, Math.sin(angle) * 0.3);
        spike.rotation.x = angle;
        head.add(spike);
      }
      return noop;
    }
    case 'crown': {
      const gold = mat(0xffd23f, 0.25, 0.8);
      head.add(mesh(new THREE.CylinderGeometry(0.2, 0.18, 0.12, 16, 1, true), gold, 0, 0.3, 0));
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        head.add(mesh(new THREE.ConeGeometry(0.045, 0.12, 6), gold, Math.sin(a) * 0.19, 0.41, Math.cos(a) * 0.19));
      }
      head.add(mesh(new THREE.SphereGeometry(0.04, 8, 6), mat(0xe63946, 0.2), 0, 0.3, 0.2));
      return noop;
    }
    case 'bow': {
      for (const x of [-0.12, 0.12]) {
        const loop = mesh(new THREE.SphereGeometry(0.12, 12, 8), color, x, 0.3, -0.05);
        loop.scale.set(1.2, 0.8, 0.5);
        head.add(loop);
      }
      head.add(mesh(new THREE.SphereGeometry(0.06, 10, 8), accent, 0, 0.3, -0.03));
      return noop;
    }
    case 'propeller': {
      head.add(dome(0.315, color));
      const rotor = new THREE.Group();
      rotor.position.y = 0.36;
      rotor.add(mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.1, 6), mat(0x333333), 0, -0.03, 0));
      for (const [i, m] of [accent, color].entries()) {
        const blade = mesh(new THREE.BoxGeometry(0.3, 0.02, 0.08), m, i === 0 ? 0.15 : -0.15, 0.02, 0);
        rotor.add(blade);
      }
      head.add(rotor);
      return (dt, speed) => {
        rotor.rotation.y += dt * (3 + speed * 1.2);
      };
    }
  }
}
