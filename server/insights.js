// Analyse de l'activité des comptes pour le tableau de bord administrateur :
// étape atteinte dans le parcours, temps passé, blocages probables, priorité de relance.

const DAY = 864e5;
export const STAGES = ['inscrit', 'projet', 'devis_demande', 'devis_envoye', 'gagne', 'perdu'];
export const STAGE_LABELS = {
  inscrit: 'Inscrit',
  projet: 'Projet en cours',
  devis_demande: 'Devis demandé',
  devis_envoye: 'Devis envoyé',
  gagne: 'Gagné',
  perdu: 'Perdu',
};

const days = (iso, ref) => (iso ? Math.floor((ref - Date.parse(iso)) / DAY) : Infinity);

export function userInsights(users, parks, events, ref = Date.now()) {
  const byUserParks = new Map();
  for (const p of parks) {
    if (!byUserParks.has(p.user_id)) byUserParks.set(p.user_id, []);
    byUserParks.get(p.user_id).push(p);
  }
  const byUserEvents = new Map();
  for (const e of events) {
    if (!byUserEvents.has(e.user_id)) byUserEvents.set(e.user_id, []);
    byUserEvents.get(e.user_id).push(e);
  }
  return users.map((u) => {
    const ps = (byUserParks.get(u.id) ?? []).sort((a, b) => (b.updated_at ?? '').localeCompare(a.updated_at ?? ''));
    // les relances saisies par l'équipe ne comptent pas comme activité du client
    const ev = (byUserEvents.get(u.id) ?? []).filter((e) => e.type !== 'followup');
    const count = {};
    for (const e of ev) count[e.type] = (count[e.type] ?? 0) + 1;
    const minutes = count.heartbeat ?? 0;
    const lastEvent = ev.length ? ev[ev.length - 1].created_at : null;
    const lastActivity = [u.last_seen, lastEvent, ps[0]?.updated_at].filter(Boolean).sort().pop() ?? u.created_at;
    const inactive = days(lastActivity, ref);
    const statuses = new Set(ps.map((p) => p.status));
    const quoteAsked = statuses.has('quote_requested') || (count.quote_request ?? 0) > 0;
    const stage = statuses.has('won')
      ? 'gagne'
      : statuses.has('quote_sent')
        ? 'devis_envoye'
        : quoteAsked
          ? 'devis_demande'
          : ps.length
            ? 'projet'
            : statuses.has('lost')
              ? 'perdu'
              : 'inscrit';
    const finalLost = ps.length > 0 && ps.every((p) => p.status === 'lost');
    const latest = ps[0];
    const stats = latest?.stats ?? {};

    // blocages probables
    const blockers = [];
    if (latest && stats.errors > 0) blockers.push(`« ${latest.name} » a ${stats.errors} erreur${stats.errors > 1 ? 's' : ''} de règles non résolue${stats.errors > 1 ? 's' : ''}`);
    if ((count.generate ?? 0) >= 5 && !ps.length) blockers.push(`${count.generate} parcs générés sans en enregistrer : hésite entre les variantes`);
    if (minutes >= 20 && !quoteAsked && stage !== 'gagne') blockers.push(`${minutes} min passées sans demander de devis`);
    if (!ps.length && minutes >= 5) blockers.push("Inscrit et actif, mais aucun parc enregistré");
    if (statuses.has('quote_requested') && days(latest?.updated_at, ref) < 3) blockers.push('Devis demandé : à préparer et envoyer');
    if (statuses.has('quote_requested') && days(latest?.updated_at, ref) >= 3) blockers.push(`Devis demandé il y a ${days(latest.updated_at, ref)} jours, en attente de réponse`);
    if (statuses.has('quote_sent') && days(latest?.updated_at, ref) >= 7) blockers.push('Devis envoyé sans retour depuis plus d’une semaine');
    if ((count.export_anchors ?? 0) > 0 && !quoteAsked) blockers.push("A préparé le plan d'ancrage : projet avancé, à transformer");
    if ((count.season_extend ?? 0) > 0) blockers.push('Prépare un agrandissement pour la saison prochaine');
    if (stats.total && !quoteAsked && stats.total > 250000) blockers.push('Budget élevé : accompagnement commercial conseillé');

    const followup = u.followup ?? {};
    const snoozed = followup.next_date && Date.parse(followup.next_date) > ref;
    const engaged = minutes >= 5 || ps.length > 0;
    const open = stage !== 'gagne' && !finalLost && u.role !== 'admin' && !u.disabled;
    const toFollowUp = open && engaged && !snoozed && (inactive >= 3 || stage === 'devis_demande');
    const value = Math.max(0, ...ps.filter((p) => p.status !== 'lost').map((p) => p.stats?.total ?? 0));
    const score = Math.round(
      Math.min(minutes, 120) * 0.6 + ps.length * 8 + (quoteAsked ? 40 : 0) + (count.export_pdf ?? 0) * 6 + (count.export_anchors ?? 0) * 10 + value / 15000 - Math.max(0, inactive - 14) * 1.5,
    );
    return {
      ...u,
      parks: ps.length,
      minutes,
      sessions: count.session ?? 0,
      counts: count,
      lastActivity,
      inactiveDays: inactive === Infinity ? null : inactive,
      stage: finalLost ? 'perdu' : stage,
      latestPark: latest ? { id: latest.id, name: latest.name, status: latest.status, stats, updated_at: latest.updated_at } : null,
      value,
      blockers,
      toFollowUp,
      score,
    };
  });
}

export function overview(users, parks, events, insights, ref = Date.now()) {
  const dayKey = (iso) => iso.slice(0, 10);
  const series = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(ref - i * DAY).toISOString().slice(0, 10);
    series.push({ day: d, signups: 0, parks: 0, active: new Set(), minutes: 0 });
  }
  const idx = new Map(series.map((s, i) => [s.day, i]));
  for (const u of users) {
    const i = idx.get(dayKey(u.created_at));
    if (i !== undefined) series[i].signups++;
  }
  for (const p of parks) {
    const i = idx.get(dayKey(p.created_at ?? p.updated_at));
    if (i !== undefined) series[i].parks++;
  }
  for (const e of events) {
    const i = idx.get(dayKey(e.created_at));
    if (i === undefined) continue;
    series[i].active.add(e.user_id);
    if (e.type === 'heartbeat') series[i].minutes++;
  }
  const funnel = Object.fromEntries(['inscrit', 'projet', 'devis_demande', 'devis_envoye', 'gagne', 'perdu'].map((s) => [s, 0]));
  for (const ins of insights) if (ins.role !== 'admin') funnel[ins.stage]++;
  const types = {};
  for (const p of parks) for (const [t, n] of Object.entries(p.stats?.types ?? {})) types[t] = (types[t] ?? 0) + n;
  const clients = insights.filter((i) => i.role !== 'admin');
  return {
    totals: {
      users: clients.length,
      active7: clients.filter((i) => i.inactiveDays !== null && i.inactiveDays < 7).length,
      parks: parks.length,
      quotesRequested: parks.filter((p) => p.status === 'quote_requested').length,
      quotesSent: parks.filter((p) => p.status === 'quote_sent').length,
      won: parks.filter((p) => p.status === 'won').length,
      pipeline: parks.filter((p) => p.status === 'quote_requested' || p.status === 'quote_sent').reduce((a, p) => a + (p.quote?.total ?? p.stats?.total ?? 0), 0),
      wonValue: parks.filter((p) => p.status === 'won').reduce((a, p) => a + (p.quote?.total ?? p.stats?.total ?? 0), 0),
      toFollowUp: clients.filter((i) => i.toFollowUp).length,
      minutes: clients.reduce((a, i) => a + i.minutes, 0),
    },
    series: series.map((s) => ({ day: s.day, signups: s.signups, parks: s.parks, active: s.active.size, minutes: s.minutes })),
    funnel,
    topModules: Object.entries(types)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12),
  };
}
