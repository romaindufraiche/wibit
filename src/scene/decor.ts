import * as THREE from 'three';
import type { DecorItem, DecorType, Site } from '../core/types';

/*
 * Aménagements autour du bassin : gradins, transats et parasols, chaise de surveillance,
 * jardinières. Ils se déplacent à la souris (et pivotent avec R) mais n'entrent ni dans les
 * règles de sécurité ni dans le devis. Convention : l'objet « regarde » vers −z avant rotation
 * (les spectateurs des gradins font face à −z).
 */

export const DECOR: Record<DecorType, { name: string; L: number; W: number }> = {
  'stands-3': { name: 'Gradins 3 rangs', L: 8, W: 2.6 },
  'stands-5': { name: 'Gradins 5 rangs', L: 12, W: 4.2 },
  loungers: { name: 'Transats et parasol', L: 4.2, W: 2.4 },
  lifeguard: { name: 'Chaise de surveillance', L: 1.4, W: 1.6 },
  planter: { name: 'Jardinière', L: 2.4, W: 1 },
};

const mat = (color: number, rough = 0.6, metal = 0) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
const M = {
  alu: mat(0xc9ced4, 0.35, 0.6),
  seatA: mat(0x003865, 0.5),
  seatB: mat(0x0b5fa5, 0.5),
  lime: mat(0xc8d400, 0.55),
  white: mat(0xf5f5f2, 0.6),
  wood: mat(0xb98a5a, 0.8),
  red: mat(0xd8382b, 0.6),
  soil: mat(0x5b4430, 1),
  leaf: mat(0x3f7f3a, 0.9),
  leaf2: mat(0x57964a, 0.9),
};

function box(w: number, h: number, d: number, m: THREE.Material, x = 0, y = 0, z = 0) {
  const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  b.position.set(x, y + h / 2, z);
  b.castShadow = b.receiveShadow = true;
  return b;
}
function cyl(r: number, h: number, m: THREE.Material, x = 0, y = 0, z = 0, seg = 12) {
  const c = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), m);
  c.position.set(x, y + h / 2, z);
  c.castShadow = true;
  return c;
}

/** Gradins : structure aluminium, marches et sièges baquets bleus, garde-corps à l'arrière. */
function stands(rows: number, L: number): THREE.Group {
  const g = new THREE.Group();
  const step = 0.8,
    rise = 0.42;
  const depth = rows * step;
  for (let r = 0; r < rows; r++) {
    const z = -depth / 2 + step * (r + 0.5);
    const y = rise * (r + 1);
    // marche (plancher) et contremarche
    g.add(box(L, 0.08, step, M.alu, 0, y - 0.08, z));
    g.add(box(L, y - 0.08, 0.05, M.alu, 0, 0, z - step / 2 + 0.02));
    // sièges baquets
    const n = Math.floor(L / 0.55);
    for (let i = 0; i < n; i++) {
      const x = -L / 2 + 0.3 + i * ((L - 0.6) / Math.max(1, n - 1));
      const m = (i + r) % 7 === 0 ? M.lime : r % 2 ? M.seatB : M.seatA;
      g.add(box(0.44, 0.08, 0.4, m, x, y, z + 0.05));
      g.add(box(0.44, 0.34, 0.06, m, x, y + 0.06, z + 0.26));
    }
  }
  // poteaux et garde-corps arrière
  const top = rise * rows;
  for (const x of [-L / 2, -L / 4, 0, L / 4, L / 2]) g.add(cyl(0.05, top + 1, M.alu, x, 0, depth / 2 - 0.05, 8));
  g.add(box(L, 0.05, 0.05, M.alu, 0, top + 1, depth / 2 - 0.05));
  g.add(box(L, 0.05, 0.05, M.alu, 0, top + 0.5, depth / 2 - 0.05));
  // joues latérales
  for (const x of [-L / 2, L / 2]) {
    const shape = new THREE.Shape([new THREE.Vector2(-depth / 2, 0), new THREE.Vector2(depth / 2, 0), new THREE.Vector2(depth / 2, top), new THREE.Vector2(-depth / 2, rise)]);
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.06, bevelEnabled: false });
    const side = new THREE.Mesh(geo, M.alu);
    side.rotation.y = Math.PI / 2;
    side.position.x = x + (x < 0 ? -0.03 : 0.03) - 0.03;
    side.castShadow = true;
    g.add(side);
  }
  return g;
}

function loungers(): THREE.Group {
  const g = new THREE.Group();
  for (const x of [-1.1, 1.1]) {
    g.add(box(0.7, 0.32, 1.9, M.white, x, 0, 0.1));
    const back = box(0.7, 0.06, 0.8, M.white, x, 0, 0);
    back.position.set(x, 0.55, -0.8);
    back.rotation.x = -0.9;
    g.add(back);
    g.add(box(0.6, 0.05, 1.3, M.seatB, x, 0.32, 0.35));
  }
  // parasol
  g.add(cyl(0.04, 2.3, M.white, 0, 0, -0.4, 8));
  const cone = new THREE.Mesh(new THREE.ConeGeometry(1.5, 0.5, 8, 1, true), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, side: THREE.DoubleSide }));
  cone.position.set(0, 2.35, -0.4);
  cone.castShadow = true;
  g.add(cone);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 0.12, 8, 1, true), new THREE.MeshStandardMaterial({ color: 0x003865, side: THREE.DoubleSide }));
  band.position.set(0, 2.06, -0.4);
  g.add(band);
  return g;
}

function lifeguard(): THREE.Group {
  const g = new THREE.Group();
  for (const [x, z] of [[-0.55, -0.6], [0.55, -0.6], [-0.55, 0.6], [0.55, 0.6]]) {
    const leg = cyl(0.05, 2.2, M.white, x, 0, z, 8);
    g.add(leg);
  }
  for (let y = 0.4; y < 1.9; y += 0.4) g.add(box(1.2, 0.05, 0.08, M.white, 0, y, -0.6));
  g.add(box(1.3, 0.08, 1.3, M.red, 0, 2.2, 0));
  g.add(box(1.3, 0.6, 0.08, M.red, 0, 2.28, 0.62));
  g.add(cyl(0.03, 1.6, M.white, 0.6, 2.2, 0.6, 6));
  const shade = new THREE.Mesh(new THREE.ConeGeometry(1, 0.35, 6, 1, true), new THREE.MeshStandardMaterial({ color: 0xd8382b, side: THREE.DoubleSide }));
  shade.position.set(0.6, 3.9, 0.6);
  g.add(shade);
  return g;
}

function planter(): THREE.Group {
  const g = new THREE.Group();
  g.add(box(2.4, 0.5, 1, mat(0x9aa3ab, 0.8)));
  g.add(box(2.2, 0.06, 0.8, M.soil, 0, 0.48));
  for (const [x, s] of [[-0.7, 0.55], [0, 0.7], [0.7, 0.5]]) {
    const bush = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 1), x === 0 ? M.leaf : M.leaf2);
    bush.position.set(x, 0.55 + s * 0.7, 0);
    bush.castShadow = true;
    g.add(bush);
  }
  return g;
}

const cache = new Map<DecorType, THREE.Group>();
export function decorModel(type: DecorType): THREE.Group {
  if (!cache.has(type)) {
    const g = type === 'stands-3' ? stands(3, DECOR[type].L) : type === 'stands-5' ? stands(5, DECOR[type].L) : type === 'loungers' ? loungers() : type === 'lifeguard' ? lifeguard() : planter();
    cache.set(type, g);
  }
  return cache.get(type)!.clone();
}

/** Hauteur du sol autour du plan d'eau (plage dallée d'une piscine, sable d'un lac). */
export const groundY = (site: Site) => (site.kind === 'pool' ? 0.3 : 0.12);

/**
 * Aménagements par défaut d'une piscine : gradins face au bassin côté opposé à l'accès (−z),
 * transats côté accès (+z), chaise de surveillance et jardinières.
 */
export function defaultPoolDecor(site: Site, uid: () => string): DecorItem[] {
  const L = site.length,
    W = site.width;
  const out: DecorItem[] = [];
  const add = (type: DecorType, x: number, z: number, rot: number) => out.push({ uid: uid(), type, x, z, rot });
  // gradins : de l'autre côté du bassin, tournés vers l'eau (+z)
  const big = L >= 40;
  const st: DecorType = big ? 'stands-5' : 'stands-3';
  const sw = DECOR[st].L;
  const n = Math.max(1, Math.min(3, Math.floor((L - 4) / (sw + 2))));
  for (let i = 0; i < n; i++) add(st, (i - (n - 1) / 2) * (sw + 2), -W / 2 - 1.2 - DECOR[st].W / 2, Math.PI);
  // transats côté plage d'accès
  const m = Math.max(2, Math.floor(L / 9));
  for (let i = 0; i < m; i++) add('loungers', -L / 2 + (L / m) * (i + 0.5), W / 2 + 4.2, 0);
  add('lifeguard', L / 2 + 2, W / 2 - 2, -Math.PI / 2);
  add('planter', -L / 2 - 3, -W / 2 + 1, Math.PI / 2);
  add('planter', -L / 2 - 3, W / 2 - 1, Math.PI / 2);
  return out;
}
