import { obbCorners, pointInOBB, type OBB } from './geometry';
import type { Site, Vec2 } from './types';

/*
 * Contour du plan d'eau utilisable. Par défaut un rectangle (longueur × largeur, rivage en
 * z = +largeur/2) ; l'utilisateur peut le remodeler (polygone libre, ex. crique, ponton, berge
 * irrégulière). Toutes les règles de placement s'appuient sur ce contour.
 */

export function rectOutline(length: number, width: number): Vec2[] {
  return [
    { x: -length / 2, z: -width / 2 },
    { x: length / 2, z: -width / 2 },
    { x: length / 2, z: width / 2 },
    { x: -length / 2, z: width / 2 },
  ];
}

export function siteOutline(site: Site): Vec2[] {
  return site.outline && site.outline.length >= 3 ? site.outline : rectOutline(site.length, site.width);
}

/** Rectangle subdivisé (un point tous les ~`step` m) : point de départ du remodelage. */
export function editableOutline(site: Site, step = 12): Vec2[] {
  if (site.outline && site.outline.length >= 3) return site.outline.map((p) => ({ ...p }));
  const r = rectOutline(site.length, site.width);
  const out: Vec2[] = [];
  for (let i = 0; i < 4; i++) {
    const a = r[i],
      b = r[(i + 1) % 4];
    const n = Math.max(1, Math.round(Math.hypot(b.x - a.x, b.z - a.z) / step));
    for (let k = 0; k < n; k++) out.push({ x: a.x + ((b.x - a.x) * k) / n, z: a.z + ((b.z - a.z) * k) / n });
  }
  return out;
}

export function bounds(poly: Vec2[]) {
  let minX = Infinity,
    maxX = -Infinity,
    minZ = Infinity,
    maxZ = -Infinity;
  for (const p of poly) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z);
    maxZ = Math.max(maxZ, p.z);
  }
  return { minX, maxX, minZ, maxZ };
}

export function pointInPolygon(p: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i],
      b = poly[j];
    if (a.z > p.z !== b.z > p.z && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

export function segDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const vx = b.x - a.x,
    vz = b.z - a.z;
  const len2 = vx * vx + vz * vz || 1e-9;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.z - a.z) * vz) / len2));
  return Math.hypot(a.x + vx * t - p.x, a.z + vz * t - p.z);
}

export function distToBoundary(p: Vec2, poly: Vec2[]): number {
  let d = Infinity;
  for (let i = 0; i < poly.length; i++) d = Math.min(d, segDistance(p, poly[i], poly[(i + 1) % poly.length]));
  return d;
}

/** Le point est dans l'eau, à au moins `margin` m du bord. */
export function insideSite(p: Vec2, poly: Vec2[], margin = 0): boolean {
  return pointInPolygon(p, poly) && (margin <= 0 || distToBoundary(p, poly) >= margin - 1e-6);
}

/** Rectangle orienté entièrement dans l'eau, à au moins `margin` m du rivage. */
export function obbInsideSite(o: OBB, poly: Vec2[], margin: number): boolean {
  const c = obbCorners(o);
  // échantillons le long des côtés (contours concaves)
  for (let i = 0; i < 4; i++) {
    const a = c[i],
      b = c[(i + 1) % 4];
    for (let k = 0; k < 4; k++) {
      const t = k / 4;
      if (!insideSite({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t }, poly, margin)) return false;
    }
  }
  // aucune pointe de berge ne doit entrer dans l'emprise (élargie de la marge)
  const grown = { ...o, hx: o.hx + margin, hz: o.hz + margin };
  return !poly.some((v) => pointInOBB(v, grown));
}

/** Normale sortante (vers la terre) de chaque arête. */
export function outwardNormals(poly: Vec2[]): Vec2[] {
  let area = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i],
      b = poly[(i + 1) % poly.length];
    area += a.x * b.z - b.x * a.z;
  }
  const sign = area > 0 ? -1 : 1;
  return poly.map((a, i) => {
    const b = poly[(i + 1) % poly.length];
    const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    return { x: (sign * -(b.z - a.z)) / len, z: (sign * (b.x - a.x)) / len };
  });
}

/** Polygone décalé de `d` m (d > 0 : vers la terre, d < 0 : vers l'eau). */
export function offsetPolygon(poly: Vec2[], d: number): Vec2[] {
  const n = outwardNormals(poly);
  return poly.map((p, i) => {
    const n1 = n[(i - 1 + poly.length) % poly.length],
      n2 = n[i];
    let mx = n1.x + n2.x,
      mz = n1.z + n2.z;
    const ml = Math.hypot(mx, mz) || 1;
    mx /= ml;
    mz /= ml;
    const cos = Math.max(0.35, mx * n2.x + mz * n2.z);
    return { x: p.x + (mx * d) / cos, z: p.z + (mz * d) / cos };
  });
}

/** Arêtes de rivage « plage » (normale sortante orientée vers +z, côté spectateurs). */
export function shoreEdges(poly: Vec2[]): { a: Vec2; b: Vec2; n: Vec2; len: number }[] {
  const n = outwardNormals(poly);
  const edges = poly.map((a, i) => {
    const b = poly[(i + 1) % poly.length];
    return { a, b, n: n[i], len: Math.hypot(b.x - a.x, b.z - a.z) };
  });
  const beach = edges.filter((e) => e.n.z > 0.5 && e.len > 2);
  return beach.length ? beach : edges.filter((e) => e.len > 2);
}

/** Centre de gravité (pour le cadrage). */
export function centroid(poly: Vec2[]): Vec2 {
  const b = bounds(poly);
  return { x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2 };
}
