// Storefront round A: order lifecycle. Fulfilment, delivery and payment are separate states; shipments are records.
import { suite, watch, assert } from '../../lib/harness.mjs';
import { newCtx } from '../../lib/common.mjs';
import { rpc } from '../../lib/api.mjs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const bcrypt = createRequire(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'server', 'package.json'))('bcryptjs');
import { q, USERS, PASSWORD } from '../../lib/db.mjs';

export default async function run({ browser, stack }) {
  const s = suite('Storefront API and payouts', 'API keys, read-only API, Route status and settlements.');
  await q("update tenant_settings set features = features || '{\"storefront\":true}' where tenant_id = (select id from tenants where slug='testcafe')");
  await q("insert into sfx_stores (tenant_id, published) select id, true from tenants where slug='testcafe' on conflict (tenant_id) do update set published=true");
  const tid = (await q("select id from tenants where slug='testcafe'"))[0].id;
  await q('delete from sfx_orders where tenant_id=$1', [tid]); await q('delete from sfx_products where tenant_id=$1', [tid]);
  const login = async (email) => (await (await fetch(stack.apiBase + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) })).json()).access_token;
  const owner = await login(USERS.cafeOwner);
  const call = async (fn, args) => (await rpc(stack, fn, args, owner)).data;
  const pr = (await call('sfx_product_save', { p_id: null, p: { name: 'Api tee', price: 100, status: 'active', variants: [{ label: 'S', price: 100, stock: 10 }, { label: 'M', price: 100, stock: 10 }] } })).data;
  const [vs, vm] = pr.variants.map((v) => v.id);
  const place = async () => {
    await rpc(stack, 'public_sfx_place_order', { p_slug: 'testcafe', p: { name: 'Ship Buyer', phone: '98765' + Math.floor(10000 + Math.random() * 89999), address: '12 Park Road, Ward 4', city: 'Jodhpur', state: 'Rajasthan', pin: '342001', lines: [{ variantId: vs, qty: 2 }, { variantId: vm, qty: 1 }] } });
    return (await q('select id from sfx_orders where tenant_id=$1 order by created_at desc limit 1', [tid]))[0].id;
  };
  const unwrap = (r) => (Array.isArray(r) ? r : r?.data ?? r);
  const err = async (fn, args, tok) => JSON.stringify((await rpc(stack, fn, args, tok)).data).toLowerCase();
  const viewer = await (async () => {
    const hash = bcrypt.hashSync(PASSWORD, 4);
    const u = (await q("insert into auth_users (email, password_hash, app_metadata) values ('view-api@test.local',$1,'{}'::jsonb) on conflict (email) where deleted_at is null do update set password_hash=excluded.password_hash returning id", [hash]))[0].id;
    await q("insert into profiles (id, tenant_id, email, role, name) values ($1,$2,'view-api@test.local','cashier','Viewer') on conflict (id) do update set role='cashier', tenant_id=excluded.tenant_id", [u, tid]);
    return login('view-api@test.local');
  })();
  await q("update tenant_settings set features = features || '{\"storefront\":true}' where tenant_id = (select id from tenants where slug='testretail')");
  await q("insert into sfx_stores (tenant_id, published) select id, true from tenants where slug='testretail' on conflict (tenant_id) do update set published=true");
  const otherOwner = await login(USERS.retailOwner);
  const apiGet = async (path, key) => fetch(stack.apiBase + '/storefront-api/v1/' + path, { headers: key ? { authorization: 'Bearer ' + key } : {} });
  await q('update sfx_variants set stock = 50 where id = any($1)', [[vs, vm]]);
  const mkOrder = async (phone) => rpc(stack, 'public_sfx_place_order', { p_slug: 'testcafe', p: { name: 'Api Buyer', phone, address: '1 Main Road', city: 'Jodhpur', state: 'Rajasthan', pin: '342001', lines: [{ variantId: vs, qty: 1 }] } });
  await mkOrder('9855500011'); await mkOrder('9855500012');
  await q("update sfx_orders set is_test=true where id = (select id from sfx_orders where tenant_id=$1 order by created_at desc limit 1)", [tid]);
  let key;

  await s.check('An API key is shown once, stored only as a hash, and listed by its prefix', async () => {
    const k = unwrap(await rpc(stack, 'sfx_api_key_create', { p_name: 'Accounting export' }, owner).then((r) => r.data));
    key = k.key; assert(/^sfx_live_[a-f0-9]{48}$/.test(key), JSON.stringify(k));
    assert((await q("select count(*)::int n from sfx_api_keys where tenant_id=$1 and key_hash=$2", [tid, key]))[0].n === 0, 'key stored in the clear');
    const list = unwrap(await rpc(stack, 'sfx_api_key_list', {}, owner).then((r) => r.data));
    assert(list.length === 1 && list[0].prefix === key.slice(0, 13) && !JSON.stringify(list).includes(key), JSON.stringify(list));
    assert(/name/.test(await err('sfx_api_key_create', { p_name: 'x' }, owner)), 'unnamed key made');
    assert(/does not allow/.test(await err('sfx_api_key_create', { p_name: 'Sneaky key' }, viewer)), 'view-only user made a key');
  }, 'critical');
  await s.check('The API returns this shop\'s orders (not test ones), products and stock, read only', async () => {
    const o = await (await apiGet('orders', key)).json();
    assert(o.data.length === 1 && o.data[0].number && o.data[0].lines[0].qty === 1 && o.data[0].customer.name === 'Api Buyer', JSON.stringify(o).slice(0, 300));
    const p = await (await apiGet('products?limit=5', key)).json(); assert(p.data.some((x) => x.name === 'Api tee') && p.data[0].variants.length >= 1, JSON.stringify(p).slice(0, 200));
    const i = await (await apiGet('inventory', key)).json(); assert(i.data.length >= 2 && 'available' in i.data[0], JSON.stringify(i).slice(0, 200));
    const post = await fetch(stack.apiBase + '/storefront-api/v1/orders', { method: 'POST', headers: { authorization: 'Bearer ' + key } });
    assert(post.status === 405, 'write accepted: ' + post.status);
    assert((await apiGet('orders?after=not-a-date', key)).status === 400, 'bad date accepted');
  }, 'critical');
  await s.check('Missing, wrong and revoked keys are refused; another shop\'s key sees only its own data', async () => {
    assert((await apiGet('orders')).status === 401 && (await apiGet('orders', 'sfx_live_' + 'a'.repeat(48))).status === 401 && (await apiGet('orders', 'junk')).status === 401, 'bad key accepted');
    const k2 = unwrap(await rpc(stack, 'sfx_api_key_create', { p_name: 'Other shop key' }, otherOwner).then((r) => r.data));
    const theirs = await (await apiGet('orders', k2.key)).json();
    assert(Array.isArray(theirs.data) && !theirs.data.some((x) => x.customer && x.customer.name === 'Api Buyer'), 'saw another shop\'s orders');
    const id = unwrap(await rpc(stack, 'sfx_api_key_list', {}, owner).then((r) => r.data))[0].id;
    await rpc(stack, 'sfx_api_key_revoke', { p_id: id }, owner);
    assert((await apiGet('orders', key)).status === 401, 'revoked key still works');
    const log = unwrap(await rpc(stack, 'sfx_audit_list', {}, owner).then((r) => r.data)).map((x) => x.action);
    assert(log.includes('Created an API key') && log.includes('Revoked an API key'), JSON.stringify(log));
  }, 'critical');
  await s.check('Payouts: status starts empty, the start step is off until AUZslab switches it on, and only the last four bank digits are kept', async () => {
    const st = unwrap(await rpc(stack, 'sfx_route_status', {}, owner).then((r) => r.data));
    assert(st.status === 'not_started', JSON.stringify(st));
    const r = await fetch(stack.apiBase + '/payments/sfx/route/start', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + owner }, body: JSON.stringify({ legalName: 'Test Cafe', email: 'a@b.co', phone: '9876543210' }) });
    assert(r.status === 400 && /not switched on/.test(JSON.stringify(await r.json())), 'route start not dormant');
    const anon = await fetch(stack.apiBase + '/payments/sfx/route/start', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert(anon.status === 401, 'anonymous start allowed');
    await q("select sfx_route_set($1, '{\"accountId\":\"acc_test\",\"status\":\"active\",\"legalName\":\"Test Cafe\",\"bankAccount\":\"123456789012\",\"ifsc\":\"HDFC0001234\"}'::jsonb)", [tid]);
    const st2 = unwrap(await rpc(stack, 'sfx_route_status', {}, owner).then((r2) => r2.data));
    assert(st2.status === 'active' && st2.bankLast4 === '9012' && !JSON.stringify(st2).includes('123456789012'), JSON.stringify(st2));
    assert((await q('select count(*)::int n from sfx_route_accounts where tenant_id=$1 and (bank_ifsc is null or length(bank_last4) <> 4)', [tid]))[0].n === 0, 'stored more than the last four digits');
  }, 'critical');
  await s.check('Settlements are readable by settings-level roles only and never writable from the app', async () => {
    const oid = (await q('select id from sfx_orders where tenant_id=$1 limit 1', [tid]))[0].id;
    await q("insert into sfx_settlements (tenant_id, order_id, rzp_transfer_id, gross, fee, net, status, settled_at) values ($1,$2,'trf_1',100,2,98,'settled',now())", [tid, oid]);
    const l = unwrap(await rpc(stack, 'sfx_settlement_list', {}, owner).then((r) => r.data));
    assert(l.length === 1 && Number(l[0].net) === 98 && l[0].order, JSON.stringify(l));
    const st = unwrap(await rpc(stack, 'sfx_route_status', {}, owner).then((r) => r.data));
    assert(Number(st.settled) === 98, JSON.stringify(st));
    assert(/does not allow/.test(await err('sfx_settlement_list', {}, viewer)), 'view-only user read settlements');
    const w = await rpc(stack, 'sfx_route_set', { p_tenant: tid, p: {} }, owner);
    assert(w.status === 404 || /unknown|not found/i.test(JSON.stringify(w.data)), 'server-only function reachable');
  });
  s.done();
}
