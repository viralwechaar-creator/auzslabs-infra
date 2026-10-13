import { DOMAIN } from '../config.js';

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
// ---- CORS: reflect the request's Origin only when it's this domain,
// a subdomain of it (every tenant), or localhost (local dev) -- never
// the wildcard '*' every response used to send unconditionally. ----
export function allowedOrigin(originHeader) {
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
export const rateBuckets = new Map();
export function rateLimited(key, limit, windowMs) {
  if (process.env.DISABLE_RATE_LIMIT === '1') return false; // automated tests only (tests/lib/stack.mjs); never set in production
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

export function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  // Caddy (the only thing in front of this server) puts the real address in X-Forwarded-For; take the LAST entry, the one our own proxy wrote, never the first, which a caller can set to anything to dodge the rate limits.
  if (fwd) { const parts = String(fwd).split(',').map((x) => x.trim()).filter(Boolean); if (parts.length) return parts[parts.length - 1]; }
  return req.socket.remoteAddress || 'unknown';
}
export function httpFromError(err) {
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
  // Accounting raises ordinary business-rule errors from SQL (locked period, insufficient stock, credit limit,
  // unbalanced journal, ...). Those are the caller's to fix, not server faults: 400 (or 401/403), and no stack in the log.
  if (status === 500 && typeof err.code === 'string') {
    if (err.code === 'P0001' || /^(AC|PY|MB)\d{3}$/.test(err.code) || /^(22|23)/.test(err.code)) { status = 400; message = err.message; }
    else if (err.code === '42501') { status = 403; message = err.message; }
    else if (err.code === '28000') { status = 401; message = err.message; }
  }
  return { status, message };
}

export function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; if (data.length > 5_000_000) req.destroy(); });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(new HttpError(400, 'bad json')); } });
    req.on('error', reject);
  });
}
export function readRawBody(req, maxBytes) {
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

export function send(res, status, body, origin) {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  };
  if (origin) { headers['Access-Control-Allow-Origin'] = origin; headers['Vary'] = 'Origin'; }
  res.writeHead(status, headers);
  res.end(JSON.stringify(body));
}
