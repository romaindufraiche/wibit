import { spec } from '../catalog/modules';
import { portsConnected, worldPorts, type WorldPort } from './geometry';
import type { Placed } from './types';

export interface Link {
  a: string;
  aPort: string;
  b: string;
  bPort: string;
}

export interface ParkGraph {
  links: Link[];
  /** uid -> voisins connectés */
  adj: Map<string, Set<string>>;
  /** uid -> ids des ports connectés */
  usedPorts: Map<string, Set<string>>;
  ports: WorldPort[];
}

/** Les connexions sont déduites de la géométrie : deux ports confondus et opposés sont connectés. */
export function buildGraph(mods: Placed[]): ParkGraph {
  const ports: WorldPort[] = [];
  for (const p of mods) ports.push(...worldPorts(p, spec(p.type)));
  const adj = new Map<string, Set<string>>();
  const usedPorts = new Map<string, Set<string>>();
  for (const p of mods) {
    adj.set(p.uid, new Set());
    usedPorts.set(p.uid, new Set());
  }
  const links: Link[] = [];
  // Hachage spatial grossier pour rester rapide sur les grands parcs.
  const cell = 1;
  const grid = new Map<string, WorldPort[]>();
  const key = (x: number, z: number) => `${Math.floor(x / cell)},${Math.floor(z / cell)}`;
  for (const wp of ports) {
    const k = key(wp.x, wp.z);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k)!.push(wp);
  }
  for (const wp of ports) {
    const cx = Math.floor(wp.x / cell);
    const cz = Math.floor(wp.z / cell);
    for (let i = -1; i <= 1; i++)
      for (let j = -1; j <= 1; j++) {
        for (const o of grid.get(`${cx + i},${cz + j}`) ?? []) {
          if (o.uid <= wp.uid) continue;
          if (!portsConnected(wp, o)) continue;
          links.push({ a: wp.uid, aPort: wp.port.id, b: o.uid, bPort: o.port.id });
          adj.get(wp.uid)!.add(o.uid);
          adj.get(o.uid)!.add(wp.uid);
          usedPorts.get(wp.uid)!.add(wp.port.id);
          usedPorts.get(o.uid)!.add(o.port.id);
        }
      }
  }
  return { links, adj, usedPorts, ports };
}

export function freePorts(graph: ParkGraph): WorldPort[] {
  return graph.ports.filter((p) => !graph.usedPorts.get(p.uid)?.has(p.port.id));
}

/** Composantes connexes (îlots). */
export function components(mods: Placed[], graph: ParkGraph): string[][] {
  const seen = new Set<string>();
  const out: string[][] = [];
  for (const p of mods) {
    if (seen.has(p.uid)) continue;
    const comp: string[] = [];
    const stack = [p.uid];
    seen.add(p.uid);
    while (stack.length) {
      const u = stack.pop()!;
      comp.push(u);
      for (const v of graph.adj.get(u) ?? []) {
        if (!seen.has(v)) {
          seen.add(v);
          stack.push(v);
        }
      }
    }
    out.push(comp);
  }
  return out;
}

/** Vrai si a et b sont voisins ou partagent un voisin (distance ≤ 2 dans le graphe). */
export function near(graph: ParkGraph, a: string, b: string): boolean {
  const na = graph.adj.get(a);
  if (!na) return false;
  if (na.has(b)) return true;
  for (const n of na) if (graph.adj.get(n)?.has(b)) return true;
  return false;
}

/** Nombre de cycles indépendants (boucles InfinityLoop) : E − V + C. */
export function loopCount(mods: Placed[], graph: ParkGraph): number {
  return Math.max(0, graph.links.length - mods.length + components(mods, graph).length);
}
