import { describe, expect, it } from 'vitest';
import { computeAnchors, toLatLon } from '../src/core/anchors';
import { DEFAULT_PARAMS, generatePark } from '../src/generator/generator';
import { buildGPX, buildKML } from '../src/io/anchorplan';
import type { Project } from '../src/core/types';

describe("plan d'ancrage", () => {
  it('convertit le repère local en WGS84 selon l’azimut du large', () => {
    const geo = { lat: 45.9, lon: 6.13, bearing: 0 };
    const north = toLatLon(geo, 0, -111.32); // 111 m vers le large = nord
    expect(north.lat).toBeCloseTo(45.901, 4);
    expect(north.lon).toBeCloseTo(6.13, 6);
    const east = toLatLon({ ...geo, bearing: 90 }, 0, -100); // large = est
    expect(east.lat).toBeCloseTo(45.9, 6);
    expect(east.lon).toBeGreaterThan(6.13);
  });

  it('produit un GPX et un KML avec une ancre par point', () => {
    const site = { length: 80, width: 60, depth: 3.5, geo: { lat: 45.9, lon: 6.13, bearing: 300 } };
    const r = generatePark(site, { ...DEFAULT_PARAMS, seed: 'ancres' });
    const p: Project = { version: 1, name: 'Test & co', site, audience: 'mixed', modules: r.modules };
    const anchors = computeAnchors(p.modules);
    expect(anchors.length).toBeGreaterThan(p.modules.length);
    const gpx = buildGPX(p, site.geo);
    expect((gpx.match(/<wpt /g) ?? []).length).toBe(anchors.length);
    expect(gpx).toContain('<sym>Anchor</sym>');
    expect(gpx).toContain('Test &amp; co');
    expect((buildKML(p, site.geo).match(/<Point>/g) ?? []).length).toBe(anchors.length);
    // numérotation continue
    expect(anchors.map((a) => a.n)).toEqual(anchors.map((_, i) => i + 1));
  });
});
