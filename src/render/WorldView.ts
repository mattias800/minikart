import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { createRng, fbm3, randRange, randomUnitVector, smoothstep } from '../core/math';
import type { Circuit } from '../sim/setup';
import { createTrackFrame, type Track } from '../sim/Track';
import { terrainHeight, type Decor, type DecorKind, type Obstacle, type ObstacleKind } from '../sim/World';
import { buildRibbon, surfaceMatrix } from './surface';
import { createBannerTexture, createBoostPadTexture, createCheckerTexture, createCurbTexture, createRoadTexture } from './textures';

const ROAD_LIFT = 0.05;
const DECAL_LIFT = 0.07;
const CURB_WIDTH = 0.7;

function standard(color: THREE.ColorRepresentation, options: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, ...options });
}

function translated(geometry: THREE.BufferGeometry, x: number, y: number, z: number): THREE.BufferGeometry {
  return geometry.translate(x, y, z);
}

/** Merges geometries after dropping attributes that not all of them share. */
function merge(geometries: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const prepared = geometries.map((g) => {
    const clean = g.index ? g.toNonIndexed() : g;
    clean.deleteAttribute('uv');
    return clean;
  });
  const merged = mergeGeometries(prepared);
  if (!merged) throw new Error('Failed to merge geometries');
  return merged;
}

/** Static scenery: the planet, the road and everything planted around it. */
export class WorldView {
  readonly group = new THREE.Group();
  private readonly track: Track;
  private readonly animated: ((dt: number, time: number) => void)[] = [];

  constructor(circuit: Circuit) {
    this.track = circuit.track;
    this.group.add(this.buildPlanet());
    this.buildRoad();
    this.buildStartArch();
    this.buildBoostPads(circuit);
    this.buildObstacles(circuit.world.obstacles);
    this.buildDecor(circuit.world.decor);
    this.buildClouds();
  }

  /** Height of the ground above the base sphere at `position`. */
  groundHeight(position: THREE.Vector3, distanceFromCenterline?: number): number {
    const distance = distanceFromCenterline ?? this.track.distanceToCenterline(position);
    return terrainHeight(tmpDir.copy(position).normalize(), distance, this.track.halfWidth);
  }

  update(dt: number, time: number): void {
    for (const animate of this.animated) animate(dt, time);
  }

  private buildPlanet(): THREE.Mesh {
    const R = this.track.radius;
    const hw = this.track.halfWidth;
    let geometry: THREE.BufferGeometry = new THREE.IcosahedronGeometry(1, 56);
    geometry.deleteAttribute('normal');
    geometry.deleteAttribute('uv');
    geometry = mergeVertices(geometry);
    const position = geometry.getAttribute('position') as THREE.BufferAttribute;
    const colors = new Float32Array(position.count * 3);
    const dir = new THREE.Vector3();
    const surface = new THREE.Vector3();
    const grassDark = new THREE.Color('#4fae3f');
    const grassLight = new THREE.Color('#86d45a');
    const dirt = new THREE.Color('#d8b67a');
    const hilltop = new THREE.Color('#a4e070');
    const color = new THREE.Color();
    for (let i = 0; i < position.count; i++) {
      dir.fromBufferAttribute(position, i).normalize();
      const distance = this.track.distanceToCenterline(surface.copy(dir).multiplyScalar(R));
      const height = terrainHeight(dir, distance, hw);
      dir.clone().multiplyScalar(R + height).toArray(position.array, i * 3);

      const n = fbm3(dir.x * 7, dir.y * 7, dir.z * 7, 3);
      color.copy(grassDark).lerp(grassLight, smoothstep(0.3, 0.7, n));
      color.lerp(hilltop, smoothstep(0.8, 1.9, height) * 0.6);
      color.lerp(dirt, 1 - smoothstep(hw + 0.6, hw + 1.8, distance));
      color.toArray(colors, i * 3);
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }));
    mesh.receiveShadow = true;
    return mesh;
  }

  private buildRoad(): void {
    const track = this.track;
    const L = track.length;
    const hw = track.halfWidth;
    // Make the texture repeat a whole number of times so the loop closes seamlessly.
    const roadRepeat = L / Math.round(L / 8);
    const road = new THREE.Mesh(
      buildRibbon(track, { from: 0, to: L, lateralFrom: -hw, lateralTo: hw, lateralSegments: 10, lift: ROAD_LIFT, vLength: roadRepeat }),
      standard(0xffffff, { map: createRoadTexture(), roughness: 0.9 }),
    );
    road.receiveShadow = true;
    this.group.add(road);

    const curbRepeat = L / Math.round(L / 2);
    const curbMaterial = standard(0xffffff, { map: createCurbTexture(), roughness: 0.7 });
    for (const side of [-1, 1]) {
      const inner = side * hw;
      const outer = side * (hw + CURB_WIDTH);
      const curb = new THREE.Mesh(
        buildRibbon(track, {
          from: 0,
          to: L,
          lateralFrom: side < 0 ? outer : inner,
          lateralTo: side < 0 ? inner : outer,
          lateralSegments: 2,
          lift: ROAD_LIFT + 0.03,
          vLength: curbRepeat,
        }),
        curbMaterial,
      );
      curb.receiveShadow = true;
      this.group.add(curb);
    }

    const startLine = new THREE.Mesh(
      buildRibbon(track, { from: -0.8, to: 0.8, lateralFrom: -hw, lateralTo: hw, lateralSegments: 10, lift: DECAL_LIFT, vLength: 1.6 }),
      standard(0xffffff, { map: createCheckerTexture(12, 2), roughness: 0.8 }),
    );
    startLine.receiveShadow = true;
    this.group.add(startLine);
  }

  private buildStartArch(): void {
    const track = this.track;
    const frame = track.frameAt(0, createTrackFrame());
    const arch = new THREE.Group();
    const span = track.halfWidth + CURB_WIDTH + 0.6;
    const postMaterial = standard(0xeeeeee, { roughness: 0.5 });
    const height = 4.6;
    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.28, height, 12), postMaterial);
      post.position.set(side * span, height / 2, 0);
      post.castShadow = true;
      arch.add(post);
    }
    const bannerTexture = createBannerTexture("WORLD'S SMALLEST GP");
    const plain = standard(0x1b1f3b);
    const bannerFace = standard(0xffffff, { map: bannerTexture, emissive: 0xffffff, emissiveMap: bannerTexture, emissiveIntensity: 0.25 });
    const banner = new THREE.Mesh(new THREE.BoxGeometry(span * 2 + 0.6, 1.0, 0.25), [plain, plain, plain, plain, bannerFace, bannerFace]);
    banner.position.y = height - 0.4;
    banner.castShadow = true;
    arch.add(banner);

    // Local +X across the road, +Y up, -Z along the direction of travel (right × up = -forward).
    const basis = new THREE.Matrix4().makeBasis(frame.right, frame.up, frame.tangent.clone().negate());
    arch.quaternion.setFromRotationMatrix(basis);
    arch.position.copy(frame.up).multiplyScalar(track.radius + ROAD_LIFT);
    this.group.add(arch);
  }

  private buildBoostPads(circuit: Circuit): void {
    const texture = createBoostPadTexture();
    const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity: 0.95, toneMapped: false });
    for (const pad of circuit.world.boostPads) {
      const geometry = buildRibbon(this.track, {
        from: pad.s - pad.length / 2,
        to: pad.s + pad.length / 2,
        lateralFrom: pad.lateral - pad.width / 2,
        lateralTo: pad.lateral + pad.width / 2,
        lateralSegments: 2,
        lift: DECAL_LIFT,
        vLength: pad.length / 2,
      });
      this.group.add(new THREE.Mesh(geometry, material));
    }
    this.animated.push((dt) => {
      texture.offset.y -= dt * 2.2;
    });
  }

  private buildObstacles(obstacles: Obstacle[]): void {
    const byKind = new Map<ObstacleKind, Obstacle[]>();
    for (const o of obstacles) byKind.set(o.kind, [...(byKind.get(o.kind) ?? []), o]);
    const rng = createRng(99);

    const tree = byKind.get('tree') ?? [];
    this.instanced(tree, translated(new THREE.CylinderGeometry(0.16, 0.24, 1.3, 7), 0, 0.65, 0), standard(0x8a5a33));
    this.instanced(
      tree,
      merge([translated(new THREE.IcosahedronGeometry(1.0, 1), 0, 1.9, 0), translated(new THREE.IcosahedronGeometry(0.7, 1), 0.35, 2.55, 0.1)]),
      standard(0xffffff, { flatShading: true }),
      () => new THREE.Color().setHSL(randRange(rng, 0.25, 0.33), 0.6, randRange(rng, 0.36, 0.46)),
    );

    const pine = byKind.get('pine') ?? [];
    this.instanced(pine, translated(new THREE.CylinderGeometry(0.14, 0.2, 0.8, 6), 0, 0.4, 0), standard(0x7a4b2a));
    this.instanced(
      pine,
      merge([
        translated(new THREE.ConeGeometry(1.0, 1.5, 7), 0, 1.3, 0),
        translated(new THREE.ConeGeometry(0.78, 1.3, 7), 0, 2.0, 0),
        translated(new THREE.ConeGeometry(0.52, 1.1, 7), 0, 2.65, 0),
      ]),
      standard(0xffffff, { flatShading: true }),
      () => new THREE.Color().setHSL(randRange(rng, 0.36, 0.42), 0.55, randRange(rng, 0.26, 0.34)),
    );

    const mushrooms = byKind.get('mushroom') ?? [];
    this.instanced(mushrooms, translated(new THREE.CylinderGeometry(0.32, 0.42, 1.4, 12), 0, 0.7, 0), standard(0xfff1d6));
    this.instanced(
      mushrooms,
      translated(new THREE.SphereGeometry(1.15, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.75, 1), 0, 1.3, 0),
      standard(0xffffff),
      () => new THREE.Color(rng() < 0.5 ? 0xe63946 : 0x3a86ff),
    );
    const spots: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 7; i++) {
      const theta = (i / 7) * Math.PI * 2;
      const phi = i === 0 ? 0 : 0.85;
      const spot = new THREE.SphereGeometry(0.22, 10, 6).scale(1, 0.3, 1);
      const dir = new THREE.Vector3(Math.sin(phi) * Math.cos(theta), Math.cos(phi), Math.sin(phi) * Math.sin(theta));
      spot.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir));
      spots.push(translated(spot, dir.x * 1.06, 1.3 + dir.y * 1.06 * 0.75, dir.z * 1.06));
    }
    this.instanced(mushrooms, merge(spots), standard(0xffffff));

    const rocks = byKind.get('rock') ?? [];
    this.instanced(rocks, new THREE.DodecahedronGeometry(0.85, 0).scale(1, 0.7, 1.1), standard(0x9aa0a6, { flatShading: true }), () =>
      new THREE.Color().setHSL(0.6, 0.05, randRange(rng, 0.5, 0.66)),
    );

    for (const o of byKind.get('windmill') ?? []) this.group.add(this.buildWindmill(o));
    for (const o of byKind.get('lighthouse') ?? []) this.group.add(this.buildLighthouse(o));
  }

  private instanced(
    items: readonly (Obstacle | Decor)[],
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    colorFor?: (index: number) => THREE.Color,
    castShadow = true,
  ): void {
    if (items.length === 0) return;
    const mesh = new THREE.InstancedMesh(geometry, material, items.length);
    const matrix = new THREE.Matrix4();
    items.forEach((item, i) => {
      const base = this.track.radius + this.groundHeight(item.position) - 0.05;
      mesh.setMatrixAt(i, surfaceMatrix(item.position, item.yaw, item.scale, base, matrix));
      if (colorFor) mesh.setColorAt(i, colorFor(i));
    });
    mesh.castShadow = castShadow;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    this.group.add(mesh);
  }

  private buildWindmill(o: Obstacle): THREE.Group {
    const group = new THREE.Group();
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.6, 5.2, 10), standard(0xfff3dc));
    tower.position.y = 2.6;
    const roof = new THREE.Mesh(new THREE.ConeGeometry(1.35, 1.6, 10), standard(0xd94a3d));
    roof.position.y = 6.0;
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.2, 0.2), standard(0x7a4b2a));
    door.position.set(0, 0.6, 1.5);
    const hub = new THREE.Group();
    hub.position.set(0, 4.6, 1.25);
    const bladeMaterial = standard(0xf7f7f7, { side: THREE.DoubleSide });
    for (let i = 0; i < 4; i++) {
      const arm = new THREE.Group();
      arm.rotation.z = (i * Math.PI) / 2;
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.7, 2.8, 0.06), bladeMaterial);
      blade.position.set(0.25, 1.7, 0);
      const spar = new THREE.Mesh(new THREE.BoxGeometry(0.12, 3.2, 0.12), standard(0x8a5a33));
      spar.position.y = 1.6;
      arm.add(blade, spar);
      hub.add(arm);
    }
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 8), standard(0xd94a3d));
    hub.add(cap);
    group.add(tower, roof, door, hub);
    group.traverse((c) => {
      c.castShadow = true;
      c.receiveShadow = true;
    });
    this.place(group, o);
    this.animated.push((dt) => {
      hub.rotation.z += dt * 1.2;
    });
    return group;
  }

  private buildLighthouse(o: Obstacle): THREE.Group {
    const group = new THREE.Group();
    const red = standard(0xe63946);
    const white = standard(0xf8f8f8);
    for (let i = 0; i < 5; i++) {
      const r0 = 1.25 - i * 0.12;
      const band = new THREE.Mesh(new THREE.CylinderGeometry(r0 - 0.12, r0, 1.1, 14), i % 2 === 0 ? red : white);
      band.position.y = 0.55 + i * 1.1;
      group.add(band);
    }
    const gallery = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.0, 0.18, 14), standard(0x333a45));
    gallery.position.y = 5.6;
    const lampMaterial = new THREE.MeshStandardMaterial({ color: 0xfff2a8, emissive: 0xffd166, emissiveIntensity: 1.5 });
    const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.9, 12), lampMaterial);
    lamp.position.y = 6.15;
    const roof = new THREE.Mesh(new THREE.ConeGeometry(0.8, 0.9, 14), red);
    roof.position.y = 7.05;
    group.add(gallery, lamp, roof);
    group.traverse((c) => {
      c.castShadow = true;
      c.receiveShadow = true;
    });
    this.place(group, o);
    this.animated.push((_dt, time) => {
      lampMaterial.emissiveIntensity = 1.2 + Math.sin(time * 3) * 0.6;
    });
    return group;
  }

  private place(group: THREE.Group, o: Obstacle): void {
    surfaceMatrix(o.position, o.yaw, o.scale, this.track.radius + this.groundHeight(o.position) - 0.1, group.matrix);
    group.matrix.decompose(group.position, group.quaternion, group.scale);
  }

  private buildDecor(decor: Decor[]): void {
    const byKind = new Map<DecorKind, Decor[]>();
    for (const d of decor) byKind.set(d.kind, [...(byKind.get(d.kind) ?? []), d]);
    const flowerColors = [0xff5d8f, 0xffd23f, 0xffffff, 0xb388ff, 0xff8c42].map((c) => new THREE.Color(c));

    const flowers = byKind.get('flower') ?? [];
    // Five round petals around a yellow middle.
    const petals = merge(
      Array.from({ length: 5 }, (_, i) => {
        const a = (i / 5) * Math.PI * 2;
        return new THREE.SphereGeometry(0.075, 8, 4).scale(1, 0.4, 1).translate(Math.cos(a) * 0.08, 0.2, Math.sin(a) * 0.08);
      }),
    );
    this.instanced(flowers, petals, standard(0xffffff), (i) => flowerColors[flowers[i].variant % flowerColors.length], false);
    this.instanced(flowers, translated(new THREE.SphereGeometry(0.05, 8, 4), 0, 0.22, 0), standard(0xffc233), undefined, false);
    this.instanced(flowers, translated(new THREE.CylinderGeometry(0.018, 0.018, 0.2, 4), 0, 0.1, 0), standard(0x3f8f2f), undefined, false);

    const tufts = byKind.get('tuft') ?? [];
    this.instanced(
      tufts,
      merge([-0.4, 0, 0.4].map((a) => new THREE.ConeGeometry(0.07, 0.42, 4).translate(0, 0.21, 0).rotateZ(a).translate(a * 0.2, 0, 0))),
      standard(0x3e9a34, { flatShading: true }),
      undefined,
      false,
    );

    const bushes = byKind.get('bush') ?? [];
    this.instanced(bushes, translated(new THREE.IcosahedronGeometry(0.6, 1).scale(1.2, 0.8, 1), 0, 0.35, 0), standard(0xffffff, { flatShading: true }), (i) =>
      new THREE.Color().setHSL(0.28 + bushes[i].variant * 0.04, 0.55, 0.38),
    );
  }

  private buildClouds(): void {
    const rng = createRng(7);
    const layer = new THREE.Group();
    const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, emissive: 0xffffff, emissiveIntensity: 0.25, flatShading: true });
    const dir = new THREE.Vector3();
    for (let i = 0; i < 14; i++) {
      const puffs: THREE.BufferGeometry[] = [];
      const count = 4 + Math.floor(rng() * 3);
      for (let j = 0; j < count; j++) {
        const r = randRange(rng, 0.9, 1.6);
        puffs.push(new THREE.IcosahedronGeometry(r, 1).translate((j - count / 2) * 1.1, randRange(rng, -0.2, 0.4), randRange(rng, -0.5, 0.5)));
      }
      const cloud = new THREE.Mesh(merge(puffs), material);
      randomUnitVector(rng, dir);
      surfaceMatrix(dir, rng() * Math.PI * 2, randRange(rng, 0.8, 1.3), this.track.radius + randRange(rng, 13, 19), cloud.matrix);
      cloud.matrix.decompose(cloud.position, cloud.quaternion, cloud.scale);
      layer.add(cloud);
    }
    const axis = new THREE.Vector3(0.3, 1, 0.2).normalize();
    this.animated.push((dt) => layer.rotateOnAxis(axis, dt * 0.015));
    this.group.add(layer);
  }
}

const tmpDir = new THREE.Vector3();
