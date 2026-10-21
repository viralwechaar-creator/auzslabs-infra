import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { pool } from '../db.js';
import { sessionOrChallenge } from './twofa.js';
import { revokeAllSessionsForUser } from './sessions.js';
import { sha256 } from './email.js';

export async function login(email, password, meta) {
  const { rows } = await pool.query(
    `select au.id, au.email, au.password_hash, au.app_metadata, au.user_metadata, p.email_verified
     from auth_users au left join profiles p on p.id = au.id
     where au.email = $1 and au.deleted_at is null and au.disabled_at is null`,
    [email],
  );
  const row = rows[0];
  // A null password_hash means this account was created via Google/
  // Apple/phone and has never set a password -- bcrypt.compare would
  // throw on a null hash, and either way there's nothing to check it
  // against, so this is "wrong credentials" exactly like a bad password.
  if (!row || !row.password_hash) return null;
  const ok = await bcrypt.compare(password, row.password_hash);
  if (!ok) return null;
  // p.email_verified is null for a caller with no profiles row at all
  // (a platform admin, or a bare self-signup account with no tenant
  // yet) -- only a real staff profile can actually be unverified
  // (see db/044_staff_email_verification.sql), so null/true both pass.
  if (row.email_verified === false) return { unverified: true };
  const user = { id: row.id, email: row.email, app_metadata: row.app_metadata, user_metadata: row.user_metadata };
  return sessionOrChallenge(user, meta);
}

export async function createUser({ email, password, app_metadata = {}, user_metadata = {}, verified = false }) {
  const password_hash = await bcrypt.hash(password, 12);
  const { rows } = await pool.query(
    `insert into auth_users (email, password_hash, app_metadata, user_metadata, email_verified_at)
     values ($1, $2, $3, $4, case when $5 then now() end) returning id, email, app_metadata, user_metadata`,
    [email, password_hash, app_metadata, user_metadata, verified],
  );
  return rows[0];
}

// Sets a brand-new random password for an existing user and returns it
// (the caller -- an admin -- shares it directly with the new owner,
// e.g. over WhatsApp, same as the recovery-link approach the Supabase
// edge function used, just without needing transactional email either).
export async function resetToRandomPassword(userId) {
  // 12 characters from an alphabet without look-alikes (no 0/O, 1/l/I): about 70 bits, short enough to read out or type
  const A = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const password = Array.from(randomBytes(12), (b) => A[b % A.length]).join('');
  const password_hash = await bcrypt.hash(password, 12);
  await pool.query('update auth_users set password_hash = $1 where id = $2', [password_hash, userId]);
  return password;
}

// ---- Self-service password reset ----

// Returns null for an unknown email without the caller treating that
// differently from a known one (the /auth/forgot endpoint always
// replies the same way either way) -- this function existing at all is
// the only place that actually knows whether the account exists.
export async function createPasswordReset(email) {
  const { rows } = await pool.query('select id from auth_users where email = $1 and deleted_at is null', [email]);
  if (!rows[0]) return null;
  // Only the hash is ever stored (db/134) -- same discipline as email_verifications -- so the
  // raw token below is the one and only copy, good for this request's reply, never written anywhere.
  const token = randomBytes(32).toString('base64url');
  await pool.query('insert into password_resets (user_id, token_hash) values ($1, $2)', [rows[0].id, sha256(token)]);
  return token;
}

export async function resetPassword(token, newPassword) {
  const { rows } = await pool.query(
    'select user_id from password_resets where token_hash = $1 and used_at is null and expires_at > now()',
    [sha256(token)],
  );
  if (!rows[0]) return false;
  const password_hash = await bcrypt.hash(newPassword, 12);
  await pool.query('update auth_users set password_hash = $1 where id = $2', [password_hash, rows[0].user_id]);
  await pool.query('update password_resets set used_at = now() where token_hash = $1', [sha256(token)]);
  // A password reset is what a person does when they think someone else has access: every device that was signed in must be signed out.
  await revokeAllSessionsForUser(rows[0].user_id);
  return true;
}

// ---- Self-service account deletion (Apple Guideline 5.1.1(v)) ----

// Soft delete: see db/069's own comment for why this doesn't cascade
// into actually destroying a tenant's data. A password-holding account
// must confirm its password first (same bar as changing one); an
// OAuth/phone-only account has nothing to confirm with, so holding a
// valid session token is enough.
export async function deleteOwnAccount(userId, password) {
  const { rows } = await pool.query(
    `select au.password_hash, au.email, p.tenant_id, p.role
     from auth_users au left join profiles p on p.id = au.id
     where au.id = $1 and au.deleted_at is null`,
    [userId],
  );
  const row = rows[0];
  if (!row) throw new Error('account not found');
  if (row.password_hash) {
    const ok = password && (await bcrypt.compare(password, row.password_hash));
    if (!ok) throw new Error('incorrect password');
  }
  await pool.query('update auth_users set deleted_at = now() where id = $1', [userId]);
  await pool.query(
    'insert into account_deletions (user_id, email, tenant_id, role) values ($1,$2,$3,$4)',
    [userId, row.email, row.tenant_id || null, row.role || null],
  );
}
