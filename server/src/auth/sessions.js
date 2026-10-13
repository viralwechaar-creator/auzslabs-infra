import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { pool } from '../db.js';
import { JWT_EXPIRY, JWT_SECRET } from './config.js';

// =========================================================
// Single-device session revocation (db/071). A JWT carries a `jti` --
// one row per issued token in auth_sessions -- so a single lost phone
// or an ex-employee's device can be signed out without touching
// anyone else's session or the account's password. verifyToken() below
// stays the fast, stateless, no-DB-hit operation it was deliberately
// built as (see its own comment) by checking an in-memory Set of
// revoked jti's instead of querying on every request -- loaded once at
// boot, updated synchronously the instant revokeSession() runs. Only
// revocations younger than the JWT's own lifetime are worth holding in
// memory at all (an older one is moot -- that token already expired on
// its own), so the boot-time preload is bounded.
// =========================================================
const revokedJtis = new Set();
(async () => {
  try {
    const { rows } = await pool.query(
      `select jti from auth_sessions where revoked_at is not null and revoked_at > now() - interval '8 days'`,
    );
    rows.forEach((r) => revokedJtis.add(r.jti));
  } catch (err) {
    console.warn('could not preload revoked sessions', err.message);
  }
})();

// Closes the one real gap left in "instantly kill a stolen device's
// session": the HTTP/RPC side is already instant (verifyToken() rejects
// a revoked jti on its very next request), but the live-sync WebSocket
// (realtime.js) is only authenticated once, at connect -- a device that
// already has a socket open keeps it open, and keeps receiving bare
// "something changed, go refetch" pings, until it naturally disconnects.
// realtime.js can't import revokeSession/revokeAllSessionsForUser
// directly without a circular import (it already imports verifyToken
// from here), so it registers a listener here instead and this module
// never needs to know realtime.js exists.
const revocationListeners = [];
export function onSessionRevoked(fn) { revocationListeners.push(fn); }
function notifyRevoked(jti) { for (const fn of revocationListeners) { try { fn(jti); } catch (err) { console.warn('revocation listener failed', err.message); } } }

// A short, human-readable label ("Chrome on Windows") from the
// request's own User-Agent -- good enough for someone to recognise
// "that's my laptop" vs "that's not me" in a sessions list; not meant
// to be a precise device fingerprint.
function describeDevice(ua) {
  if (!ua) return 'Unknown device';
  const os = /windows/i.test(ua) ? 'Windows' : /mac os/i.test(ua) ? 'Mac'
    : /iphone/i.test(ua) ? 'iPhone' : /ipad/i.test(ua) ? 'iPad'
    : /android/i.test(ua) ? 'Android' : /linux/i.test(ua) ? 'Linux' : 'an unknown device';
  const browser = /edg\//i.test(ua) ? 'Edge' : /opr\//i.test(ua) ? 'Opera'
    : /chrome\//i.test(ua) ? 'Chrome' : /crios\//i.test(ua) ? 'Chrome'
    : /firefox\//i.test(ua) ? 'Firefox' : /safari\//i.test(ua) ? 'Safari' : 'a browser';
  return `${browser} on ${os}`;
}

async function createSession(userId, meta = {}) {
  const jti = randomUUID();
  await pool.query(
    `insert into auth_sessions (jti, user_id, device_label, ip) values ($1, $2, $3, $4)`,
    [jti, userId, describeDevice(meta.userAgent), meta.ip || null],
  );
  return jti;
}

// Fire-and-forget, throttled to at most once every 5 minutes per
// session -- this runs on every authenticated request, so an unthrottled
// UPDATE on every single one would turn a read into a write storm for
// no real benefit ("last seen 2 seconds ago" vs "3 minutes ago" tells a
// user the same thing: this device is active).
const lastSeenThrottle = new Map();
function touchSession(jti) {
  const now = Date.now();
  if (now - (lastSeenThrottle.get(jti) || 0) < 5 * 60_000) return;
  lastSeenThrottle.set(jti, now);
  pool.query(`update auth_sessions set last_seen_at = now() where jti = $1`, [jti]).catch(() => {});
}

export async function listSessions(userId) {
  const { rows } = await pool.query(
    `select jti, device_label, ip, created_at, last_seen_at from auth_sessions
     where user_id = $1 and revoked_at is null order by coalesce(last_seen_at, created_at) desc`,
    [userId],
  );
  return rows;
}

// Only ever lets someone revoke their OWN session -- userId comes from
// the caller's own verified token, never from the request body.
export async function revokeSession(userId, jti) {
  const { rows } = await pool.query(
    `update auth_sessions set revoked_at = now() where jti = $1 and user_id = $2 and revoked_at is null returning jti`,
    [jti, userId],
  );
  if (!rows[0]) throw new Error('session not found');
  revokedJtis.add(jti);
  notifyRevoked(jti);
}

// Admin-side equivalent of revokeSession, for the Users directory's "sign
// out everywhere" action (a lost device, an ex-employee) -- scoped by the
// TARGET user's id instead of the caller's own, so this is never exported
// to a route a plain user can reach (only server/src/index.js's
// /admin/users/:id/revoke-sessions endpoint, platform-admin gated, calls
// it). Kills every active session at once, same in-memory update as a
// single revokeSession so verifyToken() rejects them on the very next
// request, not after the next server restart.
export async function revokeAllSessionsForUser(userId, exceptJti = null) {
  const { rows } = await pool.query(
    `update auth_sessions set revoked_at = now() where user_id = $1 and revoked_at is null and ($2::text is null or jti::text <> $2::text) returning jti`,
    [userId, exceptJti],
  );
  rows.forEach((r) => { revokedJtis.add(r.jti); notifyRevoked(r.jti); });
  return rows.length;
}

// meta ({ip, userAgent}) is optional so every existing internal caller
// (e.g. a context with no real HTTP request) keeps working unchanged --
// a token signed without it just has no jti, and is valid exactly as
// every token was before this migration (not individually revocable,
// same as today). Every real sign-in path in this file passes meta.
// opts.limited: a short, never-renewed session (8 hours) -- used when client setup staff are handed a client's own
// business to set up (db/176). The `lim` claim makes /auth/refresh refuse to extend it.
export async function signToken(user, meta, opts) {
  const jti = meta ? await createSession(user.id, meta) : undefined;
  const limited = !!(opts && opts.limited);
  return jwt.sign(
    { sub: user.id, email: user.email, app_metadata: user.app_metadata, ...(jti ? { jti } : {}), ...(limited ? { lim: 1 } : {}) },
    JWT_SECRET,
    { expiresIn: limited ? '8h' : JWT_EXPIRY },
  );
}

// Silent session renewal (owner report: POS clients got "logged out again
// and again" -- traced to the 7-day JWT cliff: nothing ever refreshed a
// token, so it expired exactly 7 days after the LAST login regardless of
// how actively someone kept using the app since). sb-client.js calls
// POST /auth/refresh periodically while a session exists; this reuses the
// SAME jti rather than creating a new auth_sessions row, so a) the
// "Where you're signed in" device list doesn't grow with every refresh,
// and b) revoking that one session (lost phone, ex-employee) still kills
// every refreshed copy of it, not just the original token. A session
// that genuinely goes unused still expires 7 days after whatever its
// last sign-in or refresh was -- this only keeps an actively-used one
// alive, it doesn't disable expiry.
export function refreshToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, app_metadata: user.app_metadata, ...(user.jti ? { jti: user.jti } : {}) },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRY },
  );
}

export function verifyToken(token) {
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    // A 2FA challenge token (sessionOrChallenge/verify2faChallenge above)
    // is signed with this same JWT_SECRET and carries a real `sub`, so
    // without this check it would pass as a normal Bearer token despite
    // never having passed the second factor -- confirmed by hand against
    // a real running server before this check was added. A real session
    // token never sets `purpose` (signToken() never sets it), so this
    // only ever rejects a challenge token, never a normal one.
    if (payload.purpose) return null;
    if (payload.jti && revokedJtis.has(payload.jti)) return null;
    if (payload.jti) touchSession(payload.jti);
    return { id: payload.sub, email: payload.email, app_metadata: payload.app_metadata || {}, jti: payload.jti, lim: payload.lim };
  } catch {
    return null;
  }
}

export function bearerFrom(req) {
  const h = req.headers['authorization'] || '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
}

// login: looks up auth_users directly with the pool (no app.uid needed
// yet -- there's no authenticated caller until this succeeds), checks
// the password, and returns a signed token plus the user record.
