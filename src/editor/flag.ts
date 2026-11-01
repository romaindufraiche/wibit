import { spec } from '../catalog/modules';
import { angleOf, rotate, worldPorts } from '../core/geometry';
import { distToBoundary, outlineEdges, pointInPolygon, siteOutline } from '../core/region';
import type { Placed, Site, Vec2 } from '../core/types';
import { edgeMarginOf } from '../rules/validate';

/*
 * Drapeau de départ : le point de la berge où le parc commence (accès depuis la plage).
 * On peut y recaler tout un parc existant (rotation + translation d'un bloc), ou générer un
 * nouveau parc qui démarre là.
 */

/** Point de la berge le plus proche, avec la direction « vers le large ». */
export function snapToShore(site: Site, p: Vec2): { x: number; z: number; inward: Vec2 } {
  let best = { x: p.x, z: p.z, inward: { x: 0, z: -1 }, d: Infinity };
  for (const e of outlineEdges(siteOutline(site))) {
    const vx = e.b.x - e.a.x,
      vz = e.b.z - e.a.z;
    const t = Math.max(0, Math.min(1, ((p.x - e.a.x) * vx + (p.z - e.a.z) * vz) / (vx * vx + vz * vz || 1)));
    const q = { x: e.a.x + vx * t, z: e.a.z + vz * t };
    const d = Math.hypot(q.x - p.x, q.z - p.z);
    if (d < best.d) best = { ...q, inward: { x: -e.n.x, z: -e.n.z }, d };
  }
  return { x: best.x, z: best.z, inward: best.inward };
}

/** Le drapeau est en pleine eau (et pas contre la berge) : le parc démarre à cet endroit précis. */
export function isOffshore(site: Site, p: Vec2): boolean {
  const P = siteOutline(site);
  return pointInPolygon(p, P) && distToBoundary(p, P) > edgeMarginOf(site) + 2;
}

/** Accès principal du parc : le départ d'un parc généré (m1), sinon l'accès le plus proche du rivage. */
export function mainEntry(site: Site, mods: Placed[]): Placed | null {
  const P = siteOutline(site);
  const entries = mods.filter((m) => spec(m.type).role === 'entry' || spec(m.type).stepUp);
  // parc généré : son premier module (m1) est l'accès de départ
  const first = entries.find((m) => m.uid === 'm1');
  if (first) return first;
  const pool = entries.length ? entries : mods;
  return pool.reduce<Placed | null>((best, m) => (!best || distToBoundary(m, P) < distToBoundary(best, P) ? m : best), null);
}

/**
 * Recale le parc d'un bloc pour que son accès principal soit au drapeau, sortie tournée vers le large.
 * Renvoie les modules déplacés (le parc d'origine n'est pas modifié).
 */
export function moveParkToStart(site: Site, mods: Placed[], flag: Vec2): Placed[] | null {
  const entry = mainEntry(site, mods);
  if (!entry) return null;
  const s = spec(entry.type);
  const shore = snapToShore(site, flag);
  // sortie de l'accès : le port qui part le plus vers le reste du parc (« b » s'il existe)
  const ports = worldPorts(entry, s);
  const out = ports.find((w) => w.port.id === 'b') ?? ports[0];
  const theta = out ? angleOf(shore.inward.x, shore.inward.z) - angleOf(out.dx, out.dz) : 0;
  const depth = edgeMarginOf(site) + s.L / 2 + 0.05;
  // en pleine eau : l'accès est posé sur le drapeau ; sinon contre la berge, au plus près du drapeau
  const target = isOffshore(site, flag) ? { x: flag.x, z: flag.z } : { x: shore.x + shore.inward.x * depth, z: shore.z + shore.inward.z * depth };
  return mods.map((m) => {
    const r = rotate(m.x - entry.x, m.z - entry.z, theta);
    return { ...m, x: Math.round((target.x + r.x) * 100) / 100, z: Math.round((target.z + r.z) * 100) / 100, rot: m.rot + theta };
  });
}
