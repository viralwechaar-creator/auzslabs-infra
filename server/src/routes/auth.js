import { createHash } from 'node:crypto';
import { withAuth, pool } from '../db.js';
import { callRpc } from '../data/queries.js';
import { login, createUser, signToken, refreshToken, loginWithGoogle, loginWithApple, createPhoneOtp, loginWithPhone, createPasswordReset, resetPassword, deleteOwnAccount, listSessions, revokeSession, staffLogin, createEmailVerification, confirmEmailVerification, emailVerificationState, passwordSignupAllowed, verify2faChallenge, my2faStatus, generate2faSecret, confirm2fa, disable2fa, verifyPassword, emailInUse, createEmailChange, confirmEmailChange, createRecoveryEmailVerification, confirmRecoveryEmail, removeRecoveryEmail } from '../auth.js';
import { sendPasswordResetEmail, sendEmailVerification, sendEmailChangeVerification, sendRecoveryEmailVerification, mailConfigured } from '../mail.js';
import { verifyCaptcha, captchaEnabled } from '../captcha.js';
import { sendOtpSms } from '../sms.js';
import { DEMO_LOGIN_EMAILS, SITE_URL, safeResetBase } from '../config.js';
import { HttpError, rateLimited, readJsonBody } from '../lib/http.js';

// Returns false when none of this module's routes matched, so the dispatcher in index.js tries the next module;
// any other return (including the undefined that `return reply(...)` gives) means the request was handled.
export async function handle(ctx) {
  const { req, res, url, user, ip, meta, reply, origin } = ctx;
  // ---- auth ----
  // ---- staff sign-in: username + PIN (db/096). Same reply shape as /auth/login. ----
  if (url.pathname === '/auth/staff-login' && req.method === 'POST') {
    const { username, pin } = await readJsonBody(req);
    if (rateLimited(`staffpin:${ip}`, 40, 15 * 60_000)) throw new HttpError(429, 'too many attempts, try again later');
    const result = await staffLogin(username, pin, meta);
    if (!result) throw new HttpError(401, 'Wrong username or PIN');
    if (result.locked) throw new HttpError(429, 'Too many wrong PINs. Try again in 15 minutes, or ask your owner to reset your PIN.');
    return reply(200, result);
  }
  if (url.pathname === '/auth/login' && req.method === 'POST') {
    let { email, password } = await readJsonBody(req);
    // a bare username (no @) is a build-page trial login
    if (typeof email === 'string' && email.trim() && !email.includes('@')) email = `${email.trim().toLowerCase()}@trial.auzslab.in`;
    // 20 attempts / 15 min per IP for real accounts -- bcrypt is
    // expensive on purpose, and login is the endpoint most worth
    // brute-forcing. The two published demo logins get a far looser,
    // separate bucket (see DEMO_LOGIN_EMAILS above) so a crowd of
    // prospects sharing one IP don't lock each other out of a login
    // that's meant to be tried by strangers.
    const isDemo = typeof email === 'string' && DEMO_LOGIN_EMAILS.has(email.trim().toLowerCase());
    const bucket = isDemo ? `demologin:${ip}` : `login:${ip}`;
    const limit = isDemo ? 300 : 20;
    if (rateLimited(bucket, limit, 15 * 60_000)) throw new HttpError(429, 'too many login attempts, try again later');
    // Also limit per account, so a crowd of different addresses cannot take turns guessing one person's password.
    if (!isDemo && typeof email === 'string' && rateLimited(`loginacct:${email.trim().toLowerCase()}`, 30, 15 * 60_000)) throw new HttpError(429, 'too many login attempts for this account, try again later');
    const result = await login(email, password, meta);
    if (!result) throw new HttpError(401, 'invalid credentials');
    if (result.unverified) throw new HttpError(403, 'Please verify your email first -- check your inbox for the verification link, or ask your manager to resend it.');
    return reply(200, result);
  }
  // ---- build page: make a username + password and start the 3-day trial in one step (no email, no Google).
  // The login is stored as <username>@trial.auzslab.in (never mailed); /auth/login accepts the bare username.
  if (url.pathname === '/auth/trial-account' && req.method === 'POST') {
    if (rateLimited(`trialacct:${ip}`, 6, 60 * 60_000)) throw new HttpError(429, 'Too many trials started from this network. Try again in an hour.');
    const b = await readJsonBody(req);
    const username = String(b.username || '').trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9._-]{2,23}$/.test(username)) throw new HttpError(400, 'Username: 3 to 24 letters, numbers, dots, dashes or underscores.');
    if (String(b.password || '').length < 8) throw new HttpError(400, 'Password must be at least 8 characters.');
    if (!(await verifyCaptcha(b.captcha_token, ip))) throw new HttpError(400, 'Please complete the verification check and try again.');
    let created;
    try { created = await createUser({ email: `${username}@trial.auzslab.in`, password: String(b.password), verified: true, user_metadata: { trial_username: username } }); }
    catch (err) { if (err.code === '23505') throw new HttpError(409, 'That username is taken. Pick another one.'); throw err; }
    try {
      const p = { business_name: b.business_name, contact_name: b.contact_name, phone: b.phone, business_type: b.business_type, blocks: b.blocks, features: b.features };
      await withAuth(created.id, (client) => callRpc(client, 'start_self_trial', { p }));
    } catch (err) {
      await pool.query('delete from auth_users where id = $1', [created.id]).catch(() => {});   // nothing was made for them, so do not leave a half-made login behind
      throw err;
    }
    return reply(200, { access_token: await signToken(created, meta), user: created });
  }
  // ---- silent session renewal (owner report: POS clients got logged out
  // "again and again" mid-shift -- nothing ever refreshed a token before
  // this, so it expired exactly 7 days after the last LOGIN regardless of
  // how actively someone kept using the app). Needs an already-valid,
  // non-expired, non-revoked token -- a session that's truly gone stale
  // still gets a plain 401 here and has to sign in again, same as today. ----
  if (url.pathname === '/auth/refresh' && req.method === 'POST') {
    await readJsonBody(req).catch(() => {});
    if (!user) throw new HttpError(401, 'Your session is no longer valid. Please sign in again.');
    if (rateLimited(`refresh:${user.id}`, 60, 15 * 60_000)) throw new HttpError(429, 'too many refresh attempts, try again later');
    // A setup person's session on a client's business (db/176) is time-limited on purpose: it is never renewed.
    if (user.lim) throw new HttpError(403, 'this session cannot be extended');
    return reply(200, { access_token: refreshToken(user), user: { id: user.id, email: user.email, app_metadata: user.app_metadata } });
  }
  // ---- public self-serve signup: creates a bare login with no
  // tenant_id yet (on_signup's guard skips the profiles row for it,
  // same as a platform_admin) -- becomes a real tenant owner only
  // once a platform_admin approves their signup_request. ----
  if (url.pathname === '/auth/signup' && req.method === 'POST') {
    // 10 accounts / hour per IP -- loose enough for a shared cafe/office
    // IP, tight enough to block scripted account-spam.
    if (rateLimited(`signup:${ip}`, 10, 60 * 60_000)) throw new HttpError(429, 'too many signups from this network, try again later');
    if (!(await passwordSignupAllowed())) throw new HttpError(403, 'Email sign-up is switched off. Please sign up with Google.');
    const { email, password, captcha_token } = await readJsonBody(req);
    if (!email || !password) throw new HttpError(400, 'email and password are required');
    if (password.length < 8) throw new HttpError(400, 'password must be at least 8 characters');
    if (!(await verifyCaptcha(captcha_token, ip))) throw new HttpError(400, 'Please complete the verification check and try again.');
    let created;
    try {
      created = await createUser({ email, password });
    } catch (err) {
      if (err.code === '23505') throw new HttpError(409, 'an account with that email already exists');
      throw err;
    }
    // mail the confirmation link (quietly does nothing if no mail sender is configured yet)
    const vtoken = await createEmailVerification(created.id, created.email);
    const vmail = await sendEmailVerification({ to: created.email, verifyLink: `${SITE_URL}/verify-email.html?token=${vtoken}` }).catch(() => ({ sent: false }));
    return reply(200, { access_token: await signToken(created, meta), user: created, email_verification: { sent: !!vmail.sent, verified: false } });
  }
  // ---- Google / Apple / phone sign-in (db/069) -- each finds or
  // creates an auth_users row via findOrCreateIdentityUser and returns
  // the exact same {access_token,user} shape /auth/login does, so the
  // client treats every sign-in method identically from here on. ----
  // ---- email verification (db/092) ----
  if (url.pathname === '/auth/verify-email' && req.method === 'POST') {
    if (rateLimited(`verifyemail:${ip}`, 30, 15 * 60_000)) throw new HttpError(429, 'too many attempts, try again later');
    const { token } = await readJsonBody(req);
    const r = await confirmEmailVerification(token);
    if (!r.ok) throw new HttpError(400, 'This confirmation link is invalid or has expired. Sign in and ask for a new one.');
    return reply(200, { ok: true, email: r.email });
  }
  if (url.pathname === '/auth/resend-verification' && req.method === 'POST') {
    if (!user) throw new HttpError(401, 'authentication required');
    if (rateLimited(`resendverify:${user.id}`, 3, 60 * 60_000)) throw new HttpError(429, 'we already sent you a few links; check your inbox and spam folder, or try again in an hour');
    const st = await emailVerificationState(user.id);
    if (!st) throw new HttpError(404, 'account not found');
    if (st.verified) return reply(200, { ok: true, verified: true, sent: false });
    const vtoken = await createEmailVerification(user.id, st.email);
    const vmail = await sendEmailVerification({ to: st.email, verifyLink: `${SITE_URL}/verify-email.html?token=${vtoken}` }).catch(() => ({ sent: false }));
    return reply(200, { ok: true, verified: false, sent: !!vmail.sent });
  }
  // ---- login-email change + recovery email (db/121) ----
  const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
  if (url.pathname === '/auth/change-email/request' && req.method === 'POST') {
    if (!user) throw new HttpError(401, 'authentication required');
    if (rateLimited(`changeemail:${user.id}`, 5, 60 * 60_000)) throw new HttpError(429, 'too many attempts, try again in an hour');
    const { new_email, password } = await readJsonBody(req);
    if (!new_email || !EMAIL_RE.test(new_email)) throw new HttpError(400, 'that does not look like a valid email address');
    if (!(await verifyPassword(user.id, password))) throw new HttpError(401, 'your current password is incorrect');
    if (await emailInUse(new_email, user.id)) throw new HttpError(409, 'that email is already in use by another account');
    const token = await createEmailChange(user.id, new_email);
    const link = `${SITE_URL}/confirm-email.html?type=change&token=${token}`;
    const mail = await sendEmailChangeVerification({ to: new_email, verifyLink: link }).catch(() => ({ sent: false }));
    return reply(200, { ok: true, sent: !!mail.sent, link: mailConfigured() ? undefined : link });
  }
  if (url.pathname === '/auth/change-email/confirm' && req.method === 'POST') {
    if (rateLimited(`changeemailconfirm:${ip}`, 30, 15 * 60_000)) throw new HttpError(429, 'too many attempts, try again later');
    const { token } = await readJsonBody(req);
    const r = await confirmEmailChange(token);
    if (!r.ok) throw new HttpError(400, r.reason === 'taken' ? 'That email was taken by another account before this link was opened. Please start again with a different address.' : 'This confirmation link is invalid or has expired. Please ask for a new one.');
    return reply(200, { ok: true, email: r.email });
  }
  if (url.pathname === '/auth/recovery-email/request' && req.method === 'POST') {
    if (!user) throw new HttpError(401, 'authentication required');
    if (rateLimited(`recoveryemail:${user.id}`, 5, 60 * 60_000)) throw new HttpError(429, 'too many attempts, try again in an hour');
    const { email } = await readJsonBody(req);
    if (!email || !EMAIL_RE.test(email)) throw new HttpError(400, 'that does not look like a valid email address');
    const token = await createRecoveryEmailVerification(user.id, email);
    const link = `${SITE_URL}/confirm-email.html?type=recovery&token=${token}`;
    const mail = await sendRecoveryEmailVerification({ to: email, verifyLink: link }).catch(() => ({ sent: false }));
    return reply(200, { ok: true, sent: !!mail.sent, link: mailConfigured() ? undefined : link });
  }
  if (url.pathname === '/auth/recovery-email/confirm' && req.method === 'POST') {
    if (rateLimited(`recoveryemailconfirm:${ip}`, 30, 15 * 60_000)) throw new HttpError(429, 'too many attempts, try again later');
    const { token } = await readJsonBody(req);
    const r = await confirmRecoveryEmail(token);
    if (!r.ok) throw new HttpError(400, 'This confirmation link is invalid or has expired. Please ask for a new one.');
    return reply(200, { ok: true, email: r.email });
  }
  if (url.pathname === '/auth/recovery-email/remove' && req.method === 'POST') {
    if (!user) throw new HttpError(401, 'authentication required');
    await removeRecoveryEmail(user.id);
    return reply(200, { ok: true });
  }
  if (url.pathname === '/auth/google' && req.method === 'POST') {
    if (rateLimited(`oauth:${ip}`, 30, 15 * 60_000)) throw new HttpError(429, 'too many attempts, try again later');
    const { id_token } = await readJsonBody(req);
    if (!id_token) throw new HttpError(400, 'id_token is required');
    let result;
    try {
      result = await loginWithGoogle(id_token, meta);
    } catch (err) {
      throw new HttpError(401, err.message || 'Google sign-in failed');
    }
    if (!result) throw new HttpError(401, 'this account has been suspended');
    return reply(200, result);
  }
  if (url.pathname === '/auth/apple' && req.method === 'POST') {
    if (rateLimited(`oauth:${ip}`, 30, 15 * 60_000)) throw new HttpError(429, 'too many attempts, try again later');
    const { code } = await readJsonBody(req);
    if (!code) throw new HttpError(400, 'code is required');
    let result;
    try {
      result = await loginWithApple(code, meta);
    } catch (err) {
      throw new HttpError(401, err.message || 'Apple sign-in failed');
    }
    if (!result) throw new HttpError(401, 'this account has been suspended');
    return reply(200, result);
  }
  // 5 codes / 10 min per phone number, on top of the per-IP bucket --
  // a phone number is the actual scarce resource worth brute-forcing
  // here (an attacker rotating IPs still can't out-text the phone).
  if (url.pathname === '/auth/phone/send' && req.method === 'POST') {
    if (rateLimited(`phonesend:${ip}`, 20, 15 * 60_000)) throw new HttpError(429, 'too many attempts, try again later');
    const { phone } = await readJsonBody(req);
    if (!phone || !/^\+[1-9]\d{6,14}$/.test(phone)) throw new HttpError(400, 'a phone number in +<countrycode><number> format is required');
    if (rateLimited(`phonesend:${phone}`, 5, 10 * 60_000)) throw new HttpError(429, 'too many codes sent to this number, try again later');
    const code = await createPhoneOtp(phone);
    const sent = await sendOtpSms(phone, code);
    return reply(200, sent);
  }
  if (url.pathname === '/auth/phone/verify' && req.method === 'POST') {
    if (rateLimited(`phoneverify:${ip}`, 30, 15 * 60_000)) throw new HttpError(429, 'too many attempts, try again later');
    const { phone, code } = await readJsonBody(req);
    if (!phone || !code) throw new HttpError(400, 'phone and code are required');
    const result = await loginWithPhone(phone, code, meta);
    if (!result) throw new HttpError(401, 'that code is invalid or has expired');
    return reply(200, result);
  }

  // ---- self-service password reset (db/069) ----
  // Always replies the same way whether or not the email exists --
  // only createPasswordReset itself (and the server log) knows which.
  // reset_link_base is the page the CALLER wants the link to open
  // (e.g. https://auzslab.in/reset-password.html) -- same split as
  // /staff/send-invite-email, so the server never hardcodes a frontend
  // path.
  if (url.pathname === '/auth/forgot' && req.method === 'POST') {
    if (rateLimited(`forgot:${ip}`, 10, 15 * 60_000)) throw new HttpError(429, 'too many attempts, try again later');
    const { email, reset_link_base } = await readJsonBody(req);
    if (!email || !reset_link_base) throw new HttpError(400, 'email and reset_link_base are required');
    // At most 3 reset mails per address per hour, so nobody can fill a stranger's inbox. Same reply either way (no way to tell which addresses exist).
    if (rateLimited(`forgotmail:${String(email).trim().toLowerCase()}`, 3, 60 * 60_000)) return reply(200, { ok: true, message: 'If an account exists for that email, a reset link has been sent.' });
    const token = await createPasswordReset(email);
    if (token) {
      // Never trust the caller's page: a reset link must open on our own site, or an attacker could get a victim a real reset email that points at their own page.
      const base = safeResetBase(reset_link_base);
      const resetLink = `${base}${base.includes('?') ? '&' : '?'}token=${token}`;
      await sendPasswordResetEmail({ to: email, resetLink }).catch((err) => console.warn('password reset email failed', err));
    }
    return reply(200, { ok: true, message: 'If an account exists for that email, a reset link has been sent.' });
  }
  if (url.pathname === '/auth/reset' && req.method === 'POST') {
    if (rateLimited(`reset:${ip}`, 20, 15 * 60_000)) throw new HttpError(429, 'too many attempts, try again later');
    const { token, password } = await readJsonBody(req);
    if (!token || !password) throw new HttpError(400, 'token and password are required');
    if (password.length < 8) throw new HttpError(400, 'password must be at least 8 characters');
    const ok = await resetPassword(token, password);
    if (!ok) throw new HttpError(400, 'this reset link is invalid or has expired');
    return reply(200, { ok: true });
  }

  // ---- self-service account deletion (Apple Guideline 5.1.1(v)) ----
  if (url.pathname === '/auth/delete-account' && req.method === 'POST') {
    if (!user) throw new HttpError(401, 'authentication required');
    // A leaked/stolen JWT (e.g. an XSS token theft) shouldn't let an
    // attacker brute-force the password confirmation unlimited times --
    // same discipline as every other password check in this file.
    if (rateLimited(`delacct:${user.id}`, 10, 15 * 60_000)) throw new HttpError(429, 'too many attempts, try again later');
    const { password } = await readJsonBody(req);
    try {
      await deleteOwnAccount(user.id, password);
    } catch (err) {
      throw new HttpError(err.message === 'incorrect password' ? 401 : 400, err.message);
    }
    return reply(200, { ok: true });
  }

  if (url.pathname === '/auth/session' && req.method === 'GET') {
    if (!user) throw new HttpError(401, 'no session');
    const vs = await emailVerificationState(user.id);
    return reply(200, { user, email_verified: vs ? vs.verified : true, captcha: captchaEnabled() });
  }

  // ---- two-factor authentication (TOTP, db/117) ----
  // /auth/login, /auth/google, /auth/apple and /auth/phone/verify above
  // already pass whatever login()/loginWithGoogle()/etc. return straight
  // through to the client, so a {requires2fa, challenge} reply needs no
  // change there -- this is the one new step a client takes in between:
  // show a 6-digit code box, then call this with the challenge it got.
  if (url.pathname === '/auth/2fa/challenge' && req.method === 'POST') {
    if (rateLimited(`2fa:${ip}`, 20, 15 * 60_000)) throw new HttpError(429, 'too many attempts, try again later');
    const { challenge, code } = await readJsonBody(req);
    if (!challenge || !code) throw new HttpError(400, 'challenge and code are required');
    // Each sign-in challenge gets only a few guesses in total (a 6-digit code must not be guessable from many networks at once).
    if (rateLimited(`2fach:${createHash('sha256').update(String(challenge)).digest('hex')}`, 8, 10 * 60_000)) throw new HttpError(429, 'too many wrong codes, sign in again');
    const result = await verify2faChallenge(challenge, code, meta);
    if (!result) throw new HttpError(401, 'that code is wrong or has expired');
    return reply(200, result);
  }
  if (url.pathname === '/auth/2fa/status' && req.method === 'GET') {
    if (!user) throw new HttpError(401, 'authentication required');
    return reply(200, await my2faStatus(user.id));
  }
  // Setup is gated to a tenant owner/manager -- this protects the
  // login of the person who can do the most damage if it's
  // compromised, not every staff login (shop-floor username+PIN
  // logins are untouched by 2FA). A platform admin account is
  // explicitly refused too, not just left unsupported in the UI:
  // site/admin.html and app/public/admin/onboard.html (the owner's own
  // client-onboarding tools) are deliberately never routed through a
  // 2FA prompt, and this check makes it true at the server, not just
  // by missing UI -- the owner's own ability to onboard a new client
  // must never depend on a second factor surviving on this account.
  if (url.pathname === '/auth/2fa/setup' && req.method === 'POST') {
    if (!user) throw new HttpError(401, 'authentication required');
    // profiles has owner-read-only RLS (db/002's p_read policy, using id = app_uid() or...) -- a bare
    // pool.query here never sets app.uid, so app_uid() is null and the policy hides every row, meaning
    // this check always returned "not found" for a real owner/manager under the app role (confirmed
    // against a real running server: a real owner login got 403 "not available" every single time).
    // Same bug shape this file has already hit twice before (createOrder()'s RLS read, storage.js's
    // saveSiteUpload) -- wrap in withAuth so the policy actually sees who is asking.
    const { rows } = await withAuth(user.id, (client) => client.query('select role from profiles where id = $1', [user.id]));
    if (!rows[0] || !['owner', 'manager'].includes(rows[0].role)) throw new HttpError(403, 'Two-factor authentication is only available to a business\'s own owner or manager account.');
    if (rateLimited(`2fasetup:${user.id}`, 10, 15 * 60_000)) throw new HttpError(429, 'too many attempts, try again later');
    return reply(200, await generate2faSecret(user.id, user.email));
  }
  if (url.pathname === '/auth/2fa/confirm' && req.method === 'POST') {
    if (!user) throw new HttpError(401, 'authentication required');
    if (rateLimited(`2faconfirm:${user.id}`, 10, 15 * 60_000)) throw new HttpError(429, 'too many attempts, try again later');
    const { code } = await readJsonBody(req);
    const result = await confirm2fa(user.id, code);
    if (!result) throw new HttpError(400, 'that code did not match -- scan the QR code again and try the newest code shown');
    return reply(200, result);
  }
  if (url.pathname === '/auth/2fa/disable' && req.method === 'POST') {
    if (!user) throw new HttpError(401, 'authentication required');
    if (rateLimited(`2fadisable:${user.id}`, 10, 15 * 60_000)) throw new HttpError(429, 'too many attempts, try again later');
    const { password, code } = await readJsonBody(req);
    const ok = await disable2fa(user.id, { password, code });
    if (!ok) throw new HttpError(401, 'enter your password or a valid code to turn this off');
    return reply(200, { ok: true });
  }

  // ---- single-device session revocation (db/071) ----
  if (url.pathname === '/auth/sessions' && req.method === 'GET') {
    if (!user) throw new HttpError(401, 'authentication required');
    const sessions = await listSessions(user.id);
    return reply(200, { sessions: sessions.map((s) => ({ ...s, current: s.jti === user.jti })) });
  }
  const revokeMatch = url.pathname.match(/^\/auth\/sessions\/([0-9a-f-]{36})\/revoke$/);
  if (revokeMatch && req.method === 'POST') {
    if (!user) throw new HttpError(401, 'authentication required');
    if (rateLimited(`revokesess:${user.id}`, 30, 15 * 60_000)) throw new HttpError(429, 'too many attempts, try again later');
    try {
      await revokeSession(user.id, revokeMatch[1]);
    } catch (err) {
      throw new HttpError(404, err.message || 'session not found');
    }
    return reply(200, { ok: true });
  }
  return false;
}
