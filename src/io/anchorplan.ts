import { spec } from '../catalog/modules';
import { computeAnchors, dms, toLatLon, type Anchor } from '../core/anchors';
import { moduleOBB, obbCorners } from '../core/geometry';
import type { Geo, Project } from '../core/types';
import { buoyPerimeter } from '../rules/validate';
import { APP_NAME } from '../brand';

/*
 * Exports du plan d'ancrage :
 * - GPX 1.1 : lu par les GPS Garmin, sondeurs / traceurs, Navionics, OsmAnd, Google Maps (import)…
 *   waypoints numérotés (symbole « Anchor ») + route dans l'ordre de pose + trace du balisage ;
 * - KML : Google Earth / Google Maps, téléphones ;
 * - CSV : tableur (coordonnées décimales et degrés-minutes) ;
 * - plan imprimable (carte vectorielle + tableau).
 */

const xml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);
const id3 = (n: number) => `A${String(n).padStart(3, '0')}`;

function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const slug = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase() || 'parc';

interface GeoAnchor extends Anchor {
  lat: number;
  lon: number;
}

export function geoAnchors(p: Project, geo: Geo): GeoAnchor[] {
  return computeAnchors(p.modules).map((a) => ({ ...a, ...toLatLon(geo, a.x, a.z) }));
}

export function buildGPX(p: Project, geo: Geo): string {
  const anchors = geoAnchors(p, geo);
  const now = new Date().toISOString();
  const wpts = anchors
    .map(
      (a) => `  <wpt lat="${a.lat.toFixed(7)}" lon="${a.lon.toFixed(7)}">
    <name>${id3(a.n)}</name>
    <cmt>${xml(a.modules.join(' + '))}</cmt>
    <desc>Ancre ${a.n} — ${xml(a.modules.join(' + '))}</desc>
    <sym>Anchor</sym>
    <type>Ancre</type>
  </wpt>`,
    )
    .join('\n');
  const route = anchors.map((a) => `    <rtept lat="${a.lat.toFixed(7)}" lon="${a.lon.toFixed(7)}"><name>${id3(a.n)}</name></rtept>`).join('\n');
  const per = buoyPerimeter(p.modules);
  const trk = per.length > 2 ? [...per, per[0]].map((v) => toLatLon(geo, v.x, v.z)).map((c) => `      <trkpt lat="${c.lat.toFixed(7)}" lon="${c.lon.toFixed(7)}"/>`).join('\n') : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="${APP_NAME}" xmlns="http://www.topografix.com/GPX/1/1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">
  <metadata><name>${xml(p.name)} — plan d'ancrage</name><time>${now}</time></metadata>
${wpts}
  <rte>
    <name>${xml(p.name)} — ordre de pose</name>
${route}
  </rte>
${trk ? `  <trk>\n    <name>${xml(p.name)} — balisage</name>\n    <trkseg>\n${trk}\n    </trkseg>\n  </trk>` : ''}
</gpx>
`;
}

export function buildKML(p: Project, geo: Geo): string {
  const anchors = geoAnchors(p, geo);
  const marks = anchors
    .map(
      (a) => `    <Placemark><name>${id3(a.n)}</name><description>${xml(a.modules.join(' + '))}</description><styleUrl>#ancre</styleUrl>
      <Point><coordinates>${a.lon.toFixed(7)},${a.lat.toFixed(7)},0</coordinates></Point></Placemark>`,
    )
    .join('\n');
  const footprints = p.modules
    .map((m) => {
      const ring = obbCorners(moduleOBB(m, spec(m.type)));
      const coords = [...ring, ring[0]].map((c) => toLatLon(geo, c.x, c.z)).map((c) => `${c.lon.toFixed(7)},${c.lat.toFixed(7)},0`).join(' ');
      return `    <Placemark><name>${xml(spec(m.type).name)}</name><styleUrl>#module</styleUrl><Polygon><outerBoundaryIs><LinearRing><coordinates>${coords}</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>`;
    })
    .join('\n');
  const route = anchors.map((a) => `${a.lon.toFixed(7)},${a.lat.toFixed(7)},0`).join(' ');
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document>
  <name>${xml(p.name)} — plan d'ancrage</name>
  <Style id="ancre"><IconStyle><color>ff1a6aff</color><scale>0.8</scale><Icon><href>http://maps.google.com/mapfiles/kml/shapes/placemark_circle.png</href></Icon></IconStyle></Style>
  <Style id="module"><LineStyle><color>ff0ec2ff</color><width>2</width></LineStyle><PolyStyle><color>660ec2ff</color></PolyStyle></Style>
  <Style id="route"><LineStyle><color>ffffffff</color><width>1.5</width></LineStyle></Style>
  <Folder><name>Ancres (${anchors.length})</name>
${marks}
  </Folder>
  <Folder><name>Modules (${p.modules.length})</name>
${footprints}
  </Folder>
  <Placemark><name>Ordre de pose</name><styleUrl>#route</styleUrl><LineString><coordinates>${route}</coordinates></LineString></Placemark>
</Document></kml>
`;
}

export function buildCSV(p: Project, geo: Geo): string {
  const rows = [['Ancre', 'Latitude', 'Longitude', 'Latitude (DM)', 'Longitude (DM)', 'X local (m)', 'Z local (m)', 'Modules']];
  for (const a of geoAnchors(p, geo)) {
    rows.push([id3(a.n), a.lat.toFixed(7), a.lon.toFixed(7), dms(a.lat, 'N', 'S'), dms(a.lon, 'E', 'O'), a.x.toFixed(2), a.z.toFixed(2), a.modules.join(' + ')]);
  }
  return '﻿' + rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(';')).join('\r\n');
}

export function exportAnchors(p: Project, geo: Geo, format: 'gpx' | 'kml' | 'csv') {
  const base = `${slug(p.name)}-ancrages`;
  if (format === 'gpx') download(`${base}.gpx`, buildGPX(p, geo), 'application/gpx+xml');
  if (format === 'kml') download(`${base}.kml`, buildKML(p, geo), 'application/vnd.google-earth.kml+xml');
  if (format === 'csv') download(`${base}.csv`, buildCSV(p, geo), 'text/csv;charset=utf-8');
}

/** Plan imprimable : carte vectorielle numérotée + tableau des coordonnées. */
export function printAnchorPlan(p: Project, geo: Geo): boolean {
  const anchors = geoAnchors(p, geo);
  const w = window.open('', '_blank');
  if (!w) return false;
  const pts = [...anchors.map((a) => ({ x: a.x, z: a.z })), ...p.modules.flatMap((m) => obbCorners(moduleOBB(m, spec(m.type))))];
  const minX = Math.min(...pts.map((q) => q.x)) - 4,
    maxX = Math.max(...pts.map((q) => q.x)) + 4;
  const minZ = Math.min(...pts.map((q) => q.z)) - 4,
    maxZ = Math.max(...pts.map((q) => q.z)) + 4;
  const W = 760,
    scale = W / (maxX - minX),
    H = (maxZ - minZ) * scale;
  const X = (x: number) => ((x - minX) * scale).toFixed(1);
  const Y = (z: number) => ((z - minZ) * scale).toFixed(1);
  const mods = p.modules
    .map((m) => `<polygon points="${obbCorners(moduleOBB(m, spec(m.type))).map((c) => `${X(c.x)},${Y(c.z)}`).join(' ')}" fill="#ffd34d" stroke="#8a6a00" stroke-width="1"/>`)
    .join('');
  const route = `<polyline points="${anchors.map((a) => `${X(a.x)},${Y(a.z)}`).join(' ')}" fill="none" stroke="#1d4ed8" stroke-width="0.8" stroke-dasharray="3 3"/>`;
  const dots = anchors.map((a) => `<circle cx="${X(a.x)}" cy="${Y(a.z)}" r="4" fill="#dc2626"/><text x="${+X(a.x) + 5}" y="${+Y(a.z) - 4}" font-size="9" fill="#111">${a.n}</text>`).join('');
  // flèche du nord : direction du nord dans le repère local
  const b = (geo.bearing * Math.PI) / 180;
  const nx = -Math.sin(b),
    nz = -Math.cos(b);
  const north = `<g transform="translate(${W - 40},40)"><line x1="${-nx * 18}" y1="${-nz * 18}" x2="${nx * 18}" y2="${nz * 18}" stroke="#111" stroke-width="2" marker-end="url(#arr)"/><text x="${nx * 30 - 4}" y="${nz * 30 + 4}" font-size="12" font-weight="700">N</text></g>`;
  const rows = anchors.map((a) => `<tr><td>${id3(a.n)}</td><td>${dms(a.lat, 'N', 'S')}</td><td>${dms(a.lon, 'E', 'O')}</td><td>${a.lat.toFixed(6)}, ${a.lon.toFixed(6)}</td><td>${a.modules.join(' + ')}</td></tr>`).join('');
  w.document.write(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${xml(p.name)} — plan d'ancrage</title>
<style>body{font:11px/1.4 Inter,system-ui,sans-serif;margin:24px;color:#111}h1{font-size:18px;margin:0}.muted{color:#555}
svg{border:1px solid #ccc;border-radius:6px;margin:12px 0;background:#e8f4fb}table{width:100%;border-collapse:collapse}
td,th{border-bottom:1px solid #ddd;padding:4px 6px;text-align:left}th{background:#f3f4f6}@media print{body{margin:10mm}}</style></head><body>
<h1>${xml(p.name)} — plan d'ancrage</h1>
<div class="muted">${anchors.length} ancres · centre ${geo.lat.toFixed(6)}, ${geo.lon.toFixed(6)} · azimut du large ${geo.bearing}° · ancres à ${'2,5'} m de l'emprise des modules · WGS84</div>
<svg width="${W}" height="${H.toFixed(0)}" viewBox="0 0 ${W} ${H.toFixed(0)}"><defs><marker id="arr" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z"/></marker></defs>${mods}${route}${dots}${north}</svg>
<p class="muted">Pose : suivre l'ordre de numérotation (tracé pointillé bleu), placer toutes les ancres avant d'amener les modules. Vérifier la profondeur et la nature du fond à chaque point.</p>
<table><thead><tr><th>Ancre</th><th>Latitude</th><th>Longitude</th><th>Décimal</th><th>Modules</th></tr></thead><tbody>${rows}</tbody></table>
<script>window.onload=()=>setTimeout(()=>window.print(),300)</script></body></html>`);
  w.document.close();
  return true;
}
