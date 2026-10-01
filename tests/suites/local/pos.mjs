// POS workflow coordination: cashier -> kitchen -> payment, and guest/waiter calls. These all passed individually before; the bugs were in how the pieces hand over to each other.
import { suite, watch, assert } from '../../lib/harness.mjs';
import { newCtx } from '../../lib/common.mjs';
import { q, PASSWORD, USERS } from '../../lib/db.mjs';

export default async function run({ browser, stack }) {
  const s = suite('POS workflow: order, kitchen, payment, guest calls', 'Takes a real dine-in order through the staff POS and checks that every screen and the database agree at each hand-over.');
  const ctx = await newCtx(browser, stack, { w: 1280, h: 900 }); const page = await ctx.newPage(); const errs = watch(page);
  page.on('dialog', (d) => d.accept().catch(() => {}));
  const tid = (await q("select id from tenants where slug='testcafe'"))[0].id;
  const orders = () => q("select data from records where tenant_id=$1 and kind='order'", [tid]).then((r) => r.map((x) => x.data));
  const kots = () => q("select count(*)::int n from records where tenant_id=$1 and kind='kotlog'", [tid]).then((r) => r[0].n);
  const until = async (fn, ms = 12000) => { const t0 = Date.now(); for (;;) { try { const v = await fn(); if (v) return v; } catch {} if (Date.now() - t0 > ms) return false; await page.waitForTimeout(300); } };
  const text = () => page.locator('body').innerText();
  const drawer = async (name) => { await page.evaluate(() => { const h = document.querySelector('.hamburger-btn'); h && h.click(); }); await page.waitForTimeout(300); await page.evaluate((n) => { const b = [...document.querySelectorAll('.drawer button')].find((x) => x.textContent.trim() === n); b && b.click(); }, name); await page.waitForTimeout(900); };

  await s.check('Staff sign-in opens the POS', async () => {
    await page.goto(stack.url('testcafe', '/index.html')); await page.waitForSelector('input[type=password]');
    await page.fill('input[type=email]', USERS.cafeOwner); await page.fill('input[type=password]', PASSWORD); await page.locator('button', { hasText: /sign in/i }).last().click();
    await page.waitForSelector('.tbl-tile', { timeout: 15000 });
  }, 'critical');

  await s.check('Send to kitchen: the order AND its KOT log reach the server, with no "unsynced" or "conflict" warning', async () => {
    await page.locator('.tbl-tile').first().click(); await page.waitForTimeout(400);
    const it = page.locator('.items button', { hasText: 'Chicken 65' }).first(); await it.click(); await it.click();
    await page.locator('input[placeholder*="Customer"]').first().fill('Workflow Guest'); await page.locator('input[placeholder*="Phone"]').first().fill('9811122233');
    await page.locator('button', { hasText: 'Send to kitchen' }).click();
    assert(await until(async () => (await orders()).length === 1 && (await kots()) === 1), 'order and kotlog did not both sync (the second save was dropped while the first was syncing)');
    await page.waitForTimeout(1500);
    const t = await text(); assert(!/unsynced/.test(t), 'still shows "unsynced"'); assert(!/conflict/i.test(t), 'shows a sync conflict');
  }, 'critical');

  await s.check('Kitchen screen shows the order, start preparing, then ready', async () => {
    await drawer('Kitchen'); assert(/TC-\d+/.test(await text()) && /2× Chicken 65/.test(await text()), 'order not on the kitchen screen');
    await page.locator('button', { hasText: 'Start preparing' }).first().click(); await page.waitForTimeout(800);
    await page.locator('button', { hasText: 'Food is ready' }).first().click();
    assert(await until(async () => (await orders())[0].kstat === 'ready'), 'ready did not reach the server');
  }, 'critical');

  await s.check('Paying with the one-tap "Exact" cash button completes the sale', async () => {
    await drawer('Sell');
    await page.locator('button', { hasText: /^Pay$/ }).first().click(); await page.waitForTimeout(500);
    await page.locator('.md button', { hasText: /^CASH$/i }).first().click(); await page.waitForTimeout(500);
    await page.locator('.md button', { hasText: /^Exact/ }).first().click(); await page.waitForTimeout(500);
    await page.locator('.md button', { hasText: /Complete and print/ }).first().click();
    assert(await until(async () => (await orders())[0].status === 'paid'), 'order was not marked paid');
    await page.waitForTimeout(800); await page.locator('.md button', { hasText: /^Done$/ }).first().click().catch(() => {}); await page.waitForTimeout(400);
  }, 'critical');

  await s.check('A paid order does not come back to the kitchen (the cashier\'s stale copy must not overwrite "ready")', async () => {
    const o = (await orders())[0];
    assert(o.kstat === 'ready' || o.kstat === 'served', 'kitchen status was reset to "' + o.kstat + '" by payment');
    assert(o.readyAt && o.preparingAt, 'the kitchen timestamps were wiped by payment');
    await drawer('Kitchen'); assert(/No orders waiting/.test(await text()), 'paid order is back on the kitchen screen');
    await drawer('Sell'); assert(!/Ready:/.test(await text()), 'a paid, served order is still in the "Ready" bar');
  }, 'critical');

  await s.check('A "Waiter called" alert is acknowledged without opening an empty order', async () => {
    await q("insert into guest_orders (tenant_id, tbl, name, phone, note, items) values ($1,'tbl-1','Table 1','','Waiter called','[]'::jsonb)", [tid]);
    const before = (await orders()).length;
    assert(await until(async () => /Got it/.test(await text()), 20000), 'waiter call never showed on the POS');
    await page.locator('button', { hasText: 'Got it' }).first().click();
    assert(await until(async () => (await q("select status from guest_orders where tenant_id=$1 and note='Waiter called'", [tid]))[0].status === 'done'), 'waiter call not marked done');
    assert((await orders()).length === before, 'acknowledging a waiter call created an empty order');
  });

  await s.check('The POS screen is not rebuilt every second (taps and typing survive)', async () => {
    await drawer('Sell'); await page.evaluate(() => { window.__marker = document.querySelector('.items') ; });
    await page.waitForTimeout(3500);
    assert(await page.evaluate(() => window.__marker === document.querySelector('.items')), 'the item grid was replaced by a re-render within 3.5 s');
  }, 'major');

  await s.check('No JavaScript errors during the whole workflow', async () => { const bad = errs.filter((e) => !/print|callback/i.test(e)); assert(!bad.length, bad.slice(0, 3).join(' | ')); }, 'major');
  await ctx.close(); s.done();
}
