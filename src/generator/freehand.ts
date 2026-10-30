import { spec } from '../catalog/modules';
import { angleOf, snapTransform, worldPorts } from '../core/geometry';
import type { Placed, Site, Vec2 } from '../core/types';
import { Builder, type GenParams, type OpenPort } from './generator';
import { hashSeed, makeRng } from './rng';

/*
 * Stylo « main levée » : l'utilisateur trace une ligne sur l'eau, les modules viennent se
 * poser dessus. On réutilise le Builder du générateur, donc toutes les règles de pose
 * s'appliquent (emprise, bords, zones de glisse, anti-coincement, enchaînements, hauteurs) :
 * à chaque pas, parmi les modules autorisés par la grammaire, on retient celui dont la
 * sortie colle le mieux au tracé (écart, alignement avec la tangente, avancée).
 */

interface Proj {
  s: number;
  dist: number;
  tx: number;
  tz: number;
}

/** Rééchantillonne le tracé tous les `step` m et le lisse pour gommer le tremblement de la main. */
export function resampleStroke(points: Vec2[], step = 1): Vec2[] {
  if (points.length < 2) return points;
  const out: Vec2[] = [points[0]];
  let carry = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    let d = step - carry;
    while (d <= len) {
      const t = d / len;
      out.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
      d += step;
    }
    carry = len - (d - step);
  }
  const last = points[points.length - 1];
  if (Math.hypot(last.x - out[out.length - 1].x, last.z - out[out.length - 1].z) > step * 0.3) out.push(last);
  // moyenne glissante (les extrémités restent fixes)
  const k = 3;
  return out.map((p, i) => {
    if (i < k || i >= out.length - k) return p;
    let x = 0,
      z = 0;
    for (let j = -k; j <= k; j++) {
      x += out[i + j].x;
      z += out[i + j].z;
    }
    return { x: x / (2 * k + 1), z: z / (2 * k + 1) };
  });
}

class Path {
  readonly cum: number[] = [0];
  readonly total: number;
  constructor(readonly pts: Vec2[]) {
    for (let i = 1; i < pts.length; i++) this.cum.push(this.cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
    this.total = this.cum[this.cum.length - 1];
  }

  project(p: Vec2): Proj {
    let best: Proj = { s: 0, dist: Infinity, tx: 1, tz: 0 };
    for (let i = 1; i < this.pts.length; i++) {
      const a = this.pts[i - 1],
        b = this.pts[i];
      const vx = b.x - a.x,
        vz = b.z - a.z;
      const len = Math.hypot(vx, vz) || 1e-6;
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.z - a.z) * vz) / (len * len)));
      const d = Math.hypot(a.x + vx * t - p.x, a.z + vz * t - p.z);
      if (d < best.dist) best = { s: this.cum[i - 1] + t * len, dist: d, tx: vx / len, tz: vz / len };
    }
    return best;
  }

  tangentAt(i: number): Vec2 {
    const a = this.pts[Math.max(0, i - 1)],
      b = this.pts[Math.min(this.pts.length - 1, i + 2)];
    const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    return { x: (b.x - a.x) / len, z: (b.z - a.z) / len };
  }
}

export interface StrokeResult {
  /** Nouveaux modules uniquement (uids provisoires). */
  modules: Placed[];
  /** Longueur du tracé (m). */
  length: number;
  /** Part du tracé couverte (0–1). */
  coverage: number;
  /** Le tracé prolonge un parc existant. */
  extended: boolean;
}

function attemptStroke(site: Site, existing: Placed[], path: Path, p: GenParams, seed: number): { b: Builder; progress: number; deviation: number; extended: boolean } {
  const rng = makeRng(seed);
  const b = new Builder(site, p, rng);
  b.mods = existing.map((m) => ({ ...m }));
  b.rebuild();
  const start = path.pts[0];
  const t0 = path.tangentAt(0);

  // 1) départ : port libre proche du début du tracé, sinon un accès posé sur le tracé
  let cur: OpenPort | null = null;
  let extended = false;
  const near = b.free
    .map((f) => ({ f, d: Math.hypot(f.x - start.x, f.z - start.z) }))
    .filter((c) => c.d < 4 && spec(b.mods.find((m) => m.uid === c.f.uid)!.type).role !== 'terminal')
    .sort((a, c) => a.d - c.d)[0];
  if (near) {
    cur = near.f;
    extended = true;
  } else {
    const prefs = p.audience === 'kids' ? ['base-sus', 'step', 'base'] : ['base-sus', 'step6', 'startgate-sus', 'base', 'step'];
    for (const type of prefs) {
      const s = spec(type);
      const out = s.ports.find((pp) => pp.id === 'b')!;
      const rot = angleOf(t0.x, t0.z) - angleOf(out.dx, out.dz);
      for (const shift of [0, 1.5, 3, -1.5]) {
        const c = { x: start.x + t0.x * (s.L / 2 + shift), z: start.z + t0.z * (s.L / 2 + shift) };
        const tf = { x: c.x, z: c.z, rot };
        if (!b.fits(s, tf, null)) continue;
        const pl = b.place(type, tf);
        cur = b.portsOf(pl.uid).find((pp) => pp.portId === 'b') ?? null;
        break;
      }
      if (cur) break;
    }
  }
  if (!cur) return { b, progress: 0, deviation: 0, extended };

  // 2) on suit le tracé
  let prev = spec(b.mods.find((m) => m.uid === cur!.uid)!.type);
  let run = prev.role === 'obstacle' || prev.role === 'tower' ? 1 : 0;
  let expert = prev.diff >= 4 ? 1 : 0;
  let deviation = 0;
  let progress = path.project(cur).s;
  // pile pour le retour arrière : état avant chaque pose + types déjà essayés à ce pas
  const stack: { cur: OpenPort; prev: typeof prev; run: number; expert: number; progress: number; deviation: number; banned: Set<string> }[] = [];
  let banned = new Set<string>();
  let backtracks = 0;
  for (let iter = 0; iter < 150; iter++) {
    progress = Math.max(progress, path.project(cur).s);
    if (path.total - progress < 3.5) {
      b.tryTerminal(cur);
      progress = path.total;
      break;
    }
    const forceConnector = run >= b.maxRun || (prev.H >= 2.4 && prev.role !== 'connector');
    const pool = forceConnector
      ? b.connectorCandidates(prev, 99)
      : [...b.obstacleCandidates(prev, { expert }), ...b.connectorCandidates(prev, 99).map((c) => ({ ...c, w: c.w * (run === 0 ? 0.15 : 0.5) }))];
    let best: { type: string; tf: { x: number; z: number; rot: number }; out: { x: number; z: number }; score: number; dev: number } | null = null;
    for (const { item, w } of pool.filter((c) => !banned.has(c.item))) {
      const s = spec(item);
      for (const port of s.ports) {
        const tf = snapTransform(port, cur);
        const outs = worldPorts({ uid: '_', type: item, ...tf }, s).filter((o) => o.port.id !== port.id);
        let local: { out: { x: number; z: number }; score: number; dev: number } | null = null;
        for (const o of outs) {
          const pr = path.project(o);
          const adv = pr.s - progress;
          const align = o.dx * pr.tx + o.dz * pr.tz;
          if (adv < 0.8 || align < 0.25) continue;
          const mid = path.project({ x: tf.x, z: tf.z }).dist;
          const over = Math.max(0, pr.s - path.total);
          const score = pr.dist * 1.6 + mid * 0.6 + (1 - align) * 5 + over * 1.5 - Math.min(adv, 6) * 0.25 - Math.log(w + 1e-3) * 0.6 + rng.next() * 0.4;
          if (!local || score < local.score) local = { out: o, score, dev: pr.dist };
        }
        if (!local || (best && local.score >= best.score)) continue;
        if (!b.fits(s, tf, cur.uid)) continue;
        best = { type: item, tf, ...local };
      }
    }
    if (!best || best.dev > 6) {
      // impasse : on retire le dernier module et on essaie autre chose à sa place
      if (stack.length && backtracks < 6) {
        backtracks++;
        const st = stack.pop()!;
        b.truncate(b.mods.length - 1);
        ({ cur, prev, run, expert, progress, deviation } = st);
        banned = st.banned;
        continue;
      }
      b.tryTerminal(cur);
      break;
    }
    banned.add(best.type);
    stack.push({ cur, prev, run, expert, progress, deviation, banned });
    banned = new Set();
    const pl = b.place(best.type, best.tf);
    deviation += best.dev;
    const s = spec(best.type);
    if (s.role === 'connector') {
      run = 0;
      expert = 0;
    } else {
      run++;
      expert = s.diff >= 4 ? expert + 1 : 0;
    }
    prev = s;
    const target = best.out;
    const next = b.portsOf(pl.uid).find((pp) => Math.hypot(pp.x - target.x, pp.z - target.z) < 0.05);
    if (!next) break; // la sortie s'est refermée sur un autre module (boucle)
    cur = next;
  }

  // 3) surveillance si la capacité l'exige
  b.placeWatch();
  return { b, progress, deviation, extended };
}

export function followStroke(site: Site, existing: Placed[], stroke: Vec2[], p: GenParams, attempts = 6): StrokeResult | null {
  const pts = resampleStroke(stroke, 1);
  if (pts.length < 3) return null;
  const path = new Path(pts);
  if (path.total < 4) return null;
  const base = hashSeed(p.seed);
  let best: { r: ReturnType<typeof attemptStroke>; score: number } | null = null;
  for (let k = 0; k < attempts; k++) {
    const r = attemptStroke(site, existing, path, p, base + k * 104729);
    const added = r.b.mods.length - existing.length;
    if (!added) continue;
    const variety = new Set(r.b.mods.slice(existing.length).map((m) => m.type)).size;
    const score = (1 - r.progress / path.total) * 100 + (r.deviation / added) * 6 - variety * 0.8;
    if (!best || score < best.score) best = { r, score };
  }
  if (!best) return null;
  return {
    modules: best.r.b.mods.slice(existing.length),
    length: path.total,
    coverage: Math.min(1, best.r.progress / path.total),
    extended: best.r.extended,
  };
}

