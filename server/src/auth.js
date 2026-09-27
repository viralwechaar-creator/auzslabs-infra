import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { pool } from './db.js';

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error('JWT_SECRET is required');
const JWT_EXPIRY = '7d';

export function signToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, app_metadata: user.app_metadata },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRY },
  );
}

// Returns {id,email,app_metadata} from a valid Bearer token, or null.
// Deliberately does NOT touch the database -- the token itself already
// carries everything a request needs (same as a Supabase JWT did), so
// verifying it is a pure, fast, local operation.
export function verifyToken(token) {
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    return { id: payload.sub, email: payload.email, app_metadata: payload.app_metadata || {} };
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
export async function login(email, password) {
  const { rows } = await pool.query(
    'select id, email, password_hash, app_metadata, user_metadata from auth_users where email = $1',
    [email],
  );
  const row = rows[0];
  if (!row) return null;
  const ok = await bcrypt.compare(password, row.password_hash);
  if (!ok) return null;
  const user = { id: row.id, email: row.email, app_metadata: row.app_metadata, user_metadata: row.user_metadata };
  return { access_token: signToken(user), user };
}

export async function createUser({ email, password, app_metadata = {}, user_metadata = {} }) {
  const password_hash = await bcrypt.hash(password, 12);
  const { rows } = await pool.query(
    `insert into auth_users (email, password_hash, app_metadata, user_metadata)
     values ($1, $2, $3, $4) returning id, email, app_metadata, user_metadata`,
    [email, password_hash, app_metadata, user_metadata],
  );
  return rows[0];
}

// Sets a brand-new random password for an existing user and returns it
// (the caller -- an admin -- shares it directly with the new owner,
// e.g. over WhatsApp, same as the recovery-link approach the Supabase
// edge function used, just without needing transactional email either).
export async function resetToRandomPassword(userId) {
  const password = crypto.randomUUID() + crypto.randomUUID();
  const password_hash = await bcrypt.hash(password, 12);
  await pool.query('update auth_users set password_hash = $1 where id = $2', [password_hash, userId]);
  return password;
}
