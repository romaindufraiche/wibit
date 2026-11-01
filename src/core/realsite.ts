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

/** Douglas-Peucker sur un contour fermé : garde la forme, allège les berges OpenStreetMap très détaillées. */
function simplifyRing(poly: Vec2[], tol: number): Vec2[] {
  if (poly.length < 8) return poly;
  const rdp = (pts: Vec2[]): Vec2[] => {
    if (pts.length < 3) return pts;
    let maxD = 0,
      idx = 0;
    for (let i = 1; i < pts.length - 1; i++) {
      const d = segDistance(pts[i], pts[0], pts[pts.length - 1]);
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (maxD <= tol) return [pts[0], pts[pts.length - 1]];
    return [...rdp(pts.slice(0, idx + 1)).slice(0, -1), ...rdp(pts.slice(idx))];
  };
  // on coupe l'anneau en deux au point le plus éloigné du premier
  let far = 0;
  for (let i = 1; i < poly.length; i++) if (Math.hypot(poly[i].x - poly[0].x, poly[i].z - poly[0].z) > Math.hypot(poly[far].x - poly[0].x, poly[far].z - poly[0].z)) far = i;
  const a = rdp(poly.slice(0, far + 1));
  const b = rdp([...poly.slice(far), poly[0]]);
  return [...a.slice(0, -1), ...b.slice(0, -1)];
}

/** Taille maximale d'un plan d'eau utilisé en entier comme zone de travail (m). */
export const WHOLE_LAKE_MAX = 1500;
/** Étendue du décor (vraies berges) autour d'une zone de travail sur un grand lac (m). */
const SHORE_DISPLAY = 3000;

export interface RealSiteInput {
  /** Point choisi sur la carte (dans l'eau, à l'endroit du parc, ou sur la plage). */
  point: LatLon;
  /** Anneaux candidats (plans d'eau) en [lat, lon]. */
  rings: LatLon[][];
  /** Zone de travail (m) : le long du rivage × vers le large, ou « tout le plan d'eau ». */
  zone: { length: number; width: number } | 'all';
  depth: number;
}

export interface RealSiteResult {
  site: Site;
  /** Anneau retenu (pour l'afficher sur la carte). */
  ring: LatLon[];
  /** Coins de la zone de travail en [lat, lon] (pour l'aperçu sur la carte). */
  zone: LatLon[];
  /** Le plan d'eau entier sert de zone de travail. */
  whole: boolean;
  /** Plus grande dimension du plan d'eau (m). */
  extent: number;
}

/**
 * Choisit le plan d'eau, oriente la zone sur la berge la plus proche et produit le site local.
 * Le décor 3D reste stylisé : seules les berges réelles sont reprises (contour), pas d'imagerie.
 */
export function buildRealSite(inp: RealSiteInput): RealSiteResult | null {
  const P = inp.point;
  // plan d'eau qui contient le point, sinon le plus proche
  let best: { ring: LatLon[]; en: Vec2[]; inside: boolean; d: number } | null = null;
  const rank = (c: { inside: boolean; d: number }) => (c.inside ? -1 / (1 + c.d) : c.d);
  for (const ring of inp.rings) {
    if (ring.length < 4) continue;
    const en = ring.map((q) => toEN(P, q));
    const inside = pointInPolygon({ x: 0, z: 0 }, en);
    let d = Infinity;
    for (let i = 0; i < en.length - 1; i++) d = Math.min(d, segDistance({ x: 0, z: 0 }, en[i], en[i + 1]));
    const cand = { ring, en, inside, d };
    if (!best || rank(cand) < rank(best)) best = cand;
  }
  if (!best) return null;
  // berge la plus proche : point B ; « vers le large » = de B vers l'eau
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
    const c = best.en.reduce((a, q) => ({ x: a.x + q.x / best!.en.length, z: a.z + q.z / best!.en.length }), { x: 0, z: 0 });
    dir = { x: c.x - B.x, z: c.z - B.z };
    dl = Math.hypot(dir.x, dir.z) || 1;
  }
  dir = { x: dir.x / dl, z: dir.z / dl };
  const bearing = Math.round(((((Math.atan2(dir.x, dir.z) * 180) / Math.PI) % 360) + 360) % 360 * 10) / 10;

  // contour du lac dans le repère orienté (origine provisoire : le point choisi)
  const geo0: Geo = { lat: P[0], lon: P[1], bearing };
  const local0 = simplifyRing(best.ring.map((q) => latLonToLocal(geo0, q)), 1.2);
  let minX = Infinity,
    maxX = -Infinity,
    minZ = Infinity,
    maxZ = -Infinity;
  for (const q of local0) {
    minX = Math.min(minX, q.x);
    maxX = Math.max(maxX, q.x);
    minZ = Math.min(minZ, q.z);
    maxZ = Math.max(maxZ, q.z);
  }
  const extent = Math.max(maxX - minX, maxZ - minZ);
  const whole = inp.zone === 'all' && extent <= WHOLE_LAKE_MAX;

  let cLocal: Vec2;
  let length: number, width: number;
  if (whole) {
    // tout le plan d'eau : zone = emprise du lac
    cLocal = { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2 };
    length = Math.ceil(maxX - minX + 2);
    width = Math.ceil(maxZ - minZ + 2);
  } else {
    const z = inp.zone === 'all' ? { length: 500, width: 320 } : inp.zone;
    length = z.length;
    width = z.width;
    // la berge se retrouve à ~45 m du bord « plage » de la zone
    const back = Math.min(45, width * 0.3);
    const bLocal = enToLocal(B, bearing);
    cLocal = { x: bLocal.x, z: bLocal.z - (width / 2 - back) };
  }
  const centerLL = toLatLon(geo0, cLocal.x, cLocal.z);
  const geo: Geo = { lat: +centerLL.lat.toFixed(7), lon: +centerLL.lon.toFixed(7), bearing };
  const shift = (q: Vec2) => ({ x: q.x - cLocal.x, z: q.z - cLocal.z });
  const lake = local0.map(shift);
  const outline = whole ? lake : thin(clipToRect(lake, length / 2, width / 2));
  if (outline.length < 3) return null;
  // décor : vraies berges autour de la zone (le lac entier s'il est petit)
  const shore = whole || extent <= SHORE_DISPLAY ? lake : thin(clipToRect(lake, SHORE_DISPLAY / 2, SHORE_DISPLAY / 2));
  const zoneLL: LatLon[] = [
    [-length / 2, -width / 2],
    [length / 2, -width / 2],
    [length / 2, width / 2],
    [-length / 2, width / 2],
  ].map(([x, z]) => {
    const g = toLatLon(geo, x, z);
    return [g.lat, g.lon] as LatLon;
  });
  return {
    site: { length, width, depth: inp.depth, geo, outline, shore },
    ring: best.ring,
    zone: zoneLL,
    whole,
    extent,
  };
}
