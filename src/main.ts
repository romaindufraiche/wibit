import { APP_NAME } from './brand';
import { MODULES, spec } from './catalog/modules';
import { attachTo, findSnap, freeSpot } from './core/snap';
import type { Placed, Project } from './core/types';
import { Store, emptyProject } from './editor/store';
import { naturalOutline } from './core/region';
import { followStroke } from './generator/freehand';
import { DEFAULT_PARAMS, generatePark, type GenParams } from './generator/generator';
import { randomSeed } from './generator/rng';
import { TEMPLATES } from './generator/templates';
import { autosave, downloadCSV, downloadJSON, downloadPNG, loadAutosave, parseProject, printReport, projectFromHash, shareLink } from './io/export';
import { AUDIENCE_LIMITS } from './rules/validate';
import { renderThumbnails } from './scene/thumbnails';
import { Viewport } from './scene/viewport';
import { PlayMode } from './scene/play';
import { LOGO, icon } from './ui/icons';
import { exportAnchors, printAnchorPlan } from './io/anchorplan';
import { eur } from './io/export';
import { seasonFlyout } from './ui/season';
import { account, openAuthDialog, parksFlyout, type ProjectStats } from './ui/account';
import { initTracking, track } from './io/track';
import { initAssistant } from './assistant/chat';
import { DECOR, defaultPoolDecor } from './scene/decor';
import { loadRealModels } from './models/glb';
import { loadRecent, pushRecent as pushRecentPark, thumbnail } from './io/recent';
import { applyOverrides } from './catalog/modules';
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
  else track('play');
}

/** Résumé chiffré envoyé avec chaque enregistrement (suivi commercial). */
function projectStats(): ProjectStats {
  const { stats, issues } = store.derived;
  const types: Record<string, number> = {};
  for (const m of store.project.modules) types[m.type] = (types[m.type] ?? 0) + 1;
  return {
    modules: stats.modules,
    capacity: stats.capacity,
    total: stats.total,
    errors: issues.filter((i) => i.level === 'error').length,
    warnings: issues.filter((i) => i.level === 'warning').length,
    types,
  };
}

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
document.title = APP_NAME;
$('#brand-name').textContent = APP_NAME;
$('.brand-mark').innerHTML = LOGO;

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
  const decor = site.kind === store.project.site.kind && site.length === store.project.site.length && site.width === store.project.site.width ? store.project.decor : undefined;
  store.setProject({ ...store.project, name: opts.name ?? `Parc ${params.seed}`, site, audience: params.audience, modules: res.modules, decor });
  viewport.frameAll();
  track(opts.name ? 'template' : 'generate', { seed: params.seed, capacity: params.capacity, budget: params.budget ?? 0, modules: res.modules.length });
  if (!opts.name) rememberGeneration();
  const st = store.derived.stats;
  toast(`${st.modules} modules · ${st.capacity} personnes · ${eur(st.total)}${st.loops ? ' · boucle' : ''} — variante « ${params.seed} »`);
}

let decorSeq = 0;
const decorUid = () => `d${Date.now().toString(36)}${++decorSeq}`;

/** Garde la génération affichée parmi les 3 dernières (avec une miniature), après rendu de la scène. */
function rememberGeneration() {
  const project = structuredClone(store.project);
  const st = store.derived.stats;
  requestAnimationFrame(() =>
    requestAnimationFrame(async () => {
      const thumb = await thumbnail(viewport.screenshot());
      pushRecentPark({ at: Date.now(), name: project.name, modules: st.modules, capacity: st.capacity, total: st.total, thumb, project });
      if (flyout === 'templates') (flyout = null), openFlyout('templates');
    }),
  );
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

/** Bassins de piscine proposés : [longueur, largeur, libellé]. */
const POOL_SIZES: [number, number, string][] = [
  [25, 12.5, '25 × 12,5 m'],
  [25, 15, '25 × 15 m'],
  [50, 25, '50 × 25 m'],
];
const SANDBOX: [number, number] = [220, 140];

/** Illustrations des trois cartes de départ. */
const MODE_ART = {
  sandbox: `<svg viewBox="0 0 160 90"><rect width="160" height="90" fill="#7fb35a"/><path d="M18 50c0-22 26-36 62-36s64 12 64 34-28 32-64 32-62-8-62-30z" fill="#f2dcaa"/><path d="M28 50c0-16 22-28 52-28s54 10 54 26-24 24-54 24-52-6-52-22z" fill="#2f8fc4"/><rect x="58" y="42" width="34" height="5" rx="2" fill="#c8d400"/><rect x="88" y="34" width="5" height="18" rx="2" fill="#c8d400"/><rect x="52" y="52" width="16" height="5" rx="2" fill="#fff"/></svg>`,
  pool: `<svg viewBox="0 0 160 90"><rect width="160" height="90" fill="#e3ddd0"/><rect x="22" y="16" width="116" height="58" fill="#f6f3ec"/><rect x="26" y="20" width="108" height="50" fill="#3db7dc"/><g stroke="#1b4f8a" stroke-width="1.6"><path d="M32 32.5h96M32 45h96M32 57.5h96"/></g><rect x="56" y="36" width="30" height="5" rx="2" fill="#c8d400"/><rect x="84" y="36" width="5" height="18" rx="2" fill="#c8d400"/></svg>`,
  real: `<svg viewBox="0 0 160 90"><rect width="160" height="90" fill="#dfe8d6"/><g stroke="#fff" stroke-width="3" fill="none"><path d="M0 70L60 52 160 62M100 0l-8 90"/></g><path d="M30 30c8-14 40-18 58-8s26 30 8 40-46 8-60-2-12-18-6-30z" fill="#7cc0e3"/><path d="M80 18c-8 0-14 6-14 14 0 10 14 24 14 24s14-14 14-24c0-8-6-14-14-14z" fill="#003865"/><circle cx="80" cy="32" r="5" fill="#c8d400"/></svg>`,
};

/**
 * Créer un projet : trois cartes (bac à sable, piscine, vrai terrain) ; chacune démarre avec un
 * parc généré, prêt à ajuster. En dessous : connexion (ou accès à « Mes parcs ») et assistant.
 */
function openStartDialog() {
  const dlg = $<HTMLDialogElement>('#start-dialog');
  let pool = 0;
  dlg.innerHTML = `
    <div class="dlg-head"><h2>Créer un projet</h2><p>Choisissez votre terrain : un parc est proposé tout de suite, vous l'ajustez ensuite librement.</p></div>
    <div class="dlg-body start">
      <div class="mode-cards">
        <div class="mode-card">
          <div class="mode-art">${MODE_ART.sandbox}</div>
          <b>Bac à sable</b><span>Un lac imaginaire pour composer librement et tester des idées.</span>
          <button class="btn primary" data-go="sandbox">Commencer</button>
        </div>
        <div class="mode-card">
          <div class="mode-art">${MODE_ART.pool}</div>
          <b>Piscine</b><span>Un bassin carrelé aux dimensions de votre piscine.</span>
          <div class="seg pool-sizes">${POOL_SIZES.map(([, , l], i) => `<button type="button" data-p="${i}" class="${i === pool ? 'on' : ''}">${l}</button>`).join('')}</div>
          <button class="btn primary" data-go="pool">Commencer</button>
        </div>
        <div class="mode-card">
          <div class="mode-art">${MODE_ART.real}</div>
          <b>Vrai terrain</b><span>Votre lac sur la carte, par adresse ou géolocalisation : on reprend sa vraie forme.</span>
          <button class="btn primary" data-go="real">Trouver mon site</button>
        </div>
      </div>
      <div class="start-foot">
        ${
          account.loggedIn
            ? `<span>Connecté : ${esc(account.user!.email)}</span><button class="btn" data-a="parks">${icon('cloud', 16)} Ouvrir un de mes parcs</button>`
            : `<span>Déjà un compte ?</span><button class="btn" data-a="login">${icon('user', 16)} Se connecter</button>`
        }
        <button class="link-btn" data-a="assistant">ou décrire mon projet à l’assistant</button>
      </div>
    </div>`;
  dlg.querySelectorAll<HTMLButtonElement>('[data-p]').forEach((b) => {
    b.onclick = () => {
      pool = Number(b.dataset.p);
      dlg.querySelectorAll('[data-p]').forEach((x) => x.classList.toggle('on', x === b));
    };
  });
  const start = (site: Project['site'], params: Partial<GenParams>) => {
    dlg.close();
    genParams = { ...genParams, audience: store.project.audience, ...params, seed: randomSeed() };
    runGenerator(genParams, { site });
    if (site.kind === 'pool') store.update((p) => (p.decor = defaultPoolDecor(p.site, decorUid)), false);
    toast('Voici un premier parc : « Générer un parc » en propose un autre, le catalogue et le stylo permettent de l’ajuster.', 6500);
  };
  const go = (mode: string) => {
    track('start_mode', { mode });
    if (mode === 'sandbox') {
      const [L, W] = SANDBOX;
      start({ length: L, width: W, depth: 3.5, outline: naturalOutline(L, W) }, { capacity: 80, loop: true, bigSlide: true, course: false });
    } else if (mode === 'pool') {
      const [L, W] = POOL_SIZES[pool];
      start({ length: L, width: W, depth: 2, kind: 'pool' }, { capacity: Math.max(15, Math.min(90, Math.round((L * W) / 14))), loop: false, bigSlide: false, course: false });
    } else {
      dlg.close();
      void openRealSite(() => {
        genParams = { ...genParams, audience: store.project.audience, capacity: 80, course: false, seed: randomSeed() };
        runGenerator(genParams);
      });
    }
  };
  dlg.querySelectorAll<HTMLButtonElement>('[data-go]').forEach((b) => (b.onclick = () => go(b.dataset.go!)));
  dlg.querySelector<HTMLElement>('[data-a=assistant]')!.onclick = () => {
    dlg.close();
    viewport.frameAll();
    assistant.open();
  };
  dlg.querySelector<HTMLElement>('[data-a=parks]')?.addEventListener('click', () => {
    dlg.close();
    flyout = null;
    openFlyout('parks');
  });
  dlg.querySelector<HTMLElement>('[data-a=login]')?.addEventListener('click', () => {
    dlg.close();
    openAuthDialog(
      async () => {
        refreshUserBtn();
        toast(`Connecté : ${account.user!.email}`);
        if (await openParkFromUrl()) return;
        openStartDialog();
      },
      { onCancel: openStartDialog },
    );
  });
  dlg.showModal();
}

/** Carte : adresse ou point -> contour réel du plan d'eau (décor 3D stylisé). `then` : suite (ex. générer). */
async function openRealSite(then?: () => void) {
  const { openSiteMap } = await import('./ui/sitemap');
  openSiteMap({
    current: store.project.site,
    toast,
    onCancel: then ? openStartDialog : undefined,
    onApply: (site, label) => {
      store.update((p) => {
        p.site = site;
        if (p.name === 'Nouveau parc') p.name = `Parc — ${label.split(',')[0]}`;
      });
      viewport.frameAll(true);
      track('real_site', { label });
      if (then) return then();
      const outside = store.derived.issues.filter((i) => i.rule === 'R02').length;
      toast(outside ? `Site réel chargé : ${outside} module(s) hors de l’eau, à déplacer ou régénérer.` : 'Site réel chargé : générez ou dessinez votre parc sur le vrai plan d’eau.');
    },
  });
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

type Tool = 'select' | 'pen' | 'shore';
let tool: Tool = 'select';
let flyout: string | null = null;
let parksTab: 'projects' | 'season' = 'projects';

let shoreBar: HTMLElement | null = null;
function setTool(t: Tool) {
  if (t === 'shore' && store.project.site.kind === 'pool') {
    toast('Un bassin de piscine reste rectangulaire : changez ses dimensions dans le panneau Plan d’eau.');
    t = 'select';
  }
  tool = t;
  viewport.setPenMode(t === 'pen');
  viewport.setShoreEdit(t === 'shore');
  shoreBar?.remove();
  shoreBar = null;
  if (t === 'shore') {
    track('shore_edit');
    catalog.close();
    closeFlyout();
    store.select([]);
    viewport.frameAll(true);
    shoreBar = h(`<div class="shore-bar glass"><div><b>Remodeler le rivage</b><span>Glissez les points blancs · cliquez un point jaune pour en ajouter · clic droit pour supprimer</span></div>
      <button class="btn" data-a="reset">Revenir au rectangle</button><button class="btn primary" data-a="done">Terminer</button></div>`);
    shoreBar.querySelector<HTMLElement>('[data-a=done]')!.onclick = () => setTool('select');
    shoreBar.querySelector<HTMLElement>('[data-a=reset]')!.onclick = () => {
      store.update((p) => (p.site = { ...p.site, outline: undefined }));
      viewport.setShoreEdit(true);
    };
    document.body.appendChild(shoreBar);
  }
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
  if (name === 'site') {
    const real = h(`<button class="btn primary real-btn">${icon('waves', 16)} Choisir mon site réel sur la carte</button>`);
    real.onclick = () => {
      closeFlyout();
      void openRealSite();
    };
    el.appendChild(real);
    el.appendChild(siteFlyout(store, () => catalog.redraw()));
    const deco = h(`<div><h3 style="margin-top:20px">Aménagements</h3><div class="decor-add"></div><div class="note">Ajoutés devant la caméra ; cliquez dessus pour les déplacer, R pour pivoter, Suppr pour retirer. Ils n'entrent pas dans le devis.</div></div>`);
    const add = deco.querySelector<HTMLElement>('.decor-add')!;
    for (const [type, d] of Object.entries(DECOR) as [keyof typeof DECOR, (typeof DECOR)[keyof typeof DECOR]][]) {
      const b = h(`<button class="btn">${icon('plus', 15)} ${esc(d.name)}</button>`);
      b.onclick = () => {
        const t = viewport.controls.target;
        const uid = decorUid();
        store.update((p) => (p.decor = [...(p.decor ?? []), { uid, type, x: Math.round(t.x), z: Math.round(t.z), rot: 0 }]));
        viewport.selectDecor(uid);
      };
      add.appendChild(b);
    }
    el.appendChild(deco);
  }
  if (name === 'parks' || name === 'season') {
    // « Mes parcs » : projets enregistrés et saison prochaine (stock, agrandissement) réunis
    if (name === 'season') parksTab = 'season';
    flyout = 'parks';
    const draw = () => {
      el.innerHTML = '';
      const tabs = h(`<div class="flyout-tabs"><button data-t="projects" class="${parksTab === 'projects' ? 'on' : ''}">Mes projets</button><button data-t="season" class="${parksTab === 'season' ? 'on' : ''}">Saison prochaine</button></div>`);
      tabs.querySelectorAll<HTMLElement>('[data-t]').forEach((b) => {
        b.onclick = () => {
          parksTab = b.dataset.t as typeof parksTab;
          draw();
        };
      });
      el.appendChild(tabs);
      if (parksTab === 'projects') {
        el.appendChild(
          parksFlyout(
            {
              current: () => store.project,
              stats: projectStats,
              open: (p) => {
                store.setProject(p);
                viewport.frameAll();
              },
              toast,
              login: () => openAuthDialog(afterLogin),
            },
            draw,
          ),
        );
        refreshUserBtn();
      } else {
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
      }
    };
    draw();
  }
  if (name === 'templates') {
    el.appendChild(h(`<h3>Dernières générations</h3>`));
    const recent = loadRecent();
    if (!recent.length) el.appendChild(h(`<div class="empty">Vos trois dernières générations aléatoires apparaîtront ici.</div>`));
    const rl = h(`<div class="recent-list"></div>`);
    for (const r of recent) {
      const b = h(`<button class="recent">${r.thumb ? `<img src="${r.thumb}" alt="">` : '<span class="noimg"></span>'}<span><b>${esc(r.name)}</b><small>${r.modules} modules · ${r.capacity} pers. · ${eur(r.total)}</small><small>${new Date(r.at).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</small></span></button>`);
      b.onclick = () => {
        store.setProject(structuredClone(r.project));
        account.currentParkId = null;
        viewport.frameAll();
        track('recent_open');
        toast(`« ${r.name} » rouvert — Ctrl+Z pour revenir`);
      };
      rl.appendChild(b);
    }
    el.appendChild(rl);
    // modèles : ceux du type de plan d'eau affiché d'abord (piscine ou lac)
    const isPool = store.project.site.kind === 'pool';
    const groups: [string, typeof TEMPLATES][] = [
      ['Modèles piscine', TEMPLATES.filter((t) => t.site.kind === 'pool')],
      ['Modèles lac', TEMPLATES.filter((t) => t.site.kind !== 'pool')],
    ];
    if (!isPool) groups.reverse();
    for (const [title, items] of groups) {
      el.appendChild(h(`<h3 style="margin-top:18px">${title}</h3>`));
      const list = h(`<div class="tpl-list"></div>`);
      for (const t of items) {
        const b = h(`<button class="tpl"><b>${t.name}</b><span>${t.desc}<br>${t.site.kind === 'pool' ? 'Bassin ' : ''}${String(t.site.length).replace('.', ',')} × ${String(t.site.width).replace('.', ',')} m · profondeur ${String(t.site.depth).replace('.', ',')} m</span></button>`);
        b.onclick = () => {
          genParams = { ...t.params };
          const site = t.site.kind === 'pool' ? { ...t.site } : { ...t.site, outline: naturalOutline(t.site.length, t.site.width, t.site.length + t.site.width) };
          runGenerator(t.params, { site, name: t.name });
          if (t.site.kind === 'pool') store.update((p) => (p.decor = defaultPoolDecor(p.site, decorUid)), false);
          else store.update((p) => (p.decor = undefined), false);
          closeFlyout();
        };
        list.appendChild(b);
      }
      el.appendChild(list);
    }
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
        <kbd>B</kbd><span>Remodeler le rivage (ou clic sur la plage)</span>
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
    ['shore', 'Remodeler le rivage (ou cliquer sur la plage)', 'B', () => setTool(tool === 'shore' ? 'select' : 'shore'), tool === 'shore'],
    null,
    ['grid', 'Catalogue', 'C', () => (closeFlyout(), catalog.toggle()), catalog.isOpen()],
    ['layout', 'Modèles de parcs', '', () => openFlyout('templates'), flyout === 'templates'],
    ['waves', "Plan d'eau, public & GPS", '', () => openFlyout('site'), flyout === 'site'],
    ['cloud', 'Mes parcs & saison prochaine', '', () => openFlyout('parks'), flyout === 'parks'],
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
const userBtn = h(`<button class="user-btn" data-action="account"></button>`);
top.appendChild(userBtn);
function refreshUserBtn() {
  userBtn.innerHTML = account.loggedIn ? `<span class="avatar">${esc((account.user!.name || account.user!.email).slice(0, 1).toUpperCase())}</span>` : `${icon('user', 17)}<span>Connexion</span>`;
  userBtn.title = account.loggedIn ? `${account.user!.email} — Mes parcs` : 'Se connecter / créer un compte';
}
function afterLogin() {
  refreshUserBtn();
  toast(`Connecté : ${account.user!.email}`);
  flyout = null;
  openFlyout('parks');
}
refreshUserBtn();
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
  track('export_anchors');
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

// ------------------------------------------------ demande de devis

/**
 * Le client demande un devis, en un seul formulaire : coordonnées (création du compte au passage,
 * pour retrouver son projet), message, envoi. Le parc est enregistré puis transmis à l'équipe commerciale.
 */
function requestQuote() {
  if (!store.project.modules.length) return toast('Construisez d’abord votre parc.');
  const dlg = $<HTMLDialogElement>('#quote-dialog');
  const st = store.derived.stats;
  const errors = store.derived.issues.filter((i) => i.level === 'error').length;
  let mode: 'register' | 'login' = 'register';
  let msg = '';
  let email = '';
  const draw = (err = '') => {
    const guest = !account.loggedIn;
    dlg.innerHTML = `
    <form method="dialog" class="quote-form">
    <div class="dlg-head"><h2>Recevoir mon devis</h2><p>Nos équipes reprennent « ${esc(store.project.name)} », vérifient l'implantation et vous envoient un devis personnalisé.</p></div>
    <div class="dlg-body">
      <div class="quote-sum"><div><b>${st.modules}</b><span>modules</span></div><div><b>${st.capacity}</b><span>personnes</span></div><div><b>${eur(st.total)}</b><span>estimation HT</span></div></div>
      ${errors ? `<div class="form-error">${errors} point${errors > 1 ? 's' : ''} de règles à corriger : nos équipes vous aideront à les résoudre.</div>` : ''}
      ${
        guest
          ? `<div class="fields quote-fields">
          ${
            mode === 'register'
              ? `<label class="field">Nom<input name="name" autocomplete="name" required></label>
                 <label class="field">Société / site<input name="company" autocomplete="organization" placeholder="Base nautique, camping…"></label>
                 <label class="field">E-mail<input name="email" type="email" autocomplete="email" required></label>
                 <label class="field">Téléphone<input name="phone" type="tel" autocomplete="tel"></label>
                 <label class="field full">Mot de passe <small class="muted">(pour retrouver votre projet)</small><input name="password" type="password" minlength="8" autocomplete="new-password" required></label>`
              : `<label class="field">E-mail<input name="email" type="email" autocomplete="email" required></label>
                 <label class="field">Mot de passe<input name="password" type="password" autocomplete="current-password" required></label>`
          }
        </div>
        <button type="button" class="link-btn quote-switch" data-a="switch">${mode === 'register' ? 'J’ai déjà un compte' : 'Créer un compte'}</button>`
          : `<div class="muted quote-who">Envoyé au nom de ${esc(account.user!.name || account.user!.email)} (${esc(account.user!.email)})</div>`
      }
      <label class="field" style="margin-top:12px">Votre message <small class="muted">(facultatif)</small><textarea rows="3" name="msg" placeholder="Ouverture souhaitée en juin, accès camion par le parking nord…">${esc(msg)}</textarea></label>
      ${err ? `<div class="form-error">${esc(err)}</div>` : ''}
    </div>
    <div class="dlg-foot"><button type="button" class="btn" data-a="cancel">Annuler</button><button type="submit" class="btn primary">Envoyer ma demande</button></div>
    </form>`;
    const form = dlg.querySelector('form')!;
    const emailIn = form.elements.namedItem('email') as HTMLInputElement | null;
    if (emailIn) emailIn.value = email;
    dlg.querySelector<HTMLElement>('[data-a=cancel]')!.onclick = () => dlg.close();
    dlg.querySelector<HTMLElement>('[data-a=switch]')?.addEventListener('click', () => {
      msg = (form.elements.namedItem('msg') as HTMLTextAreaElement).value;
      email = (form.elements.namedItem('email') as HTMLInputElement).value;
      mode = mode === 'register' ? 'login' : 'register';
      draw();
    });
    form.onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const v = (k: string) => String(fd.get(k) ?? '');
      msg = v('msg');
      email = v('email');
      const send = form.querySelector<HTMLButtonElement>('[type=submit]')!;
      send.disabled = true;
      try {
        if (!account.loggedIn) {
          await account.auth(mode, v('email'), v('password'), { name: v('name'), company: v('company'), phone: v('phone') });
          refreshUserBtn();
        }
        const id = await account.save(store.project, false, projectStats());
        await account.quoteRequest(id, msg);
        dlg.close();
        toast('Demande envoyée : nous revenons vers vous très vite. Votre projet est enregistré dans votre compte.', 6000);
      } catch (er) {
        const m = (er as Error).message;
        if (/existe déjà/.test(m)) mode = 'login';
        draw(/existe déjà/.test(m) ? 'Un compte existe déjà avec cette adresse : saisissez votre mot de passe.' : m);
      }
    };
  };
  draw();
  dlg.showModal();
}

// ------------------------------------------------ assistant de conception

const assistant = initAssistant({
  project: () => store.project,
  params: () => ({ ...genParams, audience: store.project.audience }),
  total: () => store.derived.stats.total,
  apply: (plan) => {
    genParams = { ...plan.params };
    queueMicrotask(rememberGeneration);
    const keepName = !/^(Nouveau parc|Parc [a-zé]+-\d+)$/.test(store.project.name);
    store.setProject({ ...store.project, name: keepName ? store.project.name : `Parc ${plan.params.seed}`, site: plan.site, audience: plan.params.audience, modules: plan.modules });
    viewport.frameAll();
    track('generate', { seed: plan.params.seed, capacity: plan.params.capacity, budget: plan.params.budget ?? 0, modules: plan.modules.length, via: 'assistant' });
  },
  openRealSite: () => void openRealSite(),
  requestQuote,
  track,
});

// ------------------------------------------------ rafraîchissement

let saveTimer = 0;
let lastAudience = store.project.audience;
function refreshUI() {
  if (document.activeElement !== nameInput) nameInput.value = store.project.name;
  renderInspector(store, { rotate: rotateSelection, duplicate: duplicateSelection, remove: deleteSelection, focus: () => viewport.focusSelection() });
  renderHud(
    store,
    (uids) => {
      store.select(uids);
      viewport.focusSelection();
    },
    requestQuote,
  );
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
viewport.onLandClick = () => {
  if (store.project.site.kind !== 'pool') setTool('shore');
};
viewport.onDecorSelect = (uid) => {
  const d = uid ? store.project.decor?.find((x) => x.uid === uid) : null;
  if (d) toast(`${DECOR[d.type].name} : glissez pour déplacer · R pour pivoter · Suppr pour retirer`, 4000);
};
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
  track('pen', { modules: added.length, length: Math.round(res.length) });
  const pct = Math.round(res.coverage * 100);
  const shape = { droit: 'ligne droite', segments: 'segments droits et virages', boucle: 'boucle' }[res.shape];
  toast(`${added.length} modules en ${shape}${res.extended ? ', parc prolongé' : ''}${pct < 90 ? ` (${pct} % du tracé)` : ''} — Ctrl+Z pour annuler`);
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
    account.currentParkId = null;
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
    account.currentParkId = null;
    store.setProject({ ...emptyProject(), audience: store.project.audience });
    openStartDialog();
  },
  open: () => fileInput.click(),
  save: async () => {
    autosave(store.project);
    if (account.loggedIn) {
      try {
        await account.save(store.project, false, projectStats());
        toast('Parc enregistré dans votre compte');
        if (flyout === 'parks') (flyout = null), openFlyout('parks');
      } catch (e) {
        toast(`Enregistrement en ligne impossible : ${(e as Error).message}`);
      }
      return;
    }
    downloadJSON(store.project);
    toast('Projet téléchargé (.json) — connectez-vous pour l’enregistrer en ligne');
  },
  account: () => (account.loggedIn ? openFlyout('parks') : openAuthDialog(afterLogin)),
  'export-menu': (btn) => {
    const r = btn.getBoundingClientRect();
    exportMenu.style.top = `${r.bottom + 10}px`;
    exportMenu.style.left = `${Math.min(r.left, window.innerWidth - 260)}px`;
    exportMenu.hidden = !exportMenu.hidden;
  },
  report: () => {
    track('export_pdf', { total: store.derived.stats.total });
    if (!printReport(store.project, store.derived.stats, store.derived.issues, viewport.screenshot())) toast('Autorisez les fenêtres pop-up pour générer le devis PDF');
  },
  csv: () => {
    track('export_csv');
    downloadCSV(store.project, store.derived.stats);
  },
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
  // aménagement sélectionné (gradins, transats…) : R pivote, Suppr retire, Échap désélectionne
  const deco = viewport.decorSelected;
  if (deco && (k === 'r' || k === 'delete' || k === 'backspace' || k === 'escape')) {
    e.preventDefault();
    if (k === 'escape') return viewport.selectDecor(null);
    store.update((p) => {
      if (k === 'r') {
        const d = p.decor?.find((x) => x.uid === deco);
        if (d) d.rot = (d.rot + (e.shiftKey ? Math.PI / 12 : Math.PI / 2)) % (Math.PI * 2);
      } else p.decor = (p.decor ?? []).filter((x) => x.uid !== deco);
    });
    return;
  }
  if (k === 'delete' || k === 'backspace') return e.preventDefault(), deleteSelection();
  if (/^[1-9]$/.test(k) && recent[Number(k) - 1]) return addModule(recent[Number(k) - 1]);
  if (k === 'c') return closeFlyout(), catalog.toggle();
  if (k === 'v') return setTool('select');
  if (k === 'p') return setTool(tool === 'pen' ? 'select' : 'pen');
  if (k === 'b') return setTool(tool === 'shore' ? 'select' : 'shore');
  if (k === 'r') return rotateSelection(e.shiftKey ? 15 : 90);
  if (k === 'g') return randomPark();
  if (k === 'f') return viewport.focusSelection();
  if (k === '?') return openFlyout('help');
  if (k === 'escape') {
    if (catalog.isOpen()) return catalog.close();
    if (flyout) return closeFlyout();
    if (tool === 'pen' || tool === 'shore') return setTool('select');
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
initTracking();

/** Ouverture normale : projet partagé, projet en cours, ou fenêtre « Nouveau parc ». */
function openWorkspace() {
  const fromHash = projectFromHash(location.hash);
  const saved = fromHash ?? loadAutosave();
  // un projet vide sauvegardé automatiquement ne remplace pas la fenêtre « Nouveau parc »
  if (saved && (fromHash || saved.modules.length)) {
    store.setProject(saved, false);
    viewport.frameAll();
    if (fromHash) toast(`Projet partagé « ${saved.name} » chargé`);
  } else {
    refreshUI();
    viewport.frameAll();
    openStartDialog();
  }
}

/** Lien d'administration : /?park=ID ouvre un projet enregistré (le sien, ou n'importe lequel pour un administrateur). */
async function openParkFromUrl(): Promise<boolean> {
  const id = Number(new URLSearchParams(location.search).get('park'));
  if (!id || !account.loggedIn) return false;
  try {
    const park = await account.load(id);
    account.currentParkId = park.id;
    store.setProject(park.project, false);
    viewport.frameAll();
    toast(`Projet « ${park.project.name} » ouvert${account.isAdmin ? ' (administration)' : ''} — Ctrl+S pour enregistrer`);
    return true;
  } catch (e) {
    toast((e as Error).message);
    return false;
  }
}

// réglages du catalogue définis par l'administrateur (prix, capacités, modules masqués)
fetch('/api/catalog')
  .then((r) => (r.ok ? r.json() : null))
  .then((r) => {
    if (r?.overrides) {
      applyOverrides(r.overrides);
      store.update(() => {}, false);
      catalog.redraw();
    }
  })
  .catch(() => {});

// modèles 3D réalistes générés depuis les rendus officiels (s'il y en a)
void loadRealModels(
  (id) => MODULES.find((m) => m.id === id) ?? null,
  () => viewport.rebuildModules(),
);

refreshUI();
(async () => {
  await account.refresh();
  refreshUserBtn();
  if (await openParkFromUrl()) return;
  openWorkspace();
})();
