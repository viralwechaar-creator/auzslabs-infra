// Storefront round J: in-store AUZsStyle sales land in the shared order list as "in_store" when the apps are linked.
import { suite, assert } from '../../lib/harness.mjs';
import { rpc } from '../../lib/api.mjs';
import { q, PASSWORD, USERS } from '../../lib/db.mjs';

export default async function run({ stack }) {
  const s = suite('Shared in-store orders', 'AUZsStyle sales appear in the storefront order list, tagged in-store, once the apps are linked.');
  const login = async (email) => (await (await fetch(stack.apiBase + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) })).json()).access_token;
  const owner = await login(USERS.styOwner);
  const call = async (fn, args) => { const r = await rpc(stack, fn, args || {}, owner); return r.data && r.data.data !== undefined ? r.data.data : r.data; };
  const tid = (await q("select id from tenants where slug='teststyle'"))[0].id;
  await q("update tenant_settings set features = features || '{\"style\":true,\"storefront\":true}' where tenant_id=$1", [tid]);
  await q("insert into sfx_stores (tenant_id, published) values ($1, true) on conflict (tenant_id) do update set published=true, style_linked=false", [tid]);
  await q('delete from sfx_orders where tenant_id=$1', [tid]);
  const uid = () => crypto.randomUUID();
  const made = await call('sty_save_style', { p: { name: 'Shop Tee', category: 'Tees', price: 500, mrp: 600, cost: 200, colours: ['Red'], sizes: ['M'], opening: { qty: 3, unitCost: 200 } } });
  const vid = made.variants[0].id;
  const sell = async (qty, extra = {}) => { const id = uid(); const r = await rpc(stack, 'sty_sell', { p: { id, lines: [{ variantId: vid, qty }], payments: [{ mode: 'cash', amount: 500 * qty }], ...extra } }, owner); return { id, r }; };
  const orders = async () => q("select * from sfx_orders where tenant_id=$1 order by created_at", [tid]);

  await s.check('Before linking, a shop sale stays only in AUZsStyle', async () => {
    const a = await sell(1);
    assert(!a.r.data?.error, JSON.stringify(a.r.data).slice(0, 200));
    assert((await orders()).length === 0, 'order copied although not linked');
  }, 'critical');
  await s.check('Linking brings earlier sales across, once each', async () => {
    const r = await call('sfx_style_link_set', { p_on: true });
    assert(r.linked === true && r.sales === 1, JSON.stringify(r));
    const o = await orders();
    assert(o.length === 1 && o[0].channel === 'in_store' && o[0].fulfilment_status === 'fulfilled' && o[0].status === 'fulfilled' && o[0].payment_method === 'in_store', JSON.stringify(o[0]));
    await call('sfx_style_link_set', { p_on: true });
    assert((await orders()).length === 1, 'duplicate on re-link');
  }, 'critical');
  await s.check('A new shop sale appears with its own total, no shipping, no online rules, and the customer', async () => {
    const cust = await call('sty_save_customer', { p: { name: 'Mina Shah', phone: '9877700001' } });
    const a = await sell(2, { customerId: cust.id });
    assert(!a.r.data?.error, JSON.stringify(a.r.data).slice(0, 200));
    const o = (await orders()).find((x) => x.sty_sale_id === a.id);
    assert(o, 'sale not copied');
    assert(Number(o.shipping) === 0 && o.shipping_label === null && Number(o.total) === Number((await q('select total from sty_sales where id=$1', [a.id]))[0].total), JSON.stringify([o.shipping, o.total]));
    assert(o.customer.name === 'Mina Shah' && o.customer_id, JSON.stringify(o.customer));
    assert(o.lines[0].qty === 2 && o.lines[0].variantId && o.oversold === false, JSON.stringify(o.lines[0]));
  }, 'critical');
  await s.check('Selling more than is on the shelf flags the order as oversold', async () => {
    await call('sty_save_settings', { p: { allowNegativeStock: true } });
    const a = await sell(5);
    assert(!a.r.data?.error, JSON.stringify(a.r.data).slice(0, 200));
    const o = (await orders()).find((x) => x.sty_sale_id === a.id);
    assert(o && o.oversold === true, 'not flagged oversold');
  }, 'critical');
  await s.check('Cancelling the shop sale cancels the shared order', async () => {
    const a = await sell(1);
    await call('sty_void_sale', { p_id: a.id, p_reason: 'Mistake', p_restock: true });
    const o = (await orders()).find((x) => x.sty_sale_id === a.id);
    assert(o && o.status === 'cancelled', JSON.stringify(o && o.status));
  }, 'critical');
  await s.check('Online orders still get shipping and rules, and in-store ones show in the owner order list as In-store', async () => {
    await q("update sfx_stores set config = jsonb_set(coalesce(config,'{}'::jsonb), '{shipping}', '{\"fee\":50,\"freeOver\":0}'::jsonb) where tenant_id=$1", [tid]);
    const sfxVariant = (await q('select id from sfx_variants where tenant_id=$1 limit 1', [tid]))[0].id;
    await q('update sfx_variants set stock = 20 where id=$1', [sfxVariant]);
    const r = await rpc(stack, 'public_sfx_place_order', { p_slug: 'teststyle', p: { name: 'Web Buyer', phone: '9866600001', address: '1 Main Road', city: 'Jodhpur', state: 'Rajasthan', pin: '342001', lines: [{ variantId: sfxVariant, qty: 1 }] } });
    const d = r.data && r.data.data !== undefined ? r.data.data : r.data;
    assert(Number(d.shipping) === 50, JSON.stringify(d));
    const list = await call('sfx_order_list', {});
    assert(list.some((x) => x.channel === 'in_store') && list.some((x) => x.channel === 'online'), JSON.stringify(list.map((x) => x.channel)));
  }, 'critical');
  await s.check('A cash return in AUZsStyle shows as a refund on the shared order; a credit note adds nothing', async () => {
    await q('update sty_variants set active = true where id=$1', [vid]);
    const cu = await call('sty_save_customer', { p: { name: 'Return Person', phone: '9877700002' } });
    const a = await sell(2, { customerId: cu.id });
    assert(!a.r.data?.error, JSON.stringify(a.r.data).slice(0, 200));
    const line = (await q('select id from sty_sale_lines where sale_id=$1', [a.id]))[0].id;
    const ret = await rpc(stack, 'sty_return', { p: { id: uid(), saleId: a.id, mode: 'cash', reason: 'Did not fit', lines: [{ saleLineId: line, qty: 1 }] } }, owner);
    assert(!ret.data?.error, JSON.stringify(ret.data).slice(0, 200));
    let o = (await orders()).find((x) => x.sty_sale_id === a.id);
    const refunds = await q('select amount::float a, method from sfx_refunds where order_id=$1', [o.id]);
    assert(refunds.length === 1 && refunds[0].method === 'in_store' && refunds[0].a === 500, JSON.stringify(refunds));
    assert(Number(o.refunded_amount) === 500, 'refunded amount not updated: ' + o.refunded_amount);
    const cn = await rpc(stack, 'sty_return', { p: { id: uid(), saleId: a.id, mode: 'credit_note', reason: 'x', lines: [{ saleLineId: line, qty: 1 }] } }, owner);
    assert(!cn.data?.error, JSON.stringify(cn.data).slice(0, 200));
    o = (await orders()).find((x) => x.sty_sale_id === a.id);
    assert((await q('select count(*)::int n from sfx_refunds where order_id=$1', [o.id]))[0].n === 1, 'a credit note was copied as money back');
  }, 'critical');
  s.done();
}
