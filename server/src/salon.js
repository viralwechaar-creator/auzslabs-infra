import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { pool, withAuth } from './db.js';
import { makeSeed, makeTemplate, makeDemo, DEMO_STAFF_PHONE } from './salon-seed.js';
import { captureError } from './errors.js';
import { staffLogin } from './auth.js';

// Salon Suite API: the original Showoff Salon /api/* surface (see the
// app/public/salon/ front-end, a verbatim port), multi-tenant. The
// tenant is resolved from the request's Host subdomain, never from
// client input. State is one JSON document per tenant in salon_store
// (db/053); every mutation runs under a row lock so concurrent admin
// writes no longer race like they did on Vercel Blob.

const DOMAIN = process.env.DOMAIN || '';
const SECRET = process.env.JWT_SECRET;
const UPLOAD_ROOT = process.env.UPLOAD_ROOT || '/data/uploads';
const TZ = 'Asia/Kolkata';

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, message) => { throw new HttpError(status, message); };

// ---- tenant from subdomain ----
async function tenantFor(req) {
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
async function readKey(client, tid, key, lock) {
  const { rows } = await client.query(`select data from salon_store where tenant_id = $1 and key = $2${lock ? ' for update' : ''}`, [tid, key]);
  return rows[0] ? rows[0].data : null;
}
async function writeKey(client, tid, key, data) {
  await client.query(
    `insert into salon_store (tenant_id, key, data) values ($1, $2, $3)
     on conflict (tenant_id, key) do update set data = excluded.data, updated_at = now()`,
    [tid, key, JSON.stringify(data)],
  );
}
// What a salon starts as. Showoff Salon (the first client) keeps its real
// menu and copy; the demo salon gets sample activity; everyone else gets the
// neutral template (same design, placeholder logo/menu/copy to replace).
function freshDb(tenant) {
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
async function reseedDemo(tenant) {
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
async function loadSite(tenant) {
  const hit = cacheGet(siteCache, tenant.id, SITE_TTL);
  return hit || once('site:' + tenant.id, () => loadSiteUncached(tenant));
}
async function loadSiteUncached(tenant) {
  const tid = tenant.id, g = genOf(tid);
  let site = await readKey(pool, tid, 'site');
  if (!site) site = await initStorage(tenant);
  if (tenant.is_demo && (!site.seededAt || Date.now() - site.seededAt > DEMO_TTL)) site = (await reseedDemo(tenant)).site;
  if (genOf(tid) === g) cacheSet(siteCache, tid, site);
  return site;
}
// Everything, as one object (admin screens, export). Not cached.
async function loadDb(tenant) {
  const site = await loadSite(tenant);
  const data = (await readKey(pool, tenant.id, 'data')) || {};
  return { ...site, ...data };
}
// Booked-slot counts per date and time, for the public slot picker (cached, so
// a busy booking page does not re-read the salon's whole bookings list).
async function bookingCounts(tenant) {
  const hit = cacheGet(slotCache, tenant.id, SLOT_TTL);
  return hit || once('slots:' + tenant.id, () => bookingCountsUncached(tenant));
}
async function bookingCountsUncached(tenant) {
  const tid = tenant.id;
  await loadSite(tenant); // make sure storage exists
  const g = genOf(tid);
  const data = (await readKey(pool, tid, 'data')) || {};
  const from = new Date(Date.now() - 2 * 864e5).toISOString().slice(0, 10), counts = {};
  for (const b of data.bookings || []) {
    if (b.status === 'cancelled' || b.date < from) continue;
    ((counts[b.date] = counts[b.date] || {})[b.time] = (counts[b.date][b.time] || 0) + 1);
  }
  if (genOf(tid) === g) cacheSet(slotCache, tid, counts);
  return counts;
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
async function mutate(tenant, fn, parts = ['site', 'data'], write = parts) {
  await loadSite(tenant);
  const tid = tenant.id, client = await pool.connect();
  try {
    await client.query('begin');
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
async function payrollOn(tid) {
  const f = (await pool.query('select salon_features($1) as f', [tid])).rows[0].f || {};
  return (f.features || {}).payroll === true && (f.enabled || {}).payroll !== false;
}

// ---- admin password + session ----
const hashPassword = (pw) => { const salt = crypto.randomBytes(16).toString('hex'); return `scrypt$${salt}$${crypto.scryptSync(pw, salt, 64).toString('hex')}`; };
function verifyScrypt(pw, stored) {
  const [, salt, hash] = String(stored).split('$');
  if (!salt || !hash) return false;
  const a = Buffer.from(crypto.scryptSync(pw, salt, 64).toString('hex'), 'hex');
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
// Until the owner sets a console-specific password (Settings -> Change
// password), the console accepts the tenant owner's normal AUZslab login
// password -- so a newly provisioned salon has a working admin login with
// nothing extra to set up or share.
async function ownerPasswordOk(tid, pw) {
  const { rows } = await pool.query('select salon_owner_hashes($1) as h', [tid]);
  for (const r of rows) if (await bcrypt.compare(pw, r.h)) return true;
  return false;
}
const sign = (v) => crypto.createHmac('sha256', SECRET).update(v).digest('base64url');
// Session payload carries the role: 'owner' (full console) or 'staff'
// (Today / Bookings / Billing / Clients only -- enforced per endpoint
// below, never just hidden in the UI). sid/name identify the staff member.
function setSession(res, tid, who = { role: 'owner' }) {
  const payload = Buffer.from(JSON.stringify({ tid, role: who.role, sid: who.sid || null, name: who.name || null, exp: Date.now() + 7 * 864e5 })).toString('base64url');
  res.setHeader('Set-Cookie', `salon_session=${payload}.${sign(payload)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800`);
}
const clearSession = (res) => res.setHeader('Set-Cookie', 'salon_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0');
function getSession(req, tid) {
  const m = String(req.headers.cookie || '').match(/(?:^|;\s*)salon_session=([^;]+)/);
  if (!m) return null;
  const [payload, sig] = m[1].split('.');
  if (!payload || !sig) return null;
  const exp = sign(payload);
  if (sig.length !== exp.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(exp))) return null;
  try {
    const d = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (d.tid !== tid || Date.now() >= d.exp) return null;
    return { role: d.role === 'staff' ? 'staff' : 'owner', sid: d.sid || null, name: d.name || null };
  } catch { return null; }
}

// ---- helpers (unchanged from the original app) ----
const todayStr = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
const cleanPhone = (v) => String(v || '').replace(/[^\d+]/g, '').slice(0, 20);
const cleanString = (v, max = 200) => String(v || '').trim().slice(0, max);
const validDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v);
const validTime = (v) => /^\d{2}:\d{2}$/.test(v);
const round2 = (n) => Math.round(n * 100) / 100;
const staffPhone = (v) => String(v || '').replace(/\D/g, '').slice(-10);
const EXPENSE_CATEGORIES = ['rent', 'salary', 'bills', 'purchase', 'other'];

function publicSite(db) {
  return {
    settings: db.settings, menu: db.menu, content: db.content,
    stylists: (db.stylists || []).filter((s) => s.visible && s.name !== 'Add name'),
    gallery: (db.gallery || []).filter((g) => g.visible),
    today: todayStr(),
  };
}

function computeSlots(site, counts, date) {
  const S = site.settings;
  if (!validDate(date)) fail(400, 'Invalid date.');
  const day = new Date(date + 'T00:00:00Z').getUTCDay();
  if ((S.closedDays || []).includes(day)) return { closed: true, reason: 'Closed that day.', slots: [] };
  const [oh, om] = S.open.split(':').map(Number);
  const [ch, cm] = S.close.split(':').map(Number);
  const step = S.slotMinutes || 30;
  const capacity = S.capacity || 1;
  const booked = counts[date] || {};
  const slots = [];
  for (let m = oh * 60 + om; m < ch * 60 + cm; m += step) {
    const time = String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
    slots.push({ time, free: (booked[time] || 0) < capacity });
  }
  return { closed: false, slots };
}

function addBooking(db, body, isAdminBooking) {
  if (cleanString(body.website, 200)) fail(400, 'Could not submit the booking.'); // honeypot
  const name = cleanString(body.name, 100);
  const phone = cleanPhone(body.phone);
  const email = cleanString(body.email, 120);
  const date = cleanString(body.date, 10);
  const time = cleanString(body.time, 5);
  const note = cleanString(body.note, 300);
  const ids = Array.isArray(body.services) ? body.services.map((x) => cleanString(x, 100)).filter(Boolean) : [];
  if (!name) fail(400, 'Name is required.');
  if (!phone) fail(400, 'Phone number is required.');
  if (!validDate(date)) fail(400, 'Invalid date.');
  if (!validTime(time)) fail(400, 'Invalid time.');
  if (!ids.length) fail(400, 'Choose at least one service.');
  db.bookings = db.bookings || [];
  if (db.bookings.some((x) => x.phone === phone && x.date === date && x.time === time && x.status !== 'cancelled'))
    fail(409, 'A booking already exists for this phone number at that time.');
  // The slot picker hides full times, but a direct request must not be able to overbook one.
  if (!isAdminBooking) {
    const cap = (db.settings && db.settings.capacity) || 1;
    const taken = db.bookings.filter((x) => x.date === date && x.time === time && x.status !== 'cancelled').length;
    if (taken >= cap) fail(409, 'That time was just taken. Please pick another slot.');
  }
  const all = (db.menu || []).flatMap((c) => c.items || []);
  const services = ids.map((id) => all.find((i) => String(i.id) === id)).filter(Boolean).map((i) => ({ id: i.id, name: i.name, price: i.price }));
  if (!services.length) fail(400, 'Selected services were not found.');
  const id = crypto.randomUUID();
  const rec = {
    id, ref: id.replace(/-/g, '').slice(0, 8).toUpperCase(), name, phone, email, date, time, note, services,
    price: services.reduce((s, x) => s + (Number(x.price) || 0), 0),
    status: isAdminBooking ? 'confirmed' : 'pending', createdAt: new Date().toISOString(),
  };
  db.bookings.push(rec);
  return rec;
}

function clientsList(db) {
  const map = new Map();
  const get = (phone, name, email) => {
    if (!phone) return null;
    if (!map.has(phone)) map.set(phone, { phone, name, email: email || '', bookings: 0, visits: 0, billed: 0, last: '' });
    const c = map.get(phone);
    if (name) c.name = name;
    if (email && !c.email) c.email = email;
    return c;
  };
  (db.bookings || []).forEach((b) => { const c = get(b.phone, b.name, b.email); if (c) { c.bookings++; c.last = c.last > b.date ? c.last : b.date; } });
  (db.invoices || []).filter((i) => !i.void).forEach((i) => {
    const c = get(i.client.phone, i.client.name, i.client.email);
    if (c) { c.visits++; c.billed = round2(c.billed + i.total); c.last = c.last > i.date ? c.last : i.date; }
  });
  return [...map.values()].sort((a, b) => (b.last || '').localeCompare(a.last || ''));
}

function addInvoice(db, body, who) {
  const client = body.client || {};
  const name = cleanString(client.name, 80);
  if (name.length < 2) fail(400, 'Enter the client name.');
  const phone = client.phone ? cleanPhone(client.phone) : '';
  if (client.phone && !phone) fail(400, 'Enter a valid phone number.');
  const items = (Array.isArray(body.items) ? body.items : []).slice(0, 40).map((i) => ({
    name: cleanString(i.name, 120),
    qty: Math.max(1, Math.min(99, Math.round(Number(i.qty) || 1))),
    price: round2(Number(i.price) || 0),
  })).filter((i) => i.name);
  if (!items.length) fail(400, 'Add at least one service.');
  const subtotal = round2(items.reduce((s, i) => s + i.qty * i.price, 0));
  const dType = body.discount && body.discount.type === 'percent' ? 'percent' : 'flat';
  const dVal = Math.max(0, Math.min(dType === 'percent' ? 100 : 1e6, Number(body.discount && body.discount.value) || 0));
  const dAmt = Math.min(subtotal, dType === 'percent' ? round2(subtotal * dVal / 100) : round2(dVal));
  db.invoices = db.invoices || [];
  db.counters = db.counters || { booking: 0, invoice: 0 };
  let token;
  do { token = crypto.randomBytes(4).toString('hex'); } while (db.invoices.some((x) => x.token === token));
  const prefix = cleanString(db.settings.invoicePrefix, 6) || 'SS-';
  const inv = {
    id: crypto.randomUUID(), token, no: prefix + String(++db.counters.invoice).padStart(4, '0'),
    date: validDate(body.date) ? cleanString(body.date, 10) : todayStr(),
    client: { name, phone, email: cleanString(client.email, 120) },
    items, subtotal, discount: { type: dType, value: dVal }, discountAmt: dAmt, total: round2(subtotal - dAmt),
    servedBy: cleanString(body.servedBy, 80) || (who && who.role === 'staff' ? who.name || '' : ''),
    createdBy: who && who.role === 'staff' ? { id: who.sid, name: who.name } : { id: 'owner', name: 'Owner' },
    note: cleanString(body.note, 300), bookingId: cleanString(body.bookingId, 40),
    void: false, createdAt: new Date().toISOString(),
  };
  db.invoices.push(inv);
  const lb = (db.bookings || []).find((b) => b.id === inv.bookingId);
  if (lb) lb.status = 'completed';
  return inv;
}

function addExpense(db, body) {
  const amount = round2(Number(body.amount) || 0);
  if (amount <= 0) fail(400, 'Enter an amount greater than zero.');
  db.expenses = db.expenses || [];
  const exp = {
    id: crypto.randomUUID(), date: validDate(body.date) ? cleanString(body.date, 10) : todayStr(),
    category: EXPENSE_CATEGORIES.includes(body.category) ? body.category : 'other',
    note: cleanString(body.note, 200), amount, createdAt: new Date().toISOString(),
  };
  db.expenses.push(exp);
  return exp;
}

// ---- uploads: stored on the shared uploads volume, served publicly by
// Caddy at /uploads/salon/<slug>/<file> (same volume api.$DOMAIN serves). ----
async function saveUpload(tenant, buf, ext) {
  const name = crypto.randomBytes(8).toString('hex') + '.' + ext;
  const dir = path.join(UPLOAD_ROOT, 'salon', tenant.slug);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, name), buf);
  return `/uploads/salon/${tenant.slug}/${name}`;
}

const rl = new Map();
function limited(key, limit, windowMs) {
  const now = Date.now();
  let b = rl.get(key);
  if (!b || b.resetAt <= now) { b = { count: 0, resetAt: now + windowMs }; rl.set(key, b); }
  return ++b.count > limit;
}
setInterval(() => { const n = Date.now(); for (const [k, b] of rl) if (b.resetAt <= n) rl.delete(k); }, 60_000).unref();

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (c) => { body += c; if (body.length > 15_000_000) { reject(new HttpError(413, 'Request body too large.')); req.destroy(); } });
    req.on('end', () => { try { resolve(body ? JSON.parse(body) : {}); } catch { reject(new HttpError(400, 'Invalid JSON.')); } });
    req.on('error', reject);
  });
}

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

// Entry point: index.js hands over every request whose path starts with
// /salon-api (Caddy rewrites /api/* on tenant subdomains to it).
export async function handleSalon(req, res, ip) {
  try {
    const method = String(req.method || 'GET').toUpperCase();
    const url = new URL(req.url, 'http://x');
    const p = url.pathname.slice('/salon-api'.length) || '/';
    const tenant = await tenantFor(req);
    const tid = tenant.id;
    const body = ['POST', 'PUT', 'PATCH'].includes(method) ? await readBody(req) : {};
    const sess = getSession(req, tid);
    // member(): any signed-in console user (owner or an active staff member).
    // admin(): owner only -- the default for every endpoint below, so a new
    // endpoint is owner-only unless it is explicitly opened to staff.
    const member = async () => {
      if (!sess) fail(401, 'Unauthorized.');
      if (sess.role === 'staff') {
        const st = ((await readKey(pool, tid, 'staff')) || { list: [] }).list.find((x) => x.id === sess.sid);
        if (!st || st.active === false) fail(401, 'Unauthorized.');
      }
      return sess;
    };
    const admin = async () => { const m = await member(); if (m.role !== 'owner') fail(403, 'Only the owner can do that.'); return m; };
    const noDemo = () => { if (tenant.is_demo) fail(403, 'Not available on the demo salon.'); };
    const send = (s, d) => sendJson(res, s, d);

    // Public reads touch only the cached website half; the private bookings/bills are never loaded for them.
    if (method === 'GET' && p === '/site') return send(200, publicSite(await loadSite(tenant)));
    if (method === 'GET' && p === '/slots') return send(200, computeSlots(await loadSite(tenant), await bookingCounts(tenant), String(url.searchParams.get('date') || '')));
    if (method === 'GET' && p === '/admin/me') {
      if (!sess) return send(200, { admin: false });
      if (sess.role === 'staff') {
        const st = ((await readKey(pool, tid, 'staff')) || { list: [] }).list.find((x) => x.id === sess.sid);
        if (!st || st.active === false) return send(200, { admin: false });
        return send(200, { admin: true, role: 'staff', name: st.name, payroll: !!st.employeeId && await payrollOn(tid), demo: !!tenant.is_demo });
      }
      return send(200, { admin: true, role: 'owner', name: 'Owner', demo: !!tenant.is_demo });
    }

    const inv = p.match(/^\/invoice\/([a-f0-9]{8,32})$/);
    if (method === 'GET' && inv) {
      const s = (await loadSite(tenant)).settings;
      const invoice = (((await readKey(pool, tid, 'data')) || {}).invoices || []).find((x) => x.token === inv[1] && !x.void);
      if (!invoice) fail(404, 'Invoice not found.');
      return send(200, { invoice, salon: { salonName: s.salonName, address: s.address, phone: s.phone, email: s.email, instagram: s.instagram, invoiceFooter: s.invoiceFooter, logo: s.logo, logoLight: s.logoLight, theme: s.theme } });
    }

    if (method === 'POST' && p === '/bookings') {
      if (limited(`book:${tid}:${ip}`, 20, 60 * 60_000)) fail(429, 'Too many requests, please try again later.');
      const booking = await mutate(tenant, (db) => addBooking(db, body, false), ['site', 'data'], ['data']);
      return send(201, { ok: true, booking });
    }

    if (method === 'POST' && p === '/admin/login') {
      if (limited(`salonlogin:${ip}`, 30, 15 * 60_000)) fail(429, 'Too many attempts. Try again later.');
      const password = String(body.password || body.pin || '');
      if (!password) fail(400, 'Password is required.');
      await loadSite(tenant);
      if (body.username) {
        // Staff sign-in with the username + PIN the owner created under Staff in the client dashboard (db/096).
        const r = await staffLogin(body.username, password, { ip, userAgent: req.headers['user-agent'] });
        if (r && r.locked) fail(429, 'Too many wrong PINs. Try again in 15 minutes.');
        if (!r) fail(401, 'Wrong username or PIN.');
        const prof = await withAuth(r.user.id, async (c) => (await c.query('select tenant_id, role, login_off from profiles where id = $1', [r.user.id])).rows[0]);
        if (!prof || prof.tenant_id !== tid || prof.login_off) fail(401, 'Wrong username or PIN.');
        const uname = String(body.username).trim().toLowerCase();
        const um = r.user.user_metadata || {};
        const name = cleanString(um.full_name || um.name || uname.split('.')[0], 80);
        let st;
        const payOn = await payrollOn(tid);
        await mutateKey(tid, 'staff', async (d) => {
          d.list = d.list || [];
          st = d.list.find((x) => x.userId === r.user.id);
          if (!st) { st = { id: crypto.randomUUID(), userId: r.user.id, name, phone: '', designation: prof.role === 'manager' ? 'Manager' : 'Staff', active: true, employeeId: null, createdAt: new Date().toISOString() }; d.list.push(st); }
          else if (st.active === false) { st = null; return; }
          // Payroll add-on on: link this person to a payroll employee once, so they can clock in (owner sets salary in Payroll).
          if (payOn && !st.employeeId) st.employeeId = (await pool.query('select salon_hr_ensure($1, $2, $3, $4) as id', [tid, st.name, '', st.designation])).rows[0].id;
        }, { list: [] });
        if (!st) fail(401, 'This login is turned off.');
        setSession(res, tid, { role: 'staff', sid: st.id, name: st.name });
        return send(200, { ok: true, role: 'staff' });
      }
      if (body.phone) {
        // Staff sign-in: phone number + the password the owner set for them.
        const phone = staffPhone(body.phone);
        if (phone.length < 6 || limited(`stafflogin:${tid}:${phone}`, 8, 15 * 60_000)) fail(429, 'Too many attempts. Try again later.');
        const st = ((await readKey(pool, tid, 'staff')) || { list: [] }).list.find((x) => x.phone === phone && x.active !== false);
        if (!st || !st.passwordHash || !verifyScrypt(password, st.passwordHash)) fail(401, 'Invalid phone number or password.');
        setSession(res, tid, { role: 'staff', sid: st.id, name: st.name });
        return send(200, { ok: true, role: 'staff' });
      }
      const result = await (async () => {
        const client = await pool.connect();
        try {
          await client.query('begin');
          const a = (await readKey(client, tid, 'admin', true)) || {};
          if (a.lockedUntil && Date.now() < a.lockedUntil) {
            await client.query('commit');
            const mins = Math.ceil((a.lockedUntil - Date.now()) / 60000);
            return { status: 429, error: `Too many attempts. Try again in ${mins} minute${mins === 1 ? '' : 's'}.` };
          }
          const ok = a.passwordHash ? verifyScrypt(password, a.passwordHash) : await ownerPasswordOk(tid, password);
          if (!ok) {
            a.failCount = (a.failCount || 0) + 1;
            if (a.failCount >= 8) { a.lockedUntil = Date.now() + 15 * 60_000; a.failCount = 0; }
            await writeKey(client, tid, 'admin', a);
            await client.query('commit');
            return { status: 401, error: 'Invalid password.' };
          }
          a.failCount = 0; a.lockedUntil = 0;
          await writeKey(client, tid, 'admin', a);
          await client.query('commit');
          return { status: 200 };
        } catch (e) { await client.query('rollback').catch(() => {}); throw e; } finally { client.release(); }
      })();
      if (result.status !== 200) fail(result.status, result.error);
      setSession(res, tid);
      return send(200, { ok: true, role: 'owner' });
    }
    if (method === 'POST' && p === '/admin/logout') { clearSession(res); return send(200, { ok: true }); }

    // ---- everything below needs the console session ----
    if (method === 'GET' && p === '/bookings') { await member(); return send(200, { bookings: (await loadDb(tenant)).bookings || [] }); }

    if (method === 'GET' && p === '/admin/data') {
      const me = await member();
      const db = await loadDb(tenant);
      if (me.role === 'staff') {
        // Staff get what Today / Bookings / Billing / Clients need and nothing
        // else: no expenses, website text, gallery, or other people's bills
        // (so no revenue totals either).
        const mine = (db.invoices || []).filter((i) => i.createdBy && i.createdBy.id === me.sid);
        const { bgMusic, ...settings } = db.settings;
        return send(200, {
          settings, menu: db.menu, content: {}, gallery: [], expenses: [],
          stylists: (db.stylists || []).filter((x) => x.visible && x.name !== 'Add name').map((x) => ({ id: x.id, name: x.name, role: x.role })),
          bookings: db.bookings || [], invoices: mine, clients: clientsList({ bookings: db.bookings, invoices: mine }), today: todayStr(),
        });
      }
      return send(200, {
        settings: db.settings, menu: db.menu, content: db.content, stylists: db.stylists || [], gallery: db.gallery || [],
        bookings: db.bookings || [], invoices: db.invoices || [], expenses: db.expenses || [], clients: clientsList(db), today: todayStr(),
      });
    }

    const put = p.match(/^\/admin\/(settings|menu|content|stylists|gallery)$/);
    if (method === 'PUT' && put) {
      await admin();
      const k = put[1];
      const isArr = Array.isArray(body);
      if (['menu', 'stylists', 'gallery'].includes(k) && !isArr) fail(400, `${k[0].toUpperCase() + k.slice(1)} must be an array.`);
      if (k === 'content' && (!body || typeof body !== 'object' || isArr)) fail(400, 'Content must be an object.');
      await mutate(tenant, (db) => { db[k] = body; }, ['site']);
      return send(200, { ok: true });
    }

    const bk = p.match(/^\/admin\/bookings\/(.+)$/);
    if (method === 'PATCH' && bk) {
      await member();
      const id = decodeURIComponent(bk[1]);
      const booking = await mutate(tenant, (db) => {
        const b = (db.bookings || []).find((x) => String(x.id) === id);
        if (!b) fail(404, 'Booking not found.');
        if (body.status !== undefined) {
          if (!['pending', 'confirmed', 'completed', 'cancelled'].includes(body.status)) fail(400, 'Invalid booking status.');
          b.status = body.status;
        }
        return b;
      }, ['data']);
      return send(200, { ok: true, booking });
    }
    if (method === 'DELETE' && bk) {
      await admin();
      const id = decodeURIComponent(bk[1]);
      await mutate(tenant, (db) => {
        const before = db.bookings || [];
        db.bookings = before.filter((x) => String(x.id) !== id);
        if (db.bookings.length === before.length) fail(404, 'Booking not found.');
      }, ['data']);
      return send(200, { ok: true });
    }
    if (method === 'POST' && p === '/admin/bookings') { await member(); return send(201, { ok: true, booking: await mutate(tenant, (db) => addBooking(db, body, true), ['site', 'data'], ['data']) }); }

    if (method === 'POST' && p === '/admin/invoices') { const me = await member(); return send(201, { ok: true, invoice: await mutate(tenant, (db) => addInvoice(db, body, me), ['site', 'data'], ['data']) }); }
    const iv = p.match(/^\/admin\/invoices\/(.+)$/);
    if (method === 'DELETE' && iv) {
      await admin();
      const id = decodeURIComponent(iv[1]);
      await mutate(tenant, (db) => {
        const i = (db.invoices || []).find((x) => String(x.id) === id);
        if (!i) fail(404, 'Invoice not found.');
        i.void = true;
      }, ['data']);
      return send(200, { ok: true });
    }

    if (method === 'POST' && p === '/admin/expenses') { await admin(); return send(201, { ok: true, expense: await mutate(tenant, (db) => addExpense(db, body), ['data']) }); }
    const ex = p.match(/^\/admin\/expenses\/(.+)$/);
    if (method === 'PATCH' && ex) {
      await admin();
      const id = decodeURIComponent(ex[1]);
      const expense = await mutate(tenant, (db) => {
        const e = (db.expenses || []).find((x) => String(x.id) === id);
        if (!e) fail(404, 'Expense not found.');
        if (body.date !== undefined && validDate(body.date)) e.date = cleanString(body.date, 10);
        if (body.category !== undefined && EXPENSE_CATEGORIES.includes(body.category)) e.category = body.category;
        if (body.note !== undefined) e.note = cleanString(body.note, 200);
        if (body.amount !== undefined) {
          const a = round2(Number(body.amount) || 0);
          if (a <= 0) fail(400, 'Enter an amount greater than zero.');
          e.amount = a;
        }
        return e;
      }, ['data']);
      return send(200, { ok: true, expense });
    }
    if (method === 'DELETE' && ex) {
      await admin();
      const id = decodeURIComponent(ex[1]);
      await mutate(tenant, (db) => {
        const before = db.expenses || [];
        db.expenses = before.filter((x) => String(x.id) !== id);
        if (db.expenses.length === before.length) fail(404, 'Expense not found.');
      }, ['data']);
      return send(200, { ok: true });
    }

    if (method === 'POST' && p === '/admin/upload') {
      await admin(); noDemo();
      const m = String(body.dataUrl || '').match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/);
      if (!m) fail(400, 'Upload a JPG, PNG or WebP image.');
      const buf = Buffer.from(m[2], 'base64');
      if (buf.length > 4 * 1024 * 1024) fail(413, 'Image is larger than 4 MB.');
      const mg = buf.subarray(0, 12);
      const okMagic = (m[1] === 'jpeg' && mg[0] === 0xff && mg[1] === 0xd8) || (m[1] === 'png' && mg.subarray(1, 4).toString() === 'PNG')
        || (m[1] === 'webp' && mg.subarray(0, 4).toString() === 'RIFF' && mg.subarray(8, 12).toString() === 'WEBP');
      if (!okMagic) fail(400, 'That file is not a valid image.');
      return send(201, { ok: true, src: await saveUpload(tenant, buf, m[1] === 'jpeg' ? 'jpg' : m[1]) });
    }
    if (method === 'POST' && p === '/admin/upload-audio') {
      await admin(); noDemo();
      const m = String(body.dataUrl || '').match(/^data:audio\/mpeg;base64,([A-Za-z0-9+/=]+)$/);
      if (!m) fail(400, 'Upload an MP3 file.');
      const buf = Buffer.from(m[1], 'base64');
      if (buf.length > 8 * 1024 * 1024) fail(413, 'Audio is larger than 8 MB.');
      const mg = buf.subarray(0, 3);
      if (!((mg[0] === 0x49 && mg[1] === 0x44 && mg[2] === 0x33) || (mg[0] === 0xff && (mg[1] & 0xe0) === 0xe0))) fail(400, 'That file is not a valid MP3.');
      return send(201, { ok: true, src: await saveUpload(tenant, buf, 'mp3') });
    }

    if (method === 'POST' && p === '/admin/password') {
      const me = await member();
      noDemo();
      const cur = String(body.current || '');
      const next = String(body.next || '');
      if (me.role === 'staff') {
        // A staff member changes their own password only.
        if (next.length < 6) fail(400, 'New password must be at least 6 characters.');
        await mutateKey(tid, 'staff', (d) => {
          const st = (d.list || []).find((x) => x.id === me.sid);
          if (!st || !verifyScrypt(cur, st.passwordHash)) fail(400, 'Current password is wrong.');
          st.passwordHash = hashPassword(next);
        }, { list: [] });
        return send(200, { ok: true });
      }
      await loadSite(tenant);
      const a = (await readKey(pool, tid, 'admin')) || {};
      const ok = a.passwordHash ? verifyScrypt(cur, a.passwordHash) : await ownerPasswordOk(tid, cur);
      if (!ok) fail(400, 'Current password is wrong.');
      if (next.length < 8) fail(400, 'New password must be at least 8 characters.');
      await writeKey(pool, tid, 'admin', { passwordHash: hashPassword(next), failCount: 0, lockedUntil: 0 });
      setSession(res, tid);
      return send(200, { ok: true });
    }


    // ---- staff accounts (owner only) ----
    const staffView = (st, invoices) => ({
      id: st.id, name: st.name, phone: st.phone, designation: st.designation || '', active: st.active !== false,
      employeeId: st.employeeId || null, createdAt: st.createdAt,
      bills: (invoices || []).filter((i) => !i.void && i.createdBy && i.createdBy.id === st.id).length,
    });
    if (method === 'GET' && p === '/admin/staff') {
      await admin();
      const db = await loadDb(tenant);
      const d = (await readKey(pool, tid, 'staff')) || { list: [] };
      const pay = await payrollOn(tid);
      return send(200, { payroll: pay, staff: d.list.map((st) => staffView(st, db.invoices)), employees: pay ? (await pool.query('select salon_hr_list($1) as l', [tid])).rows[0].l : [] });
    }
    if (method === 'POST' && p === '/admin/staff') {
      await admin(); noDemo();
      const name = cleanString(body.name, 80);
      const phone = staffPhone(body.phone);
      const password = String(body.password || '');
      if (name.length < 2) fail(400, 'Enter the staff member\'s name.');
      if (phone.length < 6) fail(400, 'Enter a valid phone number.');
      if (password.length < 6) fail(400, 'Password must be at least 6 characters.');
      const designation = cleanString(body.designation, 60) || 'Stylist';
      const pay = await payrollOn(tid);
      let employeeId = pay ? cleanString(body.employeeId, 60) || null : null;
      if (pay && body.payroll !== false && !employeeId) employeeId = (await pool.query('select salon_hr_ensure($1, $2, $3, $4) as id', [tid, name, phone, designation])).rows[0].id;
      const st = { id: crypto.randomUUID(), name, phone, designation, passwordHash: hashPassword(password), active: true, employeeId, createdAt: new Date().toISOString() };
      await mutateKey(tid, 'staff', (d) => {
        if ((d.list || []).some((x) => x.phone === phone)) fail(409, 'A staff member with this phone number already exists.');
        d.list = [...(d.list || []), st];
      }, { list: [] });
      return send(201, { ok: true, staff: staffView(st, []) });
    }
    const sm = p.match(/^\/admin\/staff\/([0-9a-f-]{36})$/);
    if (method === 'PATCH' && sm) {
      await admin(); noDemo();
      // "Link to payroll" (after the Payroll add-on is switched on): create or
      // find the payroll employee for this person.
      let linkId = null;
      if (body.linkPayroll) {
        if (!(await payrollOn(tid))) fail(400, 'Payroll is not on your account yet.');
        const cur = ((await readKey(pool, tid, 'staff')) || { list: [] }).list.find((x) => x.id === sm[1]);
        if (!cur) fail(404, 'Staff member not found.');
        linkId = (await pool.query('select salon_hr_ensure($1, $2, $3, $4) as id', [tid, cur.name, cur.phone, cur.designation])).rows[0].id;
      }
      const out = await mutateKey(tid, 'staff', (d) => {
        const st = (d.list || []).find((x) => x.id === sm[1]);
        if (!st) fail(404, 'Staff member not found.');
        if (body.name !== undefined) st.name = cleanString(body.name, 80) || st.name;
        if (body.designation !== undefined) st.designation = cleanString(body.designation, 60);
        if (body.active !== undefined) st.active = !!body.active;
        if (body.employeeId !== undefined) st.employeeId = cleanString(body.employeeId, 60) || null;
        if (linkId) st.employeeId = linkId;
        if (body.phone !== undefined) {
          const ph = staffPhone(body.phone);
          if (ph.length < 6) fail(400, 'Enter a valid phone number.');
          if (d.list.some((x) => x.phone === ph && x.id !== st.id)) fail(409, 'A staff member with this phone number already exists.');
          st.phone = ph;
        }
        if (body.password) {
          if (String(body.password).length < 6) fail(400, 'Password must be at least 6 characters.');
          st.passwordHash = hashPassword(String(body.password));
        }
        return staffView(st, []);
      }, { list: [] });
      return send(200, { ok: true, staff: out });
    }
    if (method === 'DELETE' && sm) {
      await admin(); noDemo();
      await mutateKey(tid, 'staff', (d) => {
        const before = d.list || [];
        d.list = before.filter((x) => x.id !== sm[1]);
        if (d.list.length === before.length) fail(404, 'Staff member not found.');
      }, { list: [] });
      return send(200, { ok: true });
    }

    // ---- clock in / out: writes the same hr_attendance record AUZslab
    // Payroll reads, for a staff member linked to a payroll employee ----
    if (p === '/admin/punch' && (method === 'GET' || method === 'POST')) {
      const me = await member();
      if (me.role !== 'staff') fail(400, 'Clock in is for staff logins.');
      const st = ((await readKey(pool, tid, 'staff')) || { list: [] }).list.find((x) => x.id === me.sid);
      if (!st.employeeId || !(await payrollOn(tid))) fail(400, 'Your login is not linked to payroll yet. Ask the owner.');
      if (method === 'GET') return send(200, (await pool.query('select salon_punch_state($1, $2, $3) as s', [tid, st.employeeId, todayStr()])).rows[0].s || { open: false, recent: [] });
      const r = await pool.query('select salon_punch($1, $2, $3, $4) as r', [tid, st.employeeId, todayStr(), new Date().toISOString()]);
      return send(200, { ok: true, ...r.rows[0].r });
    }

    if (method === 'GET' && p === '/admin/export') { await admin(); return send(200, await loadDb(tenant)); }
    if (method === 'POST' && p === '/admin/clear-history') {
      await admin();
      await mutate(tenant, (db) => { db.bookings = []; db.invoices = []; db.expenses = []; db.counters = { booking: 0, invoice: 0 }; }, ['data']);
      return send(200, { ok: true });
    }
    if (method === 'POST' && p === '/admin/reset') {
      await admin();
      if (tenant.is_demo) await reseedDemo(tenant);
      else await mutate(tenant, () => ({ replace: freshDb(tenant), value: { ok: true } }));
      return send(200, { ok: true });
    }

    fail(404, 'Not found.');
  } catch (e) {
    const status = Number(e && e.status) || 500;
    // method/p are declared inside the try block above (block-scoped,
    // not visible here) -- re-derive the same minimal context directly
    // from req instead of reaching into that scope.
    if (status >= 500) { console.error(e); captureError(e, { method: req.method, path: req.url }); }
    if (res.headersSent) return res.end();
    sendJson(res, status, { error: status >= 500 ? 'Something went wrong. Please try again.' : String(e.message || 'Request failed.') });
  }
}
