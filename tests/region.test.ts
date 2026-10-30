import { describe, expect, it } from 'vitest';
import { spec } from '../src/catalog/modules';
import { moduleOBB } from '../src/core/geometry';
import { obbInsideSite, offsetPolygon, pointInPolygon } from '../src/core/region';
import { DEFAULT_PARAMS, generatePark } from '../src/generator/generator';
import { validate } from '../src/rules/validate';
import type { Site, Vec2 } from '../src/core/types';

// crique : plage en bas avec une avancée de terre (ponton naturel) au milieu
const cove: Vec2[] = [
  { x: -45, z: -35 }, { x: 45, z: -35 }, { x: 50, z: 10 }, { x: 35, z: 32 },
  { x: 8, z: 30 }, { x: 4, z: 12 }, { x: -6, z: 12 }, { x: -10, z: 30 }, { x: -40, z: 28 }, { x: -50, z: 0 },
];
const site: Site = { length: 100, width: 67, depth: 3.5, outline: cove };

describe('contour remodelé', () => {
  it('teste l’appartenance et le décalage', () => {
    expect(pointInPolygon({ x: 0, z: 20 }, cove)).toBe(false); // dans l'avancée de terre
    expect(pointInPolygon({ x: 0, z: 0 }, cove)).toBe(true);
    const inner = offsetPolygon(cove, -3);
    expect(pointInPolygon(inner[0], cove)).toBe(true);
  });

  it('génère un parc entièrement dans l’eau sans erreur', () => {
    for (const seed of ['crique-1', 'crique-2', 'crique-3']) {
      const r = generatePark(site, { ...DEFAULT_PARAMS, capacity: 90, seed });
      expect(r.modules.length).toBeGreaterThan(5);
      for (const m of r.modules) expect(obbInsideSite(moduleOBB(m, spec(m.type)), cove, 3 - 1e-3)).toBe(true);
      const errs = validate({ version: 1, name: '', site, audience: 'mixed', modules: r.modules }).filter((i) => i.level === 'error');
      expect(errs).toHaveLength(0);
    }
  });
});
