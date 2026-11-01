import { expect, it } from 'vitest';
import { DEFAULT_PARAMS, generatePark } from '../src/generator/generator';
import { TEMPLATES } from '../src/generator/templates';
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

it('modèles de piscine : appliqués sur chaque bassin de leur taille (25 m ou 50 m) sans erreur', () => {
  const pools = TEMPLATES.filter((t) => t.site.kind === 'pool');
  const basins = [
    { length: 25, width: 12.5, depth: 2, kind: 'pool' as const },
    { length: 25, width: 15, depth: 2, kind: 'pool' as const },
    { length: 50, width: 25, depth: 2, kind: 'pool' as const },
  ];
  for (const size of [25, 50]) expect(pools.filter((t) => (t.site.length >= 40 ? 50 : 25) === size).length).toBeGreaterThanOrEqual(3);
  for (const site of basins)
    for (const t of pools.filter((t) => (t.site.length >= 40) === site.length >= 40)) {
      const r = generatePark(site, t.params);
      const project = { version: 1 as const, name: t.name, site, audience: t.params.audience, modules: r.modules };
      expect(r.modules.length, `${t.name} ${site.length}×${site.width}`).toBeGreaterThanOrEqual(5);
      expect(validate(project).filter((i) => i.level === 'error'), `${t.name} ${site.length}×${site.width}`).toEqual([]);
      console.log(`${t.name} sur ${site.length}×${site.width} : ${r.modules.length} modules, ${computeStats(project).capacity} pers.`);
    }
});
