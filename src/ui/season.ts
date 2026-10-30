import { MODULES, spec } from '../catalog/modules';
import type { Placed } from '../core/types';
import type { Store } from '../editor/store';
import { ACCESSORY_FACTOR, extendPark, generatePark, type GenParams } from '../generator/generator';
import { eur } from '../io/export';
import { esc, h } from './panels';

/*
 * « Mon parc & saison » : stock de modules possédés (parc existant), puis
 * - agrandir le parc avec un budget (ex. +50 000 € pour la saison prochaine),
 * - recomposer un parc différent avec tout le stock (+ budget éventuel).
 */

export interface SeasonHost {
  store: Store;
  params: () => GenParams;
  toast: (msg: string) => void;
  frame: () => void;
  apply: (mods: Placed[], name?: string) => void;
}

let budget = 50000;
let lastResult = '';

const countOf = (mods: Placed[]) => {
  const c: Record<string, number> = {};
  for (const m of mods) c[m.type] = (c[m.type] ?? 0) + 1;
  return c;
};

/** Lit un inventaire : projet .json (modules posés) ou CSV « module;quantité ». */
export function parseInventory(text: string): Record<string, number> {
  const out: Record<string, number> = {};
  const t = text.trim();
  if (t.startsWith('{')) {
    const p = JSON.parse(t);
    if (p.inventory) return p.inventory;
    for (const m of p.modules ?? []) out[m.type] = (out[m.type] ?? 0) + 1;
    return out;
  }
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  for (const line of t.split(/\r?\n/)) {
    const [name, qty] = line.split(/[;,\t]/).map((c) => c?.replace(/"/g, '').trim());
    if (!name) continue;
    const s = MODULES.find((m) => norm(m.id) === norm(name) || norm(m.name) === norm(name));
    const n = Math.round(Number(qty ?? 1));
    if (s && n > 0) out[s.id] = (out[s.id] ?? 0) + n;
  }
  return out;
}

export function seasonFlyout(host: SeasonHost, rerender: () => void): HTMLElement {
  const { store } = host;
  const inv = store.project.inventory ?? {};
  const total = Object.values(inv).reduce((a, n) => a + n, 0);
  const placed = countOf(store.project.modules);
  const el = h(`<div class="season">
    <h3>Mon stock de modules <span class="muted-inline">${total} module${total > 1 ? 's' : ''}</span></h3>
    <div class="inv-list"></div>
    <div class="inv-add">
      <select data-a="pick"><option value="">Ajouter un module…</option>${[...MODULES].sort((a, b) => a.name.localeCompare(b.name)).map((m) => `<option value="${m.id}">${esc(m.name)}</option>`).join('')}</select>
    </div>
    <div class="btn-row">
      <button class="btn" data-a="from-scene">Reprendre le parc affiché</button>
      <button class="btn" data-a="import">Importer…</button>
      ${total ? '<button class="btn" data-a="clear">Vider</button>' : ''}
    </div>
    <div class="note">Importez un fichier projet (.json) ou une liste Excel/CSV « module ; quantité ».</div>

    <h3 style="margin-top:22px">Saison prochaine</h3>
    <label class="field">Budget supplémentaire (HT)<div class="range-row"><input type="range" min="10000" max="300000" step="5000" data-a="budget" value="${budget}"><output>${eur(budget)}</output></div></label>
    <div class="season-actions">
      <button class="btn primary" data-a="extend"><b>Agrandir le parc affiché</b><span>Garde les modules en place et ajoute de quoi dépenser le budget (stock non installé utilisé d'abord).</span></button>
      <button class="btn" data-a="recompose"><b>Nouvelle composition avec mon stock</b><span>Un autre parc avec les modules possédés, complété par le budget.</span></button>
    </div>
    ${lastResult ? `<div class="result">${lastResult}</div>` : ''}
  </div>`);

  const list = el.querySelector<HTMLElement>('.inv-list')!;
  if (!total) list.appendChild(h(`<div class="empty">Aucun module en stock. Reprenez le parc affiché ou importez votre inventaire.</div>`));
  for (const [id, n] of Object.entries(inv).sort((a, b) => spec(a[0]).name.localeCompare(spec(b[0]).name))) {
    const used = placed[id] ?? 0;
    const row = h(`<div class="inv-row"><span class="grow">${esc(spec(id).name)}${used ? `<small> · ${Math.min(used, n)} installé${used > 1 ? 's' : ''}</small>` : ''}</span>
      <button class="qty" data-d="-1">−</button><b>${n}</b><button class="qty" data-d="1">+</button></div>`);
    row.querySelectorAll<HTMLElement>('[data-d]').forEach((b) => {
      b.onclick = () => {
        store.update((p) => {
          const next = { ...(p.inventory ?? {}) };
          next[id] = (next[id] ?? 0) + Number(b.dataset.d);
          if (next[id] <= 0) delete next[id];
          p.inventory = next;
        });
        rerender();
      };
    });
    list.appendChild(row);
  }

  const setInv = (next: Record<string, number>) => {
    store.update((p) => (p.inventory = next));
    rerender();
  };
  el.querySelector<HTMLSelectElement>('[data-a=pick]')!.onchange = (e) => {
    const id = (e.target as HTMLSelectElement).value;
    if (id) setInv({ ...inv, [id]: (inv[id] ?? 0) + 1 });
  };
  el.querySelector<HTMLElement>('[data-a=from-scene]')!.onclick = () => {
    if (!store.project.modules.length) return host.toast('Le parc affiché est vide.');
    setInv(countOf(store.project.modules));
    host.toast(`${store.project.modules.length} modules ajoutés au stock`);
  };
  el.querySelector<HTMLElement>('[data-a=clear]')?.addEventListener('click', () => setInv({}));
  el.querySelector<HTMLElement>('[data-a=import]')!.onclick = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,.csv,.txt';
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return;
      try {
        const parsed = parseInventory(await f.text());
        const n = Object.values(parsed).reduce((a, b) => a + b, 0);
        if (!n) return host.toast('Aucun module reconnu dans ce fichier.');
        setInv(parsed);
        host.toast(`Stock importé : ${n} modules`);
      } catch {
        host.toast('Fichier illisible.');
      }
    };
    input.click();
  };
  const range = el.querySelector<HTMLInputElement>('[data-a=budget]')!;
  range.oninput = () => {
    budget = Number(range.value);
    (range.nextElementSibling as HTMLOutputElement).value = eur(budget);
  };

  const summarize = (added: Placed[], spent: number, stockUsed: number) => {
    const c = countOf(added);
    const cap = added.reduce((a, m) => a + (spec(m.type).role === 'watch' ? 0 : spec(m.type).cap), 0);
    lastResult = `<b>${added.length} modules</b> · ${eur(spent * ACCESSORY_FACTOR)} HT avec produits à prévoir · +${cap} places${stockUsed ? ` · ${stockUsed} du stock` : ''}
      <div class="result-list">${Object.entries(c)
        .map(([id, n]) => `<span>${n} × ${esc(spec(id).name)}</span>`)
        .join('')}</div>`;
  };

  el.querySelector<HTMLElement>('[data-a=extend]')!.onclick = () => {
    if (!store.project.modules.length) return host.toast('Affichez d’abord le parc existant (ouvrir, générer ou reprendre un projet).');
    // modules du stock qui ne sont pas encore installés
    const spare: Record<string, number> = {};
    for (const [id, n] of Object.entries(inv)) {
      const left = n - (placed[id] ?? 0);
      if (left > 0) spare[id] = left;
    }
    const p = { ...host.params(), audience: store.project.audience, budget, stock: Object.keys(spare).length ? spare : undefined };
    const res = extendPark(store.project.site, store.project.modules, p);
    if (!res || !res.modules.length) return host.toast('Pas de place pour agrandir ce parc sur ce plan d’eau : agrandissez la zone ou baissez le budget.');
    host.apply([...store.project.modules, ...res.modules.map((m) => ({ ...m, uid: '' }))]);
    summarize(res.modules, res.spent, res.stockUsed);
    host.toast(`Agrandissement : ${res.modules.length} modules ajoutés (sélectionnés) — Ctrl+Z pour annuler`);
    rerender();
  };
  el.querySelector<HTMLElement>('[data-a=recompose]')!.onclick = () => {
    if (!total) return host.toast('Renseignez d’abord votre stock de modules.');
    const p = { ...host.params(), audience: store.project.audience, capacity: 2000, budget, stock: inv, seed: `${host.params().seed}-stock` };
    const res = generatePark(store.project.site, p);
    if (!res.modules.length) return host.toast('Impossible de composer un parc avec ce stock sur ce plan d’eau.');
    host.apply(res.modules, `${store.project.name} — recomposé`);
    summarize(res.modules, res.spent ?? 0, res.stockUsed ?? 0);
    host.toast(`Nouvelle composition : ${res.stockUsed}/${total} modules du stock utilisés`);
    host.frame();
    rerender();
  };
  return el;
}
