import { describe, expect, it } from 'vitest';
// @ts-expect-error module JS du serveur
import { overview, userInsights } from '../server/insights.js';

const DAY = 864e5;
const ref = Date.parse('2026-11-01T12:00:00Z');
const iso = (daysAgo: number) => new Date(ref - daysAgo * DAY).toISOString();

describe('analyse des relances', () => {
  const users = [
    { id: 1, email: 'a@x.fr', name: 'Actif bloqué', role: 'user', created_at: iso(20), last_seen: iso(6), followup: {} },
    { id: 2, email: 'b@x.fr', name: 'Devis', role: 'user', created_at: iso(10), last_seen: iso(1), followup: {} },
    { id: 3, email: 'c@x.fr', name: 'Curieux', role: 'user', created_at: iso(2), last_seen: iso(2), followup: {} },
    { id: 4, email: 'd@x.fr', name: 'Déjà relancé', role: 'user', created_at: iso(30), last_seen: iso(10), followup: { next_date: iso(-5) } },
    { id: 5, email: 'admin@x.fr', name: 'Admin', role: 'admin', created_at: iso(30), last_seen: iso(0), followup: {} },
  ];
  const parks = [
    { id: 1, user_id: 1, name: 'Lac', status: 'draft', stats: { errors: 2, total: 120000, types: { slide: 3 } }, created_at: iso(8), updated_at: iso(6) },
    { id: 2, user_id: 2, name: 'Plage', status: 'quote_requested', stats: { total: 200000 }, created_at: iso(5), updated_at: iso(1) },
    { id: 3, user_id: 4, name: 'Étang', status: 'draft', stats: { total: 80000 }, created_at: iso(12), updated_at: iso(10) },
  ];
  const events = [
    ...Array.from({ length: 30 }, (_, i) => ({ user_id: 1, type: 'heartbeat', created_at: iso(6 + i / 1000) })),
    { user_id: 3, type: 'heartbeat', created_at: iso(2) },
    { user_id: 1, type: 'followup', created_at: iso(0) }, // une relance ne compte pas comme activité du client
  ];
  const ins = userInsights(users, parks, events, ref);
  const by = (id: number) => ins.find((u: { id: number }) => u.id === id);

  it('détecte les blocages et la priorité', () => {
    expect(by(1).toFollowUp).toBe(true);
    expect(by(1).inactiveDays).toBe(6);
    expect(by(1).blockers.join(' ')).toMatch(/2 erreurs de règles/);
    expect(by(1).blockers.join(' ')).toMatch(/30 min passées sans demander de devis/);
    expect(by(2).stage).toBe('devis_demande');
    expect(by(2).toFollowUp).toBe(true);
    expect(by(3).toFollowUp).toBe(false); // pas assez engagé
    expect(by(4).toFollowUp).toBe(false); // prochaine relance planifiée dans le futur
    expect(by(5).toFollowUp).toBe(false); // administrateur
    expect(by(2).score).toBeGreaterThan(by(4).score);
  });

  it('calcule les totaux du tableau de bord', () => {
    const ov = overview(users, parks, events, ins, ref);
    expect(ov.totals.users).toBe(4);
    expect(ov.totals.pipeline).toBe(200000);
    expect(ov.series).toHaveLength(30);
    expect(ov.topModules[0]).toEqual(['slide', 3]);
  });
});
