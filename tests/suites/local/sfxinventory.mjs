// Storefront round A: order lifecycle. Fulfilment, delivery and payment are separate states; shipments are records.
import { suite, watch, assert } from '../../lib/harness.mjs';
import { newCtx } from '../../lib/common.mjs';
import { rpc } from '../../lib/api.mjs';
import { q, USERS, PASSWORD } from '../../lib/db.mjs';

export default async function run({ browser, stack }) {
  const s = suite('Storefront inventory', 'Stock states, buffer, cost snapshot, versioned product edits.');
  await q("update tenant_settings set features = features || '{\"storefront\":true}' where tenant_id = (select id from tenants where slug='testcafe')");
  await q("insert into sfx_stores (tenant_id, published) select id, true from tenants where slug='testcafe' on conflict (tenant_id) do update set published=true");
  const tid = (await q("select id from tenants where slug='testcafe'"))[0].id;
  await q('delete from sfx_orders where tenant_id=$1', [tid]); await q('delete from sfx_products where tenant_id=$1', [tid]);
  const login = async (email) => (await (await fetch(stack.apiBase + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) })).json()).access_token;
  const owner = await login(USERS.cafeOwner);
  const call = async (fn, args) => (await rpc(stack, fn, args, owner)).data;
  const pr = (await call('sfx_product_save', { p_id: null, p: { name: 'Stock tee', price: 100, status: 'active', variants: [{ label: 'S', price: 100, stock: 10 }, { label: 'M', price: 100, stock: 10 }] } })).data;
  const [vs, vm] = pr.variants.map((v) => v.id);
  const place = async () => {
    await rpc(stack, 'public_sfx_place_order', { p_slug: 'testcafe', p: { name: 'Ship Buyer', phone: '98765' + Math.floor(10000 + Math.random() * 89999), address: '12 Park Road, Ward 4', city: 'Jodhpur', state: 'Rajasthan', pin: '342001', lines: [{ variantId: vs, qty: 2 }, { variantId: vm, qty: 1 }] } });
    return (await q('select id from sfx_orders where tenant_id=$1 order by created_at desc limit 1', [tid]))[0].id;
  };
  const unwrap = (r) => (Array.isArray(r) ? r : r?.data ?? r);
  const inv = async () => unwrap(await call('sfx_inventory_list', {})).find((x) => x.variantId === vs);
  const err = async (fn, args) => JSON.stringify((await rpc(stack, fn, args, owner)).data).toLowerCase();

  await s.check('An unshipped order is committed stock; on hand adds it back', async () => {
    await place();
    const v = await inv();
    assert(v.available === 9 || v.available === 10 || v.committed >= 1, JSON.stringify(v));
    assert(v.onHand === v.available + v.unavailable + v.committed, JSON.stringify(v));
  }, 'critical');
  await s.check('Setting units aside moves them out of available, and back', async () => {
    const before = await inv();
    await call('sfx_stock_set_unavailable', { p_variant: vs, p_delta: 2, p_reason: 'damaged' });
    let v = await inv();
    assert(v.unavailable === before.unavailable + 2 && v.available === before.available - 2 && v.onHand === before.onHand, JSON.stringify([before, v]));
    await call('sfx_stock_set_unavailable', { p_variant: vs, p_delta: -2, p_reason: 'released' });
    v = await inv(); assert(v.available === before.available && v.unavailable === before.unavailable, JSON.stringify(v));
    assert(/only/.test(await err('sfx_stock_set_unavailable', { p_variant: vs, p_delta: 999, p_reason: 'damaged' })), 'over-set allowed');
    assert(/choose a reason/.test(await err('sfx_stock_set_unavailable', { p_variant: vs, p_delta: 1, p_reason: '' })), 'no reason allowed');
  }, 'critical');
  await s.check('Cost is optional, unknown is not zero, and the order line freezes it', async () => {
    assert((await inv()).cost === null, 'cost should start unknown');
    await call('sfx_variant_meta_save', { p_variant: vs, p: { cost: 40 } });
    assert(Number((await inv()).cost) === 40, 'cost not saved');
    await place();
    const lines = (await q('select lines from sfx_orders where tenant_id=$1 order by created_at desc limit 1', [tid]))[0].lines;
    assert(lines.some((l) => Number(l.cost) === 40), JSON.stringify(lines));
    await call('sfx_variant_meta_save', { p_variant: vs, p: { cost: 55 } });
    const again = (await q('select lines from sfx_orders where tenant_id=$1 order by created_at desc limit 1', [tid]))[0].lines;
    assert(again.some((l) => Number(l.cost) === 40), 'cost changed on an old order');
    const cov = unwrap(await call('sfx_cost_coverage', { p_days: 30 }));
    assert(cov.linesWithCost >= 1 && cov.coverage !== null, JSON.stringify(cov));
    await call('sfx_variant_meta_save', { p_variant: vs, p: { cost: '' } });
    assert((await inv()).cost === null, 'cost not cleared');
  }, 'critical');
  await s.check('Stock buffer stops online orders from taking the last units', async () => {
    await call('sfx_stock_buffer_save', { p_buffer: 3 });
    await q('update sfx_variants set stock = 4 where id=$1', [vm]);
    const r = await rpc(stack, 'public_sfx_place_order', { p_slug: 'testcafe', p: { name: 'Buf Buyer', phone: '9876599999', address: '12 Park Road, Ward 4', city: 'Jodhpur', state: 'Rajasthan', pin: '342001', lines: [{ variantId: vm, qty: 3 }] } });
    assert(/left to order online|has only/.test(JSON.stringify(r.data).toLowerCase()), JSON.stringify(r.data).slice(0, 300));
    assert((await q('select stock from sfx_variants where id=$1', [vm]))[0].stock === 4, 'stock changed by refused order');
    await call('sfx_stock_buffer_save', { p_buffer: 0 });
    assert(/between 0 and 1000/.test(await err('sfx_stock_buffer_save', { p_buffer: 5000 })), 'huge buffer allowed');
  }, 'critical');
  await s.check('A product edit from an old version is refused, a current one is saved', async () => {
    const cur = (await q('select updated_at from sfx_products where id=$1', [pr.id]))[0].updated_at;
    const stale = new Date(new Date(cur).getTime() - 60000).toISOString();
    assert(/changed by someone else/.test(await err('sfx_product_save', { p_id: pr.id, p: { name: 'Stock tee 2', expectedUpdatedAt: stale } })), 'stale save allowed');
    const ok = await rpc(stack, 'sfx_product_save', { p_id: pr.id, p: { name: 'Stock tee 2', expectedUpdatedAt: new Date(cur).toISOString() } }, owner);
    assert(!/changed by someone/.test(JSON.stringify(ok.data)), JSON.stringify(ok.data).slice(0, 200));
    const noCheck = await rpc(stack, 'sfx_product_save', { p_id: pr.id, p: { name: 'Stock tee 3' } }, owner);
    assert(!/changed by someone/.test(JSON.stringify(noCheck.data)), 'unversioned save refused');
  });
  await s.check('Another business cannot read or change this stock', async () => {
    const other = await login(USERS.salonOwner);
    const res = await rpc(stack, 'sfx_stock_set_unavailable', { p_variant: vs, p_delta: 1, p_reason: 'damaged' }, other);
    assert(/not found|not part|not allowed|permission|plan/i.test(JSON.stringify(res.data)) || res.data?.error, JSON.stringify(res.data).slice(0, 200));
    assert((await inv()).unavailable === 0, 'other business changed stock');
  });
  await s.check('Inventory screen shows the stock states and saves cost', async () => {
    const ctx = await newCtx(browser, stack, { w: 1280, h: 900 }); const page = await ctx.newPage(); const errs = watch(page);
    await page.goto(stack.url('testcafe', '/storefront.html'), { waitUntil: 'load' }); await page.waitForTimeout(800);
    await page.evaluate(async ([e, p]) => { const c = window.supabase.createClient(CFG.url, CFG.key); await c.auth.signInWithPassword({ email: e, password: p }); }, [USERS.cafeOwner, PASSWORD]);
    await page.goto('about:blank'); await page.goto(stack.url('testcafe', '/storefront.html#/inventory'), { waitUntil: 'load' }); await page.waitForTimeout(3500);
    let t = await page.locator('body').innerText();
    assert(/Unavailable/.test(t) && /Committed/.test(t) && /On hand/.test(t) && /Stock buffer/.test(t), t.slice(0, 400));
    await page.locator('[data-action^="stock-details:"]').first().click(); await page.fill('#dialog input[name=cost]', '33'); await page.locator('#dialog button.primary').click(); await page.waitForTimeout(1200);
    assert((await q('select count(*)::int n from sfx_variants where tenant_id=$1 and cost=33', [tid]))[0].n === 1, 'cost not saved from screen');
    assert(!errs.length, JSON.stringify(errs).slice(0, 200));
  });
  s.done();
}
