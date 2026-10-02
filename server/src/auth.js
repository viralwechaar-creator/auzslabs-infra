import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomInt } from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';
import { SignJWT, importPKCS8, createRemoteJWKSet, jwtVerify } from 'jose';
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
    `select au.id, au.email, au.password_hash, au.app_metadata, au.user_metadata, p.email_verified
     from auth_users au left join profiles p on p.id = au.id
     where au.email = $1 and au.deleted_at is null`,
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

// =========================================================
// Real identity providers (db/069_real_auth_providers.sql). One
// auth_users row, many ways in -- see that migration's own comment for
// the full rationale. findOrCreateIdentityUser is the one place that
// decides "is this a returning user, an existing email/password account
// adding a new way in, or a brand-new signup" -- Google/Apple/phone all
// funnel through it so that logic only exists once.
// =========================================================

// 1. Already linked to this exact provider identity -- the common case
//    for a returning user.
// 2. Not linked yet, but the provider handed us a verified email that
//    matches an existing account (e.g. they signed up with a password
//    first, now trying Google with the same address) -- link it rather
//    than creating a second, disconnected account.
// 3. Neither -- a brand-new account, created in the same "bare, no
//    tenant yet" shape /auth/signup already uses (on_signup's trigger
//    skips the profiles row when app_metadata has no tenant_id); it
//    becomes a real tenant owner the same way any other self-signup
//    does, once a platform admin approves a signup_request.
async function findOrCreateIdentityUser({ provider, providerId, email }) {
  const linked = await pool.query(
    `select u.id, u.email, u.app_metadata, u.user_metadata
     from auth_identities i join auth_users u on u.id = i.user_id
     where i.provider = $1 and i.provider_id = $2 and u.deleted_at is null`,
    [provider, providerId],
  );
  if (linked.rows[0]) return linked.rows[0];

  if (email) {
    const byEmail = await pool.query(
      `select id, email, app_metadata, user_metadata from auth_users where email = $1 and deleted_at is null`,
      [email],
    );
    if (byEmail.rows[0]) {
      await pool.query(
        `insert into auth_identities (user_id, provider, provider_id, email) values ($1,$2,$3,$4)
         on conflict (provider, provider_id) do nothing`,
        [byEmail.rows[0].id, provider, providerId, email],
      );
      return byEmail.rows[0];
    }
  }

  // phone has no email; every other provider that reaches this point
  // either didn't share one or genuinely doesn't have one verified --
  // auth_users.email is unique+not null, so a synthetic placeholder
  // keeps the row valid without ever colliding with a real address.
  const placeholderEmail = email || `${provider}.${providerId}@users.auzslab.in`;
  const created = await pool.query(
    `insert into auth_users (email, password_hash, app_metadata) values ($1, null, '{}')
     returning id, email, app_metadata, user_metadata`,
    [placeholderEmail],
  );
  await pool.query(
    `insert into auth_identities (user_id, provider, provider_id, email) values ($1,$2,$3,$4)`,
    [created.rows[0].id, provider, providerId, email],
  );
  return created.rows[0];
}

function identitySession(row) {
  const user = { id: row.id, email: row.email, app_metadata: row.app_metadata, user_metadata: row.user_metadata };
  return { access_token: signToken(user), user };
}

// ---- Google ----

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const googleClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;

// idToken: the credential Google Identity Services hands the browser
// directly (https://accounts.google.com/gsi/client) -- verified here,
// server-side, never trusted as-is from the client.
export async function loginWithGoogle(idToken) {
  if (!googleClient) throw new Error('Google sign-in is not configured yet');
  const ticket = await googleClient.verifyIdToken({ idToken, audience: GOOGLE_CLIENT_ID });
  const payload = ticket.getPayload();
  if (!payload || !payload.sub) throw new Error('invalid Google token');
  const row = await findOrCreateIdentityUser({
    provider: 'google',
    providerId: payload.sub,
    email: payload.email_verified ? payload.email : null,
  });
  return identitySession(row);
}

// ---- Apple ----

const APPLE_TEAM_ID = process.env.APPLE_TEAM_ID || '';
const APPLE_KEY_ID = process.env.APPLE_KEY_ID || '';
const APPLE_CLIENT_ID = process.env.APPLE_CLIENT_ID || ''; // the Services ID, e.g. in.auzslab.web
const APPLE_PRIVATE_KEY = (process.env.APPLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'); // the .p8 key's contents
const appleJwks = createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys'));

// Apple's "client secret" isn't a static value -- it's a short-lived JWT
// this server signs itself with the private key from the .p8 file
// downloaded once from the Apple Developer portal when the Sign In with
// Apple key was created.
async function appleClientSecret() {
  const key = await importPKCS8(APPLE_PRIVATE_KEY, 'ES256');
  return new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid: APPLE_KEY_ID })
    .setIssuer(APPLE_TEAM_ID)
    .setIssuedAt()
    .setExpirationTime('5m')
    .setAudience('https://appleid.apple.com')
    .setSubject(APPLE_CLIENT_ID)
    .sign(key);
}

// code: the authorization code Apple's JS SDK (AppleID.auth.signIn())
// hands the browser -- exchanged here for an id_token, which is then
// verified against Apple's own published signing keys (JWKS), never
// trusted as a bare claim from the client.
export async function loginWithApple(code) {
  if (!APPLE_TEAM_ID || !APPLE_KEY_ID || !APPLE_CLIENT_ID || !APPLE_PRIVATE_KEY) {
    throw new Error('Sign in with Apple is not configured yet');
  }
  const clientSecret = await appleClientSecret();
  const res = await fetch('https://appleid.apple.com/auth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: APPLE_CLIENT_ID,
      client_secret: clientSecret,
      code,
      grant_type: 'authorization_code',
    }),
  });
  if (!res.ok) throw new Error('Apple sign-in failed');
  const { id_token } = await res.json();
  const { payload } = await jwtVerify(id_token, appleJwks, {
    issuer: 'https://appleid.apple.com',
    audience: APPLE_CLIENT_ID,
  });
  if (!payload.sub) throw new Error('invalid Apple token');
  const emailVerified = payload.email_verified === true || payload.email_verified === 'true';
  const row = await findOrCreateIdentityUser({
    provider: 'apple',
    providerId: payload.sub,
    email: emailVerified ? payload.email : null,
  });
  return identitySession(row);
}

// ---- Phone / OTP ----

// Returns the plaintext code for the caller (index.js) to send via
// sms.js -- never logged, never stored anywhere but as its own bcrypt
// hash below (same discipline as a password).
export async function createPhoneOtp(phone) {
  const code = String(randomInt(100000, 1000000));
  const code_hash = await bcrypt.hash(code, 10);
  await pool.query('insert into phone_otps (phone, code_hash) values ($1, $2)', [phone, code_hash]);
  return code;
}

// Capped at 5 guesses per sent code (on top of the per-IP rate limit on
// the /auth/phone/verify endpoint itself) -- a 6-digit code is only
// ~1,000,000 possibilities, so limiting attempts matters more here than
// it does for a real password.
export async function loginWithPhone(phone, code) {
  const { rows } = await pool.query(
    `select id, code_hash, attempts from phone_otps
     where phone = $1 and used_at is null and expires_at > now()
     order by created_at desc limit 1`,
    [phone],
  );
  const row = rows[0];
  if (!row || row.attempts >= 5) return null;
  const ok = await bcrypt.compare(code, row.code_hash);
  await pool.query('update phone_otps set attempts = attempts + 1 where id = $1', [row.id]);
  if (!ok) return null;
  await pool.query('update phone_otps set used_at = now() where id = $1', [row.id]);
  const user = await findOrCreateIdentityUser({ provider: 'phone', providerId: phone, email: null });
  return identitySession(user);
}

// ---- Self-service password reset ----

// Returns null for an unknown email without the caller treating that
// differently from a known one (the /auth/forgot endpoint always
// replies the same way either way) -- this function existing at all is
// the only place that actually knows whether the account exists.
export async function createPasswordReset(email) {
  const { rows } = await pool.query('select id from auth_users where email = $1 and deleted_at is null', [email]);
  if (!rows[0]) return null;
  const { rows: tokenRows } = await pool.query(
    'insert into password_resets (user_id) values ($1) returning token',
    [rows[0].id],
  );
  return tokenRows[0].token;
}

export async function resetPassword(token, newPassword) {
  const { rows } = await pool.query(
    'select user_id from password_resets where token = $1 and used_at is null and expires_at > now()',
    [token],
  );
  if (!rows[0]) return false;
  const password_hash = await bcrypt.hash(newPassword, 12);
  await pool.query('update auth_users set password_hash = $1 where id = $2', [password_hash, rows[0].user_id]);
  await pool.query('update password_resets set used_at = now() where token = $1', [token]);
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
