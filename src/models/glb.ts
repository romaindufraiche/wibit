import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { ModuleSpec } from '../core/types';

/*
 * Modèles 3D réalistes (GLB générés depuis les rendus officiels, cf. scripts/meshy.mjs).
 * Chaque modèle est recalé sur l'emprise du module (longueur sur l'axe x, largeur sur z), posé
 * légèrement enfoncé dans l'eau. Sans modèle, l'application garde le rendu procédural.
 */

interface Entry {
  file: string;
  /** Rotation supplémentaire (degrés) si le modèle généré n'est pas orienté comme le module. */
  rotY?: number;
}

const protos = new Map<string, THREE.Group>();
let manifest: Record<string, Entry> = {};

export const hasRealModel = (id: string) => protos.has(id);
export const realModelCount = () => protos.size;

/** Copie du modèle réaliste d'un module, ou null s'il n'en a pas. */
export function realModel(s: ModuleSpec): THREE.Group | null {
  const p = protos.get(s.id);
  return p ? p.clone(true) : null;
}

function normalize(scene: THREE.Object3D, s: ModuleSpec, rotY = 0): THREE.Group {
  const holder = new THREE.Group();
  const inner = new THREE.Group();
  inner.add(scene);
  scene.traverse((c) => {
    const m = c as THREE.Mesh;
    if (m.isMesh) {
      m.castShadow = true;
      m.receiveShadow = true;
    }
  });
  // orientation : la plus grande dimension horizontale suit la longueur du module
  let box = new THREE.Box3().setFromObject(inner);
  let size = box.getSize(new THREE.Vector3());
  let rot = (rotY * Math.PI) / 180;
  if (!rotY && (size.x - size.z) * (s.L - s.W) < 0 && Math.abs(s.L - s.W) > 0.3) rot = Math.PI / 2;
  inner.rotation.y = rot;
  box = new THREE.Box3().setFromObject(inner);
  size = box.getSize(new THREE.Vector3());
  // échelle uniforme : l'emprise tient dans L × W et la hauteur ne dépasse pas la hauteur officielle (+15 %)
  const k = Math.min(s.L / Math.max(size.x, 1e-3), s.W / Math.max(size.z, 1e-3), (s.H * 1.15) / Math.max(size.y, 1e-3));
  inner.scale.setScalar(k);
  box = new THREE.Box3().setFromObject(inner);
  const c = box.getCenter(new THREE.Vector3());
  inner.position.set(-c.x, -box.min.y - 0.15, -c.z);
  holder.add(inner);
  return holder;
}

/** Charge les modèles listés dans /models/index.json ; `onReady` est appelé quand de nouveaux modèles sont prêts. */
export async function loadRealModels(specOf: (id: string) => ModuleSpec | null, onReady: () => void) {
  try {
    const r = await fetch('/models/index.json', { cache: 'no-cache' });
    if (!r.ok) return;
    manifest = await r.json();
  } catch {
    return;
  }
  const loader = new GLTFLoader();
  const ids = Object.keys(manifest);
  if (!ids.length) return;
  await Promise.all(
    ids.map(async (id) => {
      const s = specOf(id);
      if (!s) return;
      try {
        const gltf = await loader.loadAsync(`/models/${manifest[id].file}`);
        protos.set(id, normalize(gltf.scene, s, manifest[id].rotY));
      } catch {
        /* modèle illisible : rendu procédural conservé */
      }
    }),
  );
  if (protos.size) onReady();
}
