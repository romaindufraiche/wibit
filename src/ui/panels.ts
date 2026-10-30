import { CATEGORY_LABELS, MODULES, spec } from '../catalog/modules';
import type { Audience, Category, ModuleSpec } from '../core/types';
import type { Store } from '../editor/store';
import { accessoryRows, eur, num } from '../io/export';
import { AUDIENCE_LIMITS } from '../rules/validate';
import { icon } from './icons';

export const thumbs = new Map<string, string>();

export const h = (html: string) => {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild as HTMLElement;
};
export const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const level = (n: number) => `<span class="level" title="Difficulté ${n}/5">${[1, 2, 3, 4, 5].map((i) => `<i class="${i <= n ? 'on' : ''}"></i>`).join('')}</span>`;
export const sizeOf = (s: ModuleSpec) => s.displaySize ?? `${num(s.L)} × ${num(s.W)} m`;
const thumbImg = (id: string) => (thumbs.get(id) ? `<img alt="" src="${thumbs.get(id)}">` : '');

const SHORT_CAT: Record<Category, string> = {
  fun: 'Parcours',
  matchtrack: 'MatchTrack',
  watch: 'Surveillance',
  technical: 'Bases & jonctions',
  standalone: 'Autonomes',
};

// ------------------------------------------------ catalogue plein format

export interface CatalogApi {
  open(): void;
  close(): void;
  toggle(): void;
  isOpen(): boolean;
  redraw(): void;
  setThumb(id: string): void;
}

export function initCatalog(store: Store, onAdd: (type: string) => void, onVisibility: (open: boolean) => void): CatalogApi {
  const panel = document.getElementById('catalog')!;
  const grid = document.getElementById('catalog-grid')!;
  const tabs = document.getElementById('cat-tabs')!;
  const search = document.getElementById('search') as HTMLInputElement;
  const fit = document.getElementById('fit-site') as HTMLInputElement;
  document.querySelector('.search-ico')!.innerHTML = icon('search', 16);
  const closeBtn = document.getElementById('catalog-close')!;
  closeBtn.innerHTML = icon('x', 18);
  let cat: Category | 'all' = 'all';

  const fits = (s: ModuleSpec) => {
    const lim = AUDIENCE_LIMITS[store.project.audience];
    return s.depth <= store.project.site.depth && (s.role === 'watch' || (s.H <= lim.maxH && s.diff <= lim.maxDiff));
  };

  const draw = () => {
    const q = search.value.trim().toLowerCase();
    const list = MODULES.filter((s) => !q || s.name.toLowerCase().includes(q) || s.desc.toLowerCase().includes(q)).filter((s) => !fit.checked || fits(s));
    tabs.innerHTML = '';
    const cats: (Category | 'all')[] = ['all', ...(Object.keys(CATEGORY_LABELS) as Category[])];
    for (const c of cats) {
      const n = c === 'all' ? list.length : list.filter((s) => s.category === c).length;
      const b = h(`<button class="cat-tab ${cat === c ? 'on' : ''}">${c === 'all' ? 'Tous' : SHORT_CAT[c]}<small>${n}</small></button>`);
      b.onclick = () => {
        cat = c;
        draw();
      };
      tabs.appendChild(b);
    }
    grid.innerHTML = '';
    const shown = list.filter((s) => cat === 'all' || s.category === cat).sort((a, b) => a.name.localeCompare(b.name));
    if (!shown.length) grid.appendChild(h(`<div class="empty">Aucun module ne correspond.</div>`));
    for (const s of shown) {
      const card = h(`<button class="card ${fits(s) ? '' : 'unfit'}" draggable="true" data-id="${s.id}" title="${esc(s.desc)}">
          <div class="thumb">${thumbImg(s.id)}</div>
          <div class="body">
            <div class="meta"><span class="name">${esc(s.name)}</span>${level(s.diff)}</div>
            <div class="meta"><span>${sizeOf(s)} · H ${num(s.H)} m</span></div>
          </div>
        </button>`);
      card.onclick = () => onAdd(s.id);
      card.addEventListener('dragstart', (e) => {
        e.dataTransfer?.setData('text/wibit-module', s.id);
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy';
        // le catalogue s'efface pour laisser déposer dans la scène
        requestAnimationFrame(() => panel.classList.add('dragging'));
      });
      card.addEventListener('dragend', () => {
        panel.classList.remove('dragging');
        api.close();
      });
      grid.appendChild(card);
    }
  };

  const api: CatalogApi = {
    open() {
      panel.hidden = false;
      draw();
      onVisibility(true);
    },
    close() {
      panel.hidden = true;
      onVisibility(false);
    },
    toggle() {
      if (panel.hidden) api.open();
      else api.close();
    },
    isOpen: () => !panel.hidden,
    redraw: () => !panel.hidden && draw(),
    setThumb(id) {
      const t = grid.querySelector<HTMLElement>(`.card[data-id="${id}"] .thumb`);
      if (t) t.innerHTML = thumbImg(id);
    },
  };
  search.oninput = draw;
  fit.onchange = draw;
  closeBtn.onclick = api.close;
  return api;
}

// ------------------------------------------------ barre rapide

export function renderHotbar(recent: string[], catalogOpen: boolean, onAdd: (t: string) => void, onCatalog: () => void) {
  const bar = document.getElementById('hotbar')!;
  bar.innerHTML = '';
  const cat = h(`<button class="slot-catalog ${catalogOpen ? 'on' : ''}" title="Catalogue (C)">${icon(catalogOpen ? 'x' : 'grid', 20)}<span>${catalogOpen ? 'Fermer' : 'Catalogue'}</span></button>`);
  cat.onclick = onCatalog;
  bar.appendChild(cat);
  if (catalogOpen) return;
  bar.appendChild(h(`<span class="vsep"></span>`));
  if (!recent.length) {
    bar.appendChild(h(`<span class="hint">Les modules que vous utilisez apparaîtront ici.</span>`));
    return;
  }
  recent.slice(0, 9).forEach((id, i) => {
    const s = spec(id);
    const b = h(`<button class="slot" title="${esc(s.name)} — touche ${i + 1}"><span class="num">${i + 1}</span>${thumbImg(id)}</button>`);
    b.onclick = () => onAdd(id);
    b.draggable = true;
    b.addEventListener('dragstart', (e) => e.dataTransfer?.setData('text/wibit-module', id));
    bar.appendChild(b);
  });
}

// ------------------------------------------------ tableau de bord (devis + règles)

let rulesOpen = false;
let detailsOpen = false;

export function renderHud(store: Store, onPick: (uids: string[]) => void) {
  const el = document.getElementById('hud')!;
  const st = store.derived.stats;
  const issues = store.derived.issues;
  const errors = issues.filter((i) => i.level === 'error').length;
  const warnings = issues.filter((i) => i.level === 'warning').length;
  const lvl = !st.modules ? 'info' : errors ? 'error' : warnings ? 'warning' : 'ok';
  const label = !st.modules ? 'Aucun module' : errors ? `${errors} erreur${errors > 1 ? 's' : ''}${warnings ? ` · ${warnings} alerte${warnings > 1 ? 's' : ''}` : ''}` : warnings ? `${warnings} alerte${warnings > 1 ? 's' : ''}` : 'Parc conforme';
  el.innerHTML = `
    <div class="hud-total"><b>${eur(st.total)}</b><span>HT estimé</span></div>
    <div class="stats">
      <div class="stat"><b>${st.capacity}</b><span>personnes</span></div>
      <div class="stat"><b>${st.modules}</b><span>modules</span></div>
      <div class="stat"><b>${num(st.footprint.w, 0)}×${num(st.footprint.d, 0)}</b><span>mètres</span></div>
    </div>
    <button class="status ${rulesOpen ? 'open' : ''}" data-a="rules"><span class="dot ${lvl}"></span><span class="grow">${label}</span>${issues.length ? icon('chevron', 16) : ''}</button>`;
  if (rulesOpen && issues.length) {
    const order = { error: 0, warning: 1, info: 2 };
    const list = h(`<div class="issue-list"></div>`);
    for (const i of [...issues].sort((a, b) => order[a.level] - order[b.level])) {
      const b = h(`<button class="issue"><span class="dot ${i.level}"></span><span>${esc(i.message)}</span></button>`);
      b.onclick = () => i.uids.length && onPick(i.uids);
      list.appendChild(b);
    }
    el.appendChild(list);
  }
  const det = h(`<button class="link">${detailsOpen ? 'Masquer le détail' : 'Détail du devis'}</button>`);
  det.onclick = () => {
    detailsOpen = !detailsOpen;
    renderHud(store, onPick);
  };
  el.appendChild(det);
  if (detailsOpen) {
    const acc = accessoryRows(st);
    el.appendChild(
      h(`<div class="details">
        <div class="row"><span>Modules</span><span>${eur(st.price)}</span></div>
        ${acc.map((r) => `<div class="row"><span>${r.qty} × ${esc(r.name)}</span><span>${eur(r.qty * r.unit)}</span></div>`).join('')}
        <div class="row"><span>Boucles · accès · surveillance</span><span>${st.loops} · ${st.accesses} · ${st.watchPosts}</span></div>
        <div class="note">Prix, capacités et ancrages : estimations de démonstration.</div>
      </div>`),
    );
  }
  el.querySelector<HTMLElement>('[data-a=rules]')!.onclick = () => {
    rulesOpen = !rulesOpen;
    renderHud(store, onPick);
  };
}

// ------------------------------------------------ inspecteur (sélection)

export interface InspectorHandlers {
  rotate: (deg: number) => void;
  duplicate: () => void;
  remove: () => void;
  focus: () => void;
}

export function renderInspector(store: Store, hd: InspectorHandlers) {
  const el = document.getElementById('inspector')!;
  const sel = store.selected();
  el.hidden = sel.length === 0;
  if (!sel.length) return;
  if (sel.length > 1) {
    const price = sel.reduce((a, m) => a + spec(m.type).price, 0);
    el.innerHTML = `<div class="insp-head"><div><b>${sel.length} modules</b><div class="desc">${eur(price)} HT</div></div></div>`;
  } else {
    const m = sel[0];
    const s = spec(m.type);
    const used = store.derived.graph.usedPorts.get(m.uid)?.size ?? 0;
    const issues = store.derived.issues.filter((i) => i.uids.includes(m.uid) && i.level !== 'info');
    el.innerHTML = `
      <div class="insp-head">${thumbImg(s.id)}<div><b>${esc(s.name)}</b><div class="desc">${esc(s.desc)}</div></div></div>
      <div class="chips">
        <span class="chip"><b>${sizeOf(s)}</b></span><span class="chip">H <b>${num(s.H)} m</b></span>
        <span class="chip">Prof. <b>${num(s.depth, 2)} m</b></span>
        <span class="chip"><b>${s.role === 'watch' ? 'Surveillance' : s.cap + ' pers.'}</b></span>
        <span class="chip">Connexions <b>${used}/${s.ports.length}</b></span>
        <span class="chip"><b>${eur(s.price)}</b></span>
      </div>
      ${issues.length ? `<div class="issue-list">${issues.map((i) => `<div class="issue"><span class="dot ${i.level}"></span><span>${esc(i.message)}</span></div>`).join('')}</div>` : ''}`;
  }
  const actions = h(`<div class="insp-actions">
      <button class="icon-btn" data-a="l" title="Pivoter à gauche (R)">${icon('rotl', 18)}</button>
      <button class="icon-btn" data-a="r" title="Pivoter à droite">${icon('rotr', 18)}</button>
      <button class="icon-btn" data-a="dup" title="Dupliquer (Ctrl+D)">${icon('copy', 18)}</button>
      <button class="icon-btn" data-a="focus" title="Centrer la vue (F)">${icon('focus', 18)}</button>
      <span class="spacer"></span>
      <button class="icon-btn danger" data-a="del" title="Supprimer (Suppr)">${icon('trash', 18)}</button>
    </div>`);
  actions.querySelector<HTMLElement>('[data-a=l]')!.onclick = () => hd.rotate(90);
  actions.querySelector<HTMLElement>('[data-a=r]')!.onclick = () => hd.rotate(-90);
  actions.querySelector<HTMLElement>('[data-a=dup]')!.onclick = hd.duplicate;
  actions.querySelector<HTMLElement>('[data-a=focus]')!.onclick = hd.focus;
  actions.querySelector<HTMLElement>('[data-a=del]')!.onclick = hd.remove;
  el.appendChild(actions);
}

// ------------------------------------------------ plan d'eau & public (panneau latéral)

export function siteFlyout(store: Store, onChange: () => void): HTMLElement {
  const { site, audience } = store.project;
  const el = h(`<div>
    <h3>Plan d'eau</h3>
    <div class="fields">
      <label class="field">Longueur (rivage)<input type="number" min="15" max="400" step="1" data-k="length" value="${site.length}"></label>
      <label class="field">Largeur<input type="number" min="15" max="400" step="1" data-k="width" value="${site.width}"></label>
      <label class="field">Profondeur<input type="number" min="0.8" max="15" step="0.1" data-k="depth" value="${site.depth}"></label>
      <label class="field">Public<select data-k="audience">${(Object.keys(AUDIENCE_LIMITS) as Audience[]).map((a) => `<option value="${a}" ${a === audience ? 'selected' : ''}>${AUDIENCE_LIMITS[a].label}</option>`).join('')}</select></label>
    </div>
    <div class="note">Dimensions en mètres. La plage est en bas de la scène ; la ligne orange marque la distance de sécurité de 3 m aux bords.</div>
  </div>`);
  el.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-k]').forEach((inp) => {
    inp.onchange = () => {
      const k = inp.dataset.k!;
      store.update((p) => {
        if (k === 'audience') p.audience = inp.value as Audience;
        else {
          const i = inp as HTMLInputElement;
          (p.site as any)[k] = Math.max(Number(i.min), Math.min(Number(i.max), Number(i.value) || 0));
        }
      });
      onChange();
    };
  });
  return el;
}
