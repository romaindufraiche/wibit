import { describe, expect, it } from 'vitest';
import { generatePark, DEFAULT_PARAMS, type GenParams } from '../src/generator/generator';
import { computeStats, validate } from '../src/rules/validate';
import type { Project, Site } from '../src/core/types';

const SITES: Site[] = [
  { length: 80, width: 60, depth: 3.5 },
  { length: 50, width: 35, depth: 2.6 },
  { length: 120, width: 70, depth: 4 },
];

function run(site: Site, p: GenParams) {
  const res = generatePark(site, p);
  const project: Project = { version: 1, name: 't', site, audience: p.audience, modules: res.modules };
  return { res, project, issues: validate(project), stats: computeStats(project) };
}

describe('générateur', () => {
  it('est déterministe pour une même graine', () => {
    const a = generatePark(SITES[0], DEFAULT_PARAMS);
    const b = generatePark(SITES[0], DEFAULT_PARAMS);
    expect(a.modules).toEqual(b.modules);
  });

  const audiences: GenParams['audience'][] = ['kids', 'family', 'sport', 'mixed'];
  for (const site of SITES) {
    for (const audience of audiences) {
      it(`produit un parc sans erreur bloquante (${site.length}×${site.width}, ${audience})`, () => {
        let errorsTotal = 0;
        for (let i = 0; i < 6; i++) {
          const cap = audience === 'kids' ? 40 : 60 + i * 15;
          const { issues, stats, project } = run(site, { ...DEFAULT_PARAMS, audience, capacity: cap, intensity: 1 + (i % 5), seed: `t-${audience}-${i}` });
          const errors = issues.filter((x) => x.level === 'error');
          errorsTotal += errors.length;
          if (errors.length) console.log(site, audience, i, errors.map((e) => e.message));
          expect(project.modules.length).toBeGreaterThan(4);
          expect(stats.capacity).toBeGreaterThan(cap * 0.4);
        }
        expect(errorsTotal).toBe(0);
      });
    }
  }
});
