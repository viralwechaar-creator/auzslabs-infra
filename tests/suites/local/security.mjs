// Access rules: who can read/write what. Run against the real API with no/with wrong credentials.
import { suite, assert } from '../../lib/harness.mjs';
import { PASSWORD, USERS, TENANTS, q } from '../../lib/db.mjs';

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
    const a = await login(USERS.plain); const u = (await q("select id from auth_users where email = $1", [USERS.plain]))[0].id;
    const t1 = (await q('insert into password_resets (user_id) values ($1) returning token', [u]))[0].token;
    assert((await call('POST', '/auth/reset', { token: t1, password: PASSWORD + 'y' })).status === 200, 'reset failed');
    assert((await call('GET', '/auth/session', null, a)).status === 401, 'old session survived a password reset');
    const t2 = (await q('insert into password_resets (user_id) values ($1) returning token', [u]))[0].token;
    await call('POST', '/auth/reset', { token: t2, password: PASSWORD });
  }, 'major');
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
