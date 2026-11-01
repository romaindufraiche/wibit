import type { Project } from '../core/types';
import type { GenParams } from '../generator/generator';
import { randomSeed } from '../generator/rng';
import { icon } from '../ui/icons';
import { esc } from '../ui/panels';
import { HELP, parseRequest, type Action, type Brief } from './intent';
import { briefFrom, planPark, type PlanResult } from './planner';

/*
 * Assistant de conception : le client écrit sa demande (« budget 500 000 €, 200 personnes,
 * parcours chronométré »), l'assistant règle le générateur, crée le parc et le résume.
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

const EXAMPLES = [
  'Budget 500 000 €, 200 personnes, un parcours sportif pour des challenges chronométrés',
  'Un parc familial pour 80 personnes avec un grand toboggan',
  'Un petit parc pour enfants, budget 150 000 €',
];
const FOLLOW_UPS = ['Une autre version', 'Moins cher', 'Plus grand', 'Plus facile', 'Recevoir mon devis'];

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
    <form class="assistant-form"><textarea rows="2" placeholder="Ex. : budget 500 000 €, 200 personnes, parcours chronométré…" maxlength="600"></textarea><button class="btn primary" type="submit" title="Envoyer">${icon('chevron', 17)}</button></form>`;
  document.body.append(fab, panel);

  const log = panel.querySelector<HTMLElement>('.assistant-log')!;
  const chips = panel.querySelector<HTMLElement>('.assistant-chips')!;
  const form = panel.querySelector('form')!;
  const input = form.querySelector('textarea')!;
  const history: Msg[] = [];
  let brief: Brief | null = null;
  let busy = false;

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
      say('assistant', ['Bonjour ! Dites-moi ce que vous imaginez : budget, nombre de personnes, public, envies (toboggan, parcours chronométré…). Je conçois le parc en 3D.'], false);
      setChips(EXAMPLES);
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
  async function remote(message: string, current: Brief): Promise<{ brief: Brief; action: Action | 'answer'; reply: string } | null> {
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
      return { brief: b, action: res.action, reply: res.reply };
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  async function send(text: string) {
    text = text.trim();
    if (!text || busy) return;
    busy = true;
    input.value = '';
    setChips([]);
    say('user', text);
    const typing = say('assistant', '…', false);
    typing.classList.add('typing');
    const current = brief ?? { ...briefFrom(host.params()), audience: host.project().audience };
    let next: Brief;
    let action: Action | 'answer';
    let intro: string[];
    const ai = await remote(text, current);
    if (ai) {
      next = ai.brief;
      action = ai.action;
      intro = ai.reply ? [ai.reply] : [];
    } else {
      const it = parseRequest(text, current);
      next = it.brief;
      action = it.action;
      intro = it.understood.length ? [`Compris : ${it.understood.join(', ')}.`] : [];
    }
    typing.remove();
    host.track('assistant', { action, mode: ai ? 'claude' : 'local' });

    if (action === 'help') {
      say('assistant', HELP);
      setChips(EXAMPLES);
    } else if (action === 'real_site') {
      say('assistant', [...intro, 'Ouvrons la carte : cherchez votre lac et posez un point à l’endroit du parc. Je reprendrai ensuite vos réglages.']);
      host.openRealSite();
      setChips(['Génère le parc sur ce lac']);
    } else if (action === 'quote') {
      say('assistant', [...intro, 'Je vous ouvre la demande de devis : nos équipes reprennent ce parc et vous recontactent.']);
      host.requestQuote();
    } else if (action === 'generate' || action === 'variant') {
      const thinking = say('assistant', [...intro, 'Je conçois le parc…'], false);
      // laisser le navigateur afficher le message avant le calcul
      await new Promise((r) => setTimeout(r, 30));
      const plan = planPark(next, host.project(), randomSeed(), host.total());
      thinking.remove();
      if (plan.ok) {
        brief = { ...next, budget: plan.params.budget ?? 0, lake: undefined };
        host.apply(plan);
      }
      say('assistant', [...intro, ...plan.summary]);
      setChips(plan.ok ? FOLLOW_UPS : EXAMPLES);
    } else if (action === 'answer' && intro.length) {
      say('assistant', intro);
      setChips(FOLLOW_UPS);
    } else {
      say('assistant', ['Je n’ai pas bien saisi. Indiquez par exemple un budget, un nombre de personnes ou le public visé.', `Exemple : « ${EXAMPLES[0]} ».`]);
      setChips(EXAMPLES);
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
