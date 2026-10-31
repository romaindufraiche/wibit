import { describe, expect, it } from 'vitest';
import { spec } from '../src/catalog/modules';
import { buildGraph, components, loopCount } from '../src/core/graph';
import { DEFAULT_PARAMS } from '../src/generator/generator';
import { followStroke, planStroke } from '../src/generator/freehand';
import { validate } from '../src/rules/validate';
import type { Placed, Project, Site, Vec2 } from '../src/core/types';

const site: Site = { length: 160, width: 120, depth: 3.5 };
const params = (seed: string) => ({ ...DEFAULT_PARAMS, seed });
const errors = (mods: Placed[]) => validate({ version: 1, name: 't', site, audience: 'mixed', modules: mods } as Project).filter((i) => i.level === 'error');
/** Tremblement de main reproductible. */
const shake = (i: number, a = 0.9) => Math.sin(i * 1.7) * a + Math.sin(i * 0.43) * a * 0.6;

function wobblyLine(): Vec2[] {
  const p: Vec2[] = [];
  for (let i = 0; i <= 80; i++) p.push({ x: -40 + i * 0.8 + shake(i, 0.3), z: 30 - i * 0.25 + shake(i + 5) });
  return p;
}
function lShape(): Vec2[] {
  const p: Vec2[] = [];
  for (let i = 0; i <= 40; i++) p.push({ x: -30 + shake(i, 0.5), z: 35 - i });
  for (let i = 1; i <= 45; i++) p.push({ x: -30 + i, z: -5 + shake(i, 0.5) });
  return p;
}
function arc(): Vec2[] {
  const p: Vec2[] = [];
  for (let i = 0; i <= 60; i++) {
    const a = Math.PI - (i / 60) * Math.PI; // demi-cercle de 22 m de rayon
    p.push({ x: Math.cos(a) * 22 + shake(i, 0.4), z: 20 - Math.sin(a) * 22 });
  }
  return p;
}
function closed(): Vec2[] {
  const p: Vec2[] = [];
  for (let i = 0; i <= 90; i++) {
    const a = (i / 90) * Math.PI * 2;
    p.push({ x: Math.cos(a) * 18 + shake(i, 0.6), z: Math.sin(a) * 12 + shake(i + 3, 0.6) });
  }
  return p;
}

function connectedChain(mods: Placed[]) {
  const g = buildGraph(mods);
  const comps = components(mods, g).filter((c) => c.some((u) => spec(mods.find((m) => m.uid === u)!.type).ports.length));
  return { g, comps };
}

describe('stylo : lecture du tracé', () => {
  it('reconnaît une ligne presque droite', () => {
    const plan = planStroke(wobblyLine())!;
    expect(plan.kind).toBe('path');
    expect(plan.legs).toHaveLength(1);
  });
  it('reconnaît un L avec un virage de 90°', () => {
    const plan = planStroke(lShape())!;
    expect(plan.legs.length).toBe(2);
    expect(Math.abs(plan.legs[0].turn)).toBe(90);
  });
  it('reconnaît une boucle', () => {
    expect(planStroke(closed())!.kind).toBe('loop');
  });
});

describe('stylo : construction', () => {
  it('trait tremblant presque droit -> modules parfaitement alignés et connectés', () => {
    const r = followStroke(site, [], wobblyLine(), params('droit'))!;
    expect(r.shape).toBe('droit');
    const main = r.modules.filter((m) => spec(m.type).role !== 'watch');
    // tous les modules du parcours ont la même orientation (à 180° près) et sont sur une même droite
    const angles = new Set(main.map((m) => (((Math.round((m.rot * 180) / Math.PI) % 180) + 180) % 180)));
    expect(angles.size).toBe(1);
    const a = main[0],
      dir = { x: Math.cos(a.rot), z: -Math.sin(a.rot) };
    for (const m of main) expect(Math.abs((m.x - a.x) * -dir.z + (m.z - a.z) * dir.x)).toBeLessThan(0.05);
    const { comps } = connectedChain(r.modules);
    expect(comps).toHaveLength(1);
    expect(errors(r.modules)).toHaveLength(0);
    expect(r.coverage).toBeGreaterThan(0.9);
  });

  it('L -> deux lignes droites reliées par un vrai virage', () => {
    const r = followStroke(site, [], lShape(), params('L'))!;
    const { comps } = connectedChain(r.modules);
    expect(comps).toHaveLength(1);
    const rots = new Set(r.modules.filter((m) => spec(m.type).ports.length === 2 && spec(m.type).role !== 'connector').map((m) => (((Math.round((m.rot * 180) / Math.PI) % 180) + 180) % 180)));
    expect(rots.size).toBeLessThanOrEqual(2); // deux directions seulement
    expect(errors(r.modules)).toHaveLength(0);
  });

  it('arc de cercle -> virages successifs dans le même sens', () => {
    const r = followStroke(site, [], arc(), params('arc'))!;
    expect(r.modules.length).toBeGreaterThan(5);
    expect(connectedChain(r.modules).comps).toHaveLength(1);
    expect(errors(r.modules)).toHaveLength(0);
  });

  it('tracé refermé -> boucle InfinityLoop', () => {
    const r = followStroke(site, [], closed(), params('boucle'))!;
    expect(r.shape).toBe('boucle');
    const g = buildGraph(r.modules);
    expect(loopCount(r.modules, g)).toBeGreaterThanOrEqual(1);
    expect(errors(r.modules)).toHaveLength(0);
  });

  it('prolonge un parc depuis une connexion libre, dans son axe', () => {
    const first = followStroke(site, [], wobblyLine(), params('a'))!;
    const existing = first.modules.map((m, i) => ({ ...m, uid: `m${i + 1}` }));
    const g = buildGraph(existing);
    const free = g.ports.find((p) => !g.usedPorts.get(p.uid)!.has(p.port.id) && spec(existing.find((m) => m.uid === p.uid)!.type).role === 'connector');
    if (!free) return;
    const pts: Vec2[] = [];
    for (let i = 0; i <= 25; i++) pts.push({ x: free.x + free.dx * i, z: free.z + free.dz * i });
    const r2 = followStroke(site, existing, pts, params('b'));
    expect(r2?.extended).toBe(true);
  });
});
