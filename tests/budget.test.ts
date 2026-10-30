import { describe, expect, it } from 'vitest';
import { spec } from '../src/catalog/modules';
import { ACCESSORY_FACTOR, DEFAULT_PARAMS, extendPark, generatePark } from '../src/generator/generator';
import { validate } from '../src/rules/validate';
import type { Placed, Project, Site } from '../src/core/types';

const site: Site = { length: 100, width: 70, depth: 3.5 };
const price = (mods: Placed[]) => mods.reduce((a, m) => a + spec(m.type).price, 0);
const errors = (mods: Placed[]) => validate({ version: 1, name: '', site, audience: 'mixed', modules: mods } as Project).filter((i) => i.level === 'error');

describe('budget & stock', () => {
  it('respecte le budget de génération', () => {
    for (const budget of [80000, 150000, 300000]) {
      const r = generatePark(site, { ...DEFAULT_PARAMS, capacity: 250, budget, seed: `b${budget}` });
      expect(price(r.modules) * ACCESSORY_FACTOR).toBeLessThanOrEqual(budget);
      expect(price(r.modules) * ACCESSORY_FACTOR).toBeGreaterThan(budget * 0.6);
      expect(errors(r.modules)).toHaveLength(0);
    }
  });

  it('recompose un parc uniquement avec le stock', () => {
    const base = generatePark(site, { ...DEFAULT_PARAMS, capacity: 90, seed: 'stock' });
    const stock: Record<string, number> = {};
    for (const m of base.modules) stock[m.type] = (stock[m.type] ?? 0) + 1;
    const r = generatePark(site, { ...DEFAULT_PARAMS, capacity: 1000, stock, seed: 'recompose' });
    const used: Record<string, number> = {};
    for (const m of r.modules) used[m.type] = (used[m.type] ?? 0) + 1;
    for (const [t, n] of Object.entries(used)) expect(n).toBeLessThanOrEqual(stock[t] ?? 0);
    const owned = base.modules.length;
    expect(r.stockUsed! / owned).toBeGreaterThan(0.6);
    expect(errors(r.modules)).toHaveLength(0);
  });

  it('agrandit un parc existant avec 50 000 €', () => {
    const base = generatePark(site, { ...DEFAULT_PARAMS, capacity: 60, loop: false, seed: 'existant' });
    const r = extendPark(site, base.modules, { ...DEFAULT_PARAMS, budget: 50000, seed: 'saison' })!;
    expect(r).not.toBeNull();
    expect(r.modules.length).toBeGreaterThan(0);
    expect(price(r.modules) * ACCESSORY_FACTOR).toBeLessThanOrEqual(50000);
    expect(errors([...base.modules, ...r.modules])).toHaveLength(0);
  });
});
