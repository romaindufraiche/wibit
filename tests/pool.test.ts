import { expect, it } from 'vitest';
import { DEFAULT_PARAMS, generatePark } from '../src/generator/generator';
import { computeStats, edgeMarginOf, validate } from '../src/rules/validate';

it('piscine : parc généré dans un bassin de 25 × 12,5 m, marge de 1,5 m aux parois, sans erreur', () => {
  const site = { length: 25, width: 12.5, depth: 2, kind: 'pool' as const };
  expect(edgeMarginOf(site)).toBe(1.5);
  const p = { ...DEFAULT_PARAMS, audience: 'family' as const, capacity: 22, loop: false, bigSlide: false, seed: 'piscine' };
  const r = generatePark(site, p);
  const project = { version: 1 as const, name: '', site, audience: p.audience, modules: r.modules };
  expect(r.modules.length).toBeGreaterThanOrEqual(5);
  expect(computeStats(project).capacity).toBeGreaterThanOrEqual(15);
  expect(validate(project).filter((i) => i.level === 'error')).toEqual([]);
});
