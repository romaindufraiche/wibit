import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import REFS from '../catalog/references.json';
import { CATEGORY_LABELS, MODULES } from '../catalog/modules';
import type { Category, ModuleSpec } from '../core/types';
import { buildModel } from '../models/builders';
import { hasRealModel, loadRealModels, realModel } from '../models/glb';
import { isHandmade } from '../models/handmade';

/*
 * Catalogue 2D / 3D : pour chaque module, le rendu produit officiel (wibitsports.com) à côté de
 * sa version 3D dans l'outil (reconstruction GLB si elle existe, sinon modèle procédural),
 * avec les dimensions officielles et celles du catalogue. Un clic ouvre la 3D en rotation libre.
 */

interface Ref {
  name: string;
  article: string | null;
  render: string | null;
  photos: string[];
  dimensions: string;
  height: string | null;
  minDepth: string | null;
}
const refs = REFS.modules as Record<string, Ref>;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const num = (n: number) => String(Math.round(n * 100) / 100).replace('.', ',');
const eur = (n: number) => `${Math.round(n).toLocaleString('fr-FR')} €`;
const webp = (u: string) => (u.endsWith('.webp') ? u : `${u}.webp`);

const app = document.getElementById('app')!;
let category: Category | 'all' = 'all';
let query = '';
const shots = new Map<string, string>();

app.innerHTML = `
  <header class="top">
    <a class="brand" href="/"><span class="mark"></span>Parkcraft</a>
    <div class="title"><h1>Catalogue des modules</h1><p>Rendu produit officiel à gauche, version 3D de l'outil à droite</p></div>
    <div class="actions"><button class="btn" data-a="print">Imprimer / PDF</button><a class="btn primary" href="/">Ouvrir l'outil</a></div>
  </header>
  <nav class="filters">
    <input type="search" placeholder="Rechercher un module" data-k="q" />
    <div class="tabs">${[['all', 'Tous'], ...Object.entries(CATEGORY_LABELS)].map(([k, l]) => `<button data-c="${k}" class="${k === 'all' ? 'on' : ''}">${esc(l)}</button>`).join('')}</div>
    <span class="count"></span>
  </nav>
  <main class="list"></main>
  <footer class="foot">Rendus produits : wibitsports.com (page « All modules »). Palette 3D : jaune #F4CC00, vert #61AE2B, bleu #2F6FC2.</footer>`;
const list = app.querySelector<HTMLElement>('.list')!;

function card(s: ModuleSpec): string {
  const r = refs[s.id];
  const kind = isHandmade(s.id) ? '<span class="tag hand">3D modélisée</span>' : hasRealModel(s.id) ? '<span class="tag real">3D reconstruite</span>' : '<span class="tag">3D procédurale</span>';
  const img = r?.render ? `<img src="${esc(webp(r.render))}" data-orig="${esc(r.render)}" alt="${esc(r.name)}" loading="lazy" referrerpolicy="no-referrer">` : `<div class="noimg">Pas de rendu officiel</div>`;
  const shot = shots.get(s.id);
  return `<article class="card" data-id="${s.id}">
    <div class="head">
      <div><h2>${esc(s.name)}</h2><span class="sub">${esc(CATEGORY_LABELS[s.category])}${r?.article ? ` · réf. ${esc(r.article)}` : ''}</span></div>
      <span class="price">${eur(s.price)} HT</span>
    </div>
    <div class="pair">
      <figure class="side"><figcaption>Officiel (2D)</figcaption>${img}</figure>
      <figure class="side three"><figcaption>Outil (3D) ${kind}</figcaption>
        ${shot ? `<img src="${shot}" alt="">` : '<div class="pending">Rendu 3D…</div>'}
        <button class="rotate" data-a="view">Tourner en 3D</button></figure>
    </div>
    <dl class="specs">
      <div><dt>Dimensions officielles</dt><dd>${r ? esc(r.dimensions.split('/')[0].trim()) : '—'}</dd></div>
      <div><dt>Dans l'outil</dt><dd>${s.displaySize ?? `${num(s.L)} × ${num(s.W)} m`}</dd></div>
      <div><dt>Hauteur</dt><dd>${r?.height ? esc(r.height.split('/')[0].trim()) : `${num(s.H)} m`}</dd></div>
      <div><dt>Profondeur mini</dt><dd>${r?.minDepth ? esc(r.minDepth.split('/')[0].trim()) : `${num(s.depth)} m`}</dd></div>
      <div><dt>Capacité</dt><dd>${s.role === 'watch' ? 'Surveillance' : `${s.cap} pers.`}</dd></div>
    </dl>
  </article>`;
}

function draw() {
  const q = query.trim().toLowerCase();
  const items = MODULES.filter((s) => (category === 'all' || s.category === category) && (!q || `${s.name} ${refs[s.id]?.article ?? ''}`.toLowerCase().includes(q)));
  list.innerHTML = items.map(card).join('') || '<p class="empty">Aucun module.</p>';
  app.querySelector('.count')!.textContent = `${items.length} module${items.length > 1 ? 's' : ''}`;
}

// ---------------------------------------------------------------- rendus 3D (un seul contexte WebGL)

function model(s: ModuleSpec) {
  return realModel(s) ?? buildModel(s);
}

function renderShots(onDone: () => void) {
  const W = 480,
    H = 320;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setSize(W, H);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x446688, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(5, 10, 7);
  scene.add(sun);
  const camera = new THREE.PerspectiveCamera(30, W / H, 0.1, 500);
  const queue = [...MODULES];
  const step = () => {
    for (const s of queue.splice(0, 4)) {
      const m = model(s);
      scene.add(m);
      const box = new THREE.Box3().setFromObject(m);
      const size = box.getSize(new THREE.Vector3());
      const c = box.getCenter(new THREE.Vector3());
      const r = Math.max(size.x, size.y * 1.4, size.z) * 0.85 + 0.5;
      // même angle de vue que les rendus officiels (3/4 avant, en surplomb)
      camera.position.set(c.x + r * 1.1, c.y + r * 0.85, c.z + r * 1.5);
      camera.lookAt(c);
      renderer.render(scene, camera);
      shots.set(s.id, renderer.domElement.toDataURL('image/webp', 0.9));
      scene.remove(m);
      const fig = list.querySelector(`.card[data-id="${s.id}"] .three`);
      const pending = fig?.querySelector('.pending, img');
      if (pending) pending.outerHTML = `<img src="${shots.get(s.id)}" alt="">`;
    }
    if (queue.length) setTimeout(step, 10);
    else {
      renderer.dispose();
      onDone();
    }
  };
  setTimeout(step, 30);
}

// ---------------------------------------------------------------- visionneuse 3D

const dlg = document.getElementById('viewer') as HTMLDialogElement;
function openViewer(s: ModuleSpec) {
  const r = refs[s.id];
  dlg.innerHTML = `<div class="v-head"><b>${esc(s.name)}</b><span>Glisser pour tourner · molette pour zoomer</span><button class="btn" data-a="close">Fermer</button></div>
    <div class="v-body"><div class="v-2d">${r?.render ? `<img src="${esc(webp(r.render))}" alt="" referrerpolicy="no-referrer">` : ''}</div><div class="v-3d"></div></div>`;
  dlg.showModal();
  const host = dlg.querySelector<HTMLElement>('.v-3d')!;
  const w = host.clientWidth || 600,
    h = host.clientHeight || 420;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(w, h);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  host.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x446688, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(5, 10, 7);
  scene.add(sun);
  const m = model(s);
  scene.add(m);
  const box = new THREE.Box3().setFromObject(m);
  const c = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const rad = Math.max(size.x, size.y, size.z) * 0.9 + 0.5;
  const camera = new THREE.PerspectiveCamera(32, w / h, 0.1, 500);
  camera.position.set(c.x + rad * 1.2, c.y + rad * 0.8, c.z + rad * 1.5);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(c);
  controls.autoRotate = true;
  controls.autoRotateSpeed = 1.5;
  controls.enableDamping = true;
  let raf = 0;
  const loop = () => {
    controls.update();
    renderer.render(scene, camera);
    raf = requestAnimationFrame(loop);
  };
  loop();
  const close = () => {
    cancelAnimationFrame(raf);
    renderer.dispose();
    dlg.close();
  };
  dlg.querySelector<HTMLElement>('[data-a=close]')!.onclick = close;
  dlg.oncancel = (e) => {
    e.preventDefault();
    close();
  };
}

// ---------------------------------------------------------------- interactions

app.querySelector<HTMLInputElement>('[data-k=q]')!.oninput = (e) => {
  query = (e.target as HTMLInputElement).value;
  draw();
};
app.querySelectorAll<HTMLButtonElement>('[data-c]').forEach((b) => {
  b.onclick = () => {
    category = b.dataset.c as Category | 'all';
    app.querySelectorAll('[data-c]').forEach((x) => x.classList.toggle('on', x === b));
    draw();
  };
});
app.querySelector<HTMLElement>('[data-a=print]')!.onclick = () => print();
list.onclick = (e) => {
  const btn = (e.target as HTMLElement).closest('[data-a=view]');
  const id = btn?.closest<HTMLElement>('.card')?.dataset.id;
  const s = id ? MODULES.find((m) => m.id === id) : null;
  if (s) openViewer(s);
};

// rendu officiel absent au format WebP : image d'origine
list.addEventListener(
  'error',
  (e) => {
    const img = e.target as HTMLImageElement;
    if (img.tagName === 'IMG' && img.dataset.orig && img.src !== img.dataset.orig) img.src = img.dataset.orig;
  },
  true,
);

draw();
// modèles reconstruits (GLB) d'abord s'il y en a, puis rendus 3D
void loadRealModels(
  (id) => MODULES.find((m) => m.id === id) ?? null,
  () => undefined,
).finally(() => {
  draw(); // étiquettes « 3D reconstruite » une fois les modèles chargés
  renderShots(() => document.body.classList.add('ready'));
});
