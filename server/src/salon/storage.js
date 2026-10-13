import { pool } from '../db.js';
import { makeSeed, makeTemplate, makeDemo, DEMO_STAFF_PHONE } from '../salon-seed.js';
import * as engine from '../salon-engine.js';
import { DOMAIN, fail, todayStr } from './util.js';
import { hashPassword } from './session.js';

// A tenant's storage is picked per-tenant (tenant.engine, from salon_tenant(), db/170): 'store' (today's
// salon_store JSON documents, the only path every existing salon tenant uses) or 'generic' (the shared
// records/bookings tables, RLS-protected, the same engine every other product already runs on). Nothing
// about request handling, routes, auth or the frontend contract below ever branches on this -- only the
// handful of storage functions in this section do, so the swap is invisible to everything else in this file.
export const usesGeneric = (tenant) => tenant.engine === 'generic';
// ---- tenant from subdomain ----
export async function tenantFor(req) {
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(':')[0].toLowerCase();
  let slug = null;
  if (DOMAIN && host.endsWith('.' + DOMAIN)) slug = host.slice(0, -(DOMAIN.length + 1));
  else if (host === 'localhost' || host === '127.0.0.1') slug = String(req.headers['x-tenant-slug'] || '');
  if (!slug || slug.includes('.')) fail(404, 'Unknown salon.');
  const { rows } = await pool.query('select * from salon_tenant($1)', [slug]);
  if (!rows[0]) fail(404, 'Unknown salon.');
  return rows[0];
}

// ---- storage ----
export async function readKey(client, tid, key, lock) {
  const { rows } = await client.query(`select data from salon_store where tenant_id = $1 and key = $2${lock ? ' for update' : ''}`, [tid, key]);
  return rows[0] ? rows[0].data : null;
}
export async function writeKey(client, tid, key, data) {
  await client.query(
    `insert into salon_store (tenant_id, key, data) values ($1, $2, $3)
     on conflict (tenant_id, key) do update set data = excluded.data, updated_at = now()`,
    [tid, key, JSON.stringify(data)],
  );
}
// What a salon starts as. Showoff Salon (the first client) keeps its real
// menu and copy; the demo salon gets sample activity; everyone else gets the
// neutral template (same design, placeholder logo/menu/copy to replace).
export function freshDb(tenant) {
  if (tenant.slug === 'showoffsalon') return makeSeed();
  if (tenant.is_demo) { const d = makeDemo(todayStr()); d.seededAt = Date.now(); return d; }
  return makeTemplate(tenant.name);
}

// ---- storage layout ----
// A salon's document is stored in TWO rows so the public website never has to
// touch (or rewrite) the private, fast-growing part:
//   key 'site' = settings, menu, content, stylists, gallery   (small, public)
//   key 'data' = bookings, invoices, expenses, counters       (grows every day)
// `loadDb()` / `mutate()` still hand handlers the familiar combined object, so
// the endpoint code below is unchanged. Older salons were one 'db' row: it is
// split on first use (initStorage) and kept as 'db_backup'.
const DATA_FIELDS = ['bookings', 'invoices', 'expenses', 'counters'];
function splitDb(db) {
  const site = {}, data = {};
  for (const [k, v] of Object.entries(db || {})) (DATA_FIELDS.includes(k) ? data : site)[k] = v;
  return { site, data };
}

// In-memory caches (this API runs as a single process; every write below goes
// through this process and clears the affected entry, so they are never stale
// after an edit; the TTL only bounds how long an edit made some other way,
// e.g. by hand in SQL, can take to show).
const SITE_TTL = 30_000, SLOT_TTL = 30_000, CACHE_MAX = 500;
const siteCache = new Map(), slotCache = new Map();
function cacheSet(map, tid, v) { if (map.size >= CACHE_MAX) map.clear(); map.set(tid, { v, at: Date.now() }); }
const cacheGet = (map, tid, ttl) => { const h = map.get(tid); return h && Date.now() - h.at < ttl ? h.v : null; };
// A write bumps the salon's generation; a read that started before the write finished
// will not be cached (it may hold pre-write data).
const gens = new Map();
const genOf = (tid) => gens.get(tid) || 0;
const dropCaches = (tid) => { gens.set(tid, genOf(tid) + 1); siteCache.delete(tid); slotCache.delete(tid); };
// When many requests miss the cache at the same instant (right after an edit), only
// the first one reads the database; the rest wait for that same answer.
const inflight = new Map();
function once(key, fn) {
  let p = inflight.get(key);
  if (!p) { p = fn().finally(() => inflight.delete(key)); inflight.set(key, p); }
  return p;
}

const DEMO_PASSWORD = 'Auzslab@Demo'; // same public demo password as demo-cafe / demo-retail (db/025)
const DEMO_TTL = 12 * 3600 * 1000;
// The public demo salon puts itself back to a clean, populated state every
// 12 hours (and recreates its sample staff login + payroll employee).
export async function reseedDemo(tenant) {
  const { site, data } = splitDb(freshDb(tenant));
  const eid = (await pool.query('select salon_hr_ensure($1, $2, $3, $4) as id', [tenant.id, 'Priya', DEMO_STAFF_PHONE, 'Senior hair stylist'])).rows[0].id;
  const client = await pool.connect();
  try {
    await client.query('begin');
    await writeKey(client, tenant.id, 'site', site);
    await writeKey(client, tenant.id, 'data', data);
    await writeKey(client, tenant.id, 'staff', { list: [{ id: '00000000-0000-4000-8000-000000000001', name: 'Priya', phone: DEMO_STAFF_PHONE, designation: 'Senior hair stylist',
      passwordHash: hashPassword(DEMO_PASSWORD), active: true, employeeId: eid, createdAt: new Date().toISOString() }] });
    await writeKey(client, tenant.id, 'admin', {});
    await client.query('commit');
  } catch (e) { await client.query('rollback').catch(() => {}); throw e; } finally { client.release(); }
  dropCaches(tenant.id);
  return { site, data };
}

// First use of a salon's storage: split a legacy single 'db' row, or create a
// brand-new salon from its template. Serialised per salon with an advisory lock
// so two first requests can't both initialise it.
async function initStorage(tenant) {
  const tid = tenant.id, client = await pool.connect();
  try {
    await client.query('begin');
    await client.query('select pg_advisory_xact_lock(hashtext($1))', ['salon-init:' + tid]);
    let site = await readKey(client, tid, 'site');
    if (!site) {
      const legacy = await readKey(client, tid, 'db');
      const parts = splitDb(legacy || freshDb(tenant));
      site = parts.site;
      await writeKey(client, tid, 'site', parts.site);
      await writeKey(client, tid, 'data', parts.data);
      if (legacy) {
        await writeKey(client, tid, 'db_backup', legacy);
        await client.query("delete from salon_store where tenant_id = $1 and key = 'db'", [tid]);
      }
    }
    await client.query('commit');
    return site;
  } catch (e) { await client.query('rollback').catch(() => {}); throw e; } finally { client.release(); }
}

// The public half (cached). Everything the website, menu page and booking form need.
export async function loadSite(tenant) {
  const hit = cacheGet(siteCache, tenant.id, SITE_TTL);
  return hit || once('site:' + tenant.id, () => loadSiteUncached(tenant));
}
async function loadSiteUncached(tenant) {
  const tid = tenant.id, g = genOf(tid);
  let site;
  if (usesGeneric(tenant)) {
    await engine.initGenericStorage(pool, tenant, freshDb(tenant));
    const db = await engine.withSalonAuth(pool, tid, (c) => engine.assembleDb(c, tid, false));
    site = { settings: db.settings, content: db.content, menu: db.menu, stylists: db.stylists, gallery: db.gallery };
  } else {
    site = await readKey(pool, tid, 'site');
    if (!site) site = await initStorage(tenant);
    if (tenant.is_demo && (!site.seededAt || Date.now() - site.seededAt > DEMO_TTL)) site = (await reseedDemo(tenant)).site;
  }
  if (genOf(tid) === g) cacheSet(siteCache, tid, site);
  return site;
}
// Everything, as one object (admin screens, export). Not cached.
export async function loadDb(tenant) {
  if (usesGeneric(tenant)) return engine.withSalonAuth(pool, tenant.id, (c) => engine.assembleDb(c, tenant.id, false));
  const site = await loadSite(tenant);
  const data = (await readKey(pool, tenant.id, 'data')) || {};
  return { ...site, ...data };
}
// Booked-slot counts per date and time, for the public slot picker (cached, so
// a busy booking page does not re-read the salon's whole bookings list).
export async function bookingCounts(tenant) {
  const hit = cacheGet(slotCache, tenant.id, SLOT_TTL);
  return hit || once('slots:' + tenant.id, () => bookingCountsUncached(tenant));
}
async function bookingCountsUncached(tenant) {
  const tid = tenant.id;
  await loadSite(tenant); // make sure storage exists
  const g = genOf(tid);
  const bookings = usesGeneric(tenant) ? (await engine.withSalonAuth(pool, tid, (c) => engine.assembleDb(c, tid, false))).bookings : ((await readKey(pool, tid, 'data')) || {}).bookings || [];
  const from = new Date(Date.now() - 2 * 864e5).toISOString().slice(0, 10), counts = {};
  for (const b of bookings) {
    if (b.status === 'cancelled' || b.date < from) continue;
    ((counts[b.date] = counts[b.date] || {})[b.time] = (counts[b.date][b.time] || 0) + 1);
  }
  if (genOf(tid) === g) cacheSet(slotCache, tid, counts);
  return counts;
}

// staff list / admin console password+lockout: the same per-tenant engine switch as everything above,
// using the tenant object (not just tid) since usesGeneric() needs it. Every call site below passes
// `tenant`, matching mutate()'s own convention, so the branch is consistent across this whole file.
export async function readStaffAdmin(tenant, key) {
  if (usesGeneric(tenant)) return engine.readEngineKey(pool, tenant.id, key);
  return readKey(pool, tenant.id, key);
}
export async function mutateStaffAdmin(tenant, key, fn, init) {
  if (usesGeneric(tenant)) return engine.mutateEngineKey(pool, tenant.id, key, fn, init);
  return mutateKey(tenant.id, key, fn, init);
}
export async function writeStaffAdmin(tenant, key, data) {
  if (usesGeneric(tenant)) return engine.mutateEngineKey(pool, tenant.id, key, (d) => { for (const k of Object.keys(d)) delete d[k]; Object.assign(d, data); }, {});
  return writeKey(pool, tenant.id, key, data);
}
// Same, for any other salon_store key (staff list, admin record): row-locked
// read-modify-write, creating the row from `init` if it doesn't exist yet.
async function mutateKey(tid, key, fn, init) {
  await pool.query('insert into salon_store (tenant_id, key, data) values ($1, $2, $3) on conflict do nothing', [tid, key, JSON.stringify(init)]);
  const client = await pool.connect();
  try {
    await client.query('begin');
    const d = await readKey(client, tid, key, true);
    const out = await fn(d);
    await writeKey(client, tid, key, d);
    await client.query('commit');
    return out;
  } catch (e) {
    await client.query('rollback').catch(() => {});
    throw e;
  } finally { client.release(); }
}
// Read-modify-write under row locks. `parts` = which halves the handler needs
// to see ('site', 'data'); `write` = which halves it may change (only those are
// locked and saved, so a booking never rewrites the website half and a menu edit
// never rewrites the bookings). Locks are always taken site-then-data. fn gets
// the combined object; it may return {replace, value} to swap the whole document.
export async function mutate(tenant, fn, parts = ['site', 'data'], write = parts) {
  await loadSite(tenant);
  const tid = tenant.id, client = await pool.connect();
  try {
    await client.query('begin');
    if (usesGeneric(tenant)) {
      await engine.authorize(client, tid);
      // Row-locked by assembleDb's own `for update` on every row it reads -- same "lock everything the
      // handler might touch, for the duration of the transaction" guarantee the old site/data row locks gave,
      // just at the level of the real rows underneath instead of two JSON blobs.
      const before = await engine.assembleDb(client, tid, true);
      const db = JSON.parse(JSON.stringify(before));
      const out = await fn(db);
      const after = out && out.replace ? out.replace : db;
      await engine.persistDb(client, tid, before, after);
      await client.query('commit');
      dropCaches(tid);
      return out && out.replace ? out.value : out;
    }
    const db = {};
    for (const part of ['site', 'data']) {
      if (parts.includes(part) || write.includes(part)) Object.assign(db, (await readKey(client, tid, part, write.includes(part))) || {});
    }
    const out = await fn(db);
    const next = out && out.replace ? out.replace : db;
    const { site, data } = splitDb(next);
    if (write.includes('site')) await writeKey(client, tid, 'site', site);
    if (write.includes('data')) await writeKey(client, tid, 'data', data);
    await client.query('commit');
    dropCaches(tid);
    return out && out.replace ? out.value : out;
  } catch (e) {
    await client.query('rollback').catch(() => {});
    throw e;
  } finally { client.release(); }
}

// Payroll is an add-on: staff clock-ins only flow to AUZslab Payroll for a
// salon that has it (entitled, and not switched off by the owner).
export async function payrollOn(tid) {
  const f = (await pool.query('select salon_features($1) as f', [tid])).rows[0].f || {};
  return (f.features || {}).payroll === true && (f.enabled || {}).payroll !== false;
}
