import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { pool } from '../db.js';
import { SECRET } from './util.js';

// ---- admin password + session ----
export const hashPassword = (pw) => { const salt = crypto.randomBytes(16).toString('hex'); return `scrypt$${salt}$${crypto.scryptSync(pw, salt, 64).toString('hex')}`; };
export function verifyScrypt(pw, stored) {
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
export async function ownerPasswordOk(tid, pw) {
  const { rows } = await pool.query('select salon_owner_hashes($1) as h', [tid]);
  for (const r of rows) if (await bcrypt.compare(pw, r.h)) return true;
  return false;
}
const sign = (v) => crypto.createHmac('sha256', SECRET).update(v).digest('base64url');
// Session payload carries the role: 'owner' (full console) or 'staff'
// (Today / Bookings / Billing / Clients only -- enforced per endpoint
// below, never just hidden in the UI). sid/name identify the staff member.
export function setSession(res, tid, who = { role: 'owner' }) {
  const payload = Buffer.from(JSON.stringify({ tid, role: who.role, sid: who.sid || null, name: who.name || null, exp: Date.now() + 7 * 864e5 })).toString('base64url');
  res.setHeader('Set-Cookie', `salon_session=${payload}.${sign(payload)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800`);
}
export const clearSession = (res) => res.setHeader('Set-Cookie', 'salon_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0');
export function getSession(req, tid) {
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
