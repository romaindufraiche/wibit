import { describe, expect, it } from 'vitest';
import { buildRealSite, clipToRect, latLonToLocal, type LatLon } from '../src/core/realsite';
import { toLatLon } from '../src/core/anchors';
import { pointInPolygon } from '../src/core/region';
import { DEFAULT_PARAMS, generatePark } from '../src/generator/generator';
import { validate } from '../src/rules/validate';
// @ts-expect-error module JS du serveur
import { parseOverpassWater, stitchRings } from '../server/geo.js';

const C: LatLon = [45.9, 6.13];
const M = 111320;
/** Lac elliptique de 600 × 400 m centré sur C. */
const lake: LatLon[] = Array.from({ length: 81 }, (_, i) => {
  const a = (i / 80) * Math.PI * 2;
  return [C[0] + (Math.sin(a) * 200) / M, C[1] + (Math.cos(a) * 300) / (M * Math.cos((C[0] * Math.PI) / 180))] as LatLon;
});

describe('site réel', () => {
  it('conversions GPS <-> local réciproques', () => {
    const geo = { lat: 45.9, lon: 6.13, bearing: 37 };
    for (const [x, z] of [[0, 0], [120, -40], [-75, 90]]) {
      const g = toLatLon(geo, x, z);
      const back = latLonToLocal(geo, [g.lat, g.lon]);
      expect(back.x).toBeCloseTo(x, 3);
      expect(back.z).toBeCloseTo(z, 3);
    }
  });

  it('découpe un polygone par la zone de travail', () => {
    const sq = [{ x: -100, z: -100 }, { x: 100, z: -100 }, { x: 100, z: 100 }, { x: -100, z: 100 }];
    const c = clipToRect(sq, 50, 30);
    expect(c.every((p) => Math.abs(p.x) <= 50.001 && Math.abs(p.z) <= 30.001)).toBe(true);
  });

  it('oriente la zone : plage sur la berge la plus proche, parcs dans l’eau', () => {
    // point dans le lac, à 40 m de la berge sud
    const point: LatLon = [C[0] + (-160 / M), C[1]];
    const r = buildRealSite({ point, rings: [lake], length: 320, width: 200, depth: 3.5 })!;
    expect(r).not.toBeNull();
    // le large est vers le nord (berge sud -> intérieur du lac)
    const b = r.site.geo!.bearing;
    expect(Math.min(b, 360 - b)).toBeLessThan(10);
    // le point choisi est bien dans l'eau du site local
    const pl = latLonToLocal(r.site.geo!, point);
    expect(pointInPolygon(pl, r.site.outline!)).toBe(true);
    const g = generatePark(r.site, { ...DEFAULT_PARAMS, capacity: 80, seed: 'reel' });
    expect(g.modules.length).toBeGreaterThan(5);
    const errs = validate({ version: 1, name: '', site: r.site, audience: 'mixed', modules: g.modules }).filter((i) => i.level === 'error');
    expect(errs).toHaveLength(0);
  });

  it('assemble les contours OpenStreetMap découpés en tronçons', () => {
    const half1 = lake.slice(0, 41).map(([lat, lon]) => ({ lat, lon }));
    const half2 = lake.slice(40).map(([lat, lon]) => ({ lat, lon })).reverse(); // sens inversé
    const data = {
      elements: [
        { type: 'relation', tags: { name: 'Lac test' }, members: [ { type: 'way', role: 'outer', geometry: half1 }, { type: 'way', role: 'outer', geometry: half2 } ] },
        { type: 'way', tags: { natural: 'water' }, geometry: [{ lat: 1, lon: 1 }, { lat: 1, lon: 2 }] }, // non fermé : ignoré
      ],
    };
    const w = parseOverpassWater(data);
    expect(w).toHaveLength(1);
    expect(w[0].name).toBe('Lac test');
    expect(w[0].rings[0].length).toBe(81);
    expect(stitchRings([[[0, 0], [0, 1]], [[1, 1], [0, 1]], [[1, 1], [0, 0]]])).toHaveLength(1);
  });
});
