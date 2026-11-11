import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import type { ModuleSpec } from '../core/types';
import { isHandmade } from './handmade';

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

export const hasRealModel = (id: string) => protos.has(id) && !isHandmade(id);
export const realModelCount = () => protos.size;

/** Copie du modèle réaliste d'un module, ou null s'il n'en a pas. */
export function realModel(s: ModuleSpec): THREE.Group | null {
  if (isHandmade(s.id)) return null; // modèle fait main : prioritaire sur la reconstruction
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
      if (!m.geometry.getAttribute('normal')) m.geometry.computeVertexNormals();
      // PVC gonflable : non métallique, satiné, léger vernis (reflets du soleil sur la toile tendue)
      const src = m.material as THREE.MeshStandardMaterial;
      if (src && (src as THREE.Material).isMaterial) {
        m.material = new THREE.MeshPhysicalMaterial({
          color: src.color ?? new THREE.Color(0xffffff),
          map: src.map ?? null,
          vertexColors: !!m.geometry.getAttribute('color'),
          metalness: 0,
          roughness: 0.42,
          clearcoat: 0.35,
          clearcoatRoughness: 0.35,
        });
      }
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
  // modèle normalisé aux dimensions officielles du module : longueur, largeur et hauteur exactes
  // (les reconstructions 3D n'ont pas d'échelle propre ; on évite aussi qu'un modèle déborde de son emprise)
  inner.scale.set(s.L / Math.max(size.x, 1e-3), s.H / Math.max(size.y, 1e-3), s.W / Math.max(size.z, 1e-3));
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
  // modèles compressés (géométrie meshopt, textures WebP : ~250 Ko par module)
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
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
