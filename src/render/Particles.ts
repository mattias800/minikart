import * as THREE from 'three';

export interface ParticleOptions {
  capacity: number;
  additive: boolean;
  /** Acceleration towards the planet centre. */
  gravity: number;
  /** Fraction of velocity lost per second. */
  drag: number;
}

const vertexShader = /* glsl */ `
  attribute float size;
  attribute float alpha;
  attribute vec3 tint;
  uniform float pixelScale;
  varying vec3 vTint;
  varying float vAlpha;
  void main() {
    vTint = tint;
    vAlpha = alpha;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = size * pixelScale / -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const fragmentShader = /* glsl */ `
  varying vec3 vTint;
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;
    gl_FragColor = vec4(vTint, smoothstep(0.5, 0.15, d) * vAlpha);
    #include <colorspace_fragment>
  }
`;

/** A pooled point-sprite particle system. Particles fall towards the planet, not "down". */
export class ParticleSystem {
  readonly points: THREE.Points;
  private readonly material: THREE.ShaderMaterial;
  private readonly positions: Float32Array;
  private readonly velocities: Float32Array;
  private readonly tints: Float32Array;
  private readonly sizes: Float32Array;
  private readonly baseSizes: Float32Array;
  private readonly alphas: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private count = 0;
  private readonly geometry = new THREE.BufferGeometry();

  constructor(private readonly options: ParticleOptions) {
    const n = options.capacity;
    this.positions = new Float32Array(n * 3);
    this.velocities = new Float32Array(n * 3);
    this.tints = new Float32Array(n * 3);
    this.sizes = new Float32Array(n);
    this.baseSizes = new Float32Array(n);
    this.alphas = new Float32Array(n);
    this.life = new Float32Array(n);
    this.maxLife = new Float32Array(n);
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('tint', new THREE.BufferAttribute(this.tints, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('size', new THREE.BufferAttribute(this.sizes, 1).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('alpha', new THREE.BufferAttribute(this.alphas, 1).setUsage(THREE.DynamicDrawUsage));
    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: { pixelScale: { value: 600 } },
      transparent: true,
      depthWrite: false,
      blending: options.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
  }

  /** Converts world-unit sizes to pixels; call on resize or FOV change. */
  setPixelScale(viewportHeight: number, fovDegrees: number): void {
    this.material.uniforms.pixelScale.value = viewportHeight / (2 * Math.tan(THREE.MathUtils.degToRad(fovDegrees) / 2));
  }

  emit(position: THREE.Vector3, velocity: THREE.Vector3, color: THREE.Color, size: number, life: number): void {
    if (this.count >= this.options.capacity) return;
    const i = this.count++;
    position.toArray(this.positions, i * 3);
    velocity.toArray(this.velocities, i * 3);
    this.tints[i * 3] = color.r;
    this.tints[i * 3 + 1] = color.g;
    this.tints[i * 3 + 2] = color.b;
    this.baseSizes[i] = size;
    this.sizes[i] = size;
    this.alphas[i] = 1;
    this.life[i] = life;
    this.maxLife[i] = life;
  }

  update(dt: number): void {
    const { gravity, drag } = this.options;
    const p = this.positions;
    const v = this.velocities;
    const damping = Math.max(0, 1 - drag * dt);
    for (let i = 0; i < this.count; i++) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.removeAt(i);
        i--;
        continue;
      }
      const k = i * 3;
      const len = Math.hypot(p[k], p[k + 1], p[k + 2]) || 1;
      v[k] = (v[k] - (p[k] / len) * gravity * dt) * damping;
      v[k + 1] = (v[k + 1] - (p[k + 1] / len) * gravity * dt) * damping;
      v[k + 2] = (v[k + 2] - (p[k + 2] / len) * gravity * dt) * damping;
      p[k] += v[k] * dt;
      p[k + 1] += v[k + 1] * dt;
      p[k + 2] += v[k + 2] * dt;
      const t = this.life[i] / this.maxLife[i];
      this.alphas[i] = Math.min(1, t * 2);
      this.sizes[i] = this.baseSizes[i] * (0.4 + 0.6 * t);
    }
    this.geometry.setDrawRange(0, this.count);
    for (const name of ['position', 'tint', 'size', 'alpha']) this.geometry.getAttribute(name).needsUpdate = true;
  }

  clear(): void {
    this.count = 0;
    this.geometry.setDrawRange(0, 0);
  }

  private removeAt(i: number): void {
    const last = --this.count;
    if (i === last) return;
    for (let c = 0; c < 3; c++) {
      this.positions[i * 3 + c] = this.positions[last * 3 + c];
      this.velocities[i * 3 + c] = this.velocities[last * 3 + c];
      this.tints[i * 3 + c] = this.tints[last * 3 + c];
    }
    this.sizes[i] = this.sizes[last];
    this.baseSizes[i] = this.baseSizes[last];
    this.alphas[i] = this.alphas[last];
    this.life[i] = this.life[last];
    this.maxLife[i] = this.maxLife[last];
  }
}
