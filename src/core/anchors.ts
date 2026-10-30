import { spec } from '../catalog/modules';
import { moduleOBB, obbCorners } from './geometry';
import type { Geo, Placed, Site, Vec2 } from './types';

export type { Geo };

/*
 * Plan d'ancrage : position de chaque ancre au fond de l'eau, pour que l'équipe les pose
 * en bateau AVANT d'amener les modules. Hypothèse MVP : les ancres sont posées à 2,5 m
 * à l'extérieur de l'emprise du module (coins d'abord, puis milieux des côtés), et deux
 * ancres à moins de 1,2 m l'une de l'autre sont mutualisées.
 */

export const ANCHOR_OFFSET = 2.5;

export interface Anchor {
  /** Numéro dans l'ordre de pose (tournée en bateau). */
  n: number;
  x: number;
  z: number;
  /** Modules retenus par cette ancre. */
  uids: string[];
  modules: string[];
}

function candidatePoints(p: Placed): Vec2[] {
  const s = spec(p.type);
  const c = obbCorners(moduleOBB(p, s, ANCHOR_OFFSET));
  const mid = (a: Vec2, b: Vec2, t = 0.5): Vec2 => ({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
  // coins opposés d'abord pour bien équilibrer le module
  return [c[0], c[2], c[1], c[3], mid(c[0], c[1]), mid(c[2], c[3]), mid(c[1], c[2]), mid(c[3], c[0]), mid(c[0], c[1], 0.25), mid(c[2], c[3], 0.25), mid(c[0], c[1], 0.75), mid(c[2], c[3], 0.75)];
}

export function computeAnchors(mods: Placed[]): Anchor[] {
  const raw: { x: number; z: number; uid: string; name: string }[] = [];
  for (const p of mods) {
    const s = spec(p.type);
    const pts = candidatePoints(p);
    for (let i = 0; i < s.anchors; i++) {
      const base = pts[i % pts.length];
      // au-delà de 12 ancres, on s'éloigne un peu plus
      const k = 1 + Math.floor(i / pts.length) * 0.15;
      raw.push({ x: p.x + (base.x - p.x) * k, z: p.z + (base.z - p.z) * k, uid: p.uid, name: s.name });
    }
  }
  // mutualisation des ancres proches
  const merged: { x: number; z: number; uids: string[]; modules: string[] }[] = [];
  for (const r of raw) {
    const m = merged.find((a) => Math.hypot(a.x - r.x, a.z - r.z) < 1.2);
    if (m) {
      if (!m.uids.includes(r.uid)) {
        m.uids.push(r.uid);
        m.modules.push(r.name);
      }
    } else merged.push({ x: r.x, z: r.z, uids: [r.uid], modules: [r.name] });
  }
  // tournée du bateau : plus proche voisin depuis le rivage (z max)
  const out: Anchor[] = [];
  const left = [...merged];
  let cur: Vec2 = { x: 0, z: Infinity };
  if (left.length) {
    const startIdx = left.reduce((best, a, i) => (a.z > left[best].z ? i : best), 0);
    cur = left[startIdx];
  }
  while (left.length) {
    let bi = 0,
      bd = Infinity;
    left.forEach((a, i) => {
      const d = Math.hypot(a.x - cur.x, a.z - cur.z);
      if (d < bd) {
        bd = d;
        bi = i;
      }
    });
    const a = left.splice(bi, 1)[0];
    out.push({ n: out.length + 1, ...a });
    cur = a;
  }
  return out;
}

// ------------------------------------------------ géoréférencement

const M_PER_DEG_LAT = 111_320;

/**
 * Coordonnées locales -> WGS84. Repère local : x le long du rivage (vers la droite quand on
 * regarde le large depuis la plage), −z vers le large, origine au centre du plan d'eau.
 */
export function toLatLon(geo: Geo, x: number, z: number): { lat: number; lon: number } {
  const b = (geo.bearing * Math.PI) / 180;
  const fwd = -z;
  const east = x * Math.cos(b) + fwd * Math.sin(b);
  const north = -x * Math.sin(b) + fwd * Math.cos(b);
  const lat = geo.lat + north / M_PER_DEG_LAT;
  const lon = geo.lon + east / (M_PER_DEG_LAT * Math.cos((geo.lat * Math.PI) / 180));
  return { lat, lon };
}

export function dms(v: number, pos: string, neg: string): string {
  const s = v >= 0 ? pos : neg;
  const a = Math.abs(v);
  const d = Math.floor(a);
  const mFloat = (a - d) * 60;
  return `${d}°${mFloat.toFixed(3).padStart(6, '0')}' ${s}`;
}

export function siteGeo(site: Site): Geo | null {
  return site.geo ?? null;
}
