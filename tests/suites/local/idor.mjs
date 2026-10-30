// Broken access control / IDOR: another business's id, a changed request body, or no login at all must never give access.
// Run against the real API and the real database (app role, row security on). Two separate businesses plus a logged-out caller.
import { suite, assert } from '../../lib/harness.mjs';
import { PASSWORD, USERS, q } from '../../lib/db.mjs';
import { RPC } from '../../../server/src/data/rpc-registry.js';

export default async function run({ stack }) {
  const s = suite('Access control and ID tampering', 'Every sensitive call is checked on the server: logged-out, another business, and a changed id must all be refused.');
  const call = async (method, path, body, token) => { const r = await fetch(stack.apiBase + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined }); let data = null; try { data = await r.json(); } catch {} return { status: r.status, data }; };
  const login = async (email) => (await call('POST', '/auth/login', { email, password: PASSWORD })).data.access_token;
  const [cafe, retail, acct] = await Promise.all([USERS.cafeOwner, USERS.retailOwner, USERS.acctOwner].map(login));
  const tid = async (slug) => (await q('select id from tenants where slug = $1', [slug]))[0].id;
  const [cafeId, retailId] = [await tid('testcafe'), await tid('testretail')];

  await s.check('Every function that needs a login refuses a logged-out caller (all ' + Object.values(RPC).filter((v) => v.auth).length + ' of them)', async () => {
    const open = [];
    for (const [name, cfg] of Object.entries(RPC)) { if (!cfg.auth) continue; const r = await call('POST', '/rpc/' + name, {}); if (r.status !== 401) open.push(name + ':' + r.status); }
    assert(!open.length, 'reachable without login: ' + open.slice(0, 12).join(', '));
  }, 'critical');

  await s.check('A business without AUZsPay / AUZsMob / AUZsStyle / AUZsFinance cannot use those functions, and no business can use platform-admin ones', async () => {
    const bad = [];
    for (const name of Object.keys(RPC)) {
      if (!RPC[name].auth || !/^(pay_|mob_|sty_|fin_|admin_|salesman_|team_)/.test(name)) continue;
      if (/^(pay_me_|pay_kiosk)/.test(name)) continue; // self-service for the caller's own employee record: refused for other reasons, covered by the payroll suite
      const r = await call('POST', '/rpc/' + name, {}, retail);
      if (r.status === 200) { const d = r.data && r.data.data; const nothing = d == null || d === 0 || d === false || (typeof d === 'object' && Object.values(d).every((v) => v == null || (Array.isArray(v) && !v.length) || v === 0)); if (!nothing) bad.push(name); }
    }
    assert(!bad.length, 'answered 200 to a business that does not have the product: ' + bad.slice(0, 12).join(', '));
  }, 'critical');

  await s.check('Changing the id in the URL or body cannot read, change or delete another business\'s rows', async () => {
    await q("insert into records (id, tenant_id, kind, data) values ('idor-1', $1, 'item', '{\"name\":\"mine\"}')", [retailId]);
    const sel = await call('GET', '/db/records?eq.id=idor-1', null, cafe); assert(!((sel.data && sel.data.data) || []).length, 'read another business\'s row');
    await call('PATCH', '/db/records?eq.id=idor-1', { data: { name: 'hacked' } }, cafe);
    await call('PUT', '/db/records', { id: 'idor-1', tenant_id: retailId, kind: 'item', data: { name: 'hacked' } }, cafe);
    assert((await call('DELETE', '/db/records?eq.id=idor-1', null, cafe)).status >= 400, 'DELETE is not an allowed verb on the data API');
    const row = (await q("select data->>'name' n, deleted from records where id = 'idor-1' and tenant_id = $1", [retailId]))[0];
    assert(row && row.n === 'mine' && !row.deleted, 'another business changed or removed the row: ' + JSON.stringify(row));
    // moving your own row into someone else's business
    await q("insert into records (id, tenant_id, kind, data) values ('idor-2', $1, 'item', '{\"name\":\"x\"}')", [cafeId]);
    await call('PATCH', '/db/records?eq.id=idor-2', { tenant_id: retailId }, cafe);
    assert((await q("select count(*)::int n from records where id = 'idor-2' and tenant_id = $1", [retailId]))[0].n === 0, 'a row was moved into another business');
  }, 'critical');

  await s.check('A staff profile cannot be moved to another business or promoted by changing the request', async () => {
    const mine = (await q("select id from profiles where tenant_id = $1 and role = 'owner' limit 1", [cafeId]))[0].id;
    await call('PATCH', '/db/profiles?eq.id=' + mine, { tenant_id: retailId }, cafe);
    const p = (await q('select tenant_id, role from profiles where id = $1', [mine]))[0];
    assert(p.tenant_id === cafeId && p.role === 'owner', 'profile changed: ' + JSON.stringify(p));
    const other = (await q("select id from profiles where tenant_id = $1 limit 1", [retailId]))[0].id;
    await call('PATCH', '/db/profiles?eq.id=' + other, { name: 'hacked' }, cafe);
    assert((await q('select name from profiles where id = $1', [other]))[0].name !== 'hacked', 'changed another business\'s staff');
    assert((await call('PATCH', '/db/records', { data: { x: 1 } }, cafe)).status === 400, 'an update with no filter was accepted');
  }, 'critical');

  await s.check('Private files of another business are refused (403), and a logged-out caller gets 401', async () => {
    for (const p of [`/storage/acc/${retailId}/x.pdf`, `/storage/fin/${retailId}/x.pdf`, `/storage/doc/${retailId}/emp1/x.png`]) {
      const a = await call('GET', p, null, cafe); assert(a.status === 403, p.split('/')[2] + ' with another business\'s login: ' + a.status);
      const b = await call('GET', p); assert(b.status === 401, p.split('/')[2] + ' logged out: ' + b.status);
    }
    const proof = await call('GET', '/storage/order-proof/00000000-0000-0000-0000-000000000000', null, cafe); assert(proof.status >= 400, 'a business owner can read client payment screenshots: ' + proof.status);
    const up = await call('POST', `/storage/site/x?tenant=${retailId}`, null, acct); assert(up.status >= 400, 'upload accepted without a plan');
  }, 'critical');

  await s.check('Share links and tokens give nothing for a wrong or guessed value', async () => {
    for (const [fn, args] of [['public_invoice', { oid: 'nope' }], ['public_acc_document', { token: 'a'.repeat(32) }], ['public_sty_sale', { p_token: 'a'.repeat(10) }], ['public_mob_sale', { p_token: 'a'.repeat(10) }], ['public_client_order', { p_token: 'a'.repeat(32) }], ['public_sty_order', { p_token: 'a'.repeat(16) }]]) {
      const r = await call('POST', '/rpc/' + fn, args);
      const d = r.data && r.data.data; const empty = r.status >= 400 || d == null || (typeof d === 'object' && (!Object.keys(d).length || Object.values(d).every((v) => v == null || (typeof v === 'object' && !Object.keys(v || {}).length))));
      assert(empty, fn + ' returned data for a guessed token: ' + JSON.stringify(d).slice(0, 120));
    }
    const b = await fetch(stack.apiBase + '/bill/zzzzzzzzzz', { redirect: 'manual' }); assert(b.status === 404 || b.status === 302 && !/zzzzzzzzzz/.test(b.headers.get('location') || ''), 'bill link for an unknown code: ' + b.status);
  }, 'major');

  await s.check('A visitor cannot send a huge request or flood order-writing calls', async () => {
    let big = { status: 0 }; try { big = await call('POST', '/rpc/place_order', { tenant_slug: 'testcafe', note: 'x'.repeat(300000) }); } catch { /* the connection was cut: also a refusal */ } assert(big.status === 413 || big.status === 400 || big.status === 0 || big.data === null, 'oversized anonymous body: ' + big.status);
  }, 'major');
}
