import * as THREE from 'three';
import { buildModel } from '../models/builders';
import type { ModuleSpec } from '../core/types';

/** Génère les vignettes du catalogue (rendu hors écran, par lots pour ne pas bloquer l'interface). */
export function renderThumbnails(specs: ModuleSpec[], onThumb: (id: string, url: string) => void) {
  const W = 200,
    H = 140;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setSize(W, H);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x446688, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(5, 10, 7);
  scene.add(sun);
  const camera = new THREE.PerspectiveCamera(30, W / H, 0.1, 500);
  const queue = [...specs];

  const step = () => {
    const batch = queue.splice(0, 6);
    for (const s of batch) {
      const model = buildModel(s);
      scene.add(model);
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      const r = Math.max(size.x, size.y * 1.4, size.z) * 0.9 + 0.5;
      camera.position.set(center.x + r * 1.1, center.y + r * 0.9, center.z + r * 1.5);
      camera.lookAt(center);
      renderer.render(scene, camera);
      onThumb(s.id, renderer.domElement.toDataURL('image/png'));
      scene.remove(model);
    }
    if (queue.length) setTimeout(step, 16);
    else renderer.dispose();
  };
  setTimeout(step, 50);
}
