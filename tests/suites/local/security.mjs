// Access rules: who can read/write what. Run against the real API with no/with wrong credentials.
import { suite, assert } from '../../lib/harness.mjs';
import { PASSWORD, USERS, TENANTS, q } from '../../lib/db.mjs';
import { randomBytes, createHash, createHmac } from 'node:crypto';

// RFC 6238, independent of server/src/totp.js, so the test proves the real
// protocol rather than re-exercising the same implementation it's checking.
function totpAt(secretBuf, counter) {
  const buf = Buffer.alloc(8); buf.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac('sha1', secretBuf).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code = ((hmac[offset] & 0x7f) << 24 | (hmac[offset + 1] & 0xff) << 16 | (hmac[offset + 2] & 0xff) << 8 | (hmac[offset + 3] & 0xff)) % 1_000_000;
  return String(code).padStart(6, '0');
}
function base32Decode(str) {
  const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0, value = 0; const bytes = [];
  for (const ch of String(str).toUpperCase().replace(/[^A-Z2-7]/g, '')) {
    const idx = ALPHABET.indexOf(ch); if (idx === -1) continue;
    value = (value << 5) | idx; bits += 5;
    if (bits >= 8) { bytes.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(bytes);
}

export default async function run({ stack }) {
  const s = suite('Security and access rules', 'Logged-out visitors, other clients and normal customers must never reach data or admin actions that are not theirs.');
  const call = async (method, path, body, token) => { const r = await fetch(stack.apiBase + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined }); let d = null; try { d = await r.json(); } catch {} return { status: r.status, data: d }; };
  const login = async (email) => (await call('POST', '/auth/login', { email, password: PASSWORD })).data.access_token;
  const [cafe, salon, plain, admin] = await Promise.all([USERS.cafeOwner, USERS.salonOwner, USERS.plain, USERS.admin].map(login));
  const rows = (r) => (r.data && (r.data.data || r.data)) || [];

  await s.check('Logged-out visitor sees no orders, customers or staff records', async () => {
    for (const t of ['records', 'profiles', 'guest_orders', 'bookings', 'signup_requests', 'leads']) { const r = await call('GET', '/db/' + t); assert(r.status >= 400 || !rows(r).length, `${t}: ${rows(r).length} rows visible without login`); }
  }, 'critical');
  await s.check('Wrong password and unknown email are both refused with the same answer', async () => {
    const a = await call('POST', '/auth/login', { email: USERS.cafeOwner, password: 'x' }), b = await call('POST', '/auth/login', { email: 'nobody@test.local', password: 'x' });
    assert(a.status === 401 && b.status === 401, `${a.status}/${b.status}`); assert(JSON.stringify(a.data) === JSON.stringify(b.data), 'error messages reveal which emails exist');
  }, 'major');
  await s.check('Cafe owner only sees their own cafe data (not salon/retail)', async () => {
    const r = rows(await call('GET', '/db/records?select=tenant_id', null, cafe)); const ids = new Set(r.map((x) => x.tenant_id));
    const t = await q("select id from tenants where slug = 'testcafe'"); assert(r.length > 0, 'owner sees nothing of their own'); assert(ids.size === 1 && ids.has(t[0].id), 'sees tenants: ' + ids.size);
  }, 'critical');
  await s.check('Owner cannot write a record into another client\'s business', async () => {
    const other = (await q("select id from tenants where slug = 'testretail'"))[0].id;
    await call('POST', '/db/records', { id: 'evil-1', tenant_id: other, kind: 'item', data: { name: 'evil' } }, cafe);
    const r = await q("select count(*)::int n from records where id = 'evil-1' and tenant_id = $1", [other]); assert(r[0].n === 0, 'cross-tenant write succeeded');
  }, 'critical');
  await s.check('Normal customer account cannot call platform-admin actions', async () => {
    for (const fn of ['list_clients', 'provision_tenant', 'list_signup_requests']) {
      const r = await call('POST', '/rpc/' + fn, fn === 'provision_tenant' ? { p_name: 'Evil', p_slug: 'evil', p_niche: 'cafe' } : {}, plain);
      const evil = fn === 'provision_tenant' ? (await q("select count(*)::int n from tenants where slug = 'evil'"))[0].n : 0;
      assert(r.status >= 400 || !rows(r).length, fn + ' returned data to a normal customer'); assert(!evil, 'customer created a tenant');
    }
  }, 'critical');
  await s.check('Cafe owner cannot call platform-admin actions either', async () => {
    const r = await call('POST', '/rpc/list_clients', {}, cafe); assert(r.status >= 400 || !rows(r).length, 'owner can list all clients');
  }, 'critical');
  await s.check('Platform admin CAN list clients', async () => { const r = await call('POST', '/rpc/list_clients', {}, admin); assert(r.status === 200 && rows(r).length >= 3, 'status ' + r.status); });
  await s.check('A garbage or expired token is treated as logged-out', async () => {
    const r = await call('GET', '/db/records', null, 'garbage.token.value'); assert(r.status >= 400 || !rows(r).length, 'garbage token gave data');
  }, 'critical');
  await s.check('Unknown API routes and tables return 404, not a stack trace', async () => {
    const a = await call('GET', '/db/pg_shadow'), b = await call('POST', '/rpc/drop_everything', {}); assert(a.status === 404 && b.status === 404, `${a.status}/${b.status}`);
    assert(!/at .*\.js:\d+/.test(JSON.stringify(a.data) + JSON.stringify(b.data)), 'stack trace leaked');
  });
  await s.check('SQL-injection-style input is treated as plain text', async () => {
    const r = await call('POST', '/rpc/public_menu', { tenant_slug: "x'; drop table records; --" }); assert(r.status < 500, 'server error ' + r.status);
    const t = await q("select count(*)::int n from records"); assert(t[0].n > 0, 'records table damaged');
  }, 'critical');
  await s.check('Changing your password signs out your other devices (and keeps the one you are using)', async () => {
    const a = await login(USERS.plain), b = await login(USERS.plain);
    assert((await call('GET', '/auth/session', null, b)).status === 200, 'second session not valid to begin with');
    const ch = await call('POST', '/rpc/change_my_password', { p_old_password: PASSWORD, p_new_password: PASSWORD + 'x' }, a); assert(ch.status === 200, 'change failed ' + ch.status);
    assert((await call('GET', '/auth/session', null, b)).status === 401, 'the other device stayed signed in after a password change');
    assert((await call('GET', '/auth/session', null, a)).status === 200, 'the device that changed the password was signed out');
    await call('POST', '/rpc/change_my_password', { p_old_password: PASSWORD + 'x', p_new_password: PASSWORD }, a);
  }, 'major');
  await s.check('A password reset signs every device out', async () => {
    // db/134: only a SHA-256 hash of the token is ever stored (same discipline as email_verifications) --
    // mirror createPasswordReset()'s own token shape (randomBytes(32).base64url) rather than a raw column insert.
    const sha256 = (v) => createHash('sha256').update(v).digest('hex');
    const mkToken = async (u) => { const tok = randomBytes(32).toString('base64url'); await q('insert into password_resets (user_id, token_hash) values ($1, $2)', [u, sha256(tok)]); return tok; };
    const a = await login(USERS.plain); const u = (await q("select id from auth_users where email = $1", [USERS.plain]))[0].id;
    const t1 = await mkToken(u);
    assert((await call('POST', '/auth/reset', { token: t1, password: PASSWORD + 'y' })).status === 200, 'reset failed');
    assert((await call('GET', '/auth/session', null, a)).status === 401, 'old session survived a password reset');
    const t2 = await mkToken(u);
    await call('POST', '/auth/reset', { token: t2, password: PASSWORD });
  }, 'major');
  await s.check('A real owner can actually set up and use two-factor authentication', async () => {
    // Regression for a real bug: /auth/2fa/setup checked the caller's role with a bare pool.query against
    // profiles, which has owner-read-only RLS (db/002) -- app_uid() is null without app.uid set, so the
    // policy hid every row and a genuine owner got 403 every single time, 100% reproducible, until this
    // was wrapped in withAuth. This test drives the real setup -> confirm -> login-challenge flow end to
    // end, and also confirms the secret is stored encrypted at rest (db/135's auth.js change), never plaintext.
    const setup = await call('POST', '/auth/2fa/setup', {}, cafe);
    assert(setup.status === 200 && setup.data.secret, 'setup failed: ' + setup.status + ' ' + JSON.stringify(setup.data));
    const stored = (await q('select secret from auth_totp where user_id = (select id from auth_users where email = $1)', [USERS.cafeOwner]))[0];
    assert(stored.secret.startsWith('enc:') && stored.secret !== setup.data.secret, 'secret is not stored encrypted');
    const code = totpAt(base32Decode(setup.data.secret), Math.floor(Date.now() / 1000 / 30));
    const confirm = await call('POST', '/auth/2fa/confirm', { code }, cafe);
    assert(confirm.status === 200 && confirm.data.backupCodes?.length === 8, 'confirm failed: ' + JSON.stringify(confirm.data));
    const login2 = await call('POST', '/auth/login', { email: USERS.cafeOwner, password: PASSWORD });
    assert(login2.status === 200 && login2.data.requires2fa && login2.data.challenge, 'login did not return a 2fa challenge: ' + JSON.stringify(login2.data));
    const code2 = totpAt(base32Decode(setup.data.secret), Math.floor(Date.now() / 1000 / 30));
    const challengeResp = await call('POST', '/auth/2fa/challenge', { challenge: login2.data.challenge, code: code2 });
    assert(challengeResp.status === 200 && challengeResp.data.access_token, 'challenge step failed: ' + JSON.stringify(challengeResp.data));
    await call('POST', '/auth/2fa/disable', { password: PASSWORD }, challengeResp.data.access_token);
  }, 'critical');
  await s.check('The staff-invite mail cannot be used to send a link to someone else\'s website', async () => {
    const r = await call('POST', '/staff/send-invite-email', { email: 'victim@example.com', name: 'x', verify_link: 'https://evil.example/login?x=1' }, cafe);
    assert(r.status === 400, 'accepted a link on a foreign domain: ' + r.status);
  }, 'major');
  await s.check('Oversized request body is rejected', async () => {
    const big = 'a'.repeat(6 * 1024 * 1024); const r = await call('POST', '/auth/login', { email: big, password: 'x' }).catch(() => ({ status: 413 })); assert(r.status >= 400, 'accepted ' + r.status);
  }, 'minor');
  await s.check('Self-order is refused when the café has switched the feature off', async () => {
    await q("update tenant_settings set enabled_features = jsonb_build_object('self_order', false) where tenant_id = (select id from tenants where slug = 'testcafe')");
    const before = (await q("select count(*)::int n from guest_orders"))[0].n;
    await call('POST', '/rpc/place_order', { tenant_slug: TENANTS.cafe, t: 'tbl-1', n: 'X', p: '9000000000', nt: '', its: [{ id: 'it-1', size: '', qty: 1 }] });
    const after = (await q("select count(*)::int n from guest_orders"))[0].n;
    await q("update tenant_settings set enabled_features = '{}' where tenant_id = (select id from tenants where slug = 'testcafe')");
    assert(after === before, 'an order was accepted while self-order was off');
  }, 'major');
  s.done();
}
