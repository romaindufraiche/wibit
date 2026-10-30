import * as THREE from 'three';
import { bounds, offsetPolygon, siteOutline } from '../core/region';
import type { Site, Vec2 } from '../core/types';

/*
 * Terrain autour du plan d'eau : plage de sable (texture procédurale avec grains, coquillages
 * et laisse de mer), pente immergée en sable mouillé, écume au bord de l'eau, puis pelouse.
 * Tout suit le contour (éventuellement remodelé) du plan d'eau.
 */

const SAND_W = 16; // largeur de plage (m)
const SLOPE_W = 4; // pente immergée (m)

function noiseCanvas(size: number, paint: (ctx: CanvasRenderingContext2D, rnd: () => number) => void) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  paint(ctx, rnd);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

let cache: { sand: THREE.Texture; wet: THREE.Texture; grass: THREE.Texture } | null = null;

function textures() {
  if (cache) return cache;
  const grains = (ctx: CanvasRenderingContext2D, rnd: () => number, size: number, base: [number, number, number], n: number, spread: number) => {
    ctx.fillStyle = `rgb(${base.join(',')})`;
    ctx.fillRect(0, 0, size, size);
    // taches basse fréquence (sable plus ou moins tassé)
    for (let i = 0; i < 160; i++) {
      const r = 12 + rnd() * 40;
      const x = rnd() * size,
        y = rnd() * size;
      const k = (rnd() - 0.5) * 16;
      // copies décalées pour que la texture se répète sans couture
      for (const [ox, oy] of [[0, 0], [size, 0], [-size, 0], [0, size], [0, -size]]) {
        const g = ctx.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
        g.addColorStop(0, `rgba(${base[0] + k},${base[1] + k},${base[2] + k},0.22)`);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.fillRect(x + ox - r, y + oy - r, r * 2, r * 2);
      }
    }
    // grains
    for (let i = 0; i < n; i++) {
      const k = (rnd() - 0.5) * spread;
      ctx.fillStyle = `rgba(${base[0] + k},${base[1] + k - 4},${base[2] + k - 8},${0.35 + rnd() * 0.5})`;
      const s = rnd() < 0.96 ? 1 : 2;
      ctx.fillRect(rnd() * size, rnd() * size, s, s);
    }
  };
  const sand = noiseCanvas(512, (ctx, rnd) => {
    grains(ctx, rnd, 512, [246, 220, 168], 70000, 46);
    // petits coquillages et cailloux
    for (let i = 0; i < 40; i++) {
      ctx.fillStyle = rnd() < 0.5 ? 'rgba(250,244,230,0.9)' : 'rgba(140,120,95,0.6)';
      ctx.beginPath();
      ctx.ellipse(rnd() * 512, rnd() * 512, 1.5 + rnd() * 2.5, 1 + rnd() * 1.5, rnd() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    // traces de vent
    ctx.strokeStyle = 'rgba(205,180,135,0.14)';
    for (let i = 0; i < 30; i++) {
      ctx.lineWidth = 1 + rnd() * 2;
      ctx.beginPath();
      const y = rnd() * 512;
      ctx.moveTo(0, y);
      for (let x = 0; x <= 512; x += 32) ctx.lineTo(x, y + Math.sin(x / 40 + i) * 4);
      ctx.stroke();
    }
  });
  const wet = noiseCanvas(256, (ctx, rnd) => grains(ctx, rnd, 256, [205, 182, 140], 18000, 36));
  const grass = noiseCanvas(512, (ctx, rnd) => {
    ctx.fillStyle = 'rgb(112,158,78)';
    ctx.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 160; i++) {
      const r = 16 + rnd() * 40;
      const x = rnd() * 512,
        y = rnd() * 512;
      const c = rnd() < 0.5 ? 'rgba(140,175,90,0.22)' : 'rgba(85,128,62,0.22)';
      for (const [ox, oy] of [[0, 0], [512, 0], [-512, 0], [0, 512], [0, -512]]) {
        const g = ctx.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
        g.addColorStop(0, c);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.fillRect(x + ox - r, y + oy - r, r * 2, r * 2);
      }
    }
    for (let i = 0; i < 26000; i++) {
      const k = (rnd() - 0.5) * 60;
      ctx.strokeStyle = `rgba(${95 + k},${145 + k},${65 + k * 0.5},0.55)`;
      const x = rnd() * 512,
        y = rnd() * 512;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + (rnd() - 0.5) * 3, y - 2 - rnd() * 4);
      ctx.stroke();
    }
  });
  cache = { sand, wet, grass };
  return cache;
}

/** Forme plane (x, z) -> mesh horizontal à la hauteur y ; UV en mètres. */
function flat(outer: Vec2[], holes: Vec2[][], y: number, mat: THREE.Material): THREE.Mesh {
  const shape = new THREE.Shape(outer.map((p) => new THREE.Vector2(p.x, -p.z)));
  for (const h of holes) shape.holes.push(new THREE.Path(h.map((p) => new THREE.Vector2(p.x, -p.z))));
  const geo = new THREE.ShapeGeometry(shape, 1);
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, y, 0);
  const m = new THREE.Mesh(geo, mat);
  m.receiveShadow = true;
  return m;
}

/** Bande entre deux contours de même nombre de points (pente, écume). */
function band(a: Vec2[], ya: number, b: Vec2[], yb: number, mat: THREE.Material, uvScale = 0.25): THREE.Mesh {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  let run = 0;
  for (let i = 0; i <= a.length; i++) {
    const k = i % a.length;
    if (i > 0) run += Math.hypot(a[k].x - a[i - 1].x, a[k].z - a[i - 1].z);
    pos.push(a[k].x, ya, a[k].z, b[k].x, yb, b[k].z);
    uv.push(run * uvScale, 0, run * uvScale, 1);
    if (i > 0) {
      const j = i * 2;
      idx.push(j - 2, j - 1, j, j - 1, j + 1, j);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, mat);
  m.receiveShadow = true;
  return m;
}

export interface Terrain {
  group: THREE.Group;
  /** Meshes cliquables de la terre ferme (pour passer en mode « remodeler le rivage »). */
  land: THREE.Mesh[];
  foam: THREE.MeshBasicMaterial;
}

export function buildTerrain(site: Site): Terrain {
  const t = textures();
  const P = siteOutline(site);
  const b = bounds(P);
  const R = Math.max(b.maxX - b.minX, b.maxZ - b.minZ) / 2 + 400;
  const cx = (b.minX + b.maxX) / 2,
    cz = (b.minZ + b.maxZ) / 2;
  const square: Vec2[] = [
    { x: cx - R, z: cz - R },
    { x: cx + R, z: cz - R },
    { x: cx + R, z: cz + R },
    { x: cx - R, z: cz + R },
  ];
  const group = new THREE.Group();

  const sandTex = t.sand.clone();
  sandTex.repeat.set(1 / 10, 1 / 10);
  sandTex.needsUpdate = true;
  const grassTex = t.grass.clone();
  grassTex.repeat.set(1 / 14, 1 / 14);
  grassTex.needsUpdate = true;
  const wetTex = t.wet.clone();
  wetTex.repeat.set(1, 1);
  wetTex.needsUpdate = true;

  // légère émission teintée : le sable reste chaud et lumineux malgré l'exposition basse de la scène
  const sandMat = new THREE.MeshStandardMaterial({ map: sandTex, roughness: 0.97, color: 0xffffff, emissive: 0xffe2b0, emissiveMap: sandTex, emissiveIntensity: 0.22 });
  const grassMat = new THREE.MeshStandardMaterial({ map: grassTex, roughness: 1 });
  const wetMat = new THREE.MeshStandardMaterial({ map: wetTex, roughness: 0.55, color: 0xffffff });

  const beachOuter = offsetPolygon(P, SAND_W);
  const sand = flat(beachOuter, [P], 0.12, sandMat);
  const grass = flat(square, [offsetPolygon(P, SAND_W - 1)], 0.16, grassMat);
  // pente immergée : du bord (au sec) vers le fond
  const slope = band(P, 0.12, offsetPolygon(P, -SLOPE_W), -1.4, wetMat);
  // sable mouillé juste au-dessus de la ligne d'eau
  const wetBand = band(offsetPolygon(P, 1.6), 0.125, P, 0.121, wetMat);
  const foamMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false });
  const foam = band(offsetPolygon(P, -0.2), 0.01, offsetPolygon(P, -1.1), 0.01, foamMat);
  const bottom = flat(offsetPolygon(P, -SLOPE_W + 0.2), [], -Math.min(site.depth, 3) * 0.7, new THREE.MeshStandardMaterial({ color: 0x5aa6c2, roughness: 1 }));
  sand.name = grass.name = 'land';
  group.add(grass, sand, wetBand, slope, foam, bottom);
  return { group, land: [sand, grass], foam: foamMat };
}
