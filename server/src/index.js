import http from 'node:http';
import { pool, withAuth } from './db.js';
import { login, verifyToken, bearerFrom, createUser, resetToRandomPassword, signToken } from './auth.js';
import { saveSiteUpload } from './storage.js';
import { startRealtime } from './realtime.js';
import { handlePushEvent } from './push.js';

const PORT = process.env.PORT || 3000;
const DOMAIN = process.env.DOMAIN || '';

// ---- whitelist: the only tables/columns this API will ever touch.
// Mirrors exactly what app/public's client code actually calls (see
// index.html/site.html/i.html) -- not a generic open-ended DB proxy. ----
const TABLES = {
  records: { columns: ['id', 'tenant_id', 'kind', 'data', 'deleted', 'author', 'updated_at'] }, // read-only here; writes go through the push_record RPC (optimistic concurrency)
  profiles: { columns: ['id', 'tenant_id', 'email', 'role', 'role_id', 'name', 'phone'], writable: ['role', 'role_id', 'name', 'phone'] },
  guest_orders: { columns: ['id', 'tenant_id', 'tbl', 'name', 'phone', 'note', 'items', 'status', 'created_at'], writable: ['status'] },
  push_subs: { columns: ['id', 'tenant_id', 'user_id', 'endpoint', 'p256dh', 'auth', 'created_at'], insertable: ['user_id', 'endpoint', 'p256dh', 'auth'] },
  leads: { columns: ['id', 'name', 'business', 'contact', 'message', 'niche', 'status', 'created_at'], writable: ['status'] }, // admin-only via RLS (is_platform_admin())
  signup_requests: { columns: ['id', 'user_id', 'business_name', 'slug', 'features', 'notes', 'contact_name', 'phone', 'niche', 'address', 'status', 'created_at'] }, // read-only here; state changes go through approve/decline_signup_request

  // --- Client dashboard: custom roles + staff, notifications ---
  // roles.tenant_id defaults from the caller's own session (see
  // 013_client_dashboard_roles_notifications.sql), same pattern as
  // bookings.tenant_id -- never insertable/writable directly.
  roles: { columns: ['id', 'tenant_id', 'name', 'permissions', 'created_at'], insertable: ['name', 'permissions'], writable: ['name', 'permissions'] },
  // insert/delete deliberately blocked here -- creation only via
  // the auto-notify triggers or send_client_notification, and the
  // only thing a client/admin can change afterward is read state.
  notifications: { columns: ['id', 'tenant_id', 'type', 'title', 'body', 'link', 'read', 'created_at'], insertable: [], writable: ['read'] },

  // --- Phase 1: Booking & Appointments ---
  // tenant_id is never insertable/writable -- it defaults from the
  // caller's own session (see 008_phase1_...sql), same pattern
  // push_subs.tenant_id already uses. order_id is likewise excluded
  // from both lists: it's only ever set by convert_booking_to_order.
  bookings: {
    columns: ['id', 'tenant_id', 'resource_id', 'customer_name', 'customer_phone', 'date', 'time', 'end_time', 'status', 'items', 'total', 'order_id', 'created_at'],
    insertable: ['resource_id', 'customer_name', 'customer_phone', 'date', 'time', 'end_time', 'items', 'total'],
    writable: ['resource_id', 'customer_name', 'customer_phone', 'date', 'time', 'end_time', 'status', 'items', 'total'],
  },
};

const OPS = { eq: '=', gte: '>=', lte: '<=', gt: '>', lt: '<' };

// jsonb: pg only auto-stringifies plain JS *objects* into query params --
// a JS *array* gets sent as a Postgres native array literal instead
// (confirmed by hand: place_order's `its` array errored with "invalid
// input syntax for type json" until explicitly JSON.stringify'd below).
// Named here so callRpc knows which params need that regardless of
// whether the value happens to be an object or an array.
const RPC = {
  push_record: { params: ['rid', 'rkind', 'rdata', 'rdeleted', 'base', 'force'], jsonb: ['rdata'], auth: true },
  next_invoice_no: { params: ['prefix'], auth: true },
  provision_tenant: { params: ['p_name', 'p_slug', 'p_niche'], auth: true },
  public_menu: { params: ['tenant_slug'], auth: false },
  place_order: { params: ['tenant_slug', 't', 'n', 'p', 'nt', 'its'], jsonb: ['its'], auth: false },
  public_invoice: { params: ['oid'], auth: false },
  submit_feedback: { params: ['oid', 'rating', 'comment'], auth: false },
  submit_lead: { params: ['p_name', 'p_contact', 'p_business', 'p_message', 'p_niche'], auth: false },
  list_clients: { params: [], auth: true },
  update_client: { params: ['p_tenant_id', 'p_monthly_fee', 'p_renewal_date', 'p_notes', 'p_status'], auth: true },
  submit_signup_request: { params: ['p_business_name', 'p_slug', 'p_features', 'p_notes', 'p_contact_name', 'p_phone', 'p_niche', 'p_address'], jsonb: ['p_features'], auth: true },
  approve_signup_request: { params: ['p_request_id', 'p_niche'], auth: true },
  decline_signup_request: { params: ['p_request_id'], auth: true },

  // --- Phase 1: Booking & Appointments / Reports & Analytics ---
  convert_booking_to_order: { params: ['p_booking_id', 'p_invoice_prefix'], auth: true },
  report_dashboard: { params: ['p_from', 'p_to'], auth: true },

  // --- Admin: reset a client's forgotten password ---
  admin_reset_client_password: { params: ['p_tenant_id'], auth: true },

  // --- Client dashboard: own account, staff, feature toggles ---
  my_dashboard: { params: [], auth: true },
  update_my_features: { params: ['p_enabled'], jsonb: ['p_enabled'], auth: true },
  change_my_password: { params: ['p_old_password', 'p_new_password'], auth: true },
  invite_staff: { params: ['p_email', 'p_name', 'p_phone', 'p_role_id'], auth: true },
  remove_staff: { params: ['p_staff_id'], auth: true },
  delete_role: { params: ['p_role_id'], auth: true },

  // --- Notifications ---
  send_client_notification: { params: ['p_tenant_id', 'p_title', 'p_body'], auth: true },
};

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// ---- CORS: reflect the request's Origin only when it's this domain,
// a subdomain of it (every tenant), or localhost (local dev) -- never
// the wildcard '*' every response used to send unconditionally. ----
function allowedOrigin(originHeader) {
  if (!originHeader) return null;
  let u;
  try { u = new URL(originHeader); } catch { return null; }
  if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') return originHeader;
  if (!DOMAIN || u.protocol !== 'https:') return null;
  if (u.hostname === DOMAIN || u.hostname.endsWith('.' + DOMAIN)) return originHeader;
  return null;
}

// ---- rate limiting: plain in-memory fixed-window counters, no
// external dependency or paid service. Deliberately NOT applied as a
// single global per-IP cap -- a cafe's whole customer base can share
// one NAT/WiFi IP while self-ordering off a QR code, so a blanket
// limit would lock out real customers. Instead: tight limits on the
// two endpoints actually worth brute-forcing (login, signup), and a
// generous shared-IP-friendly ceiling on the public/anonymous RPCs. ----
const rateBuckets = new Map();
function rateLimited(key, limit, windowMs) {
  const now = Date.now();
  let b = rateBuckets.get(key);
  if (!b || b.resetAt <= now) { b = { count: 0, resetAt: now + windowMs }; rateBuckets.set(key, b); }
  b.count += 1;
  return b.count > limit;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of rateBuckets) if (b.resetAt <= now) rateBuckets.delete(k);
}, 60_000).unref();

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return fwd.split(',')[0].trim();
  return req.socket.remoteAddress || 'unknown';
}

function parseFilters(query, allowedColumns) {
  const filters = [];
  for (const [key, val] of query.entries()) {
    const m = key.match(/^(eq|gte|lte|gt|lt)\.(.+)$/);
    if (!m) continue;
    const [, op, col] = m;
    if (!allowedColumns.includes(col)) throw new HttpError(400, `bad filter column: ${col}`);
    filters.push({ op, col, val });
  }
  return filters;
}

async function handleSelect(client, table, cfg, query) {
  const selectParam = query.get('select') || '*';
  const selectCols = selectParam === '*' ? ['*'] : selectParam.split(',').map((s) => s.trim());
  if (!(selectCols.length === 1 && selectCols[0] === '*')) {
    for (const c of selectCols) if (!cfg.columns.includes(c)) throw new HttpError(400, `bad select column: ${c}`);
  }
  const filters = parseFilters(query, cfg.columns);
  const order = query.get('order');
  if (order && !cfg.columns.includes(order)) throw new HttpError(400, 'bad order column');
  const limit = query.get('limit') ? parseInt(query.get('limit'), 10) : null;

  let sql = `select ${selectCols.join(',')} from ${table}`;
  const params = [];
  if (filters.length) {
    sql += ' where ' + filters.map((f) => { params.push(f.val); return `${f.col} ${OPS[f.op]} $${params.length}`; }).join(' and ');
  }
  if (order) sql += ` order by ${order}`;
  if (limit) sql += ` limit ${limit}`;

  const { rows } = await client.query(sql, params);
  return query.get('single') === '1' ? (rows[0] || null) : rows;
}

async function handleInsert(client, table, cfg, body, onConflictCol) {
  const insertable = cfg.insertable || cfg.columns;
  const cols = Object.keys(body).filter((c) => insertable.includes(c));
  if (!cols.length) throw new HttpError(400, 'nothing to insert');
  const values = cols.map((c) => body[c]);
  const placeholders = cols.map((_, i) => `$${i + 1}`);
  let sql = `insert into ${table} (${cols.join(',')}) values (${placeholders.join(',')})`;
  if (onConflictCol) {
    const updateSet = cols.filter((c) => c !== onConflictCol).map((c) => `${c}=excluded.${c}`).join(',');
    sql += ` on conflict (${onConflictCol}) do update set ${updateSet}`;
  }
  sql += ' returning *';
  const { rows } = await client.query(sql, values);
  return rows[0];
}

async function handleUpdate(client, table, cfg, body, query) {
  const writable = cfg.writable || cfg.columns;
  const cols = Object.keys(body).filter((c) => writable.includes(c));
  if (!cols.length) throw new HttpError(400, 'nothing to update');
  const filters = parseFilters(query, cfg.columns);
  const values = cols.map((c) => body[c]);
  const setClauses = cols.map((c, i) => `${c}=$${i + 1}`);
  let sql = `update ${table} set ${setClauses.join(',')}`;
  if (filters.length) {
    sql += ' where ' + filters.map((f) => { values.push(f.val); return `${f.col} ${OPS[f.op]} $${values.length}`; }).join(' and ');
  }
  sql += ' returning *';
  const { rows } = await client.query(sql, values);
  return rows;
}

async function callRpc(client, fnName, args) {
  const cfg = RPC[fnName];
  if (!cfg) throw new HttpError(404, 'unknown function');
  const jsonbParams = cfg.jsonb || [];
  const values = cfg.params.map((p) => {
    const v = args[p] !== undefined ? args[p] : null;
    return jsonbParams.includes(p) && v !== null ? JSON.stringify(v) : v;
  });
  const placeholders = cfg.params.map((_, i) => `$${i + 1}`);
  const { rows } = await client.query(`select ${fnName}(${placeholders.join(',')}) as result`, values);
  return rows[0]?.result;
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; if (data.length > 5_000_000) req.destroy(); });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(new HttpError(400, 'bad json')); } });
    req.on('error', reject);
  });
}
function readRawBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (c) => {
      total += c.length;
      if (maxBytes && total > maxBytes) { req.destroy(); reject(new HttpError(413, 'file too large')); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function send(res, status, body, origin) {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  };
  if (origin) { headers['Access-Control-Allow-Origin'] = origin; headers['Vary'] = 'Origin'; }
  res.writeHead(status, headers);
  res.end(JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  const origin = allowedOrigin(req.headers.origin);
  const reply = (status, body) => send(res, status, body, origin);
  if (req.method === 'OPTIONS') { reply(204, {}); return; }

  const url = new URL(req.url, 'http://internal');
  const user = verifyToken(bearerFrom(req) || '');
  const ip = clientIp(req);

  try {
    // ---- auth ----
    if (url.pathname === '/auth/login' && req.method === 'POST') {
      // 20 attempts / 15 min per IP -- bcrypt is expensive on purpose,
      // and login is the endpoint most worth brute-forcing.
      if (rateLimited(`login:${ip}`, 20, 15 * 60_000)) throw new HttpError(429, 'too many login attempts, try again later');
      const { email, password } = await readJsonBody(req);
      const result = await login(email, password);
      if (!result) throw new HttpError(401, 'invalid credentials');
      return reply(200, result);
    }
    // ---- public self-serve signup: creates a bare login with no
    // tenant_id yet (on_signup's guard skips the profiles row for it,
    // same as a platform_admin) -- becomes a real tenant owner only
    // once a platform_admin approves their signup_request. ----
    if (url.pathname === '/auth/signup' && req.method === 'POST') {
      // 10 accounts / hour per IP -- loose enough for a shared cafe/office
      // IP, tight enough to block scripted account-spam.
      if (rateLimited(`signup:${ip}`, 10, 60 * 60_000)) throw new HttpError(429, 'too many signups from this network, try again later');
      const { email, password } = await readJsonBody(req);
      if (!email || !password) throw new HttpError(400, 'email and password are required');
      let created;
      try {
        created = await createUser({ email, password });
      } catch (err) {
        if (err.code === '23505') throw new HttpError(409, 'an account with that email already exists');
        throw err;
      }
      return reply(200, { access_token: signToken(created), user: created });
    }
    if (url.pathname === '/auth/session' && req.method === 'GET') {
      if (!user) throw new HttpError(401, 'no session');
      return reply(200, { user });
    }

    // ---- generic data API (records/profiles/guest_orders/push_subs/leads/signup_requests/bookings) ----
    const dbMatch = url.pathname.match(/^\/db\/([a-z_]+)$/);
    if (dbMatch) {
      const table = dbMatch[1];
      const cfg = TABLES[table];
      if (!cfg) throw new HttpError(404, 'unknown table');
      const uid = user?.id || null;

      const result = await withAuth(uid, async (client) => {
        if (req.method === 'GET') return handleSelect(client, table, cfg, url.searchParams);
        if (req.method === 'POST') {
          const body = await readJsonBody(req);
          return handleInsert(client, table, cfg, body, url.searchParams.get('onConflict'));
        }
        if (req.method === 'PATCH') {
          const body = await readJsonBody(req);
          return handleUpdate(client, table, cfg, body, url.searchParams);
        }
        throw new HttpError(405, 'method not allowed');
      });
      return reply(200, { data: result });
    }

    // ---- rpc ----
    const rpcMatch = url.pathname.match(/^\/rpc\/([a-z_]+)$/);
    if (rpcMatch && req.method === 'POST') {
      const fnName = rpcMatch[1];
      const cfg = RPC[fnName];
      if (!cfg) throw new HttpError(404, 'unknown function');
      if (cfg.auth && !user) throw new HttpError(401, 'authentication required');
      // Public/anonymous RPCs (public_menu, place_order, ...) are
      // reachable by every customer self-ordering off a QR code, often
      // from one shared cafe/restaurant WiFi IP -- so this stays
      // generous (300 / 5 min) rather than a tight per-request cap.
      // Authenticated calls aren't limited here: a logged-in session
      // already required passing the login rate limit above.
      if (!cfg.auth && rateLimited(`public:${ip}`, 300, 5 * 60_000)) throw new HttpError(429, 'too many requests, please slow down');
      const args = await readJsonBody(req);
      const uid = user?.id || null;
      const result = await withAuth(uid, (client) => callRpc(client, fnName, args));
      return reply(200, { data: result });
    }

    // ---- storage: POST /storage/site/:prefix (raw image body) ----
    const storageMatch = url.pathname.match(/^\/storage\/site\/([a-zA-Z0-9_-]+)$/);
    if (storageMatch && req.method === 'POST') {
      if (!user) throw new HttpError(401, 'authentication required');
      const tenantId = user.app_metadata?.tenant_id;
      if (!tenantId || user.app_metadata?.role !== 'owner') throw new HttpError(403, 'owner only');
      const buffer = await readRawBody(req, 8_000_000); // 8MB cap -- client already compresses to well under this
      const result = await saveSiteUpload({ tenantId, prefix: storageMatch[1], buffer });
      return reply(200, result);
    }

    // ---- admin: provision-owner (was a Supabase Edge Function) ----
    if (url.pathname === '/admin/provision-owner' && req.method === 'POST') {
      if (!user) throw new HttpError(401, 'unauthorized');
      // platform_admins has RLS (id = app_uid()) -- a bare pool.query here
      // never sets app.uid, so the row is invisible and this check fails
      // for every caller regardless of admin status. Must go through
      // withAuth like every other query that touches an RLS-protected table.
      const { rows } = await withAuth(user.id, (client) =>
        client.query('select 1 from platform_admins where id = $1', [user.id]),
      );
      if (!rows.length) throw new HttpError(403, 'forbidden -- not a platform admin');
      const body = await readJsonBody(req);
      if (!body.tenant_id || !body.email) throw new HttpError(400, 'tenant_id and email are required');
      const created = await createUser({
        email: body.email,
        password: crypto.randomUUID(),
        app_metadata: { tenant_id: body.tenant_id, role: 'owner' },
        user_metadata: { name: body.name || '' },
      });
      const tempPassword = await resetToRandomPassword(created.id);
      // shared with the new owner directly (e.g. over WhatsApp) -- see
      // resetToRandomPassword's own note on why this replaces a
      // recovery-link email.
      return reply(200, { user_id: created.id, temp_password: tempPassword });
    }

    throw new HttpError(404, 'not found');
  } catch (err) {
    let status = err.status || 500;
    let message = err.message || 'internal error';
    // Phase 1: bookings_no_overlap is a Postgres EXCLUDE constraint
    // (see 008_phase1_...sql) -- surface its violation as a normal
    // 409, not a raw 500. Verified against a real Postgres 16 (see
    // that migration's own testing notes).
    if (err.code === '23P01') {
      status = 409;
      message = 'That resource is already booked for an overlapping time.';
    }
    // A stale/cached login token whose auth_users row no longer exists
    // (e.g. an admin cleanup deleted it) hits this FK, not a bad
    // password -- surface it as "please sign in again", not a raw
    // constraint-violation string.
    if (err.code === '23503' && /user_id_fkey/.test(err.constraint || '')) {
      status = 401;
      message = 'Your session is no longer valid. Please sign in again.';
    }
    if (err.code === '23505' && err.constraint === 'auth_users_email_key') {
      status = 409;
      message = 'An account with that email already exists.';
    }
    if (status === 500) console.error(err);
    reply(status, { error: message });
  }
});

startRealtime(server, { onPushEvent: handlePushEvent });

server.listen(PORT, () => console.log(`auzlabs-api listening on :${PORT}`));
