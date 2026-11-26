// Storefront round A: order lifecycle. Fulfilment, delivery and payment are separate states; shipments are records.
import { suite, watch, assert } from '../../lib/harness.mjs';
import { newCtx } from '../../lib/common.mjs';
import { rpc } from '../../lib/api.mjs';
import { q, USERS, PASSWORD } from '../../lib/db.mjs';

export default async function run({ browser, stack }) {
  const s = suite('Storefront reports', 'Funnel, sessions, cohorts, RFM, inventory, profit with cost coverage.');
  await q("update tenant_settings set features = features || '{\"storefront\":true}' where tenant_id = (select id from tenants where slug='testcafe')");
  await q("insert into sfx_stores (tenant_id, published) select id, true from tenants where slug='testcafe' on conflict (tenant_id) do update set published=true");
  const tid = (await q("select id from tenants where slug='testcafe'"))[0].id;
  await q('delete from sfx_orders where tenant_id=$1', [tid]); await q('delete from sfx_products where tenant_id=$1', [tid]);
  const login = async (email) => (await (await fetch(stack.apiBase + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) })).json()).access_token;
  const owner = await login(USERS.cafeOwner);
  const call = async (fn, args) => (await rpc(stack, fn, args, owner)).data;
  const pr = (await call('sfx_product_save', { p_id: null, p: { name: 'Report tee', price: 100, status: 'active', variants: [{ label: 'S', price: 100, stock: 10 }, { label: 'M', price: 100, stock: 10 }] } })).data;
  const [vs, vm] = pr.variants.map((v) => v.id);
  const place = async () => {
    await rpc(stack, 'public_sfx_place_order', { p_slug: 'testcafe', p: { name: 'Ship Buyer', phone: '98765' + Math.floor(10000 + Math.random() * 89999), address: '12 Park Road, Ward 4', city: 'Jodhpur', state: 'Rajasthan', pin: '342001', lines: [{ variantId: vs, qty: 2 }, { variantId: vm, qty: 1 }] } });
    return (await q('select id from sfx_orders where tenant_id=$1 order by created_at desc limit 1', [tid]))[0].id;
  };
  const unwrap = (r) => (Array.isArray(r) ? r : r?.data ?? r);
  const err = async (fn, args, tok = owner) => JSON.stringify((await rpc(stack, fn, args, tok)).data).toLowerCase();
  const put = async (lines, phone, extra = {}) => {
    await q('update sfx_variants set stock = greatest(stock, 50) where id = any($1)', [[vs, vm]]);
    return unwrap((await rpc(stack, 'public_sfx_place_order', { p_slug: 'testcafe', p: { name: 'Rep ' + phone, phone, address: '1 Main Road', city: 'Jodhpur', state: 'Rajasthan', pin: '342001', lines, ...extra } })).data);
  };
  await q('delete from sfx_web_events where tenant_id=$1', [tid]);
  await call('sfx_variant_meta_save', { p_variant: vs, p: { cost: 40 } });
  const a = await put([{ variantId: vs, qty: 2 }], '9800000001'); // 200, cost known
  const b = await put([{ variantId: vm, qty: 1 }], '9800000002'); // 100, cost unknown
  const c = await put([{ variantId: vs, qty: 1 }], '9800000001'); // repeat customer 100
  const t = await put([{ variantId: vs, qty: 3 }], '9800000003'); // test order, must not count
  await q('update sfx_orders set is_test=true where tenant_id=$1 and number=$2', [tid, t.number]);
  const x = await put([{ variantId: vs, qty: 1 }], '9800000004'); // cancelled, must not count
  await call('sfx_order_cancel', { p_order: (await q('select id from sfx_orders where tenant_id=$1 and number=$2', [tid, x.number]))[0].id, p: { reason: 'Test cancel' } });
  const ev = async (sid, kinds) => { for (const k of kinds) await q("insert into sfx_web_events (tenant_id, sid, kind, page, device) values ($1,$2,$3,'/','phone')", [tid, sid, k]); };
  await ev('sess-aaaaaaaa', ['view', 'product', 'bag', 'checkout', 'order']); await ev('sess-bbbbbbbb', ['view', 'product', 'bag']); await ev('sess-cccccccc', ['view', 'product']); await ev('sess-dddddddd', ['view']);

  await s.check('Profit report ignores test and cancelled orders and states how much cost is known', async () => {
    const r = unwrap(await call('sfx_report_profit', { p_days: 30 }));
    assert(r.orders === 3 && Number(r.grossSales) === 400, JSON.stringify([r.orders, r.grossSales]));
    assert(Number(r.profitOnKnownCost) === 180 && Number(r.costKnown) === 120, JSON.stringify([r.profitOnKnownCost, r.costKnown]));
    assert(Number(r.costCoverage) === 75, 'coverage ' + r.costCoverage);
    assert(r.topProducts.length >= 1, JSON.stringify(r.topProducts));
  }, 'critical');
  await s.check('Refunds reduce net sales', async () => {
    const id = (await q('select id from sfx_orders where tenant_id=$1 and number=$2', [tid, b.number]))[0].id;
    await q("update sfx_orders set payment_status='paid' where id=$1", [id]);
    const before = Number(unwrap(await call('sfx_report_profit', { p_days: 30 })).netSales);
    await call('sfx_refund_record', { p_order: id, p: { amount: 30, method: 'manual' } });
    const after = Number(unwrap(await call('sfx_report_profit', { p_days: 30 })).netSales);
    assert(before - after === 30, JSON.stringify([before, after]));
  }, 'critical');
  await s.check('Funnel counts each step once per visitor and gives the conversion rate', async () => {
    const f = unwrap(await call('sfx_report_funnel', { p_days: 30 }));
    const n = Object.fromEntries(f.steps.map((s2) => [s2.step, s2.count]));
    assert(n.Sessions === 4 && n['Viewed a product'] === 3 && n['Added to bag'] === 2 && n['Reached checkout'] === 1 && n['Placed an order'] === 3, JSON.stringify(f.steps));
    assert(Number(f.conversionRate) === 75, 'conversion ' + f.conversionRate);
    assert(f.byDevice[0].device === 'phone' && f.byDevice[0].sessions === 4, JSON.stringify(f.byDevice));
  }, 'critical');
  await s.check('Sessions report counts one-page visits and daily sessions', async () => {
    const r = unwrap(await call('sfx_report_sessions', { p_days: 30 }));
    assert(r.sessions === 4 && Number(r.singleEventShare) === 25 && r.daily.length === 1 && r.topPages[0].views === 4, JSON.stringify(r).slice(0, 300));
  });
  await s.check('RFM labels customers and the repeat buyer ranks first by money', async () => {
    const r = unwrap(await call('sfx_report_rfm', {}));
    assert(r.customers === 2, 'customers ' + r.customers);
    assert(Number(r.top[0].spent) === 300 && r.top[0].orders === 2, JSON.stringify(r.top[0]));
    assert(r.segments.reduce((n, s2) => n + s2.customers, 0) === 2, JSON.stringify(r.segments));
  });
  await s.check('Cohorts: this month has the first-time customers, and none are counted twice', async () => {
    const r = unwrap(await call('sfx_report_cohorts', { p_months: 3 }));
    assert(r.length === 1 && r[0].customers === 2 && r[0].retention[0].returned === 2, JSON.stringify(r));
  });
  await s.check('Inventory report shows sold, cover, flags and stock value only where cost is known', async () => {
    await q('update sfx_variants set stock = 0 where id=$1', [vm]);
    const r = unwrap(await call('sfx_report_inventory', { p_days: 30 }));
    const rowS = r.rows.find((x) => x.variantId === vs); const rowM = r.rows.find((x) => x.variantId === vm);
    assert(rowS.sold === 3 && rowM.sold === 1 && rowM.flag === 'out_of_stock', JSON.stringify([rowS, rowM]));
    assert(r.rows[0].abc === 'A' && Number(r.stockValueAtCost) === rowS.available * 40 && r.stockWithoutCost >= 0, JSON.stringify([r.rows[0].abc, r.stockValueAtCost]));
  });
  await s.check('Dashboard layout: chosen from a fixed list, saved once per card, and only managers save', async () => {
    const saved = unwrap(await call('sfx_dashboard_layout_save', { p_cards: ['profit', 'sales', 'profit'] }));
    assert(JSON.stringify(saved) === JSON.stringify(['profit', 'sales']), JSON.stringify(saved));
    assert(JSON.stringify(unwrap(await call('sfx_dashboard_layout_get', {}))) === JSON.stringify(['profit', 'sales']), 'not stored');
    assert(/unknown card/.test(await err('sfx_dashboard_layout_save', { p_cards: ['sales', 'secrets'] })), 'unknown card saved');
    assert(/at least one/.test(await err('sfx_dashboard_layout_save', { p_cards: [] })), 'empty layout saved');
  });
  await s.check('Another business sees none of this', async () => {
    const other = await login(USERS.salonOwner);
    assert(/error/.test(await err('sfx_report_profit', { p_days: 30 }, other)), 'other business could run the report');
  });
  await s.check('Insights page shows the funnel, profit and customer reports', async () => {
    const ctx = await newCtx(browser, stack, { w: 1280, h: 900 }); const page = await ctx.newPage(); const errs = watch(page);
    await page.goto(stack.url('testcafe', '/storefront.html'), { waitUntil: 'load' }); await page.waitForTimeout(800);
    await page.evaluate(async ([e, p]) => { const c = window.supabase.createClient(CFG.url, CFG.key); await c.auth.signInWithPassword({ email: e, password: p }); }, [USERS.cafeOwner, PASSWORD]);
    await q("update sfx_stores set config = config - 'dashboardLayout' where tenant_id=$1", [tid]);
    await page.goto('about:blank'); await page.goto(stack.url('testcafe', '/storefront.html#/insights'), { waitUntil: 'load' }); await page.waitForTimeout(4500);
    const t = await page.locator('body').innerText();
    assert(/Visitor funnel/.test(t) && /Net sales/.test(t) && /known cost/.test(t) && /Customers by recency/.test(t), JSON.stringify(t.slice(0, 300)) + ' ERRS ' + JSON.stringify(errs).slice(0, 400));
    assert(!errs.length, JSON.stringify(errs).slice(0, 200));
  });
  await s.check('Insights: choose which cards show and their order', async () => {
    const ctx = await newCtx(browser, stack, { w: 1280, h: 900 }); const page = await ctx.newPage(); const errs = watch(page);
    await page.goto(stack.url('testcafe', '/storefront.html'), { waitUntil: 'load' }); await page.waitForTimeout(800);
    await page.evaluate(async ([e, p]) => { const c = window.supabase.createClient(CFG.url, CFG.key); await c.auth.signInWithPassword({ email: e, password: p }); }, [USERS.cafeOwner, PASSWORD]);
    await q("update sfx_stores set config = config - 'dashboardLayout' where tenant_id=$1", [tid]);
    await page.goto('about:blank'); await page.goto(stack.url('testcafe', '/storefront.html#/insights'), { waitUntil: 'load' }); await page.waitForTimeout(4500);
    let t = await page.locator('main, body').first().innerText();
    assert(/Orders right now/.test(t) && /Visitor funnel/.test(t) && /Customers who came back/.test(t), 'default cards wrong');
    await page.evaluate(() => document.querySelector('[data-action="layout-open"]').click()); await page.waitForTimeout(500);
    await page.evaluate(() => document.querySelector('#dialog [data-action="layout-hide:funnel"]').click()); await page.waitForTimeout(300);
    await page.evaluate(() => document.querySelector('#dialog [data-action="layout-move:cohorts:up"]').click()); await page.waitForTimeout(300);
    await page.evaluate(() => document.querySelector('#dialog [data-action="layout-save"]').click()); await page.waitForTimeout(1500);
    const saved = (await q("select config->'dashboardLayout' l from sfx_stores where tenant_id=$1", [tid]))[0].l;
    assert(!saved.includes('funnel') && saved.includes('cohorts') && saved.indexOf('cohorts') < saved.indexOf('customers'), JSON.stringify(saved));
    t = await page.locator('main, body').first().innerText();
    assert(!/Visitor funnel/.test(t) && /Customers who came back/.test(t), 'page did not follow the choice');
    assert(!errs.length, JSON.stringify(errs).slice(0, 200));
  });
  s.done();
}
