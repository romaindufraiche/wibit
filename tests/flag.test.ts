import { expect, it } from 'vitest';
import { naturalOutline } from '../src/core/region';
import { mainEntry, moveParkToStart, snapToShore } from '../src/editor/flag';
import { DEFAULT_PARAMS, generatePark } from '../src/generator/generator';
import { validate } from '../src/rules/validate';

const site = { length: 260, width: 160, depth: 3.5, outline: naturalOutline(260, 160) };

it('drapeau : un parc généré démarre au plus près du drapeau', () => {
  for (const flag of [{ x: -90, z: 70 }, { x: 100, z: 20 }, { x: 0, z: -90 }]) {
    const start = snapToShore(site, flag);
    const r = generatePark(site, { ...DEFAULT_PARAMS, start: { x: start.x, z: start.z }, seed: 'flag' });
    const e = mainEntry(site, r.modules)!;
    expect(Math.hypot(e.x - start.x, e.z - start.z), JSON.stringify(flag)).toBeLessThan(15);
    expect(validate({ version: 1, name: '', site, audience: 'mixed', modules: r.modules }).filter((i) => i.level === 'error')).toEqual([]);
  }
});

it('drapeau : le parc existant est recalé d’un bloc, accès au drapeau, sans sortir de l’eau', () => {
  const r = generatePark(site, { ...DEFAULT_PARAMS, capacity: 40, seed: 'recale' });
  const flag = snapToShore(site, { x: -100, z: 60 });
  const moved = moveParkToStart(site, r.modules, flag)!;
  const e = mainEntry(site, moved)!;
  expect(Math.hypot(e.x - flag.x, e.z - flag.z)).toBeLessThan(8);
  // distances entre modules conservées (déplacement rigide)
  const d = (m: { x: number; z: number }[], i: number, j: number) => Math.hypot(m[i].x - m[j].x, m[i].z - m[j].z);
  expect(d(moved, 0, moved.length - 1)).toBeCloseTo(d(r.modules, 0, r.modules.length - 1), 1);
});
