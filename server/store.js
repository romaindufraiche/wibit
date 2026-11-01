// Stockage : PostgreSQL si DATABASE_URL est défini, sinon fichier JSON local (développement).
// Les deux implémentations exposent la même interface.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const USER_FIELDS = ['name', 'company', 'phone', 'role', 'notes', 'followup', 'disabled', 'last_seen', 'pass'];
const PARK_FIELDS = ['name', 'data', 'stats', 'status', 'quote'];
const pick = (o, keys) => Object.fromEntries(Object.entries(o ?? {}).filter(([k, v]) => keys.includes(k) && v !== undefined));
const now = () => new Date().toISOString();
const publicUser = ({ pass, ...u }) => u;
const parkSummary = ({ data, ...p }) => ({ ...p, modules: data?.modules?.length ?? 0 });

export function fileStore(root) {
  const path = join(root, 'data', 'db.json');
  let db = { users: [], parks: [], events: [], settings: {}, seq: {} };
  let timer = null;
  const save = () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, JSON.stringify(db));
    }, 50);
  };
  // une séquence par table
  const id = (table) => (db.seq[table] = (db.seq[table] ?? 0) + 1);
  return {
    kind: 'fichier',
    async init() {
      try {
        db = { ...db, ...JSON.parse(await readFile(path, 'utf8')) };
        if (typeof db.seq !== 'object') db.seq = {};
      } catch {
        /* base vide */
      }
    },
    async createUser(u) {
      const row = { id: id('users'), role: 'user', company: '', phone: '', notes: '', followup: {}, disabled: false, created_at: now(), last_seen: now(), ...u };
      db.users.push(row);
      save();
      return row;
    },
    userByEmail: async (email) => db.users.find((u) => u.email === email) ?? null,
    userById: async (uid) => db.users.find((u) => u.id === uid) ?? null,
    listUsers: async () => db.users.map(publicUser),
    async updateUser(uid, patch) {
      const u = db.users.find((x) => x.id === uid);
      if (!u) return null;
      Object.assign(u, pick(patch, USER_FIELDS));
      save();
      return publicUser(u);
    },
    async deleteUser(uid) {
      db.users = db.users.filter((u) => u.id !== uid);
      db.parks = db.parks.filter((p) => p.user_id !== uid);
      db.events = db.events.filter((e) => e.user_id !== uid);
      save();
    },
    listParks: async (uid) => db.parks.filter((p) => p.user_id === uid).map(parkSummary).sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
    listAllParks: async () => db.parks.map(parkSummary),
    getPark: async (pid) => db.parks.find((p) => p.id === pid) ?? null,
    async createPark(uid, p) {
      const row = { id: id('parks'), user_id: uid, status: 'draft', quote: null, stats: {}, created_at: p.created_at ?? now(), updated_at: p.created_at ?? now(), ...pick(p, PARK_FIELDS) };
      db.parks.push(row);
      save();
      return parkSummary(row);
    },
    async updatePark(pid, patch) {
      const p = db.parks.find((x) => x.id === pid);
      if (!p) return null;
      Object.assign(p, pick(patch, PARK_FIELDS), { updated_at: now() });
      save();
      return parkSummary(p);
    },
    async deletePark(pid) {
      db.parks = db.parks.filter((p) => p.id !== pid);
      save();
    },
    async addEvents(rows) {
      for (const r of rows) db.events.push({ id: id('events'), created_at: now(), ...r });
      // on garde au plus 200 000 événements
      if (db.events.length > 200000) db.events = db.events.slice(-200000);
      save();
    },
    listEvents: async ({ userId, since } = {}) => db.events.filter((e) => (!userId || e.user_id === userId) && (!since || e.created_at >= since)),
    getSetting: async (key) => db.settings[key] ?? null,
    async setSetting(key, value) {
      db.settings[key] = value;
      save();
    },
  };
}

export async function pgStore(url) {
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({ connectionString: url, ssl: url.includes('localhost') ? false : { rejectUnauthorized: false } });
  const q = (text, params) => pool.query(text, params).then((r) => r.rows);
  const iso = (rows) =>
    rows.map((r) => {
      for (const k of ['created_at', 'updated_at', 'last_seen']) if (r[k] instanceof Date) r[k] = r[k].toISOString();
      return r;
    });
  const setClause = (patch, start) => {
    const keys = Object.keys(patch);
    return { sql: keys.map((k, i) => `${k}=$${i + start}`).join(', '), vals: keys.map((k) => (typeof patch[k] === 'object' && patch[k] !== null ? JSON.stringify(patch[k]) : patch[k])) };
  };
  return {
    kind: 'postgres',
    async init() {
      await q(`create table if not exists users (
        id serial primary key, email text unique not null, name text not null, pass text not null,
        created_at timestamptz not null default now())`);
      for (const col of [
        "role text not null default 'user'",
        "company text not null default ''",
        "phone text not null default ''",
        "notes text not null default ''",
        "followup jsonb not null default '{}'",
        'disabled boolean not null default false',
        'last_seen timestamptz default now()',
      ])
        await q(`alter table users add column if not exists ${col}`);
      await q(`create table if not exists parks (
        id serial primary key, user_id integer not null references users(id) on delete cascade,
        name text not null, data jsonb not null, updated_at timestamptz not null default now())`);
      for (const col of ["status text not null default 'draft'", 'quote jsonb', "stats jsonb not null default '{}'", 'created_at timestamptz not null default now()'])
        await q(`alter table parks add column if not exists ${col}`);
      await q('create index if not exists parks_user on parks(user_id)');
      await q(`create table if not exists events (
        id bigserial primary key, user_id integer references users(id) on delete cascade, park_id integer,
        type text not null, data jsonb, created_at timestamptz not null default now())`);
      await q('create index if not exists events_user_time on events(user_id, created_at)');
      await q('create table if not exists settings (key text primary key, value jsonb)');
    },
    createUser: async (u) =>
      iso(
        await q('insert into users(email,name,pass,company,phone,role,created_at) values($1,$2,$3,$4,$5,$6,coalesce($7::timestamptz, now())) returning *', [
          u.email,
          u.name,
          u.pass,
          u.company ?? '',
          u.phone ?? '',
          u.role ?? 'user',
          u.created_at ?? null,
        ]),
      )[0],
    userByEmail: async (email) => iso(await q('select * from users where email=$1', [email]))[0] ?? null,
    userById: async (uid) => iso(await q('select * from users where id=$1', [uid]))[0] ?? null,
    listUsers: async () => iso(await q('select id,email,name,company,phone,role,notes,followup,disabled,created_at,last_seen from users order by created_at desc')),
    async updateUser(uid, patch) {
      const { sql, vals } = setClause(pick(patch, USER_FIELDS), 2);
      if (!sql) return this.userById(uid);
      const r = await q(`update users set ${sql} where id=$1 returning id,email,name,company,phone,role,notes,followup,disabled,created_at,last_seen`, [uid, ...vals]);
      return iso(r)[0] ?? null;
    },
    deleteUser: (uid) => q('delete from users where id=$1', [uid]),
    listParks: async (uid) =>
      iso(await q("select id,user_id,name,status,stats,created_at,updated_at,jsonb_array_length(data->'modules') as modules from parks where user_id=$1 order by updated_at desc", [uid])),
    listAllParks: async () => iso(await q("select id,user_id,name,status,stats,quote,created_at,updated_at,jsonb_array_length(data->'modules') as modules from parks")),
    getPark: async (pid) => iso(await q('select * from parks where id=$1', [pid]))[0] ?? null,
    async createPark(uid, p) {
      const r = await q("insert into parks(user_id,name,data,stats,created_at,updated_at) values($1,$2,$3,$4,coalesce($5::timestamptz, now()),coalesce($5::timestamptz, now())) returning id,user_id,name,status,stats,created_at,updated_at,jsonb_array_length(data->'modules') as modules", [
        uid,
        p.name,
        JSON.stringify(p.data),
        JSON.stringify(p.stats ?? {}),
        p.created_at ?? null,
      ]);
      return iso(r)[0];
    },
    async updatePark(pid, patch) {
      const { sql, vals } = setClause(pick(patch, PARK_FIELDS), 2);
      const r = await q(`update parks set ${sql ? sql + ', ' : ''}updated_at=now() where id=$1 returning id,user_id,name,status,stats,quote,created_at,updated_at,jsonb_array_length(data->'modules') as modules`, [pid, ...vals]);
      return iso(r)[0] ?? null;
    },
    deletePark: (pid) => q('delete from parks where id=$1', [pid]),
    async addEvents(rows) {
      for (const r of rows)
        await q('insert into events(user_id,park_id,type,data,created_at) values($1,$2,$3,$4,coalesce($5::timestamptz, now()))', [r.user_id, r.park_id ?? null, r.type, JSON.stringify(r.data ?? null), r.created_at ?? null]);
    },
    listEvents: async ({ userId, since } = {}) => {
      const cond = [];
      const vals = [];
      if (userId) cond.push(`user_id=$${vals.push(userId)}`);
      if (since) cond.push(`created_at>=$${vals.push(since)}`);
      return iso(await q(`select * from events ${cond.length ? 'where ' + cond.join(' and ') : ''} order by created_at`, vals));
    },
    getSetting: async (key) => (await q('select value from settings where key=$1', [key]))[0]?.value ?? null,
    setSetting: (key, value) => q('insert into settings(key,value) values($1,$2) on conflict (key) do update set value=excluded.value', [key, JSON.stringify(value)]),
  };
}
