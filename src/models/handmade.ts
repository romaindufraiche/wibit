import * as THREE from 'three';
import type { ModuleSpec } from '../core/types';
import { flatShape, profile, rbox, tube } from './builders';

/*
 * Modules modélisés à la main d'après leur rendu officiel (catalogue Wibit) : vraie géométrie
 * (volumes extrudés, tubes, arêtes nettes), dimensions de la fiche, symétries exactes, couleurs
 * officielles. Ils passent avant les reconstructions automatiques (GLB) et le rendu générique.
 *
 * Repère : x = longueur, z = largeur, y = hauteur ; ligne d'eau en y = 0, dessous de la base à −0,12 m.
 */

type G = THREE.Group;
const pvc = (color: number) => new THREE.MeshPhysicalMaterial({ color, roughness: 0.4, metalness: 0, clearcoat: 0.35, clearcoatRoughness: 0.35 });
let M: Record<'yellow' | 'green' | 'greenDark' | 'blue' | 'white' | 'red' | 'dark', THREE.Material> | null = null;
function mats() {
  M ??= { yellow: pvc(0xf4cc00), green: pvc(0x61ae2b), greenDark: pvc(0x3f8f1e), blue: pvc(0x2f6fc2), white: pvc(0xf4f4f0), red: pvc(0xd6262e), dark: pvc(0x2b2f33) };
  return M;
}
const Y0 = -0.12; // dessous de la base
const TOP = 0.18; // dessus de la base (30 cm d'épaisseur)

function put(g: G, o: THREE.Object3D, x = 0, y = 0, z = 0) {
  o.position.set(x, y, z);
  g.add(o);
  return o;
}

/** Profil (z, y) extrudé le long de x sur `len`, centré en x. */
function extrudeX(pts: [number, number][], len: number, m: THREE.Material, bevel = 0.05): THREE.Mesh {
  const shape = new THREE.Shape(pts.map(([z, y]) => new THREE.Vector2(-z, y)));
  const depth = Math.max(0.01, len - 2 * bevel);
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 3, curveSegments: 16 });
  geo.rotateY(Math.PI / 2);
  geo.translate(-depth / 2, 0, 0);
  return new THREE.Mesh(geo, m);
}

// ---------------------------------------------------------------- marquages (logo, flèche)

function canvasTex(w: number, h: number, draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
/** Main de grenouille Wibit (paume + 4 doigts à bouts ronds). */
function frog(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number, color: string) {
  ctx.fillStyle = ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.ellipse(cx, cy + s * 0.25, s * 0.2, s * 0.26, 0, 0, Math.PI * 2);
  ctx.fill();
  for (const a of [-62, -22, 18, 58]) {
    const r = (a * Math.PI) / 180;
    const tx = cx + Math.sin(r) * s * 0.55,
      ty = cy + s * 0.2 - Math.cos(r) * s * 0.6;
    ctx.lineWidth = s * 0.1;
    ctx.beginPath();
    ctx.moveTo(cx, cy + s * 0.2);
    ctx.lineTo(tx, ty);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(tx, ty, s * 0.095, 0, Math.PI * 2);
    ctx.fill();
  }
}
const logoTex = (color: string, frogColor: string) =>
  canvasTex(512, 256, (ctx) => {
    frog(ctx, 300, 70, 110, frogColor);
    ctx.fillStyle = color;
    ctx.font = '800 150px Karla, Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('wibit', 256, 235);
  });
const frogTex = (color: string) => canvasTex(256, 256, (ctx) => frog(ctx, 128, 110, 190, color));
const arrowTex = () =>
  canvasTex(128, 384, (ctx) => {
    ctx.fillStyle = '#f4f4f0';
    ctx.fillRect(48, 10, 32, 260);
    ctx.beginPath();
    ctx.moveTo(10, 250);
    ctx.lineTo(118, 250);
    ctx.lineTo(64, 374);
    ctx.fill();
  });
const textTex = (text: string, color: string) =>
  canvasTex(512, 96, (ctx) => {
    ctx.fillStyle = color;
    ctx.font = '800 64px Karla, Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(text, 256, 70);
  });

function decalMesh(tex: THREE.Texture, w: number, h: number) {
  const m = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, toneMapped: true });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m);
  mesh.userData.decal = true;
  return mesh;
}
/** Marquage sur une pente qui monte vers −x (angle theta) ; se lit depuis le bas de la pente. `theta` = 0 : à plat. */
function slopeDecal(g: G, tex: THREE.Texture, w: number, h: number, x: number, y: number, z: number, theta = 0) {
  const d = decalMesh(tex, w, h);
  d.geometry.rotateX(-Math.PI / 2);
  d.geometry.rotateY(Math.PI / 2);
  d.rotation.z = -theta;
  put(g, d, x, y, z);
}
/** Marquage sur une face verticale tournée vers +x (ry = π/2) ou +z (ry = 0). */
function wallDecal(g: G, tex: THREE.Texture, w: number, h: number, x: number, y: number, z: number, ry = Math.PI / 2) {
  const d = decalMesh(tex, w, h);
  d.rotation.y = ry;
  put(g, d, x, y, z);
}

// ---------------------------------------------------------------- éléments communs

/** Base Wibit : centre vert, plots bleus aux deux bouts (jonctions), chants jaunes en bout. */
function stdBase(g: G, L: number, W: number, pad = 0.55) {
  const m = mats();
  put(g, rbox(L - 2 * pad + 0.1, 0.3, W, m.green, 0.1), 0, Y0 + 0.15);
  for (const s of [-1, 1]) {
    put(g, rbox(pad, 0.3, W, m.blue, 0.12), (s * (L - pad)) / 2, Y0 + 0.15);
    put(g, rbox(0.1, 0.15, W - 0.4, m.yellow, 0.04), s * (L / 2 - 0.035), Y0 + 0.1);
  }
}

// ---------------------------------------------------------------- modules

/** Junction — 3 × 3 × 0,3 m : dalle carrée, angles échancrés, dessus vert, boudins bleus, chants jaunes. */
function junction(g: G) {
  const m = mats();
  const h = 1.5;
  // âme jaune, quatre boudins bleus le long des côtés (les angles restent échancrés), dessus vert
  put(g, rbox(2.86, 0.24, 2.86, m.yellow, 0.08), 0, Y0 + 0.12);
  for (const s of [-1, 1]) {
    put(g, rbox(2.5, 0.3, 0.52, m.blue, 0.13), 0, Y0 + 0.15, s * (h - 0.26));
    put(g, rbox(0.52, 0.3, 2.5, m.blue, 0.13), s * (h - 0.26), Y0 + 0.15, 0);
    put(g, rbox(1.9, 0.13, 0.06, m.yellow, 0.025), 0, Y0 + 0.085, s * (h - 0.012));
    put(g, rbox(0.06, 0.13, 1.9, m.yellow, 0.025), s * (h - 0.012), Y0 + 0.085, 0);
  }
  put(g, rbox(2.2, 0.03, 2.2, m.green, 0.012), 0, TOP + 0.003);
  slopeDecal(g, logoTex('#f4f4f0', '#2f6fc2'), 1.1, 0.55, 0, TOP + 0.022, 0);
}

/** BalanceBeam — 6 × 2 × 0,3 m : poutre verte étroite évasée vers deux plots bleus (petit et grand). */
function balanceBeam(g: G) {
  const m = mats();
  const small = { len: 0.95, w: 1.5 },
    big = { len: 1.6, w: 2 };
  const x0 = -3 + small.len - 0.1,
    x1 = 3 - big.len + 0.1;
  const half = (x: number) => {
    const sm = (t: number) => t * t * (3 - 2 * t);
    const a = 1 - sm(Math.min(1, (x - x0) / 0.9)); // évasement côté petit plot
    const b = 1 - sm(Math.min(1, (x1 - x) / 1.1));
    return 0.27 + a * (small.w / 2 - 0.3) + b * (big.w / 2 - 0.3);
  };
  const up: [number, number][] = [],
    down: [number, number][] = [];
  for (let i = 0; i <= 40; i++) {
    const x = x0 + ((x1 - x0) * i) / 40;
    up.push([x, half(x)]);
    down.unshift([x, -half(x)]);
  }
  put(g, flatShape([...up, ...down], 0.3, m.green, [], 0.08), 0, Y0);
  put(g, rbox(small.len, 0.3, small.w, m.blue, 0.12), -3 + small.len / 2, Y0 + 0.15);
  put(g, rbox(big.len, 0.3, big.w, m.blue, 0.12), 3 - big.len / 2, Y0 + 0.15);
  put(g, rbox(0.1, 0.15, small.w - 0.4, m.yellow, 0.04), -3 + 0.035, Y0 + 0.1);
  put(g, rbox(0.1, 0.15, big.w - 0.4, m.yellow, 0.04), 3 - 0.035, Y0 + 0.1);
}

/** Slide — 3 × 2 × 1,1 m : arche jaune (longue pente d'un côté, raide de l'autre), passage dessous. */
function slide(g: G) {
  const m = mats();
  stdBase(g, 3, 2);
  const arch: [number, number][] = [
    [1.0, TOP],
    [-0.35, 1.0],
    [-0.55, 1.08],
    [-0.75, 1.0],
    [-1.0, TOP],
    [-0.72, TOP],
    [-0.6, 0.72],
    [-0.5, 0.78],
    [-0.38, 0.7],
    [0.55, TOP],
  ];
  put(g, profile(arch, 1.7, m.yellow, 0.06));
  for (const s of [-1, 1]) put(g, profile(arch, 0.16, m.green, 0.06), 0, 0, s * 0.92);
  const theta = Math.atan2(1.0 - TOP, 1.35);
  slopeDecal(g, logoTex('#f4f4f0', '#2f6fc2'), 1.2, 0.6, 0.3, 0.66, 0, theta);
}

/** Cliff — 3 × 2 × 1,5 m : mur cannelé (6 boudins) le long du module, pente à grimper d'un côté, à-pic de l'autre. */
function cliff(g: G) {
  const m = mats();
  stdBase(g, 3, 2);
  const wall: [number, number][] = [
    [0.95, TOP - 0.05],
    [0.5, 0.52],
    [0.15, 0.98],
    [-0.1, 1.27],
    [-0.3, 1.45],
    [-0.5, 1.48],
    [-0.68, 1.38],
    [-0.8, 1.1],
    [-0.86, TOP - 0.05],
  ];
  const n = 6,
    len = 1.92;
  for (let i = 0; i < n; i++) {
    const x = -len / 2 + (len / n) * (i + 0.5);
    put(g, extrudeX(wall, len / n + 0.02, m.green, 0.06), x);
    // poignée blanche en haut de chaque cannelure
    const hd = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.018, 6, 12, Math.PI), m.white);
    hd.rotation.set(-0.75, 0, Math.PI);
    put(g, hd, x, 1.36, -0.06);
  }
  // main de grenouille jaune sur la pente
  const d = decalMesh(frogTex('#f4cc00'), 0.7, 0.7);
  d.rotation.x = -0.67;
  put(g, d, -0.25, 0.95, 0.28);
}

/** ActionTower XL — 4,5 × 3,9 × 2 m : rampe d'escalade jaune, sommet vert, aile latérale en surplomb. */
function actionTowerXL(g: G) {
  const m = mats();
  const zr = -0.95; // axe de la rampe (2 m de large) ; l'aile est du côté +z
  put(g, profile([[1.6, TOP], [-0.75, 2.0], [-2.2, 2.0], [-2.25, Y0], [1.6, Y0]], 2.0, m.yellow, 0.07), 0, 0, zr);
  put(g, rbox(1.5, 0.05, 1.96, m.green, 0.02), -1.48, 2.0, zr);
  // flanc vert de la rampe, côté aile
  put(g, profile([[1.55, TOP + 0.02], [-0.75, 1.96], [-2.2, 1.96], [-2.2, TOP]], 0.05, m.greenDark, 0.01), 0, 0, 0.055);
  // plot bleu de jonction au pied de la rampe
  put(g, rbox(0.66, 0.3, 2.0, m.blue, 0.12), 1.92, Y0 + 0.15, zr);
  put(g, rbox(0.1, 0.15, 1.6, m.yellow, 0.04), 2.215, Y0 + 0.1, zr);
  // aile : corps vert, surplomb jaune arrondi, dessus jaune
  const wl = 2.15,
    wx = -2.25 + wl / 2;
  const wingTop = 1.72;
  // corps de l'aile : face avant verte inclinée (comme la rampe, plus raide), dessus jaune
  put(g, profile([[0.75, Y0], [-0.25, wingTop], [-2.25, wingTop], [-2.25, Y0]], 1.3, m.green, 0.07), 0, 0, 0.7);
  put(g, extrudeX([[1.28, Y0], [1.5, Y0], [1.56, 0.7], [1.95, 1.12], [1.95, wingTop - 0.14], [1.8, wingTop], [1.28, wingTop]], wl, m.yellow, 0.07), wx);
  put(g, rbox(2.0, 0.06, 1.85, m.yellow, 0.025), -1.25, wingTop - 0.015, 1.0);
  const wd = decalMesh(frogTex('#2f6fc2'), 0.75, 0.75);
  wd.geometry.rotateY(Math.PI / 2);
  wd.rotation.z = Math.atan2(1.0, wingTop - Y0) ;
  put(g, wd, 0.3, 0.85, 0.7);
  // prises blanches, corde à nœuds, logo
  const theta = Math.atan2(2.0 - TOP, 2.35);
  const on = (t: number, lift = 0.03): [number, number] => [1.6 - 2.35 * t - Math.sin(theta) * -lift, TOP + (2.0 - TOP) * t + Math.cos(theta) * lift];
  for (let i = 0; i < 5; i++) {
    const [x, y] = on(0.22 + i * 0.16, 0.05);
    const hold = rbox(0.1, 0.1, 0.28, m.white, 0.04);
    hold.rotation.z = theta;
    put(g, hold, x, y, zr - 0.55 + (i % 2) * 0.12);
  }
  const [rx0, ry0] = on(0.04, 0.035),
    [rx1, ry1] = on(0.98, 0.035);
  put(g, tube([[rx0, ry0, zr + 0.45], [rx1, ry1, zr + 0.45]], 0.02, m.dark));
  for (let i = 1; i < 5; i++) {
    const [x, y] = on(i / 5, 0.035);
    put(g, new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), m.blue), x, y, zr + 0.45);
  }
  slopeDecal(g, logoTex('#f4f4f0', '#2f6fc2'), 0.9, 0.45, -1.48, 2.06, zr);
}

/** GuardTower — 6 × 3 × 4 m : poste de surveillance en sablier, plateforme haute, toboggan vert, cadre bleu. */
function guardTower(g: G) {
  const m = mats();
  const cx = -1.5; // axe de la tour (moitié arrière du module)
  // cadre de base : boudins bleus sur les deux longs côtés et à l'arrière
  for (const s of [-1, 1]) put(g, tube([[-2.85, 0.03, s * 1.35], [1.6, 0.03, s * 1.35]], 0.15, m.blue));
  put(g, tube([[-2.85, 0.03, -1.35], [-2.85, 0.03, 1.35]], 0.15, m.blue));
  // toboggan vert : de la taille du sablier jusqu'au plot avant, s'élargissant vers le bas
  const top: [number, number] = [-0.95, 1.8],
    bot: [number, number] = [2.3, 0.16];
  const theta = Math.atan2(top[1] - bot[1], bot[0] - top[0]);
  const ls = Math.hypot(bot[0] - top[0], top[1] - bot[1]);
  const slab = flatShape([[0, -0.62], [ls * 0.75, -1.45], [ls, -1.45], [ls, 1.45], [ls * 0.75, 1.45], [0, 0.62]], 0.2, m.green, [], 0.06);
  slab.rotation.z = -theta;
  put(g, slab, top[0], top[1] - 0.2, 0);
  put(g, rbox(0.7, 0.3, 3.0, m.green, 0.12), 1.95, Y0 + 0.15);
  put(g, rbox(0.72, 0.3, 1.6, m.blue, 0.12), 2.64, Y0 + 0.15);
  put(g, rbox(0.1, 0.15, 1.2, m.yellow, 0.04), 2.965, Y0 + 0.1);
  const mid = 0.5;
  slopeDecal(g, arrowTex(), 0.3, 0.9, top[0] + (bot[0] - top[0]) * mid + 0.02, top[1] + (bot[1] - top[1]) * mid + 0.04, 0.3, theta);
  // sablier : 4 jambes basses (bleues à l'arrière, vertes à l'avant) vers la taille, 4 jambes jaunes vers la plateforme
  const waistY = 1.9,
    platY = 3.58;
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const wx = cx + sx * 0.5,
        wz = sz * 0.48;
      put(g, tube([[cx + sx * 1.3, 0.05, sz * 1.3], [wx, waistY, wz]], 0.16, sx < 0 ? m.blue : m.green));
      put(g, tube([[wx, waistY + 0.35, wz], [cx + sx * 1.22, platY, sz * 1.22]], 0.15, m.yellow));
    }
  // taille : bandeau jaune avec le logo, tourné vers le toboggan
  put(g, rbox(1.25, 0.6, 1.2, m.yellow, 0.1), cx, waistY + 0.18);
  wallDecal(g, logoTex('#f4f4f0', '#2f6fc2'), 0.9, 0.45, cx + 0.64, waistY + 0.2, 0);
  // plateforme : dessus jaune, pourtour en boudin vert, marquages rouges
  put(g, rbox(2.75, 0.3, 2.75, m.yellow, 0.1), cx, platY + 0.15);
  const rim: [number, number, number][] = [
    [cx - 1.38, platY + 0.1, -1.38],
    [cx + 1.38, platY + 0.1, -1.38],
    [cx + 1.38, platY + 0.1, 1.38],
    [cx - 1.38, platY + 0.1, 1.38],
  ];
  for (let i = 0; i < 4; i++) put(g, tube([rim[i], rim[(i + 1) % 4]], 0.13, m.green));
  slopeDecal(g, frogTex('#d6262e'), 0.8, 0.8, cx, platY + 0.31, 0);
  wallDecal(g, textTex('GUARD TOWER', '#d6262e'), 1.5, 0.28, cx + 1.52, platY + 0.1, 0);
  wallDecal(g, textTex('GUARD TOWER', '#d6262e'), 1.5, 0.28, cx, platY + 0.1, 1.52, 0);
}

/** Modules modélisés à la main, par identifiant du catalogue. */
export const HANDMADE: Record<string, (g: G, s: ModuleSpec) => void> = {
  junction,
  balancebeam: balanceBeam,
  slide,
  cliff,
  'actiontower-xl': actionTowerXL,
  guardtower: guardTower,
};
export const isHandmade = (id: string) => id in HANDMADE;
