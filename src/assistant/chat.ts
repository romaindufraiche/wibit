import type { Project } from '../core/types';
import type { GenParams } from '../generator/generator';
import { randomSeed } from '../generator/rng';
import { icon } from '../ui/icons';
import { esc } from '../ui/panels';
import { EXPLICIT, HELP, eurFmt, norm, parseRequest, type Action, type Brief } from './intent';
import { briefFrom, planPark, type PlanResult } from './planner';

/*
 * Assistant de conception : on discute du projet (budget, personnes, public, envies…), l'assistant
 * rassemble le cahier des charges au fil de l'échange, pose les questions qui manquent, puis
 * propose le parc (bouton « Proposer ce parc » ou demande explicite) et le résume.
 * Compréhension par Claude côté serveur quand il est configuré, sinon par l'analyseur local.
 */

export interface ChatHost {
  project: () => Project;
  params: () => GenParams;
  total: () => number;
  apply: (plan: PlanResult) => void;
  openRealSite: () => void;
  requestQuote: () => void;
  track: (type: string, data?: Record<string, unknown>) => void;
}

interface Msg {
  role: 'user' | 'assistant';
  text: string;
}

/** Exemples et réponses rapides propres au mode piscine (bassins de 25 ou 50 m, petits budgets). */
const POOL_EXAMPLES = [
  'Un parcours pour les enfants le mercredi après-midi',
  'Une animation chronométrée pour les ados, budget 60 000 €',
  'Un parc familial pour 30 personnes',
];
const EXAMPLES = [
  'Budget 500 000 €, 200 personnes, un parcours sportif pour des challenges chronométrés',
  'Un parc familial pour 80 personnes avec un grand toboggan',
  'Un petit parc pour enfants, budget 150 000 €',
];
const FOLLOW_UPS = ['Une autre version', 'Moins cher', 'Plus grand', 'Plus facile', 'Recevoir mon devis'];
const AUD: Record<Brief['audience'], string> = { kids: 'Enfants', family: 'Familles', sport: 'Sportif (ados / adultes)', mixed: 'Tout public' };

/** Question suivante quand une information clé manque. */
function nextQuestion(known: Set<string>, pool = false): { q: string; chips: string[] } | null {
  if (!known.has('capacity'))
    return { q: 'Combien de personnes voulez-vous accueillir en même temps ?', chips: pool ? ['15 personnes', '25 personnes', '40 personnes', '60 personnes'] : ['50 personnes', '100 personnes', '150 personnes', '200 personnes'] };
  if (!known.has('audience')) return { q: 'Pour quel public ?', chips: ['Enfants', 'Familles', 'Sportifs', 'Tout public'] };
  if (!known.has('budget'))
    return { q: 'Avez-vous un budget ?', chips: pool ? ['Budget 40 000 €', 'Budget 80 000 €', 'Budget 150 000 €', 'Sans limite de budget'] : ['Budget 150 000 €', 'Budget 300 000 €', 'Budget 500 000 €', 'Sans limite de budget'] };
  return null;
}

/** Cahier des charges en clair (fiche affichée dans la conversation). */
function briefLines(b: Brief, known: Set<string>): [string, string][] {
  const rows: [string, string][] = [];
  rows.push(['Public', known.has('audience') ? AUD[b.audience] : `${AUD[b.audience]} (par défaut)`]);
  rows.push(['Personnes', known.has('capacity') ? `${b.capacity} en même temps` : `${b.capacity} (par défaut)`]);
  rows.push(['Budget', b.budget > 0 ? `${eurFmt(b.budget)} HT max.` : b.budget === -1 ? '−20 % sur le parc actuel' : 'sans limite']);
  rows.push(['Intensité', `${b.intensity}/5`]);
  const opts = [b.course ? 'parcours chronométré' : '', b.loop && !b.course ? 'boucle InfinityLoop' : '', b.bigSlide ? 'grand toboggan' : '', b.standalones ? 'modules autonomes' : ''].filter(Boolean);
  rows.push(['Envies', opts.length ? opts.join(', ') : 'aucune en particulier']);
  if (b.lake) rows.push(["Plan d'eau", `${b.lake.length} × ${b.lake.width} m`]);
  if (b.depth) rows.push(['Profondeur', `${b.depth} m`]);
  return rows;
}

export function initAssistant(host: ChatHost) {
  const fab = document.createElement('button');
  fab.className = 'assistant-fab';
  fab.title = 'Assistant : décrivez votre projet';
  fab.innerHTML = `${icon('chat', 18)}<span>Assistant</span>`;
  const panel = document.createElement('section');
  panel.className = 'assistant-panel glass';
  panel.hidden = true;
  panel.innerHTML = `
    <header><div><b>Assistant</b><span>Décrivez votre projet, je conçois le parc.</span></div><button class="icon-btn" data-a="close" title="Fermer">${icon('x', 17)}</button></header>
    <div class="assistant-log" aria-live="polite"></div>
    <div class="assistant-chips"></div>
    <button type="button" class="btn primary assistant-propose" data-a="propose">${icon('shuffle', 16)}<span>Proposer un parc d’après notre échange</span></button>
    <form class="assistant-form"><textarea rows="2" placeholder="Ex. : budget 500 000 €, 200 personnes, parcours chronométré…" maxlength="600"></textarea><button class="btn primary" type="submit" title="Envoyer">${icon('chevron', 17)}</button></form>`;
  document.body.append(fab, panel);

  const log = panel.querySelector<HTMLElement>('.assistant-log')!;
  const chips = panel.querySelector<HTMLElement>('.assistant-chips')!;
  const form = panel.querySelector('form')!;
  const input = form.querySelector('textarea')!;
  const history: Msg[] = [];
  let convKind: 'pool' | 'lake' = host.project().site.kind === 'pool' ? 'pool' : 'lake';
  const examples = () => (host.project().site.kind === 'pool' ? POOL_EXAMPLES : EXAMPLES);
  let brief: Brief | null = null;
  /** Réglages donnés par le client pendant la conversation. */
  const known = new Set<string>();
  /** Un parc a déjà été proposé dans cette conversation : les retouches le régénèrent directement. */
  let proposed = false;
  let busy = false;
  const proposeBtn = panel.querySelector<HTMLButtonElement>('[data-a=propose]')!;
  const currentBrief = () => brief ?? { ...briefFrom(host.params()), audience: host.project().audience };

  const scroll = () => (log.scrollTop = log.scrollHeight);
  const say = (role: Msg['role'], lines: string[] | string, record = true) => {
    const list = Array.isArray(lines) ? lines : [lines];
    const el = document.createElement('div');
    el.className = `msg ${role === 'user' ? 'from-user' : 'from-bot'}`;
    el.innerHTML = list.map((l) => `<p>${esc(l)}</p>`).join('');
    log.appendChild(el);
    if (record) history.push({ role, text: list.join('\n') });
    scroll();
    return el;
  };
  const setChips = (items: string[]) => {
    chips.innerHTML = '';
    for (const c of items) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = c;
      b.onclick = () => void send(c);
      chips.appendChild(b);
    }
  };

  const open = () => {
    panel.hidden = false;
    fab.hidden = true;
    if (!log.childElementCount) {
      say('assistant', ['Bonjour ! Parlons de votre projet : budget, nombre de personnes, public, envies (toboggan, parcours chronométré…). Quand vous êtes prêt, je vous propose un parc en 3D.'], false);
      setChips(examples());
    }
    input.focus();
  };
  const close = () => {
    panel.hidden = true;
    fab.hidden = false;
  };
  fab.onclick = open;
  panel.querySelector<HTMLElement>('[data-a=close]')!.onclick = close;

  /** Compréhension par le serveur (Claude) ; null si indisponible. */
  async function remote(message: string, current: Brief): Promise<{ brief: Brief; action: Action | 'answer'; reply: string; keys: string[] } | null> {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 20000);
    try {
      const r = await fetch('/api/assistant', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message, brief: current, history: history.slice(-8).map((m) => ({ role: m.role, content: m.text })) }),
        signal: ctl.signal,
      });
      if (!r.ok) return null;
      const j = await r.json();
      const res = j.result as { reply: string; action: Action | 'answer'; changes: Record<string, unknown> } | null;
      if (!res) return null;
      const c = res.changes ?? {};
      const b: Brief = { ...current };
      const num = (v: unknown, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : null);
      if (typeof c.audience === 'string' && ['kids', 'family', 'sport', 'mixed'].includes(c.audience)) b.audience = c.audience as Brief['audience'];
      b.capacity = num(c.capacity, 15, 400) ?? b.capacity;
      b.intensity = num(c.intensity, 1, 5) ?? b.intensity;
      b.budget = num(c.budget, 0, 20_000_000) ?? b.budget;
      for (const k of ['loop', 'bigSlide', 'standalones', 'course'] as const) if (typeof c[k] === 'boolean') b[k] = c[k] as boolean;
      if (b.course) b.loop = false;
      const L = num(c.lakeLength, 30, 1500),
        W = num(c.lakeWidth, 30, 1500);
      if (L && W) b.lake = { length: L, width: W };
      const d = num(c.depth, 0.8, 15);
      if (d) b.depth = d;
      const keys = Object.entries(c)
        .filter(([, v]) => v !== null && v !== undefined)
        .map(([k]) => (k === 'lakeLength' || k === 'lakeWidth' ? 'lake' : k));
      return { brief: b, action: res.action, reply: res.reply, keys };
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Fiche récapitulative + bouton « Proposer ce parc ». */
  function showBrief(b: Brief, lines: string[]) {
    const el = say('assistant', lines);
    const card = document.createElement('div');
    card.className = 'brief-card';
    card.innerHTML = `<b>Votre cahier des charges</b><dl>${briefLines(b, known)
      .map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`)
      .join('')}</dl><button type="button" class="btn primary">${icon('shuffle', 15)} Proposer ce parc</button>`;
    card.querySelector('button')!.onclick = () => proposeBtn.click();
    el.appendChild(card);
    scroll();
  }

  /** Génère le parc d'après tout ce qui a été dit dans la conversation. */
  async function propose(intro: string[] = []) {
    const b = currentBrief();
    const thinking = say('assistant', [...intro, 'Je conçois le parc d’après notre échange…'], false);
    proposeBtn.disabled = true;
    await new Promise((r) => setTimeout(r, 30)); // laisser le message s'afficher avant le calcul
    const plan = planPark(b, host.project(), randomSeed(), host.total());
    thinking.remove();
    if (plan.ok) {
      brief = { ...b, budget: plan.params.budget ?? 0, lake: undefined };
      host.apply(plan);
      proposed = true;
      proposeBtn.querySelector('span')!.textContent = 'Proposer une autre version';
    }
    say('assistant', [...intro, ...plan.summary, ...(plan.ok ? ['Le parc est affiché en 3D. Dites-moi ce qu’il faut changer, ou demandez votre devis.'] : [])]);
    setChips(plan.ok ? FOLLOW_UPS : examples());
    host.track('assistant', { action: 'propose', capacity: b.capacity, budget: b.budget });
    proposeBtn.disabled = false;
  }
  proposeBtn.onclick = () => {
    if (busy) return;
    busy = true;
    void propose().finally(() => (busy = false));
  };

  async function send(text: string) {
    text = text.trim();
    if (!text || busy) return;
    busy = true;
    input.value = '';
    setChips([]);
    say('user', text);
    const typing = say('assistant', '…', false);
    typing.classList.add('typing');
    // modes séparés : changer de piscine à lac (ou l'inverse) repart d'un cahier des charges vierge
    const kind = host.project().site.kind === 'pool' ? 'pool' : 'lake';
    if (kind !== convKind) {
      convKind = kind;
      brief = null;
      known.clear();
      proposed = false;
    }
    const current = currentBrief();
    let next: Brief;
    let action: Action | 'answer';
    let intro: string[];
    let keys: string[];
    const ai = await remote(text, current);
    if (ai) {
      next = ai.brief;
      action = ai.action;
      intro = ai.reply ? [ai.reply] : [];
      keys = ai.keys;
    } else {
      const it = parseRequest(text, current);
      next = it.brief;
      action = it.action;
      intro = it.understood.length ? [`C’est noté : ${it.understood.join(', ')}.`] : [];
      keys = it.keys;
    }
    typing.remove();
    for (const k of keys) known.add(k);
    const explicit = EXPLICIT.test(norm(text));
    host.track('assistant', { action, mode: ai ? 'claude' : 'local' });

    if (action === 'help') {
      say('assistant', HELP);
      setChips(examples());
    } else if (action === 'real_site') {
      say('assistant', [...intro, 'Ouvrons la carte : cherchez votre lac et posez un point à l’endroit du parc. Ensuite, « Proposer un parc » le conçoit sur ce lac.']);
      host.openRealSite();
    } else if (action === 'quote') {
      say('assistant', [...intro, 'Je vous ouvre la demande de devis : nos équipes reprennent ce parc et vous recontactent.']);
      host.requestQuote();
    } else if (action === 'variant' || ((action === 'generate' || keys.length) && (explicit || proposed)) || (explicit && action !== 'answer')) {
      // demande explicite, autre version, ou retouche d'un parc déjà proposé : on (re)génère
      brief = next;
      await propose(intro);
    } else if (keys.length || action === 'generate') {
      // la conversation avance : récapitulatif, question suivante, bouton « Proposer ce parc »
      brief = next;
      const q = nextQuestion(known, host.project().site.kind === 'pool');
      showBrief(next, [...intro, q ? q.q : 'J’ai tout ce qu’il me faut. Je vous propose le parc ?']);
      setChips(q ? q.chips : ['Oui, propose-moi le parc']);
    } else if (action === 'answer' && intro.length) {
      say('assistant', intro);
      setChips(proposed ? FOLLOW_UPS : examples());
    } else {
      say('assistant', ['Je n’ai pas bien saisi. Indiquez par exemple un budget, un nombre de personnes ou le public visé — ou cliquez « Proposer un parc » pour partir de ce que nous avons déjà.', `Exemple : « ${examples()[0]} ».`]);
      setChips(examples());
    }
    busy = false;
    input.focus();
  }

  form.onsubmit = (e) => {
    e.preventDefault();
    void send(input.value);
  };
  input.onkeydown = (e) => {
    e.stopPropagation(); // pas de raccourcis clavier de l'éditeur pendant la saisie
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send(input.value);
    }
    if (e.key === 'Escape') close();
  };

  return { open, close, send: (t: string) => (open(), void send(t)) };
}
