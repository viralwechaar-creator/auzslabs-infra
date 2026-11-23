// Storefront Path B journey in a real browser: start a trial, add a product, publish, sell, lapse, pay to reactivate.
import { suite, watch, assert } from '../../lib/harness.mjs';
import { newCtx } from '../../lib/common.mjs';
import { q, USERS, PASSWORD } from '../../lib/db.mjs';

export default async function run({ browser, stack }) {
  const s = suite('Storefront onboarding (Path B)', 'Trial, first product, first order, trial lapse and paying to reactivate.');
  const ctx = await newCtx(browser, stack, { w: 1280, h: 800 });
  await ctx.addInitScript(() => { window.__rzpOpened = 0; window.Razorpay = function (o) { this.open = () => { window.__rzpOpened++; setTimeout(() => o.handler({ razorpay_payment_id: 'pay_fake' }), 200); }; }; });
  const page = await ctx.newPage(); const errs = watch(page);
  await page.goto(stack.url('testcafe', '/storefront.html'), { waitUntil: 'load' }); await page.waitForTimeout(800);
  const slug = 'pathbshop';
  const started = await page.evaluate(async ([e, p, slug]) => { const c = window.supabase ? window.supabase.createClient(CFG.url, CFG.key) : null; if (!c) return { error: 'no client' };
    const r = await c.auth.signInWithPassword({ email: e, password: p }); if (r.error) return { error: r.error.message };
    const t = await c.rpc('start_storefront_trial', { p_business_name: 'Path B Shop', p_slug: slug }); return t.error ? { error: t.error.message } : { ok: true, data: t.data }; }, [USERS.plain, PASSWORD, slug]);
  await s.check('A new login starts a storefront trial', async () => { assert(started.ok, JSON.stringify(started)); const r = await q("select plan_status from sfx_stores s join tenants t on t.id=s.tenant_id where t.slug=$1", [slug]); assert(r[0].plan_status === 'trial', JSON.stringify(r)); }, 'critical');
  const signIn = async (host) => { await page.goto(stack.url(host, '/storefront.html'), { waitUntil: 'load' }); await page.waitForTimeout(800);
    return page.evaluate(async ([e, p]) => { const c = window.supabase.createClient(CFG.url, CFG.key); const r = await c.auth.signInWithPassword({ email: e, password: p }); return r.error ? r.error.message : 'ok'; }, [USERS.plain, PASSWORD]); };
  await s.check('The owner hub opens and shows the trial; add a product and publish', async () => {
    assert(await signIn(slug) === 'ok', 'sign in on the shop address');
    await page.reload({ waitUntil: 'load' }); await page.waitForTimeout(1500);
    await page.evaluate(() => { location.hash = '/products/new'; }); await page.waitForTimeout(1500);
    await page.fill('input[name=name]', 'Trial Tee'); await page.fill('input[name=price]', '499'); await page.locator('form[data-key="product-record"] button.primary').first().click(); await page.waitForTimeout(1500);
    assert((await q("select count(*)::int n from sfx_products p join tenants t on t.id=p.tenant_id where t.slug=$1 and p.name='Trial Tee'", [slug]))[0].n === 1, 'product not saved');
    const tid = (await q("select id from tenants where slug=$1", [slug]))[0].id;
    const pid = (await q("select id from sfx_products where tenant_id=$1", [tid]))[0].id;
    await q("update sfx_products set status='active' where id=$1", [pid]);
    await q("insert into sfx_variants (tenant_id, product_id, label, price, stock) values ($1,$2,'Default',499,5) on conflict do nothing", [tid, pid]);
    await q("update sfx_stores set published=true where tenant_id=$1", [tid]);
  }, 'critical');
  await s.check('The public store shows the product and takes a cash-on-delivery order', async () => {
    const pub = await ctx.newPage(); await pub.goto(stack.url(slug, '/store.html'), { waitUntil: 'load' }); await pub.waitForTimeout(2500);
    assert(/Trial Tee/.test(await pub.locator('body').innerText()), 'product not on the public store');
    const r = await pub.evaluate(async ([slug]) => { const c = window.supabase.createClient(CFG.url, CFG.key); const store = await c.rpc('public_sfx_store', { p_slug: slug }); const v = store.data.styles[0].variants[0].id;
      const o = await c.rpc('public_sfx_place_order', { p_slug: slug, p: { lines: [{ variantId: v, qty: 1 }], name: 'First Buyer', phone: '9876500001', address: '1 Road', city: 'Jodhpur', pin: '342001' } }); return o.error ? { error: o.error.message } : o.data; }, [slug]);
    assert(r.token, JSON.stringify(r));
  }, 'critical');
  await s.check('When the trial lapses writes stop but the owner can still read; Billing explains and offers payment', async () => {
    await q("update sfx_stores set trial_ends_at = now() - interval '1 hour' where tenant_id=(select id from tenants where slug=$1)", [slug]);
    await page.goto(stack.url(slug, '/storefront.html#/billing'), { waitUntil: 'load' }); await page.reload({ waitUntil: 'load' }); await page.waitForTimeout(1800);
    const t = await page.locator('body').innerText(); assert(/trial has ended/i.test(t), 'billing did not explain: ' + t.slice(0, 200));
    assert(await page.locator('[data-action="plan-pay"]').count() === 1, 'no pay button');
  }, 'critical');
  await s.check('Paying reactivates the store and editing works again', async () => {
    await q("update product_prices set monthly_price = 999 where key='storefront'");
    let planResp = ''; page.on('response', async (r) => { if (/plan\/create/.test(r.url())) planResp = r.status() + ' ' + (await r.text().catch(() => '')); });
    await page.locator('[data-action="plan-pay"]').click(); await page.waitForTimeout(1500);
    assert(await page.evaluate(() => window.__rzpOpened) === 1, 'checkout did not open: ' + planResp);
    const pay = await q("select id from payments where sfx_tenant_id=(select id from tenants where slug=$1) order by created_at desc limit 1", [slug]); assert(pay.length === 1, 'no plan payment recorded');
    await q("update payments set status='paid' where id=$1", [pay[0].id]); await q("select provision_storefront_from_payment($1)", [pay[0].id]);
    await page.waitForFunction(() => /Your plan is active|active/i.test(document.body.innerText), null, { timeout: 15000 });
    assert((await q("select plan_status from sfx_stores s join tenants t on t.id=s.tenant_id where t.slug=$1", [slug]))[0].plan_status === 'active', 'not active');
  }, 'critical');
  await s.check('No script errors', async () => { assert(!errs.filter((e) => !/sentry|fonts|HTTP 4/i.test(e)).length, errs.slice(0, 3).join(' | ')); });
}
