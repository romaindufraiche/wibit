import { describe, expect, it } from 'vitest';
import { spec } from '../src/catalog/modules';
import { moduleOBB, obbOverlap, rotate, snapTransform, worldPorts } from '../src/core/geometry';
import { buildGraph, loopCount } from '../src/core/graph';

describe('géométrie', () => {
  it('rotate suit la convention three.js (rotation.y)', () => {
    const r = rotate(1, 0, Math.PI / 2);
    expect(r.x).toBeCloseTo(0);
    expect(r.z).toBeCloseTo(-1);
  });

  it('snapTransform colle deux ports face à face', () => {
    const a = { uid: 'a', type: 'slide', x: 0, z: 0, rot: 0.3 };
    const target = worldPorts(a, spec('slide')).find((p) => p.port.id === 'b')!;
    const port = spec('cliff').ports[0];
    const tf = snapTransform(port, target);
    const b = { uid: 'b', type: 'cliff', ...tf };
    const g = buildGraph([a, b]);
    expect(g.links).toHaveLength(1);
    expect(obbOverlap(moduleOBB(a, spec('slide')), moduleOBB(b, spec('cliff')))).toBe(false);
  });

  it('détecte une boucle', () => {
    // 4 virages Turn SUS bout à bout forment un anneau fermé
    const mods = [{ uid: 'm0', type: 'turn-sus', x: 0, z: 0, rot: 0 }];
    for (let i = 1; i < 4; i++) {
      const prev = mods[i - 1];
      const out = worldPorts(prev, spec('turn-sus')).find((p) => p.port.id === 'b')!;
      mods.push({ uid: `m${i}`, type: 'turn-sus', ...snapTransform(spec('turn-sus').ports[0], out) });
    }
    const g = buildGraph(mods);
    expect(g.links).toHaveLength(4);
    expect(loopCount(mods, g)).toBe(1);
  });
});
