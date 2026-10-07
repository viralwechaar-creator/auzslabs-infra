import crypto from 'node:crypto';

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 };

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password, stored) {
  const [alg, n, saltB64, hashB64] = String(stored || '').split('$');
  if (alg !== 'scrypt' || !n || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  let got;
  try { got = crypto.scryptSync(String(password), Buffer.from(saltB64, 'base64'), expected.length, { N: Number(n), r: SCRYPT.r, p: SCRYPT.p }); } catch { return false; }
  return got.length === expected.length && crypto.timingSafeEqual(got, expected);
}

const b64u = (b) => Buffer.from(b).toString('base64url');

export function signSession(secret, days = 7) {
  const payload = b64u(JSON.stringify({ exp: Date.now() + days * 86400000, n: crypto.randomBytes(8).toString('hex') }));
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export function verifySession(secret, token) {
  const [payload, sig] = String(token || '').split('.');
  if (!payload || !sig) return false;
  const want = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  const a = Buffer.from(sig), b = Buffer.from(want);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  try { return JSON.parse(Buffer.from(payload, 'base64url').toString()).exp > Date.now(); } catch { return false; }
}

export function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

// 5 wrong passwords per 15 minutes per visitor
export function createLimiter(max = 5, windowMs = 15 * 60_000) {
  const hits = new Map();
  return {
    blocked(key) { const now = Date.now(); const a = (hits.get(key) || []).filter((t) => now - t < windowMs); hits.set(key, a); return a.length >= max; },
    fail(key) { const a = hits.get(key) || []; a.push(Date.now()); hits.set(key, a); },
    clear(key) { hits.delete(key); },
  };
}
