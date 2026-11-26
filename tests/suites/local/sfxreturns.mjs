// Storefront round A: order lifecycle. Fulfilment, delivery and payment are separate states; shipments are records.
import { suite, watch, assert } from '../../lib/harness.mjs';
import { newCtx } from '../../lib/common.mjs';
import { rpc } from '../../lib/api.mjs';
import { q, USERS, PASSWORD } from '../../lib/db.mjs';

export default async function run({ browser, stack }) {
  const s = suite('Storefront returns and refunds', 'Refund records, restock choice on returns, cancel reasons, test orders.');
  await q("update tenant_settings set features = features || '{\"storefront\":true}' where tenant_id = (select id from tenants where slug='testcafe')");
  await q("insert into sfx_stores (tenant_id, published) select id, true from tenants where slug='testcafe' on conflict (tenant_id) do update set published=true");
  const tid = (await q("select id from tenants where slug='testcafe'"))[0].id;
  await q('delete from sfx_orders where tenant_id=$1', [tid]); await q('delete from sfx_products where tenant_id=$1', [tid]);
  const login = async (email) => (await (await fetch(stack.apiBase + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) })).json()).access_token;
  const owner = await login(USERS.cafeOwner);
  const call = async (fn, args) => (await rpc(stack, fn, args, owner)).data;
  const pr = (await call('sfx_product_save', { p_id: null, p: { name: 'Return tee', price: 100, status: 'active', variants: [{ label: 'S', price: 100, stock: 10 }, { label: 'M', price: 100, stock: 10 }] } })).data;
  const [vs, vm] = pr.variants.map((v) => v.id);
  const place = async () => {
    await rpc(stack, 'public_sfx_place_order', { p_slug: 'testcafe', p: { name: 'Ship Buyer', phone: '98765' + Math.floor(10000 + Math.random() * 89999), address: '12 Park Road, Ward 4', city: 'Jodhpur', state: 'Rajasthan', pin: '342001', lines: [{ variantId: vs, qty: 2 }, { variantId: vm, qty: 1 }] } });
    return (await q('select id from sfx_orders where tenant_id=$1 order by created_at desc limit 1', [tid]))[0].id;
  };
  const unwrap = (r) => (Array.isArray(r) ? r : r?.data ?? r);
  const err = async (fn, args) => JSON.stringify((await rpc(stack, fn, args, owner)).data).toLowerCase();
  const stockOf = async (v) => (await q('select stock from sfx_variants where id=$1', [v]))[0].stock;
  const fulfilled = async () => { await q('update sfx_variants set stock = 50 where id = any($1)', [[vs, vm]]); const id = await place(); await call('sfx_shipment_create', { p_order: id, p: { items: [{ variantId: vs, qty: 2 }, { variantId: vm, qty: 1 }] } }); await q("update sfx_orders set payment_status='paid' where id=$1", [id]); return id; };

  await s.check('A refund is its own record, partial refunds add up, and cannot exceed the order', async () => {
    const id = await fulfilled(); const o = (await q('select total from sfx_orders where id=$1', [id]))[0];
    const total = Number(o.total);
    const r1 = unwrap(await call('sfx_refund_record', { p_order: id, p: { amount: 10, method: 'manual', reason: 'Goodwill' } }));
    assert(r1.refundState === 'partial' && Number(r1.refundedAmount) === 10 && r1.refunds.length === 1, JSON.stringify(r1).slice(0, 300));
    assert(/at most/.test(await err('sfx_refund_record', { p_order: id, p: { amount: total, method: 'manual' } })), 'over-refund allowed');
    assert(/above zero/.test(await err('sfx_refund_record', { p_order: id, p: { amount: 0, method: 'manual' } })), 'zero refund allowed');
    const r2 = unwrap(await call('sfx_refund_record', { p_order: id, p: { amount: total - 10, method: 'store_credit' } }));
    assert(r2.refundState === 'full' && r2.refunds.length === 2 && r2.paymentStatus === 'paid', JSON.stringify([r2.refundState, r2.paymentStatus]));
  }, 'critical');
  await s.check('A return received with restock off does not put the stock back; with restock on it does', async () => {
    const id = await fulfilled();
    const mk = async () => unwrap(await call('sfx_return_create', { p_order: id, p_lines: [{ variantId: vs, qty: 1 }], p_reason: 'Wrong size' }));
    const a = await mk(); await call('sfx_return_set', { p_id: a.id, p_status: 'approved' });
    const before = await stockOf(vs);
    await call('sfx_return_receive', { p_id: a.id, p_lines: [{ variantId: vs, restock: false }] });
    assert(await stockOf(vs) === before, 'stock changed although restock was off');
    const b = await mk(); await call('sfx_return_set', { p_id: b.id, p_status: 'approved' });
    await call('sfx_return_receive', { p_id: b.id, p_lines: [] });
    assert(await stockOf(vs) === before + 1, 'stock not restored by default');
    assert(/approved return/.test(await err('sfx_return_receive', { p_id: b.id, p_lines: [] })), 'received twice');
  }, 'critical');
  await s.check('A refunded return becomes a refund record on the order', async () => {
    const id = await fulfilled();
    const a = unwrap(await call('sfx_return_create', { p_order: id, p_lines: [{ variantId: vs, qty: 1 }], p_reason: 'Defect' }));
    await call('sfx_return_set', { p_id: a.id, p_status: 'approved' }); await call('sfx_return_receive', { p_id: a.id, p_lines: [] });
    await call('sfx_return_set', { p_id: a.id, p_status: 'refunded', p_amount: 100 });
    const o = unwrap(await call('sfx_order_get', { p_id: id }));
    assert(Number(o.refundedAmount) === 100 && o.refunds.length === 1 && o.refunds[0].method === 'manual', JSON.stringify(o.refunds));
  }, 'critical');
  await s.check('Cancel needs a reason, restocks by default, and can skip restocking', async () => {
    const a = await place(); const before = await stockOf(vs);
    assert(/reason/.test(await err('sfx_order_cancel', { p_order: a, p: { reason: '' } })), 'cancel without reason');
    const o = unwrap(await call('sfx_order_cancel', { p_order: a, p: { reason: 'Customer changed mind' } }));
    assert(o.status === 'cancelled' && o.cancelReason === 'Customer changed mind' && await stockOf(vs) === before + 2, JSON.stringify([o.status, o.cancelReason]));
    const b = await place(); const mid = await stockOf(vs);
    await call('sfx_order_cancel', { p_order: b, p: { reason: 'Damaged in packing', restock: false } });
    assert(await stockOf(vs) === mid, 'stock came back although restock was off');
  }, 'critical');
  await s.check('Test orders are flagged and left out of cost coverage', async () => {
    await call('sfx_variant_meta_save', { p_variant: vs, p: { cost: 10 } });
    const id = await place();
    const before = unwrap(await call('sfx_cost_coverage', { p_days: 30 }));
    await call('sfx_order_mark_test', { p_order: id, p_test: true });
    const after = unwrap(await call('sfx_cost_coverage', { p_days: 30 }));
    assert(after.lines < before.lines && unwrap(await call('sfx_order_get', { p_id: id })).isTest === true, JSON.stringify([before.lines, after.lines]));
  });
  const uiOrder = async (id, act) => {
    const ctx = await newCtx(browser, stack, { w: 1280, h: 900 }); const page = await ctx.newPage(); const errs = watch(page);
    await page.goto(stack.url('testcafe', '/storefront.html'), { waitUntil: 'load' }); await page.waitForTimeout(800);
    await page.evaluate(async ([e, p]) => { const c = window.supabase.createClient(CFG.url, CFG.key); await c.auth.signInWithPassword({ email: e, password: p }); }, [USERS.cafeOwner, PASSWORD]);
    await page.goto('about:blank'); await page.goto(stack.url('testcafe', '/storefront.html#/orders/' + id), { waitUntil: 'load' }); await page.waitForTimeout(3500);
    await act(page); assert(!errs.length, JSON.stringify(errs).slice(0, 200)); await ctx.close();
  };
  await s.check('Order screen: record a refund', async () => {
    const id = await fulfilled();
    await uiOrder(id, async (page) => {
      await page.locator('[data-action^="refund-new:"]').click(); await page.waitForTimeout(500); await page.fill('#dialog input[name=amount]', '25'); await page.locator('#dialog button.primary').click(); await page.waitForTimeout(1500);
      assert(/Refunded .*25/.test(await page.locator('body').innerText()), 'refund not shown');
    });
  });
  await s.check('Order screen: cancel with a reason', async () => {
    await q('update sfx_variants set stock = 50 where id = any($1)', [[vs, vm]]);
    const c = await place();
    await uiOrder(c, async (page) => {
      await page.locator('[data-action^="order-cancel:"]').click(); await page.waitForTimeout(500); await page.locator('#dialog button.primary').click(); await page.waitForTimeout(1500);
    });
    assert((await q('select cancel_reason from sfx_orders where id=$1', [c]))[0].cancel_reason === 'Customer changed mind', 'cancel reason not saved');
  });
  s.done();
}
