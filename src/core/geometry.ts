import type { ModuleSpec, Placed, PortSpec, Vec2, ZoneSpec } from './types';

/**
 * Rotation 2D cohérente avec three.js : un Object3D avec rotation.y = θ transforme
 * le point local (x, z) en (x·cosθ + z·sinθ, −x·sinθ + z·cosθ).
 */
export function rotate(x: number, z: number, rot: number): Vec2 {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  return { x: x * c + z * s, z: -x * s + z * c };
}

/** Angle d'un vecteur dans la convention de `rotate` : rotate((1,0), a) a pour angle a. */
export function angleOf(x: number, z: number): number {
  return Math.atan2(-z, x);
}

export function normAngle(a: number): number {
  let r = a % (Math.PI * 2);
  if (r > Math.PI) r -= Math.PI * 2;
  if (r <= -Math.PI) r += Math.PI * 2;
  return r;
}

export interface WorldPort {
  uid: string;
  port: PortSpec;
  x: number;
  z: number;
  dx: number;
  dz: number;
}

export function worldPorts(p: Placed, spec: ModuleSpec): WorldPort[] {
  return spec.ports.map((port) => {
    const pos = rotate(port.x, port.z, p.rot);
    const dir = rotate(port.dx, port.dz, p.rot);
    return { uid: p.uid, port, x: p.x + pos.x, z: p.z + pos.z, dx: dir.x, dz: dir.z };
  });
}

/** Transformation qui colle le port `port` d'un module au port monde `target` (positions confondues, directions opposées). */
export function snapTransform(port: PortSpec, target: { x: number; z: number; dx: number; dz: number }): { x: number; z: number; rot: number } {
  const rot = normAngle(angleOf(-target.dx, -target.dz) - angleOf(port.dx, port.dz));
  const off = rotate(port.x, port.z, rot);
  return { x: target.x - off.x, z: target.z - off.z, rot };
}

/** Rectangle orienté (centre, demi-axes, angle). */
export interface OBB {
  cx: number;
  cz: number;
  hx: number;
  hz: number;
  rot: number;
}

export function moduleOBB(p: { x: number; z: number; rot: number }, spec: ModuleSpec, inflate = 0): OBB {
  return { cx: p.x, cz: p.z, hx: spec.L / 2 + inflate, hz: spec.W / 2 + inflate, rot: p.rot };
}

export function zoneOBB(p: { x: number; z: number; rot: number }, zone: ZoneSpec): OBB {
  const c = rotate(zone.x, zone.z, p.rot);
  return { cx: p.x + c.x, cz: p.z + c.z, hx: zone.hx, hz: zone.hz, rot: p.rot };
}

export function obbCorners(o: OBB): Vec2[] {
  const pts: Vec2[] = [];
  for (const [sx, sz] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ]) {
    const r = rotate(sx * o.hx, sz * o.hz, o.rot);
    pts.push({ x: o.cx + r.x, z: o.cz + r.z });
  }
  return pts;
}

function axes(o: OBB): Vec2[] {
  const a = rotate(1, 0, o.rot);
  const b = rotate(0, 1, o.rot);
  return [a, b];
}

/** Test de chevauchement par axes séparateurs. `tol` > 0 tolère un léger contact. */
export function obbOverlap(a: OBB, b: OBB, tol = 0.02): boolean {
  const ca = obbCorners(a);
  const cb = obbCorners(b);
  for (const ax of [...axes(a), ...axes(b)]) {
    let minA = Infinity,
      maxA = -Infinity,
      minB = Infinity,
      maxB = -Infinity;
    for (const p of ca) {
      const d = p.x * ax.x + p.z * ax.z;
      minA = Math.min(minA, d);
      maxA = Math.max(maxA, d);
    }
    for (const p of cb) {
      const d = p.x * ax.x + p.z * ax.z;
      minB = Math.min(minB, d);
      maxB = Math.max(maxB, d);
    }
    if (maxA - tol <= minB || maxB - tol <= minA) return false;
  }
  return true;
}

export function pointInOBB(p: Vec2, o: OBB): boolean {
  const l = rotate(p.x - o.cx, p.z - o.cz, -o.rot);
  return Math.abs(l.x) <= o.hx && Math.abs(l.z) <= o.hz;
}

/** Tous les coins dans le rectangle [−hx+m, hx−m] × [−hz+m, hz−m]. */
export function obbInsideRect(o: OBB, halfX: number, halfZ: number, margin: number): boolean {
  return obbCorners(o).every((c) => Math.abs(c.x) <= halfX - margin + 1e-6 && Math.abs(c.z) <= halfZ - margin + 1e-6);
}

/** Distance minimale entre deux OBB (0 si chevauchement) — approximation par échantillonnage des arêtes. */
export function obbDistance(a: OBB, b: OBB): number {
  if (obbOverlap(a, b, 0)) return 0;
  const segDist = (p: Vec2, q: Vec2, r: Vec2): number => {
    const vx = q.x - p.x,
      vz = q.z - p.z;
    const len2 = vx * vx + vz * vz || 1;
    const t = Math.max(0, Math.min(1, ((r.x - p.x) * vx + (r.z - p.z) * vz) / len2));
    const dx = p.x + t * vx - r.x,
      dz = p.z + t * vz - r.z;
    return Math.hypot(dx, dz);
  };
  const ca = obbCorners(a);
  const cb = obbCorners(b);
  let best = Infinity;
  for (let i = 0; i < 4; i++) {
    for (const r of cb) best = Math.min(best, segDist(ca[i], ca[(i + 1) % 4], r));
    for (const r of ca) best = Math.min(best, segDist(cb[i], cb[(i + 1) % 4], r));
  }
  return best;
}

export const PORT_SNAP_TOL = 0.15;

export function portsConnected(a: WorldPort, b: WorldPort): boolean {
  return Math.hypot(a.x - b.x, a.z - b.z) < PORT_SNAP_TOL && a.dx * b.dx + a.dz * b.dz < -0.95;
}
