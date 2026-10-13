import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomBytes, createCipheriv, createDecipheriv, hkdfSync } from 'node:crypto';
import { pool } from '../db.js';
import { generateSecret, otpauthUri, verifyTotp, generateBackupCodes } from '../totp.js';
import { JWT_SECRET } from './config.js';
import { signToken } from './sessions.js';

// auth_totp.secret at rest (db/135): a TOTP secret has to be decryptable (the
// server re-derives the 6-digit code from it on every login), so unlike a
// password it can never just be hashed -- it's encrypted instead, with a key
// derived from JWT_SECRET via HKDF into its own, separate-purpose subkey
// (never JWT_SECRET directly, which stays scoped to signing). An `enc:`
// prefix makes the new format unambiguous against a legacy plaintext base32
// secret (which can never start with "enc:", lowercase+colon aren't in the
// base32 alphabet) -- decryptTotpSecret() falls back to reading a value
// without that prefix as-is, so an account whose secret predates this change
// keeps working with zero migration, and gets upgraded to encrypted the next
// time its 2FA is set up again (disable + re-enable to upgrade sooner).
const TOTP_KEY = Buffer.from(hkdfSync('sha256', Buffer.from(JWT_SECRET), Buffer.alloc(0), 'auzslab-auth-totp-secret-v1', 32));
function encryptTotpSecret(secret) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', TOTP_KEY, iv);
  const enc = Buffer.concat([cipher.update(String(secret), 'utf8'), cipher.final()]);
  return `enc:${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${enc.toString('base64')}`;
}
function decryptTotpSecret(value) {
  if (!value || !value.startsWith('enc:')) return value; // legacy plaintext row, read as-is
  const [, ivB64, tagB64, dataB64] = value.split(':');
  const decipher = createDecipheriv('aes-256-gcm', TOTP_KEY, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
}

// =========================================================
// Two-factor authentication (db/117). The one place every identity
// path (password, Google, Apple, phone) converges on *after* proving
// who someone is but *before* actually issuing a real session -- so a
// 2FA check added once here covers every sign-in method automatically,
// rather than threading it through login()/loginWithGoogle()/etc.
// individually. A "challenge" is a short-lived (5 min), purpose-scoped
// JWT -- it can never be used as a real Bearer token (verifyToken()
// only accepts tokens it itself signed via signToken(), which never
// sets purpose:'2fa'), so there is no way to skip the code check by
// just replaying this token at a normal endpoint.
// =========================================================
export async function sessionOrChallenge(user, meta) {
  const { rows } = await pool.query('select enabled from auth_totp where user_id = $1', [user.id]);
  if (!rows[0]?.enabled) return { access_token: await signToken(user, meta), user };
  const challenge = jwt.sign({ sub: user.id, purpose: '2fa' }, JWT_SECRET, { expiresIn: '5m' });
  return { requires2fa: true, challenge };
}

// Completes a sign-in that returned requires2fa: verifies the challenge
// token (purpose + not expired), then either a fresh TOTP code or an
// unused backup code (consumed on use, one-time by design). Returns the
// normal {access_token,user} shape on success, or null -- same "null
// means wrong credentials, no further detail" discipline as login().
export async function verify2faChallenge(challenge, code, meta) {
  let payload;
  try { payload = jwt.verify(challenge, JWT_SECRET); } catch { return null; }
  if (payload.purpose !== '2fa' || !payload.sub) return null;
  const { rows } = await pool.query(
    `select au.id, au.email, au.app_metadata, au.user_metadata, t.secret, t.backup_codes
     from auth_users au join auth_totp t on t.user_id = au.id
     where au.id = $1 and au.deleted_at is null and au.disabled_at is null and t.enabled = true`,
    [payload.sub],
  );
  const row = rows[0];
  if (!row) return null;
  const clean = String(code || '').trim();
  if (verifyTotp(decryptTotpSecret(row.secret), clean)) {
    const user = { id: row.id, email: row.email, app_metadata: row.app_metadata, user_metadata: row.user_metadata };
    return { access_token: await signToken(user, meta), user };
  }
  // Not a valid TOTP code -- try it as a backup code (bcrypt-hashed, one-time).
  for (const hash of row.backup_codes || []) {
    if (await bcrypt.compare(clean, hash)) {
      await pool.query(
        `update auth_totp set backup_codes = array_remove(backup_codes, $1) where user_id = $2`,
        [hash, row.id],
      );
      const user = { id: row.id, email: row.email, app_metadata: row.app_metadata, user_metadata: row.user_metadata };
      return { access_token: await signToken(user, meta), user };
    }
  }
  return null;
}

export async function my2faStatus(userId) {
  const { rows } = await pool.query('select enabled, array_length(backup_codes, 1) as codes_left from auth_totp where user_id = $1', [userId]);
  return { enabled: !!rows[0]?.enabled, backupCodesLeft: rows[0]?.codes_left || 0 };
}

// Step 1 of setup: generates a fresh secret (overwriting any unconfirmed
// one from an abandoned earlier attempt) and returns the QR-code URI --
// NOT enabled yet. Gated to owner/manager by the caller (index.js),
// since this is an account-security feature for the person who can do
// the most damage if their login is compromised, not every staff login.
export async function generate2faSecret(userId, email) {
  const secret = generateSecret();
  await pool.query(
    `insert into auth_totp (user_id, secret, enabled) values ($1, $2, false)
     on conflict (user_id) do update set secret = $2, enabled = false, backup_codes = '{}', confirmed_at = null`,
    [userId, encryptTotpSecret(secret)],
  );
  return { secret, otpauth: otpauthUri(secret, email) }; // the raw secret for this one response (the QR code) only -- never stored
}

// Step 2: proves the owner's authenticator app actually has the secret
// (not just that the setup call succeeded) before turning it on --
// otherwise a typo'd/never-scanned secret would lock the owner out on
// their very next login. Generates backup codes only now, once, and
// returns them in plaintext exactly this one time.
export async function confirm2fa(userId, code) {
  const { rows } = await pool.query('select secret from auth_totp where user_id = $1 and enabled = false', [userId]);
  if (!rows[0] || !verifyTotp(decryptTotpSecret(rows[0].secret), code)) return null;
  const backupCodes = generateBackupCodes();
  const hashes = await Promise.all(backupCodes.map((c) => bcrypt.hash(c, 10)));
  await pool.query(
    `update auth_totp set enabled = true, confirmed_at = now(), backup_codes = $1 where user_id = $2`,
    [hashes, userId],
  );
  return { backupCodes };
}

// Requires the account's current password (if it has one -- a
// Google/Apple/phone-only account just needs its current session, same
// bar deleteOwnAccount already uses) OR a valid TOTP/backup code, so
// turning 2FA off needs proof of at least one of the two factors, never
// just a bare "I'm signed in right now" click.
export async function disable2fa(userId, { password, code } = {}) {
  const { rows } = await pool.query('select password_hash from auth_users where id = $1', [userId]);
  let ok = !rows[0]?.password_hash; // no password on the account -- session alone is enough, same as deleteOwnAccount
  if (!ok && password) ok = await bcrypt.compare(password, rows[0].password_hash);
  if (!ok && code) {
    const { rows: tr } = await pool.query('select secret from auth_totp where user_id = $1 and enabled = true', [userId]);
    if (tr[0]) ok = verifyTotp(decryptTotpSecret(tr[0].secret), code);
  }
  if (!ok) return false;
  await pool.query('delete from auth_totp where user_id = $1', [userId]);
  return true;
}

// Returns {id,email,app_metadata,jti} from a valid, non-revoked Bearer
// token, or null. The revocation check is a plain in-memory Set lookup,
// not a query -- verifying a token stays the fast, local operation it
// was deliberately built as (see db/069's own comment on this).
