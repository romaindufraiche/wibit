import { ACCESSORIES, spec } from '../catalog/modules';
import type { Issue, Project } from '../core/types';
import type { Stats } from '../rules/validate';
import { AUDIENCE_LIMITS } from '../rules/validate';
import { APP_NAME } from '../brand';

export const eur = (v: number) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(v);
export const num = (v: number, d = 1) => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: d }).format(v);

function download(name: string, content: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const slug = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase() || 'parc';

export function downloadJSON(p: Project) {
  download(`${slug(p.name)}.wibit.json`, JSON.stringify(p, null, 2), 'application/json');
}

export function parseProject(text: string): Project {
  const p = JSON.parse(text);
  if (p?.version !== 1 || !Array.isArray(p.modules) || !p.site) throw new Error('Fichier de projet invalide.');
  for (const m of p.modules) spec(m.type); // lève si module inconnu
  return p;
}

export function downloadPNG(dataUrl: string, name: string) {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = `${slug(name)}.png`;
  a.click();
}

/** Nomenclature groupée par module. */
export function billOfMaterials(p: Project) {
  const rows = new Map<string, { name: string; qty: number; unit: number; size: string }>();
  for (const m of p.modules) {
    const s = spec(m.type);
    const r = rows.get(s.id) ?? { name: s.name, qty: 0, unit: s.price, size: s.displaySize ?? `${num(s.L)} × ${num(s.W)} m` };
    r.qty++;
    rows.set(s.id, r);
  }
  return [...rows.values()].sort((a, b) => b.qty * b.unit - a.qty * a.unit);
}

export function accessoryRows(stats: Stats) {
  return [
    { name: ACCESSORIES.anchor.name, qty: stats.anchors, unit: ACCESSORIES.anchor.price },
    { name: ACCESSORIES.buoy.name, qty: stats.buoys, unit: ACCESSORIES.buoy.price },
    { name: ACCESSORIES.lifejacket.name, qty: stats.lifejackets, unit: ACCESSORIES.lifejacket.price },
    { name: ACCESSORIES.boat.name, qty: stats.modules ? 1 : 0, unit: ACCESSORIES.boat.price },
  ].filter((r) => r.qty > 0);
}

/** Export tableur (CSV « ; » compatible Excel FR). */
export function downloadCSV(p: Project, stats: Stats) {
  const lines = [['Désignation', 'Dimensions', 'Quantité', 'Prix unitaire HT (€)', 'Total HT (€)']];
  for (const r of billOfMaterials(p)) lines.push([r.name, r.size, String(r.qty), String(r.unit), String(r.unit * r.qty)]);
  lines.push([]);
  lines.push(['Produits à prévoir']);
  for (const r of accessoryRows(stats)) lines.push([r.name, '', String(r.qty), String(r.unit), String(r.unit * r.qty)]);
  lines.push([]);
  lines.push(['TOTAL HT (estimation)', '', '', '', String(stats.total)]);
  lines.push(['Capacité estimée', '', String(stats.capacity)]);
  const csv = '﻿' + lines.map((l) => l.map((c) => `"${(c ?? '').replace(/"/g, '""')}"`).join(';')).join('\r\n');
  download(`${slug(p.name)}-devis.csv`, csv, 'text/csv;charset=utf-8');
}

// ------------------------------------------------ lien de partage (projet encodé dans l'URL)

export function shareLink(p: Project): string {
  const compact = {
    n: p.name,
    s: [p.site.length, p.site.width, p.site.depth],
    a: p.audience,
    m: p.modules.map((m) => [m.type, +m.x.toFixed(3), +m.z.toFixed(3), +m.rot.toFixed(4)]),
  };
  const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(compact))))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `${location.origin}${location.pathname}#p=${b64}`;
}

export function projectFromHash(hash: string): Project | null {
  const m = hash.match(/#p=([A-Za-z0-9_-]+)/);
  if (!m) return null;
  try {
    const json = decodeURIComponent(escape(atob(m[1].replace(/-/g, '+').replace(/_/g, '/'))));
    const c = JSON.parse(json);
    return {
      version: 1,
      name: c.n,
      site: { length: c.s[0], width: c.s[1], depth: c.s[2] },
      audience: c.a,
      modules: c.m.map((r: [string, number, number, number], i: number) => ({ uid: `m${i + 1}`, type: r[0], x: r[1], z: r[2], rot: r[3] })),
    };
  } catch {
    return null;
  }
}

// ------------------------------------------------ devis imprimable (PDF via le navigateur)

export function printReport(p: Project, stats: Stats, issues: Issue[], image: string) {
  const w = window.open('', '_blank');
  if (!w) return false;
  const bom = billOfMaterials(p);
  const acc = accessoryRows(stats);
  const err = issues.filter((i) => i.level === 'error').length;
  const warn = issues.filter((i) => i.level === 'warning').length;
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  w.document.write(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${esc(p.name)} — Devis</title>
<style>
body{font:12px/1.45 Inter,system-ui,sans-serif;color:#14202e;margin:28px}
h1{margin:0;font-size:22px} h2{font-size:14px;margin:22px 0 8px;text-transform:uppercase;letter-spacing:.05em;color:#0b5fae}
.head{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:3px solid #ffc20e;padding-bottom:10px}
.muted{color:#637184} img{width:100%;border-radius:8px;margin-top:14px}
table{width:100%;border-collapse:collapse} th,td{padding:6px 8px;border-bottom:1px solid #dde3ea;text-align:left}
td.n,th.n{text-align:right;font-variant-numeric:tabular-nums} tfoot td{font-weight:700;font-size:14px}
.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-top:14px}
.kpi{background:#f3f6fa;border-radius:8px;padding:10px} .kpi b{display:block;font-size:18px}
.note{font-size:10.5px;color:#637184;margin-top:18px}
@media print{body{margin:12mm}}
</style></head><body>
<div class="head"><div><h1>${esc(p.name)}</h1><div class="muted">${APP_NAME} · ${new Date().toLocaleDateString('fr-FR')} · Public : ${AUDIENCE_LIMITS[p.audience].label}</div></div>
<div class="muted">Plan d'eau ${num(p.site.length)} × ${num(p.site.width)} m · profondeur ${num(p.site.depth)} m</div></div>
<img src="${image}" alt="Vue 3D du parc">
<div class="kpis">
<div class="kpi"><span class="muted">Modules</span><b>${stats.modules}</b></div>
<div class="kpi"><span class="muted">Capacité estimée</span><b>${stats.capacity} pers.</b></div>
<div class="kpi"><span class="muted">Emprise</span><b>${num(stats.footprint.w, 0)} × ${num(stats.footprint.d, 0)} m</b></div>
<div class="kpi"><span class="muted">Contrôle des règles</span><b>${err} erreur(s) · ${warn} alerte(s)</b></div>
</div>
<h2>Modules</h2>
<table><thead><tr><th>Désignation</th><th>Dimensions</th><th class="n">Qté</th><th class="n">P.U. HT</th><th class="n">Total HT</th></tr></thead><tbody>
${bom.map((r) => `<tr><td>${esc(r.name)}</td><td>${r.size}</td><td class="n">${r.qty}</td><td class="n">${eur(r.unit)}</td><td class="n">${eur(r.unit * r.qty)}</td></tr>`).join('')}
</tbody><tfoot><tr><td colspan="4">Sous-total modules</td><td class="n">${eur(stats.price)}</td></tr></tfoot></table>
<h2>Produits à prévoir</h2>
<table><tbody>${acc.map((r) => `<tr><td>${esc(r.name)}</td><td class="n">${r.qty}</td><td class="n">${eur(r.unit)}</td><td class="n">${eur(r.unit * r.qty)}</td></tr>`).join('')}</tbody>
<tfoot><tr><td colspan="3">TOTAL HT (estimation)</td><td class="n">${eur(stats.total)}</td></tr></tfoot></table>
${issues.length ? `<h2>Points à vérifier</h2><ul>${issues.filter((i) => i.level !== 'info').map((i) => `<li><b>${i.rule}</b> ${esc(i.message)}</li>`).join('')}</ul>` : ''}
<p class="note">Document de simulation non contractuel. Prix, capacités et ancrages sont des estimations à confirmer par Wibit Sports après étude de site
(profondeur, nature du fond, réglementation locale, norme EN ISO 25649).</p>
<script>window.onload=()=>setTimeout(()=>window.print(),300)</script>
</body></html>`);
  w.document.close();
  return true;
}

// ------------------------------------------------ sauvegarde locale

const AUTOSAVE_KEY = 'parkcraft:autosave';

export function autosave(p: Project) {
  try {
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(p));
  } catch {
    /* stockage indisponible : on ignore */
  }
}

export function loadAutosave(): Project | null {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    return raw ? parseProject(raw) : null;
  } catch {
    return null;
  }
}
