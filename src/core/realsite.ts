import { toLatLon } from './anchors';
import { pointInPolygon, segDistance } from './region';
import type { Geo, Site, Vec2 } from './types';

/*
 * « Mon site réel » : passage d'un point choisi sur la carte (et du contour réel du plan d'eau
 * issu d'OpenStreetMap ou dessiné à la main) au repère local du configurateur.
 *
 * Repère local : x le long du rivage, −z vers le large, rivage (plage) côté +z. On oriente donc
 * la zone de travail pour que la berge la plus proche du point se retrouve en bas de la scène.
 */

const M = 111_320;
export type LatLon = [number, number];

/** Coordonnées (est, nord) en mètres autour d'une origine. */
export function toEN(origin: LatLon, p: LatLon): Vec2 {
  return { x: (p[1] - origin[1]) * M * Math.cos((origin[0] * Math.PI) / 180), z: (p[0] - origin[0]) * M };
}

/** Repère monde (est, nord) -> repère local (x, z) pour un centre et un azimut du large donnés. */
export function enToLocal(en: Vec2, bearing: number): Vec2 {
  const b = (bearing * Math.PI) / 180;
  const east = en.x,
    north = en.z;
  const x = east * Math.cos(b) - north * Math.sin(b);
  const f = east * Math.sin(b) + north * Math.cos(b);
  return { x, z: -f };
}

export function latLonToLocal(geo: Geo, p: LatLon): Vec2 {
  return enToLocal(toEN([geo.lat, geo.lon], p), geo.bearing);
}

/** Découpe d'un polygone (quelconque) par un rectangle aligné (Sutherland–Hodgman). */
export function clipToRect(poly: Vec2[], hx: number, hz: number): Vec2[] {
  const edges: [(p: Vec2) => boolean, (a: Vec2, b: Vec2) => Vec2][] = [
    [(p) => p.x >= -hx, (a, b) => ({ x: -hx, z: a.z + ((b.z - a.z) * (-hx - a.x)) / (b.x - a.x) })],
    [(p) => p.x <= hx, (a, b) => ({ x: hx, z: a.z + ((b.z - a.z) * (hx - a.x)) / (b.x - a.x) })],
    [(p) => p.z >= -hz, (a, b) => ({ x: a.x + ((b.x - a.x) * (-hz - a.z)) / (b.z - a.z), z: -hz })],
    [(p) => p.z <= hz, (a, b) => ({ x: a.x + ((b.x - a.x) * (hz - a.z)) / (b.z - a.z), z: hz })],
  ];
  let out = poly;
  for (const [inside, cut] of edges) {
    const input = out;
    out = [];
    for (let i = 0; i < input.length; i++) {
      const cur = input[i],
        prev = input[(i + input.length - 1) % input.length];
      if (inside(cur)) {
        if (!inside(prev)) out.push(cut(prev, cur));
        out.push(cur);
      } else if (inside(prev)) out.push(cut(prev, cur));
    }
    if (!out.length) break;
  }
  return out;
}

/** Simplifie un contour : supprime les points à moins de `min` m du précédent. */
function thin(poly: Vec2[], min = 1.5): Vec2[] {
  const out: Vec2[] = [];
  for (const p of poly) if (!out.length || Math.hypot(p.x - out[out.length - 1].x, p.z - out[out.length - 1].z) >= min) out.push(p);
  if (out.length > 2 && Math.hypot(out[0].x - out[out.length - 1].x, out[0].z - out[out.length - 1].z) < min) out.pop();
  return out;
}

export interface RealSiteInput {
  /** Point choisi sur la carte (dans l'eau, à l'endroit du parc, ou sur la plage). */
  point: LatLon;
  /** Anneaux candidats (plans d'eau) en [lat, lon]. */
  rings: LatLon[][];
  /** Taille de la zone de travail (m) : le long du rivage × vers le large. */
  length: number;
  width: number;
  depth: number;
}

export interface RealSiteResult {
  site: Site;
  /** Anneau retenu (pour l'afficher sur la carte). */
  ring: LatLon[];
  /** Coins de la zone de travail en [lat, lon] (pour l'aperçu sur la carte). */
  zone: LatLon[];
}

/** Choisit le plan d'eau, oriente la zone sur la berge la plus proche et produit le site local. */
export function buildRealSite(inp: RealSiteInput): RealSiteResult | null {
  const P = inp.point;
  // plan d'eau qui contient le point, sinon le plus proche
  let best: { ring: LatLon[]; en: Vec2[]; inside: boolean; d: number } | null = null;
  for (const ring of inp.rings) {
    if (ring.length < 4) continue;
    const en = ring.map((q) => toEN(P, q));
    const inside = pointInPolygon({ x: 0, z: 0 }, en);
    let d = Infinity;
    for (let i = 0; i < en.length - 1; i++) d = Math.min(d, segDistance({ x: 0, z: 0 }, en[i], en[i + 1]));
    const score = inside ? -1 / (1 + d) : d;
    if (!best || score < (best.inside ? -1 / (1 + best.d) : best.d)) best = { ring, en, inside, d };
  }
  if (!best) return null;
  // berge la plus proche : point B sur le contour ; « vers le large » = de B vers l'eau
  let B: Vec2 = { x: 0, z: 0 };
  let bd = Infinity;
  for (let i = 0; i < best.en.length - 1; i++) {
    const a = best.en[i],
      b = best.en[i + 1];
    const vx = b.x - a.x,
      vz = b.z - a.z;
    const t = Math.max(0, Math.min(1, (-a.x * vx - a.z * vz) / (vx * vx + vz * vz || 1)));
    const q = { x: a.x + vx * t, z: a.z + vz * t };
    const d = Math.hypot(q.x, q.z);
    if (d < bd) {
      bd = d;
      B = q;
    }
  }
  let dir = best.inside ? { x: -B.x, z: -B.z } : { x: B.x, z: B.z };
  let dl = Math.hypot(dir.x, dir.z);
  if (dl < 0.5) {
    // point pile sur la berge : direction vers le centre de gravité du plan d'eau
    const c = best.en.reduce((a, q) => ({ x: a.x + q.x / best!.en.length, z: a.z + q.z / best!.en.length }), { x: 0, z: 0 });
    dir = { x: c.x - B.x, z: c.z - B.z };
    dl = Math.hypot(dir.x, dir.z) || 1;
  }
  dir = { x: dir.x / dl, z: dir.z / dl };
  const bearing = ((((Math.atan2(dir.x, dir.z) * 180) / Math.PI) % 360) + 360) % 360;
  // centre de la zone : la berge se retrouve à ~45 m du bord « plage » de la zone
  const back = Math.min(45, inp.width * 0.3);
  const cEN = { x: B.x + dir.x * (inp.width / 2 - back), z: B.z + dir.z * (inp.width / 2 - back) };
  const center = toLatLon({ lat: P[0], lon: P[1], bearing: 0 }, cEN.x, -cEN.z);
  const geo: Geo = { lat: +center.lat.toFixed(7), lon: +center.lon.toFixed(7), bearing: Math.round(bearing * 10) / 10 };
  const local = best.ring.map((q) => latLonToLocal(geo, q));
  const clipped = thin(clipToRect(local, inp.length / 2, inp.width / 2));
  if (clipped.length < 3) return null;
  const zone: LatLon[] = [
    [-inp.length / 2, -inp.width / 2],
    [inp.length / 2, -inp.width / 2],
    [inp.length / 2, inp.width / 2],
    [-inp.length / 2, inp.width / 2],
  ].map(([x, z]) => {
    const g = toLatLon(geo, x, z);
    return [g.lat, g.lon] as LatLon;
  });
  return {
    site: { length: inp.length, width: inp.width, depth: inp.depth, geo, outline: clipped, imagery: true },
    ring: best.ring,
    zone,
  };
}
