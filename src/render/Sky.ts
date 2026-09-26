import * as THREE from 'three';

const vertexShader = /* glsl */ `
  varying vec3 vDirection;
  void main() {
    vDirection = normalize((modelMatrix * vec4(position, 1.0)).xyz - cameraPosition);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position.z = gl_Position.w; // always at the far plane
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 zenith;
  uniform vec3 horizon;
  uniform vec3 below;
  uniform vec3 up;
  uniform vec3 sunDirection;
  varying vec3 vDirection;
  void main() {
    vec3 dir = normalize(vDirection);
    float h = dot(dir, up);
    vec3 color = h > 0.0 ? mix(horizon, zenith, pow(h, 0.6)) : mix(horizon, below, pow(-h, 0.5));
    float sun = max(dot(dir, sunDirection), 0.0);
    color += vec3(1.0, 0.9, 0.7) * (pow(sun, 400.0) * 1.5 + pow(sun, 12.0) * 0.18);
    gl_FragColor = vec4(color, 1.0);
    #include <colorspace_fragment>
  }
`;

/**
 * A gradient sky dome. On a tiny planet "up" depends on where you are, so the gradient
 * follows whichever up vector the camera is using.
 */
export class Sky {
  readonly mesh: THREE.Mesh;
  private readonly uniforms = {
    zenith: { value: new THREE.Color('#2f8cf0') },
    horizon: { value: new THREE.Color('#c6ecff') },
    below: { value: new THREE.Color('#8fd0ff') },
    up: { value: new THREE.Vector3(0, 1, 0) },
    sunDirection: { value: new THREE.Vector3(0.3, 0.8, 0.2).normalize() },
  };

  constructor() {
    const material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: this.uniforms,
      side: THREE.BackSide,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(500, 32, 16), material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1;
    this.mesh.userData.noBend = true;
  }

  update(camera: THREE.Camera, up: THREE.Vector3, sunDirection: THREE.Vector3): void {
    this.mesh.position.copy(camera.position);
    this.uniforms.up.value.copy(up);
    this.uniforms.sunDirection.value.copy(sunDirection);
  }
}
