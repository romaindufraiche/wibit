import { spec } from '../catalog/modules';
import { moduleOBB, normAngle, obbInsideRect, obbOverlap, snapTransform, worldPorts } from './geometry';
import { buildGraph, freePorts } from './graph';
import type { Placed, Site } from './types';

export const SNAP_RADIUS = 1.6;

/**
 * Aimantation : cherche le couple (port du module déplacé, port libre d'un autre module)
 * le plus proche et renvoie la transformation qui les colle. Le score pénalise les grandes
 * rotations pour respecter l'orientation choisie par l'utilisateur.
 */
export function findSnap(moving: Placed, others: Placed[]): { x: number; z: number; rot: number; target: string } | null {
  const s = spec(moving.type);
  if (!s.ports.length) return null;
  const free = freePorts(buildGraph(others));
  const mine = worldPorts(moving, s);
  let best: { x: number; z: number; rot: number; target: string; score: number } | null = null;
  for (const mp of mine) {
    for (const fp of free) {
      const d = Math.hypot(mp.x - fp.x, mp.z - fp.z);
      if (d > SNAP_RADIUS) continue;
      const tf = snapTransform(mp.port, fp);
      const dRot = Math.abs(normAngle(tf.rot - moving.rot));
      const score = d + dRot * 0.8;
      if (best && score >= best.score) continue;
      // refuse un collage qui fait chevaucher un autre module
      const o = moduleOBB(tf, s);
      if (others.some((q) => obbOverlap(o, moduleOBB(q, spec(q.type)), 0.08))) continue;
      best = { ...tf, target: fp.uid, score };
    }
  }
  return best ? { x: best.x, z: best.z, rot: best.rot, target: best.target } : null;
}

/** Accroche un nouveau module `type` à l'un des ports libres de `anchor` (pour le clic catalogue). */
export function attachTo(type: string, anchor: Placed, all: Placed[], site: Site): { x: number; z: number; rot: number } | null {
  const s = spec(type);
  const g = buildGraph(all);
  const free = freePorts(g).filter((f) => f.uid === anchor.uid);
  for (const fp of free) {
    for (const port of s.ports) {
      const tf = snapTransform(port, fp);
      const o = moduleOBB(tf, s);
      if (!obbInsideRect(o, site.length / 2, site.width / 2, 0)) continue;
      if (all.some((q) => obbOverlap(o, moduleOBB(q, spec(q.type)), 0.08))) continue;
      return tf;
    }
  }
  return null;
}

/** Cherche un emplacement libre près de (x, z) en spirale. */
export function freeSpot(type: string, x: number, z: number, all: Placed[], site: Site): { x: number; z: number; rot: number } {
  const s = spec(type);
  for (let r = 0; r < 60; r += 1.5) {
    const n = Math.max(1, Math.round(r * 2));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const tf = { x: x + Math.cos(a) * r, z: z + Math.sin(a) * r, rot: 0 };
      const o = moduleOBB(tf, s, 1);
      if (!obbInsideRect(o, site.length / 2, site.width / 2, 2)) continue;
      if (all.some((q) => obbOverlap(o, moduleOBB(q, spec(q.type)), 0))) continue;
      return tf;
    }
  }
  return { x, z, rot: 0 };
}
