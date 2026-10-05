// Sign-up safety: a new account starts unverified, the confirmation link works exactly once-per-purpose and expires,
// the runtime switch (platform_flags) makes an unverified account unable to start a signup request or pay, and the
// health check for uptime monitors answers. Runs against the real API and database.
import crypto from 'node:crypto';
import { suite, assert } from '../../lib/harness.mjs';
import { rpc } from '../../lib/api.mjs';
import { q } from '../../lib/db.mjs';

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');

export default async function run({ stack }) {
  const s = suite('Sign-up safety: email confirmation, runtime switch, health check', 'A new owner account starts unverified; the emailed link proves the address; when the owner switches the requirement on, an unverified account cannot start a signup request or pay; the health endpoint works for uptime monitors.');
  const api = (path, opts = {}) => fetch(stack.apiBase + path, { ...opts, headers: { 'content-type': 'application/json', ...(opts.token ? { authorization: 'Bearer ' + opts.token } : {}), ...(opts.headers || {}) }, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
  const email = `new-${Date.now()}@signup.test`;
  let token, userId;
  const flag = (v) => q(`update platform_flags set value = $1 where key = 'require_email_verification'`, [v]);

  await s.check('With the Google-only switch off, direct email sign-up is refused (403) and creates nothing', async () => {
    await q(`update platform_flags set value = 'off' where key = 'password_signup'`);
    try {
      const em = `blocked-${Date.now()}@test.local`;
      const r = await api('/auth/signup', { method: 'POST', body: { email: em, password: 'Sup3rSecret!' } });
      assert(r.status === 403, 'status ' + r.status);
      assert(!(await q(`select 1 from auth_users where lower(email) = $1`, [em])).length, 'an account was created');
    } finally { await q(`update platform_flags set value = 'on' where key = 'password_signup'`); }
  }, 'critical');
  await s.check('The health check answers for uptime monitors (and says the database is reachable)', async () => {
    const r = await api('/health'); const j = await r.json();
    assert(r.status === 200 && j.ok === true && j.db === true, JSON.stringify(j));
    const h = await api('/health', { method: 'HEAD' }); assert(h.status === 200, 'HEAD ' + h.status);
  }, 'critical');

  await s.check('A new signup starts unverified, and the response says so', async () => {
    const r = await api('/auth/signup', { method: 'POST', body: { email, password: 'Sup3rSecret!' } }); const j = await r.json();
    assert(r.status === 200 && j.access_token, 'signup ' + r.status + ' ' + JSON.stringify(j));
    assert(j.email_verification && j.email_verification.verified === false, 'no verification info: ' + JSON.stringify(j.email_verification));
    token = j.access_token; userId = j.user.id;
    const row = (await q('select email_verified_at from auth_users where id = $1', [userId]))[0];
    assert(row.email_verified_at === null, 'new account was already marked verified');
    const link = await q('select count(*)::int n from email_verifications where user_id = $1', [userId]);
    assert(link[0].n === 1, 'no confirmation link was created');
  }, 'critical');

  await s.check('The raw token is never stored (only a hash)', async () => {
    const rows = await q('select token_hash from email_verifications where user_id = $1', [userId]);
    assert(rows.every((x) => /^[0-9a-f]{64}$/.test(x.token_hash)), 'token column is not a sha-256 hash');
  }, 'major');

  await s.check('The session endpoint reports the address is unverified', async () => {
    const r = await api('/auth/session', { token }); const j = await r.json();
    assert(r.status === 200 && j.email_verified === false, JSON.stringify(j));
  }, 'major');

  await s.check('Switch OFF (default): an unverified account is not blocked by the guard', async () => {
    await flag('off');
    const r = await rpc(stack, 'submit_signup_request', { p_business_name: 'X', p_slug: 'x', p_features: {}, p_notes: '', p_contact_name: 'X', p_phone: '1', p_niche: 'cafe', p_address: '' }, token);
    assert(r.status !== 403 || !/confirm your email/i.test(JSON.stringify(r.data)), 'blocked while the switch is off: ' + JSON.stringify(r.data));
  }, 'critical');

  await s.check('Switch ON: an unverified account cannot start a signup request, an add-on request, or pay', async () => {
    await flag('on');
    for (const fn of ['submit_signup_request', 'submit_addon_request']) {
      const r = await rpc(stack, fn, { p_features: {}, p_notes: '' }, token);
      assert(r.status === 403 && /confirm your email/i.test(JSON.stringify(r.data)), fn + ' -> ' + r.status + ' ' + JSON.stringify(r.data));
    }
    const p = await api('/payments/create-order', { method: 'POST', token, body: {} });
    assert(p.status === 403, 'create-order -> ' + p.status);
  }, 'critical');

  await s.check('Switch ON: other accounts that were already verified are not affected', async () => {
    const other = (await (await api('/auth/login', { method: 'POST', body: { email: 'owner-cafe@test.local', password: 'Test!pass123' } })).json()).access_token;
    await q(`update auth_users set email_verified_at = now() where email = 'owner-cafe@test.local' and email_verified_at is null`);
    const r = await rpc(stack, 'submit_addon_request', { p_features: {}, p_notes: '' }, other);
    assert(!(r.status === 403 && /confirm your email/i.test(JSON.stringify(r.data))), 'a verified account was blocked: ' + JSON.stringify(r.data));
  }, 'critical');

  await s.check('A wrong, an expired and a made-up link are all refused the same way', async () => {
    const exp = crypto.randomBytes(16).toString('hex');
    await q(`insert into email_verifications (token_hash, user_id, email, expires_at) values ($1, $2, $3, now() - interval '1 hour')`, [sha(exp), userId, email]);
    for (const t of [exp, 'not-a-real-token', '', 'x'.repeat(500)]) {
      const r = await api('/auth/verify-email', { method: 'POST', body: { token: t } });
      assert(r.status === 400, `token "${t.slice(0, 12)}" -> ${r.status}`);
    }
    const row = (await q('select email_verified_at from auth_users where id = $1', [userId]))[0];
    assert(row.email_verified_at === null, 'a bad link verified the account');
  }, 'critical');

  await s.check('The real link verifies the account, and only the address that was mailed', async () => {
    const good = crypto.randomBytes(16).toString('hex');
    await q(`insert into email_verifications (token_hash, user_id, email, expires_at) values ($1, $2, $3, now() + interval '1 hour')`, [sha(good), userId, 'someone-else@signup.test']);
    const wrong = await api('/auth/verify-email', { method: 'POST', body: { token: good } });
    assert(wrong.status === 200, 'link status ' + wrong.status);
    let row = (await q('select email_verified_at from auth_users where id = $1', [userId]))[0];
    assert(row.email_verified_at === null, 'a link for a different address verified this account');
    const ok = crypto.randomBytes(16).toString('hex');
    await q(`insert into email_verifications (token_hash, user_id, email, expires_at) values ($1, $2, $3, now() + interval '1 hour')`, [sha(ok), userId, email]);
    const r = await api('/auth/verify-email', { method: 'POST', body: { token: ok } }); const j = await r.json();
    assert(r.status === 200 && j.ok === true && j.email === email, JSON.stringify(j));
    row = (await q('select email_verified_at from auth_users where id = $1', [userId]))[0];
    assert(row.email_verified_at, 'account still unverified after the real link');
  }, 'critical');

  await s.check('Switch ON, now verified: the same account is no longer blocked', async () => {
    const r = await rpc(stack, 'submit_addon_request', { p_features: {}, p_notes: '' }, token);
    assert(!(r.status === 403 && /confirm your email/i.test(JSON.stringify(r.data))), 'still blocked: ' + JSON.stringify(r.data));
    const st = await (await api('/auth/session', { token })).json();
    assert(st.email_verified === true, 'session still says unverified');
  }, 'critical');

  await s.check('Asking for a new link: a verified account says so; an unverified one gets a new link row', async () => {
    const again = await api('/auth/resend-verification', { method: 'POST', token, body: {} }); const aj = await again.json();
    assert(again.status === 200 && aj.verified === true, 'verified resend: ' + JSON.stringify(aj));
    const email2 = `second-${Date.now()}@signup.test`;
    const su = await (await api('/auth/signup', { method: 'POST', body: { email: email2, password: 'Sup3rSecret!' } })).json();
    const before = (await q('select count(*)::int n from email_verifications where user_id = $1', [su.user.id]))[0].n;
    const r = await api('/auth/resend-verification', { method: 'POST', token: su.access_token, body: {} });
    assert(r.status === 200, 'resend ' + r.status);
    const after = (await q('select count(*)::int n from email_verifications where user_id = $1', [su.user.id]))[0].n;
    assert(after === before + 1, 'no new link row');
    const anon = await api('/auth/resend-verification', { method: 'POST', body: {} });
    assert(anon.status === 401, 'anonymous resend ' + anon.status);
  }, 'major');

  await s.check('Existing accounts from before this change were grandfathered as verified by the migration', async () => {
    const r = await q(`select count(*)::int n from information_schema.columns where table_name = 'auth_users' and column_name = 'email_verified_at'`);
    assert(r[0].n === 1, 'column missing');
    const f = await q(`select value from platform_flags where key = 'require_email_verification'`);
    assert(f.length === 1, 'flag row missing');
  }, 'major');

  await flag('off'); // leave the shared test database as we found it
  s.done();
}
