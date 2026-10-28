// AUZsScan beginner view (p-easy.js): short menu, quick bill, guided "+" menu, checklist and tour, plain words and "?" help.
// Every ledger feature must still be one switch away, and AUZsLedger itself must be unchanged.
import { suite, watch, assert } from '../../lib/harness.mjs';
import { newCtx } from '../../lib/common.mjs';
import { rpc } from '../../lib/api.mjs';
import { q, PASSWORD, USERS } from '../../lib/db.mjs';

export default async function run({ browser, stack }) {
  const s = suite('AUZsScan beginner view', 'AUZsScan starts with a short menu, a quick bill, a checklist and plain words; every ledger tool stays one switch away; AUZsLedger is untouched.');
  const login = async (email) => (await (await fetch(stack.apiBase + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) })).json()).access_token;
  const owner = await login(USERS.acctOwner);
  const call = async (fn, args) => { const r = await rpc(stack, fn, args || {}, owner); return r.data && r.data.data; };
  await call('acc_bootstrap');
  await call('acc_save_org', { p: { legal_name: 'Easy Test Traders', state_code: '08', gstin: '08AAACR5055K1Z7', reg_type: 'regular' } });
  const tid = (await q("select id from tenants where slug='testacct'"))[0].id;

  const open = async (dev) => {
    const c = await newCtx(browser, stack, { ...dev, simple: true }); const page = await c.newPage(); const errs = watch(page);
    await page.goto(stack.url('testacct', '/scan.html')); await page.waitForSelector('input[type=password]', { timeout: 20000 });
    await page.fill('input[type=email]', USERS.acctOwner); await page.fill('input[type=password]', PASSWORD);
    await page.locator('button', { hasText: /sign in/i }).last().click(); await page.waitForSelector('.shell', { timeout: 20000 });
    return { c, page, errs: () => errs.filter((e) => !/sentry/i.test(e)) };
  };
  const skipTour = async (page) => { try { await page.waitForSelector('.sheet', { timeout: 5000 }); await page.locator('.sheet button', { hasText: /^Skip$/ }).click(); await page.waitForTimeout(400); } catch (e) { /* no tour */ } };

  let D;
  await s.check('A new business starts in the short view; the tour and checklist show; the full menu is one switch away and remembered', async () => {
    D = await open({ w: 1280, h: 900 }); const { page } = D;
    await page.waitForSelector('.sheet', { timeout: 15000 }); assert(/Quick tour/.test(await page.locator('.sheet').innerText()), 'no tour');
    await page.locator('.sheet button', { hasText: /^Next$/ }).click(); assert(/Make a bill/.test(await page.locator('.sheet').innerText()), 'tour does not move on');
    await skipTour(page);
    const side = await page.locator('.side').innerText();
    assert(/Quick bill/.test(side) && /Overview/.test(side) && /Customers/.test(side) && /Money received/.test(side) && /Products/.test(side), 'short menu: ' + side.replace(/\n/g, ' | '));
    assert(!/Journals|analytics|Assets|Banking/i.test(side), 'advanced tools shown in the short menu: ' + side.replace(/\n/g, ' | '));
    await page.evaluate(() => { location.hash = '#/home'; }); await page.waitForTimeout(1500);
    const home = await page.locator('main').innerText();
    assert(/Get started: \d of 4/.test(home) && /Money to collect/.test(home) && /Money to pay/.test(home) && /Cash and bank/.test(home) && /Profit this month/.test(home), 'home: ' + home.slice(0, 200));
    assert(/Show charts and comparisons/.test(home), 'no way to see the full dashboard');
    await page.screenshot({ path: 'tests/report/shots/easy-home-1280.png', fullPage: true }).catch(() => {});
    await page.evaluate(() => { location.hash = '#/analytics'; }); await page.waitForTimeout(1500);
    assert(/Analytics|Reports|Dashboard/i.test(await page.locator('main').innerText()), 'a hidden page no longer opens');
    await page.evaluate(() => { location.hash = '#/home'; }); await page.waitForTimeout(800);
  }, 'critical');

  await s.check('The guided + menu has six plain choices', async () => {
    const { page } = D; await page.evaluate(() => { location.hash = '#/home'; }); await page.waitForTimeout(1200); await page.locator('.btn[aria-label="New"]').first().click();
    const t = await page.locator('.menu').innerText();
    for (const w of ['Bill a customer', 'Record money received', 'Add a customer', 'Record a purchase', 'Record an expense', 'Pay a supplier']) assert(t.includes(w), 'missing ' + w + ': ' + t);
    await page.keyboard.press('Escape');
  });

  await s.check('Quick bill: a walk-in sale with GST is totalled live, checked, issued after a plain warning and paid in full', async () => {
    const { page } = D; await page.evaluate(() => { location.hash = '#/quick'; }); await page.waitForSelector('#quick-items', { state: 'attached' });
    await page.locator('input[list=quick-items]').first().fill('Hand made soap'); await page.waitForTimeout(150);
    await page.locator('.card input[aria-label=Price]').first().fill('100'); await page.waitForTimeout(300);
    let txt = await page.locator('main').innerText();
    assert(/Total\s*₹?118/.test(txt.replace(/\s+/g, ' ')) || /118/.test(txt), 'total with 18% GST missing: ' + txt.slice(0, 400));
    assert(/Paid in full/.test(txt), 'paid in full note');
    assert(/Looks good|HSN/.test(txt), 'no checks shown');
    await page.locator('button', { hasText: /^Issue bill$/ }).click();
    await page.waitForSelector('.alert', { timeout: 8000 }); const w = await page.locator('.alert').innerText();
    assert(/cannot be changed/.test(w) && /cancel it and make a new one/.test(w), 'plain warning missing: ' + w);
    await page.locator('.alert button', { hasText: /^Issue bill$/ }).click();
    await page.waitForSelector('.sheet', { timeout: 15000 }); assert(/Bill issued/.test(await page.locator('.sheet').innerText()), 'not issued');
    const docs = (await call('acc_list_documents', { p: { types: ['invoice'], limit: 5 } })).rows;
    const d = docs.find((x) => /Hand made soap/.test('') || Number(x.total) === 118); assert(d && d.status === 'posted' && Number(d.paid) === 118, 'document not posted and paid: ' + JSON.stringify(docs.map((x) => [x.number, x.total, x.paid, x.status])));
    const integ = await call('acc_integrity_check'); assert(integ.ok, 'books out of line');
    await page.locator('.sheet button', { hasText: /^Close$/ }).click().catch(() => {});
  }, 'critical');

  await s.check('Quick bill: a balance needs a named customer; with one it is kept as money to collect', async () => {
    const { page } = D; const cust = (await call('acc_save_party', { p: { kind: 'customer', name: 'Asha Stores', phone: '9876500002' } })).id;
    await page.evaluate(() => { location.hash = '#/home'; }); await page.waitForTimeout(500); await page.evaluate(() => { location.hash = '#/quick'; }); await page.waitForSelector('#quick-items', { state: 'attached' });
    await page.locator('input[list=quick-items]').first().fill('Candle'); await page.locator('.card input[aria-label=Price]').first().fill('500'); await page.waitForTimeout(200);
    await page.locator('.card input[aria-label="Amount received"]').fill('200'); await page.waitForTimeout(300);
    assert(await page.locator('button', { hasText: /^Issue bill$/ }).isDisabled(), 'a balance on a walk-in was allowed');
    assert(/named customer/.test(await page.locator('main').innerText()), 'no explanation');
    await page.locator('select').first().selectOption(cust); await page.waitForTimeout(300);
    assert(!(await page.locator('button', { hasText: /^Issue bill$/ }).isDisabled()), 'still blocked with a customer');
    await page.locator('button', { hasText: /^Issue bill$/ }).click(); await page.locator('.alert button', { hasText: /^Issue bill$/ }).click();
    await page.waitForSelector('.sheet', { timeout: 15000 });
    const d = (await call('acc_list_documents', { p: { types: ['invoice'], limit: 5 } })).rows.find((x) => Number(x.total) === 590);
    assert(d && Number(d.paid) === 200, 'balance not kept: ' + JSON.stringify(d));
    assert(Number(((await call('acc_dashboard', { p: {} })).receivables)) >= 390, 'not in money to collect');
    await page.locator('.sheet button', { hasText: /^Close$/ }).click().catch(() => {});
  });

  await s.check('Switching on all tools restores the full menu and keeps it; the same switch goes back', async () => {
    const { page } = D; await page.evaluate(() => { location.hash = '#/home'; }); await page.waitForTimeout(500);
    await page.evaluate(() => window.setEasy('full')); await page.waitForTimeout(800);
    const side = await page.locator('.side').innerText();
    for (const w of ['analytics', 'GST', 'Bank', 'Assets', 'Quick bill']) assert(side.toLowerCase().includes(w.toLowerCase()), 'full menu lacks ' + w + ': ' + side.replace(/\n/g, ' | '));
    await page.reload(); await page.waitForSelector('.shell'); assert(/analytics/i.test(await page.locator('.side').innerText()), 'choice not remembered');
    await page.evaluate(() => window.setEasy('simple')); await page.waitForTimeout(500);
    assert(!/analytics/i.test(await page.locator('.side').innerText()), 'did not go back');
    const errs = D.errs(); assert(!errs.length, 'script errors: ' + errs.slice(0, 2).join(' | '));
    await D.c.close();
  }, 'critical');

  await s.check('Help marks explain hard words, and errors are said in plain words', async () => {
    D = await open({ w: 1280, h: 900 }); const { page } = D; await skipTour(page);
    await page.evaluate(() => { location.hash = '#/new/invoice'; }); await page.waitForSelector('.line');
    const tip = page.locator('button.tip').first(); assert(await tip.count(), 'no ? button'); await tip.click();
    await page.waitForSelector('.alert'); assert(/state where the goods/i.test(await page.locator('.alert').innerText()), 'explanation text'); await page.locator('.alert button', { hasText: /Got it/ }).click();
    const f = await page.evaluate(() => [friendly('Books are locked up to 2026-03-31 - nothing can be posted'), friendly('Credit limit exceeded for Raj: limit 1'), friendly('something odd')]);
    assert(/locked/.test(f[0]) && !/nothing can be posted/.test(f[0]) && /over the credit limit/.test(f[1]) && f[2] === 'something odd', JSON.stringify(f));
    await D.c.close();
  });

  await s.check('Phone: four tabs plus More, quick bill and home fit the screen', async () => {
    D = await open({ w: 390, h: 844, mobile: true }); const { page } = D; await skipTour(page);
    const tabs = await page.locator('.tabbar button').count(); assert(tabs === 5, 'tabs ' + tabs);
    for (const r of ['scan', 'quick', 'sales', 'home']) { await page.evaluate((x) => { location.hash = '#/' + x; }, r); await page.waitForTimeout(900); assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2), 'sideways scroll on ' + r); }
    await page.locator('.tabbar button[data-tab=more]').click(); await page.waitForSelector('.sheet'); assert(/Show all ledger tools/.test(await page.locator('.sheet').innerText()), 'no switch in More');
    await page.screenshot({ path: 'tests/report/shots/easy-more-390.png' }).catch(() => {});
    await D.c.close();
  });

  await s.check('AUZsLedger itself is unchanged: no beginner menu, no quick bill, no switch', async () => {
    const c = await newCtx(browser, stack, { w: 1280, h: 900, simple: true }); const page = await c.newPage();
    await page.goto(stack.url('testacct', '/accounts.html')); await page.waitForSelector('input[type=password]', { timeout: 20000 });
    await page.fill('input[type=email]', USERS.acctOwner); await page.fill('input[type=password]', PASSWORD); await page.locator('button', { hasText: /sign in/i }).last().click(); await page.waitForSelector('.shell', { timeout: 20000 });
    await page.waitForTimeout(1500); assert(!/Quick bill/.test(await page.locator('.side').innerText()), 'beginner menu leaked into AUZsLedger');
    assert(await page.locator('.sheet').count() === 0, 'a tour opened in AUZsLedger'); assert(/analytics/i.test(await page.locator('.side').innerText()), 'ledger menu changed'); await c.close();
  }, 'critical');
  return s.done();
}
