/*
 * Données de démonstration pour l'administration : comptes fictifs (adresse @demo.parkcraft.fr,
 * société suffixée « (démo) »), projets générés, activité répartie sur 30 jours.
 *
 *   npx vite-node scripts/seed-demo.ts            (fichier data/db.json)
 *   DATABASE_URL=... npx vite-node scripts/seed-demo.ts
 *
 * Relancer le script ajoute de nouveaux comptes démo ; « --reset » supprime d'abord les anciens ;
 * « --if-empty » ne fait rien s'il existe déjà des comptes démo (chargement au démarrage du serveur).
 */
import { randomBytes, scrypt as scryptCb } from 'node:crypto';
import { promisify } from 'node:util';
import { join } from 'node:path';
// @ts-expect-error module JS du serveur
import { fileStore, pgStore } from '../server/store.js';
import { DEFAULT_PARAMS, generatePark } from '../src/generator/generator';
import { computeStats, validate } from '../src/rules/validate';
import { makeRng } from '../src/generator/rng';
import type { Project } from '../src/core/types';

const scrypt = promisify(scryptCb);
const rng = makeRng(2027);
const DAY = 864e5;

const PEOPLE: [string, string][] = [
  ['Julie Martin', 'Base nautique du Lac Bleu'],
  ['Thomas Rousseau', 'Camping Les Pins'],
  ['Sophie Bernard', 'Mairie de Saint-Aygulf'],
  ['Karim Haddad', 'Aqua Loisirs 74'],
  ['Claire Dubois', 'Hôtel Rivage'],
  ['Nicolas Petit', 'Domaine des Étangs'],
  ['Emma Laurent', 'Plage du Grand Lac'],
  ['Hugo Moreau', 'Wake Park Annecy'],
  ['Léa Fontaine', 'Centre de vacances Les Mouettes'],
  ['Antoine Garnier', 'Lac de Vassivière Loisirs'],
  ['Inès Lefèvre', 'Village Club Océan'],
  ['Marc Girard', 'Base de loisirs du Val'],
];

async function main() {
  const store = process.env.DATABASE_URL ? await pgStore(process.env.DATABASE_URL) : fileStore(join(import.meta.dirname ?? '.', '..'));
  await store.init();
  if (process.argv.includes('--if-empty') && (await store.listUsers()).some((u: { email: string }) => u.email.endsWith('@demo.parkcraft.fr'))) {
    console.log('Comptes de démonstration déjà présents.');
    process.exit(0);
  }
  if (process.argv.includes('--reset')) {
    for (const u of await store.listUsers()) if (u.email.endsWith('@demo.parkcraft.fr')) await store.deleteUser(u.id);
  }
  const salt = randomBytes(16);
  const pass = `${salt.toString('hex')}:${((await scrypt('demo-demo-demo', salt, 64)) as Buffer).toString('hex')}`;
  const now = Date.now();
  let created = 0;
  for (const [i, [name, company]] of PEOPLE.entries()) {
    const email = `${name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]+/g, '.')}${Date.now() % 1000}@demo.parkcraft.fr`;
    const signup = now - rng.int(2, 29) * DAY;
    const user = await store.createUser({ email, name, company: `${company} (démo)`, phone: `06 ${rng.int(10, 99)} ${rng.int(10, 99)} ${rng.int(10, 99)} ${rng.int(10, 99)}`, pass, created_at: new Date(signup).toISOString() });
    const events: { user_id: number; park_id?: number | null; type: string; data?: unknown; created_at: string }[] = [];
    const at = (t: number) => new Date(Math.min(now - 3600e3, t)).toISOString();
    // profil d'engagement : de « curieux » à « prêt à signer »
    const level = i % 6;
    const sessions = [1, 2, 3, 4, 5, 6][level];
    let t = signup;
    let lastActive = signup;
    const parkCount = [0, 1, 1, 2, 2, 3][level];
    const parkIds: number[] = [];
    for (let s = 0; s < sessions; s++) {
      t += rng.int(0, 4) * DAY + rng.int(1, 10) * 3600e3;
      if (t > now - 3600e3) break;
      lastActive = t;
      events.push({ user_id: user.id, type: 'session', created_at: at(t) });
      const minutes = rng.int(4, 28);
      for (let m = 0; m < minutes; m++) events.push({ user_id: user.id, type: 'heartbeat', created_at: at(t + m * 60e3) });
      for (let g = 0; g < rng.int(1, 4); g++) events.push({ user_id: user.id, type: 'generate', data: { modules: rng.int(12, 30), budget: 0 }, created_at: at(t + rng.int(1, minutes) * 60e3) });
      if (rng.next() < 0.3) events.push({ user_id: user.id, type: 'play', created_at: at(t + minutes * 50e3) });
    }
    for (let k = 0; k < parkCount; k++) {
      const site = { length: 260, width: 160, depth: 3.5 };
      const params = { ...DEFAULT_PARAMS, audience: rng.pick(['family', 'mixed', 'sport', 'kids'] as const), capacity: rng.int(40, 160), seed: `demo-${i}-${k}` };
      const r = generatePark(site, params);
      const project: Project = { version: 1, name: `${company} — ${['Été', 'Saison 2027', 'Variante B'][k]}`, site, audience: params.audience, modules: r.modules };
      const st = computeStats(project);
      const issues = validate(project);
      const types: Record<string, number> = {};
      for (const m of r.modules) types[m.type] = (types[m.type] ?? 0) + 1;
      // un projet sur quatre garde une erreur (module déplacé à la main sur la berge)
      const errors = k === 0 && i % 4 === 1 ? 2 : issues.filter((x) => x.level === 'error').length;
      const park = await store.createPark(user.id, { created_at: at(lastActive - 3600e3), name: project.name, data: project, stats: { modules: st.modules, capacity: st.capacity, total: st.total, errors, warnings: issues.filter((x) => x.level === 'warning').length, types } });
      parkIds.push(park.id);
      const status = level >= 5 && k === 0 ? rng.pick(['won', 'quote_sent']) : level >= 4 && k === 0 ? 'quote_requested' : 'draft';
      const quote = status === 'draft' ? null : { requested_at: at(lastActive), message: 'Ouverture souhaitée en juin, accès camion côté parking.', total: status === 'draft' ? undefined : Math.round(st.total * 0.95) };
      await store.updatePark(park.id, { status, quote });
      events.push({ user_id: user.id, park_id: park.id, type: 'save', created_at: at(lastActive) });
      if (status !== 'draft') events.push({ user_id: user.id, park_id: park.id, type: 'quote_request', data: { message: quote?.message }, created_at: at(lastActive + 600e3) });
      if (level >= 3) events.push({ user_id: user.id, park_id: park.id, type: 'export_pdf', data: { total: st.total }, created_at: at(lastActive + 300e3) });
      if (level >= 4 && k === 0) events.push({ user_id: user.id, park_id: park.id, type: 'export_anchors', created_at: at(lastActive + 900e3) });
    }
    if (level === 2) events.push({ user_id: user.id, type: 'season_extend', data: { budget: 50000 }, created_at: at(lastActive + 120e3) });
    await store.addEvents(events);
    await store.updateUser(user.id, { last_seen: new Date(lastActive).toISOString() });
    created++;
    console.log(`${name} (${company}) : ${parkIds.length} projet(s), ${events.length} événements`);
  }
  console.log(`\n${created} comptes de démonstration créés (mot de passe : demo-demo-demo).`);
  await new Promise((r) => setTimeout(r, 300));
  process.exit(0);
}

main();
