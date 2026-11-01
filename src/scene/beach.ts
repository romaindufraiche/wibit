import * as THREE from 'three';
import { pointInPolygon, siteOutline } from '../core/region';
import type { Placed, Site, Vec2 } from '../core/types';
import { mainEntry, snapToShore } from '../editor/flag';

/*
 * Ambiance de plage pour la cinématique (lacs et sites réels, pas la piscine) : petit ponton en bois
 * jusqu'au début de l'eau devant l'accès du parc, caisse, file d'attente, vendeur de glaces, palmiers.
 * Repère local : u = vers la terre, v = le long du rivage, origine sur la berge face à l'accès.
 */

const SAND_Y = 0.12;
const mat = (color: number, rough = 0.7, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) => new THREE.MeshStandardMaterial({ color, roughness: rough, ...extra });
const M = {
  wood: mat(0xa8784c, 0.85),
  woodDark: mat(0x7a5434, 0.9),
  white: mat(0xf6f4ef, 0.6),
  navy: mat(0x003865, 0.5),
  lime: mat(0xc8d400, 0.55),
  rope: mat(0x0b5fa5, 0.5),
  chrome: mat(0xd5dbe0, 0.25, { metalness: 0.8 }),
  trunk: mat(0x8a6a48, 0.95),
  frond: mat(0x3f8a3a, 0.9, { side: THREE.DoubleSide }),
  frond2: mat(0x58a046, 0.9, { side: THREE.DoubleSide }),
  pink: mat(0xf28ab2, 0.6),
  glass: mat(0x9fd0e6, 0.15, { metalness: 0.2 }),
};
const SKIN = [0xf1c7a5, 0xd9a47f, 0xa86f4c, 0x6e4630];
const SUIT = [0xe63946, 0x1d4ed8, 0x16a34a, 0xf59e0b, 0x9333ea, 0x0ea5e9, 0xec4899, 0x111827];

function box(g: THREE.Object3D, w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number) {
  const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  o.position.set(x, y + h / 2, z);
  o.castShadow = o.receiveShadow = true;
  g.add(o);
  return o;
}
function cyl(g: THREE.Object3D, r: number, h: number, m: THREE.Material, x: number, y: number, z: number, seg = 8) {
  const o = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), m);
  o.position.set(x, y + h / 2, z);
  o.castShadow = true;
  g.add(o);
  return o;
}

/** Panneau texte (caisse, glaces). */
function sign(text: string, bg: string, fg: string, w: number, h: number): THREE.Mesh {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = Math.round((256 * h) / w);
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = fg;
  ctx.font = `800 ${Math.round(c.height * 0.62)}px Karla, Inter, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, c.width / 2, c.height / 2 + 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, side: THREE.DoubleSide }));
}

/** Personnage immobile (file d'attente, vendeur). */
function person(rnd: () => number): THREE.Group {
  const g = new THREE.Group();
  const skin = mat(SKIN[Math.floor(rnd() * SKIN.length)], 0.8);
  const suit = mat(SUIT[Math.floor(rnd() * SUIT.length)], 0.6);
  const h = 0.8 + rnd() * 0.35;
  const legs = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, h * 0.45, 3, 8), skin);
  legs.position.y = h * 0.35;
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, h * 0.4, 3, 8), suit);
  body.position.y = h * 0.85;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), skin);
  head.position.y = h * 1.25;
  for (const m of [legs, body, head]) m.castShadow = true;
  g.add(legs, body, head);
  return g;
}

function palm(rnd: () => number): THREE.Group {
  const g = new THREE.Group();
  const h = 5 + rnd() * 3;
  const lean = (rnd() - 0.5) * 0.5;
  const segs = 6;
  let x = 0,
    y = 0;
  for (let i = 0; i < segs; i++) {
    const r = 0.22 - i * 0.02;
    const seg = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.9, r, h / segs + 0.05, 7), M.trunk);
    const bend = lean * (i / segs) * 1.6;
    seg.position.set(x, y + h / segs / 2, 0);
    seg.rotation.z = -bend;
    seg.castShadow = true;
    g.add(seg);
    x += Math.sin(bend) * (h / segs);
    y += Math.cos(bend) * (h / segs);
  }
  // palmes : bandes courbées disposées en étoile
  const n = 8;
  for (let k = 0; k < n; k++) {
    const len = 2.4 + rnd() * 0.8;
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.quadraticCurveTo(len * 0.5, 0.45, len, 0);
    shape.quadraticCurveTo(len * 0.5, -0.45, 0, 0);
    const geo = new THREE.ShapeGeometry(shape, 8);
    // courbure vers le bas
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const px = pos.getX(i);
      pos.setZ(i, -(px * px) * 0.16);
    }
    geo.computeVertexNormals();
    const f = new THREE.Mesh(geo, k % 2 ? M.frond : M.frond2);
    f.rotation.x = -Math.PI / 2;
    const holder = new THREE.Group();
    holder.add(f);
    holder.rotation.y = (k / n) * Math.PI * 2 + rnd() * 0.3;
    holder.rotation.z = 0.15;
    holder.position.set(x, y, 0);
    f.castShadow = true;
    g.add(holder);
  }
  for (let k = 0; k < 3; k++) {
    const coco = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), M.woodDark);
    coco.position.set(x + Math.cos(k * 2.1) * 0.22, y - 0.2, Math.sin(k * 2.1) * 0.22);
    g.add(coco);
  }
  return g;
}

function kiosk(): THREE.Group {
  const g = new THREE.Group();
  box(g, 3, 2.4, 2.6, M.white, 0, 0, 0);
  box(g, 2.2, 0.9, 0.06, M.glass, 0, 1.1, -1.31); // guichet (face à l'eau : −u)
  box(g, 2.4, 0.08, 0.5, M.navy, 0, 1.05, -1.5); // tablette
  box(g, 3.6, 0.22, 3.2, M.navy, 0, 2.4, -0.1); // toit
  box(g, 3.6, 0.06, 3.2, M.lime, 0, 2.62, -0.1);
  const s = sign('CAISSE', '#003865', '#c8d400', 2.2, 0.5);
  s.position.set(0, 2.15, -1.33);
  s.rotation.y = Math.PI;
  g.add(s);
  return g;
}

function iceCream(rnd: () => number): THREE.Group {
  const g = new THREE.Group();
  box(g, 1.8, 0.9, 0.9, M.white, 0, 0.35, 0);
  box(g, 1.8, 0.12, 0.9, M.pink, 0, 1.25, 0);
  for (const x of [-0.65, 0.65]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.12, 14), M.navy);
    w.rotation.x = Math.PI / 2;
    w.position.set(x, 0.3, -0.5);
    g.add(w);
  }
  // parasol rayé
  cyl(g, 0.03, 2.4, M.chrome, 0, 1.25, 0);
  const n = 10;
  for (let k = 0; k < n; k++) {
    const seg = new THREE.Mesh(new THREE.ConeGeometry(1.3, 0.45, 3, 1, true, (k / n) * Math.PI * 2, (Math.PI * 2) / n), k % 2 ? M.pink : M.white);
    (seg.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
    seg.position.y = 3.55;
    seg.castShadow = true;
    g.add(seg);
  }
  // cornets sur le chariot
  for (let k = 0; k < 4; k++) {
    const scoop = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), mat([0xfff1c1, 0xf28ab2, 0x8b5a3c, 0xa7f3d0][k], 0.6));
    scoop.position.set(-0.5 + k * 0.33, 1.42, -0.2);
    g.add(scoop);
  }
  const s = sign('GLACES', '#f28ab2', '#ffffff', 1.4, 0.36);
  s.position.set(0, 0.85, -0.47);
  s.rotation.y = Math.PI;
  g.add(s);
  const vendor = person(rnd);
  vendor.position.set(0, 0, 0.8);
  g.add(vendor);
  return g;
}

/** Petit ponton en bois de la plage jusqu'au début de l'eau, avec main courante. */
function pontoon(lenLand: number, lenWater: number): THREE.Group {
  const g = new THREE.Group();
  const L = lenLand + lenWater;
  const zc = (lenLand - lenWater) / 2; // u local : + vers la terre
  const planks = Math.round(L / 0.35);
  for (let i = 0; i < planks; i++) box(g, 2.2, 0.06, 0.3, i % 2 ? M.wood : M.woodDark, 0, 0.42, lenLand - i * 0.35 - 0.15);
  box(g, 0.12, 0.12, L, M.woodDark, -1.0, 0.3, zc);
  box(g, 0.12, 0.12, L, M.woodDark, 1.0, 0.3, zc);
  for (let z = lenLand; z >= -lenWater; z -= 1.8)
    for (const x of [-1.0, 1.0]) {
      cyl(g, 0.09, 1.6, M.woodDark, x, -1.1, z, 6);
      cyl(g, 0.04, 0.9, M.wood, x * 1.05, 0.48, z, 6);
    }
  box(g, 0.06, 0.06, L, M.wood, -1.05, 1.36, zc);
  box(g, 0.06, 0.06, L, M.wood, 1.05, 1.36, zc);
  return g;
}

/** File d'attente : poteaux chromés reliés par des sangles bleues, en deux allées, avec des baigneurs. */
function queue(rnd: () => number, len: number): THREE.Group {
  const g = new THREE.Group();
  const lanes = [-0.7, 0.7];
  for (const x of [...lanes.map((l) => l - 0.7), lanes[1] + 0.7]) {
    for (let z = 0; z <= len; z += 1.5) {
      cyl(g, 0.04, 0.95, M.chrome, x, 0, z, 8);
      if (z + 1.5 <= len) box(g, 0.03, 0.06, 1.5, M.rope, x, 0.85, z + 0.75);
    }
  }
  for (const x of lanes)
    for (let z = 0.6; z < len; z += 0.9 + rnd() * 0.5) {
      const p = person(rnd);
      p.position.set(x + (rnd() - 0.5) * 0.2, 0, z);
      p.rotation.y = Math.PI + (rnd() - 0.5) * 0.6;
      g.add(p);
    }
  return g;
}

/** Décor de plage + point de vue pour le plan « arrivée à la plage » de la cinématique. */
export function buildBeach(site: Site, modules: Placed[]): { group: THREE.Group; shore: Vec2; land: Vec2 } | null {
  if (site.kind === 'pool' || !modules.length) return null;
  const entry = mainEntry(site, modules);
  if (!entry) return null;
  const shore = snapToShore(site, site.start ?? entry);
  const u: Vec2 = { x: -shore.inward.x, z: -shore.inward.z }; // vers la terre
  const v: Vec2 = { x: -u.z, z: u.x }; // le long du rivage
  const P = siteOutline(site);
  let seed = 4242;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const root = new THREE.Group();
  const yaw = Math.atan2(u.x, u.z); // rotation qui envoie +z local sur u
  const at = (a: number, b: number) => ({ x: shore.x + u.x * a + v.x * b, z: shore.z + u.z * a + v.z * b });
  const place = (o: THREE.Object3D, a: number, b: number, extraYaw = 0, y = SAND_Y) => {
    const p = at(a, b);
    if (pointInPolygon(p, P)) return; // jamais dans l'eau
    o.position.set(p.x, y, p.z);
    o.rotation.y = yaw + extraYaw;
    root.add(o);
  };

  // ponton : 5 m sur la plage, 2 m au-dessus de l'eau, aligné sur l'accès
  const pon = pontoon(5, 2);
  pon.position.set(shore.x, SAND_Y, shore.z);
  pon.rotation.y = yaw;
  root.add(pon);
  // file d'attente entre la caisse et le ponton
  place(queue(rnd, 6), 6, 0);
  place(kiosk(), 14, 0);
  place(iceCream(rnd), 11, 9, -0.4);
  // palmiers le long de la plage, de part et d'autre
  for (const b of [-34, -26, -19, -12, 16, 22, 29, 37]) place(palm(rnd), 7 + rnd() * 7, b + (rnd() - 0.5) * 3, rnd() * 6);
  return { group: root, shore: { x: shore.x, z: shore.z }, land: u };
}
