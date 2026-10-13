import bcrypt from 'bcryptjs';
import { randomInt } from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';
import { SignJWT, importPKCS8, createRemoteJWKSet, jwtVerify } from 'jose';
import { pool } from '../db.js';
import { sessionOrChallenge } from './twofa.js';
import { revokeAllSessionsForUser } from './sessions.js';

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
      // Pre-hijack guard: if this address was only ever signed up with a password (never proven), someone else
      // may have registered it first. The provider has now proven the real owner, so drop that password and any
      // sessions it opened; the real owner can set a new one with "forgot password".
      const un = await pool.query(
        `update auth_users set email_verified_at = now(), password_hash = null
         where id = $1 and email_verified_at is null returning id`,
        [byEmail.rows[0].id],
      );
      if (un.rows[0]) await revokeAllSessionsForUser(byEmail.rows[0].id).catch(() => {});
      return byEmail.rows[0];
    }
  }

  // phone has no email; every other provider that reaches this point
  // either didn't share one or genuinely doesn't have one verified --
  // auth_users.email is unique+not null, so a synthetic placeholder
  // keeps the row valid without ever colliding with a real address.
  const placeholderEmail = email || `${provider}.${providerId}@users.auzslab.in`;
  const created = await pool.query(
    `insert into auth_users (email, password_hash, app_metadata, email_verified_at) values ($1, null, '{}', now())
     returning id, email, app_metadata, user_metadata`,
    [placeholderEmail],
  );
  await pool.query(
    `insert into auth_identities (user_id, provider, provider_id, email) values ($1,$2,$3,$4)`,
    [created.rows[0].id, provider, providerId, email],
  );
  return created.rows[0];
}

async function identitySession(row, meta) {
  // findOrCreateIdentityUser's own lookups already exclude a deleted account
  // (its queries filter deleted_at is null); disabled_at (admin suspension,
  // db/087) is checked here instead, at the one place all three providers
  // (Google/Apple/phone) converge, rather than threading it through every
  // lookup branch above (including the brand-new-account branch, where it
  // would always be null anyway).
  const { rows } = await pool.query('select disabled_at from auth_users where id = $1', [row.id]);
  if (rows[0]?.disabled_at) return null;
  const user = { id: row.id, email: row.email, app_metadata: row.app_metadata, user_metadata: row.user_metadata };
  return sessionOrChallenge(user, meta);
}

// ---- Google ----

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const googleClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;

// idToken: the credential Google Identity Services hands the browser
// directly (https://accounts.google.com/gsi/client) -- verified here,
// server-side, never trusted as-is from the client.
export async function loginWithGoogle(idToken, meta) {
  if (!googleClient) throw new Error('Google sign-in is not configured yet');
  const ticket = await googleClient.verifyIdToken({ idToken, audience: GOOGLE_CLIENT_ID });
  const payload = ticket.getPayload();
  if (!payload || !payload.sub) throw new Error('invalid Google token');
  const row = await findOrCreateIdentityUser({
    provider: 'google',
    providerId: payload.sub,
    email: payload.email_verified ? payload.email : null,
  });
  return identitySession(row, meta);
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
export async function loginWithApple(code, meta) {
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
  return identitySession(row, meta);
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
export async function loginWithPhone(phone, code, meta) {
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
  return identitySession(user, meta);
}
