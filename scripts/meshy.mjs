// Génère les modèles 3D réalistes des modules avec Meshy (Image to 3D), à partir des rendus
// produits officiels listés dans src/catalog/references.json (scripts/wibit-references.mjs).
// Les GLB sont écrits dans public/models/<id>.glb et déclarés dans public/models/index.json :
// l'application les charge automatiquement à la place du rendu procédural.
//
//   MESHY_API_KEY=msy_... node scripts/meshy.mjs guardtower actiontower-xl   (quelques modules)
//   MESHY_API_KEY=msy_... node scripts/meshy.mjs --all                        (tout le catalogue)
//   options : --force (régénère même si le GLB existe), --polycount=15000, --concurrency=3
//
// Chaque génération consomme des crédits Meshy : commencer par 2 ou 3 modules pour valider le rendu.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public', 'models');
const API = 'https://api.meshy.ai/openapi/v1/image-to-3d';
const KEY = process.env.MESHY_API_KEY;
if (!KEY) {
  console.error('Définissez MESHY_API_KEY (clé API Meshy, https://www.meshy.ai/api).');
  process.exit(1);
}

const args = process.argv.slice(2);
const opt = (name, def) => Number(args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? def);
const force = args.includes('--force');
const refs = JSON.parse(readFileSync(join(ROOT, 'src/catalog/references.json'), 'utf8')).modules;
const wanted = args.includes('--all') ? Object.keys(refs) : args.filter((a) => !a.startsWith('--'));
if (!wanted.length) {
  console.error('Indiquez des ids de modules (ex. guardtower) ou --all.');
  process.exit(1);
}
mkdirSync(OUT, { recursive: true });
const manifestPath = join(OUT, 'index.json');
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {};
const saveManifest = () => writeFileSync(manifestPath, JSON.stringify(manifest, null, 1) + '\n');

const headers = { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function generate(id) {
  const ref = refs[id];
  if (!ref?.render) return console.warn(`· ${id} : pas de rendu officiel, ignoré`);
  if (!force && manifest[id] && existsSync(join(OUT, manifest[id].file))) return console.log(`· ${id} : déjà généré`);
  const res = await fetch(API, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      image_url: ref.render,
      ai_model: 'latest',
      should_texture: true,
      enable_pbr: false,
      should_remesh: true,
      topology: 'triangle',
      target_polycount: opt('polycount', 15000),
      target_formats: ['glb'],
      texture_prompt: `Inflatable floating water park module "${ref.name}" made of glossy PVC, keep the original colors and printed logos.`,
    }),
  });
  if (!res.ok) throw new Error(`${id} : création refusée (${res.status}) ${await res.text()}`);
  const task = (await res.json()).result;
  console.log(`· ${id} : tâche ${task} créée`);
  for (;;) {
    await sleep(8000);
    const t = await (await fetch(`${API}/${task}`, { headers })).json();
    if (t.status === 'SUCCEEDED') {
      const glb = await fetch(t.model_urls.glb);
      writeFileSync(join(OUT, `${id}.glb`), Buffer.from(await glb.arrayBuffer()));
      manifest[id] = { file: `${id}.glb`, task, source: ref.render, credits: t.consumed_credits ?? null, at: new Date().toISOString().slice(0, 10) };
      saveManifest();
      return console.log(`✓ ${id} : public/models/${id}.glb (${t.consumed_credits ?? '?'} crédits)`);
    }
    if (t.status === 'FAILED' || t.status === 'CANCELED') throw new Error(`${id} : ${t.status} ${t.task_error?.message ?? ''}`);
    process.stdout.write(`  ${id} ${t.progress ?? 0} %\r`);
  }
}

// quelques générations en parallèle
const queue = [...wanted];
const workers = Array.from({ length: Math.max(1, opt('concurrency', 3)) }, async () => {
  while (queue.length) {
    const id = queue.shift();
    try {
      await generate(id);
    } catch (e) {
      console.error(`✗ ${e.message}`);
    }
  }
});
await Promise.all(workers);
console.log(`Terminé : ${Object.keys(manifest).length} modèle(s) dans public/models/index.json. Rebuild (npm run build) puis redéploiement pour les publier.`);
