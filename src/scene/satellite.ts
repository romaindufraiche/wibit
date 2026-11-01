import * as THREE from 'three';
import { toLatLon } from '../core/anchors';
import type { Geo } from '../core/types';

/*
 * Imagerie satellite du site réel : mosaïque de tuiles (relayées par notre serveur pour pouvoir
 * servir de texture WebGL), puis coordonnées de texture calculées pour chaque sommet à partir
 * de sa position réelle (repère local -> GPS -> projection Web Mercator).
 */

const TILE = 256;
const mercX = (lon: number, z: number) => ((lon + 180) / 360) * TILE * 2 ** z;
const mercY = (lat: number, z: number) => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * TILE * 2 ** z;
};

export interface SatImage {
  texture: THREE.CanvasTexture;
  /** Coordonnées de texture d'un point du repère local. */
  uv(x: number, z: number): [number, number];
}

const cache = new Map<string, Promise<SatImage | null>>();

/** Charge l'imagerie couvrant le rectangle local [minX, maxX] × [minZ, maxZ]. */
export function loadSatellite(geo: Geo, box: { minX: number; maxX: number; minZ: number; maxZ: number }): Promise<SatImage | null> {
  const key = `${geo.lat},${geo.lon},${geo.bearing},${Object.values(box).map((v) => v.toFixed(0)).join(',')}`;
  let p = cache.get(key);
  if (!p) {
    p = build(geo, box).catch(() => null);
    cache.set(key, p);
  }
  return p;
}

async function build(geo: Geo, box: { minX: number; maxX: number; minZ: number; maxZ: number }): Promise<SatImage | null> {
  const corners = [
    [box.minX, box.minZ],
    [box.maxX, box.minZ],
    [box.maxX, box.maxZ],
    [box.minX, box.maxZ],
  ].map(([x, z]) => toLatLon(geo, x, z));
  // zoom le plus fin possible sans dépasser ~4096 px de côté
  let z = 18;
  let px: number[] = [],
    py: number[] = [];
  for (; z >= 12; z--) {
    px = corners.map((c) => mercX(c.lon, z));
    py = corners.map((c) => mercY(c.lat, z));
    if (Math.max(...px) - Math.min(...px) < 4096 && Math.max(...py) - Math.min(...py) < 4096) break;
  }
  const tx0 = Math.floor(Math.min(...px) / TILE),
    tx1 = Math.floor(Math.max(...px) / TILE);
  const ty0 = Math.floor(Math.min(...py) / TILE),
    ty1 = Math.floor(Math.max(...py) / TILE);
  const canvas = document.createElement('canvas');
  canvas.width = (tx1 - tx0 + 1) * TILE;
  canvas.height = (ty1 - ty0 + 1) * TILE;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#6f8f5a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const jobs: Promise<void>[] = [];
  let ok = 0;
  for (let tx = tx0; tx <= tx1; tx++)
    for (let ty = ty0; ty <= ty1; ty++) {
      jobs.push(
        new Promise((resolve) => {
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = () => {
            ctx.drawImage(img, (tx - tx0) * TILE, (ty - ty0) * TILE);
            ok++;
            resolve();
          };
          img.onerror = () => resolve();
          img.src = `/api/geo/tile/${z}/${tx}/${ty}`;
        }),
      );
    }
  await Promise.all(jobs);
  if (!ok) return null;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  const ox = tx0 * TILE,
    oy = ty0 * TILE;
  const zoom = z;
  return {
    texture,
    uv(x: number, zz: number) {
      const g = toLatLon(geo, x, zz);
      return [(mercX(g.lon, zoom) - ox) / canvas.width, 1 - (mercY(g.lat, zoom) - oy) / canvas.height];
    },
  };
}

/** Recalcule les coordonnées de texture d'une géométrie horizontale à partir de ses positions. */
export function applyGeoUV(geometry: THREE.BufferGeometry, sat: SatImage) {
  const pos = geometry.getAttribute('position');
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const [u, v] = sat.uv(pos.getX(i), pos.getZ(i));
    uv[i * 2] = u;
    uv[i * 2 + 1] = v;
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

export const SAT_ATTRIBUTION = 'Imagerie © Esri, Maxar, Earthstar Geographics · Contours © OpenStreetMap';
