import { ACCESSORIES, spec } from '../catalog/modules';
import { moduleOBB, obbCorners, obbDistance, obbInsideRect, obbOverlap, zoneOBB } from '../core/geometry';
import { buildGraph, components, freePorts, loopCount, near, type ParkGraph } from '../core/graph';
import type { Audience, Issue, Placed, Project, Vec2 } from '../core/types';

/*
 * Moteur de règles. Chaque règle est documentée dans docs/REGLES.md (mêmes identifiants).
 * Les constantes ci-dessous sont les paramètres à valider avec Wibit.
 */
export const RULES = {
  /** Distance minimale au rivage / aux bords du bassin (ISO 25649, cf. notice Boaz). */
  edgeMargin: 3,
  /** Écart minimal entre deux modules non reliés (risque de coincement). */
  minGap: 1.5,
  /** Différence de hauteur max entre deux modules reliés sans plateforme intermédiaire. */
  maxHeightStep: 1.5,
  /** Nombre max d'obstacles enchaînés sans plateforme de repos. */
  maxRun: 4,
  /** Nombre max d'obstacles « experts » (difficulté ≥ 4) enchaînés. */
  maxExpertRun: 2,
  /** Un poste de surveillance pour N baigneurs. */
  usersPerWatch: 50,
  /** Rayon de surveillance d'un poste (m). */
  watchRadius: 25,
  /** Un accès (entrée / step-up) pour N baigneurs. */
  usersPerAccess: 40,
  /** Au-delà de cette capacité, une boucle InfinityLoop est recommandée. */
  loopAdvisedFrom: 60,
  /** Tolérance d'alignement : ports proches mais non connectés. */
  misalignTol: 0.9,
};

export const AUDIENCE_LIMITS: Record<Audience, { maxH: number; maxDiff: number; label: string }> = {
  kids: { maxH: 2, maxDiff: 2, label: 'Enfants (6–12 ans)' },
  family: { maxH: 3.5, maxDiff: 4, label: 'Famille' },
  sport: { maxH: 99, maxDiff: 5, label: 'Sportif (ados / adultes)' },
  mixed: { maxH: 99, maxDiff: 5, label: 'Mixte' },
};

export interface Stats {
  modules: number;
  capacity: number;
  price: number;
  anchors: number;
  buoys: number;
  lifejackets: number;
  accessoriesPrice: number;
  total: number;
  area: number;
  footprint: { w: number; d: number };
  loops: number;
  islands: number;
  watchPosts: number;
  accesses: number;
  perimeter: Vec2[];
}

const PASSABLE = new Set(['obstacle', 'tower']);

export function validate(project: Project, graph: ParkGraph = buildGraph(project.modules)): Issue[] {
  const mods = project.modules;
  const { site } = project;
  const issues: Issue[] = [];
  const add = (rule: string, level: Issue['level'], message: string, uids: string[] = []) => issues.push({ rule, level, message, uids });
  const obbs = new Map(mods.map((p) => [p.uid, moduleOBB(p, spec(p.type))]));
  const byUid = new Map(mods.map((p) => [p.uid, p]));

  // R01 chevauchement / R05 écart minimal
  for (let i = 0; i < mods.length; i++) {
    for (let j = i + 1; j < mods.length; j++) {
      const a = mods[i],
        b = mods[j];
      const oa = obbs.get(a.uid)!,
        ob = obbs.get(b.uid)!;
      if (Math.hypot(oa.cx - ob.cx, oa.cz - ob.cz) > oa.hx + oa.hz + ob.hx + ob.hz + RULES.minGap) continue;
      if (obbOverlap(oa, ob, 0.05)) {
        add('R01', 'error', `${spec(a.type).name} et ${spec(b.type).name} se chevauchent.`, [a.uid, b.uid]);
      } else if (!near(graph, a.uid, b.uid) && obbDistance(oa, ob) < RULES.minGap - 0.01) {
        add('R05', 'error', `Écart de ${obbDistance(oa, ob).toFixed(1)} m entre ${spec(a.type).name} et ${spec(b.type).name} : risque de coincement (min. ${RULES.minGap} m).`, [a.uid, b.uid]);
      }
    }
  }

  for (const p of mods) {
    const s = spec(p.type);
    const o = obbs.get(p.uid)!;
    // R02 bords
    if (!obbInsideRect(o, site.length / 2, site.width / 2, RULES.edgeMargin)) {
      add('R02', 'error', `${s.name} est à moins de ${RULES.edgeMargin} m du bord / rivage.`, [p.uid]);
    }
    // R03 profondeur
    if (s.depth > site.depth + 1e-6) {
      add('R03', 'error', `${s.name} demande ${s.depth} m de profondeur (site : ${site.depth} m).`, [p.uid]);
    }
    // R04 zones d'eau libre
    for (const z of s.zones) {
      const zo = zoneOBB(p, z);
      const what = z.kind === 'slide' ? 'sortie de glisse' : 'zone de réception';
      if (!obbInsideRect(zo, site.length / 2, site.width / 2, 0)) {
        add('R04', 'error', `La ${what} de ${s.name} sort du plan d'eau.`, [p.uid]);
      }
      for (const q of mods) {
        if (q.uid === p.uid) continue;
        if (obbOverlap(zo, obbs.get(q.uid)!, 0.05)) {
          add('R04', 'error', `${spec(q.type).name} est dans la ${what} de ${s.name}.`, [p.uid, q.uid]);
        }
      }
    }
    // R12 public
    const lim = AUDIENCE_LIMITS[project.audience];
    if (s.role !== 'watch' && (s.H > lim.maxH || s.diff > lim.maxDiff)) {
      add('R12', 'warning', `${s.name} (${s.H} m, difficulté ${s.diff}/5) dépasse le profil « ${lim.label} ».`, [p.uid]);
    }
  }

  // R06 ports proches mais non connectés
  const free = freePorts(graph);
  for (let i = 0; i < free.length; i++) {
    for (let j = i + 1; j < free.length; j++) {
      const a = free[i],
        b = free[j];
      if (a.uid === b.uid) continue;
      const d = Math.hypot(a.x - b.x, a.z - b.z);
      if (d < RULES.misalignTol && a.dx * b.dx + a.dz * b.dz < -0.5) {
        add('R06', 'warning', `Connexion mal alignée entre ${spec(byUid.get(a.uid)!.type).name} et ${spec(byUid.get(b.uid)!.type).name} (${(d * 100).toFixed(0)} cm).`, [a.uid, b.uid]);
      }
    }
  }

  // R07 isolés / R08 accès
  const modular = mods.filter((p) => spec(p.type).ports.length > 0);
  if (modular.length > 1) {
    for (const p of modular) {
      if ((graph.adj.get(p.uid)?.size ?? 0) === 0) add('R07', 'error', `${spec(p.type).name} n'est relié à aucun module.`, [p.uid]);
    }
  }
  for (const comp of components(mods, graph)) {
    const ms = comp.map((u) => byUid.get(u)!);
    if (ms.length < 2) continue;
    const hasAccess = ms.some((p) => spec(p.type).role === 'entry' || spec(p.type).stepUp);
    if (!hasAccess) add('R08', 'error', `Un îlot de ${ms.length} modules n'a aucun accès (Base, Step, StartGate ou module SUS).`, comp);
  }

  // R09 transitions de hauteur
  for (const l of graph.links) {
    const a = spec(byUid.get(l.a)!.type),
      b = spec(byUid.get(l.b)!.type);
    if (PASSABLE.has(a.role) && PASSABLE.has(b.role) && Math.abs(a.H - b.H) >= RULES.maxHeightStep) {
      add('R09', 'warning', `Écart de hauteur de ${Math.abs(a.H - b.H).toFixed(1)} m entre ${a.name} et ${b.name} : insérer une Junction ou une plateforme.`, [l.a, l.b]);
    }
  }

  // R10 enchaînements trop longs (chaînes d'obstacles sans plateforme)
  const isRunNode = (u: string) => PASSABLE.has(spec(byUid.get(u)!.type).role);
  const visited = new Set<string>();
  for (const p of mods) {
    if (visited.has(p.uid) || !isRunNode(p.uid)) continue;
    // composante de la sous-chaîne d'obstacles
    const chain: string[] = [];
    const stack = [p.uid];
    visited.add(p.uid);
    while (stack.length) {
      const u = stack.pop()!;
      chain.push(u);
      for (const v of graph.adj.get(u) ?? []) {
        if (!visited.has(v) && isRunNode(v)) {
          visited.add(v);
          stack.push(v);
        }
      }
    }
    if (chain.length > RULES.maxRun) {
      add('R10', 'warning', `${chain.length} obstacles enchaînés sans plateforme de repos (max ${RULES.maxRun}) : insérer une Junction.`, chain);
    }
    const experts = chain.filter((u) => spec(byUid.get(u)!.type).diff >= 4);
    if (experts.length > RULES.maxExpertRun) {
      // experts reliés entre eux ?
      const linked = experts.filter((u) => experts.some((v) => v !== u && graph.adj.get(u)!.has(v)));
      if (linked.length > RULES.maxExpertRun) add('R10', 'warning', `Trop d'obstacles experts d'affilée (${linked.length}).`, linked);
    }
  }

  // R11 surveillance
  const stats = computeStats(project, graph);
  const watches = mods.filter((p) => spec(p.type).role === 'watch');
  const needed = Math.ceil(stats.capacity / RULES.usersPerWatch);
  if (mods.length > 0 && watches.length < needed) {
    add('R11', 'warning', `${watches.length} poste(s) de surveillance pour ${stats.capacity} baigneurs : ${needed} recommandé(s).`);
  }
  if (watches.length > 0) {
    const far = mods.filter((p) => !watches.some((w) => Math.hypot(w.x - p.x, w.z - p.z) <= RULES.watchRadius));
    if (far.length) add('R11', 'warning', `${far.length} module(s) à plus de ${RULES.watchRadius} m d'un poste de surveillance.`, far.map((p) => p.uid));
  }

  // R13 extrémités libres sur obstacles
  for (const fp of free) {
    const s = spec(byUid.get(fp.uid)!.type);
    if (PASSABLE.has(s.role)) {
      add('R13', 'info', `Extrémité libre sur ${s.name} : terminer par un TakeOff, un Slope ou un module de fin.`, [fp.uid]);
    }
  }

  // R14 boucle / R15 accès
  if (stats.capacity >= RULES.loopAdvisedFrom && stats.loops === 0) {
    add('R14', 'info', `Parc de ${stats.capacity} places sans boucle : une InfinityLoop évite les goulets d'étranglement.`);
  }
  const accessNeeded = Math.ceil(stats.capacity / RULES.usersPerAccess);
  if (mods.length > 0 && stats.accesses < accessNeeded) {
    add('R15', 'warning', `${stats.accesses} accès pour ${stats.capacity} baigneurs : ${accessNeeded} recommandé(s) (Step, Base SUS, modules SUS…).`);
  }

  // dédoublonnage (R04/R05 peuvent apparaître 2 fois)
  const seen = new Set<string>();
  return issues.filter((i) => {
    const k = i.rule + i.message;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function convexHull(points: Vec2[]): Vec2[] {
  const pts = [...points].sort((a, b) => a.x - b.x || a.z - b.z);
  if (pts.length < 3) return pts;
  const cross = (o: Vec2, a: Vec2, b: Vec2) => (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x);
  const lower: Vec2[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Vec2[] = [];
  for (const p of pts.reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/** Périmètre de balisage : enveloppe convexe des modules connectés élargie de 2 m. */
export function buoyPerimeter(mods: Placed[]): Vec2[] {
  const pts: Vec2[] = [];
  for (const p of mods) {
    if (spec(p.type).role === 'standalone') continue;
    for (const c of obbCorners(moduleOBB(p, spec(p.type), 2))) pts.push(c);
  }
  return convexHull(pts);
}

export function computeStats(project: Project, graph: ParkGraph = buildGraph(project.modules)): Stats {
  const mods = project.modules;
  let capacity = 0,
    price = 0,
    anchors = 0,
    area = 0;
  let minX = Infinity,
    maxX = -Infinity,
    minZ = Infinity,
    maxZ = -Infinity;
  for (const p of mods) {
    const s = spec(p.type);
    capacity += s.role === 'watch' ? 0 : s.cap;
    price += s.price;
    anchors += s.anchors;
    area += s.L * s.W;
    for (const c of obbCorners(moduleOBB(p, s))) {
      minX = Math.min(minX, c.x);
      maxX = Math.max(maxX, c.x);
      minZ = Math.min(minZ, c.z);
      maxZ = Math.max(maxZ, c.z);
    }
  }
  const perimeter = buoyPerimeter(mods);
  let perim = 0;
  for (let i = 0; i < perimeter.length; i++) {
    const a = perimeter[i],
      b = perimeter[(i + 1) % perimeter.length];
    perim += Math.hypot(a.x - b.x, a.z - b.z);
  }
  const buoys = perimeter.length > 2 ? Math.ceil(perim / 4.5) : 0;
  const lifejackets = Math.ceil(capacity * 1.2);
  const boats = mods.length ? 1 : 0;
  const accessoriesPrice = anchors * ACCESSORIES.anchor.price + buoys * ACCESSORIES.buoy.price + lifejackets * ACCESSORIES.lifejacket.price + boats * ACCESSORIES.boat.price;
  return {
    modules: mods.length,
    capacity,
    price,
    anchors,
    buoys,
    lifejackets,
    accessoriesPrice,
    total: price + accessoriesPrice,
    area,
    footprint: mods.length ? { w: maxX - minX, d: maxZ - minZ } : { w: 0, d: 0 },
    loops: loopCount(mods, graph),
    islands: components(mods, graph).filter((c) => c.length > 1).length,
    watchPosts: mods.filter((p) => spec(p.type).role === 'watch').length,
    accesses: mods.filter((p) => spec(p.type).role === 'entry' || spec(p.type).stepUp).length,
    perimeter,
  };
}
