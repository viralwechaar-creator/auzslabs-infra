

// app/public/salon/ front-end, a verbatim port), multi-tenant. The
// tenant is resolved from the request's Host subdomain, never from
// client input. State is one JSON document per tenant in salon_store
// (db/053); every mutation runs under a row lock so concurrent admin
// writes no longer race like they did on Vercel Blob.

export const DOMAIN = process.env.DOMAIN || '';
export const SECRET = process.env.JWT_SECRET;
export const UPLOAD_ROOT = process.env.UPLOAD_ROOT || '/data/uploads';
const TZ = 'Asia/Kolkata';

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export const fail = (status, message) => { throw new HttpError(status, message); };

export const todayStr = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
export const cleanPhone = (v) => String(v || '').replace(/[^\d+]/g, '').slice(0, 20);
export const cleanString = (v, max = 200) => String(v || '').trim().slice(0, max);
export const validDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v);
export const validTime = (v) => /^\d{2}:\d{2}$/.test(v);
export const round2 = (n) => Math.round(n * 100) / 100;
export const staffPhone = (v) => String(v || '').replace(/\D/g, '').slice(-10);
export const hex6 = (v, d) => (/^#[0-9a-fA-F]{6}$/.test(v || '') ? v : d);
export const htmlEsc = (v) => String(v || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const rl = new Map();
export function limited(key, limit, windowMs) {
  const now = Date.now();
  let b = rl.get(key);
  if (!b || b.resetAt <= now) { b = { count: 0, resetAt: now + windowMs }; rl.set(key, b); }
  return ++b.count > limit;
}
setInterval(() => { const n = Date.now(); for (const [k, b] of rl) if (b.resetAt <= n) rl.delete(k); }, 60_000).unref();

export function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (c) => { body += c; if (body.length > 15_000_000) { reject(new HttpError(413, 'Request body too large.')); req.destroy(); } });
    req.on('end', () => { try { resolve(body ? JSON.parse(body) : {}); } catch { reject(new HttpError(400, 'Invalid JSON.')); } });
    req.on('error', reject);
  });
}

export function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}
