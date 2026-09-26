import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { createItemBoxTexture } from './textures';

/** Shared geometry and materials for everything that is thrown, dropped or picked up. */
export class ItemModels {
  private readonly boxGeometry = new RoundedBoxGeometry(1.1, 1.1, 1.1, 3, 0.14);
  private readonly boxMaterial: THREE.MeshStandardMaterial;
  private readonly bananaGeometry: THREE.BufferGeometry;
  private readonly bananaMaterial = new THREE.MeshStandardMaterial({ color: 0xffd93b, roughness: 0.45 });
  private readonly tipMaterial = new THREE.MeshStandardMaterial({ color: 0x5b3a1e, roughness: 0.8 });
  private readonly shellDome = new THREE.SphereGeometry(0.42, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2);
  private readonly shellRim = new THREE.TorusGeometry(0.42, 0.08, 8, 24).rotateX(Math.PI / 2);
  private readonly rimMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 });
  private readonly shellMaterials = {
    green: new THREE.MeshStandardMaterial({ color: 0x2ecc40, roughness: 0.3 }),
    red: new THREE.MeshStandardMaterial({ color: 0xe63946, roughness: 0.3 }),
  };

  constructor() {
    const texture = createItemBoxTexture();
    this.boxMaterial = new THREE.MeshStandardMaterial({
      map: texture,
      emissive: 0xffffff,
      emissiveMap: texture,
      emissiveIntensity: 0.35,
      transparent: true,
      opacity: 0.88,
      roughness: 0.2,
    });
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.42, 0.42, 0),
      new THREE.Vector3(-0.28, 0.14, 0),
      new THREE.Vector3(0, 0.06, 0),
      new THREE.Vector3(0.28, 0.14, 0),
      new THREE.Vector3(0.42, 0.42, 0),
    ]);
    this.bananaGeometry = new THREE.TubeGeometry(curve, 16, 0.12, 8, false);
  }

  itemBox(): THREE.Mesh {
    const mesh = new THREE.Mesh(this.boxGeometry, this.boxMaterial);
    mesh.castShadow = true;
    return mesh;
  }

  banana(): THREE.Group {
    const group = new THREE.Group();
    const peel = new THREE.Mesh(this.bananaGeometry, this.bananaMaterial);
    peel.castShadow = true;
    group.add(peel);
    for (const x of [-0.42, 0.42]) {
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), this.tipMaterial);
      tip.position.set(x, 0.42, 0);
      group.add(tip);
    }
    return group;
  }

  shell(kind: 'green' | 'red'): THREE.Group {
    const group = new THREE.Group();
    const dome = new THREE.Mesh(this.shellDome, this.shellMaterials[kind]);
    dome.position.y = 0.1;
    dome.castShadow = true;
    const rim = new THREE.Mesh(this.shellRim, this.rimMaterial);
    rim.position.y = 0.1;
    group.add(dome, rim);
    return group;
  }
}
