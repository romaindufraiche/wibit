// Données géographiques pour « mon site réel » : recherche d'adresse (Nominatim), contours de plans
// d'eau (Overpass / OpenStreetMap) et tuiles d'imagerie satellite relayées (texture du terrain 3D).
// Tout est mis en cache en mémoire pour ménager les services publics.

const UA = 'Parkcraft/0.1 (configurateur de parcs aquatiques; https://wibit-create.onrender.com)';
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
const TILE_URL = (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;

class Lru {
  constructor(max) {
    this.max = max;
    this.map = new Map();
  }
  get(k) {
    const v = this.map.get(k);
    if (v !== undefined) {
      this.map.delete(k);
      this.map.set(k, v);
    }
    return v;
  }
  set(k, v) {
    this.map.set(k, v);
    if (this.map.size > this.max) this.map.delete(this.map.keys().next().value);
  }
}
const searchCache = new Lru(300);
const waterCache = new Lru(200);
const tileCache = new Lru(800);

async function fetchWithTimeout(url, opts = {}, ms = 20000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctl.signal, headers: { 'user-agent': UA, ...(opts.headers ?? {}) } });
  } finally {
    clearTimeout(t);
  }
}

/** Recherche d'adresse / de lieu. Renvoie aussi le contour quand le résultat est un plan d'eau. */
export async function searchPlaces(q) {
  const key = q.toLowerCase();
  const hit = searchCache.get(key);
  if (hit) return hit;
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&polygon_geojson=1&polygon_threshold=0.00002&accept-language=fr&q=${encodeURIComponent(q)}`;
  const r = await fetchWithTimeout(url);
  if (!r.ok) throw Object.assign(new Error('Recherche indisponible pour le moment.'), { status: 502 });
  const rows = await r.json();
  const out = rows.map((p) => {
    const water = p.category === 'natural' && ['water', 'bay'].includes(p.type) ? true : p.category === 'water' || p.type === 'lake' || p.type === 'reservoir';
    return {
      name: p.display_name,
      lat: Number(p.lat),
      lon: Number(p.lon),
      bbox: p.boundingbox?.map(Number),
      water: !!water,
      rings: water ? geojsonRings(p.geojson) : [],
    };
  });
  searchCache.set(key, out);
  return out;
}

/** Anneaux extérieurs d'une géométrie GeoJSON (Polygon / MultiPolygon), en [lat, lon]. */
function geojsonRings(g) {
  if (!g) return [];
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
  return polys.map((poly) => poly[0].map(([lon, lat]) => [lat, lon]));
}

/** Assemble des tronçons (relations OSM) en anneaux fermés. */
export function stitchRings(segments) {
  const key = (p) => `${p[0].toFixed(7)},${p[1].toFixed(7)}`;
  const left = segments.filter((s) => s.length >= 2).map((s) => s.slice());
  const rings = [];
  while (left.length) {
    let ring = left.shift();
    let guard = 0;
    while (key(ring[0]) !== key(ring[ring.length - 1]) && guard++ < 10000) {
      const end = key(ring[ring.length - 1]);
      const i = left.findIndex((s) => key(s[0]) === end || key(s[s.length - 1]) === end);
      if (i < 0) break;
      const s = left.splice(i, 1)[0];
      ring = ring.concat(key(s[0]) === end ? s.slice(1) : s.reverse().slice(1));
    }
    if (ring.length >= 4 && key(ring[0]) === key(ring[ring.length - 1])) rings.push(ring);
  }
  return rings;
}

/** Plans d'eau (polygones) autour d'un point, d'après OpenStreetMap. */
export async function waterAround(lat, lon, radius = 800) {
  const key = `${lat.toFixed(4)},${lon.toFixed(4)},${radius}`;
  const hit = waterCache.get(key);
  if (hit) return hit;
  const q = `[out:json][timeout:25];
(
  way(around:${radius},${lat},${lon})["natural"="water"];
  relation(around:${radius},${lat},${lon})["natural"="water"];
  way(around:${radius},${lat},${lon})["water"];
  relation(around:${radius},${lat},${lon})["water"];
  way(around:${radius},${lat},${lon})["leisure"="swimming_area"];
  way(around:${radius},${lat},${lon})["landuse"="reservoir"];
  relation(around:${radius},${lat},${lon})["landuse"="reservoir"];
);
out geom;`;
  let data = null;
  let lastErr = null;
  for (const url of OVERPASS) {
    try {
      const r = await fetchWithTimeout(url, { method: 'POST', body: new URLSearchParams({ data: q }) }, 12000);
      if (!r.ok) throw new Error(`Overpass ${r.status}`);
      data = await r.json();
      break;
    } catch (e) {
      lastErr = e;
    }
  }
  if (!data) throw Object.assign(new Error('Service cartographique indisponible, réessayez ou dessinez le contour à la main.'), { status: 502, cause: lastErr });
  const result = parseOverpassWater(data);
  waterCache.set(key, result);
  return result;
}

/** Transforme une réponse Overpass (out geom) en polygones d'eau [{ name, rings }] — exporté pour les tests. */
export function parseOverpassWater(data) {
  const out = [];
  for (const el of data.elements ?? []) {
    const name = el.tags?.name ?? el.tags?.water ?? 'Plan d’eau';
    if (el.type === 'way' && el.geometry?.length >= 4) {
      const ring = el.geometry.map((p) => [p.lat, p.lon]);
      const a = ring[0],
        b = ring[ring.length - 1];
      if (a[0] === b[0] && a[1] === b[1]) out.push({ name, rings: [ring] });
    }
    if (el.type === 'relation') {
      const outer = (el.members ?? []).filter((m) => m.type === 'way' && m.role !== 'inner' && m.geometry?.length).map((m) => m.geometry.map((p) => [p.lat, p.lon]));
      const rings = stitchRings(outer);
      if (rings.length) out.push({ name, rings });
    }
  }
  return out;
}

/** Tuile satellite relayée (même origine que l'outil : utilisable comme texture WebGL). */
export async function satelliteTile(z, x, y) {
  const key = `${z}/${x}/${y}`;
  const hit = tileCache.get(key);
  if (hit) return hit;
  const r = await fetchWithTimeout(TILE_URL(z, x, y), {}, 15000);
  if (!r.ok) throw Object.assign(new Error('Tuile indisponible'), { status: 502 });
  const buf = Buffer.from(await r.arrayBuffer());
  const tile = { type: r.headers.get('content-type') ?? 'image/jpeg', buf };
  tileCache.set(key, tile);
  return tile;
}
