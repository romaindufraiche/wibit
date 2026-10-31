import { spec } from '../catalog/modules';
import { angleOf, rotate } from '../core/geometry';
import type { ModuleSpec, Placed, PortSpec, Site, Vec2 } from '../core/types';
import { RULES } from '../rules/validate';
import { Builder, type GenParams, type OpenPort } from './generator';
import { hashSeed, makeRng } from './rng';

/*
 * Stylo « main levée ». Le tracé de l'utilisateur est d'abord INTERPRÉTÉ, puis construit :
 *
 * 1. Nettoyage : rééchantillonnage tous les 1 m, lissage du tremblement.
 * 2. Lecture de l'intention (Douglas-Peucker + redressement) :
 *    - un trait presque droit devient une ligne parfaitement droite ;
 *    - les changements de direction sont arrondis aux angles que les modules savent faire
 *      (45° avec un Y-Connect, 90° avec un virage) ; deux 45° rapprochés deviennent un 90° courbe ;
 *    - un arc de cercle devient une succession régulière de virages et de lignes droites ;
 *    - un tracé refermé sur lui-même devient une boucle InfinityLoop aux dimensions du dessin.
 * 3. Construction : chaque segment droit est rempli de modules alignés bout à bout (connexions
 *    exactes), longueurs choisies pour tomber au bon endroit ; chaque virage est un vrai module
 *    de virage. Toutes les règles du générateur s'appliquent (enchaînements, hauteurs, zones…).
 */

// ------------------------------------------------------------------ nettoyage

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

const len = (a: Vec2, b: Vec2) => Math.hypot(b.x - a.x, b.z - a.z);
const unit = (a: Vec2, b: Vec2): Vec2 => {
  const l = len(a, b) || 1;
  return { x: (b.x - a.x) / l, z: (b.z - a.z) / l };
};
const dot = (a: Vec2, b: Vec2) => a.x * b.x + a.z * b.z;
const polyLength = (pts: Vec2[]) => pts.reduce((acc, p, i) => (i ? acc + len(pts[i - 1], p) : 0), 0);

function segDist(p: Vec2, a: Vec2, b: Vec2) {
  const vx = b.x - a.x,
    vz = b.z - a.z;
  const l2 = vx * vx + vz * vz || 1e-9;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.z - a.z) * vz) / l2));
  return Math.hypot(a.x + vx * t - p.x, a.z + vz * t - p.z);
}

/** Douglas-Peucker : garde les points qui portent la forme, au-delà d'une tolérance en mètres. */
function simplify(pts: Vec2[], tol: number): Vec2[] {
  if (pts.length < 3) return pts.slice();
  let maxD = 0,
    idx = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = segDist(pts[i], pts[0], pts[pts.length - 1]);
    if (d > maxD) {
      maxD = d;
      idx = i;
    }
  }
  if (maxD <= tol) return [pts[0], pts[pts.length - 1]];
  const left = simplify(pts.slice(0, idx + 1), tol);
  const right = simplify(pts.slice(idx), tol);
  return [...left.slice(0, -1), ...right];
}

// ------------------------------------------------------------------ lecture de l'intention

/** Un segment droit du parcours, terminé (sauf le dernier) par un virage de `turn` degrés (+ = sens direct). */
export interface Leg {
  heading: Vec2;
  /** Point visé en fin de segment (sommet du virage). */
  end: Vec2;
  turn: number;
}

export interface StrokePlan {
  kind: 'path' | 'loop';
  start: Vec2;
  legs: Leg[];
  length: number;
  /** Boucle : centre, axes et dimensions du tracé. */
  loop?: { center: Vec2; u: Vec2; v: Vec2; lu: number; lv: number };
}

/** Rotation signée d'un cap : +45 / +90 / −45 / −90 degrés. */
function turnHeading(h: Vec2, deg: number): Vec2 {
  const r = rotate(h.x, h.z, (deg * Math.PI) / 180);
  return { x: r.x, z: r.z };
}

function signedTurn(from: Vec2, to: Vec2): number {
  let d = ((angleOf(to.x, to.z) - angleOf(from.x, from.z)) * 180) / Math.PI;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return d;
}

export function planStroke(raw: Vec2[]): StrokePlan | null {
  const pts = resampleStroke(raw, 1);
  if (pts.length < 3) return null;
  const length = polyLength(pts);
  if (length < 4) return null;
  const start = pts[0];
  const endP = pts[pts.length - 1];

  // tracé refermé : boucle
  if (length > 40 && len(start, endP) < Math.max(6, length * 0.12)) {
    const c = pts.reduce((a, p) => ({ x: a.x + p.x / pts.length, z: a.z + p.z / pts.length }), { x: 0, z: 0 });
    // axes principaux (ACP 2D)
    let sxx = 0,
      szz = 0,
      sxz = 0;
    for (const p of pts) {
      sxx += (p.x - c.x) ** 2;
      szz += (p.z - c.z) ** 2;
      sxz += (p.x - c.x) * (p.z - c.z);
    }
    const ang = 0.5 * Math.atan2(2 * sxz, sxx - szz);
    const u = { x: Math.cos(ang), z: Math.sin(ang) };
    const v = { x: -u.z, z: u.x };
    const pu = pts.map((p) => dot({ x: p.x - c.x, z: p.z - c.z }, u));
    const pv = pts.map((p) => dot({ x: p.x - c.x, z: p.z - c.z }, v));
    const lu = Math.max(...pu) - Math.min(...pu),
      lv = Math.max(...pv) - Math.min(...pv);
    const center = { x: c.x + u.x * (Math.max(...pu) + Math.min(...pu)) / 2 + v.x * (Math.max(...pv) + Math.min(...pv)) / 2, z: c.z + u.z * (Math.max(...pu) + Math.min(...pu)) / 2 + v.z * (Math.max(...pv) + Math.min(...pv)) / 2 };
    return { kind: 'loop', start, legs: [], length, loop: { center, u, v, lu, lv } };
  }

  // trait presque droit : une seule ligne parfaitement droite
  const maxDev = Math.max(...pts.map((p) => segDist(p, start, endP)));
  if (maxDev < Math.max(2.5, length * 0.08)) {
    return { kind: 'path', start, legs: [{ heading: unit(start, endP), end: endP, turn: 0 }], length };
  }

  // sinon : segments droits + virages arrondis à 45° / 90°
  const key = simplify(pts, Math.max(2.2, length * 0.05));
  const legs: Leg[] = [];
  let heading = unit(key[0], key[1]);
  legs.push({ heading, end: key[1], turn: 0 });
  for (let i = 1; i < key.length - 1; i++) {
    const want = unit(key[i], key[i + 1]);
    let t = signedTurn(heading, want);
    // au-delà de 112° : on fait d'abord 90°, le reste sera rattrapé au segment suivant
    const snapped = Math.abs(t) < 22.5 ? 0 : Math.sign(t) * Math.min(90, Math.round(Math.abs(t) / 45) * 45);
    if (snapped === 0) {
      legs[legs.length - 1].end = key[i + 1]; // même direction : on prolonge
      continue;
    }
    legs[legs.length - 1].turn = snapped;
    heading = turnHeading(heading, snapped);
    legs.push({ heading, end: key[i + 1], turn: 0 });
    t -= snapped;
  }
  // deux virages de 45° dans le même sens, rapprochés : un seul virage de 90° (arc serré)
  for (let i = 0; i < legs.length - 2; i++) {
    const a = legs[i],
      b = legs[i + 1];
    if (Math.abs(a.turn) === 45 && a.turn === b.turn && len(a.end, b.end) < 7) {
      a.turn = a.turn * 2;
      a.end = { x: (a.end.x + b.end.x) / 2, z: (a.end.z + b.end.z) / 2 };
      legs[i + 2].heading = turnHeading(a.heading, a.turn);
      legs.splice(i + 1, 1);
    }
  }
  return { kind: 'path', start, legs, length };
}

// ------------------------------------------------------------------ construction

/** Distances entre le point d'entrée / de sortie d'un module de virage et son sommet. */
function pivot(_s: ModuleSpec, inPort: PortSpec, outPort: PortSpec): { aIn: number; aOut: number } {
  // droite d'entrée : P + t·(−dIn) ; droite de sortie : Q + u·dOut
  const d1 = { x: -inPort.dx, z: -inPort.dz },
    d2 = { x: outPort.dx, z: outPort.dz };
  const den = d1.x * d2.z - d1.z * d2.x;
  if (Math.abs(den) < 1e-6) return { aIn: len(inPort, outPort) / 2, aOut: len(inPort, outPort) / 2 };
  const qx = outPort.x - inPort.x,
    qz = outPort.z - inPort.z;
  const t = (qx * d2.z - qz * d2.x) / den;
  const piv = { x: inPort.x + d1.x * t, z: inPort.z + d1.z * t };
  return { aIn: len(inPort, piv), aOut: len(outPort, piv) };
}

/** Modules capables de faire un virage de `deg` degrés (valeur absolue), du plus adapté au moins adapté. */
function turnModules(b: Builder, deg: number, arcLike: boolean): string[] {
  const out: { id: string; w: number }[] = [];
  for (const s of b.usable()) {
    if (s.ports.length < 2 || s.role === 'terminal' || s.role === 'standalone') continue;
    for (const p of s.ports)
      for (const q of s.ports) {
        if (p === q) continue;
        const ang = Math.abs(signedTurn({ x: -p.dx, z: -p.dz }, { x: q.dx, z: q.dz }));
        if (Math.abs(ang - deg) > 1) continue;
        let w = s.loopCorner ? 3 : s.id === 'junction' || s.id === 'y-connect' ? 2 : 1;
        if (arcLike && s.loopCorner) w *= 3; // les arcs se dessinent avec des virages courbes
        if (s.diff > b.targetDiff + 1.5) w *= 0.3;
        out.push({ id: s.id, w });
      }
  }
  const best = new Map<string, number>();
  for (const o of out) best.set(o.id, Math.max(best.get(o.id) ?? 0, o.w));
  return b.rng.weightedOrder([...best].map(([item, w]) => ({ item, w })));
}

/** Modules droits (entrée et sortie alignées) : longueur entre les deux connexions. */
function straightLength(s: ModuleSpec): number | null {
  if (s.ports.length !== 2) return null;
  const [p, q] = s.ports;
  if (p.dx * q.dx + p.dz * q.dz > -0.99) return null;
  return len(p, q);
}

interface BuildState {
  cur: OpenPort;
  prev: ModuleSpec;
  run: number;
  expert: number;
}

const portPos = (o: OpenPort): Vec2 => ({ x: o.x, z: o.z });

/** Pose un module dans le prolongement exact du cap. */
function placeStraight(b: Builder, st: BuildState, type: string, heading: Vec2): boolean {
  const pl = b.attach(type, st.cur, heading);
  if (!pl) return false;
  const next = b.portsOf(pl.uid).find((pp) => pp.dx * heading.x + pp.dz * heading.z > 0.98);
  if (!next) return false;
  const s = spec(type);
  st.cur = next;
  if (s.role === 'connector') {
    st.run = 0;
    st.expert = 0;
  } else {
    st.run++;
    st.expert = s.diff >= 4 ? st.expert + 1 : 0;
  }
  st.prev = s;
  return true;
}

/** Remplit un segment droit sur `room` mètres avec des modules alignés, en respectant la grammaire. */
function fillLeg(b: Builder, st: BuildState, heading: Vec2, room: () => number) {
  for (let guard = 0; guard < 40; guard++) {
    const R = room();
    if (R < 2.4) return;
    const mustConnect = st.run >= b.maxRun || (st.prev.H >= 2.4 && st.prev.role !== 'connector');
    const pool = mustConnect
      ? b.connectorCandidates(st.prev, 99).filter((c) => straightLength(spec(c.item)) !== null)
      : [...b.obstacleCandidates(st.prev, { expert: st.expert }), ...b.connectorCandidates(st.prev, 99).filter((c) => straightLength(spec(c.item)) !== null).map((c) => ({ ...c, w: c.w * 0.15 * st.run }))];
    // longueur compatible avec la place restante ; on évite de laisser un vide impossible à combler
    const scored = pool
      .map((c) => {
        const L = straightLength(spec(c.item));
        if (L === null || L > R + 0.9) return null;
        const left = R - L;
        const gap = left < 0.9 ? 0 : left < 2.4 ? 2 : 0; // un reste de 0,9 à 2,4 m ne se comble pas
        return { item: c.item, w: c.w / (1 + gap) };
      })
      .filter((c): c is { item: string; w: number } => !!c);
    let placed = false;
    for (const t of b.rng.weightedOrder(scored).slice(0, 12)) {
      if (placeStraight(b, st, t, heading)) {
        placed = true;
        break;
      }
    }
    if (!placed) return;
  }
}

function attemptPath(b: Builder, plan: StrokePlan, existingStart: OpenPort | null): { progress: number } {
  const h0 = plan.legs[0].heading;
  let cur = existingStart;
  if (!cur) {
    // accès posé au début du tracé, orienté dans l'axe du premier segment
    const prefs = b.p.audience === 'kids' ? ['base-sus', 'step', 'base'] : ['base-sus', 'step6', 'startgate-sus', 'base', 'step'];
    for (const type of prefs) {
      if (!b.canUse(type)) continue;
      const s = spec(type);
      const out = s.ports.find((pp) => pp.id === 'b')!;
      const rot = angleOf(h0.x, h0.z) - angleOf(out.dx, out.dz);
      const off = rotate(out.x, out.z, rot);
      const tf = { x: plan.start.x - off.x, z: plan.start.z - off.z, rot };
      if (!b.fits(s, tf, null)) continue;
      const pl = b.place(type, tf);
      cur = b.portsOf(pl.uid).find((pp) => pp.portId === 'b') ?? null;
      break;
    }
  }
  if (!cur) return { progress: 0 };
  const st: BuildState = { cur, prev: spec(b.mods.find((m) => m.uid === cur!.uid)!.type), run: 0, expert: 0 };
  let progress = 0;
  for (let k = 0; k < plan.legs.length; k++) {
    const leg = plan.legs[k];
    const last = k === plan.legs.length - 1;
    // virage prévu en fin de segment : on choisit le module pour connaître la place qu'il prend
    let turnType: string | null = null;
    let aIn = 0;
    let turnIn: PortSpec | null = null;
    if (!last && leg.turn) {
      const arcLike = (plan.legs[k + 1]?.turn ?? 0) === leg.turn || (plan.legs[k - 1]?.turn ?? 0) === leg.turn;
      for (const t of turnModules(b, Math.abs(leg.turn), arcLike)) {
        const s = spec(t);
        for (const p of s.ports)
          for (const q of s.ports) {
            if (p === q || turnType) continue;
            if (Math.abs(Math.abs(signedTurn({ x: -p.dx, z: -p.dz }, { x: q.dx, z: q.dz })) - Math.abs(leg.turn)) > 1) continue;
            turnType = t;
            turnIn = p;
            aIn = pivot(s, p, q).aIn;
          }
        if (turnType) break;
      }
    }
    const endRoom = last ? 3 : aIn; // le dernier segment garde la place d'un module de fin
    fillLeg(b, st, leg.heading, () => dot({ x: leg.end.x - st.cur.x, z: leg.end.z - st.cur.z }, leg.heading) - endRoom);
    progress = Math.max(progress, k / plan.legs.length);
    if (last || !turnType || !turnIn) break;
    // le virage : sortie orientée exactement selon le cap suivant
    const nextHeading = plan.legs[k + 1].heading;
    let turned = false;
    for (const t of [turnType, ...turnModules(b, Math.abs(leg.turn), false).filter((x) => x !== turnType)].slice(0, 6)) {
      const pl = b.attach(t, st.cur, nextHeading);
      if (!pl) continue;
      const next = b.portsOf(pl.uid).find((pp) => pp.dx * nextHeading.x + pp.dz * nextHeading.z > 0.98);
      if (!next) continue;
      st.cur = next;
      st.prev = spec(t);
      st.run = 0;
      st.expert = 0;
      turned = true;
      break;
    }
    if (!turned) break;
    progress = (k + 1) / plan.legs.length;
  }
  // fin de parcours dans l'axe
  const terms = b.rng.weightedOrder(b.terminalCandidates());
  for (const t of terms) {
    const s = spec(t);
    if ((st.prev.role === 'obstacle' || st.prev.role === 'tower') && Math.abs(st.prev.H - s.H) >= RULES.maxHeightStep) continue;
    if (b.attach(t, st.cur)) break;
  }
  const endLeg = plan.legs[plan.legs.length - 1];
  const remaining = dot({ x: endLeg.end.x - st.cur.x, z: endLeg.end.z - st.cur.z }, endLeg.heading);
  if (progress >= (plan.legs.length - 1) / plan.legs.length && remaining < 6) progress = 1;
  return { progress };
}

/** Boucle InfinityLoop aux dimensions du tracé refermé. */
function attemptLoop(b: Builder, plan: StrokePlan): { progress: number } {
  const L = plan.loop!;
  // côté d'accès : celui où l'utilisateur a commencé à dessiner
  const d = { x: L.center.x - plan.start.x, z: L.center.z - plan.start.z };
  const alongU = Math.abs(dot(d, L.u)) > Math.abs(dot(d, L.v));
  const stem = alongU ? (dot(d, L.u) > 0 ? L.u : { x: -L.u.x, z: -L.u.z }) : dot(d, L.v) > 0 ? L.v : { x: -L.v.x, z: -L.v.z };
  const spanStem = alongU ? L.lu : L.lv;
  const spanSide = alongU ? L.lv : L.lu;
  const corners = b.usable().filter((s) => s.loopCorner && s.diff <= b.targetDiff + 1);
  if (!corners.length) return { progress: 0 };
  const corner = b.rng.pick(corners);
  const cp = corner.ports;
  const cpv = pivot(corner, cp[0], cp[1]);
  const r3 = (v: number) => Math.max(0, Math.round(v / 3) * 3);
  for (let shrink = 0; shrink < 4; shrink++) {
    // axe médian : côtés = segments droits + T (3 m) + 2 virages
    const sideTotal = r3(spanSide - 2 * cpv.aOut - 3 - shrink * 3);
    const a = r3(sideTotal / 2),
      bb = Math.max(0, sideTotal - a);
    const m = Math.max(3, r3(spanStem - 2 * cpv.aOut - shrink * 3));
    // accès hors de la boucle, côté départ ; le T se trouve au milieu du côté d'accès
    const tCenter = { x: L.center.x - stem.x * (m / 2 + cpv.aOut), z: L.center.z - stem.z * (m / 2 + cpv.aOut) };
    const side = { x: -stem.z, z: stem.x };
    const shift = (a - bb) / 2;
    const q = { x: tCenter.x - stem.x * 1.5 + side.x * shift, z: tCenter.z - stem.z * 1.5 + side.z * shift };
    const mark = b.mods.length;
    for (const type of ['base-sus', 'step6', 'base', 'step']) {
      if (!b.canUse(type)) continue;
      const s = spec(type);
      const out = s.ports.find((pp) => pp.id === 'b')!;
      const rot = angleOf(stem.x, stem.z) - angleOf(out.dx, out.dz);
      const off = rotate(out.x, out.z, rot);
      const tf = { x: q.x - off.x, z: q.z - off.z, rot };
      if (!b.fits(s, tf, null)) continue;
      const pl = b.place(type, tf);
      const op = b.portsOf(pl.uid).find((pp) => pp.portId === 'b');
      if (!op) break;
      const before = b.mods.length;
      b.tryRing(op, { a, b: bb, m, corner: corner.id });
      if (b.mods.length > before) return { progress: 1 };
      break;
    }
    b.truncate(mark);
  }
  return { progress: 0 };
}

/** Un seul poste de surveillance, et seulement si les nouveaux modules sont hors de portée des postes existants. */
function watchForNew(b: Builder, from: number) {
  const fresh = b.mods.slice(from);
  const watches = () => b.mods.filter((m) => spec(m.type).role === 'watch');
  const uncovered = fresh.filter((m) => !watches().some((w) => len(w, m) <= RULES.watchRadius));
  if (!uncovered.length) return;
  const c = uncovered.reduce((a, m) => ({ x: a.x + m.x / uncovered.length, z: a.z + m.z / uncovered.length }), { x: 0, z: 0 });
  const freshIds = new Set(fresh.map((m) => m.uid));
  const ports = b.free.filter((f) => freshIds.has(f.uid) && spec(b.mods.find((m) => m.uid === f.uid)!.type).role === 'connector').sort((p, q) => len(p, c) - len(q, c));
  const types = b.usable().filter((s) => s.role === 'watch' && s.ports.length && s.id !== 'watcharound').map((s) => s.id);
  for (const f of ports.slice(0, 6)) for (const t of types) if (b.attach(t, f)) return;
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
  /** Lecture du tracé : ligne droite, segments, boucle. */
  shape: 'droit' | 'segments' | 'boucle';
}

export function followStroke(site: Site, existing: Placed[], stroke: Vec2[], p: GenParams, attempts = 6): StrokeResult | null {
  const plan = planStroke(stroke);
  if (!plan) return null;
  const base = hashSeed(p.seed);
  let best: { b: Builder; progress: number; score: number; extended: boolean } | null = null;
  for (let k = 0; k < attempts; k++) {
    const b = new Builder(site, p, makeRng(base + k * 104729));
    b.seed(existing);
    let extended = false;
    let res: { progress: number };
    if (plan.kind === 'loop') res = attemptLoop(b, plan);
    else {
      // départ sur une connexion libre proche et orientée dans le sens du tracé : on prolonge le parc
      const h0 = plan.legs[0].heading;
      const near = b.free
        .filter((f) => spec(b.mods.find((m) => m.uid === f.uid)!.type).role !== 'terminal' && f.dx * h0.x + f.dz * h0.z > 0.3)
        .map((f) => ({ f, d: len(portPos(f), plan.start) }))
        .filter((c) => c.d < 4)
        .sort((x, y) => x.d - y.d)[0];
      if (near) {
        extended = true;
        // le tracé repart exactement de la connexion, dans son axe
        const fh = { x: near.f.dx, z: near.f.dz };
        if (plan.legs.length === 1 || dot(fh, h0) > 0.92) plan.legs[0].heading = fh;
      }
      res = attemptPath(b, plan, near?.f ?? null);
    }
    watchForNew(b, existing.length);
    const added = b.mods.length - existing.length;
    if (added < 2) continue;
    const variety = new Set(b.mods.slice(existing.length).map((m) => m.type)).size;
    const score = (1 - res.progress) * 100 - variety * 0.8;
    if (!best || score < best.score) best = { b, progress: res.progress, score, extended };
  }
  if (!best) return null;
  const shape = plan.kind === 'loop' ? 'boucle' : plan.legs.length === 1 ? 'droit' : 'segments';
  return { modules: best.b.mods.slice(existing.length), length: plan.length, coverage: best.progress, extended: best.extended, shape };
}
