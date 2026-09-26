import * as THREE from 'three';
import type { Character } from '../sim/characters';
import { buildKartModel } from './KartModel';

/**
 * Renders a three-quarter portrait of every character in their kart, for the select screen.
 * Uses a throwaway renderer so the main one's state is untouched.
 */
export function renderPortraits(characters: readonly Character[], size = 256): Map<string, string> {
  const portraits = new Map<string, string>();
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  } catch {
    return portraits;
  }
  renderer.setSize(size, size, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;

  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x88aa66, 2.2));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(3, 5, 4);
  scene.add(sun);
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
  camera.position.set(2.6, 2.3, 3.6);
  camera.lookAt(0, 0.75, 0);

  for (const character of characters) {
    const model = buildKartModel(character);
    model.root.rotation.y = 0.25;
    scene.add(model.root);
    renderer.render(scene, camera);
    portraits.set(character.id, renderer.domElement.toDataURL('image/png'));
    scene.remove(model.root);
  }
  renderer.dispose();
  renderer.forceContextLoss();
  return portraits;
}
