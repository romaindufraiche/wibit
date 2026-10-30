import { MODULES, spec } from '../catalog/modules';
import { moduleOBB, obbDistance, obbInsideRect, obbOverlap, pointInOBB, snapTransform, worldPorts, zoneOBB, type OBB } from '../core/geometry';
import { buildGraph } from '../core/graph';
import type { Audience, ModuleSpec, Placed, Project, Site } from '../core/types';
import { AUDIENCE_LIMITS, RULES, computeStats, validate } from '../rules/validate';
import { hashSeed, makeRng, type Rng } from './rng';

/*
 * Générateur de parc « aléatoire mais cohérent ».
 *
 * Principe : on fait pousser le parc comme un graphe à partir d'un accès sur le rivage,
 * module par module, en suivant une grammaire de parcours :
 *
 *   Parc     := Accès [Boucle] Parcours Branches* Surveillance [Autonomes]
 *   Parcours := (Obstacle{1..maxRun} Connecteur)* Fin
 *   Branche  := Connecteur → Obstacle{0..3} Fin
 *
 * Chaque pose est validée immédiatement (emprise, bords, profondeur, zones de glisse/saut,
 * écart anti-coincement, transitions de hauteur, enchaînements experts). En cas d'impasse
 * on revient en arrière. On génère plusieurs variantes et on garde la meilleure selon le
 * moteur de règles (docs/REGLES.md).
 */

export interface GenParams {
  audience: Audience;
  /** Capacité visée (baigneurs simultanés). */
  capacity: number;
  /** Intensité 1 (douce) à 5 (extrême). */
  intensity: number;
  /** Intégrer une boucle InfinityLoop. */
  loop: boolean;
  /** Intégrer un grand toboggan (Wave / Mountain / ActionLoop…) si la profondeur le permet. */
  bigSlide: boolean;
  /** Ajouter des modules autonomes (Volley, Bouncer…) autour du parc. */
  standalones: boolean;
  seed: string;
}

export const DEFAULT_PARAMS: GenParams = {
  audience: 'mixed',
  capacity: 80,
  intensity: 3,
  loop: true,
  bigSlide: true,
  standalones: false,
  seed: 'lagon-2027',
};

export interface GenResult {
  modules: Placed[];
  attempts: number;
  score: number;
  log: string[];
}

export interface OpenPort {
  uid: string;
  portId: string;
  x: number;
  z: number;
  dx: number;
  dz: number;
}

const BIG_SLIDES = ['wave', 'mountain', 'actionloop', 'springboard'];

export class Builder {
  mods: Placed[] = [];
  obbs = new Map<string, OBB>();
  zones: { owner: string; o: OBB }[] = [];
  adj = new Map<string, Set<string>>();
  free: OpenPort[] = [];
  branchQueue: OpenPort[] = [];
  used = new Map<string, number>();
  cap = 0;
  bigSlidePlaced = false;
  private n = 0;
  readonly allowed: ModuleSpec[];
  readonly targetDiff: number;
  readonly maxRun: number;
  readonly log: string[] = [];

  constructor(
    readonly site: Site,
    readonly p: GenParams,
    readonly rng: Rng,
  ) {
    const lim = AUDIENCE_LIMITS[p.audience];
    this.allowed = MODULES.filter((s) => s.depth <= site.depth && (s.role === 'watch' || (s.H <= lim.maxH && s.diff <= lim.maxDiff)));
    this.targetDiff = Math.min(lim.maxDiff, 1 + (p.intensity - 1) * 0.9);
    this.maxRun = p.intensity >= 4 ? 4 : 3;
  }

  // ------------------------------------------------------------ état

  private uid() {
    return `g${++this.n}`;
  }

  /** Recalcule adjacence et ports libres (après retour arrière). */
  rebuild() {
    const g = buildGraph(this.mods);
    this.adj = g.adj;
    this.free = g.ports
      .filter((wp) => !g.usedPorts.get(wp.uid)!.has(wp.port.id))
      .map((wp) => ({ uid: wp.uid, portId: wp.port.id, x: wp.x, z: wp.z, dx: wp.dx, dz: wp.dz }));
    this.obbs = new Map(this.mods.map((m) => [m.uid, moduleOBB(m, spec(m.type))]));
    this.zones = this.mods.flatMap((m) => spec(m.type).zones.map((z) => ({ owner: m.uid, o: zoneOBB(m, z) })));
    this.used = new Map();
    this.cap = 0;
    this.bigSlidePlaced = false;
    for (const m of this.mods) {
      this.used.set(m.type, (this.used.get(m.type) ?? 0) + 1);
      if (spec(m.type).role !== 'watch') this.cap += spec(m.type).cap;
      if (BIG_SLIDES.slice(0, 3).includes(m.type)) this.bigSlidePlaced = true;
    }
    const alive = new Set(this.mods.map((m) => m.uid));
    this.branchQueue = this.branchQueue.filter((b) => alive.has(b.uid) && this.isFree(b));
  }

  truncate(n: number) {
    if (this.mods.length === n) return;
    this.mods.length = n;
    this.rebuild();
  }

  isFree(op: OpenPort) {
    return this.free.some((f) => f.uid === op.uid && f.portId === op.portId);
  }

  private coincident(a: { x: number; z: number; dx: number; dz: number }, b: OpenPort) {
    return Math.hypot(a.x - b.x, a.z - b.z) < 0.15 && a.dx * b.dx + a.dz * b.dz < -0.95;
  }

  /** Le module candidat (transform tf) peut-il être posé ? */
  fits(s: ModuleSpec, tf: { x: number; z: number; rot: number }, parent: string | null): boolean {
    const o = moduleOBB(tf, s);
    const hx = this.site.length / 2,
      hz = this.site.width / 2;
    if (!obbInsideRect(o, hx, hz, RULES.edgeMargin)) return false;
    // modules auxquels le candidat se connecte (parent + fermetures de boucle)
    const linked = new Set<string>();
    if (parent) linked.add(parent);
    const wps = worldPorts({ uid: '_', type: s.id, ...tf }, s);
    for (const wp of wps) for (const f of this.free) if (this.coincident(wp, f)) linked.add(f.uid);
    const nearSet = new Set(linked);
    for (const l of linked) for (const n of this.adj.get(l) ?? []) nearSet.add(n);
    const reach = Math.hypot(o.hx, o.hz) + RULES.minGap;
    for (const m of this.mods) {
      const om = this.obbs.get(m.uid)!;
      if (Math.hypot(om.cx - o.cx, om.cz - o.cz) > reach + Math.hypot(om.hx, om.hz)) continue;
      if (obbOverlap(o, om, 0.05)) return false;
      if (!nearSet.has(m.uid) && obbDistance(o, om) < RULES.minGap) return false;
    }
    for (const z of s.zones) {
      const zo = zoneOBB(tf, z);
      if (!obbInsideRect(zo, hx, hz, 0)) return false;
      for (const m of this.mods) if (obbOverlap(zo, this.obbs.get(m.uid)!, 0.05)) return false;
    }
    for (const z of this.zones) if (obbOverlap(o, z.o, 0.05)) return false;
    return true;
  }

  place(type: string, tf: { x: number; z: number; rot: number }): Placed {
    const s = spec(type);
    const p: Placed = { uid: this.uid(), type, x: tf.x, z: tf.z, rot: tf.rot };
    this.mods.push(p);
    this.obbs.set(p.uid, moduleOBB(p, s));
    for (const z of s.zones) this.zones.push({ owner: p.uid, o: zoneOBB(p, z) });
    this.adj.set(p.uid, new Set());
    for (const wp of worldPorts(p, s)) {
      const idx = this.free.findIndex((f) => this.coincident(wp, f));
      if (idx >= 0) {
        const f = this.free[idx];
        this.free.splice(idx, 1);
        this.adj.get(p.uid)!.add(f.uid);
        this.adj.get(f.uid)!.add(p.uid);
      } else {
        this.free.push({ uid: p.uid, portId: wp.port.id, x: wp.x, z: wp.z, dx: wp.dx, dz: wp.dz });
      }
    }
    this.used.set(type, (this.used.get(type) ?? 0) + 1);
    if (s.role !== 'watch') this.cap += s.cap;
    if (BIG_SLIDES.slice(0, 3).includes(type)) this.bigSlidePlaced = true;
    return p;
  }

  /** Essaie d'accrocher `type` au port ouvert `op`, éventuellement en imposant la direction de sortie. */
  attach(type: string, op: OpenPort, wantDir?: { x: number; z: number }): Placed | null {
    if (!this.isFree(op)) return null;
    const s = spec(type);
    const inPorts = this.rng.shuffle([...s.ports]);
    for (const port of inPorts) {
      const tf = snapTransform(port, op);
      if (wantDir) {
        const outs = worldPorts({ uid: '_', type, ...tf }, s).filter((w) => w.port.id !== port.id);
        if (!outs.some((w) => w.dx * wantDir.x + w.dz * wantDir.z > 0.95)) continue;
      }
      if (this.fits(s, tf, op.uid)) return this.place(type, tf);
    }
    return null;
  }

  portsOf(uid: string): OpenPort[] {
    return this.free.filter((f) => f.uid === uid);
  }

  /** Distance d'eau libre devant un port (m). */
  clearance(op: { x: number; z: number; dx: number; dz: number }, max = 40): number {
    const hx = this.site.length / 2 - RULES.edgeMargin,
      hz = this.site.width / 2 - RULES.edgeMargin;
    for (let d = 0.5; d <= max; d += 0.5) {
      const x = op.x + op.dx * d,
        z = op.z + op.dz * d;
      if (Math.abs(x) > hx || Math.abs(z) > hz) return d;
      for (const o of this.obbs.values()) {
        if (pointInOBB({ x, z }, { ...o, hx: o.hx + 1, hz: o.hz + 1 }) && d > 1.2) return d;
      }
    }
    return max;
  }

  // ------------------------------------------------------------ choix pondérés

  private novelty(type: string, prev?: string) {
    const n = this.used.get(type) ?? 0;
    return (type === prev ? 0.08 : 1) / (1 + 1.5 * n);
  }

  obstacleCandidates(prev: ModuleSpec | null, run: { expert: number }): { item: string; w: number }[] {
    const out: { item: string; w: number }[] = [];
    for (const s of this.allowed) {
      if (s.role !== 'obstacle' && s.role !== 'tower') continue;
      if (s.ports.length !== 2) continue;
      if (prev && (prev.role === 'obstacle' || prev.role === 'tower') && Math.abs(prev.H - s.H) >= RULES.maxHeightStep) continue;
      if (s.diff >= 4 && run.expert >= RULES.maxExpertRun) continue;
      let w = Math.exp(-Math.abs(s.diff - this.targetDiff) * 0.9) * this.novelty(s.id, prev?.id);
      if (s.role === 'tower') w *= 0.7;
      if (s.category === 'matchtrack') w *= this.p.audience === 'sport' ? 1.6 : 0.5;
      out.push({ item: s.id, w });
    }
    return out;
  }

  connectorCandidates(prev: ModuleSpec | null, clearance: number): { item: string; w: number }[] {
    const base: Record<string, number> = {
      junction: 3,
      't-connect-sus': 1.6,
      'y-connect': 0.6,
      sidekick: 1,
      bend: 1,
      curve: 1.2,
      'turn-sus': 1,
      cornerswing: 0.8,
      'parcour-l-connect': 0.7,
      'level-r-connect': 0.6,
      doublecurve: 0.5,
      'trampoline-4': 0.6,
      roundabout: 0.7,
      swingaround: 0.7,
      'comeback-sus': 0.4,
    };
    const out: { item: string; w: number }[] = [];
    for (const s of this.allowed) {
      if (s.role !== 'connector' || base[s.id] === undefined) continue;
      let w = base[s.id] * this.novelty(s.id, prev?.id);
      const isTurn = s.ports.length === 2 && s.ports[0].dx * s.ports[1].dx + s.ports[0].dz * s.ports[1].dz > -0.5;
      if (clearance < 12 && (isTurn || s.ports.length > 2)) w *= 4;
      if (s.id === 'junction' || s.id === 't-connect-sus') w = Math.max(w, 0.8);
      if (prev && prev.H >= 2.4 && s.H >= 2.4) continue;
      if (s.diff > this.targetDiff + 1.5) w *= 0.3;
      out.push({ item: s.id, w });
    }
    return out;
  }

  terminalCandidates(): { item: string; w: number }[] {
    const out: { item: string; w: number }[] = [];
    for (const s of this.allowed) {
      if (s.role !== 'terminal') continue;
      let w = { slope: 3, takeoff: 1.2, actionloop: 1, springboard: 0.8, endrise: 0.6, wave: 0.6, mountain: 0.6 }[s.id] ?? 0.5;
      if (this.p.bigSlide && !this.bigSlidePlaced && BIG_SLIDES.slice(0, 3).includes(s.id)) w *= 25;
      if (!this.p.bigSlide && (s.id === 'wave' || s.id === 'mountain')) w = 0;
      if (s.id === 'endrise' && !this.mods.some((m) => spec(m.type).category === 'matchtrack')) w *= 0.2;
      w *= this.novelty(s.id) + 0.3;
      out.push({ item: s.id, w });
    }
    return out;
  }

  // ------------------------------------------------------------ construction

  placeEntry(): OpenPort | null {
    const big = this.p.capacity >= 110;
    const prefs =
      this.p.audience === 'kids'
        ? ['base-sus', 'step6', 'base']
        : this.p.audience === 'sport' && this.allowed.some((s) => s.id === 'launchgate')
          ? ['startgate-sus', 'launchgate', 'step6']
          : big
            ? ['startgate-sus', 'step6', 'base-sus']
            : ['base-sus', 'step6', 'base', 'startgate-sus'];
    const hx = this.site.length / 2 - RULES.edgeMargin;
    for (let attempt = 0; attempt < 12; attempt++) {
      const type = prefs[Math.min(prefs.length - 1, Math.floor(attempt / 4))];
      const s = spec(type);
      const out = s.ports.find((pp) => pp.id === 'b')!;
      // port de sortie orienté vers le large (−z)
      const rot = Math.atan2(1, 0) - Math.atan2(-out.dz, out.dx);
      const span = Math.max(0, hx - s.W / 2);
      const x = (this.rng.next() * 2 - 1) * span * 0.6;
      const z = this.site.width / 2 - RULES.edgeMargin - s.L / 2;
      const tf = { x, z, rot };
      if (!this.fits(s, tf, null)) continue;
      const p = this.place(type, tf);
      const ports = this.portsOf(p.uid);
      // si Base (2 ports) : l'extrémité côté plage reste un accès libre
      return ports.sort((a, b) => a.dz - b.dz)[0];
    }
    return null;
  }

  /** Choisit la suite parmi les ports libres d'un module ; les autres vont en file de branches. */
  private continueFrom(uid: string, inbound?: OpenPort): OpenPort | null {
    const ports = this.portsOf(uid);
    if (!ports.length) return null;
    const scored = ports.map((pp) => {
      // tout droit = même direction que le port d'arrivée : léger bonus
      const straight = inbound ? pp.dx * inbound.dx + pp.dz * inbound.dz : 0;
      return { pp, s: this.clearance(pp) + this.rng.next() * 4 + (straight > 0.9 ? 1.5 : 0) };
    });
    scored.sort((a, b) => b.s - a.s);
    for (const o of scored.slice(1)) this.branchQueue.push(o.pp);
    return scored[0].pp;
  }

  /** Fait pousser un parcours depuis `start`. Retourne le nombre de modules posés. */
  growTrail(start: OpenPort, maxModules: number, capGoal: number): number {
    let cur: OpenPort | null = start;
    let prev: ModuleSpec | null = spec(this.mods.find((m) => m.uid === start.uid)!.type);
    let run = prev.role === 'obstacle' || prev.role === 'tower' ? 1 : 0;
    let expert = prev.diff >= 4 ? 1 : 0;
    let count = 0;
    let backtracks = 0;
    const startLen = this.mods.length;
    const history: OpenPort[] = [];
    while (cur) {
      const mustEnd = count >= maxModules || this.cap >= capGoal;
      if (mustEnd) {
        this.tryTerminal(cur);
        break;
      }
      const clr = this.clearance(cur);
      let cands: string[];
      if (run >= this.maxRun || (prev && prev.H >= 2.4 && prev.role !== 'connector') || clr < 4) {
        cands = this.rng.weightedOrder(this.connectorCandidates(prev, clr));
      } else {
        const obs = this.obstacleCandidates(prev, { expert });
        const con = this.connectorCandidates(prev, clr).map((c) => ({ ...c, w: c.w * (run === 0 ? 0.05 : 0.25 * run) }));
        cands = this.rng.weightedOrder([...obs, ...con]);
      }
      let placed: Placed | null = null;
      for (const t of cands.slice(0, 14)) {
        placed = this.attach(t, cur);
        if (placed) break;
      }
      if (!placed) {
        if (this.tryTerminal(cur)) break;
        // retour arrière : on retire le dernier module de ce parcours
        if (backtracks < 2 && this.mods.length > startLen && history.length) {
          backtracks++;
          this.truncate(this.mods.length - 1);
          cur = history.pop()!;
          prev = spec(this.mods.find((m) => m.uid === cur!.uid)!.type);
          run = Math.max(0, run - 1);
          count--;
          continue;
        }
        break;
      }
      count++;
      history.push(cur);
      const s = spec(placed.type);
      if (s.role === 'connector') {
        run = 0;
        expert = 0;
      } else {
        run++;
        expert = s.diff >= 4 ? expert + 1 : 0;
      }
      prev = s;
      cur = this.continueFrom(placed.uid, cur);
    }
    return count;
  }

  tryTerminal(op: OpenPort): boolean {
    const owner = spec(this.mods.find((m) => m.uid === op.uid)!.type);
    for (const t of this.rng.weightedOrder(this.terminalCandidates())) {
      const s = spec(t);
      if ((owner.role === 'obstacle' || owner.role === 'tower') && Math.abs(owner.H - s.H) >= RULES.maxHeightStep) continue;
      if (this.attach(t, op)) return true;
    }
    return false;
  }

  /**
   * Boucle InfinityLoop rectangulaire accrochée par un T-Connect :
   * T → A → virage → M → virage → Bas (= A + 3 + B, avec une Junction) → virage → M → virage → B → T.
   * Les longueurs opposées sont égales, la boucle se referme donc exactement.
   */
  tryRing(op: OpenPort): OpenPort | null {
    const corners = this.allowed.filter((s) => s.loopCorner && s.diff <= this.targetDiff + 1).map((s) => s.id);
    if (!corners.length) return null;
    const straight = this.allowed.filter((s) => (s.role === 'obstacle' || (s.role === 'tower' && s.H < 2.6)) && s.ports.length === 2 && (s.L === 3 || s.L === 6) && s.W <= 3.2 && s.ports[0].w <= 2);
    if (!straight.length) return null;
    const combos: { a: number; b: number; m: number }[] = [];
    for (const a of [0, 3, 6]) for (const b of [0, 3]) for (const m of [3, 6, 9]) combos.push({ a, b, m });
    this.rng.shuffle(combos);
    const mark = this.mods.length;
    const fill = (len: number, withJunction: boolean): string[] => {
      const seq: string[] = [];
      let rest = len;
      let lastH = -1;
      if (withJunction) {
        seq.push('junction');
        rest -= 3;
      }
      while (rest > 0) {
        const opts = straight.filter((s) => s.L <= rest && (lastH < 0 || Math.abs(s.H - lastH) < RULES.maxHeightStep));
        if (!opts.length) return [];
        const order = this.rng.weightedOrder(opts.map((s) => ({ item: s, w: Math.exp(-Math.abs(s.diff - this.targetDiff)) * this.novelty(s.id) })));
        const s = order[0];
        seq.push(s.id);
        lastH = s.H;
        rest -= s.L;
        this.used.set(s.id, (this.used.get(s.id) ?? 0) + 0.5);
      }
      if (withJunction) {
        // la Junction au milieu du côté opposé
        seq.shift();
        seq.splice(Math.floor(seq.length / 2), 0, 'junction');
      }
      return seq;
    };
    for (const c of combos.slice(0, 10)) {
      this.truncate(mark);
      const tee = this.attach('t-connect-sus', op);
      if (!tee) return null;
      const tPorts = this.portsOf(tee.uid);
      const stemDir = { x: op.dx, z: op.dz }; // sens de progression : la boucle se développe au-delà du T
      const [pd, pc] = this.rng.shuffle(tPorts);
      if (!pd || !pc) continue;
      const h0 = { x: pd.dx, z: pd.dz };
      const headings = [stemDir, { x: -h0.x, z: -h0.z }, { x: -stemDir.x, z: -stemDir.z }, h0];
      const sides = [fill(c.a, false), fill(c.m, false), fill(c.a + 3 + c.b, true), fill(c.m, false), fill(c.b, false)];
      if (sides.some((sq, i) => sq.length === 0 && [c.a, c.m, 1, c.m, c.b][i] > 0)) continue;
      const corner = this.rng.pick(corners);
      let cur: OpenPort | null = pd;
      let ok = true;
      let junction: Placed | null = null;
      for (let i = 0; i < 5 && ok; i++) {
        for (const [k, t] of sides[i].entries()) {
          const pl = this.attach(t, cur!);
          if (!pl) {
            ok = false;
            break;
          }
          if (t === 'junction') junction = pl;
          const prevPos: OpenPort = cur!;
          cur = this.portsOf(pl.uid).find((pp) => pp.dx * prevPos.dx + pp.dz * prevPos.dz > 0.95) ?? null;
          const lastOfRing = i === 4 && k === sides[i].length - 1;
          if (!cur && !lastOfRing) ok = false;
          if (!ok) break;
        }
        if (!ok || i === 4) break;
        const pl = this.attach(corner, cur!, headings[i]);
        if (!pl) {
          ok = false;
          break;
        }
        const h = headings[i];
        cur = this.portsOf(pl.uid).find((pp) => pp.dx * h.x + pp.dz * h.z > 0.95) ?? null;
        if (!cur && i < 3) ok = false;
      }
      // fermeture : plus aucun port libre sur le T
      if (ok && this.portsOf(tee.uid).length === 0) {
        this.log.push(`Boucle InfinityLoop ${c.a + 3 + c.b} × ${c.m} m (+ virages ${spec(corner).name}).`);
        if (junction) {
          const outs = this.portsOf(junction.uid);
          // port extérieur = le plus éloigné du T
          outs.sort((u, v) => Math.hypot(v.x - tee.x, v.z - tee.z) - Math.hypot(u.x - tee.x, u.z - tee.z));
          for (const o of outs.slice(1)) this.branchQueue.push(o);
          return outs[0] ?? null;
        }
        return null;
      }
    }
    this.truncate(mark);
    return null;
  }

  /** Postes de surveillance : nombre selon la capacité, placés pour couvrir les modules les plus éloignés. */
  placeWatch(forCapacity = this.cap) {
    const needed = Math.ceil(forCapacity / RULES.usersPerWatch);
    const types = this.rng.shuffle(this.allowed.filter((s) => s.role === 'watch' && s.ports.length > 0 && s.id !== 'watcharound').map((s) => s.id));
    let have = this.mods.filter((m) => spec(m.type).role === 'watch').length;
    for (let k = 0; k < needed + 2 && (have < needed || this.uncovered().length > 0); k++) {
      const watches = this.mods.filter((m) => spec(m.type).role === 'watch');
      const target = this.uncovered()[0];
      const candidates = this.free
        .filter((f) => spec(this.mods.find((m) => m.uid === f.uid)!.type).role !== 'terminal')
        .map((f) => ({
          f,
          s: target ? -Math.hypot(f.x - target.x, f.z - target.z) : Math.min(...watches.map((w) => Math.hypot(w.x - f.x, w.z - f.z)), 999),
        }))
        .sort((a, b) => b.s - a.s);
      let done = false;
      for (const { f } of candidates.slice(0, 8)) {
        for (const t of types) {
          if (this.attach(t, f)) {
            done = true;
            have++;
            break;
          }
        }
        if (done) break;
      }
      if (!done) break;
    }
  }

  uncovered(): Placed[] {
    const watches = this.mods.filter((m) => spec(m.type).role === 'watch');
    if (!watches.length) return this.mods.slice(0, 1);
    return this.mods.filter((m) => !watches.some((w) => Math.hypot(w.x - m.x, w.z - m.z) <= RULES.watchRadius));
  }

  /** Accès supplémentaires (Step) sur les connecteurs pour fluidifier les entrées. */
  placeAccesses(forCapacity = this.cap) {
    const needed = Math.ceil(forCapacity / RULES.usersPerAccess);
    let have = this.mods.filter((m) => spec(m.type).role === 'entry' || spec(m.type).stepUp).length;
    const ports = this.rng.shuffle(this.free.filter((f) => spec(this.mods.find((m) => m.uid === f.uid)!.type).role === 'connector'));
    for (const f of ports) {
      if (have >= needed) break;
      if (this.attach('step', f)) have++;
    }
  }

  closeDeadEnds() {
    for (const f of [...this.free]) {
      const s = spec(this.mods.find((m) => m.uid === f.uid)!.type);
      if ((s.role === 'obstacle' || s.role === 'tower') && this.isFree(f)) this.tryTerminal(f);
    }
  }

  placeStandalones() {
    const pool = this.allowed.filter((s) => s.role === 'standalone' && s.id !== 'pologoal' && s.id !== 'triplescore');
    const n = this.rng.int(1, 3);
    for (let k = 0; k < n; k++) {
      const s = this.rng.pick(pool);
      for (let t = 0; t < 120; t++) {
        const tf = {
          x: (this.rng.next() - 0.5) * (this.site.length - 2 * RULES.edgeMargin - s.L),
          z: (this.rng.next() - 0.5) * (this.site.width - 2 * RULES.edgeMargin - s.L),
          rot: (this.rng.int(0, 3) * Math.PI) / 2,
        };
        const o = moduleOBB(tf, s, 2);
        if ([...this.obbs.values()].some((om) => obbOverlap(o, om, 0))) continue;
        if (this.fits(s, tf, null)) {
          this.place(s.id, tf);
          break;
        }
      }
    }
  }
}

function attempt(site: Site, p: GenParams, rng: Rng): Builder {
  const b = new Builder(site, p, rng);
  const entry = b.placeEntry();
  if (!entry) return b;
  let cur: OpenPort | null = entry;

  // 1 à 2 obstacles d'échauffement après l'accès
  if (p.loop && b.cap < p.capacity) {
    const warm = rng.int(0, 1);
    if (warm) {
      for (const t of rng.weightedOrder(b.obstacleCandidates(spec(b.mods[0].type), { expert: 0 }).map((c) => ({ ...c, w: c.w * (spec(c.item).diff <= 2 ? 3 : 0.3) })))) {
        const pl = b.attach(t, cur);
        if (pl) {
          cur = b.portsOf(pl.uid)[0] ?? null;
          break;
        }
      }
    }
    if (cur) {
      const after = b.tryRing(cur);
      if (after) cur = after;
      else if (!b.isFree(cur)) cur = null;
    }
  }

  // parcours principal (~65 % de la capacité)
  if (cur) b.growTrail(cur, 30, p.capacity * 0.65);
  // surveillance réservée tôt, avant que les branches n'occupent toutes les connexions
  b.placeWatch(p.capacity);
  b.placeAccesses(p.capacity);

  // branches
  let guard = 0;
  while (b.cap < p.capacity * 0.95 && guard++ < 40) {
    b.branchQueue = b.branchQueue.filter((q) => b.isFree(q));
    let op = b.branchQueue.length ? b.branchQueue.splice(rng.int(0, b.branchQueue.length - 1), 1)[0] : null;
    if (!op) {
      // repartir depuis n'importe quelle connexion libre d'un connecteur
      const pool = b.free.filter((f) => spec(b.mods.find((m) => m.uid === f.uid)!.type).role === 'connector' && b.clearance(f) > 6);
      if (!pool.length) break;
      op = rng.pick(pool);
    }
    if (b.clearance(op) < 4) continue;
    b.growTrail(op, rng.int(1, 4), p.capacity);
  }

  b.closeDeadEnds();
  b.placeAccesses();
  b.placeWatch();
  if (p.standalones) b.placeStandalones();
  return b;
}

export function scorePark(project: Project, target: GenParams): number {
  const graph = buildGraph(project.modules);
  const issues = validate(project, graph);
  const stats = computeStats(project, graph);
  const errors = issues.filter((i) => i.level === 'error').length;
  const warnings = issues.filter((i) => i.level === 'warning').length;
  const variety = new Set(project.modules.map((m) => m.type)).size;
  let s = errors * 1000 + warnings * 25;
  s += (Math.abs(stats.capacity - target.capacity) / target.capacity) * 150;
  s -= variety * 3;
  if (target.loop && stats.loops === 0) s += 60;
  if (target.bigSlide && !project.modules.some((m) => BIG_SLIDES.slice(0, 3).includes(m.type))) s += 40;
  return s;
}

export function generatePark(site: Site, params: GenParams, attempts = 14): GenResult {
  const base = hashSeed(params.seed);
  let best: { b: Builder; score: number } | null = null;
  for (let k = 0; k < attempts; k++) {
    const rng = makeRng(base + k * 7919);
    const b = attempt(site, params, rng);
    if (!b.mods.length) continue;
    const project: Project = { version: 1, name: '', site, audience: params.audience, modules: b.mods };
    const score = scorePark(project, params);
    if (!best || score < best.score) best = { b, score };
  }
  if (!best) return { modules: [], attempts, score: Infinity, log: ['Aucun parc possible : plan d’eau trop petit ou trop peu profond.'] };
  // uid stables et lisibles
  const modules = best.b.mods.map((m, i) => ({ ...m, uid: `m${i + 1}` }));
  return { modules, attempts, score: best.score, log: best.b.log };
}
