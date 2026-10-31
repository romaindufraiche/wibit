import { APP_NAME } from '../brand';
import { CATEGORY_LABELS, DEFAULTS, MODULES, applyOverrides, spec, type CatalogOverride } from '../catalog/modules';
import type { Project } from '../core/types';
import { billOfMaterials, eur, num } from '../io/export';
import { account } from '../ui/account';
import { LOGO, icon } from '../ui/icons';

/*
 * Administration : tableau de bord d'activité, relances commerciales, comptes,
 * projets & devis, réglages du catalogue. Réservé aux comptes « admin ».
 */

// ------------------------------------------------------------ types API

type Stage = 'inscrit' | 'projet' | 'devis_demande' | 'devis_envoye' | 'gagne' | 'perdu';
type ParkStatus = 'draft' | 'quote_requested' | 'quote_sent' | 'won' | 'lost';
interface Stats {
  modules?: number;
  capacity?: number;
  total?: number;
  errors?: number;
  warnings?: number;
  types?: Record<string, number>;
}
interface UserRow {
  id: number;
  email: string;
  name: string;
  company: string;
  phone: string;
  role: 'user' | 'admin';
  notes: string;
  disabled: boolean;
  followup: { last_contact?: string; next_date?: string | null; count?: number; last_channel?: string };
  created_at: string;
  last_seen: string;
  parks: number;
  minutes: number;
  sessions: number;
  counts: Record<string, number>;
  lastActivity: string;
  inactiveDays: number | null;
  stage: Stage;
  latestPark: { id: number; name: string; status: ParkStatus; stats: Stats; updated_at: string } | null;
  value: number;
  blockers: string[];
  toFollowUp: boolean;
  score: number;
}
interface ParkRow {
  id: number;
  user_id: number;
  name: string;
  status: ParkStatus;
  stats: Stats;
  quote: Quote | null;
  modules: number;
  created_at: string;
  updated_at: string;
  owner: { id: number; email: string; name: string; company: string } | null;
}
interface QuoteLine {
  label: string;
  qty: number;
  unit: number;
}
interface Quote {
  lines?: QuoteLine[];
  discount?: number;
  notes?: string;
  validity?: number;
  total?: number;
  sent_at?: string;
  requested_at?: string;
  message?: string;
}
interface Overview {
  totals: Record<string, number>;
  series: { day: string; signups: number; parks: number; active: number; minutes: number }[];
  funnel: Record<Stage, number>;
  topModules: [string, number][];
}
interface EventRow {
  id: number;
  type: string;
  data: Record<string, unknown> | null;
  created_at: string;
  park_id: number | null;
}

const STAGE_LABELS: Record<Stage, string> = {
  inscrit: 'Inscrit',
  projet: 'Projet en cours',
  devis_demande: 'Devis demandé',
  devis_envoye: 'Devis envoyé',
  gagne: 'Gagné',
  perdu: 'Perdu',
};
const STATUS_LABELS: Record<ParkStatus, string> = {
  draft: 'Brouillon',
  quote_requested: 'Devis demandé',
  quote_sent: 'Devis envoyé',
  won: 'Gagné',
  lost: 'Perdu',
};
const EVENT_LABELS: Record<string, string> = {
  session: 'Connexion',
  generate: 'Parc généré',
  template: 'Modèle de parc chargé',
  pen: 'Parcours dessiné au stylo',
  module_add: 'Module ajouté',
  save: 'Projet enregistré',
  export_pdf: 'Devis PDF exporté',
  export_csv: 'Liste Excel exportée',
  export_anchors: "Plan d'ancrage exporté",
  play: 'Mode Play',
  season_extend: 'Agrandissement saison prochaine',
  season_recompose: 'Recomposition avec le stock',
  quote_request: 'Demande de devis',
  shore_edit: 'Rivage remodelé',
  followup: 'Relance',
};

// ------------------------------------------------------------ utilitaires

const app = document.getElementById('app')!;
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const h = (html: string) => {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild as HTMLElement;
};
const date = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const dateTime = (iso: string) => new Date(iso).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const ago = (days: number | null) => (days === null ? '—' : days === 0 ? "aujourd'hui" : days === 1 ? 'hier' : `il y a ${days} j`);
const duration = (min: number) => (min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`);
const api = <T>(method: string, path: string, body?: unknown) => account.call<T>(method, path, body);
let toastTimer = 0;
function toast(msg: string) {
  const t = document.getElementById('toast')!;
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (t.hidden = true), 3200);
}
const stagePill = (s: Stage) => `<span class="pill s-${s}"><i></i>${STAGE_LABELS[s]}</span>`;
const statusPill = (s: ParkStatus) => `<span class="pill s-${s}"><i></i>${STATUS_LABELS[s]}</span>`;
const editorLink = (id: number) => `/?park=${id}`;

// ------------------------------------------------------------ graphiques (une seule série, couleur marine)

function barChart(data: { label: string; value: number; tip: string }[], height = 160): HTMLElement {
  const wrap = h(`<div class="chart"><div class="tip" hidden></div></div>`);
  const W = 600,
    H = height,
    pad = { l: 28, r: 4, t: 8, b: 22 };
  const max = Math.max(1, ...data.map((d) => d.value));
  const nice = max <= 4 ? 4 : Math.ceil(max / 4) * 4;
  const bw = (W - pad.l - pad.r) / data.length;
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / nice);
  const grid = [0, nice / 2, nice]
    .map((v) => `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}" stroke="#e6ecf2"/><text x="${pad.l - 6}" y="${y(v) + 4}" font-size="10" text-anchor="end" fill="#64748b">${v}</text>`)
    .join('');
  const bars = data
    .map((d, i) => {
      const x = pad.l + i * bw + 1;
      const w = Math.max(1, bw - 2); // 2 px d'espace entre les barres
      const top = y(d.value);
      const hgt = H - pad.b - top;
      const r = Math.min(4, w / 2, hgt);
      const path = hgt > 0 ? `M${x},${H - pad.b} V${top + r} Q${x},${top} ${x + r},${top} H${x + w - r} Q${x + w},${top} ${x + w},${top + r} V${H - pad.b} Z` : '';
      return `<g data-i="${i}"><rect x="${pad.l + i * bw}" y="${pad.t}" width="${bw}" height="${H - pad.t - pad.b}" fill="transparent"/>${path ? `<path d="${path}" fill="#003865"/>` : ''}</g>`;
    })
    .join('');
  const ticks = data
    .map((d, i) => (i % 5 === 0 || i === data.length - 1 ? `<text x="${pad.l + i * bw + bw / 2}" y="${H - 6}" font-size="10" text-anchor="middle" fill="#64748b">${esc(d.label)}</text>` : ''))
    .join('');
  wrap.insertAdjacentHTML('beforeend', `<svg viewBox="0 0 ${W} ${H}" role="img">${grid}${bars}${ticks}<line x1="${pad.l}" x2="${W - pad.r}" y1="${H - pad.b}" y2="${H - pad.b}" stroke="#94a3b8"/></svg>`);
  const tip = wrap.querySelector<HTMLElement>('.tip')!;
  wrap.querySelectorAll<SVGGElement>('g[data-i]').forEach((g) => {
    g.addEventListener('mouseenter', () => {
      const d = data[Number(g.dataset.i)];
      const r = g.getBoundingClientRect(),
        wr = wrap.getBoundingClientRect();
      tip.textContent = d.tip;
      tip.style.left = `${r.left - wr.left + r.width / 2}px`;
      tip.style.top = `${r.top - wr.top + 10}px`;
      tip.hidden = false;
      g.querySelector('path')?.setAttribute('fill', '#0a4677');
    });
    g.addEventListener('mouseleave', () => {
      tip.hidden = true;
      g.querySelector('path')?.setAttribute('fill', '#003865');
    });
  });
  return wrap;
}

function hbars(rows: { label: string; value: number; text?: string }[]): string {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return rows
    .map(
      (r) =>
        `<div class="hbar" title="${esc(r.label)} : ${esc(r.text ?? r.value)}"><span class="lbl">${esc(r.label)}</span><span class="track"><span class="fill" style="display:block;width:${(r.value / max) * 100}%"></span></span><span class="val">${esc(r.text ?? r.value)}</span></div>`,
    )
    .join('');
}

// ------------------------------------------------------------ relance

function followupMessage(u: UserRow): { subject: string; body: string } {
  const park = u.latestPark;
  const first = (u.name || '').split(' ')[0] || 'Bonjour';
  let hook = 'Avez-vous pu avancer sur votre projet ?';
  if (park?.stats?.errors) hook = 'Je vois que quelques points de sécurité restaient à ajuster sur votre implantation : je peux vous aider à les résoudre en quelques minutes.';
  else if (park?.status === 'quote_requested') hook = 'Merci pour votre demande de devis : je reviens vers vous pour en valider les derniers détails (dates, accès au site, profondeur).';
  else if (park?.status === 'quote_sent') hook = 'Avez-vous pu consulter le devis que nous vous avons envoyé ? Je reste disponible pour l’ajuster à votre budget.';
  else if ((u.counts.generate ?? 0) >= 5 && !u.parks) hook = 'Vous avez exploré plusieurs variantes de parcs : je peux vous aider à choisir celle qui convient le mieux à votre site.';
  else if (u.minutes >= 20) hook = 'Vous avez passé un bon moment sur la conception : souhaitez-vous que nous transformions ce projet en devis détaillé ?';
  const desc = park ? `votre projet « ${park.name} »${park.stats?.modules ? ` (${park.stats.modules} modules, environ ${park.stats.capacity} personnes${park.stats.total ? `, ${eur(park.stats.total)} HT estimés` : ''})` : ''}` : 'votre projet de parc aquatique';
  return {
    subject: park ? `Votre projet « ${park.name} »` : 'Votre projet de parc aquatique',
    body: `${first === 'Bonjour' ? 'Bonjour' : `Bonjour ${first}`},\n\nJe reviens vers vous au sujet de ${desc}.\n${hook}\n\nJe vous propose un court échange téléphonique cette semaine : quel créneau vous conviendrait ?\n\nBien cordialement,\n${account.user?.name ?? ''}`,
  };
}

function openFollowup(u: UserRow, onDone: () => void) {
  const dlg = document.getElementById('dlg') as HTMLDialogElement;
  const msg = followupMessage(u);
  const next = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
  dlg.innerHTML = `
    <div class="dlg-head"><h2>Relancer ${esc(u.name)}</h2><p>${esc(u.company || u.email)} · ${stageText(u)}</p></div>
    <div class="dlg-body"><div class="fields">
      <label class="field">Canal<select data-k="channel"><option value="email">E-mail</option><option value="phone">Téléphone</option><option value="other">Autre</option></select></label>
      <label class="field">Prochaine relance<input type="date" data-k="next" value="${next}"></label>
      <label class="field full">Objet<input data-k="subject" value="${esc(msg.subject)}"></label>
      <label class="field full">Message<textarea rows="9" data-k="body">${esc(msg.body)}</textarea></label>
      ${u.blockers.length ? `<div class="full"><b class="muted">Points relevés</b><ul class="blockers" style="margin-top:6px">${u.blockers.map((b) => `<li>${esc(b)}</li>`).join('')}</ul></div>` : ''}
    </div></div>
    <div class="dlg-foot">
      <button class="btn" data-a="cancel">Annuler</button>
      ${u.phone ? `<a class="btn" href="tel:${esc(u.phone)}">${icon('phone', 16)} ${esc(u.phone)}</a>` : ''}
      <button class="btn" data-a="mail">${icon('mail', 16)} Ouvrir l'e-mail</button>
      <button class="btn primary" data-a="log">Enregistrer la relance</button>
    </div>`;
  const v = (k: string) => dlg.querySelector<HTMLInputElement>(`[data-k=${k}]`)!.value;
  dlg.querySelector<HTMLElement>('[data-a=cancel]')!.onclick = () => dlg.close();
  dlg.querySelector<HTMLElement>('[data-a=mail]')!.onclick = () => {
    location.href = `mailto:${encodeURIComponent(u.email)}?subject=${encodeURIComponent(v('subject'))}&body=${encodeURIComponent(v('body'))}`;
  };
  dlg.querySelector<HTMLElement>('[data-a=log]')!.onclick = async () => {
    try {
      await api('POST', `/admin/users/${u.id}/followup`, { channel: v('channel'), note: `${v('subject')}\n\n${v('body')}`, next_date: v('next') || null });
      dlg.close();
      toast(`Relance enregistrée pour ${u.name}`);
      onDone();
    } catch (e) {
      toast((e as Error).message);
    }
  };
  dlg.showModal();
}

const stageText = (u: UserRow) => STAGE_LABELS[u.stage];

// ------------------------------------------------------------ vues

type View = 'dashboard' | 'followup' | 'users' | 'parks' | 'catalog';
let view: View = 'dashboard';
let usersCache: UserRow[] = [];

async function loadUsers() {
  usersCache = (await api<{ users: UserRow[] }>('GET', '/admin/users')).users;
  return usersCache;
}

function shell() {
  app.innerHTML = `
    <header class="top">
      <div class="mark"><span class="logo">${LOGO}</span><div>${APP_NAME}<br><small>Administration</small></div></div>
      <div class="spacer"></div>
      <span class="who">${esc(account.user?.email)}</span>
      <a class="btn" href="/">${icon('external', 16)} Ouvrir l'outil</a>
      <button class="btn" data-a="logout">${icon('logout', 16)} Déconnexion</button>
    </header>
    <nav class="side"></nav>
    <main id="main"></main>`;
  app.querySelector<HTMLElement>('[data-a=logout]')!.onclick = () => {
    account.logout();
    location.reload();
  };
  renderNav();
}

function renderNav() {
  const nav = app.querySelector<HTMLElement>('.side')!;
  const due = usersCache.filter((u) => u.toFollowUp).length;
  const items: [View, string, string, number?][] = [
    ['dashboard', 'chart', 'Tableau de bord'],
    ['followup', 'bell', 'À relancer', due],
    ['users', 'users', 'Comptes'],
    ['parks', 'file', 'Projets & devis'],
    ['catalog', 'grid', 'Catalogue'],
  ];
  nav.innerHTML = '';
  for (const [id, ic, label, badge] of items) {
    const b = h(`<button class="${view === id ? 'on' : ''}">${icon(ic, 18)}<span>${label}</span>${badge ? `<span class="badge">${badge}</span>` : ''}</button>`);
    b.onclick = () => go(id);
    nav.appendChild(b);
  }
}

async function go(v: View) {
  view = v;
  renderNav();
  const main = document.getElementById('main')!;
  main.innerHTML = '<div class="muted">Chargement…</div>';
  try {
    if (v === 'dashboard') await renderDashboard(main);
    if (v === 'followup') await renderFollowup(main);
    if (v === 'users') await renderUsers(main);
    if (v === 'parks') await renderParks(main);
    if (v === 'catalog') await renderCatalog(main);
  } catch (e) {
    main.innerHTML = `<div class="empty">${esc((e as Error).message)}</div>`;
  }
  renderNav();
}

// ---------------------------------------------------------------- tableau de bord

async function renderDashboard(main: HTMLElement) {
  const [ov] = await Promise.all([api<Overview>('GET', '/admin/overview'), loadUsers()]);
  const t = ov.totals;
  main.innerHTML = `
    <h1>Tableau de bord</h1><p class="sub">Activité des 30 derniers jours et état du portefeuille de projets.</p>
    <div class="kpis">
      <div class="kpi"><span>Comptes clients</span><b class="num">${t.users}</b><small>${t.active7} actifs cette semaine</small></div>
      <div class="kpi"><span>Projets enregistrés</span><b class="num">${t.parks}</b><small>${duration(t.minutes)} de conception au total</small></div>
      <div class="kpi accent"><span>Devis en cours</span><b class="num">${eur(t.pipeline)}</b><small>${t.quotesRequested} demandé${t.quotesRequested > 1 ? 's' : ''} · ${t.quotesSent} envoyé${t.quotesSent > 1 ? 's' : ''}</small></div>
      <div class="kpi"><span>À relancer</span><b class="num">${t.toFollowUp}</b><small>${t.won} gagné${t.won > 1 ? 's' : ''} · ${eur(t.wonValue)}</small></div>
    </div>
    <div class="two">
      <div class="card"><h2>Clients actifs par jour</h2><div data-chart="active"></div></div>
      <div class="card"><h2>Projets créés par jour</h2><div data-chart="parks"></div></div>
      <div class="card"><h2>Parcours client</h2><div data-funnel></div></div>
      <div class="card"><h2>Modules les plus utilisés</h2><div data-top></div></div>
    </div>
    <div class="card" style="margin-top:16px"><h2>Priorités de relance</h2><div data-prio></div></div>`;
  const label = (d: string) => new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  main.querySelector('[data-chart=active]')!.appendChild(barChart(ov.series.map((s) => ({ label: label(s.day), value: s.active, tip: `${label(s.day)} : ${s.active} client${s.active > 1 ? 's' : ''} actif${s.active > 1 ? 's' : ''} · ${s.minutes} min` }))));
  main.querySelector('[data-chart=parks]')!.appendChild(barChart(ov.series.map((s) => ({ label: label(s.day), value: s.parks, tip: `${label(s.day)} : ${s.parks} projet${s.parks > 1 ? 's' : ''} · ${s.signups} inscription${s.signups > 1 ? 's' : ''}` }))));
  const stages: Stage[] = ['inscrit', 'projet', 'devis_demande', 'devis_envoye', 'gagne', 'perdu'];
  // entonnoir cumulé : chaque étape compte aussi ceux qui sont allés plus loin
  const reached = (i: number) => stages.slice(i, 5).reduce((a, s) => a + ov.funnel[s], 0);
  const base = Math.max(1, reached(0));
  main.querySelector('[data-funnel]')!.innerHTML =
    hbars(stages.slice(0, 5).map((s, i) => ({ label: STAGE_LABELS[s], value: reached(i), text: `${reached(i)} · ${Math.round((reached(i) / base) * 100)} %` }))) +
    `<p class="muted" style="margin:8px 0 0;font-size:12.5px">${ov.funnel.perdu} projet${ov.funnel.perdu > 1 ? 's' : ''} perdu${ov.funnel.perdu > 1 ? 's' : ''}. Chaque étape inclut les clients allés plus loin.</p>`;
  main.querySelector('[data-top]')!.innerHTML = ov.topModules.length ? hbars(ov.topModules.map(([id, n]) => ({ label: MODULES.find((m) => m.id === id)?.name ?? id, value: n }))) : '<p class="muted">Pas encore de projet enregistré.</p>';
  const prio = usersCache.filter((u) => u.toFollowUp).sort((a, b) => b.score - a.score).slice(0, 6);
  main.querySelector('[data-prio]')!.replaceWith(prio.length ? followupTable(prio, () => go('dashboard')) : h('<div class="empty">Personne à relancer pour le moment.</div>'));
}

// ---------------------------------------------------------------- relances

function followupTable(rows: UserRow[], refresh: () => void): HTMLElement {
  const table = h(`<table><thead><tr><th>Client</th><th>Étape</th><th class="r">Temps</th><th class="r">Valeur</th><th>Dernière activité</th><th>Pourquoi relancer</th><th></th></tr></thead><tbody></tbody></table>`);
  const tb = table.querySelector('tbody')!;
  for (const u of rows) {
    const tr = h(`<tr>
      <td class="who"><b>${esc(u.name)}</b><span>${esc(u.company || '—')}</span><br><span>${esc(u.email)}${u.phone ? ` · ${esc(u.phone)}` : ''}</span></td>
      <td>${stagePill(u.stage)}${u.followup?.last_contact ? `<br><span class="muted" style="font-size:12px">relancé ${date(u.followup.last_contact)}</span>` : ''}</td>
      <td class="r num">${duration(u.minutes)}</td>
      <td class="r num">${u.value ? eur(u.value) : '—'}</td>
      <td>${ago(u.inactiveDays)}</td>
      <td>${u.blockers.length ? `<ul class="blockers">${u.blockers.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>` : '<span class="muted">Inactif depuis quelques jours</span>'}</td>
      <td><div class="actions"><button class="btn sm primary" data-a="fu">${icon('bell', 14)} Relancer</button><button class="btn sm" data-a="see">Fiche</button></div></td>
    </tr>`);
    tr.querySelector<HTMLElement>('[data-a=fu]')!.onclick = () => openFollowup(u, refresh);
    tr.querySelector<HTMLElement>('[data-a=see]')!.onclick = () => openUser(u.id, refresh);
    tb.appendChild(tr);
  }
  return table;
}

let fuFilter: 'all' | 'quote' | 'errors' | 'cold' = 'all';
async function renderFollowup(main: HTMLElement) {
  await loadUsers();
  const draw = () => {
    let rows = usersCache.filter((u) => u.toFollowUp);
    if (fuFilter === 'quote') rows = rows.filter((u) => u.stage === 'devis_demande' || u.stage === 'devis_envoye');
    if (fuFilter === 'errors') rows = rows.filter((u) => (u.latestPark?.stats?.errors ?? 0) > 0);
    if (fuFilter === 'cold') rows = rows.filter((u) => (u.inactiveDays ?? 0) >= 14);
    rows.sort((a, b) => b.score - a.score);
    main.innerHTML = `<h1>À relancer</h1><p class="sub">Clients engagés (temps passé, projet enregistré, devis) dont le projet n'a pas abouti. Classés par priorité : temps passé, valeur du projet, avancement, ancienneté de la dernière visite.</p>`;
    const bar = h(`<div class="toolbar"></div>`);
    for (const [k, l] of [
      ['all', 'Tous'],
      ['quote', 'Devis en attente'],
      ['errors', 'Bloqués par les règles'],
      ['cold', 'Inactifs depuis 14 j et plus'],
    ] as const) {
      const c = h(`<button class="chip ${fuFilter === k ? 'on' : ''}">${l}</button>`);
      c.onclick = () => {
        fuFilter = k;
        draw();
      };
      bar.appendChild(c);
    }
    main.appendChild(bar);
    main.appendChild(rows.length ? followupTable(rows, () => go('followup')) : h('<div class="empty">Personne à relancer dans cette catégorie.</div>'));
  };
  draw();
}

// ---------------------------------------------------------------- comptes

async function renderUsers(main: HTMLElement) {
  await loadUsers();
  let q = '';
  const draw = () => {
    const rows = usersCache.filter((u) => !q || `${u.name} ${u.email} ${u.company}`.toLowerCase().includes(q));
    const tb = main.querySelector('tbody')!;
    tb.innerHTML = '';
    for (const u of rows) {
      const tr = h(`<tr style="cursor:pointer">
        <td class="who"><b>${esc(u.name)}${u.role === 'admin' ? ' <span class="pill">Admin</span>' : ''}${u.disabled ? ' <span class="pill s-perdu"><i></i>Désactivé</span>' : ''}</b><span>${esc(u.company || '—')}</span></td>
        <td>${esc(u.email)}<br><span class="muted">${esc(u.phone || '')}</span></td>
        <td>${stagePill(u.stage)}</td>
        <td class="r num">${u.parks}</td>
        <td class="r num">${duration(u.minutes)}</td>
        <td>${date(u.created_at)}</td>
        <td>${ago(u.inactiveDays)}</td>
      </tr>`);
      tr.onclick = () => openUser(u.id, () => go('users'));
      tb.appendChild(tr);
    }
  };
  main.innerHTML = `<h1>Comptes</h1><p class="sub">${usersCache.length} compte${usersCache.length > 1 ? 's' : ''}. Cliquez sur un compte pour voir son activité, ses projets et le modifier.</p>
    <div class="toolbar"><input type="search" placeholder="Nom, e-mail, société…"></div>
    <table><thead><tr><th>Client</th><th>Contact</th><th>Étape</th><th class="r">Projets</th><th class="r">Temps passé</th><th>Inscrit le</th><th>Dernière activité</th></tr></thead><tbody></tbody></table>`;
  const search = main.querySelector<HTMLInputElement>('input[type=search]')!;
  search.oninput = () => {
    q = search.value.trim().toLowerCase();
    draw();
  };
  draw();
}

function drawer(): { el: HTMLElement; close: () => void } {
  const back = h(`<div class="drawer-back"></div>`);
  const el = h(`<aside class="drawer"></aside>`);
  const close = () => {
    back.remove();
    el.remove();
  };
  back.onclick = close;
  document.body.append(back, el);
  return { el, close };
}

async function openUser(id: number, refresh: () => void) {
  const { el, close } = drawer();
  el.innerHTML = '<div class="muted">Chargement…</div>';
  const r = await api<{ user: UserRow; parks: ParkRow[]; events: EventRow[] }>('GET', `/admin/users/${id}`);
  const u = r.user;
  el.innerHTML = `
    <div class="actions" style="justify-content:space-between;align-items:flex-start">
      <div><h1>${esc(u.name)}</h1><p class="sub">${esc(u.company || 'Société non renseignée')} · inscrit le ${date(u.created_at)}</p></div>
      <button class="btn" data-a="close">Fermer</button>
    </div>
    <div class="kpis" style="grid-template-columns:repeat(4,1fr)">
      <div class="kpi"><span>Étape</span><div style="margin-top:8px">${stagePill(u.stage)}</div></div>
      <div class="kpi"><span>Temps passé</span><b class="num">${duration(u.minutes)}</b><small>${u.sessions} connexion${u.sessions > 1 ? 's' : ''}</small></div>
      <div class="kpi"><span>Projets</span><b class="num">${r.parks.length}</b><small>${u.value ? eur(u.value) : ''}</small></div>
      <div class="kpi"><span>Dernière activité</span><b class="num" style="font-size:18px">${ago(u.inactiveDays)}</b><small>${u.followup?.count ? `${u.followup.count} relance${u.followup.count > 1 ? 's' : ''}` : 'jamais relancé'}</small></div>
    </div>
    ${u.blockers.length ? `<section><h2>Points d'attention</h2><ul class="blockers">${u.blockers.map((b) => `<li>${esc(b)}</li>`).join('')}</ul></section>` : ''}
    <div class="actions" style="margin-top:16px"><button class="btn primary" data-a="fu">${icon('bell', 16)} Relancer</button><a class="btn" href="mailto:${esc(u.email)}">${icon('mail', 16)} ${esc(u.email)}</a>${u.phone ? `<a class="btn" href="tel:${esc(u.phone)}">${icon('phone', 16)} ${esc(u.phone)}</a>` : ''}</div>
    <section><h2>Projets</h2><div data-parks></div></section>
    <section><h2>Fiche</h2>
      <div class="fields">
        <label class="field">Nom<input data-k="name" value="${esc(u.name)}"></label>
        <label class="field">Société<input data-k="company" value="${esc(u.company)}"></label>
        <label class="field">Téléphone<input data-k="phone" value="${esc(u.phone)}"></label>
        <label class="field">Rôle<select data-k="role"><option value="user" ${u.role === 'user' ? 'selected' : ''}>Client</option><option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Administrateur</option></select></label>
        <label class="field full">Notes internes<textarea rows="3" data-k="notes">${esc(u.notes)}</textarea></label>
      </div>
      <div class="actions" style="margin-top:10px"><button class="btn primary" data-a="save">Enregistrer la fiche</button><button class="btn" data-a="disable">${u.disabled ? 'Réactiver le compte' : 'Désactiver le compte'}</button><button class="btn danger" data-a="delete">Supprimer le compte</button></div>
    </section>
    <section><h2>Activité</h2><ul class="timeline">${
      r.events
        .filter((e) => e.type !== 'heartbeat')
        .slice(0, 80)
        .map((e) => `<li class="${e.type === 'followup' ? 'fu' : ''}"><time>${dateTime(e.created_at)}</time><b>${esc(EVENT_LABELS[e.type] ?? e.type)}</b>${eventDetail(e)}</li>`)
        .join('') || '<li class="muted">Aucune activité enregistrée.</li>'
    }</ul></section>`;
  el.querySelector('[data-parks]')!.replaceWith(parksTable(r.parks.map((p) => ({ ...p, owner: { id: u.id, email: u.email, name: u.name, company: u.company } })), () => openUser(id, refresh), true));
  el.querySelector<HTMLElement>('[data-a=close]')!.onclick = close;
  el.querySelector<HTMLElement>('[data-a=fu]')!.onclick = () =>
    openFollowup(u, () => {
      close();
      refresh();
    });
  const val = (k: string) => el.querySelector<HTMLInputElement>(`[data-k=${k}]`)!.value;
  el.querySelector<HTMLElement>('[data-a=save]')!.onclick = async () => {
    try {
      await api('PATCH', `/admin/users/${id}`, { name: val('name'), company: val('company'), phone: val('phone'), role: val('role'), notes: val('notes') });
      toast('Fiche enregistrée');
      refresh();
    } catch (e) {
      toast((e as Error).message);
    }
  };
  el.querySelector<HTMLElement>('[data-a=disable]')!.onclick = async () => {
    try {
      await api('PATCH', `/admin/users/${id}`, { disabled: !u.disabled });
      close();
      refresh();
    } catch (e) {
      toast((e as Error).message);
    }
  };
  el.querySelector<HTMLElement>('[data-a=delete]')!.onclick = async () => {
    if (!confirm(`Supprimer définitivement le compte ${u.email} et tous ses projets ?`)) return;
    try {
      await api('DELETE', `/admin/users/${id}`);
      close();
      refresh();
    } catch (e) {
      toast((e as Error).message);
    }
  };
}

function eventDetail(e: EventRow): string {
  const d = e.data ?? {};
  if (e.type === 'followup') return ` <span class="muted">· ${esc(d.channel)} par ${esc(d.by)}</span>${d.note ? `<br><span class="muted" style="white-space:pre-line">${esc(String(d.note).slice(0, 220))}</span>` : ''}`;
  if (e.type === 'quote_request' && d.message) return `<br><span class="muted">« ${esc(d.message)} »</span>`;
  if (e.type === 'generate') return ` <span class="muted">· ${esc(d.modules)} modules${d.budget ? `, budget ${eur(Number(d.budget))}` : ''}</span>`;
  if (e.type === 'export_pdf' && d.total) return ` <span class="muted">· ${eur(Number(d.total))}</span>`;
  return '';
}

// ---------------------------------------------------------------- projets & devis

function parksTable(rows: ParkRow[], refresh: () => void, compact = false): HTMLElement {
  if (!rows.length) return h('<div class="empty">Aucun projet.</div>');
  const table = h(`<table class="${compact ? 'compact' : ''}"><thead><tr><th>Projet</th><th class="c-owner">Client</th><th class="r">Modules</th><th class="r c-cap">Capacité</th><th class="r">Estimation</th><th class="r">Devis</th><th>Statut</th><th>Modifié</th><th></th></tr></thead><tbody></tbody></table>`);
  const tb = table.querySelector('tbody')!;
  for (const p of rows.sort((a, b) => (b.updated_at ?? '').localeCompare(a.updated_at ?? ''))) {
    const tr = h(`<tr>
      <td class="who"><b>${esc(p.name)}</b>${p.stats?.errors ? `<span style="color:var(--red)">${p.stats.errors} erreur${p.stats.errors > 1 ? 's' : ''} de règles</span>` : ''}</td>
      <td class="who c-owner"><b>${esc(p.owner?.name ?? '—')}</b><span>${esc(p.owner?.company || p.owner?.email || '')}</span></td>
      <td class="r num">${p.stats?.modules ?? p.modules}</td>
      <td class="r num c-cap">${p.stats?.capacity ?? '—'}</td>
      <td class="r num">${p.stats?.total ? eur(p.stats.total) : '—'}</td>
      <td class="r num">${p.quote?.total ? eur(p.quote.total) : '—'}</td>
      <td><select data-a="status">${(Object.keys(STATUS_LABELS) as ParkStatus[]).map((s) => `<option value="${s}" ${s === p.status ? 'selected' : ''}>${STATUS_LABELS[s]}</option>`).join('')}</select></td>
      <td>${date(p.updated_at)}</td>
      <td><div class="actions"><a class="btn sm" href="${editorLink(p.id)}" target="_blank" rel="noopener">${icon('external', 14)} Éditer</a><button class="btn sm primary" data-a="quote">${icon('euro', 14)} Devis</button></div></td>
    </tr>`);
    tr.querySelector<HTMLSelectElement>('[data-a=status]')!.onchange = async (e) => {
      try {
        await api('PUT', `/admin/parks/${p.id}`, { status: (e.target as HTMLSelectElement).value });
        toast(`Statut de « ${p.name} » : ${STATUS_LABELS[(e.target as HTMLSelectElement).value as ParkStatus]}`);
      } catch (er) {
        toast((er as Error).message);
      }
    };
    tr.querySelector<HTMLElement>('[data-a=quote]')!.onclick = () => openQuote(p.id, refresh);
    tb.appendChild(tr);
  }
  return table;
}

let parkFilter: ParkStatus | 'all' = 'all';
async function renderParks(main: HTMLElement) {
  const { parks } = await api<{ parks: ParkRow[] }>('GET', '/admin/parks');
  const draw = () => {
    const rows = parks.filter((p) => parkFilter === 'all' || p.status === parkFilter);
    const value = rows.reduce((a, p) => a + (p.quote?.total ?? p.stats?.total ?? 0), 0);
    main.innerHTML = `<h1>Projets & devis</h1><p class="sub">${rows.length} projet${rows.length > 1 ? 's' : ''} · ${eur(value)} HT. « Éditer » ouvre le projet dans l'outil (génération, modifications, enregistrement) ; « Devis » prépare le devis client.</p>`;
    const bar = h(`<div class="toolbar"></div>`);
    for (const [k, l] of [['all', 'Tous'], ...Object.entries(STATUS_LABELS)] as [ParkStatus | 'all', string][]) {
      const n = k === 'all' ? parks.length : parks.filter((p) => p.status === k).length;
      const c = h(`<button class="chip ${parkFilter === k ? 'on' : ''}">${l} · ${n}</button>`);
      c.onclick = () => {
        parkFilter = k;
        draw();
      };
      bar.appendChild(c);
    }
    main.appendChild(bar);
    main.appendChild(parksTable(rows, () => go('parks')));
  };
  draw();
}

async function openQuote(id: number, refresh: () => void) {
  const { el, close } = drawer();
  el.innerHTML = '<div class="muted">Chargement…</div>';
  const { park } = await api<{ park: ParkRow & { data: Project; owner: UserRow | null } }>('GET', `/admin/parks/${id}`);
  const project = park.data;
  const q: Quote = park.quote ?? {};
  let lines: QuoteLine[] =
    q.lines && q.lines.length
      ? q.lines
      : [
          ...billOfMaterials(project).map((r) => ({ label: `${r.name} (${r.size})`, qty: r.qty, unit: r.unit })),
          { label: 'Ancrages (lest + chaîne)', qty: (project.modules ?? []).reduce((a, m) => a + spec(m.type).anchors, 0), unit: 190 },
          { label: 'Transport et installation', qty: 1, unit: 0 },
        ];
  let discount = q.discount ?? 0;
  const totalOf = () => {
    const sub = lines.reduce((a, l) => a + l.qty * l.unit, 0);
    return { sub, disc: Math.round((sub * discount) / 100), total: Math.round(sub * (1 - discount / 100)) };
  };
  const draw = () => {
    const t = totalOf();
    el.innerHTML = `
      <div class="actions" style="justify-content:space-between;align-items:flex-start">
        <div><h1>Devis — ${esc(project.name)}</h1><p class="sub">${esc(park.owner?.name ?? '')} · ${esc(park.owner?.company || park.owner?.email || '')} · ${statusPill(park.status)}</p></div>
        <button class="btn" data-a="close">Fermer</button>
      </div>
      ${q.message ? `<div class="card" style="margin-bottom:14px"><b>Message du client</b><p style="margin:6px 0 0;white-space:pre-line">${esc(q.message)}</p></div>` : ''}
      <table class="quote-lines"><thead><tr><th>Désignation</th><th class="r" style="width:80px">Qté</th><th class="r" style="width:130px">P.U. HT</th><th class="r" style="width:120px">Total</th><th style="width:40px"></th></tr></thead><tbody>${lines
        .map(
          (l, i) => `<tr data-i="${i}"><td><input data-f="label" value="${esc(l.label)}"></td><td><input data-f="qty" type="number" min="0" value="${l.qty}" style="text-align:right"></td><td><input data-f="unit" type="number" min="0" step="50" value="${l.unit}" style="text-align:right"></td><td class="r num">${eur(l.qty * l.unit)}</td><td><button class="btn sm danger" data-del="${i}" title="Retirer">×</button></td></tr>`,
        )
        .join('')}</tbody></table>
      <div class="actions" style="margin-top:8px"><button class="btn sm" data-a="add">+ Ajouter une ligne</button></div>
      <div class="fields" style="margin-top:14px">
        <label class="field">Remise (%)<input type="number" min="0" max="50" step="0.5" data-k="discount" value="${discount}"></label>
        <label class="field">Validité (jours)<input type="number" min="7" max="180" data-k="validity" value="${q.validity ?? 30}"></label>
        <label class="field full">Conditions / notes<textarea rows="3" data-k="notes">${esc(q.notes ?? 'Acompte de 30 % à la commande. Livraison et installation selon planning convenu.')}</textarea></label>
      </div>
      <div class="quote-total"><span>Sous-total <b class="num" style="font-size:15px">${eur(t.sub)}</b></span>${discount ? `<span>Remise <b class="num" style="font-size:15px">−${eur(t.disc)}</b></span>` : ''}<span>Total HT <b class="num">${eur(t.total)}</b></span></div>
      <div class="actions" style="margin-top:16px;justify-content:flex-end">
        <a class="btn" href="${editorLink(id)}" target="_blank" rel="noopener">${icon('external', 16)} Ouvrir le projet</a>
        <button class="btn" data-a="print">${icon('file', 16)} Imprimer / PDF</button>
        <button class="btn" data-a="save">Enregistrer</button>
        <button class="btn primary" data-a="send">Marquer comme envoyé</button>
      </div>`;
    el.querySelector<HTMLElement>('[data-a=close]')!.onclick = close;
    el.querySelectorAll<HTMLInputElement>('tr[data-i] input').forEach((inp) => {
      inp.onchange = () => {
        const i = Number(inp.closest<HTMLElement>('tr')!.dataset.i);
        const f = inp.dataset.f as keyof QuoteLine;
        (lines[i] as any)[f] = f === 'label' ? inp.value : Math.max(0, Number(inp.value) || 0);
        draw();
      };
    });
    el.querySelectorAll<HTMLElement>('[data-del]').forEach((b) => {
      b.onclick = () => {
        lines = lines.filter((_, i) => i !== Number(b.dataset.del));
        draw();
      };
    });
    el.querySelector<HTMLElement>('[data-a=add]')!.onclick = () => {
      lines.push({ label: 'Nouvelle ligne', qty: 1, unit: 0 });
      draw();
    };
    const dIn = el.querySelector<HTMLInputElement>('[data-k=discount]')!;
    dIn.onchange = () => {
      discount = Math.max(0, Math.min(50, Number(dIn.value) || 0));
      draw();
    };
    const collect = (): Quote => ({
      ...q,
      lines,
      discount,
      validity: Number(el.querySelector<HTMLInputElement>('[data-k=validity]')!.value) || 30,
      notes: el.querySelector<HTMLTextAreaElement>('[data-k=notes]')!.value,
      total: totalOf().total,
    });
    el.querySelector<HTMLElement>('[data-a=save]')!.onclick = async () => {
      await api('PUT', `/admin/parks/${id}`, { quote: collect() });
      toast('Devis enregistré');
      refresh();
    };
    el.querySelector<HTMLElement>('[data-a=send]')!.onclick = async () => {
      await api('PUT', `/admin/parks/${id}`, { quote: { ...collect(), sent_at: new Date().toISOString() }, status: 'quote_sent' });
      toast('Devis marqué comme envoyé');
      close();
      refresh();
    };
    el.querySelector<HTMLElement>('[data-a=print]')!.onclick = () => printQuote(project, park.owner, collect());
  };
  draw();
}

function printQuote(project: Project, owner: { name?: string; company?: string; email?: string; phone?: string } | null, q: Quote) {
  const w = window.open('', '_blank');
  if (!w) return toast('Autorisez les fenêtres pop-up pour imprimer le devis');
  const sub = (q.lines ?? []).reduce((a, l) => a + l.qty * l.unit, 0);
  const total = q.total ?? sub;
  const ref = `D-${new Date().getFullYear()}-${String(Math.floor(Math.random() * 9000) + 1000)}`;
  w.document.write(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Devis ${esc(project.name)}</title>
  <style>body{font:12.5px/1.5 Karla,Inter,system-ui,sans-serif;color:#0f172a;margin:32px}h1{margin:0;color:#003865;font-size:24px}
  .head{display:flex;justify-content:space-between;border-bottom:4px solid #c8d400;padding-bottom:12px;margin-bottom:18px}
  table{width:100%;border-collapse:collapse;margin-top:14px}th,td{padding:7px 8px;border-bottom:1px solid #e6ecf2;text-align:left}th{background:#f4f7fa;font-size:11px;text-transform:uppercase;color:#64748b}
  .r{text-align:right}.tot td{font-weight:700}.big td{font-size:16px;color:#003865;border-top:2px solid #003865}.muted{color:#64748b}@media print{body{margin:12mm}}</style></head><body>
  <div class="head"><div><h1>Devis</h1><div class="muted">${ref} · ${new Date().toLocaleDateString('fr-FR')} · valable ${q.validity ?? 30} jours</div></div>
  <div style="text-align:right"><b>${esc(owner?.company || owner?.name || '')}</b><br>${esc(owner?.name ?? '')}<br>${esc(owner?.email ?? '')}<br>${esc(owner?.phone ?? '')}</div></div>
  <b>Projet : ${esc(project.name)}</b> <span class="muted">· plan d'eau ${project.site.length} × ${project.site.width} m, profondeur ${project.site.depth} m · ${project.modules.length} modules</span>
  <table><thead><tr><th>Désignation</th><th class="r">Qté</th><th class="r">P.U. HT</th><th class="r">Total HT</th></tr></thead><tbody>
  ${(q.lines ?? []).map((l) => `<tr><td>${esc(l.label)}</td><td class="r">${l.qty}</td><td class="r">${eur(l.unit)}</td><td class="r">${eur(l.qty * l.unit)}</td></tr>`).join('')}
  <tr class="tot"><td colspan="3" class="r">Sous-total HT</td><td class="r">${eur(sub)}</td></tr>
  ${q.discount ? `<tr class="tot"><td colspan="3" class="r">Remise ${num(q.discount)} %</td><td class="r">−${eur(sub - total)}</td></tr>` : ''}
  <tr class="tot big"><td colspan="3" class="r">Total HT</td><td class="r">${eur(total)}</td></tr>
  <tr><td colspan="3" class="r muted">TVA 20 %</td><td class="r muted">${eur(total * 0.2)}</td></tr>
  <tr class="tot"><td colspan="3" class="r">Total TTC</td><td class="r">${eur(total * 1.2)}</td></tr></tbody></table>
  ${q.notes ? `<p style="margin-top:18px;white-space:pre-line">${esc(q.notes)}</p>` : ''}
  <script>window.onload=()=>setTimeout(()=>window.print(),300)</script></body></html>`);
  w.document.close();
}

// ---------------------------------------------------------------- catalogue

async function renderCatalog(main: HTMLElement) {
  const { overrides } = await api<{ overrides: Record<string, CatalogOverride> }>('GET', '/admin/catalog');
  const draft: Record<string, CatalogOverride> = JSON.parse(JSON.stringify(overrides));
  let q = '';
  const draw = () => {
    const tb = main.querySelector('tbody')!;
    tb.innerHTML = '';
    for (const s of MODULES.filter((m) => !q || m.name.toLowerCase().includes(q))) {
      const o = draft[s.id] ?? {};
      const d = DEFAULTS[s.id];
      const tr = h(`<tr>
        <td class="who"><b>${esc(s.name)}</b><span>${esc(CATEGORY_LABELS[s.category])}</span></td>
        <td class="num">${s.displaySize ?? `${num(s.L)} × ${num(s.W)} m`} · H ${num(s.H)} m<br><span class="muted">prof. ${num(s.depth, 2)} m</span></td>
        <td class="r"><input data-f="price" type="number" min="0" step="50" placeholder="${d.price}" value="${o.price ?? ''}" style="width:110px;text-align:right"></td>
        <td class="r"><input data-f="cap" type="number" min="0" placeholder="${d.cap}" value="${o.cap ?? ''}" style="width:70px;text-align:right"></td>
        <td class="r"><input data-f="anchors" type="number" min="0" placeholder="${d.anchors}" value="${o.anchors ?? ''}" style="width:70px;text-align:right"></td>
        <td><label class="field" style="flex-direction:row;align-items:center;gap:6px"><input type="checkbox" data-f="visible" ${o.disabled ? '' : 'checked'}> Visible</label></td>
      </tr>`);
      tr.querySelectorAll<HTMLInputElement>('input').forEach((inp) => {
        inp.onchange = () => {
          const f = inp.dataset.f!;
          const cur = { ...(draft[s.id] ?? {}) };
          if (f === 'visible') {
            if (inp.checked) delete cur.disabled;
            else cur.disabled = true;
          } else if (inp.value === '') delete (cur as any)[f];
          else (cur as any)[f] = Number(inp.value);
          if (Object.keys(cur).length) draft[s.id] = cur;
          else delete draft[s.id];
        };
      });
      tb.appendChild(tr);
    }
  };
  main.innerHTML = `<h1>Catalogue</h1><p class="sub">Prix, capacités et ancrages utilisés par l'outil (devis, générateur, plan d'ancrage). Laissez vide pour garder la valeur par défaut affichée en gris. Décochez « Visible » pour retirer un module du catalogue et du générateur.</p>
    <div class="toolbar"><input type="search" placeholder="Rechercher un module"><span style="flex:1"></span><button class="btn primary" data-a="save">Enregistrer le catalogue</button></div>
    <table><thead><tr><th>Module</th><th>Dimensions</th><th class="r">Prix HT (€)</th><th class="r">Capacité</th><th class="r">Ancrages</th><th>Affichage</th></tr></thead><tbody></tbody></table>`;
  const search = main.querySelector<HTMLInputElement>('input[type=search]')!;
  search.oninput = () => {
    q = search.value.trim().toLowerCase();
    draw();
  };
  main.querySelector<HTMLElement>('[data-a=save]')!.onclick = async () => {
    try {
      const r = await api<{ overrides: Record<string, CatalogOverride> }>('PUT', '/admin/catalog', { overrides: draft });
      applyOverrides(r.overrides);
      toast(`Catalogue enregistré (${Object.keys(r.overrides).length} module${Object.keys(r.overrides).length > 1 ? 's' : ''} personnalisé${Object.keys(r.overrides).length > 1 ? 's' : ''})`);
    } catch (e) {
      toast((e as Error).message);
    }
  };
  draw();
}

// ------------------------------------------------------------ connexion

function loginScreen(err = '') {
  app.innerHTML = `<div class="login"><form>
    <div style="display:flex;align-items:center;gap:10px"><span style="width:40px;height:40px;display:grid;place-items:center;background:#c8d400;color:#003865;border-radius:4px">${LOGO.replace('<svg', '<svg width="28" height="28"')}</span><div><b>${APP_NAME}</b><br><span class="muted">Administration</span></div></div>
    <h1>Connexion</h1>
    <label class="field">E-mail<input name="email" type="email" required autocomplete="email"></label>
    <label class="field">Mot de passe<input name="password" type="password" required autocomplete="current-password"></label>
    ${err ? `<div class="err">${esc(err)}</div>` : ''}
    <button class="btn primary" type="submit" style="height:40px;justify-content:center">Se connecter</button>
    <a href="/" style="text-align:center;font-weight:700">Retour à l'outil</a>
  </form></div>`;
  const form = app.querySelector('form')!;
  form.onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    try {
      await account.auth('login', String(fd.get('email')), String(fd.get('password')));
      start();
    } catch (er) {
      loginScreen((er as Error).message);
    }
  };
}

async function start() {
  await account.refresh();
  if (!account.loggedIn) return loginScreen();
  if (!account.isAdmin) {
    account.logout();
    return loginScreen('Ce compte n’a pas les droits d’administration.');
  }
  try {
    const r = await fetch('/api/catalog').then((x) => x.json());
    if (r?.overrides) applyOverrides(r.overrides);
  } catch {
    /* catalogue par défaut */
  }
  shell();
  await loadUsers().catch(() => []);
  go('dashboard');
}

document.title = `${APP_NAME} — Administration`;
start();
