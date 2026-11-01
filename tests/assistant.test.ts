import { describe, expect, it } from 'vitest';
import { parseRequest } from '../src/assistant/intent';
import { briefFrom, planPark } from '../src/assistant/planner';
import { emptyProject } from '../src/editor/store';
import { DEFAULT_PARAMS } from '../src/generator/generator';

const base = briefFrom(DEFAULT_PARAMS);

describe('assistant : compréhension des demandes', () => {
  it('budget, capacité, parcours chronométré', () => {
    const r = parseRequest('J’ai un budget de 500 000 €, je veux un parc pour 200 personnes qui fait un parcours sportif pour des challenges chronométrés', base);
    expect(r.action).toBe('generate');
    expect(r.brief.budget).toBe(500000);
    expect(r.brief.capacity).toBe(200);
    expect(r.brief.course).toBe(true);
    expect(r.brief.loop).toBe(false);
    expect(r.brief.audience).toBe('sport');
    expect(r.brief.intensity).toBeGreaterThanOrEqual(4);
  });
  it('formats de montants et de plan d’eau', () => {
    expect(parseRequest('budget 300k', base).brief.budget).toBe(300000);
    expect(parseRequest('on a 1,2 M€ à investir', base).brief.budget).toBe(1200000);
    expect(parseRequest('250 000 euros HT max', base).brief.budget).toBe(250000);
    const r = parseRequest('un lac de 300 x 180 m, 2,5 m de profondeur, pour 60 enfants', base);
    expect(r.brief.lake).toEqual({ length: 300, width: 180 });
    expect(r.brief.depth).toBe(2.5);
    expect(r.brief.capacity).toBe(60);
    expect(r.brief.audience).toBe('kids');
  });
  it('ajustements et autres actions', () => {
    const b = { ...base, budget: 400000, capacity: 100 };
    expect(parseRequest('moins cher', b).brief.budget).toBe(320000);
    expect(parseRequest('plus grand', b).brief.capacity).toBe(125);
    expect(parseRequest('une autre version', b).action).toBe('variant');
    expect(parseRequest('sans toboggan', b).brief.bigSlide).toBe(false);
    expect(parseRequest('aide', b).action).toBe('help');
    expect(parseRequest('je veux le placer sur mon lac', b).action).toBe('real_site');
  });
});

describe('assistant : du brief au parc', () => {
  it('500 000 €, 200 personnes, chronométré : parcours long, budget respecté, sans erreur', () => {
    const r = parseRequest('budget de 500 000 €, 200 personnes, parcours sportif chronométré', base);
    const plan = planPark(r.brief, emptyProject(), 'test-chrono');
    expect(plan.ok).toBe(true);
    const text = plan.summary.join(' ');
    expect(text).toMatch(/Parcours chronométré : \d+ modules/);
    const total = Number(text.match(/personnes en même temps, ([\d\s ]+) €/)![1].replace(/\D/g, ''));
    expect(total).toBeLessThanOrEqual(500000);
    expect(text).not.toMatch(/point\(s\) de règles/);
    expect(plan.site.length).toBeGreaterThanOrEqual(420);
  });
});
