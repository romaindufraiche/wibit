// Serveur Parkcraft : fichiers statiques (dist/) + API comptes, parcs, activité et administration.
import { createServer } from 'node:http';
import { createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fileStore, pgStore } from './store.js';
import { overview, userInsights } from './insights.js';

const scrypt = promisify(scryptCb);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const PORT = Number(process.env.PORT ?? 3001);
const SECRET = process.env.SESSION_SECRET || randomBytes(32).toString('hex');
/** Adresses e-mail promues administrateur (séparées par des virgules). */
const ADMIN_EMAILS = new Set(
  (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
);
const TOKEN_DAYS = 30;
const MAX_BODY = 5 * 1024 * 1024;
const EVENT_TYPES = new Set([
  'session',
  'heartbeat',
  'generate',
  'template',
  'pen',
  'module_add',
  'save',
  'export_pdf',
  'export_csv',
  'export_anchors',
  'play',
  'season_extend',
  'season_recompose',
  'quote_request',
  'shore_edit',
]);
const PARK_STATUSES = new Set(['draft', 'quote_requested', 'quote_sent', 'won', 'lost']);

// ------------------------------------------------------------ authentification

async function hashPassword(pw) {
  const salt = randomBytes(16);
  const key = await scrypt(pw, salt, 64);
  return `${salt.toString('hex')}:${key.toString('hex')}`;
}
async function checkPassword(pw, stored) {
  const [salt, hex] = stored.split(':');
  const key = await scrypt(pw, Buffer.from(salt, 'hex'), 64);
  const ref = Buffer.from(hex, 'hex');
  return ref.length === key.length && timingSafeEqual(ref, key);
}
const sign = (payload) => createHmac('sha256', SECRET).update(payload).digest('base64url');
function makeToken(uid) {
  const payload = Buffer.from(JSON.stringify({ uid, exp: Date.now() + TOKEN_DAYS * 864e5 })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}
function readToken(req) {
  const m = (req.headers.authorization ?? '').match(/^Bearer (.+)\.(.+)$/);
  if (!m) return null;
  const expected = Buffer.from(sign(m[1]));
  const got = Buffer.from(m[2]);
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) return null;
  try {
    const { uid, exp } = JSON.parse(Buffer.from(m[1], 'base64url').toString());
    return exp > Date.now() ? uid : null;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------ HTTP

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
const fail = (status, message) => Object.assign(new Error(message), { status });

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(fail(413, 'Requête trop volumineuse'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {});
      } catch {
        reject(fail(400, 'JSON invalide'));
      }
    });
  });
}
const publicUser = (u) => ({ id: u.id, email: u.email, name: u.name, company: u.company ?? '', phone: u.phone ?? '', role: u.role ?? 'user' });
const validProject = (p) => p && p.version === 1 && Array.isArray(p.modules) && p.site && typeof p.name === 'string';
const cleanStats = (s) => {
  if (!s || typeof s !== 'object') return {};
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const types = {};
  for (const [k, v] of Object.entries(s.types ?? {}).slice(0, 120)) if (/^[a-z0-9-]{1,40}$/.test(k)) types[k] = num(v);
  return { modules: num(s.modules), capacity: num(s.capacity), total: num(s.total), errors: num(s.errors), warnings: num(s.warnings), types };
};
const str = (v, max = 200) => String(v ?? '').trim().slice(0, max);

async function api(store, req, res, path) {
  if (path === '/api/health') return send(res, 200, { ok: true, storage: store.kind });
  if (req.method === 'GET' && path === '/api/catalog') return send(res, 200, { overrides: (await store.getSetting('catalog')) ?? {} });

  if (req.method === 'POST' && path === '/api/auth/register') {
    const { email, password, name, company, phone } = await readBody(req);
    const e = str(email).toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return send(res, 400, { error: 'Adresse e-mail invalide.' });
    if (String(password ?? '').length < 8) return send(res, 400, { error: 'Le mot de passe doit faire au moins 8 caractères.' });
    if (await store.userByEmail(e)) return send(res, 409, { error: 'Un compte existe déjà avec cette adresse.' });
    const u = await store.createUser({
      email: e,
      name: str(name, 80) || e.split('@')[0],
      company: str(company, 120),
      phone: str(phone, 40),
      pass: await hashPassword(String(password)),
      role: ADMIN_EMAILS.has(e) ? 'admin' : 'user',
    });
    await store.addEvents([{ user_id: u.id, type: 'session' }]);
    return send(res, 201, { token: makeToken(u.id), user: publicUser(u) });
  }
  if (req.method === 'POST' && path === '/api/auth/login') {
    const { email, password } = await readBody(req);
    let u = await store.userByEmail(str(email).toLowerCase());
    if (!u || !(await checkPassword(String(password ?? ''), u.pass))) return send(res, 401, { error: 'E-mail ou mot de passe incorrect.' });
    if (u.disabled) return send(res, 403, { error: 'Ce compte est désactivé. Contactez-nous.' });
    if (ADMIN_EMAILS.has(u.email) && u.role !== 'admin') u = { ...u, ...(await store.updateUser(u.id, { role: 'admin' })) };
    await store.updateUser(u.id, { last_seen: new Date().toISOString() });
    await store.addEvents([{ user_id: u.id, type: 'session' }]);
    return send(res, 200, { token: makeToken(u.id), user: publicUser(u) });
  }

  const uid = readToken(req);
  if (!uid) return send(res, 401, { error: 'Connexion requise.' });
  const user = await store.userById(uid);
  if (!user || user.disabled) return send(res, 401, { error: 'Compte introuvable ou désactivé.' });

  if (req.method === 'GET' && path === '/api/me') {
    await store.updateUser(uid, { last_seen: new Date().toISOString() });
    return send(res, 200, { user: publicUser(user) });
  }
  if (req.method === 'POST' && path === '/api/events') {
    const { events } = await readBody(req);
    const rows = (Array.isArray(events) ? events : [])
      .slice(0, 50)
      .filter((e) => EVENT_TYPES.has(e?.type))
      .map((e) => ({ user_id: uid, park_id: Number.isInteger(e.park_id) ? e.park_id : null, type: e.type, data: e.data && typeof e.data === 'object' ? JSON.parse(JSON.stringify(e.data).slice(0, 2000) || 'null') : null }));
    if (rows.length) await store.addEvents(rows);
    await store.updateUser(uid, { last_seen: new Date().toISOString() });
    return send(res, 200, { ok: true, stored: rows.length });
  }

  // ---------------------------------------------------------- parcs du client
  if (req.method === 'GET' && path === '/api/parks') return send(res, 200, { parks: await store.listParks(uid) });
  if (req.method === 'POST' && path === '/api/parks') {
    const { project, stats } = await readBody(req);
    if (!validProject(project)) return send(res, 400, { error: 'Projet invalide.' });
    const park = await store.createPark(uid, { name: project.name.slice(0, 120), data: project, stats: cleanStats(stats) });
    await store.addEvents([{ user_id: uid, park_id: park.id, type: 'save' }]);
    return send(res, 201, { park });
  }
  let m = path.match(/^\/api\/parks\/(\d+)(\/quote-request)?$/);
  if (m) {
    const pid = Number(m[1]);
    const p = await store.getPark(pid);
    const isAdmin = user.role === 'admin';
    if (!p || (p.user_id !== uid && !isAdmin)) return send(res, 404, { error: 'Parc introuvable.' });
    if (m[2] && req.method === 'POST') {
      const { message } = await readBody(req);
      const quote = { ...(p.quote ?? {}), requested_at: new Date().toISOString(), message: str(message, 2000) };
      const park = await store.updatePark(pid, { status: p.status === 'draft' ? 'quote_requested' : p.status, quote });
      await store.addEvents([{ user_id: uid, park_id: pid, type: 'quote_request', data: { message: quote.message } }]);
      return send(res, 200, { park });
    }
    if (req.method === 'GET') return send(res, 200, { park: { id: p.id, name: p.name, status: p.status, updated_at: p.updated_at, project: p.data } });
    if (req.method === 'PUT') {
      const { project, stats } = await readBody(req);
      if (!validProject(project)) return send(res, 400, { error: 'Projet invalide.' });
      const park = await store.updatePark(pid, { name: project.name.slice(0, 120), data: project, stats: cleanStats(stats) });
      if (p.user_id === uid) await store.addEvents([{ user_id: uid, park_id: pid, type: 'save' }]);
      return send(res, 200, { park });
    }
    if (req.method === 'DELETE') {
      await store.deletePark(pid);
      return send(res, 200, { ok: true });
    }
  }

  // ---------------------------------------------------------- administration
  if (!path.startsWith('/api/admin/')) return send(res, 404, { error: 'Route inconnue.' });
  if (user.role !== 'admin') return send(res, 403, { error: 'Accès réservé aux administrateurs.' });
  const since = new Date(Date.now() - 120 * 864e5).toISOString();

  if (req.method === 'GET' && path === '/api/admin/overview') {
    const [users, parks, events] = await Promise.all([store.listUsers(), store.listAllParks(), store.listEvents({ since })]);
    const ins = userInsights(users, parks, events);
    return send(res, 200, overview(users, parks, events, ins));
  }
  if (req.method === 'GET' && path === '/api/admin/users') {
    const [users, parks, events] = await Promise.all([store.listUsers(), store.listAllParks(), store.listEvents({ since })]);
    return send(res, 200, { users: userInsights(users, parks, events) });
  }
  m = path.match(/^\/api\/admin\/users\/(\d+)(\/followup)?$/);
  if (m) {
    const tid = Number(m[1]);
    const target = await store.userById(tid);
    if (!target) return send(res, 404, { error: 'Compte introuvable.' });
    if (m[2] && req.method === 'POST') {
      const { channel, note, next_date } = await readBody(req);
      const followup = { ...(target.followup ?? {}), last_contact: new Date().toISOString(), last_channel: str(channel, 20), next_date: next_date ? str(next_date, 30) : null, count: (target.followup?.count ?? 0) + 1 };
      await store.addEvents([{ user_id: tid, type: 'followup', data: { channel: str(channel, 20), note: str(note, 2000), by: user.email, next_date: followup.next_date } }]);
      return send(res, 200, { user: await store.updateUser(tid, { followup }) });
    }
    if (req.method === 'GET') {
      const [parks, events] = await Promise.all([store.listParks(tid), store.listEvents({ userId: tid })]);
      const ins = userInsights([{ ...target, pass: undefined }], parks, events)[0];
      const { pass, ...safe } = target;
      void pass;
      return send(res, 200, { user: { ...safe, ...ins }, parks, events: events.slice(-300).reverse() });
    }
    if (req.method === 'PATCH') {
      const body = await readBody(req);
      const patch = {};
      for (const k of ['name', 'company', 'phone', 'notes']) if (k in body) patch[k] = str(body[k], k === 'notes' ? 5000 : 120);
      if ('role' in body) patch.role = body.role === 'admin' ? 'admin' : 'user';
      if ('disabled' in body) patch.disabled = !!body.disabled;
      if ('followup' in body && body.followup && typeof body.followup === 'object') patch.followup = { ...(target.followup ?? {}), ...body.followup };
      if (tid === uid && (patch.role === 'user' || patch.disabled)) return send(res, 400, { error: 'Vous ne pouvez pas retirer vos propres droits.' });
      return send(res, 200, { user: await store.updateUser(tid, patch) });
    }
    if (req.method === 'DELETE') {
      if (tid === uid) return send(res, 400, { error: 'Vous ne pouvez pas supprimer votre propre compte.' });
      await store.deleteUser(tid);
      return send(res, 200, { ok: true });
    }
  }
  if (req.method === 'GET' && path === '/api/admin/parks') {
    const [users, parks] = await Promise.all([store.listUsers(), store.listAllParks()]);
    const byId = new Map(users.map((u) => [u.id, u]));
    return send(res, 200, { parks: parks.map((p) => ({ ...p, owner: byId.get(p.user_id) ? { id: p.user_id, email: byId.get(p.user_id).email, name: byId.get(p.user_id).name, company: byId.get(p.user_id).company } : null })) });
  }
  m = path.match(/^\/api\/admin\/parks\/(\d+)$/);
  if (m) {
    const pid = Number(m[1]);
    const p = await store.getPark(pid);
    if (!p) return send(res, 404, { error: 'Parc introuvable.' });
    if (req.method === 'GET') {
      const owner = await store.userById(p.user_id);
      return send(res, 200, { park: { ...p, owner: owner ? publicUser(owner) : null } });
    }
    if (req.method === 'PUT') {
      const body = await readBody(req);
      const patch = {};
      if (body.project) {
        if (!validProject(body.project)) return send(res, 400, { error: 'Projet invalide.' });
        patch.data = body.project;
        patch.name = body.project.name.slice(0, 120);
      }
      if (body.stats) patch.stats = cleanStats(body.stats);
      if (body.status) {
        if (!PARK_STATUSES.has(body.status)) return send(res, 400, { error: 'Statut inconnu.' });
        patch.status = body.status;
      }
      if (body.quote !== undefined) patch.quote = body.quote;
      return send(res, 200, { park: await store.updatePark(pid, patch) });
    }
    if (req.method === 'DELETE') {
      await store.deletePark(pid);
      return send(res, 200, { ok: true });
    }
  }
  if (path === '/api/admin/catalog') {
    if (req.method === 'GET') return send(res, 200, { overrides: (await store.getSetting('catalog')) ?? {} });
    if (req.method === 'PUT') {
      const { overrides } = await readBody(req);
      const clean = {};
      for (const [id, o] of Object.entries(overrides ?? {})) {
        if (!/^[a-z0-9-]{1,40}$/.test(id) || !o || typeof o !== 'object') continue;
        const c = {};
        for (const k of ['price', 'cap', 'anchors']) if (Number.isFinite(Number(o[k])) && o[k] !== '' && o[k] !== null) c[k] = Math.max(0, Number(o[k]));
        if (o.disabled) c.disabled = true;
        if (Object.keys(c).length) clean[id] = c;
      }
      await store.setSetting('catalog', clean);
      return send(res, 200, { overrides: clean });
    }
  }
  return send(res, 404, { error: 'Route inconnue.' });
}

async function serveStatic(req, res, path) {
  let file = normalize(join(DIST, decodeURIComponent(path)));
  if (!file.startsWith(DIST)) return send(res, 403, { error: 'Interdit' });
  if (path === '/admin' || path === '/admin/') file = join(DIST, 'admin.html');
  try {
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
  } catch {
    file = join(DIST, 'index.html'); // application monopage
  }
  try {
    const body = await readFile(file);
    const immutable = file.includes(join(DIST, 'assets'));
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream', 'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('Introuvable');
  }
}

const store = process.env.DATABASE_URL ? await pgStore(process.env.DATABASE_URL) : fileStore(ROOT);
await store.init();

createServer(async (req, res) => {
  const path = new URL(req.url ?? '/', 'http://x').pathname;
  try {
    if (path.startsWith('/api/')) return await api(store, req, res, path);
    return await serveStatic(req, res, path);
  } catch (e) {
    if (!e.status) console.error(e);
    send(res, e.status ?? 500, { error: e.status ? e.message : 'Erreur serveur.' });
  }
}).listen(PORT, () => console.log(`Parkcraft sur http://localhost:${PORT} (stockage : ${store.kind}, admins : ${[...ADMIN_EMAILS].join(', ') || 'aucun'})`));
