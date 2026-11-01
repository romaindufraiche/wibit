import { spec } from '../catalog/modules';
import { naturalOutline } from '../core/region';
import type { Placed, Project, Site } from '../core/types';
import { DEFAULT_PARAMS, generatePark, longestRun, type GenParams } from '../generator/generator';
import { computeStats, validate } from '../rules/validate';
import { eurFmt, type Brief } from './intent';

/*
 * De la demande au parc : choix du plan d'eau (agrandi si besoin quand il s'agit d'un lac type),
 * génération, puis un résumé factuel (capacité atteinte, budget, parcours, points forts).
 */

export function briefFrom(p: GenParams): Brief {
  return {
    audience: p.audience,
    capacity: p.capacity,
    intensity: p.intensity,
    loop: p.loop,
    bigSlide: p.bigSlide,
    standalones: p.standalones,
    course: !!p.course,
    budget: p.budget ?? 0,
  };
}

export interface PlanResult {
  modules: Placed[];
  site: Site;
  params: GenParams;
  /** Phrases de résumé (déjà en français). */
  summary: string[];
  ok: boolean;
}

const lakeFor = (length: number, width: number, depth: number): Site => ({ length, width, depth, outline: naturalOutline(length, width) });

/** Plan d'eau type assez grand pour la capacité demandée (un vrai site n'est jamais modifié). */
function siteFor(brief: Brief, site: Site): { site: Site; resizable: boolean } {
  const depth = brief.depth ?? site.depth;
  if (brief.lake) return { site: lakeFor(brief.lake.length, brief.lake.width, depth), resizable: false };
  if (site.geo) return { site: { ...site, depth }, resizable: false };
  let [L, W] = [site.length, site.width];
  const need = brief.capacity > 190 || (brief.course && brief.capacity >= 140) ? [420, 270] : brief.capacity > 130 ? [320, 200] : brief.capacity > 70 ? [220, 140] : [0, 0];
  if (L < need[0]) [L, W] = need;
  return { site: L === site.length && W === site.width && depth === site.depth ? site : lakeFor(L, W, depth), resizable: true };
}

export function planPark(brief: Brief, current: Project, seed: string, currentTotal = 0): PlanResult {
  const budget = brief.budget === -1 ? Math.round(currentTotal * 0.8) : brief.budget;
  const params: GenParams = {
    ...DEFAULT_PARAMS,
    audience: brief.audience,
    capacity: brief.capacity,
    intensity: brief.intensity,
    loop: brief.course ? false : brief.loop,
    bigSlide: brief.bigSlide,
    standalones: brief.standalones,
    course: brief.course,
    budget: budget > 0 ? budget : undefined,
    seed,
  };
  let { site, resizable } = siteFor(brief, current.site);
  params.start = site.start ?? current.site.start;
  let res = generatePark(site, params);
  const evalRes = (mods: Placed[], s: Site) => {
    const project: Project = { version: 1, name: '', site: s, audience: params.audience, modules: mods };
    return { project, stats: computeStats(project), errors: validate(project).filter((i) => i.level === 'error').length };
  };
  let ev = evalRes(res.modules, site);
  // lac type trop petit pour la capacité (et le budget n'est pas en cause) : on l'agrandit une fois
  const budgetBound = !!params.budget && ev.stats.total > params.budget * 0.9;
  if (resizable && res.modules.length && ev.stats.capacity < brief.capacity * 0.85 && !budgetBound) {
    const bigger = lakeFor(Math.round(site.length * 1.3), Math.round(site.width * 1.3), site.depth);
    const r2 = generatePark(bigger, params);
    const e2 = evalRes(r2.modules, bigger);
    if (e2.stats.capacity > ev.stats.capacity) {
      res = r2;
      ev = e2;
      site = bigger;
    }
  }
  if (!res.modules.length) return { modules: [], site, params, ok: false, summary: [res.log[0] ?? 'Aucun parc possible sur ce plan d’eau : trop petit ou trop peu profond.'] };

  const st = ev.stats;
  const out: string[] = [];
  out.push(`Voici votre parc : ${st.modules} modules, ${st.capacity} personnes en même temps, ${eurFmt(st.total)} HT${params.budget ? ` (budget ${eurFmt(params.budget)})` : ''}.`);
  if (params.budget && st.capacity < brief.capacity * 0.92) {
    const perHead = st.total / Math.max(1, st.capacity);
    out.push(`Avec ce budget, le parc accueille ${st.capacity} personnes au lieu de ${brief.capacity} : comptez environ ${eurFmt(Math.ceil((perHead * brief.capacity) / 10000) * 10000)} pour ${brief.capacity} personnes.`);
  } else if (st.capacity < brief.capacity * 0.85) {
    out.push(`Le plan d’eau limite le parc à ${st.capacity} personnes sur les ${brief.capacity} demandées.`);
  }
  if (params.course) {
    const run = longestRun(res.modules);
    out.push(`Parcours chronométré : ${run} modules à enchaîner d’un seul tenant, du départ jusqu’à l’arrivée.`);
  }
  if (site !== current.site && !site.geo) out.push(`Plan d’eau ajusté à ${site.length} × ${site.width} m pour accueillir ce parc.`);
  const best = [...res.modules]
    .map((m) => spec(m.type))
    .filter((s) => s.role !== 'connector' && s.role !== 'watch')
    .sort((a, b) => b.price - a.price)
    .map((s) => s.name)
    .filter((n, i, a) => a.indexOf(n) === i)
    .slice(0, 4);
  if (best.length) out.push(`Points forts : ${best.join(', ')}.`);
  if (ev.errors) out.push(`${ev.errors} point(s) de règles à revoir (voir le panneau Conformité).`);
  return { modules: res.modules, site, params, ok: true, summary: out };
}
