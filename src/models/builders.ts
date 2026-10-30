import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { ModuleSpec } from '../core/types';

/*
 * Modèles 3D procéduraux des modules Wibit (MVP) : formes gonflables simplifiées construites
 * à partir des dimensions du catalogue. Ils seront remplacés par les fichiers 3D officiels
 * (glTF) une fois le partenariat signé : il suffira d'enregistrer un chargeur par id de module.
 *
 * Repère local : x = longueur L, z = largeur W, y = hauteur ; ligne d'eau en y = 0.
 */

function mat(color: number, opts: Partial<THREE.MeshStandardMaterialParameters> = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.42, metalness: 0.02, ...opts });
}

// Palette Wibit (jaune / bleu / blanc / gris)
export const MAT = {
  yellow: mat(0xffc20e),
  blue: mat(0x0b5fae),
  lightBlue: mat(0x37a2e6),
  white: mat(0xf2f4f7),
  grey: mat(0x6b7682),
  dark: mat(0x2a2f36, { roughness: 0.8 }),
  orange: mat(0xff7a1a),
  red: mat(0xe63b2e),
  net: mat(0x1d2228, { roughness: 0.9, transparent: true, opacity: 0.85, side: THREE.DoubleSide }),
  rope: mat(0xd8d2c0, { roughness: 0.9 }),
  ice: mat(0xdff1ff, { roughness: 0.25 }),
};
const HOLD_COLORS = [MAT.red, MAT.orange, MAT.lightBlue, MAT.white];

type G = THREE.Group;
const BASE_H = 0.3;
const BASE_Y = -0.12; // la base gonflable est en partie immergée

// ---------------------------------------------------------------- primitives

function add(g: G, mesh: THREE.Object3D, x = 0, y = 0, z = 0): THREE.Object3D {
  mesh.position.set(x, y, z);
  g.add(mesh);
  return mesh;
}

function rbox(w: number, h: number, d: number, m: THREE.Material, r = 0.12): THREE.Mesh {
  const rad = Math.max(0.01, Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001));
  return new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 3, rad), m);
}

function cyl(r: number, len: number, m: THREE.Material, axis: 'x' | 'y' | 'z' = 'y', seg = 20): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(r, Math.max(0.001, len - 2 * r), 6, seg), m);
  if (axis === 'x') mesh.rotation.z = Math.PI / 2;
  if (axis === 'z') mesh.rotation.x = Math.PI / 2;
  return mesh;
}

function rod(r: number, len: number, m: THREE.Material, axis: 'x' | 'y' | 'z' = 'y'): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 10), m);
  if (axis === 'x') mesh.rotation.z = Math.PI / 2;
  if (axis === 'z') mesh.rotation.x = Math.PI / 2;
  return mesh;
}

function tube(points: [number, number, number][], r: number, m: THREE.Material, closed = false): THREE.Mesh {
  const curve = new THREE.CatmullRomCurve3(
    points.map((p) => new THREE.Vector3(...p)),
    closed,
  );
  return new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(16, points.length * 10), r, 10, closed), m);
}

/** Profil 2D (x, y) extrudé sur la largeur w (axe z), centré en z. */
function profile(pts: [number, number][], w: number, m: THREE.Material, bevel = 0.08): THREE.Mesh {
  const shape = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
  const depth = Math.max(0.01, w - 2 * bevel);
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 3, curveSegments: 16 });
  geo.translate(0, 0, -depth / 2);
  return new THREE.Mesh(geo, m);
}

/** Forme dans le plan horizontal (x, z) extrudée vers le haut de h. */
function flatShape(pts: [number, number][], h: number, m: THREE.Material, holes: [number, number][][] = [], bevel = 0.06): THREE.Mesh {
  const shape = new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, -z)));
  for (const hole of holes) shape.holes.push(new THREE.Path(hole.map(([x, z]) => new THREE.Vector2(x, -z))));
  const geo = new THREE.ExtrudeGeometry(shape, { depth: Math.max(0.01, h - 2 * bevel), bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 2, curveSegments: 24 });
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, bevel, 0);
  return new THREE.Mesh(geo, m);
}

function bump(n: number, x0: number, x1: number, h: number, y0 = 0): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pts.push([x0 + (x1 - x0) * t, y0 + Math.sin(Math.PI * t) * h]);
  }
  return pts;
}

function base(g: G, L: number, W: number, m: THREE.Material = MAT.blue, grip = true) {
  add(g, rbox(L, BASE_H, W, m, 0.13), 0, BASE_Y + BASE_H / 2);
  if (grip && L > 0.8 && W > 0.8) add(g, rbox(L - 0.35, 0.03, W - 0.35, MAT.grey, 0.01), 0, BASE_Y + BASE_H + 0.005);
}

function handles(g: G, L: number, W: number, y: number) {
  const n = Math.max(1, Math.floor(L / 1.5));
  for (let i = 0; i < n; i++) {
    const x = -L / 2 + (L / n) * (i + 0.5);
    for (const s of [-1, 1]) {
      const h = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.025, 6, 12, Math.PI), MAT.dark);
      h.position.set(x, y, (s * W) / 2);
      g.add(h);
    }
  }
}

function holds(g: G, x0: number, x1: number, y0: number, y1: number, W: number, n = 8, seed = 1) {
  let s = seed;
  const r = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), HOLD_COLORS[i % HOLD_COLORS.length]);
    m.position.set(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t + 0.05, (r() - 0.5) * (W - 0.6));
    g.add(m);
  }
}

function pillar(g: G, x: number, z: number, h: number, r = 0.32, m: THREE.Material = MAT.yellow) {
  add(g, cyl(r, h, m), x, BASE_Y + h / 2 + 0.1, z);
}

function seat(g: G, x: number, y: number, z: number) {
  add(g, rbox(0.5, 0.08, 0.45, MAT.white, 0.03), x, y, z);
  add(g, rbox(0.08, 0.5, 0.45, MAT.white, 0.03), x - 0.25, y + 0.25, z);
}

function umbrella(g: G, x: number, y: number, z: number) {
  add(g, rod(0.03, 1.4, MAT.grey), x, y + 0.7, z);
  const c = new THREE.Mesh(new THREE.ConeGeometry(0.9, 0.35, 12), MAT.red);
  add(g, c, x, y + 1.5, z);
}

/** Secteur d'anneau (quart de cercle elliptique) centré sur le coin (−L/2, −W/2). */
function arc(L: number, W: number, w: number, h: number, m: THREE.Material, y = BASE_Y, a0 = 0, a1 = Math.PI / 2): THREE.Mesh {
  const cx = -L / 2,
    cz = -W / 2;
  const pts: [number, number][] = [];
  const N = 28;
  for (let i = 0; i <= N; i++) {
    const t = a0 + ((a1 - a0) * i) / N;
    pts.push([cx + L * Math.sin(t), cz + W * Math.cos(t)]);
  }
  for (let i = N; i >= 0; i--) {
    const t = a0 + ((a1 - a0) * i) / N;
    pts.push([cx + (L - w) * Math.sin(t), cz + (W - w) * Math.cos(t)]);
  }
  const mesh = flatShape(pts, h, m);
  mesh.position.y = y;
  return mesh;
}

function arcPoint(L: number, W: number, r: number, t: number): [number, number] {
  return [-L / 2 + (L - r) * Math.sin(t), -W / 2 + (W - r) * Math.cos(t)];
}

// ---------------------------------------------------------------- familles

type Builder = (g: G, s: ModuleSpec, p: Record<string, any>) => void;

const B: Record<string, Builder> = {
  flat(g, s, p) {
    const { L, W } = s;
    const v = p.variant;
    base(g, L, W, v === 'step' ? MAT.lightBlue : MAT.blue);
    const top = BASE_Y + BASE_H;
    if (v === 'junction' || v === 'tee' || v === 'y') {
      const corners = v === 'junction' ? 4 : 3;
      const pos: [number, number][] = [
        [-1, -1],
        [-1, 1],
        [1, -1],
        [1, 1],
      ];
      for (const [sx, sz] of pos.slice(0, corners === 4 ? 4 : 2).concat(corners === 3 ? [[1, 0]] : [])) {
        if (v === 'y' && sx === 1 && sz === 0) continue;
        add(g, cyl(0.28, 0.6, MAT.yellow), sx * (L / 2 - 0.35), top + 0.25, sz * (W / 2 - 0.35));
      }
      if (v === 'tee') add(g, rbox(0.5, 0.35, W - 1.2, MAT.yellow, 0.15), L / 2 - 0.35, top + 0.15, 0);
    } else if (v === 'sus') {
      // système de remontée : marche inclinée côté eau
      add(g, profile([[0, 0], [0.9, 0], [0.9, 0.15], [0, 0.45]], W - 0.4, MAT.yellow, 0.04), -0.45, top - 0.05, 0);
      handles(g, L, W, top + 0.15);
    } else if (v === 'step') {
      for (let i = 0; i < 3; i++) add(g, rbox(0.12, 0.04, W - 0.5, MAT.white, 0.01), -L / 2 + 0.4 + i * 0.5, top + 0.01, 0);
      handles(g, L, W, top + 0.15);
    } else if (v === 'takeoff') {
      add(g, rbox(0.35, 0.3, W - 0.2, MAT.yellow, 0.14), L / 2 - 0.2, top + 0.12, 0);
    } else if (v === 'sidekick') {
      add(g, cyl(0.3, 0.6, MAT.yellow), L / 2 - 0.4, top + 0.25, W / 2 - 0.4);
    } else {
      handles(g, L, W, top + 0.15);
    }
  },

  beam(g, s, p) {
    const { L, W, H } = s;
    const v = p.variant;
    if (v === 'plank') {
      for (const z of [-W / 2 + 0.35, W / 2 - 0.35]) add(g, cyl(0.35, L, MAT.blue, 'x'), 0, 0.1, z);
      add(g, rbox(L - 0.2, 0.35, W * 0.75, MAT.yellow, 0.15), 0, H - 0.18, 0);
      for (const x of [-L / 3, 0, L / 3]) add(g, rbox(0.4, H - 0.3, W * 0.6, MAT.blue, 0.15), x, (H - 0.3) / 2, 0);
      return;
    }
    if (v === 'wiggle') {
      const n = 5;
      for (let i = 0; i < n; i++) add(g, rbox(L / n - 0.15, BASE_H, W, i % 2 ? MAT.yellow : MAT.blue, 0.12), -L / 2 + (L / n) * (i + 0.5), BASE_Y + BASE_H / 2 + (i % 2) * 0.05, ((i % 2) - 0.5) * 0.2);
      return;
    }
    base(g, L, W, MAT.blue, false);
    const top = BASE_Y + BASE_H;
    if (v === 'bar') {
      add(g, cyl(0.28, L - 0.2, MAT.yellow, 'x'), 0, H - 0.28, 0);
      for (const x of [-L / 2 + 0.5, L / 2 - 0.5]) add(g, rbox(0.6, H - 0.3, 0.6, MAT.yellow, 0.2), x, top + (H - 0.3) / 2 - 0.1, 0);
    } else if (v === 'beam') {
      add(g, rbox(L - 0.2, 0.25, 0.55, MAT.yellow, 0.1), 0, top + 0.1, 0);
    } else if (v === 'board') {
      const b = rbox(L - 0.3, 0.2, W - 0.5, MAT.yellow, 0.08);
      b.rotation.x = 0.12;
      add(g, b, 0, H - 0.1, 0);
      add(g, cyl(0.3, L - 0.6, MAT.blue, 'x'), 0, top + 0.2, 0);
    }
  },

  log(g, s) {
    const { L, W, H } = s;
    base(g, 1.2, W, MAT.blue);
    const r = H / 2 + 0.1;
    add(g, cyl(r, L - 0.4, MAT.yellow, 'x'), 0, r - 0.15, 0);
    for (const x of [-L / 4, 0, L / 4]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(r + 0.01, 0.04, 6, 24), MAT.blue);
      ring.rotation.y = Math.PI / 2;
      add(g, ring, x, r - 0.15, 0);
    }
  },

  humps(g, s, p) {
    const { L, W, H } = s;
    const n: number = p.n;
    const style: string = p.style;
    base(g, L, W);
    const top = BASE_Y + BASE_H;
    const step = L / (n + (style === 'v' ? 0 : 0.5));
    if (style === 'zigzag') {
      for (let i = 0; i < n; i++) {
        const wall = rbox(0.5, H - 0.2, W * 0.95, i % 2 ? MAT.yellow : MAT.lightBlue, 0.2);
        wall.rotation.y = i % 2 ? 0.45 : -0.45;
        add(g, wall, -L / 2 + (L / n) * (i + 0.5), top + (H - 0.2) / 2 - 0.05, 0);
      }
      return;
    }
    if (style === 'v') {
      add(g, profile([[-L / 2 + 0.2, 0], [0, H + 0.25], [L / 2 - 0.2, 0]], W - 0.2, MAT.yellow), 0, top - 0.1, 0);
      return;
    }
    if (style === 'triple') {
      for (const z of [-W / 3, 0, W / 3]) for (let i = 0; i < n; i++) add(g, cyl(0.22, W / 3 - 0.15, i % 2 ? MAT.yellow : MAT.white, 'z'), -L / 2 + (L / n) * (i + 0.5), top + H * 0.45, z);
      return;
    }
    for (let i = 0; i < n; i++) {
      const x = -L / 2 + step * (i + 0.75);
      if (style === 'wedge') {
        add(g, profile([[-0.55, 0], [0.35, 0], [0.35, H], [0.05, H]], W - 0.3, i % 2 ? MAT.yellow : MAT.white), x, top - 0.05, 0);
      } else {
        const h = style === 'power' ? H * (0.55 + 0.45 * ((i % 3) / 2)) : style === 'low' ? Math.max(0.35, H + 0.15) : H;
        const r = Math.max(0.2, h * 0.45);
        add(g, cyl(r, W - 0.2, i % 2 ? MAT.yellow : MAT.white, 'z'), x, top + h - r - 0.05, 0);
      }
    }
  },

  ramp(g, s, p) {
    const { L, W, H } = s;
    const pr: string = p.profile;
    const y0 = BASE_Y;
    let pts: [number, number][] = [];
    if (pr === 'hill') pts = bump(16, -L / 2, L / 2, H + 0.12);
    else if (pr === 'slope')
      pts = [[-L / 2, 0], [-L / 2 + 0.15, H], [-L / 2 + 0.75, H], ...bump(12, -L / 2 + 0.75, L / 2 + (L - 0.75), H).slice(7).map(([x, y]) => [Math.min(x, L / 2), y] as [number, number]), [L / 2, 0]];
    else if (pr === 'cliff') pts = [[-L / 2, 0], [-L / 2 + 0.35, H], [-L / 2 + 1.1, H], [L / 2, 0]];
    else if (pr === 'peak') pts = [[-L / 2, 0], [-0.5, H], [0.5, H], [L / 2, 0]];
    else if (pr === 'quarter') {
      pts = [[-L / 2, 0]];
      for (let i = 0; i <= 12; i++) {
        const t = (i / 12) * (Math.PI / 2);
        pts.push([L / 2 - 0.6 - Math.cos(t) * (L - 1.2) * 0.5, H - Math.sin(Math.PI / 2 - t) * H]);
      }
      pts.push([L / 2, H], [L / 2, 0]);
    } else if (pr === 'ledge') {
      const n = 4;
      pts = [[-L / 2, 0]];
      for (let i = 0; i < n; i++) {
        const x = -L / 2 + (i * (L * 0.7)) / n;
        pts.push([x, (H * (i + 1)) / n], [x + (L * 0.7) / n, (H * (i + 1)) / n]);
      }
      pts.push([L / 2, 0]);
    } else if (pr === 'twin') pts = [[-L / 2, 0], [-0.4, H], [0.4, H], [L / 2, 0]];
    else if (pr === 'end') pts = [[-L / 2, 0], [L / 2 - 1.2, H], [L / 2, H], [L / 2, 0]];
    if (pr === 'twin') {
      for (const z of [-W / 4, W / 4]) add(g, profile(pts, W / 2 - 0.2, z < 0 ? MAT.yellow : MAT.lightBlue), 0, y0, z);
      holds(g, -L / 2 + 0.4, -0.6, 0.2, H, W, 10, 3);
    } else {
      add(g, profile(pts, W, pr === 'hill' ? MAT.lightBlue : MAT.yellow), 0, y0, 0);
    }
    if (pr === 'cliff' || pr === 'peak' || pr === 'slope') holds(g, -L / 2 + 0.1, -L / 2 + (pr === 'peak' ? L / 2 - 0.5 : 0.4), 0.15, H - 0.1, W, 7, L * 10);
    if (pr === 'ledge') holds(g, -L / 2, -L / 2 + L * 0.6, 0.3, H, W, 6, 5);
    // rebords latéraux
    if (pr !== 'twin') for (const z of [-W / 2 + 0.05, W / 2 - 0.05]) add(g, profile(pts.map(([x, y]) => [x, y * 0.5 + 0.1]), 0.18, MAT.blue, 0.05), 0, y0 + 0.02, z);
  },

  bars(g, s, p) {
    const { L, W, H } = s;
    const st: string = p.style;
    base(g, L, W);
    const top = BASE_Y + BASE_H;
    if (st === 'monkey' || st === 'hang') {
      for (const x of [-L / 2 + 0.4, L / 2 - 0.4]) for (const z of [-W / 2 + 0.4, W / 2 - 0.4]) pillar(g, x, z, H);
      for (const z of [-W / 2 + 0.4, W / 2 - 0.4]) add(g, cyl(0.25, L - 0.4, MAT.yellow, 'x'), 0, H - 0.1, z);
      const n = Math.floor((L - 1) / 0.6);
      for (let i = 0; i <= n; i++) {
        const x = -L / 2 + 0.5 + i * ((L - 1) / n);
        if (st === 'monkey') add(g, rod(0.04, W - 0.8, MAT.grey, 'z'), x, H - 0.2, 0);
        else {
          const ring = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.03, 6, 14), MAT.dark);
          add(g, rod(0.01, 0.6, MAT.rope), x, H - 0.45, ((i % 2) - 0.5) * (W / 2));
          add(g, ring, x, H - 0.85, ((i % 2) - 0.5) * (W / 2));
        }
      }
    } else if (st === 'high') {
      for (const x of [-L / 2 + 0.4, L / 2 - 0.4]) for (const z of [-W / 2 + 0.4, W / 2 - 0.4]) pillar(g, x, z, H, 0.28);
      add(g, rod(0.05, L - 0.6, MAT.grey, 'x'), 0, H * 0.65, -W / 2 + 0.4);
      add(g, rod(0.05, L - 0.6, MAT.grey, 'x'), 0, H - 0.15, W / 2 - 0.4);
      for (const z of [-W / 2 + 0.4, W / 2 - 0.4]) add(g, cyl(0.2, L, MAT.yellow, 'x'), 0, H, z);
    } else if (st === 'dip') {
      for (const z of [-0.45, 0.45]) {
        for (const x of [-L / 2 + 0.4, L / 2 - 0.4]) add(g, rbox(0.35, H - 0.3, 0.35, MAT.yellow, 0.15), x, top + (H - 0.3) / 2, z);
        add(g, rod(0.05, L - 0.6, MAT.grey, 'x'), 0, H, z);
      }
    } else if (st === 'swing') {
      const arch: [number, number, number][] = [];
      for (let i = 0; i <= 10; i++) {
        const t = (i / 10) * Math.PI;
        arch.push([-Math.cos(t) * (L / 2 - 0.5), top + Math.sin(t) * (H - top), 0]);
      }
      add(g, tube(arch, 0.32, MAT.yellow));
      add(g, rod(0.02, H * 0.55, MAT.rope), 0, H - H * 0.3, 0.6);
      add(g, rbox(0.6, 0.12, 0.3, MAT.orange, 0.05), 0, H - H * 0.58, 0.6);
    } else if (st === 'battle') {
      for (const x of [-L / 2 + 0.4, L / 2 - 0.4]) for (const z of [-W / 2 + 0.3, 0, W / 2 - 0.3]) pillar(g, x, z, H, 0.25);
      for (const z of [-W / 2 + 0.3, 0, W / 2 - 0.3]) add(g, cyl(0.22, L - 0.4, MAT.yellow, 'x'), 0, H, z);
      for (const x of [-L / 4, L / 4]) for (const z of [-W / 4, W / 4]) {
        add(g, rod(0.015, 1, MAT.rope), x, H - 0.55, z);
        add(g, cyl(0.25, 1.6, MAT.orange, 'z'), x, H - 1.2, z);
      }
    } else if (st === 'spin') {
      const cone = new THREE.Mesh(new THREE.CylinderGeometry(0.6, Math.min(L, W) / 2 - 0.2, 1.3, 20), MAT.lightBlue);
      add(g, cone, 0, top + 0.6, 0);
      add(g, cyl(0.35, H - 1, MAT.yellow), 0, top + 1.2 + (H - 1.5) / 2, 0);
      for (let i = 0; i < 4; i++) {
        const arm = cyl(0.12, Math.min(L, W) * 0.8, MAT.white, 'x');
        arm.rotation.y = (i * Math.PI) / 4;
        add(g, arm, 0, H - 0.3, 0);
      }
    } else if (st === 'level') {
      for (const x of [-L / 2 + 0.9, L / 2 - 0.9]) add(g, rbox(1.6, H, W, MAT.yellow, 0.3), x, BASE_Y + H / 2, 0);
      add(g, rbox(L - 3, 0.45, W * 0.7, MAT.blue, 0.2), 0, H - 0.3, 0);
      for (const z of [-W * 0.35, W * 0.35]) add(g, cyl(0.12, L - 3, MAT.white, 'x'), 0, H + 0.2, z);
      g.children.splice(0, 2); // pas de base sous le passage (les bateaux passent dessous)
    }
  },

  tower(g, s, p) {
    const { L, W, H } = s;
    const levels: number = p.levels ?? 2;
    base(g, L, W);
    let y = BASE_Y + BASE_H;
    const hStep = (H - y) / levels;
    for (let i = 0; i < levels; i++) {
      const k = 1 - i * 0.22;
      const w = (p.slide === 'z' ? W * 0.55 : W - 0.4) * k;
      add(g, rbox((L - 0.4) * k * (p.slide === 'z' ? 0.9 : 1), hStep, w, i % 2 ? MAT.yellow : MAT.lightBlue, 0.2), 0, y + hStep / 2, p.slide === 'z' ? -W * 0.18 : 0);
      y += hStep;
    }
    if (p.slide === 'z') {
      const sl = profile([[0, 0], [W * 0.5, 0], [W * 0.05, H - 0.4], [0, H - 0.4]], L * 0.45, MAT.yellow);
      sl.rotation.y = -Math.PI / 2;
      add(g, sl, L * 0.1, BASE_Y, W * 0.02);
    }
    holds(g, -L / 2 + 0.3, -L / 2 + 0.3, 0.3, H, W * 0.6, 8, levels);
    if (p.top === 'guard') {
      seat(g, 0, H + 0.05, 0);
      umbrella(g, 0.3, H, 0.4);
    } else {
      add(g, rod(0.03, 1.2, MAT.grey), -L * 0.15, H + 0.6, -W * 0.18);
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.35), MAT.orange);
      (flag.material as THREE.Material).side = THREE.DoubleSide;
      add(g, flag, -L * 0.15 + 0.3, H + 1.0, -W * 0.18);
    }
  },

  turn(g, s, p) {
    const { L, W, H } = s;
    const w = s.ports[0]?.w ?? 2;
    const v: string = p.variant;
    add(g, arc(L, W, w, BASE_H, MAT.blue));
    if (v === 'flat') {
      add(g, arc(L, W, 0.35, 0.25, MAT.yellow, BASE_Y + BASE_H - 0.05));
      return;
    }
    if (v === 'curve' || v === 'double') {
      // piste inclinée : bord extérieur relevé
      add(g, arc(L, W, w * 0.4, H, MAT.yellow, BASE_Y + 0.1));
      if (v === 'double') add(g, arc(L - w / 2 + 0.1, W - w / 2 + 0.1, 0.2, 0.5, MAT.white, BASE_Y + 0.25));
      return;
    }
    if (v === 'level') {
      add(g, arc(L, W, w, H * 0.6, MAT.yellow, BASE_Y + 0.15));
      add(g, arc(L, W, 0.3, H, MAT.lightBlue, BASE_Y + 0.15));
      return;
    }
    // swing / parcour : arceau au-dessus du virage
    const pts: [number, number, number][] = [];
    for (let i = 0; i <= 10; i++) {
      const t = (i / 10) * (Math.PI / 2);
      const [x, z] = arcPoint(L, W, w / 2, t);
      pts.push([x, BASE_Y + BASE_H + Math.sin((i / 10) * Math.PI) * (H - 0.5), z]);
    }
    add(g, tube(pts, v === 'parcour' ? 0.22 : 0.3, MAT.yellow));
    const [mx, mz] = arcPoint(L, W, w / 2, Math.PI / 4);
    if (v === 'swing') {
      add(g, rod(0.02, H * 0.5, MAT.rope), mx, H * 0.7, mz);
      add(g, rbox(0.5, 0.1, 0.3, MAT.orange, 0.04), mx, H * 0.45, mz);
    } else {
      for (const t of [0.2, 0.5, 0.8]) {
        const [x, z] = arcPoint(L, W, w / 2, (t * Math.PI) / 2);
        add(g, rbox(0.5, 0.6, 0.5, MAT.lightBlue, 0.2), x, BASE_Y + BASE_H + 0.3, z);
      }
    }
  },

  roundabout(g, s) {
    const R = Math.min(s.L, s.W) / 2;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(R - 0.9, 0.55, 12, 40), MAT.yellow);
    ring.rotation.x = Math.PI / 2;
    ring.scale.z = 0.9;
    add(g, ring, 0, s.H * 0.45, 0);
    add(g, new THREE.Mesh(new THREE.CylinderGeometry(R - 1.6, R - 1.4, 0.4, 32), MAT.white), 0, 0.05, 0);
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2;
      add(g, rbox(1.2, BASE_H, 2, MAT.blue, 0.12), Math.cos(a) * (R - 0.6), BASE_Y + BASE_H / 2, Math.sin(a) * (R - 0.6)).rotation.y = -a;
    }
  },

  target(g, s) {
    const R = Math.min(s.L, s.W) / 2;
    const cols = [MAT.blue, MAT.white, MAT.red, MAT.white, MAT.yellow];
    cols.forEach((m, i) => add(g, new THREE.Mesh(new THREE.CylinderGeometry(R - i * 0.5, R - i * 0.5, 0.3 + i * 0.02, 40), m), 0, BASE_Y + 0.15 + i * 0.01, 0));
    for (const x of [-s.L / 2 + 0.5, s.L / 2 - 0.5]) add(g, rbox(1, BASE_H, 2, MAT.blue), x, BASE_Y + BASE_H / 2, 0);
  },

  tramp(g, s, p) {
    const { L, W } = s;
    const r = 0.4;
    const pts: [number, number, number][] = [
      [-L / 2 + r, 0.2, -W / 2 + r],
      [L / 2 - r, 0.2, -W / 2 + r],
      [L / 2 - r, 0.2, W / 2 - r],
      [-L / 2 + r, 0.2, W / 2 - r],
    ];
    add(g, tube(pts, r, p.springs ? MAT.blue : MAT.yellow, true));
    const net = new THREE.Mesh(new THREE.PlaneGeometry(L - 2 * r - 0.5, W - 2 * r - 0.5), MAT.dark);
    net.rotation.x = -Math.PI / 2;
    add(g, net, 0, 0.45, 0);
    if (p.springs) {
      for (let i = 0; i < 24; i++) {
        const t = i / 24;
        const side = Math.floor(t * 4);
        const u = (t * 4) % 1;
        const x = side % 2 === 0 ? -L / 2 + 0.8 + u * (L - 1.6) : side === 1 ? L / 2 - 0.8 : -L / 2 + 0.8;
        const z = side % 2 === 1 ? -W / 2 + 0.8 + u * (W - 1.6) : side === 0 ? -W / 2 + 0.8 : W / 2 - 0.8;
        add(g, rod(0.03, 0.4, MAT.grey, side % 2 ? 'x' : 'z'), x, 0.45, z);
      }
    } else {
      add(g, rbox(L * 0.4, BASE_H, 2, MAT.blue), -L / 2 + L * 0.2, BASE_Y + BASE_H / 2, 0).position.y = BASE_Y;
    }
  },

  dome(g, s) {
    base(g, s.L, s.W);
    const d = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), MAT.yellow);
    d.scale.set(s.L * 0.42, s.H, s.W * 0.45);
    add(g, d, 0, BASE_Y + BASE_H - 0.05, 0);
  },

  matchball(g, s, p) {
    const { L, W, H } = s;
    if (p.arena) {
      const pts: [number, number, number][] = [
        [-L / 2 + 0.4, 0.3, -W / 2 + 0.4],
        [L / 2 - 0.4, 0.3, -W / 2 + 0.4],
        [L / 2 - 0.4, 0.3, W / 2 - 0.4],
        [-L / 2 + 0.4, 0.3, W / 2 - 0.4],
      ];
      add(g, tube(pts, 0.4, MAT.blue, true));
    } else base(g, L, W);
    for (const x of [-L / 2 + 0.5, L / 2 - 0.5]) pillar(g, x, 0, H, 0.35);
    add(g, cyl(0.3, L - 0.6, MAT.yellow, 'x'), 0, H - 0.1, 0);
    add(g, rod(0.015, 1.1, MAT.rope), 0, H - 0.7, 0);
    add(g, new THREE.Mesh(new THREE.SphereGeometry(0.55, 24, 16), MAT.orange), 0, H - 1.55, 0);
  },

  wave(g, s) {
    const { L, W, H } = s;
    const pts: [number, number][] = [[-L / 2, 0], [-L / 2, H]];
    for (let i = 0; i <= 30; i++) {
      const t = i / 30;
      const x = -L / 2 + 1.5 + t * (L - 1.5);
      const y = H * (1 - t) ** 1.6 + Math.sin(t * Math.PI * 2.2) * 0.5 * (1 - t);
      pts.push([x, Math.max(0.15, y)]);
    }
    pts.push([L / 2, 0]);
    add(g, profile(pts, W * 0.8, MAT.lightBlue, 0.15), 0, BASE_Y, 0);
    for (const z of [-W / 2 + 0.5, W / 2 - 0.5]) add(g, profile(pts.map(([x, y]) => [x, y + 0.4]), 0.8, MAT.yellow, 0.2), 0, BASE_Y, z);
    add(g, rbox(2, 0.4, W * 0.8, MAT.yellow), -L / 2 + 1, H + 0.1, 0);
    holds(g, -L / 2 - 0.05, -L / 2 - 0.05, 0.3, H, W * 0.5, 10, 9);
  },

  mountain(g, s) {
    const { L, W, H } = s;
    const hill = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2), MAT.yellow);
    hill.scale.set(L * 0.42, H, W * 0.48);
    add(g, hill, -L * 0.05, BASE_Y, 0);
    for (const z of [-W / 4, 0, W / 4]) {
      const lane = profile([[0, 0], [L * 0.45, 0], [0, H * 0.9]], 1.6, z === 0 ? MAT.lightBlue : MAT.blue, 0.1);
      add(g, lane, 0.2, BASE_Y, z);
    }
    for (const z of [-2.5, 2.5]) add(g, rbox(2, BASE_H, 3, MAT.blue), -L / 2 + 1, BASE_Y + BASE_H / 2, z);
    holds(g, -L / 2 + 1.5, -L * 0.15, 0.4, H, W * 0.6, 14, 4);
  },

  actionloop(g, s) {
    const { L, W, H } = s;
    base(g, L * 0.4, W, MAT.blue);
    add(g, profile([[-L / 2, 0], [-L / 2, H], [-L / 2 + 1.5, H], [0.5, 0.2], [0.5, 0]], W * 0.6, MAT.yellow), 0, BASE_Y, 0);
    const loop = new THREE.Mesh(new THREE.TorusGeometry(1.4, 0.45, 12, 32, Math.PI * 1.3), MAT.lightBlue);
    loop.rotation.z = -Math.PI * 0.15;
    add(g, loop, L / 2 - 2, 1.0, 0);
  },

  springboard(g, s) {
    const { L, W, H } = s;
    base(g, L, W);
    const half = new THREE.Mesh(new THREE.CylinderGeometry(W / 2 - 0.4, W / 2 - 0.3, 0.6, 24, 1, false, 0, Math.PI), MAT.lightBlue);
    half.rotation.y = -Math.PI / 2;
    add(g, half, -L / 2 + 0.3, 0.3, 0);
    add(g, rbox(2.2, H - 0.6, 2.4, MAT.yellow, 0.3), -L / 2 + 1.4, (H - 0.6) / 2 + 0.2, 0);
    const board = rbox(2.6, 0.25, 1.2, MAT.white, 0.1);
    board.rotation.z = -0.12;
    add(g, board, -L / 2 + 3.6, H - 0.1, 0);
  },

  bridge(g, s) {
    const { L, W, H } = s;
    for (const x of [-L / 2 + 0.5, L / 2 - 0.5]) add(g, rbox(1, BASE_H, W, MAT.blue), x, BASE_Y + BASE_H / 2, 0);
    // arche : extrados puis intrados (parcouru en sens inverse)
    const outer = bump(14, -L / 2 + 0.3, L / 2 - 0.3, H, 0.1);
    const inner = bump(10, L / 2 - 0.9, -L / 2 + 0.9, H - 0.45, 0);
    const pts: [number, number][] = [...outer, [L / 2 - 0.3, 0], ...inner, [-L / 2 + 0.3, 0]];
    add(g, profile(pts, W - 0.4, MAT.yellow), 0, BASE_Y, 0);
  },

  deck(g, s) {
    const { L, W, H } = s;
    base(g, L, W);
    add(g, rbox(L * 0.6, H - 0.3, W - 0.3, MAT.yellow, 0.2), L * 0.15, (H - 0.3) / 2 + 0.1, 0);
    add(g, rbox(L * 0.25, (H - 0.3) / 2, W - 0.5, MAT.lightBlue, 0.15), -L * 0.3, (H - 0.3) / 4 + 0.1, 0);
    seat(g, L * 0.15, H + 0.05, 0);
  },

  gapjump(g, s) {
    const { L, W, H } = s;
    base(g, L, W);
    for (const z of [-W / 4, W / 4])
      for (let i = 0; i < 4; i++) add(g, rbox(0.8, H - 0.3 - (i % 2) * 0.4, W / 2 - 0.5, i % 2 ? MAT.lightBlue : MAT.yellow, 0.25), -L / 2 + 0.8 + i * ((L - 1.6) / 3), (H - 0.3) / 2, z);
  },

  targetjump(g, s) {
    const { L, W, H } = s;
    base(g, L, W);
    add(g, rbox(1.2, H - 0.3, W - 0.4, MAT.yellow, 0.25), 0, (H - 0.3) / 2 + 0.05, 0);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.15, 8, 24), MAT.red);
    ring.rotation.x = Math.PI / 2;
    add(g, ring, 0, 0.08, W / 2 + 2.4);
  },

  launchgate(g, s, p) {
    const { L, W, H } = s;
    base(g, L, W, MAT.lightBlue);
    for (const z of [-W / 2 + 0.4, W / 2 - 0.4]) pillar(g, 0, z, H, 0.4, MAT.yellow);
    if (!p.wide) pillar(g, 0, 0, H * 0.8, 0.25, MAT.white);
    add(g, cyl(0.35, W - 0.4, MAT.yellow, 'z'), 0, H, 0);
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(W * 0.6, 0.45), MAT.white);
    banner.rotation.y = Math.PI / 2;
    add(g, banner, -0.38, H - 0.55, 0);
    add(g, profile([[0, 0], [0.9, 0], [0.9, 0.15], [0, 0.45]], W - 0.6, MAT.yellow, 0.04), -L / 2, BASE_Y + BASE_H - 0.05, 0);
  },

  watch(g, s, p) {
    const { L, W, H } = s;
    const st: string = p.style;
    if (st === 'raft') {
      base(g, L, W, MAT.lightBlue);
      add(g, rbox(1.2, H - 0.8, 1.2, MAT.yellow, 0.3), 0, (H - 0.8) / 2, 0);
      seat(g, 0, H - 0.75, 0);
      umbrella(g, 0.3, H - 0.8, 0.3);
      return;
    }
    base(g, L, W, MAT.blue);
    const colH = H - 0.9;
    add(g, rbox(Math.min(1.4, L * 0.5), colH, Math.min(1.4, W * 0.5), MAT.yellow, 0.3), st === 'spot' ? L * 0.15 : 0, colH / 2, 0);
    if (st === 'spot') for (let i = 0; i < 3; i++) add(g, rbox(0.5, (colH * (i + 1)) / 4, 1.2, MAT.lightBlue, 0.15), -L * 0.15 - i * 0.55 + 0.4, (colH * (i + 1)) / 8, 0);
    seat(g, st === 'spot' ? L * 0.15 : 0, colH + 0.05, 0);
    umbrella(g, (st === 'spot' ? L * 0.15 : 0) + 0.3, colH, 0.3);
  },

  roller(g, s) {
    const { L, W, H } = s;
    base(g, L, W);
    for (let i = 0; i < 3; i++) {
      const x = -L / 2 + 1.5 + i * ((L - 3) / 2);
      const h = H * (0.6 + 0.2 * i);
      for (const z of [-W / 2 + 0.3, W / 2 - 0.3]) add(g, rbox(0.5, h, 0.4, MAT.yellow, 0.18), x, h / 2 - 0.05, z);
      add(g, cyl(0.45, W - 0.8, MAT.lightBlue, 'z'), x, h - 0.1, 0);
    }
  },

  flip(g, s, p) {
    const { L, W, H } = s;
    if (!p.rocker) base(g, L, W);
    add(g, profile([[-0.6, 0], [0.6, 0], [0, H * 0.55]], W - 0.4, MAT.blue), 0, 0, 0);
    const board = rbox(L - 0.3, 0.3, W - 0.3, MAT.yellow, 0.14);
    board.rotation.z = 0.14;
    add(g, board, 0, H * 0.6, 0);
    if (p.rocker) for (const x of [-L / 2 + 0.5, L / 2 - 0.5]) add(g, cyl(0.12, W - 0.4, MAT.white, 'z'), x, H * 0.6 + 0.45 + (x > 0 ? 0.25 : -0.2), 0);
  },

  multiclimb(g, s) {
    const { L, W, H } = s;
    const pyr = new THREE.Mesh(new THREE.CylinderGeometry(0.6, Math.min(L, W) / 2, H, 3), MAT.yellow);
    pyr.scale.set(L / Math.min(L, W), 1, W / Math.min(L, W));
    add(g, pyr, 0, BASE_Y + H / 2, 0);
    holds(g, -L / 2 + 0.8, 0, 0.3, H, W * 0.6, 12, 6);
    holds(g, L / 4, 0.3, 0.3, H, W * 0.3, 6, 8);
  },

  icetower(g, s) {
    const { L, W, H } = s;
    base(g, L, W, MAT.lightBlue);
    const peak = new THREE.Mesh(new THREE.ConeGeometry(Math.min(L, W) * 0.42, H, 6), MAT.ice);
    add(g, peak, -L * 0.12, BASE_Y + H / 2, 0);
    add(g, profile([[0, 0], [L * 0.5, 0], [0, H * 0.8]], W * 0.4, MAT.lightBlue, 0.1), 0, BASE_Y, 0);
    holds(g, -L / 2 + 0.6, -L * 0.15, 0.3, H, W * 0.5, 10, 7);
  },

  hand(g, s) {
    const { L, W } = s;
    add(g, new THREE.Mesh(new THREE.CylinderGeometry(L * 0.28, L * 0.3, 0.3, 24), MAT.yellow), -L * 0.12, 0, 0);
    for (let i = 0; i < 5; i++) {
      const a = -0.9 + i * 0.42;
      const f = cyl(0.25, i === 0 ? 1.0 : 1.4, MAT.yellow, 'x');
      f.rotation.y = -a;
      add(g, f, -L * 0.12 + Math.cos(a) * L * 0.42, 0, Math.sin(a) * W * 0.4);
    }
  },

  goal(g, s) {
    const { L, W, H } = s;
    add(g, tube([[-L / 2, 0.1, 0], [-L / 2, H, 0], [L / 2, H, 0], [L / 2, 0.1, 0]], 0.18, MAT.yellow));
    add(g, cyl(0.2, L, MAT.blue, 'x'), 0, 0.05, -W / 2);
    const net = new THREE.Mesh(new THREE.PlaneGeometry(L - 0.2, H), MAT.net);
    add(g, net, 0, H / 2, -W / 2 + 0.15);
  },

  score(g, s) {
    const { L, W, H } = s;
    base(g, L, W);
    const board = rbox(L - 0.2, H, 0.4, MAT.yellow, 0.15);
    add(g, board, 0, H / 2, 0);
    for (const x of [-0.8, 0, 0.8]) {
      const r = new THREE.Mesh(new THREE.TorusGeometry(0.25, 0.06, 8, 20), MAT.red);
      add(g, r, x, H * 0.6, 0.22);
    }
  },

  rodeo(g, s) {
    const { L, W, H } = s;
    const d = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), MAT.yellow);
    d.scale.set(L / 2, H, W / 2);
    add(g, d, 0, BASE_Y, 0);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const lane = profile([[0, 0], [L * 0.32, 0], [0, H * 0.85]], 0.6, MAT.lightBlue, 0.05);
      lane.rotation.y = -a;
      add(g, lane, 0, BASE_Y, 0);
    }
  },

  speedslide(g, s) {
    const { L, W, H } = s;
    add(g, profile([[-L / 2, 0], [-L / 2, H + 0.4], [-L / 2 + 1.5, H + 0.4], [L / 2, 0.1], [L / 2, 0]], W - 0.6, MAT.lightBlue, 0.1), 0, BASE_Y, 0);
    for (const z of [-W / 2 + 0.25, W / 2 - 0.25]) add(g, cyl(0.25, L - 0.2, MAT.yellow, 'x'), 0, 0.25, z);
  },

  stepslide(g, s) {
    const { L, W, H } = s;
    for (let i = 0; i < 3; i++) add(g, rbox(0.5, (H * (i + 1)) / 3, W - 0.4, MAT.yellow, 0.15), -L / 2 + 0.3 + i * 0.5, ((H * (i + 1)) / 3) / 2 + BASE_Y, 0);
    add(g, profile([[-L / 2 + 1.5, 0], [-L / 2 + 1.5, H], [L / 2, 0.05], [L / 2, 0]], W - 0.4, MAT.lightBlue), 0, BASE_Y, 0);
  },

  volley(g, s) {
    const { L, W, H } = s;
    const pts: [number, number, number][] = [
      [-L / 2 + 0.35, 0.15, -W / 2 + 0.35],
      [L / 2 - 0.35, 0.15, -W / 2 + 0.35],
      [L / 2 - 0.35, 0.15, W / 2 - 0.35],
      [-L / 2 + 0.35, 0.15, W / 2 - 0.35],
    ];
    add(g, tube(pts, 0.35, MAT.yellow, true));
    for (const z of [-W / 2 + 0.35, W / 2 - 0.35]) add(g, cyl(0.15, H, MAT.white), 0, H / 2, z);
    const net = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.8, 0.8), MAT.net);
    net.rotation.y = Math.PI / 2;
    add(g, net, 0, H - 0.45, 0);
  },

  twist(g, s) {
    const { L, W, H } = s;
    base(g, L, W);
    for (let i = 0; i < 6; i++) {
      const seg = rbox(L / 6 - 0.05, 0.3, W * 0.55, i % 2 ? MAT.yellow : MAT.white, 0.12);
      seg.rotation.x = (i - 2.5) * 0.12;
      add(g, seg, -L / 2 + (L / 6) * (i + 0.5), H - 0.1, 0);
    }
  },
};

function fallback(g: G, s: ModuleSpec) {
  base(g, s.L, s.W);
  add(g, rbox(s.L * 0.6, Math.max(0.3, s.H - 0.3), s.W * 0.6, MAT.yellow, 0.2), 0, Math.max(0.3, s.H - 0.3) / 2, 0);
}

const cache = new Map<string, THREE.Group>();

/** Modèle 3D d'un module (mis en cache ; chaque appel renvoie un clone partageant les géométries). */
export function buildModel(s: ModuleSpec): THREE.Group {
  let proto = cache.get(s.id);
  if (!proto) {
    proto = new THREE.Group();
    const build = B[s.model.kind];
    if (build) build(proto, s, s.model);
    else fallback(proto, s);
    proto.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    cache.set(s.id, proto);
  }
  return proto.clone();
}
