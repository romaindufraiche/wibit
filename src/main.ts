import { MODULES, spec } from './catalog/modules';
import { attachTo, findSnap, freeSpot } from './core/snap';
import type { Placed, Project } from './core/types';
import { Store, emptyProject } from './editor/store';
import { DEFAULT_PARAMS, generatePark, type GenParams } from './generator/generator';
import { randomSeed } from './generator/rng';
import { TEMPLATES } from './generator/templates';
import { autosave, downloadCSV, downloadJSON, downloadPNG, loadAutosave, parseProject, printReport, projectFromHash, shareLink } from './io/export';
import { AUDIENCE_LIMITS } from './rules/validate';
import { renderThumbnails } from './scene/thumbnails';
import { Viewport } from './scene/viewport';
import { renderCatalog, renderInspector, renderIssues, renderSite, renderSummary, thumbs } from './ui/panels';

const store = new Store();
const viewport = new Viewport(document.getElementById('viewport')!, store);
// accès console pour démonstration / tests automatisés
(window as any).__wibit = { store, viewport };
let genParams: GenParams = { ...DEFAULT_PARAMS, seed: randomSeed() };

// ------------------------------------------------ utilitaires UI

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
let toastTimer = 0;
function toast(msg: string, ms = 3200) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (t.hidden = true), ms);
}

// ------------------------------------------------ opérations d'édition

function addModule(type: string, at?: { x: number; z: number }) {
  const { project } = store;
  const s = spec(type);
  let tf: { x: number; z: number; rot: number } | null = null;
  const sel = store.selected();
  if (!at && sel.length === 1 && s.ports.length) tf = attachTo(type, sel[0], project.modules, project.site);
  if (!tf) {
    const c = at ?? viewport.centerOfView();
    tf = at ? { x: at.x, z: at.z, rot: 0 } : freeSpot(type, c.x, c.z, project.modules, project.site);
    const snap = findSnap({ uid: '_', type, ...tf }, project.modules);
    if (snap) tf = snap;
  }
  const uid = store.newUid();
  const placed: Placed = { uid, type, ...tf };
  store.update((p) => p.modules.push(placed));
  store.select([uid]);
}

function rotateSelection(deg: number) {
  const sel = store.selected();
  if (!sel.length) return;
  const a = (deg * Math.PI) / 180;
  const cx = sel.reduce((s, m) => s + m.x, 0) / sel.length;
  const cz = sel.reduce((s, m) => s + m.z, 0) / sel.length;
  store.update((p) => {
    for (const m of p.modules) {
      if (!store.selection.has(m.uid)) continue;
      // rotation autour du centre de la sélection (même convention que three.js)
      const dx = m.x - cx,
        dz = m.z - cz;
      m.x = cx + dx * Math.cos(a) + dz * Math.sin(a);
      m.z = cz - dx * Math.sin(a) + dz * Math.cos(a);
      m.rot += a;
    }
  });
}

function duplicateSelection() {
  const sel = store.selected();
  if (!sel.length) return;
  const copies = sel.map((m) => ({ ...m, uid: store.newUid(), x: m.x + 2, z: m.z + 2 }));
  store.update((p) => p.modules.push(...copies));
  store.select(copies.map((c) => c.uid));
}

function deleteSelection() {
  if (!store.selection.size) return;
  store.update((p) => {
    p.modules = p.modules.filter((m) => !store.selection.has(m.uid));
  });
  store.select([]);
}

function nudge(dx: number, dz: number) {
  if (!store.selection.size) return;
  store.update((p) => {
    for (const m of p.modules) if (store.selection.has(m.uid)) {
      m.x += dx;
      m.z += dz;
    }
  });
}

// ------------------------------------------------ génération

function runGenerator(params: GenParams, opts: { keepSite?: boolean; site?: Project['site']; name?: string } = {}) {
  const site = opts.site ?? store.project.site;
  const t0 = performance.now();
  const res = generatePark(site, params);
  const dt = Math.round(performance.now() - t0);
  if (!res.modules.length) {
    toast(res.log[0] ?? 'Génération impossible.');
    return;
  }
  const project: Project = {
    ...store.project,
    name: opts.name ?? `Parc ${params.seed}`,
    site,
    audience: params.audience,
    modules: res.modules,
  };
  store.setProject(project);
  viewport.frameAll();
  const st = store.derived.stats;
  const errs = store.derived.issues.filter((i) => i.level === 'error').length;
  toast(`🎲 « ${params.seed} » : ${st.modules} modules, ${st.capacity} pers., ${st.loops ? 'boucle InfinityLoop, ' : ''}${errs ? errs + ' erreur(s)' : 'règles OK'} — ${dt} ms`);
}

function randomPark() {
  genParams = { ...genParams, seed: randomSeed() };
  runGenerator(genParams);
}

function openGeneratorDialog() {
  const dlg = $<HTMLDialogElement>('#gen-dialog');
  const p = { ...genParams, audience: store.project.audience };
  const seg = (k: string, opts: [string, string][], cur: string) =>
    `<div class="seg" data-seg="${k}">${opts.map(([v, l]) => `<button type="button" data-v="${v}" class="${v === cur ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  dlg.innerHTML = `
    <div class="dlg-head"><h2>🎲 Générateur de parc</h2><p>Crée un parc cohérent : accès sur le rivage, enchaînements d'obstacles avec plateformes de repos,
      jonctions, boucle InfinityLoop, toboggans en fin de parcours avec zone d'eau libre, surveillance et balisage.</p></div>
    <div class="dlg-body"><div class="form">
      <label class="full">Public${seg('audience', (Object.keys(AUDIENCE_LIMITS) as GenParams['audience'][]).map((a) => [a, AUDIENCE_LIMITS[a].label.split(' (')[0]]), p.audience)}</label>
      <label class="full">Capacité visée<div class="range-row"><input type="range" min="15" max="250" step="5" data-k="capacity" value="${p.capacity}"><output>${p.capacity}</output></div></label>
      <label class="full">Intensité<div class="range-row"><input type="range" min="1" max="5" step="1" data-k="intensity" value="${p.intensity}"><output>${p.intensity}</output></div></label>
      <label class="check"><input type="checkbox" data-k="loop" ${p.loop ? 'checked' : ''}> Boucle InfinityLoop</label>
      <label class="check"><input type="checkbox" data-k="bigSlide" ${p.bigSlide ? 'checked' : ''}> Grand toboggan</label>
      <label class="check"><input type="checkbox" data-k="standalones" ${p.standalones ? 'checked' : ''}> Modules autonomes</label>
      <span></span>
      <label>Graine (même graine = même parc)<input data-k="seed" value="${p.seed}"></label>
      <label>&nbsp;<button type="button" class="btn" data-a="reseed">Nouvelle graine</button></label>
    </div>
    <div class="note">Plan d'eau utilisé : ${store.project.site.length} × ${store.project.site.width} m, profondeur ${store.project.site.depth} m (modifiable dans le panneau de droite).</div></div>
    <div class="dlg-foot"><button class="btn" data-a="cancel">Annuler</button><button class="btn yellow" data-a="go">Générer le parc</button></div>`;
  dlg.querySelectorAll<HTMLElement>('[data-seg]').forEach((g) =>
    g.querySelectorAll<HTMLButtonElement>('button').forEach((b) => {
      b.onclick = () => {
        g.querySelectorAll('button').forEach((x) => x.classList.remove('on'));
        b.classList.add('on');
        (p as any)[g.dataset.seg!] = b.dataset.v;
      };
    }),
  );
  dlg.querySelectorAll<HTMLInputElement>('input[type=range]').forEach((r) => {
    r.oninput = () => {
      (r.nextElementSibling as HTMLOutputElement).value = r.value;
      (p as any)[r.dataset.k!] = Number(r.value);
    };
  });
  dlg.querySelectorAll<HTMLInputElement>('input[type=checkbox]').forEach((c) => (c.onchange = () => ((p as any)[c.dataset.k!] = c.checked)));
  const seedIn = dlg.querySelector<HTMLInputElement>('[data-k=seed]')!;
  seedIn.oninput = () => (p.seed = seedIn.value || 'wibit');
  dlg.querySelector<HTMLElement>('[data-a=reseed]')!.onclick = () => {
    p.seed = randomSeed();
    seedIn.value = p.seed;
  };
  dlg.querySelector<HTMLElement>('[data-a=cancel]')!.onclick = () => dlg.close();
  dlg.querySelector<HTMLElement>('[data-a=go]')!.onclick = () => {
    genParams = { ...p };
    dlg.close();
    runGenerator(genParams);
  };
  dlg.showModal();
}

function openStartDialog() {
  const dlg = $<HTMLDialogElement>('#start-dialog');
  const site = { ...store.project.site };
  dlg.innerHTML = `
    <div class="dlg-head"><h2>Bienvenue dans Wibit Create</h2><p>Concevez votre parc aquatique gonflable en 3D, obtenez un devis estimatif et vérifiez les règles de sécurité en temps réel.</p></div>
    <div class="dlg-body">
      <div class="form">
        <label>Longueur du plan d'eau (m)<input type="number" data-k="length" value="${site.length}" min="15" max="400"></label>
        <label>Largeur (m)<input type="number" data-k="width" value="${site.width}" min="15" max="400"></label>
        <label>Profondeur (m)<input type="number" data-k="depth" value="${site.depth}" min="0.8" max="15" step="0.1"></label>
      </div>
      <div class="start-choices">
        <button data-a="random"><b>🎲 Parc aléatoire</b><span>Un parc cohérent généré instantanément sur ce plan d'eau.</span></button>
        <button data-a="blank"><b>Page blanche</b><span>Partir de zéro et placer les modules du catalogue.</span></button>
        <button data-a="templates"><b>Modèles de parcs</b><span>Kids Lagoon, Family Beach, SportsPark XL…</span></button>
        <button data-a="settings"><b>⚙ Générateur avancé</b><span>Public, capacité, intensité, boucle, toboggan.</span></button>
      </div>
    </div>`;
  const readSite = () => {
    dlg.querySelectorAll<HTMLInputElement>('[data-k]').forEach((i) => ((site as any)[i.dataset.k!] = Math.max(Number(i.min), Math.min(Number(i.max), Number(i.value) || 0))));
    store.update((p) => (p.site = { ...site }), false);
  };
  dlg.querySelector<HTMLElement>('[data-a=random]')!.onclick = () => {
    readSite();
    dlg.close();
    randomPark();
  };
  dlg.querySelector<HTMLElement>('[data-a=blank]')!.onclick = () => {
    readSite();
    dlg.close();
    viewport.frameAll();
  };
  dlg.querySelector<HTMLElement>('[data-a=templates]')!.onclick = () => {
    readSite();
    dlg.close();
    switchTab('templates');
  };
  dlg.querySelector<HTMLElement>('[data-a=settings]')!.onclick = () => {
    readSite();
    dlg.close();
    openGeneratorDialog();
  };
  dlg.showModal();
}

// ------------------------------------------------ panneaux

const catalog = renderCatalog(store, { onAdd: (t) => addModule(t) });
renderThumbnails(MODULES, (id, url) => {
  thumbs.set(id, url);
  catalog.setThumb(id, url);
});

function switchTab(tab: string) {
  document.querySelectorAll<HTMLElement>('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === tab));
  $('#tab-catalog').hidden = tab !== 'catalog';
  $('#tab-templates').hidden = tab !== 'templates';
}
document.querySelectorAll<HTMLElement>('.tab').forEach((t) => (t.onclick = () => switchTab(t.dataset.tab!)));

const tplRoot = $('#templates');
for (const t of TEMPLATES) {
  const b = document.createElement('button');
  b.className = 'tpl';
  b.innerHTML = `<b>${t.name}</b><span>${t.desc}<br>${t.site.length} × ${t.site.width} m · prof. ${t.site.depth} m</span>`;
  b.onclick = () => {
    genParams = { ...t.params };
    runGenerator(t.params, { site: t.site, name: t.name });
  };
  tplRoot.appendChild(b);
}

const viewButtons: [keyof Viewport['opts'], string][] = [
  ['grid', 'Grille'],
  ['ports', 'Connexions'],
  ['zones', 'Zones de glisse'],
  ['anchors', 'Ancrages'],
  ['buoys', 'Balisage'],
];
const vt = $('#view-toolbar');
for (const [k, label] of viewButtons) {
  const b = document.createElement('button');
  b.textContent = label;
  b.classList.toggle('on', viewport.opts[k]);
  b.onclick = () => {
    viewport.opts[k] = !viewport.opts[k];
    b.classList.toggle('on', viewport.opts[k]);
    viewport.refreshOverlays();
  };
  vt.appendChild(b);
}
vt.appendChild(Object.assign(document.createElement('span'), { className: 'vsep' }));
for (const [label, fn] of [
  ['3D', () => viewport.frameAll(false)],
  ['Vue de dessus', () => viewport.frameAll(true)],
] as [string, () => void][]) {
  const b = document.createElement('button');
  b.textContent = label;
  b.onclick = fn;
  vt.appendChild(b);
}

const nameInput = $<HTMLInputElement>('#project-name');
nameInput.onchange = () => store.update((p) => (p.name = nameInput.value || 'Parc sans nom'));

let saveTimer = 0;
let lastAudience = store.project.audience;
function refreshUI() {
  if (document.activeElement !== nameInput) nameInput.value = store.project.name;
  renderInspector(store, {
    rotate: rotateSelection,
    duplicate: duplicateSelection,
    remove: deleteSelection,
    focus: () => viewport.focusSelection(),
  });
  renderSite(store, () => catalog.redraw());
  renderSummary(store);
  renderIssues(store, (uids) => {
    store.select(uids);
    viewport.focusSelection();
  });
  $<HTMLButtonElement>('[data-action=undo]').disabled = !store.canUndo();
  $<HTMLButtonElement>('[data-action=redo]').disabled = !store.canRedo();
  if (store.project.audience !== lastAudience) {
    lastAudience = store.project.audience;
    catalog.redraw();
  }
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => autosave(store.project), 600);
}
store.on(refreshUI);

viewport.onDropModule = (type, x, z) => addModule(type, { x, z });
const tip = $('#tooltip');
viewport.onHover = (m, x, y) => {
  if (!m) {
    tip.hidden = true;
    return;
  }
  const s = spec(m.type);
  tip.innerHTML = `<b>${s.name}</b> · ${s.displaySize ?? `${s.L} × ${s.W} m`} · H ${s.H} m`;
  tip.style.left = `${x + 14}px`;
  tip.style.top = `${y + 14}px`;
  tip.hidden = false;
};

// ------------------------------------------------ actions barre supérieure

const fileInput = $<HTMLInputElement>('#file-input');
fileInput.onchange = async () => {
  const f = fileInput.files?.[0];
  if (!f) return;
  try {
    store.setProject(parseProject(await f.text()));
    viewport.frameAll();
    toast(`Projet « ${store.project.name} » ouvert.`);
  } catch (e) {
    toast(`Impossible d'ouvrir ce fichier : ${(e as Error).message}`);
  }
  fileInput.value = '';
};

const actions: Record<string, () => void> = {
  new: () => {
    if (store.project.modules.length && !confirm('Créer un nouveau projet ? Le projet actuel reste récupérable avec « Annuler ».')) return;
    store.setProject({ ...emptyProject(), site: { ...store.project.site }, audience: store.project.audience });
    openStartDialog();
  },
  open: () => fileInput.click(),
  save: () => {
    autosave(store.project);
    downloadJSON(store.project);
    toast('Projet enregistré (navigateur + fichier .json).');
  },
  'export-menu': () => {
    const m = $('#export-menu');
    m.hidden = !m.hidden;
  },
  report: () => {
    if (!printReport(store.project, store.derived.stats, store.derived.issues, viewport.screenshot())) toast('Autorisez les fenêtres pop-up pour générer le devis PDF.');
  },
  csv: () => downloadCSV(store.project, store.derived.stats),
  json: () => downloadJSON(store.project),
  png: () => downloadPNG(viewport.screenshot(), store.project.name),
  share: async () => {
    const link = shareLink(store.project);
    history.replaceState(null, '', link);
    try {
      await navigator.clipboard.writeText(link);
      toast('Lien de partage copié dans le presse-papiers.');
    } catch {
      toast('Lien de partage placé dans la barre d’adresse.');
    }
  },
  undo: () => store.undo(),
  redo: () => store.redo(),
  random: randomPark,
  'gen-settings': openGeneratorDialog,
};
document.querySelectorAll<HTMLElement>('[data-action]').forEach((b) => {
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    const a = b.dataset.action!;
    if (a !== 'export-menu') $('#export-menu').hidden = true;
    actions[a]?.();
  });
});
document.addEventListener('click', () => ($('#export-menu').hidden = true));

// ------------------------------------------------ clavier

window.addEventListener('keydown', (e) => {
  const tag = (e.target as HTMLElement).tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || document.querySelector('dialog[open]')) return;
  const ctrl = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();
  if (ctrl && k === 'z' && !e.shiftKey) return e.preventDefault(), store.undo();
  if (ctrl && (k === 'y' || (k === 'z' && e.shiftKey))) return e.preventDefault(), store.redo();
  if (ctrl && k === 'd') return e.preventDefault(), duplicateSelection();
  if (ctrl && k === 's') return e.preventDefault(), actions.save();
  if (ctrl && k === 'a') return e.preventDefault(), store.select(store.project.modules.map((m) => m.uid));
  if (k === 'delete' || k === 'backspace') return e.preventDefault(), deleteSelection();
  if (k === 'r') return rotateSelection(e.shiftKey ? 15 : 90);
  if (k === 'g') return randomPark();
  if (k === 'f') return viewport.focusSelection();
  if (k === 'escape') return store.select([]);
  const step = e.shiftKey ? 0.1 : 0.5;
  if (e.key === 'ArrowLeft') return e.preventDefault(), nudge(-step, 0);
  if (e.key === 'ArrowRight') return e.preventDefault(), nudge(step, 0);
  if (e.key === 'ArrowUp') return e.preventDefault(), nudge(0, -step);
  if (e.key === 'ArrowDown') return e.preventDefault(), nudge(0, step);
});

// ------------------------------------------------ démarrage

const fromHash = projectFromHash(location.hash);
const saved = fromHash ?? loadAutosave();
if (saved) {
  store.setProject(saved, false);
  viewport.frameAll();
  if (fromHash) toast(`Projet partagé « ${saved.name} » chargé.`);
} else {
  refreshUI();
  viewport.frameAll();
  openStartDialog();
}
