import bcrypt from 'bcryptjs';
import { randomBytes, createHash } from 'node:crypto';
import { pool } from '../db.js';

// =========================================================
// Email verification (db/092). A self-serve signup starts unverified; a one-time link proves the address.
// Only a SHA-256 of the token is stored. The link is good for 24 hours; asking again replaces nothing, it just
// adds a newer link (older unused ones keep working until they expire, so a slow inbox never strands someone).
// =========================================================
export const sha256 = (v) => createHash('sha256').update(String(v)).digest('hex');

export async function createEmailVerification(userId, email) {
  const token = randomBytes(32).toString('base64url');
  await pool.query(
    `insert into email_verifications (token_hash, user_id, email, expires_at, purpose) values ($1, $2, $3, now() + interval '24 hours', 'verify')`,
    [sha256(token), userId, email],
  );
  return token;
}

// returns { ok:true, email } or { ok:false } -- the same answer for unknown, used and expired tokens
export async function confirmEmailVerification(token) {
  if (!token || typeof token !== 'string' || token.length > 200) return { ok: false };
  const { rows } = await pool.query(
    `update email_verifications set used_at = coalesce(used_at, now())
     where token_hash = $1 and expires_at > now() and purpose = 'verify'
     returning user_id, email`,
    [sha256(token)],
  );
  if (!rows[0]) return { ok: false };
  // only verify the address that was actually mailed (the account's email could have changed since)
  await pool.query(
    `update auth_users set email_verified_at = coalesce(email_verified_at, now()) where id = $1 and email = $2 and deleted_at is null`,
    [rows[0].user_id, rows[0].email],
  );
  return { ok: true, email: rows[0].email };
}

export async function emailVerificationState(userId) {
  const { rows } = await pool.query('select email, email_verified_at from auth_users where id = $1 and deleted_at is null', [userId]);
  return rows[0] ? { email: rows[0].email, verified: !!rows[0].email_verified_at } : null;
}

// =========================================================
// Self-service login-email change (db/121). A password confirms it is really
// the account owner asking (same bar deleteOwnAccount already uses), then a
// link is mailed to the NEW address only -- the email is never actually
// changed until that address proves it can receive mail, same "never trust
// an unverified email" discipline as findOrCreateIdentityUser's pre-hijack
// guard above. The old address is never notified (there's no account-
// recovery value in it for this flow the way there is for a password change).
// =========================================================
export async function verifyPassword(userId, password) {
  if (!password) return false;
  const { rows } = await pool.query('select password_hash from auth_users where id = $1 and deleted_at is null', [userId]);
  if (!rows[0] || !rows[0].password_hash) return false;
  return bcrypt.compare(password, rows[0].password_hash);
}

export async function emailInUse(email, excludeUserId) {
  const { rows } = await pool.query(
    'select 1 from auth_users where email = $1 and deleted_at is null and ($2::uuid is null or id <> $2::uuid)',
    [email, excludeUserId || null],
  );
  return rows.length > 0;
}

export async function createEmailChange(userId, newEmail) {
  const token = randomBytes(32).toString('base64url');
  await pool.query(
    `insert into email_verifications (token_hash, user_id, email, expires_at, purpose) values ($1, $2, $3, now() + interval '24 hours', 'change')`,
    [sha256(token), userId, newEmail],
  );
  return token;
}

// returns { ok:true, email } or { ok:false, reason } -- reason distinguishes an
// expired/unknown link from the rare race where the address was taken by
// someone else in the time between the link being mailed and clicked.
export async function confirmEmailChange(token) {
  if (!token || typeof token !== 'string' || token.length > 200) return { ok: false, reason: 'invalid' };
  const { rows } = await pool.query(
    `select token_hash, user_id, email from email_verifications
     where token_hash = $1 and expires_at > now() and used_at is null and purpose = 'change'`,
    [sha256(token)],
  );
  const row = rows[0];
  if (!row) return { ok: false, reason: 'invalid' };
  if (await emailInUse(row.email, row.user_id)) {
    await pool.query('update email_verifications set used_at = now() where token_hash = $1', [row.token_hash]);
    return { ok: false, reason: 'taken' };
  }
  await pool.query('update email_verifications set used_at = now() where token_hash = $1', [row.token_hash]);
  await pool.query('update auth_users set email = $1, email_verified_at = now() where id = $2 and deleted_at is null', [row.email, row.user_id]);
  return { ok: true, email: row.email };
}

// =========================================================
// Recovery email (db/121): a verified backup contact, never a login method
// and never automatically substituted into the real forgot-password flow --
// it exists so an owner who loses their real inbox has something to show a
// platform admin to get help. Setting one always needs that address to
// prove it can receive mail first, same discipline as everything else here.
// =========================================================
export async function createRecoveryEmailVerification(userId, email) {
  const token = randomBytes(32).toString('base64url');
  await pool.query(
    `insert into email_verifications (token_hash, user_id, email, expires_at, purpose) values ($1, $2, $3, now() + interval '24 hours', 'recovery')`,
    [sha256(token), userId, email],
  );
  return token;
}

export async function confirmRecoveryEmail(token) {
  if (!token || typeof token !== 'string' || token.length > 200) return { ok: false };
  const { rows } = await pool.query(
    `update email_verifications set used_at = coalesce(used_at, now())
     where token_hash = $1 and expires_at > now() and purpose = 'recovery'
     returning user_id, email`,
    [sha256(token)],
  );
  if (!rows[0]) return { ok: false };
  await pool.query(
    'update auth_users set recovery_email = $1, recovery_email_verified_at = now() where id = $2 and deleted_at is null',
    [rows[0].email, rows[0].user_id],
  );
  return { ok: true, email: rows[0].email };
}

export async function removeRecoveryEmail(userId) {
  await pool.query('update auth_users set recovery_email = null, recovery_email_verified_at = null where id = $1', [userId]);
}

// The runtime switch the owner flips in SQL (platform_flags). Off by default so nobody is locked out before the
// email sender is verified. Read each time (it is one tiny row, and only on the few guarded actions).
export async function passwordSignupAllowed() {
  try {
    const { rows } = await pool.query(`select value from platform_flags where key = 'password_signup'`);
    return rows[0]?.value === 'on';
  } catch { return false; }
}

export async function emailVerificationRequired() {
  try {
    const { rows } = await pool.query(`select value from platform_flags where key = 'require_email_verification'`);
    return rows[0]?.value === 'on';
  } catch { return false; }
}
