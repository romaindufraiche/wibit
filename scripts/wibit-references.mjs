// Références visuelles officielles des modules : lit la page « All modules » du site Wibit Sports,
// associe chaque fiche (nom, dimensions, hauteur, profondeur, rendu produit, photos) à un module
// du catalogue et écrit src/catalog/references.json. Ces rendus servent de base à la génération
// des modèles 3D (scripts/meshy.mjs).
//
//   node scripts/wibit-references.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PAGE = 'https://www.wibitsports.com/all-modules/';

const decode = (s) =>
  s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#8242;|&#8243;/g, "'")
    .trim();
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

const html = await (await fetch(PAGE, { headers: { 'user-agent': 'Mozilla/5.0 (Parkcraft references)' } })).text();

// fiches dans l'ordre de la page : images du carrousel, puis titre, puis caractéristiques
const re = /<img[^>]+src="(https:\/\/www\.wibitsports\.com\/wp-content\/uploads\/[^"]+)"|<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>|Dimensions:\s*([^<]+)|Height:\s*([^<]+)|Min\. Water Depth:\s*([^<]+)/g;
const sheets = [];
let pending = [];
for (const m of html.matchAll(re)) {
  if (m[1]) {
    if (!/Logo/i.test(m[1])) pending.push(m[1]);
  } else if (m[2] !== undefined) {
    sheets.push({ name: decode(m[2].replace(/<[^>]+>/g, '')), images: pending });
    pending = [];
  } else if (sheets.length) {
    const last = sheets[sheets.length - 1];
    if (m[3]) last.dimensions = decode(m[3]);
    if (m[4]) last.height = decode(m[4]);
    if (m[5]) last.minDepth = decode(m[5]);
  }
}
const modules = sheets.filter((s) => s.dimensions);
for (const s of modules) s.article = s.images.map((u) => u.match(/\/(\d{5})[^/]*$/)?.[1]).find(Boolean) ?? null;

// catalogue de l'application : ids et noms
const src = readFileSync(join(ROOT, 'src/catalog/modules.ts'), 'utf8');
const ours = [...src.matchAll(/id: '([^']+)',\s*name: '([^']+)'/g)].map((m) => ({ id: m[1], name: m[2] }));

const byName = new Map();
for (const s of modules) byName.set(norm(s.name), [...(byName.get(norm(s.name)) ?? []), s]);
// homonymes de la page : V-Connect (30105) et Y-Connect (publié sous le nom « V-Connect », 30076)
const pick = (id, name) => {
  if (id === 'y-connect') return modules.find((s) => s.article === '30076');
  if (id === 'v-connect') return modules.find((s) => norm(s.name) === 'vconnect' && s.article !== '30076');
  const c = byName.get(norm(name)) ?? [];
  return c.find((s) => s.images.some((u) => /main|persp|\d{5}\.png/.test(u))) ?? c[0];
};
const isRender = (u) => /\.png$/i.test(u) || /persp|main/i.test(u);

const out = {};
const missing = [];
for (const { id, name } of ours) {
  const s = pick(id, name);
  if (!s) {
    missing.push(id);
    continue;
  }
  const render = s.images.filter(isRender).sort((a, b) => Number(/persp|main/.test(b)) - Number(/persp|main/.test(a)))[0] ?? null;
  out[id] = {
    name: s.name,
    article: s.article,
    render,
    photos: s.images.filter((u) => u !== render),
    dimensions: s.dimensions,
    height: s.height ?? null,
    minDepth: s.minDepth ?? null,
  };
}
writeFileSync(join(ROOT, 'src/catalog/references.json'), JSON.stringify({ source: PAGE, fetchedAt: new Date().toISOString().slice(0, 10), modules: out }, null, 1) + '\n');
console.log(`${Object.keys(out).length} modules référencés (${Object.values(out).filter((r) => r.render).length} avec rendu produit). Sans fiche : ${missing.join(', ') || 'aucun'}.`);
