// Buying journey on auzslab.in: account, cart, signup request, platform-admin login.
import { suite, watch, assert } from '../../lib/harness.mjs';
import { newCtx } from '../../lib/common.mjs';
import { PASSWORD, USERS, q } from '../../lib/db.mjs';

export default async function run({ browser, stack }) {
  const s = suite('Buying journey: sign up, choose products, request account, admin review', 'Real browser flow through signup.html, cart.html and the platform admin dashboard.');
  const ctx = await newCtx(browser, stack); const page = await ctx.newPage(); const errs = watch(page);
  const email = 'newclient-' + Date.now() + '@test.local';
  await s.check('New visitor can create an account', async () => {
    await page.goto(stack.url('', '/signup.html')); await page.waitForTimeout(700);
    await page.fill('#email', email); await page.fill('#password', PASSWORD); await page.click('#submitBtn'); await page.waitForTimeout(2000);
    const r = await q('select count(*)::int n from auth_users where email = $1', [email]); assert(r[0].n === 1, 'account not created; page says: ' + (await page.locator('#authErr').innerText().catch(() => '')));
  }, 'critical');
  await s.check('Signup refuses a weak/short password', async () => {
    const cw = await newCtx(browser, stack); const p = await cw.newPage(); await p.goto(stack.url('', '/signup.html')); await p.waitForTimeout(500);
    await p.fill('#email', 'weak-' + Date.now() + '@test.local'); await p.fill('#password', '123'); await p.click('#submitBtn'); await p.waitForTimeout(1000);
    const r = await q("select count(*)::int n from auth_users where email like 'weak-%'"); assert(r[0].n === 0, 'short password accepted'); await cw.close();
  });
  await s.check('Existing account can sign in again (login mode)', async () => {
    const c2 = await newCtx(browser, stack); const p = await c2.newPage();
    await p.goto(stack.url('', '/signup.html')); await p.waitForTimeout(500); await p.click('#modeLogin'); await p.fill('#email', USERS.plain); await p.fill('#password', PASSWORD); await p.click('#submitBtn'); await p.waitForTimeout(2000);
    assert(!/invalid|incorrect/i.test(await p.locator('#authErr').innerText().catch(() => '')), 'login rejected'); await c2.close();
  }, 'critical');
  await s.check('Platform admin signing in lands on the admin dashboard', async () => {
    const c3 = await newCtx(browser, stack); const p = await c3.newPage(); const e3 = watch(p);
    await p.goto(stack.url('', '/signup.html')); await p.waitForTimeout(500); await p.click('#modeLogin'); await p.fill('#email', USERS.admin); await p.fill('#password', PASSWORD); await p.click('#submitBtn');
    await p.waitForURL(/admin\.html/, { timeout: 10000 }).catch(() => {}); await p.waitForTimeout(1500);
    assert(/admin\.html/.test(p.url()), 'stayed on ' + p.url());
    const t = await p.locator('body').innerText(); assert(/lead|client|request/i.test(t), 'dashboard shows no admin sections');
    await s.shot(p, 'platform-admin-dashboard'); assert(!e3.length, e3.slice(0, 3).join(' | ')); await c3.close();
  }, 'critical');
  await s.check('Normal customer is NOT sent to (or shown) the admin dashboard', async () => {
    const c4 = await newCtx(browser, stack); const p = await c4.newPage();
    await p.goto(stack.url('', '/admin.html')); await p.waitForTimeout(800); await p.fill('#email', USERS.plain); await p.fill('#password', PASSWORD); await p.click('#signin'); await p.waitForTimeout(2000);
    const vis = await p.locator('#clientsList').isVisible().catch(() => false); const txt = await p.locator('#clientsList').innerText().catch(() => '');
    assert(!vis || !/testcafe|Test Cafe/i.test(txt), 'a normal customer can see the client list'); await c4.close();
  }, 'critical');
  await s.check('Cart page lets a signed-in visitor pick products and submit a request', async () => {
    const c5 = await newCtx(browser, stack); const p = await c5.newPage(); const e5 = watch(p);
    await p.goto(stack.url('', '/signup.html')); await p.waitForTimeout(500); await p.click('#modeLogin'); await p.fill('#email', USERS.plain); await p.fill('#password', PASSWORD); await p.click('#submitBtn'); await p.waitForTimeout(1500);
    await p.goto(stack.url('', '/products.html')); await p.waitForTimeout(800);
    const adds = p.locator('[data-cart-btn]'); assert((await adds.count()) >= 3, 'products page has too few Add to cart buttons');
    await adds.first().click(); await p.waitForTimeout(400);
    await p.goto(stack.url('', '/cart.html')); await p.waitForTimeout(1200);
    assert(/\S/.test(await p.locator('#cartItems').innerText()), 'cart is empty after adding a product');
    await p.fill('#contactName', 'QA Owner'); await p.fill('#contactPhone', '9811100011'); await p.fill('#bizName', 'QA Business'); await p.fill('#bizSlug', 'qabusiness' + (Date.now() % 10000));
    await p.selectOption('#bizNiche', { index: 1 }).catch(() => {}); await p.fill('#bizAddress', '1 Test Road').catch(() => {});
    await p.click('#submitBtn'); await p.waitForTimeout(2000);
    const r = await q("select count(*)::int n from signup_requests where business_name = 'QA Business'").catch(async () => q("select count(*)::int n from signup_requests"));
    assert(r[0].n >= 1, 'no signup request stored; page says: ' + (await p.locator('#submitErr').innerText().catch(() => '')));
    await s.shot(p, 'cart-submitted'); assert(!e5.some((x) => /JS error/.test(x)), e5.join(' | ')); await c5.close();
  }, 'critical');
  await s.check('Submitted request is visible to the platform admin', async () => {
    const c6 = await newCtx(browser, stack); const p = await c6.newPage();
    await p.goto(stack.url('', '/admin.html')); await p.waitForTimeout(800); await p.fill('#email', USERS.admin); await p.fill('#password', PASSWORD); await p.click('#signin'); await p.waitForTimeout(2500);
    assert(/QA Business/.test(await p.locator('#signupRequestsList').innerText()), 'request not listed'); await c6.close();
  }, 'critical');
  await ctx.close(); s.done();
}
