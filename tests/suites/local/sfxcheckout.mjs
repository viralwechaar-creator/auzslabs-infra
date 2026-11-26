// Storefront round A: order lifecycle. Fulfilment, delivery and payment are separate states; shipments are records.
import { suite, watch, assert } from '../../lib/harness.mjs';
import { newCtx } from '../../lib/common.mjs';
import { rpc } from '../../lib/api.mjs';
import { q, USERS, PASSWORD } from '../../lib/db.mjs';

export default async function run({ browser, stack }) {
  const s = suite('Storefront checkout rules', 'Required fields, payment methods, limits, shipping tiers, GST split.');
  await q("update tenant_settings set features = features || '{\"storefront\":true}' where tenant_id = (select id from tenants where slug='testcafe')");
  await q("insert into sfx_stores (tenant_id, published) select id, true from tenants where slug='testcafe' on conflict (tenant_id) do update set published=true");
  const tid = (await q("select id from tenants where slug='testcafe'"))[0].id;
  await q('delete from sfx_orders where tenant_id=$1', [tid]); await q('delete from sfx_products where tenant_id=$1', [tid]);
  const login = async (email) => (await (await fetch(stack.apiBase + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) })).json()).access_token;
  const owner = await login(USERS.cafeOwner);
  const call = async (fn, args) => (await rpc(stack, fn, args, owner)).data;
  const pr = (await call('sfx_product_save', { p_id: null, p: { name: 'Rule tee', price: 100, status: 'active', variants: [{ label: 'S', price: 100, stock: 10 }, { label: 'M', price: 100, stock: 10 }] } })).data;
  const [vs, vm] = pr.variants.map((v) => v.id);
  const place = async () => {
    await rpc(stack, 'public_sfx_place_order', { p_slug: 'testcafe', p: { name: 'Ship Buyer', phone: '98765' + Math.floor(10000 + Math.random() * 89999), address: '12 Park Road, Ward 4', city: 'Jodhpur', state: 'Rajasthan', pin: '342001', lines: [{ variantId: vs, qty: 2 }, { variantId: vm, qty: 1 }] } });
    return (await q('select id from sfx_orders where tenant_id=$1 order by created_at desc limit 1', [tid]))[0].id;
  };
  const unwrap = (r) => (Array.isArray(r) ? r : r?.data ?? r);
  const put = async (lines, extra = {}) => {
    await q('update sfx_variants set stock = 100 where id = any($1)', [[vs, vm]]);
    return unwrap((await rpc(stack, 'public_sfx_place_order', { p_slug: 'testcafe', p: { name: 'Rule Buyer', phone: '98' + Math.floor(10000000 + Math.random() * 89999999), address: '1 Main Road', city: 'Jodhpur', state: 'Rajasthan', pin: '342001', lines, ...extra } })).data);
  };
  const msg = (r) => JSON.stringify(r).toLowerCase();
  const rules = async (p) => unwrap(await call('sfx_checkout_rules_save', { p }));
  const ord = async (num) => (await q('select * from sfx_orders where tenant_id=$1 and number=$2', [tid, num]))[0];
  const S = [{ variantId: vs, qty: 1 }];
  await q("update sfx_stores set config = coalesce(config, '{}'::jsonb) - 'shipping' - 'tax' - 'checkoutRules' where tenant_id=$1", [tid]);

  await s.check('A required email blocks an order without one', async () => {
    await rules({ fields: { email: 'required' }, payments: { cod: true, online: true } });
    assert(/email/.test(msg(await put(S))), 'order without email accepted');
    assert((await put(S, { email: 'a@b.co' })).number, 'order with email refused');
    await rules({ fields: { email: 'optional' } });
    assert((await put(S)).number, 'optional email still refused');
  }, 'critical');
  await s.check('Payment rules: cash on delivery can be switched off or capped; saving needs one method', async () => {
    await rules({ payments: { cod: false, online: true } });
    assert(/cash on delivery is not available/.test(msg(await put(S))), 'cod allowed although off');
    assert(/at least one/.test(msg((await rpc(stack, 'sfx_checkout_rules_save', { p: { payments: { cod: false, online: false } } }, owner)).data)), 'no payment method saved');
    await rules({ payments: { cod: true, online: true, codMax: 150 } });
    assert((await put(S)).number, 'small cod refused');
    assert(/up to rs 150/.test(msg(await put([{ variantId: vs, qty: 2 }]))), 'big cod accepted');
    await rules({ payments: { cod: true, online: true, codMax: 0 } });
  }, 'critical');
  await s.check('Order and product limits are enforced', async () => {
    await rules({ limits: { minOrder: 150, maxItems: 3 } });
    assert(/minimum order/.test(msg(await put(S))), 'below minimum accepted');
    assert(/up to 3 items/.test(msg(await put([{ variantId: vs, qty: 4 }]))), 'too many items accepted');
    await rules({ limits: { minOrder: 0, maxItems: 0 } });
    await call('sfx_product_rules_save', { p_id: pr.id, p: { maxPerOrder: 2, minPerOrder: 1 } });
    assert(/up to 2 at a time/.test(msg(await put([{ variantId: vs, qty: 3 }]))), 'product max ignored');
    assert(/minimum cannot be above/.test(msg((await rpc(stack, 'sfx_product_rules_save', { p_id: pr.id, p: { maxPerOrder: 1, minPerOrder: 3 } }, owner)).data)), 'min above max saved');
    await call('sfx_product_rules_save', { p_id: pr.id, p: {} });
  }, 'critical');
  await s.check('Shipping tiers pick the fee by order size and the order keeps the reason', async () => {
    await call('sfx_checkout_settings_save', { p: { shipping: { fee: 99, freeOver: 0 } } });
    await call('sfx_shipping_tiers_save', { p_tiers: [{ upTo: 150, fee: 40, label: 'Small order' }, { upTo: null, fee: 20, label: 'Big order' }] });
    const a = await put(S); const b = await put([{ variantId: vs, qty: 2 }]);
    assert(Number(a.shipping) === 40 && (await ord(a.number)).shipping_label === 'Small order', JSON.stringify([a.shipping]));
    assert(Number(b.shipping) === 20 && (await ord(b.number)).shipping_label === 'Big order', JSON.stringify([b.shipping]));
    const quote = unwrap((await rpc(stack, 'public_sfx_shipping_quote', { p_slug: 'testcafe', p: { state: 'Goa', amount: 100 } })).data);
    assert(Number(quote.fee) === 40 && quote.label === 'Small order', JSON.stringify(quote));
    await call('sfx_checkout_settings_save', { p: { shipping: { fee: 99, freeOver: 0, zones: [{ name: 'Rajasthan', states: ['Rajasthan'], fee: 10, freeOver: 0 }] } } });
    await call('sfx_shipping_tiers_save', { p_tiers: [{ upTo: 150, fee: 40, label: 'Small order' }] });
    await call('sfx_checkout_settings_save', { p: { shipping: { fee: 99, freeOver: 0, zones: [{ name: 'Rajasthan', states: ['Rajasthan'], fee: 10, freeOver: 0 }] } } });
    assert((await q('select jsonb_array_length(config->\'shipping\'->\'tiers\') n from sfx_stores where tenant_id=$1', [tid]))[0].n === 1, 'tiers lost on a shipping settings save');
    const z = await put(S); assert(Number(z.shipping) === 10 && (await ord(z.number)).shipping_label === 'Rajasthan delivery', 'zone should beat tiers: ' + JSON.stringify(z) + JSON.stringify((await ord(z.number) || {}).shipping_label));
    await call('sfx_checkout_settings_save', { p: { shipping: { fee: 0, freeOver: 0 } } });
    await call('sfx_shipping_tiers_save', { p_tiers: [] });
  }, 'critical');
  await s.check('GST is worked out per line and split into CGST+SGST inside the state, IGST outside', async () => {
    await call('sfx_tax_settings_save', { p: { rate: 5, inclusive: false, gstin: '', label: 'GST', sellerState: 'Rajasthan' } });
    const a = await put(S); if (!a.number) assert(false, 'tax order failed: ' + JSON.stringify(a)); const oa = await ord(a.number);
    assert(Number(oa.tax) === 5 && Number(oa.tax_split.cgst) === 2.5 && Number(oa.tax_split.sgst) === 2.5 && Number(oa.total) === 105, JSON.stringify([oa.tax, oa.tax_split, oa.total]));
    const b = await put(S, { state: 'Goa' }); const ob = await ord(b.number);
    assert(Number(ob.tax_split.igst) === 5 && !ob.tax_split.cgst, JSON.stringify(ob.tax_split));
    await call('sfx_product_rules_save', { p_id: pr.id, p: { taxRate: 18, hsn: '6109' } });
    const c = await put(S); const oc = await ord(c.number);
    assert(Number(oc.tax) === 18 && Number(oc.total) === 118, JSON.stringify([oc.tax, oc.total]));
    const detail = unwrap(await call('sfx_order_get', { p_id: oc.id }));
    assert(detail.taxSplit && Number(detail.taxSplit.cgst) === 9, JSON.stringify(detail.taxSplit));
    await call('sfx_product_rules_save', { p_id: pr.id, p: {} });
    const keep = unwrap(await call('sfx_tax_settings_save', { p: { rate: 5, inclusive: false, gstin: '', label: 'GST' } }));
    assert((await q('select config->\'tax\'->>\'sellerState\' s from sfx_stores where tenant_id=$1', [tid]))[0].s === 'Rajasthan', 'seller state lost on a later tax save');
    await call('sfx_tax_settings_save', { p: { rate: 0, inclusive: true, gstin: '', label: 'GST' } });
  }, 'critical');
  await s.check('The public store shows the checkout rules, and another business cannot change them', async () => {
    await rules({ fields: { email: 'required' } });
    const st = unwrap((await rpc(stack, 'public_sfx_store', { p_slug: 'testcafe' })).data);
    assert(st.config.checkoutRules.fields.email === 'required', JSON.stringify(st.config).slice(0, 200));
    await rules({ fields: { email: 'optional' } });
    const other = await login(USERS.salonOwner);
    const r = await rpc(stack, 'sfx_checkout_rules_save', { p: { fields: { email: 'hidden' } } }, other);
    assert(/not part|not allowed|plan|permission/i.test(JSON.stringify(r.data)) || r.data?.error, JSON.stringify(r.data).slice(0, 200));
    assert((await q('select config->\'checkoutRules\'->\'fields\'->>\'email\' e from sfx_stores where tenant_id=$1', [tid]))[0].e === 'optional', 'other business changed our rules');
  });
  await s.check('Dashboard: checkout rules and shipping tiers save from the screens', async () => {
    const ctx = await newCtx(browser, stack, { w: 1280, h: 900 }); const page = await ctx.newPage(); const errs = watch(page);
    await page.goto(stack.url('testcafe', '/storefront.html'), { waitUntil: 'load' }); await page.waitForTimeout(800);
    await page.evaluate(async ([e, p]) => { const c = window.supabase.createClient(CFG.url, CFG.key); await c.auth.signInWithPassword({ email: e, password: p }); }, [USERS.cafeOwner, PASSWORD]);
    await page.goto('about:blank'); await page.goto(stack.url('testcafe', '/storefront.html#/shipping'), { waitUntil: 'load' }); await page.waitForTimeout(3500);
    await page.fill('textarea[name=tiers]', '300 | 45 | Small bag\n | 25 | Big bag'); await page.locator('form[data-key="shipping-tiers"] button.primary, [data-key="shipping-tiers"] button[type=submit]').first().click(); await page.waitForTimeout(1500);
    const t = (await q('select config->\'shipping\'->\'tiers\' t from sfx_stores where tenant_id=$1', [tid]))[0].t;
    assert(t && t.length === 2 && Number(t[0].fee) === 45 && t[1].upTo === null, JSON.stringify(t));
    assert(!errs.length, JSON.stringify(errs).slice(0, 200));
  });
  s.done();
}
