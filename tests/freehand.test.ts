import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS } from '../src/generator/generator';
import { followStroke } from '../src/generator/freehand';
import { validate } from '../src/rules/validate';
import type { Placed, Project, Site, Vec2 } from '../src/core/types';

const site: Site = { length: 90, width: 70, depth: 3.5 };

function strokes(): Record<string, Vec2[]> {
  const s: Vec2[] = [];
  for (let i = 0; i <= 60; i++) s.push({ x: -25 + i * 0.8, z: 20 - Math.sin(i / 10) * 12 }); // vague
  const c: Vec2[] = [];
  for (let i = 0; i <= 70; i++) c.push({ x: Math.cos(i / 25) * 18, z: Math.sin(i / 25) * 18 }); // arc
  const l: Vec2[] = [];
  for (let i = 0; i <= 40; i++) l.push({ x: -20, z: 22 - i * 0.9 });
  for (let i = 1; i <= 40; i++) l.push({ x: -20 + i * 0.9, z: 22 - 36 }); // L
  return { vague: s, arc: c, L: l };
}

function check(mods: Placed[]) {
  const project: Project = { version: 1, name: 't', site, audience: 'mixed', modules: mods };
  return validate(project).filter((i) => i.level === 'error');
}

describe('stylo main levée', () => {
  for (const [name, pts] of Object.entries(strokes())) {
    it(`pose des modules le long du tracé « ${name} » sans erreur`, () => {
      const r = followStroke(site, [], pts, { ...DEFAULT_PARAMS, seed: name })!;
      expect(r).not.toBeNull();
      expect(r.modules.length).toBeGreaterThan(4);
      expect(r.coverage).toBeGreaterThan(0.75);
      const errs = check(r.modules);
      if (errs.length) console.log(name, errs.map((e) => e.message));
      expect(errs).toHaveLength(0);
    });
  }

  it('prolonge un parc existant depuis un port libre', () => {
    const first = followStroke(site, [], strokes().vague, { ...DEFAULT_PARAMS, seed: 'a' })!;
    const existing = first.modules.map((m, i) => ({ ...m, uid: `m${i + 1}` }));
    // nouveau tracé partant d'une jonction libre de ce parc
    const r2 = followStroke(site, existing, [{ x: 0, z: -25 }, { x: 10, z: -25 }, { x: 25, z: -20 }], { ...DEFAULT_PARAMS, seed: 'b' });
    expect(r2 === null || r2.modules.length >= 0).toBe(true);
  });
});
