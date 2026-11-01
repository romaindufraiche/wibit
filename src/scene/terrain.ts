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
  if (site.kind === 'pool') return buildPoolTerrain(site);
  const t = textures();
  // site réel : le décor suit les vraies berges, même au-delà de la zone de travail
  const P = site.shore && site.shore.length >= 3 ? site.shore : siteOutline(site);
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

// ------------------------------------------------------------------ piscine

let poolCache: { tiles: THREE.Texture; floor: THREE.Texture; deck: THREE.Texture } | null = null;

/** Carrelage (8 × 8 carreaux de 25 cm par motif de 2 m), dallage de plage (4 × 4 dalles de 50 cm). */
function poolTextures() {
  if (poolCache) return poolCache;
  const tiling = (base: string, grout: string, n: number, jitter: number) =>
    noiseCanvas(512, (ctx, rnd) => {
      const s = 512 / n;
      for (let i = 0; i < n; i++)
        for (let j = 0; j < n; j++) {
          const k = (rnd() - 0.5) * jitter;
          ctx.fillStyle = base;
          ctx.fillRect(i * s, j * s, s, s);
          ctx.fillStyle = `rgba(${k > 0 ? '255,255,255' : '0,40,70'},${Math.abs(k) / 100})`;
          ctx.fillRect(i * s, j * s, s, s);
        }
      ctx.strokeStyle = grout;
      ctx.lineWidth = n > 6 ? 3 : 5;
      for (let i = 0; i <= n; i++) {
        ctx.beginPath();
        ctx.moveTo(i * s, 0);
        ctx.lineTo(i * s, 512);
        ctx.moveTo(0, i * s);
        ctx.lineTo(512, i * s);
        ctx.stroke();
      }
    });
  const deck = noiseCanvas(512, (ctx, rnd) => {
    const s = 128;
    for (let i = 0; i < 4; i++)
      for (let j = 0; j < 4; j++) {
        const k = (rnd() - 0.5) * 14;
        ctx.fillStyle = `rgb(${196 + k},${182 + k},${160 + k})`;
        ctx.fillRect(i * s, j * s, s, s);
      }
    for (let i = 0; i < 9000; i++) {
      const k = (rnd() - 0.5) * 40;
      ctx.fillStyle = `rgba(${170 + k},${156 + k},${134 + k},0.5)`;
      ctx.fillRect(rnd() * 512, rnd() * 512, 1.5, 1.5);
    }
    ctx.strokeStyle = 'rgb(150,138,118)';
    ctx.lineWidth = 4;
    for (let i = 0; i <= 4; i++) {
      ctx.beginPath();
      ctx.moveTo(i * s, 0);
      ctx.lineTo(i * s, 512);
      ctx.moveTo(0, i * s);
      ctx.lineTo(512, i * s);
      ctx.stroke();
    }
  });
  poolCache = { tiles: tiling('#d7f0f8', '#a9d3e2', 8, 10), floor: tiling('#bfe7f5', '#9fcfe0', 8, 8), deck };
  return poolCache;
}

const POOL_DECK = 10; // plage dallée autour du bassin (m)
const COPING_Y = 0.3; // margelle au-dessus de l'eau (m)

/** Bassin de piscine : parois et fond carrelés, lignes de nage, margelle, plage dallée, pelouse. */
function buildPoolTerrain(site: Site): Terrain {
  const t = poolTextures();
  const P = siteOutline(site);
  const b = bounds(P);
  const R = Math.max(b.maxX - b.minX, b.maxZ - b.minZ) / 2 + 300;
  const group = new THREE.Group();
  const rect = (x0: number, z0: number, x1: number, z1: number): Vec2[] => [
    { x: x0, z: z0 },
    { x: x1, z: z0 },
    { x: x1, z: z1 },
    { x: x0, z: z1 },
  ];
  const tex = (src: THREE.Texture, rx: number, ry: number) => {
    const c = src.clone();
    c.repeat.set(rx, ry);
    c.needsUpdate = true;
    return c;
  };
  const depth = Math.min(site.depth, 6);

  const grassTex = textures().grass.clone();
  grassTex.repeat.set(1 / 14, 1 / 14);
  grassTex.needsUpdate = true;
  const grass = flat(rect(-R, -R, R, R), [offsetPolygon(P, POOL_DECK - 0.5)], COPING_Y - 0.02, new THREE.MeshStandardMaterial({ map: grassTex, roughness: 1 }));
  const deck = flat(offsetPolygon(P, POOL_DECK), [offsetPolygon(P, 0.45)], COPING_Y, new THREE.MeshStandardMaterial({ map: tex(t.deck, 1 / 2, 1 / 2), roughness: 0.9 }));
  // margelle : pierre claire légèrement en surplomb
  const coping = flat(offsetPolygon(P, 0.45), [offsetPolygon(P, -0.05)], COPING_Y + 0.04, new THREE.MeshStandardMaterial({ color: 0xf4f1ea, roughness: 0.7 }));
  const copingEdge = band(offsetPolygon(P, -0.05), COPING_Y + 0.04, offsetPolygon(P, -0.05), COPING_Y - 0.06, new THREE.MeshStandardMaterial({ color: 0xe9e4d8, roughness: 0.7, side: THREE.DoubleSide }), 1);
  // parois carrelées
  const wallTex = tex(t.tiles, 1 / 2, (depth + COPING_Y) / 2);
  const walls = band(P, COPING_Y, P, -depth, new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.35, side: THREE.DoubleSide }), 1);
  // ligne d'eau : frise de carreaux plus foncés
  const frieze = band(offsetPolygon(P, -0.01), 0.12, offsetPolygon(P, -0.01), -0.12, new THREE.MeshStandardMaterial({ color: 0x1f6fa8, roughness: 0.4, side: THREE.DoubleSide }), 1);
  // fond carrelé et lignes de nage (dans le sens de la longueur)
  const floor = flat(P, [], -depth, new THREE.MeshStandardMaterial({ map: tex(t.floor, 1 / 2, 1 / 2), roughness: 0.4 }));
  const laneMat = new THREE.MeshStandardMaterial({ color: 0x163f7a, roughness: 0.5 });
  const L = b.maxX - b.minX,
    W = b.maxZ - b.minZ;
  const lanes = Math.max(2, Math.round(W / 2.5));
  for (let i = 1; i < lanes; i++) {
    const z = b.minZ + (W * i) / lanes;
    const line = flat(rect(b.minX + 2, z - 0.12, b.maxX - 2, z + 0.12), [], -depth + 0.01, laneMat);
    group.add(line);
    // T de fin de ligne
    for (const x of [b.minX + 2, b.maxX - 2]) group.add(flat(rect(x - 0.12, z - 0.5, x + 0.12, z + 0.5), [], -depth + 0.01, laneMat));
  }
  group.add(poolFittings(b.minX, b.maxX, b.minZ, b.maxZ, lanes));
  void L;
  const foamMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false });
  grass.name = deck.name = 'land';
  group.add(grass, deck, coping, copingEdge, walls, frieze, floor);
  return { group, land: [deck, grass], foam: foamMat };
}

/** Équipements fixes : échelles inox, plots de départ, haie, bordure de plage, local technique et arbres. */
function poolFittings(x0: number, x1: number, z0: number, z1: number, lanes: number): THREE.Group {
  const g = new THREE.Group();
  const inox = new THREE.MeshStandardMaterial({ color: 0xdfe5ea, roughness: 0.2, metalness: 0.9 });
  const white = new THREE.MeshStandardMaterial({ color: 0xf7f7f4, roughness: 0.5 });
  const navy = new THREE.MeshStandardMaterial({ color: 0x003865, roughness: 0.5 });
  const hedgeMat = new THREE.MeshStandardMaterial({ color: 0x3e7a35, roughness: 0.95 });
  const box = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number) => {
    const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    o.position.set(x, y + h / 2, z);
    o.castShadow = o.receiveShadow = true;
    g.add(o);
    return o;
  };
  const Y = COPING_Y;
  const L = x1 - x0,
    W = z1 - z0;

  // échelles : deux mains courantes en col de cygne + marches immergées, sur chaque grand côté
  const ladder = (x: number, z: number, dir: 1 | -1) => {
    for (const dx of [-0.3, 0.3]) {
      const arc = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.025, 6, 12, Math.PI), inox);
      arc.rotation.y = Math.PI / 2;
      arc.position.set(x + dx, Y + 0.35, z + dir * 0.35);
      arc.castShadow = true;
      g.add(arc);
      const down = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.6, 6), inox);
      down.position.set(x + dx, Y + 0.35 - 0.8, z - dir * 0.02);
      g.add(down);
      const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, Y + 0.35, 6), inox);
      foot.position.set(x + dx, (Y + 0.35) / 2, z + dir * 0.7);
      g.add(foot);
    }
    for (let k = 0; k < 3; k++) box(0.6, 0.04, 0.12, inox, x, -0.25 - k * 0.3, z - dir * 0.08);
  };
  for (const x of [x0 + 2.5, x1 - 2.5]) {
    ladder(x, z1, 1);
    ladder(x, z0, -1);
  }

  // plots de départ sur le petit côté droit, un par ligne d'eau
  for (let i = 0; i < lanes; i++) {
    const z = z0 + (W * (i + 0.5)) / lanes;
    box(0.55, 0.45, 0.55, white, x1 + 0.55, Y, z);
    const top = box(0.6, 0.06, 0.6, navy, x1 + 0.5, Y + 0.45, z);
    top.rotation.z = 0.12;
  }

  // bordure de plage et haie (ouverte au milieu du côté accès, +z)
  const D = POOL_DECK;
  const ox0 = x0 - D,
    ox1 = x1 + D,
    oz0 = z0 - D,
    oz1 = z1 + D;
  const border = new THREE.MeshStandardMaterial({ color: 0xb5ab98, roughness: 0.9 });
  box(ox1 - ox0, 0.06, 0.4, border, (ox0 + ox1) / 2, Y - 0.02, oz0 + 0.2);
  box(ox1 - ox0, 0.06, 0.4, border, (ox0 + ox1) / 2, Y - 0.02, oz1 - 0.2);
  box(0.4, 0.06, oz1 - oz0, border, ox0 + 0.2, Y - 0.02, (oz0 + oz1) / 2);
  box(0.4, 0.06, oz1 - oz0, border, ox1 - 0.2, Y - 0.02, (oz0 + oz1) / 2);
  const hedge = (ax: number, az: number, bx: number, bz: number) => {
    const len = Math.hypot(bx - ax, bz - az);
    const o = box(len, 1.1, 0.8, hedgeMat, (ax + bx) / 2, Y - 0.02, (az + bz) / 2);
    o.rotation.y = -Math.atan2(bz - az, bx - ax);
  };
  const hz = 0.9;
  hedge(ox0 - hz, oz0 - hz, ox1 + hz, oz0 - hz);
  hedge(ox0 - hz, oz0 - hz, ox0 - hz, oz1 + hz);
  hedge(ox1 + hz, oz0 - hz, ox1 + hz, oz1 + hz);
  const gap = Math.min(6, L / 3);
  hedge(ox0 - hz, oz1 + hz, -gap / 2, oz1 + hz);
  hedge(gap / 2, oz1 + hz, ox1 + hz, oz1 + hz);

  // local technique / vestiaires derrière les gradins
  const hw = Math.min(Math.max(L * 0.7, 14), 34);
  const hz0 = oz0 - 9;
  const wall = new THREE.MeshStandardMaterial({ color: 0xf2efe8, roughness: 0.8 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x7fb6cf, roughness: 0.1, metalness: 0.3 });
  box(hw, 3.6, 8, wall, (x0 + x1) / 2, Y, hz0);
  box(hw * 0.9, 1.4, 0.1, glass, (x0 + x1) / 2, Y + 1.3, hz0 + 4.02);
  box(hw + 1.2, 0.35, 9.2, navy, (x0 + x1) / 2, Y + 3.6, hz0 + 0.3);
  box(hw * 0.3, 0.12, 0.6, new THREE.MeshStandardMaterial({ color: 0xc8d400, roughness: 0.6 }), (x0 + x1) / 2, Y + 3.95, hz0 + 4.6);

  // arbres autour de l'enceinte
  const trunk = new THREE.MeshStandardMaterial({ color: 0x7a5a3c, roughness: 1 });
  const crowns = [0x3f7f3a, 0x4d8c3f, 0x356f33].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.95 }));
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const ring = [
    ...Array.from({ length: 6 }, (_, i) => [ox0 - 6 - rnd() * 6, oz0 + ((oz1 - oz0) * (i + 0.5)) / 6]),
    ...Array.from({ length: 6 }, (_, i) => [ox1 + 6 + rnd() * 6, oz0 + ((oz1 - oz0) * (i + 0.5)) / 6]),
    ...Array.from({ length: 5 }, (_, i) => [ox0 + ((ox1 - ox0) * (i + 0.5)) / 5, oz1 + 7 + rnd() * 6]),
  ];
  for (const [x, z] of ring) {
    const h = 2.5 + rnd() * 2;
    const t = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.25, h, 6), trunk);
    t.position.set(x, Y + h / 2, z);
    t.castShadow = true;
    g.add(t);
    const c = new THREE.Mesh(new THREE.IcosahedronGeometry(1.8 + rnd() * 1.2, 1), crowns[Math.floor(rnd() * 3)]);
    c.position.set(x, Y + h + 1.2, z);
    c.castShadow = true;
    g.add(c);
  }
  return g;
}
