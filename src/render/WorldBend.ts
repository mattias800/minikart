import * as THREE from 'three';

/**
 * "Unrolls" the tiny planet around the player at render time.
 *
 * A planet this small curves away so quickly that a chase camera sees only a few metres of road.
 * The simulation stays on the real, tiny sphere; only the vertex shader remaps every point onto a
 * sphere `factor` times larger, touching the real one at `anchor`. Distances along the ground are
 * preserved (a point s metres away stays s metres away), so the road simply curves `factor` times
 * more gently. Far-side geometry, which would otherwise be stretched around the antipode, is sunk
 * out of sight well beyond the horizon.
 *
 * Shadow maps are rendered with three's internal depth materials, which are not patched, so
 * shadows are computed in true space and looked up with the true world position: they stay glued
 * to the objects that cast them.
 */
export class WorldBend {
  readonly uniforms = {
    bendAnchor: { value: new THREE.Vector3(0, 1, 0) },
    bendRadius: { value: 1 },
    bendFactor: { value: 1 },
  };
  private readonly patched = new WeakSet<THREE.Material>();

  constructor(radius: number) {
    this.uniforms.bendRadius.value = radius;
  }

  get factor(): number {
    return this.uniforms.bendFactor.value;
  }

  set factor(value: number) {
    this.uniforms.bendFactor.value = Math.max(1, value);
  }

  get anchor(): THREE.Vector3 {
    return this.uniforms.bendAnchor.value;
  }

  /**
   * Patches every material in the scene that hasn't been patched yet. Bent objects can appear
   * where their true bounds say they're off-screen, so frustum culling is disabled for them.
   */
  apply(root: THREE.Object3D): void {
    root.traverse((object) => {
      if (object.userData.noBend) return;
      const material = (object as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      if (!material) return;
      object.frustumCulled = false;
      for (const m of Array.isArray(material) ? material : [material]) this.patch(m);
    });
  }

  /** CPU version of the shader warp, for placing the camera in bent space. */
  bendPoint(p: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    const u = this.anchor;
    const R = this.uniforms.bendRadius.value;
    const k = this.factor;
    const r = p.length();
    if (k <= 1.0001 || r < 1e-6) return out.copy(p);
    const n = tmpN.copy(p).divideScalar(r);
    const sinPhi = tmpC.crossVectors(n, u).length();
    const phi = Math.atan2(sinPhi, n.dot(u));
    const tangent = tmpT.copy(n).addScaledVector(u, -Math.cos(phi));
    if (tangent.lengthSq() < 1e-12) tangent.set(0, 0, 0);
    else tangent.normalize();
    const bentRadius = R * k;
    const bentPhi = phi / k;
    const height = r - R;
    return out
      .copy(u)
      .multiplyScalar(R - bentRadius)
      .addScaledVector(u, Math.cos(bentPhi) * (bentRadius + height))
      .addScaledVector(tangent, Math.sin(bentPhi) * (bentRadius + height));
  }

  private patch(material: THREE.Material): void {
    if (this.patched.has(material)) return;
    this.patched.add(material);
    if (material instanceof THREE.ShaderMaterial) {
      // Custom shaders opt in by calling bendPoint() themselves (see Particles).
      if (material.userData.bendable) Object.assign(material.uniforms, this.uniforms);
      return;
    }
    const previous = material.onBeforeCompile;
    material.onBeforeCompile = (shader, renderer) => {
      previous.call(material, shader, renderer);
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = BEND_GLSL + '\n' + shader.vertexShader
        .replace('#include <defaultnormal_vertex>', `#include <defaultnormal_vertex>\n${BEND_NORMAL}`)
        .replace('#include <project_vertex>', BEND_PROJECT);
    };
    const key = material.customProgramCacheKey.bind(material);
    material.customProgramCacheKey = () => `${key()}|bend`;
    material.needsUpdate = true;
  }
}

const tmpN = new THREE.Vector3();
const tmpC = new THREE.Vector3();
const tmpT = new THREE.Vector3();

/** Shared GLSL: warp a world-space point, and rotate a world-space direction to match. */
export const BEND_GLSL = /* glsl */ `
  uniform vec3 bendAnchor;
  uniform float bendRadius;
  uniform float bendFactor;

  // Returns the bent point; writes the rotation axis/angle that carries directions along.
  vec3 bendPointFull(vec3 p, out vec3 axis, out float delta) {
    axis = vec3(0.0);
    delta = 0.0;
    float r = length(p);
    if (bendFactor <= 1.0001 || r < 1e-5) return p;
    vec3 n = p / r;
    vec3 u = bendAnchor;
    vec3 c = cross(u, n);
    float phi = atan(length(c), dot(n, u));
    vec3 t = n - u * cos(phi);
    float tl = length(t);
    t = tl > 1e-6 ? t / tl : vec3(0.0);
    float bentRadius = bendRadius * bendFactor;
    float bentPhi = phi / bendFactor;
    // Sink the far side of the planet out of sight instead of smearing it around the antipode.
    float height = mix(r - bendRadius, -bendRadius, smoothstep(2.1, 2.7, phi));
    axis = length(c) > 1e-6 ? normalize(c) : vec3(0.0);
    delta = bentPhi - phi;
    return u * (bendRadius - bentRadius) + (u * cos(bentPhi) + t * sin(bentPhi)) * (bentRadius + height);
  }

  vec3 bendPoint(vec3 p) {
    vec3 axis;
    float delta;
    return bendPointFull(p, axis, delta);
  }

  vec3 bendRotate(vec3 v, vec3 axis, float angle) {
    // Rodrigues' rotation formula.
    float c = cos(angle);
    float s = sin(angle);
    return v * c + cross(axis, v) * s + axis * dot(axis, v) * (1.0 - c);
  }
`;

const BEND_NORMAL = /* glsl */ `
  {
    vec4 bendLocal = vec4(position, 1.0);
    #ifdef USE_INSTANCING
      bendLocal = instanceMatrix * bendLocal;
    #endif
    vec3 bendAxis;
    float bendDelta;
    bendPointFull((modelMatrix * bendLocal).xyz, bendAxis, bendDelta);
    mat3 viewRotation = mat3(viewMatrix);
    vec3 worldNormal = transpose(viewRotation) * transformedNormal;
    transformedNormal = viewRotation * bendRotate(worldNormal, bendAxis, bendDelta);
  }
`;

const BEND_PROJECT = /* glsl */ `
  vec4 mvPosition = vec4(transformed, 1.0);
  #ifdef USE_BATCHING
    mvPosition = batchingMatrix * mvPosition;
  #endif
  #ifdef USE_INSTANCING
    mvPosition = instanceMatrix * mvPosition;
  #endif
  mvPosition = viewMatrix * vec4(bendPoint((modelMatrix * mvPosition).xyz), 1.0);
  gl_Position = projectionMatrix * mvPosition;
`;
