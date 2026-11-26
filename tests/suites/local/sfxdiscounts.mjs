// Storefront round A: order lifecycle. Fulfilment, delivery and payment are separate states; shipments are records.
import { suite, watch, assert } from '../../lib/harness.mjs';
import { newCtx } from '../../lib/common.mjs';
import { rpc } from '../../lib/api.mjs';
import { q, USERS, PASSWORD } from '../../lib/db.mjs';

export default async function run({ browser, stack }) {
  const s = suite('Storefront discounts', 'Free shipping, buy X get Y, product scope, per-customer limits, automatic discounts.');
  await q("update tenant_settings set features = features || '{\"storefront\":true}' where tenant_id = (select id from tenants where slug='testcafe')");
  await q("insert into sfx_stores (tenant_id, published) select id, true from tenants where slug='testcafe' on conflict (tenant_id) do update set published=true");
  const tid = (await q("select id from tenants where slug='testcafe'"))[0].id;
  await q('delete from sfx_orders where tenant_id=$1', [tid]); await q('delete from sfx_products where tenant_id=$1', [tid]);
  const login = async (email) => (await (await fetch(stack.apiBase + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) })).json()).access_token;
  const owner = await login(USERS.cafeOwner);
  const call = async (fn, args) => (await rpc(stack, fn, args, owner)).data;
  const pr = (await call('sfx_product_save', { p_id: null, p: { name: 'Disc tee', price: 100, status: 'active', variants: [{ label: 'S', price: 100, stock: 10 }, { label: 'M', price: 100, stock: 10 }] } })).data;
  const [vs, vm] = pr.variants.map((v) => v.id);
  const place = async () => {
    await rpc(stack, 'public_sfx_place_order', { p_slug: 'testcafe', p: { name: 'Ship Buyer', phone: '98765' + Math.floor(10000 + Math.random() * 89999), address: '12 Park Road, Ward 4', city: 'Jodhpur', state: 'Rajasthan', pin: '342001', lines: [{ variantId: vs, qty: 2 }, { variantId: vm, qty: 1 }] } });
    return (await q('select id from sfx_orders where tenant_id=$1 order by created_at desc limit 1', [tid]))[0].id;
  };
  const unwrap = (r) => (Array.isArray(r) ? r : r?.data ?? r);
  const put = async (lines, extra = {}) => {
    await q('update sfx_variants set stock = 100 where id = any($1)', [[vs, vm]]);
    const r = unwrap((await rpc(stack, 'public_sfx_place_order', { p_slug: 'testcafe', p: { name: 'Disc Buyer', phone: '9811100000', address: '1 Main Road', city: 'Jodhpur', state: 'Rajasthan', pin: '342001', lines, ...extra } })).data);
    return r;
  };
  const save = async (p) => unwrap(await call('sfx_discount_save', { p_id: null, p }));
  const ord = async (num) => (await q('select * from sfx_orders where tenant_id=$1 and number=$2', [tid, num]))[0];
  await q('update sfx_stores set config = jsonb_set(coalesce(config, \'{}\'::jsonb), \'{shipping}\', \'{"fee":60,"freeOver":0}\'::jsonb) where tenant_id=$1', [tid]);
  const S = [{ variantId: vs, qty: 1 }]; // price 100
  const both = [{ variantId: vs, qty: 2 }, { variantId: vm, qty: 1 }]; // 300 total

  await s.check('Free shipping removes the delivery fee and nothing else', async () => {
    await save({ code: 'SHIPFREE', kind: 'free_shipping' });
    const plain = await put(S); const free = await put(S, { coupon: 'SHIPFREE' });
    assert(Number(plain.shipping) === 60 && Number(plain.total) === 160, JSON.stringify(plain));
    assert(Number(free.shipping) === 0 && Number(free.total) === 100, JSON.stringify(free));
  }, 'critical');
  await s.check('Buy 2 get 1 free: the cheapest unit is free, exact to the paisa', async () => {
    await q("update sfx_variants set price = 90 where id=$1", [vm]);
    await save({ code: 'B2G1', kind: 'buy_x_get_y', buyQty: 2, getQty: 1 });
    const r = await put(both, { coupon: 'B2G1' });
    const o = await ord(r.number);
    assert(Number(o.discount_amount) === 90 && Number(o.subtotal) === 290 && Number(r.discount) === 90, JSON.stringify([o.discount_amount, o.subtotal, r.discount]));
    assert(Number(o.total) === Number(o.subtotal) - 90 + Number(o.shipping) && Number(r.total) === Number(o.total), 'total does not add up');
    const none = await put(S, { coupon: 'B2G1' });
    assert(Number(none.discount) === 0, 'free item given without buying enough');
  }, 'critical');
  await s.check('A code limited to some products only counts those lines', async () => {
    await save({ code: 'TEE10', kind: 'percent', value: 10, productIds: [pr.id] });
    const r = await put(both, { coupon: 'TEE10' });
    assert(Number((await ord(r.number)).discount_amount) === 29, 'discount ' + (await ord(r.number)).discount_amount);
    const other = (await call('sfx_product_save', { p_id: null, p: { name: 'Other thing', price: 50, status: 'active', variants: [{ label: 'One', price: 50, stock: 5 }] } })).data;
    await save({ code: 'ONLYOTHER', kind: 'flat', value: 10, productIds: [other.id] });
    const bad = await rpc(stack, 'public_sfx_place_order', { p_slug: 'testcafe', p: { name: 'Disc Buyer', phone: '9811100001', address: '1 Main Road', city: 'Jodhpur', state: 'Rajasthan', pin: '342001', lines: S, coupon: 'ONLYOTHER' } });
    assert(/does not apply/.test(JSON.stringify(bad.data)), JSON.stringify(bad.data).slice(0, 200));
  }, 'critical');
  await s.check('One use per customer and first-order-only are enforced', async () => {
    await save({ code: 'ONCE', kind: 'flat', value: 5, perCustomerLimit: 1 });
    await put(S, { coupon: 'ONCE', phone: '9822200000' });
    const again = await rpc(stack, 'public_sfx_place_order', { p_slug: 'testcafe', p: { name: 'Again', phone: '9822200000', address: '1 Main Road', city: 'Jodhpur', state: 'Rajasthan', pin: '342001', lines: S, coupon: 'ONCE' } });
    assert(/already used/.test(JSON.stringify(again.data)), JSON.stringify(again.data).slice(0, 200));
    await save({ code: 'NEWONLY', kind: 'flat', value: 5, firstOrderOnly: true });
    const old = await rpc(stack, 'public_sfx_place_order', { p_slug: 'testcafe', p: { name: 'Again', phone: '9822200000', address: '1 Main Road', city: 'Jodhpur', state: 'Rajasthan', pin: '342001', lines: S, coupon: 'NEWONLY' } });
    assert(/first orders only/.test(JSON.stringify(old.data)), JSON.stringify(old.data).slice(0, 200));
    const fresh = await put(S, { coupon: 'NEWONLY', phone: '9833300000' });
    assert(Number(fresh.discount) === 5, JSON.stringify(fresh));
    const used = (await q("select used_count from sfx_discounts where tenant_id=$1 and code='ONCE'", [tid]))[0].used_count;
    assert(used === 1, 'a refused order still used a code: ' + used);
  }, 'critical');
  await s.check('An automatic discount applies without a code, and the best one wins', async () => {
    await q("update sfx_discounts set status='archived' where tenant_id=$1", [tid]);
    await save({ code: 'AUTO5', kind: 'flat', value: 5, automatic: true }); await save({ code: 'AUTO20', kind: 'flat', value: 20, automatic: true });
    const r = await put(S, { phone: '9844400000' }); const o = await ord(r.number);
    assert(o.discount_code === 'AUTO20' && Number(o.discount_amount) === 20, JSON.stringify([o.discount_code, o.discount_amount]));
    const typed = await rpc(stack, 'public_sfx_coupon_check', { p_slug: 'testcafe', p: { code: 'AUTO20', subtotal: 100 } });
    assert(/Invalid/.test(JSON.stringify(typed.data)), 'automatic discount can be typed as a code');
  }, 'critical');
  await s.check('The coupon check shows the exact amount for the bag, and bad rules are refused on save', async () => {
    await q("update sfx_discounts set status='active' where tenant_id=$1 and code='B2G1'", [tid]);
    const c = unwrap((await rpc(stack, 'public_sfx_coupon_check', { p_slug: 'testcafe', p: { code: 'B2G1', lines: both } })).data);
    assert(c.ok && Number(c.discount) === 90, JSON.stringify(c));
    const e = async (p) => JSON.stringify((await rpc(stack, 'sfx_discount_save', { p_id: null, p }, owner)).data).toLowerCase();
    assert(/how many to buy/.test(await e({ code: 'BAD1', kind: 'buy_x_get_y' })), 'bxgy without numbers saved');
    assert(/end date/.test(await e({ code: 'BAD2', kind: 'flat', value: 5, startsAt: '2030-01-02', expiresAt: '2030-01-01' })), 'backwards dates saved');
  });
  await s.check('Where an order came from is stored and shown, and junk fields are dropped', async () => {
    const r = await put(S, { phone: '9855500000', attribution: { source: 'instagram', medium: 'social', campaign: 'diwali', evil: 'x', landing: '/p/tee' } });
    const o = unwrap(await call('sfx_order_get', { p_id: (await ord(r.number)).id }));
    assert(o.attribution.source === 'instagram' && o.attribution.campaign === 'diwali' && !('evil' in o.attribution), JSON.stringify(o.attribution));
  });
  s.done();
}
