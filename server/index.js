// Serveur Parkcraft : fichiers statiques (dist/) + API comptes & parcs.
// Stockage : PostgreSQL si DATABASE_URL est défini, sinon fichier JSON local (développement).
import { createServer } from 'node:http';
import { createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const scrypt = promisify(scryptCb);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const PORT = Number(process.env.PORT ?? 3001);
const SECRET = process.env.SESSION_SECRET || randomBytes(32).toString('hex');
const TOKEN_DAYS = 30;
const MAX_BODY = 5 * 1024 * 1024;

// ------------------------------------------------------------ stockage

function fileStore() {
  const path = join(ROOT, 'data', 'db.json');
  let db = { users: [], parks: [], seq: 0 };
  const load = async () => {
    try {
      db = JSON.parse(await readFile(path, 'utf8'));
    } catch {
      /* base vide */
    }
  };
  const save = async () => {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(db));
  };
  const id = () => ++db.seq;
  return {
    kind: 'fichier',
    init: load,
    async createUser(email, name, pass) {
      const u = { id: id(), email, name, pass, created_at: new Date().toISOString() };
      db.users.push(u);
      await save();
      return u;
    },
    userByEmail: async (email) => db.users.find((u) => u.email === email) ?? null,
    userById: async (uid) => db.users.find((u) => u.id === uid) ?? null,
    listParks: async (uid) =>
      db.parks
        .filter((p) => p.user_id === uid)
        .map(({ data, ...rest }) => ({ ...rest, modules: data?.modules?.length ?? 0 }))
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
    getPark: async (uid, pid) => db.parks.find((p) => p.user_id === uid && p.id === pid) ?? null,
    async savePark(uid, pid, name, data) {
      const now = new Date().toISOString();
      let p = pid ? db.parks.find((q) => q.user_id === uid && q.id === pid) : null;
      if (pid && !p) return null;
      if (p) Object.assign(p, { name, data, updated_at: now });
      else db.parks.push((p = { id: id(), user_id: uid, name, data, updated_at: now }));
      await save();
      return { id: p.id, name: p.name, updated_at: p.updated_at };
    },
    async deletePark(uid, pid) {
      const n = db.parks.length;
      db.parks = db.parks.filter((p) => !(p.user_id === uid && p.id === pid));
      await save();
      return db.parks.length < n;
    },
  };
}

async function pgStore(url) {
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({ connectionString: url, ssl: url.includes('localhost') ? false : { rejectUnauthorized: false } });
  const q = (text, params) => pool.query(text, params).then((r) => r.rows);
  return {
    kind: 'postgres',
    async init() {
      await q(`create table if not exists users (
        id serial primary key, email text unique not null, name text not null, pass text not null,
        created_at timestamptz not null default now())`);
      await q(`create table if not exists parks (
        id serial primary key, user_id integer not null references users(id) on delete cascade,
        name text not null, data jsonb not null, updated_at timestamptz not null default now())`);
      await q('create index if not exists parks_user on parks(user_id)');
    },
    createUser: async (email, name, pass) => (await q('insert into users(email,name,pass) values($1,$2,$3) returning *', [email, name, pass]))[0],
    userByEmail: async (email) => (await q('select * from users where email=$1', [email]))[0] ?? null,
    userById: async (uid) => (await q('select * from users where id=$1', [uid]))[0] ?? null,
    listParks: async (uid) => q("select id, name, updated_at, jsonb_array_length(data->'modules') as modules from parks where user_id=$1 order by updated_at desc", [uid]),
    getPark: async (uid, pid) => (await q('select * from parks where user_id=$1 and id=$2', [uid, pid]))[0] ?? null,
    async savePark(uid, pid, name, data) {
      const rows = pid
        ? await q('update parks set name=$3, data=$4, updated_at=now() where user_id=$1 and id=$2 returning id, name, updated_at', [uid, pid, name, data])
        : await q('insert into parks(user_id,name,data) values($1,$2,$3) returning id, name, updated_at', [uid, name, data]);
      return rows[0] ?? null;
    },
    deletePark: async (uid, pid) => (await q('delete from parks where user_id=$1 and id=$2 returning id', [uid, pid])).length > 0,
  };
}

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
const b64 = (s) => Buffer.from(s).toString('base64url');
const sign = (payload) => createHmac('sha256', SECRET).update(payload).digest('base64url');
function makeToken(uid) {
  const payload = b64(JSON.stringify({ uid, exp: Date.now() + TOKEN_DAYS * 864e5 }));
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
        reject(Object.assign(new Error('Requête trop volumineuse'), { status: 413 }));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {});
      } catch {
        reject(Object.assign(new Error('JSON invalide'), { status: 400 }));
      }
    });
  });
}
const publicUser = (u) => ({ id: u.id, email: u.email, name: u.name });
const validProject = (p) => p && p.version === 1 && Array.isArray(p.modules) && p.site && typeof p.name === 'string';

async function api(store, req, res, path) {
  if (path === '/api/health') return send(res, 200, { ok: true, storage: store.kind });
  if (req.method === 'POST' && path === '/api/auth/register') {
    const { email, password, name } = await readBody(req);
    const e = String(email ?? '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return send(res, 400, { error: 'Adresse e-mail invalide.' });
    if (String(password ?? '').length < 8) return send(res, 400, { error: 'Le mot de passe doit faire au moins 8 caractères.' });
    if (await store.userByEmail(e)) return send(res, 409, { error: 'Un compte existe déjà avec cette adresse.' });
    const u = await store.createUser(e, String(name ?? '').trim().slice(0, 80) || e.split('@')[0], await hashPassword(String(password)));
    return send(res, 201, { token: makeToken(u.id), user: publicUser(u) });
  }
  if (req.method === 'POST' && path === '/api/auth/login') {
    const { email, password } = await readBody(req);
    const u = await store.userByEmail(String(email ?? '').trim().toLowerCase());
    if (!u || !(await checkPassword(String(password ?? ''), u.pass))) return send(res, 401, { error: 'E-mail ou mot de passe incorrect.' });
    return send(res, 200, { token: makeToken(u.id), user: publicUser(u) });
  }
  const uid = readToken(req);
  if (!uid) return send(res, 401, { error: 'Connexion requise.' });
  const user = await store.userById(uid);
  if (!user) return send(res, 401, { error: 'Compte introuvable.' });
  if (req.method === 'GET' && path === '/api/me') return send(res, 200, { user: publicUser(user) });
  if (req.method === 'GET' && path === '/api/parks') return send(res, 200, { parks: await store.listParks(uid) });
  if (req.method === 'POST' && path === '/api/parks') {
    const { project } = await readBody(req);
    if (!validProject(project)) return send(res, 400, { error: 'Projet invalide.' });
    return send(res, 201, { park: await store.savePark(uid, null, project.name.slice(0, 120), project) });
  }
  const m = path.match(/^\/api\/parks\/(\d+)$/);
  if (m) {
    const pid = Number(m[1]);
    if (req.method === 'GET') {
      const p = await store.getPark(uid, pid);
      return p ? send(res, 200, { park: { id: p.id, name: p.name, updated_at: p.updated_at, project: p.data } }) : send(res, 404, { error: 'Parc introuvable.' });
    }
    if (req.method === 'PUT') {
      const { project } = await readBody(req);
      if (!validProject(project)) return send(res, 400, { error: 'Projet invalide.' });
      const p = await store.savePark(uid, pid, project.name.slice(0, 120), project);
      return p ? send(res, 200, { park: p }) : send(res, 404, { error: 'Parc introuvable.' });
    }
    if (req.method === 'DELETE') return (await store.deletePark(uid, pid)) ? send(res, 200, { ok: true }) : send(res, 404, { error: 'Parc introuvable.' });
  }
  return send(res, 404, { error: 'Route inconnue.' });
}

async function serveStatic(req, res, path) {
  let file = normalize(join(DIST, decodeURIComponent(path)));
  if (!file.startsWith(DIST)) return send(res, 403, { error: 'Interdit' });
  try {
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
  } catch {
    file = join(DIST, 'index.html'); // application monopage
  }
  try {
    const body = await readFile(file);
    const immutable = file.includes(`${join(DIST, 'assets')}`);
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream', 'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('Introuvable');
  }
}

const store = process.env.DATABASE_URL ? await pgStore(process.env.DATABASE_URL) : fileStore();
await store.init();

createServer(async (req, res) => {
  const path = new URL(req.url ?? '/', 'http://x').pathname;
  try {
    if (path.startsWith('/api/')) return await api(store, req, res, path);
    return await serveStatic(req, res, path);
  } catch (e) {
    console.error(e);
    send(res, e.status ?? 500, { error: e.status ? e.message : 'Erreur serveur.' });
  }
}).listen(PORT, () => console.log(`Parkcraft sur http://localhost:${PORT} (stockage : ${store.kind})`));
