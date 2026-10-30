import { APP_NAME, APP_TAGLINE } from './brand';
import { MODULES, spec } from './catalog/modules';
import { attachTo, findSnap, freeSpot } from './core/snap';
import type { Placed, Project } from './core/types';
import { Store, emptyProject } from './editor/store';
import { followStroke } from './generator/freehand';
import { DEFAULT_PARAMS, generatePark, type GenParams } from './generator/generator';
import { randomSeed } from './generator/rng';
import { TEMPLATES } from './generator/templates';
import { autosave, downloadCSV, downloadJSON, downloadPNG, loadAutosave, parseProject, printReport, projectFromHash, shareLink } from './io/export';
import { AUDIENCE_LIMITS } from './rules/validate';
import { renderThumbnails } from './scene/thumbnails';
import { Viewport } from './scene/viewport';
import { PlayMode } from './scene/play';
import { icon } from './ui/icons';
import { exportAnchors, printAnchorPlan } from './io/anchorplan';
import { eur } from './io/export';
import { seasonFlyout } from './ui/season';
import { esc, h, initCatalog, renderHotbar, renderHud, renderInspector, siteFlyout, thumbs } from './ui/panels';

const store = new Store();
const viewport = new Viewport(document.getElementById('viewport')!, store);
// accès console pour démonstration / tests automatisés
(window as any).__app = { store, viewport };
let genParams: GenParams = { ...DEFAULT_PARAMS, seed: randomSeed() };
const play = new PlayMode(viewport, store);
function startPlay() {
  store.select([]);
  catalog.close();
  closeFlyout();
  if (!play.start()) toast('Construisez ou générez d’abord un parc.');
}

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
document.title = APP_NAME;
$('#brand-name').textContent = APP_NAME;

// ------------------------------------------------ notifications

let toastTimer = 0;
function toast(msg: string, ms = 3400) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (t.hidden = true), ms);
}

// ------------------------------------------------ modules récents (barre rapide)

const RECENT_KEY = 'parkcraft:recent';
let recent: string[] = [];
try {
  recent = (JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as string[]).filter((id) => MODULES.some((m) => m.id === id));
} catch {
  recent = [];
}
function pushRecent(type: string) {
  recent = [type, ...recent.filter((t) => t !== type)].slice(0, 9);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(recent));
  } catch {
    /* stockage indisponible */
  }
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
  pushRecent(type);
  if (catalog.isOpen()) catalog.close();
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
    for (const m of p.modules)
      if (store.selection.has(m.uid)) {
        m.x += dx;
        m.z += dz;
      }
  });
}

// ------------------------------------------------ génération

function runGenerator(params: GenParams, opts: { site?: Project['site']; name?: string } = {}) {
  const site = opts.site ?? store.project.site;
  const res = generatePark(site, params);
  if (!res.modules.length) {
    toast(res.log[0] ?? 'Génération impossible sur ce plan d’eau.');
    return;
  }
  store.setProject({ ...store.project, name: opts.name ?? `Parc ${params.seed}`, site, audience: params.audience, modules: res.modules });
  viewport.frameAll();
  const st = store.derived.stats;
  toast(`${st.modules} modules · ${st.capacity} personnes · ${eur(st.total)}${st.loops ? ' · boucle' : ''} — variante « ${params.seed} »`);
}

function randomPark() {
  genParams = { ...genParams, audience: store.project.audience, seed: randomSeed() };
  runGenerator(genParams);
}

function openGeneratorDialog() {
  const dlg = $<HTMLDialogElement>('#gen-dialog');
  const p = { ...genParams, audience: store.project.audience };
  const seg = (k: string, opts: [string, string][], cur: string) =>
    `<div class="seg" data-seg="${k}">${opts.map(([v, l]) => `<button type="button" data-v="${v}" class="${v === cur ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  const check = (k: keyof GenParams, label: string) => `<label class="check-pill"><input type="checkbox" data-k="${k}" ${p[k] ? 'checked' : ''}> ${label}</label>`;
  dlg.innerHTML = `
    <div class="dlg-head"><h2>Générer un parc</h2><p>Un parc complet et cohérent : accès, parcours rythmé, jonctions, boucle, toboggans en fin de parcours, surveillance et balisage.</p></div>
    <div class="dlg-body"><div class="fields">
      <label class="field full">Public${seg('audience', (Object.keys(AUDIENCE_LIMITS) as GenParams['audience'][]).map((a) => [a, AUDIENCE_LIMITS[a].label.split(' (')[0]]), p.audience)}</label>
      <label class="field full">Capacité visée<div class="range-row"><input type="range" min="15" max="250" step="5" data-k="capacity" value="${p.capacity}"><output>${p.capacity}</output></div></label>
      <label class="field full">Intensité<div class="range-row"><input type="range" min="1" max="5" step="1" data-k="intensity" value="${p.intensity}"><output>${p.intensity}</output></div></label>
      <label class="field full">Budget maximum (HT, produits à prévoir inclus)<div class="range-row"><input type="range" min="0" max="1000000" step="10000" data-k="budget" value="${p.budget ?? 0}"><output>${p.budget ? eur(p.budget) : 'Sans limite'}</output></div></label>
      <div class="field full">Options<div class="checks">${check('loop', 'Boucle InfinityLoop')}${check('bigSlide', 'Grand toboggan')}${check('standalones', 'Modules autonomes')}</div></div>
      <label class="field full">Variante<input data-k="seed" value="${esc(p.seed)}"></label>
    </div>
    <div class="note">Plan d'eau : ${store.project.site.length} × ${store.project.site.width} m, profondeur ${store.project.site.depth} m. Une même variante redonne toujours le même parc.</div></div>
    <div class="dlg-foot"><button class="btn" data-a="cancel">Annuler</button><button class="btn" data-a="reseed">Autre variante</button><button class="btn primary" data-a="go">Générer</button></div>`;
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
      const v = Number(r.value);
      (r.nextElementSibling as HTMLOutputElement).value = r.dataset.k === 'budget' ? (v ? eur(v) : 'Sans limite') : r.value;
      (p as any)[r.dataset.k!] = v;
    };
  });
  dlg.querySelectorAll<HTMLInputElement>('input[type=checkbox]').forEach((c) => (c.onchange = () => ((p as any)[c.dataset.k!] = c.checked)));
  const seedIn = dlg.querySelector<HTMLInputElement>('[data-k=seed]')!;
  seedIn.oninput = () => (p.seed = seedIn.value || 'parc');
  dlg.querySelector<HTMLElement>('[data-a=reseed]')!.onclick = () => {
    p.seed = randomSeed();
    seedIn.value = p.seed;
  };
  dlg.querySelector<HTMLElement>('[data-a=cancel]')!.onclick = () => dlg.close();
  dlg.querySelector<HTMLElement>('[data-a=go]')!.onclick = () => {
    genParams = { ...p };
    dlg.close();
    store.update((pr) => (pr.audience = p.audience), false);
    runGenerator(genParams);
  };
  dlg.showModal();
}

function openStartDialog() {
  const dlg = $<HTMLDialogElement>('#start-dialog');
  const site = { ...store.project.site };
  dlg.innerHTML = `
    <div class="dlg-head"><h2>Nouveau parc</h2><p>${APP_TAGLINE}. Indiquez votre plan d'eau, puis choisissez comment commencer.</p></div>
    <div class="dlg-body">
      <div class="fields" style="grid-template-columns:1fr 1fr 1fr">
        <label class="field">Longueur (m)<input type="number" data-k="length" value="${site.length}" min="15" max="400"></label>
        <label class="field">Largeur (m)<input type="number" data-k="width" value="${site.width}" min="15" max="400"></label>
        <label class="field">Profondeur (m)<input type="number" data-k="depth" value="${site.depth}" min="0.8" max="15" step="0.1"></label>
      </div>
      <div class="start-grid">
        <button data-a="random">${icon('shuffle', 22)}<b>Générer un parc</b><span>Un parc complet et cohérent, prêt à ajuster.</span></button>
        <button data-a="pen">${icon('pen', 22)}<b>Dessiner le parcours</b><span>Tracez une ligne, les modules s'y posent.</span></button>
        <button data-a="catalog">${icon('grid', 22)}<b>Partir du catalogue</b><span>Placez les modules un par un.</span></button>
        <button data-a="templates">${icon('layout', 22)}<b>Modèles de parcs</b><span>Kids Lagoon, Family Beach, SportsPark…</span></button>
      </div>
    </div>`;
  const go = (fn: () => void) => () => {
    dlg.querySelectorAll<HTMLInputElement>('[data-k]').forEach((i) => ((site as any)[i.dataset.k!] = Math.max(Number(i.min), Math.min(Number(i.max), Number(i.value) || 0))));
    store.update((p) => (p.site = { ...site }), false);
    dlg.close();
    viewport.frameAll();
    fn();
  };
  dlg.querySelector<HTMLElement>('[data-a=random]')!.onclick = go(randomPark);
  dlg.querySelector<HTMLElement>('[data-a=pen]')!.onclick = go(() => {
    viewport.frameAll(true);
    setTool('pen');
  });
  dlg.querySelector<HTMLElement>('[data-a=catalog]')!.onclick = go(() => catalog.open());
  dlg.querySelector<HTMLElement>('[data-a=templates]')!.onclick = go(() => openFlyout('templates'));
  dlg.showModal();
}

// ------------------------------------------------ catalogue & barre rapide

const catalog = initCatalog(store, (t) => addModule(t), () => {
  refreshHotbar();
  refreshRail();
});
function refreshHotbar() {
  renderHotbar(recent, catalog.isOpen(), (t) => addModule(t), () => {
    closeFlyout();
    catalog.toggle();
  });
}
renderThumbnails(MODULES, (id, url) => {
  thumbs.set(id, url);
  catalog.setThumb(id);
  if (recent.includes(id)) refreshHotbar();
});

// ------------------------------------------------ outils & panneaux latéraux

type Tool = 'select' | 'pen';
let tool: Tool = 'select';
let flyout: string | null = null;

function setTool(t: Tool) {
  tool = t;
  viewport.setPenMode(t === 'pen');
  if (t === 'pen') {
    catalog.close();
    toast('Stylo : tracez le parcours sur l’eau, relâchez pour poser les modules. Échap pour quitter.', 4500);
  }
  refreshRail();
}

const LAYERS: [keyof Viewport['opts'], string][] = [
  ['grid', 'Grille'],
  ['ports', 'Points de connexion'],
  ['zones', 'Zones de glisse et de saut'],
  ['anchors', 'Ancrages'],
  ['buoys', 'Balisage'],
];

function openFlyout(name: string) {
  const el = $('#flyout');
  if (flyout === name) return closeFlyout();
  catalog.close();
  flyout = name;
  el.innerHTML = '';
  if (name === 'site') el.appendChild(siteFlyout(store, () => catalog.redraw()));
  if (name === 'season') {
    const draw = () => {
      el.innerHTML = '';
      el.appendChild(
        seasonFlyout(
          {
            store,
            params: () => genParams,
            toast,
            frame: () => viewport.frameAll(),
            apply: (mods, newName) => {
              const before = new Set(store.project.modules.map((m) => m.uid));
              const withUids = mods.map((m) => (m.uid && before.has(m.uid) ? m : { ...m, uid: store.newUid() }));
              store.update((p) => {
                p.modules = withUids;
                if (newName) p.name = newName;
              });
              store.select(withUids.filter((m) => !before.has(m.uid)).map((m) => m.uid));
            },
          },
          draw,
        ),
      );
    };
    draw();
  }
  if (name === 'templates') {
    el.appendChild(h(`<h3>Modèles de parcs</h3>`));
    const list = h(`<div class="tpl-list"></div>`);
    for (const t of TEMPLATES) {
      const b = h(`<button class="tpl"><b>${t.name}</b><span>${t.desc}<br>${t.site.length} × ${t.site.width} m · profondeur ${t.site.depth} m</span></button>`);
      b.onclick = () => {
        genParams = { ...t.params };
        runGenerator(t.params, { site: t.site, name: t.name });
        closeFlyout();
      };
      list.appendChild(b);
    }
    el.appendChild(list);
  }
  if (name === 'layers') {
    el.appendChild(h(`<h3>Affichage</h3>`));
    for (const [k, label] of LAYERS) {
      const row = h(`<button class="switch-row"><span>${label}</span><span class="switch ${viewport.opts[k] ? 'on' : ''}"></span></button>`);
      row.onclick = () => {
        viewport.opts[k] = !viewport.opts[k];
        row.querySelector('.switch')!.classList.toggle('on', viewport.opts[k]);
        viewport.refreshOverlays();
      };
      el.appendChild(row);
    }
  }
  if (name === 'help') {
    el.appendChild(
      h(`<div><h3>Commandes</h3><div class="keys">
        <kbd>Clic</kbd><span>Sélectionner, glisser pour déplacer</span>
        <kbd>Glisser le vide</kbd><span>Tourner la caméra</span>
        <kbd>Clic droit</kbd><span>Déplacer la vue</span>
        <kbd>Molette</kbd><span>Zoom</span>
        <kbd>C</kbd><span>Catalogue</span>
        <kbd>1 – 9</kbd><span>Poser un module récent</span>
        <kbd>P</kbd><span>Stylo (tracé à main levée)</span>
        <kbd>G</kbd><span>Générer un parc</span>
        <kbd>R / Maj+R</kbd><span>Pivoter de 90° / 15°</span>
        <kbd>Ctrl+D</kbd><span>Dupliquer</span>
        <kbd>Suppr</kbd><span>Supprimer</span>
        <kbd>Alt</kbd><span>Déplacer sans aimantation</span>
        <kbd>Ctrl+Z / Ctrl+Y</kbd><span>Annuler / rétablir</span>
      </div></div>`),
    );
  }
  el.hidden = false;
  refreshRail();
}
function closeFlyout() {
  flyout = null;
  $('#flyout').hidden = true;
  refreshRail();
}

function refreshRail() {
  const rail = $('#toolrail');
  const items: ([string, string, string, () => void, boolean] | null)[] = [
    ['cursor', 'Sélection', 'V', () => setTool('select'), tool === 'select'],
    ['pen', 'Stylo — tracer un parcours', 'P', () => setTool(tool === 'pen' ? 'select' : 'pen'), tool === 'pen'],
    null,
    ['grid', 'Catalogue', 'C', () => (closeFlyout(), catalog.toggle()), catalog.isOpen()],
    ['layout', 'Modèles de parcs', '', () => openFlyout('templates'), flyout === 'templates'],
    ['waves', "Plan d'eau, public & GPS", '', () => openFlyout('site'), flyout === 'site'],
    ['package', 'Mon parc & saison prochaine', '', () => openFlyout('season'), flyout === 'season'],
    null,
    ['cube', 'Vue 3D', '', () => viewport.frameAll(false), false],
    ['top', 'Vue de dessus', '', () => viewport.frameAll(true), false],
    ['layers', 'Affichage', '', () => openFlyout('layers'), flyout === 'layers'],
    ['help', 'Commandes', '?', () => openFlyout('help'), flyout === 'help'],
  ];
  rail.innerHTML = '';
  for (const it of items) {
    if (!it) {
      rail.appendChild(h(`<span class="tool-sep"></span>`));
      continue;
    }
    const [ic, tip, key, fn, on] = it;
    const b = h(`<button class="tool ${on ? 'on' : ''}" data-tip="${esc(tip)}${key ? ` (${key})` : ''}">${icon(ic, 20)}${key ? `<span class="key">${key}</span>` : ''}</button>`);
    b.onclick = fn;
    rail.appendChild(b);
  }
  refreshHotbarIfNeeded();
}
let lastCatalogState: boolean | null = null;
function refreshHotbarIfNeeded() {
  if (lastCatalogState !== catalog.isOpen()) {
    lastCatalogState = catalog.isOpen();
    refreshHotbar();
  }
}

// ------------------------------------------------ barre supérieure

const top = $('#top-actions');
const topButtons: [string, string, string][] = [
  ['undo', 'undo', 'Annuler (Ctrl+Z)'],
  ['redo', 'redo', 'Rétablir (Ctrl+Y)'],
  ['new', 'plus', 'Nouveau parc'],
  ['open', 'folder', 'Ouvrir un projet'],
  ['save', 'save', 'Enregistrer (Ctrl+S)'],
  ['export-menu', 'download', 'Exporter'],
];
for (const [a, ic, tip] of topButtons) top.appendChild(h(`<button class="icon-btn" data-action="${a}" title="${tip}">${icon(ic, 19)}</button>`));
$('.btn-generate').innerHTML = `${icon('shuffle', 17)}<span>Générer un parc</span>`;
const playBtn = h(`<button class="btn-play" data-action="play" title="Mode Play : voir le parc en action (Espace)">${icon('play', 15)}<span>Play</span></button>`);
$('.gen-group').prepend(playBtn);
$('[data-action=gen-settings]').innerHTML = icon('settings', 18);

const exportMenu = $('#export-menu');
exportMenu.innerHTML = [
  ['report', 'file', 'Devis PDF'],
  ['csv', 'table', 'Liste Excel (.csv)'],
  ['png', 'image', "Capture d'écran"],
  ['json', 'download', 'Fichier projet (.json)'],
  ['share', 'share', 'Copier le lien de partage'],
  ['-', '', "Plan d'ancrage"],
  ['anchors-gpx', 'anchor', 'GPS Garmin / traceur (.gpx)'],
  ['anchors-kml', 'anchor', 'Téléphone, Google Earth (.kml)'],
  ['anchors-csv', 'table', 'Coordonnées (.csv)'],
  ['anchors-print', 'file', 'Plan imprimable'],
]
  .map(([a, ic, l]) => (a === '-' ? `<div class="menu-title">${l}</div>` : `<button data-action="${a}">${icon(ic, 17)}${l}</button>`))
  .join('');

/** Le plan d'ancrage exige la position GPS du plan d'eau. */
function withGeo(fn: (geo: NonNullable<Project['site']['geo']>) => void) {
  if (!store.project.modules.length) return toast('Aucun module : rien à ancrer.');
  const geo = store.project.site.geo;
  if (!geo) {
    openFlyout('site');
    return toast('Renseignez la position GPS du plan d’eau (panneau Plan d’eau) pour exporter le plan d’ancrage.');
  }
  fn(geo);
}

const nameInput = $<HTMLInputElement>('#project-name');
nameInput.onchange = () => store.update((p) => (p.name = nameInput.value || 'Parc sans nom'));

// ------------------------------------------------ rafraîchissement

let saveTimer = 0;
let lastAudience = store.project.audience;
function refreshUI() {
  if (document.activeElement !== nameInput) nameInput.value = store.project.name;
  renderInspector(store, { rotate: rotateSelection, duplicate: duplicateSelection, remove: deleteSelection, focus: () => viewport.focusSelection() });
  renderHud(store, (uids) => {
    store.select(uids);
    viewport.focusSelection();
  });
  $<HTMLButtonElement>('[data-action=undo]').disabled = !store.canUndo();
  $<HTMLButtonElement>('[data-action=redo]').disabled = !store.canRedo();
  if (store.project.audience !== lastAudience) {
    lastAudience = store.project.audience;
    catalog.redraw();
  }
  refreshHotbar();
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => autosave(store.project), 600);
}
store.on(refreshUI);

viewport.onDropModule = (type, x, z) => addModule(type, { x, z });
viewport.onStroke = (pts) => {
  const params = { ...genParams, audience: store.project.audience, seed: randomSeed() };
  const res = followStroke(store.project.site, store.project.modules, pts, params);
  if (!res || !res.modules.length) {
    toast('Aucun module ne peut suivre ce tracé ici : trop court, trop près du bord ou d’autres modules.');
    return;
  }
  const added = res.modules.map((m) => ({ ...m, uid: store.newUid() }));
  store.update((p) => p.modules.push(...added));
  store.select(added.map((m) => m.uid));
  const pct = Math.round(res.coverage * 100);
  toast(`${added.length} modules posés sur ${Math.round(res.length)} m${res.extended ? ', parc prolongé' : ''}${pct < 90 ? ` (${pct} % du tracé)` : ''} — Ctrl+Z pour annuler`);
};
const tip = $('#tooltip');
viewport.onHover = (m, x, y) => {
  if (!m) {
    tip.hidden = true;
    return;
  }
  const s = spec(m.type);
  tip.innerHTML = `<b>${esc(s.name)}</b> <span>${s.displaySize ?? `${s.L} × ${s.W} m`} · ${s.H} m</span>`;
  tip.style.left = `${x + 14}px`;
  tip.style.top = `${y + 14}px`;
  tip.hidden = false;
};

// ------------------------------------------------ actions

const fileInput = $<HTMLInputElement>('#file-input');
fileInput.onchange = async () => {
  const f = fileInput.files?.[0];
  if (!f) return;
  try {
    store.setProject(parseProject(await f.text()));
    viewport.frameAll();
    toast(`Projet « ${store.project.name} » ouvert`);
  } catch (e) {
    toast(`Impossible d'ouvrir ce fichier : ${(e as Error).message}`);
  }
  fileInput.value = '';
};

const actions: Record<string, (btn: HTMLElement) => void> = {
  new: () => {
    if (store.project.modules.length && !confirm('Créer un nouveau parc ? Le parc actuel reste récupérable avec Annuler.')) return;
    store.setProject({ ...emptyProject(), site: { ...store.project.site }, audience: store.project.audience });
    openStartDialog();
  },
  open: () => fileInput.click(),
  save: () => {
    autosave(store.project);
    downloadJSON(store.project);
    toast('Projet enregistré');
  },
  'export-menu': (btn) => {
    const r = btn.getBoundingClientRect();
    exportMenu.style.top = `${r.bottom + 10}px`;
    exportMenu.style.left = `${Math.min(r.left, window.innerWidth - 260)}px`;
    exportMenu.hidden = !exportMenu.hidden;
  },
  report: () => {
    if (!printReport(store.project, store.derived.stats, store.derived.issues, viewport.screenshot())) toast('Autorisez les fenêtres pop-up pour générer le devis PDF');
  },
  csv: () => downloadCSV(store.project, store.derived.stats),
  json: () => downloadJSON(store.project),
  png: () => downloadPNG(viewport.screenshot(), store.project.name),
  share: async () => {
    const link = shareLink(store.project);
    history.replaceState(null, '', link);
    try {
      await navigator.clipboard.writeText(link);
      toast('Lien de partage copié');
    } catch {
      toast('Lien de partage placé dans la barre d’adresse');
    }
  },
  'anchors-gpx': () => withGeo((g) => exportAnchors(store.project, g, 'gpx')),
  'anchors-kml': () => withGeo((g) => exportAnchors(store.project, g, 'kml')),
  'anchors-csv': () => withGeo((g) => exportAnchors(store.project, g, 'csv')),
  'anchors-print': () => withGeo((g) => !printAnchorPlan(store.project, g) && toast('Autorisez les fenêtres pop-up pour imprimer le plan')),
  undo: () => store.undo(),
  redo: () => store.redo(),
  random: randomPark,
  play: startPlay,
  'gen-settings': openGeneratorDialog,
};
document.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
  if (btn && actions[btn.dataset.action!]) {
    e.stopPropagation();
    if (btn.dataset.action !== 'export-menu') exportMenu.hidden = true;
    actions[btn.dataset.action!](btn);
    return;
  }
  exportMenu.hidden = true;
});

// ------------------------------------------------ clavier

window.addEventListener('keydown', (e) => {
  const tag = (e.target as HTMLElement).tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || document.querySelector('dialog[open]')) return;
  if (play.active) {
    if (e.key === 'Escape' || e.key === ' ') play.stop();
    return;
  }
  if (e.key === ' ') return e.preventDefault(), startPlay();
  const ctrl = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();
  if (ctrl && k === 'z' && !e.shiftKey) return e.preventDefault(), store.undo();
  if (ctrl && (k === 'y' || (k === 'z' && e.shiftKey))) return e.preventDefault(), store.redo();
  if (ctrl && k === 'd') return e.preventDefault(), duplicateSelection();
  if (ctrl && k === 's') return e.preventDefault(), actions.save(document.body);
  if (ctrl && k === 'a') return e.preventDefault(), store.select(store.project.modules.map((m) => m.uid));
  if (ctrl) return;
  if (k === 'delete' || k === 'backspace') return e.preventDefault(), deleteSelection();
  if (/^[1-9]$/.test(k) && recent[Number(k) - 1]) return addModule(recent[Number(k) - 1]);
  if (k === 'c') return closeFlyout(), catalog.toggle();
  if (k === 'v') return setTool('select');
  if (k === 'p') return setTool(tool === 'pen' ? 'select' : 'pen');
  if (k === 'r') return rotateSelection(e.shiftKey ? 15 : 90);
  if (k === 'g') return randomPark();
  if (k === 'f') return viewport.focusSelection();
  if (k === '?') return openFlyout('help');
  if (k === 'escape') {
    if (catalog.isOpen()) return catalog.close();
    if (flyout) return closeFlyout();
    if (tool === 'pen') return setTool('select');
    return store.select([]);
  }
  const step = e.shiftKey ? 0.1 : 0.5;
  if (e.key === 'ArrowLeft') return e.preventDefault(), nudge(-step, 0);
  if (e.key === 'ArrowRight') return e.preventDefault(), nudge(step, 0);
  if (e.key === 'ArrowUp') return e.preventDefault(), nudge(0, -step);
  if (e.key === 'ArrowDown') return e.preventDefault(), nudge(0, step);
});

// ------------------------------------------------ démarrage

refreshRail();
const fromHash = projectFromHash(location.hash);
const saved = fromHash ?? loadAutosave();
if (saved) {
  store.setProject(saved, false);
  viewport.frameAll();
  if (fromHash) toast(`Projet partagé « ${saved.name} » chargé`);
} else {
  refreshUI();
  viewport.frameAll();
  openStartDialog();
}
