import { CATEGORY_LABELS, MODULES, spec } from '../catalog/modules';
import type { Audience, Category, ModuleSpec } from '../core/types';
import type { Store } from '../editor/store';
import { accessoryRows, eur, num } from '../io/export';
import { AUDIENCE_LIMITS } from '../rules/validate';

export const thumbs = new Map<string, string>();

const h = (html: string) => {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild as HTMLElement;
};
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const dots = (n: number) => '●'.repeat(n) + '○'.repeat(5 - n);
const sizeOf = (s: ModuleSpec) => s.displaySize ?? `${num(s.L)} × ${num(s.W)} m`;

// ------------------------------------------------ catalogue

export interface CatalogHandlers {
  onAdd: (type: string) => void;
}

export function renderCatalog(store: Store, handlers: CatalogHandlers) {
  const root = document.getElementById('catalog')!;
  const search = document.getElementById('search') as HTMLInputElement;
  const filters = document.getElementById('filters')!;
  let cat: Category | 'all' = 'all';
  let fitSite = false;

  const chips: [Category | 'all', string][] = [['all', 'Tous'], ...(Object.entries(CATEGORY_LABELS).map(([k, v]) => [k, v.split(' —')[0]]) as [Category, string][])];
  const draw = () => {
    filters.innerHTML = '';
    for (const [k, label] of chips) {
      const b = h(`<button class="chip ${cat === k ? 'on' : ''}">${label}</button>`);
      b.onclick = () => {
        cat = k;
        draw();
      };
      filters.appendChild(b);
    }
    const fb = h(`<button class="chip ${fitSite ? 'on' : ''}" title="Masquer les modules trop profonds ou hors profil public">Compatibles site</button>`);
    fb.onclick = () => {
      fitSite = !fitSite;
      draw();
    };
    filters.appendChild(fb);

    const q = search.value.trim().toLowerCase();
    const lim = AUDIENCE_LIMITS[store.project.audience];
    root.innerHTML = '';
    for (const [c, label] of Object.entries(CATEGORY_LABELS) as [Category, string][]) {
      if (cat !== 'all' && cat !== c) continue;
      const list = MODULES.filter((s) => s.category === c)
        .filter((s) => !q || s.name.toLowerCase().includes(q) || s.desc.toLowerCase().includes(q))
        .filter((s) => !fitSite || (s.depth <= store.project.site.depth && (s.role === 'watch' || (s.H <= lim.maxH && s.diff <= lim.maxDiff))))
        .sort((a, b) => a.name.localeCompare(b.name));
      if (!list.length) continue;
      root.appendChild(h(`<div class="cat-title">${label} · ${list.length}</div>`));
      const grid = h(`<div class="grid-cards"></div>`);
      for (const s of list) {
        const card = h(`<button class="mod-card" draggable="true" data-id="${s.id}" title="${esc(s.desc)}\nCliquer : ajouter (accroché au module sélectionné)\nGlisser : déposer dans la scène">
          <div class="thumb">${thumbs.get(s.id) ? `<img alt="" src="${thumbs.get(s.id)}">` : ''}</div>
          <div class="name">${esc(s.name)}</div>
          <div class="meta"><span>${sizeOf(s)}</span><span>${num(s.H)} m</span></div>
          <div class="meta"><span class="dots" title="Difficulté">${dots(s.diff)}</span><span>${eur(s.price)}</span></div>
        </button>`);
        card.onclick = () => handlers.onAdd(s.id);
        card.addEventListener('dragstart', (e) => {
          e.dataTransfer?.setData('text/wibit-module', s.id);
          if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy';
        });
        grid.appendChild(card);
      }
      root.appendChild(grid);
    }
  };
  search.oninput = draw;
  draw();
  return {
    redraw: draw,
    setThumb(id: string, url: string) {
      const img = root.querySelector<HTMLElement>(`.mod-card[data-id="${id}"] .thumb`);
      if (img) img.innerHTML = `<img alt="" src="${url}">`;
    },
  };
}

// ------------------------------------------------ inspecteur

export interface InspectorHandlers {
  rotate: (deg: number) => void;
  duplicate: () => void;
  remove: () => void;
  focus: () => void;
}

export function renderInspector(store: Store, hd: InspectorHandlers) {
  const el = document.getElementById('inspector')!;
  const sel = store.selected();
  if (!sel.length) {
    el.innerHTML = `<h3>Sélection</h3><div class="empty">Cliquez sur un module dans la scène, ou sur une carte du catalogue pour l'ajouter.
      Un module ajouté pendant qu'un autre est sélectionné s'y accroche automatiquement.</div>`;
    return;
  }
  if (sel.length > 1) {
    const price = sel.reduce((a, m) => a + spec(m.type).price, 0);
    el.innerHTML = `<h3>Sélection <span>${sel.length} modules</span></h3><div class="kv"><span>Prix cumulé</span><span>${eur(price)}</span></div>`;
  } else {
    const m = sel[0];
    const s = spec(m.type);
    const used = store.derived.graph.usedPorts.get(m.uid)?.size ?? 0;
    const issues = store.derived.issues.filter((i) => i.uids.includes(m.uid) && i.level !== 'info');
    el.innerHTML = `<h3>Module sélectionné</h3>
      <div class="insp-head">${thumbs.get(s.id) ? `<img alt="" src="${thumbs.get(s.id)}">` : ''}<div><b>${esc(s.name)}</b><div class="desc">${esc(s.desc)}</div></div></div>
      <div class="kv">
        <span>Dimensions</span><span>${sizeOf(s)} · H ${num(s.H)} m</span>
        <span>Profondeur min.</span><span>${num(s.depth, 2)} m</span>
        <span>Difficulté</span><span class="dots">${dots(s.diff)}</span>
        <span>Capacité (estim.)</span><span>${s.role === 'watch' ? 'poste de surveillance' : s.cap + ' pers.'}</span>
        <span>Connexions</span><span>${used} / ${s.ports.length}</span>
        <span>Ancrages (estim.)</span><span>${s.anchors}</span>
        <span>Prix indicatif HT</span><span>${eur(s.price)}</span>
        <span>Position</span><span>${num(m.x)} ; ${num(m.z)} m · ${Math.round((((m.rot * 180) / Math.PI) % 360 + 360) % 360)}°</span>
      </div>
      ${issues.length ? `<div class="issues-list" style="margin-top:8px">${issues.map((i) => `<div class="issue"><span class="lvl ${i.level}"></span><span>${esc(i.message)}</span></div>`).join('')}</div>` : ''}`;
  }
  const row = h(`<div class="btn-row">
      <button class="btn" data-a="l">⟲ 90°</button><button class="btn" data-a="r">⟳ 90°</button>
      <button class="btn" data-a="dup">Dupliquer</button><button class="btn" data-a="focus">Centrer</button>
      <button class="btn danger" data-a="del">Supprimer</button></div>`);
  row.querySelector<HTMLElement>('[data-a="l"]')!.onclick = () => hd.rotate(90);
  row.querySelector<HTMLElement>('[data-a="r"]')!.onclick = () => hd.rotate(-90);
  row.querySelector<HTMLElement>('[data-a="dup"]')!.onclick = hd.duplicate;
  row.querySelector<HTMLElement>('[data-a="del"]')!.onclick = hd.remove;
  row.querySelector<HTMLElement>('[data-a="focus"]')!.onclick = hd.focus;
  el.appendChild(row);
}

// ------------------------------------------------ site / projet

export function renderSite(store: Store, onChange: () => void) {
  const el = document.getElementById('site')!;
  if (el.contains(document.activeElement)) return; // ne pas casser la saisie en cours
  const { site, audience } = store.project;
  el.innerHTML = `<h3>Plan d'eau & public</h3>
    <div class="form">
      <label>Longueur (rivage) m<input type="number" min="15" max="400" step="1" data-k="length" value="${site.length}"></label>
      <label>Largeur (vers le large) m<input type="number" min="15" max="400" step="1" data-k="width" value="${site.width}"></label>
      <label>Profondeur m<input type="number" min="0.8" max="15" step="0.1" data-k="depth" value="${site.depth}"></label>
      <label>Public<select data-k="audience">${(Object.keys(AUDIENCE_LIMITS) as Audience[]).map((a) => `<option value="${a}" ${a === audience ? 'selected' : ''}>${AUDIENCE_LIMITS[a].label}</option>`).join('')}</select></label>
    </div>
    <div class="note">Le rivage est en bas de la scène (plage). Ligne orange : distance de sécurité de 3 m aux bords.</div>`;
  el.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-k]').forEach((inp) => {
    inp.onchange = () => {
      const k = inp.dataset.k!;
      store.update((p) => {
        if (k === 'audience') p.audience = inp.value as Audience;
        else {
          const i = inp as HTMLInputElement;
          const v = Math.max(Number(i.min), Math.min(Number(i.max), Number(i.value) || 0));
          (p.site as any)[k] = v;
        }
      });
      inp.blur();
      onChange();
    };
  });
}

// ------------------------------------------------ résumé & devis

export function renderSummary(store: Store) {
  const el = document.getElementById('summary')!;
  const st = store.derived.stats;
  const acc = accessoryRows(st);
  el.innerHTML = `<h3>Résumé & devis</h3>
    <div class="kv">
      <span>Modules</span><span>${st.modules}</span>
      <span>Capacité estimée</span><span>${st.capacity} pers.</span>
      <span>Emprise</span><span>${num(st.footprint.w, 0)} × ${num(st.footprint.d, 0)} m</span>
      <span>Surface gonflable</span><span>${num(st.area, 0)} m²</span>
      <span>Boucles InfinityLoop</span><span>${st.loops}</span>
      <span>Accès / postes de surveillance</span><span>${st.accesses} / ${st.watchPosts}</span>
      <span>Modules (HT)</span><span>${eur(st.price)}</span>
    </div>
    <div class="note" style="margin-top:10px;font-weight:600;color:var(--ink)">Produits à prévoir</div>
    <div class="kv">${acc.map((r) => `<span>${r.qty} × ${r.name}</span><span>${eur(r.qty * r.unit)}</span>`).join('')}</div>
    <div class="total"><span>Total HT estimé</span><b>${eur(st.total)}</b></div>
    <div class="note">Prix, capacités et ancrages : estimations de démonstration, à remplacer par la grille Wibit.</div>`;
}

// ------------------------------------------------ contrôle des règles

export function renderIssues(store: Store, onPick: (uids: string[]) => void) {
  const el = document.getElementById('issues')!;
  const issues = store.derived.issues;
  const n = (l: string) => issues.filter((i) => i.level === l).length;
  const errors = n('error'),
    warnings = n('warning');
  el.innerHTML = `<h3>Contrôle des règles <span class="badges">${errors ? `<span class="badge error">${errors}</span>` : ''}${warnings ? `<span class="badge warning">${warnings}</span>` : ''}${!errors && !warnings ? '<span class="badge ok">OK</span>' : ''}</span></h3>`;
  if (!store.project.modules.length) {
    el.appendChild(h(`<div class="empty">Aucun module. Ajoutez-en depuis le catalogue ou cliquez sur « 🎲 Parc aléatoire ».</div>`));
    return;
  }
  if (!issues.length) {
    el.appendChild(h(`<div class="empty">Toutes les règles de conception sont respectées.</div>`));
    return;
  }
  const order = { error: 0, warning: 1, info: 2 };
  const list = h(`<div class="issues-list"></div>`);
  for (const i of [...issues].sort((a, b) => order[a.level] - order[b.level])) {
    const b = h(`<button class="issue"><span class="lvl ${i.level}"></span><span><span class="rule">${i.rule}</span> ${esc(i.message)}</span></button>`);
    b.onclick = () => i.uids.length && onPick(i.uids);
    list.appendChild(b);
  }
  el.appendChild(list);
}
