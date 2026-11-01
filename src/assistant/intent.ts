import type { Audience } from '../core/types';

/*
 * Compréhension des demandes en français (sans service externe) : « j'ai un budget de 500 000 €,
 * je veux un parc pour 200 personnes avec un parcours sportif chronométré ».
 * On en tire un « brief » (paramètres du générateur + plan d'eau), complété message après message.
 */

export interface Brief {
  audience: Audience;
  capacity: number;
  intensity: number;
  loop: boolean;
  bigSlide: boolean;
  standalones: boolean;
  course: boolean;
  /** Budget HT maximal, 0 = sans limite. */
  budget: number;
  /** Plan d'eau demandé (m), sinon celui du projet. */
  lake?: { length: number; width: number };
  depth?: number;
}

export type Action = 'generate' | 'variant' | 'help' | 'real_site' | 'quote' | 'unknown';

export interface Intent {
  brief: Brief;
  action: Action;
  /** Ce qui a été compris, en clair (pour la réponse). */
  understood: string[];
}

/** Minuscules, sans accents, espaces fines et insécables normalisées. */
export function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[  ]/g, ' ')
    .replace(/’/g, "'");
}

/** « 500 000 », « 500k », « 0,5 M », « 1.2 million », « 500 mille » -> nombre. */
function amount(num: string, unit = ''): number {
  const n = Number(num.replace(/[\s.](?=\d{3}\b)/g, '').replace(/\s/g, '').replace(',', '.'));
  if (!Number.isFinite(n)) return NaN;
  const u = unit.trim();
  if (/^(k|ke|k€|keur|mille)/.test(u)) return n * 1e3;
  if (/^(m|me|m€|meur|million|millions)/.test(u)) return n * 1e6;
  return n;
}

const NUM = String.raw`(\d{1,3}(?:[ .]\d{3})+|\d+(?:[.,]\d+)?)`;
const AUD_LABEL: Record<Audience, string> = { kids: 'enfants', family: 'familles', sport: 'sportif (ados / adultes)', mixed: 'tout public' };

export const eurFmt = (n: number) => `${Math.round(n).toLocaleString('fr-FR')} €`;

export function parseRequest(text: string, prev: Brief): Intent {
  const t = norm(text);
  const b: Brief = { ...prev, lake: prev.lake ? { ...prev.lake } : undefined };
  const u: string[] = [];
  let action: Action = 'unknown';
  let changed = false;
  const has = (re: RegExp) => re.test(t);

  if (has(/^(aide|help|\?)$|que (peux|sais)[- ]tu|comment (ca|ça) marche|tu (peux|sais) faire quoi/)) return { brief: prev, action: 'help', understood: [] };
  if (has(/devis|commander|acheter|contact(er)? (un|le) commercial/) && !has(/budget|personnes/)) return { brief: prev, action: 'quote', understood: [] };
  if (has(/mon (vrai )?(lac|site|plan d'eau)|site reel|sur la carte|adresse/) && !has(/personnes|budget|enfants|sportif/))
    return { brief: prev, action: 'real_site', understood: [] };

  // ---- budget
  const bud =
    t.match(new RegExp(String.raw`budget[^0-9]{0,25}${NUM}\s*(k|m|mille|millions?)?`)) ??
    t.match(new RegExp(String.raw`${NUM}\s*(?:(k|m|millions?|mille)\s*(?:d'|de )?)?(?:€|eur\b|euros|ht\b)`)) ??
    t.match(new RegExp(String.raw`${NUM}\s*(millions?|mille)\b`));
  if (has(/sans (limite de )?budget|pas de (limite de )?budget|budget illimite/)) {
    b.budget = 0;
    u.push('sans limite de budget');
    changed = true;
  } else if (bud) {
    const v = amount(bud[1], bud[2] ?? '');
    if (v >= 5000) {
      b.budget = Math.round(v);
      u.push(`budget ${eurFmt(b.budget)} HT`);
      changed = true;
    }
  }

  // ---- capacité
  const cap = t.match(/(\d{1,4})\s*(?:personnes|pers\b|baigneurs|places|participants|nageurs|visiteurs|joueurs|enfants|ados|adolescents|adultes|clients|usagers|people)/);
  if (cap) {
    b.capacity = Math.max(15, Math.min(400, Number(cap[1])));
    u.push(`${b.capacity} personnes en même temps`);
    changed = true;
  }

  // ---- plan d'eau
  const lake = t.match(/(\d{2,4})\s*(?:m|metres?)?\s*(?:x|×|\*|sur|par)\s*(\d{2,4})\s*(?:m|metres?)\b/);
  if (lake) {
    b.lake = { length: Math.min(1500, Number(lake[1])), width: Math.min(1500, Number(lake[2])) };
    u.push(`plan d'eau de ${b.lake.length} × ${b.lake.width} m`);
    changed = true;
  }
  const depth = t.match(/profondeur\s*(?:de|d'environ|:)?\s*(\d+(?:[.,]\d+)?)\s*m|(\d+(?:[.,]\d+)?)\s*m(?:etres?)?\s*de (?:profondeur|fond)/);
  if (depth) {
    b.depth = Math.max(0.8, Math.min(15, Number((depth[1] ?? depth[2]).replace(',', '.'))));
    u.push(`profondeur ${b.depth} m`);
    changed = true;
  }

  // ---- parcours chronométré / challenge
  const wantsCourse = has(/chrono|course|challenge|competition|parcours sportif|ninja|defi|record|contre[- ]la[- ]montre|duel|time ?trial|olympiade/);
  if (wantsCourse && !has(/sans (parcours )?chrono/)) {
    b.course = true;
    b.loop = false;
    u.push('parcours chronométré d’un seul tenant (départ, obstacles, arrivée)');
    changed = true;
  } else if (has(/pas de (course|chrono)|sans chrono/)) {
    b.course = false;
    changed = true;
  }

  // ---- public
  let aud: Audience | null = null;
  if (has(/tout public|mixte|tous publics|tous les ages|tout le monde/)) aud = 'mixed';
  else if (has(/famill/)) aud = 'family';
  else if (has(/\benfants?\b|\bkids?\b|petits|bambins|colonie|centre aere/) && !has(/pas (pour )?(les )?enfants/)) aud = 'kids';
  else if (has(/sporti|\bsport\b|ados|adolescents|adultes|athlet|entrainement|team building|seminaire/) || b.course) aud = 'sport';
  if (aud && aud !== prev.audience) {
    b.audience = aud;
    changed = true;
    u.push(`public ${AUD_LABEL[aud]}`);
  }

  // ---- intensité
  let inten: number | null = null;
  if (has(/tres (doux|facile)|tout[- ]petits|debutants?/)) inten = 1;
  else if (has(/doux|calme|facile|tranquille|detente|accessible/)) inten = 2;
  else if (has(/extreme|hardcore|expert|tres difficile|tres intense|engage/)) inten = 5;
  else if (has(/intense|difficile|physique|exigeant|sporti/) || b.course) inten = Math.max(4, b.intensity);
  if (has(/plus (difficile|dur|sportif|intense)/)) inten = Math.min(5, prev.intensity + 1);
  if (has(/plus (facile|doux|simple)|moins (difficile|dur)/)) inten = Math.max(1, prev.intensity - 1);
  if (inten !== null && inten !== prev.intensity) {
    b.intensity = inten;
    u.push(`intensité ${inten}/5`);
    changed = true;
  }

  // ---- options
  if (has(/sans boucle|pas de boucle/)) {
    b.loop = false;
    u.push('sans boucle');
    changed = true;
  } else if (has(/boucle|infinity|circuit ferme|anneau/)) {
    b.loop = true;
    b.course = false;
    u.push('avec une boucle InfinityLoop');
    changed = true;
  }
  if (has(/sans (grand )?tobogg?an|pas de (grand )?tobogg?an/)) {
    b.bigSlide = false;
    u.push('sans grand toboggan');
    changed = true;
  } else if (has(/tobogg?an|glisse|grand saut|wave|mountain|sensations/)) {
    b.bigSlide = true;
    u.push('avec un grand toboggan');
    changed = true;
  }
  if (has(/volley|trampoline|autonome|bouncer|tour d'escalade|icetower|ice tower|modules isoles/)) {
    b.standalones = true;
    u.push('avec des modules autonomes (volley, trampoline…)');
    changed = true;
  }

  // ---- ajustements relatifs
  if (has(/moins cher|plus economique|moins couteux|reduis? le (budget|prix)|baisse le (budget|prix)|trop cher/)) {
    b.budget = Math.round((prev.budget || 0) * 0.8) || -1; // -1 : 80 % du parc actuel, résolu par l'appelant
    u.push('un parc moins cher (−20 %)');
    changed = true;
  }
  if (has(/plus grand|plus de (monde|places|capacite|personnes)|agrandi/) && !cap) {
    b.capacity = Math.min(400, Math.round(prev.capacity * 1.25));
    u.push(`plus de capacité (${b.capacity} personnes)`);
    changed = true;
  }
  if (has(/plus petit|moins de (monde|places|personnes)|reduis? la taille/) && !cap) {
    b.capacity = Math.max(15, Math.round(prev.capacity * 0.8));
    u.push(`moins de capacité (${b.capacity} personnes)`);
    changed = true;
  }

  if (changed) action = 'generate';
  else if (has(/autre (version|variante|proposition|idee)|une autre|encore|refais|recommence|change|nouvelle (version|proposition)|pas fan|j'aime pas|bof/)) action = 'variant';
  else if (has(/genere|cree|fais|propose|construi|dessine|imagine|parc/)) action = 'generate';
  return { brief: b, action, understood: u };
}

/** Aide affichée par l'assistant. */
export const HELP = [
  'Décrivez simplement votre projet, par exemple :',
  '« J’ai un budget de 500 000 €, je veux un parc pour 200 personnes avec un parcours sportif pour des challenges chronométrés. »',
  'Je comprends le budget, le nombre de personnes, le public (enfants, familles, sportifs), l’intensité, les envies (toboggan, boucle, parcours chronométré, volley…) et la taille du plan d’eau.',
  'Ensuite : « moins cher », « plus grand », « plus facile », « une autre version », « sans toboggan »…',
];
