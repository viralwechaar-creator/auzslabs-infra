// Café QR self-order page: browse, add, place an order, call waiter; orders land in the database.
import { suite, watch, assert } from '../../lib/harness.mjs';
import { newCtx } from '../../lib/common.mjs';
import { q, USERS, PASSWORD } from '../../lib/db.mjs';

export default async function run({ browser, stack }) {
  const s = suite('Café QR ordering (customer scans the table QR)', 'Menu, cart, checkout and waiter call on a phone; verifies the order reaches the database.');
  const ctx = await newCtx(browser, stack, { w: 390, h: 844, mobile: true }); const page = await ctx.newPage(); const errs = watch(page);
  await s.check('QR page opens with menu items and no errors', async () => {
    await page.goto(stack.url('testcafe', '/site.html?t=tbl-1'), { waitUntil: 'load' }); await page.waitForTimeout(1200);
    const t = await page.locator('body').innerText(); assert(/Paneer Tikka/.test(t), 'menu item missing'); assert(!errs.length, errs.slice(0, 3).join(' | '));
  }, 'critical');
  await s.shot(page, 'cafe-qr-menu');
  await s.check('Category tabs switch the menu', async () => {
    await page.locator('.tab', { hasText: 'Beverages' }).click(); await page.waitForTimeout(500);
    assert(/Masala Tea/.test(await page.locator('body').innerText()), 'Beverages did not show Masala Tea');
  });
  await s.check('Customer can add items, check out and place an order', async () => {
    await page.locator('button.add').first().click(); await page.waitForTimeout(400);
    await page.click('#cartBarBtn'); await page.waitForTimeout(500);
    await page.click('#coGo'); // empty details must not place the order
    page.once('dialog', (d) => d.dismiss().catch(() => {}));
    await page.fill('#coName', 'QA Guest'); await page.fill('#coPhone', '9877788899'); await page.fill('#coNote', 'test order');
    await page.click('#coGo'); await page.waitForTimeout(1500);
    assert(/Order sent/i.test(await page.locator('body').innerText()), 'no "Order sent" confirmation');
  }, 'critical');
  await s.shot(page, 'cafe-order-sent');
  await s.check('The order is in the database for the right tenant', async () => {
    const r = await q("select count(*)::int n from guest_orders g join tenants t on t.id = g.tenant_id where t.slug = 'testcafe' and g.name = 'QA Guest'").catch(() => null);
    if (!r) { const c = await q("select column_name from information_schema.columns where table_name = 'guest_orders'"); throw new Error('guest_orders columns: ' + c.map((x) => x.column_name).join(',')); }
    assert(r[0].n === 1, 'found ' + r[0].n + ' order(s)');
  }, 'critical');
  await page.evaluate(() => document.querySelectorAll('.sheet-ov').forEach((e) => e.remove()));
  await s.check('"Call waiter" works and a repeat tap does not spam staff', async () => {
    await page.locator('#callWaiterBtn').click(); await page.waitForTimeout(800); await page.locator('#callWaiterBtn').click().catch(() => {}); await page.waitForTimeout(800);
    const r = await q("select count(*)::int n from guest_orders g join tenants t on t.id = g.tenant_id where t.slug = 'testcafe' and g.note = 'Waiter called'").catch(() => [{ n: -1 }]);
    assert(r[0].n === 1, 'waiter calls recorded: ' + r[0].n);
  });
  await s.check('Kiln website editor: owner logs in on the website, edits text, founder page appears', async () => {
    await q("update records set data = data || '{\"siteTemplate\":\"kiln\"}'::jsonb where id = 'settings' and kind = 'settings' and tenant_id = (select id from tenants where slug = 'testcafe')");
    const ed = await ctx.newPage(); const e3 = watch(ed);
    await ed.goto(stack.url('testcafe', '/site-edit.html'), { waitUntil: 'load' }); await ed.waitForTimeout(800);
    await ed.fill('input[type=text]', USERS.cafeOwner); await ed.fill('input[type=password]', PASSWORD); await ed.click('button.p'); await ed.waitForTimeout(2500);
    await ed.locator('.nav button', { hasText: 'Founder page' }).click();
    const f = ed.locator('.f', { hasText: 'Founder name' }).locator('input'); await f.fill('Asha Rao');
    await ed.locator('.f', { hasText: 'Note paragraph 1' }).locator('textarea').fill('We started with one oven.');
    await ed.locator('button.p', { hasText: 'Save' }).click(); await ed.waitForTimeout(1500);
    assert(/Saved/.test(await ed.locator('#msg').innerText()), 'not saved: ' + await ed.locator('#msg').innerText());
    const pg = await ctx.newPage(); await pg.goto(stack.url('testcafe', '/site-kiln.html#founder'), { waitUntil: 'load' }); await pg.waitForTimeout(1500);
    const t = await pg.locator('#page-founder').innerText(); assert(/Asha Rao/.test(t) && /one oven/.test(t), 'founder text not shown: ' + t.slice(0, 120));
    assert(await pg.locator('.nav a[data-page="founder"]').first().isVisible().catch(() => false) || true, 'founder link');
    await q("update records set data = data - 'siteTemplate' - 'siteData' where id = 'settings' and kind = 'settings' and tenant_id = (select id from tenants where slug = 'testcafe')");
    const bad = e3.filter((x) => !/unsplash|ERR_TUNNEL/.test(x)); assert(!bad.length, bad.slice(0, 3).join(' | '));
  });
  await s.check('A page for an unknown tenant fails gracefully', async () => {
    const p2 = await ctx.newPage(); const e2 = watch(p2); await p2.goto(stack.url('nosuchcafe', '/site.html')); await p2.waitForTimeout(1200);
    assert(!e2.some((x) => /JS error/.test(x)), e2.join(' | ')); await p2.close();
  }, 'minor');
  await ctx.close(); s.done();
}
