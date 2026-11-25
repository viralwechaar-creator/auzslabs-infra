// Finance, ported into AUZslab Accounting: the old fin_* RPCs must still work exactly as before (UI-only
// move), and the new fin-* pages must render real fin_* data inside accounts.html with no console errors,
// without touching any of Accounting's own existing pages.
import { suite, watch, assert } from '../../lib/harness.mjs';
import { newCtx } from '../../lib/common.mjs';
import { rpc } from '../../lib/api.mjs';
import { q, PASSWORD, USERS } from '../../lib/db.mjs';

export default async function run({ browser, stack }) {
  const s = suite('Finance inside AUZslab Accounting', 'fin_* RPCs are untouched by the UI move, and the ported fin-* pages render inside accounts.html with real data and no regressions to Accounting\'s own pages.');
  const login = async (email) => (await (await fetch(stack.apiBase + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) })).json()).access_token;
  const [finOwner, finManager, finStaff, cafe] = await Promise.all([USERS.finOwner, USERS.finManager, USERS.finStaff, USERS.cafeOwner].map(login));
  const call = async (tok, fn, args) => { const r = await rpc(stack, fn, args || {}, tok); return { ok: r.status === 200, status: r.status, data: r.data && r.data.data, error: r.data && r.data.error }; };
  const ok = async (tok, fn, args) => { const r = await call(tok, fn, args); assert(r.ok, `${fn}: ${r.status} ${r.error}`); return r.data; };
  const fails = async (tok, fn, args, re) => { const r = await call(tok, fn, args); assert(!r.ok, `${fn} should have been refused`); if (re) assert(re.test(r.error || ''), `${fn} refused with the wrong reason: ${r.error}`); return r; };

  // ---------- RPC layer: unchanged by the UI move ----------
  await s.check('A tenant without the finance flag is still refused server-side', async () => { await fails(cafe, 'fin_bootstrap', {}, /not enabled/i); }, 'critical');
  let ctx, accCash, accBank;
  await s.check('fin_bootstrap still returns accounts, categories, loans, partners, people for the finance tenant', async () => {
    ctx = await ok(finOwner, 'fin_bootstrap');
    assert(ctx.accounts && ctx.accounts.length >= 2, 'no seeded accounts');
    accCash = ctx.accounts.find((a) => a.kind === 'cash').id; accBank = ctx.accounts.find((a) => a.kind !== 'cash').id;
    assert(ctx.perms && typeof ctx.perms.write === 'boolean', 'perms missing');
  }, 'critical');
  let txnId;
  await s.check('fin_save_txn records a real entry and fin_dashboard/fin_txn_list see it', async () => {
    const saved = await ok(finOwner, 'fin_save_txn', { p: { op: 'test-op-' + Date.now(), kind: 'money_in', amount: 2500, date: new Date().toISOString().slice(0, 10), account_id: accBank, purpose: 'Finance-into-Ledger smoke test', evidence: 'none', review: 'confirmed' } });
    txnId = saved.id;
    const d = await ok(finOwner, 'fin_dashboard', {});
    assert(Number(d.money_in) >= 2500, 'dashboard did not pick up the entry');
    const list = await ok(finOwner, 'fin_txn_list', { p: { limit: 10 } });
    assert(list.some((r) => r.id === txnId), 'fin_txn_list did not return the new entry');
  }, 'critical');
  await s.check('fin_people_balances, fin_asset_list, fin_partner_list, fin_loan_list all still answer', async () => {
    await ok(finOwner, 'fin_people_balances'); await ok(finOwner, 'fin_asset_list'); await ok(finOwner, 'fin_partner_list'); await ok(finOwner, 'fin_loan_list');
  }, 'major');
  await s.check('A cashier-level Finance login cannot write, but can still read', async () => {
    await ok(finStaff, 'fin_dashboard', {});
    const p = await ok(finStaff, 'fin_bootstrap'); assert(p.perms.write === false || p.perms.write === undefined, 'cashier should not have write');
  }, 'major');
  await s.check('fin_reverse_txn cancels the test entry cleanly (no row is ever deleted)', async () => {
    await ok(finOwner, 'fin_reverse_txn', { p_id: txnId, p_reason: 'cleanup after automated test' });
    const list = await ok(finOwner, 'fin_txn_list', { p: { limit: 10, with_reversed: true } });
    const row = list.find((r) => r.id === txnId); assert(row && row.status === 'reversed', 'entry was not reversed');
  }, 'major');

  // ---------- screens: the ported fin-* pages, inside accounts.html ----------
  const tid = (await q("select id from tenants where slug='testfin'"))[0].id;
  const login2 = async (page, host, email) => { await page.goto(stack.url(host, '/accounts.html')); await page.waitForSelector('input[type=password]'); await page.fill('input[type=email]', email); await page.fill('input[type=password]', PASSWORD); await page.locator('button:not(.auth-pill)', { hasText: /^Sign in$/ }).click(); await page.waitForSelector('.shell', { timeout: 15000 }); };
  const ctxD = await newCtx(browser, stack, { w: 1280, h: 900 }); const page = await ctxD.newPage(); const errs = watch(page);
  await s.check('Finance owner signs into AUZslab Accounting: no separate Finance menu group, money sections sit inside the Ledger tabs', async () => {
    await login2(page, 'testfin', USERS.finOwner);
    await page.waitForSelector('[data-nav="home"]', { timeout: 10000 });
    assert(await page.locator('[data-nav^="fin-"]').count() === 0, 'a Finance menu group is still in the menu');
    await page.evaluate(() => { location.hash = '#/books'; }); await page.waitForSelector('.fin-tabs', { timeout: 10000 });
    const labels = await page.locator('.fin-tabs button').allInnerTexts();
    assert(labels.includes('Cash entries') && labels.includes('Owner & loans'), 'Books tab lacks the money sections: ' + labels.join(','));
  }, 'critical');
  const finRoutes = ['fin-home', 'fin-activity', 'fin-dues', 'fin-owner', 'fin-accounts', 'fin-reports', 'fin-insights', 'fin-settings', 'fin-tools'];
  await s.check('Every Finance page renders inside its Ledger tab (and old #/fin-... links forward there) with no error', async () => {
    for (const r of finRoutes) {
      await page.evaluate((h) => { location.hash = '#/' + h; }, r);
      await page.waitForTimeout(500); await page.waitForLoadState('networkidle').catch(() => {});
      if (r !== 'fin-tools') assert(/\?sec=/.test(await page.evaluate(() => location.hash)) || r === 'fin-tools', r + ' did not forward to its tab: ' + await page.evaluate(() => location.hash));
      const bad = await page.evaluate(() => { const e = document.querySelector('.empty h3'); return e && /Could not load/.test(e.textContent) ? (e.nextSibling && e.nextSibling.textContent) : ''; });
      assert(!bad, r + ': ' + bad);
    }
    assert(!errs.length, 'console errors: ' + errs.join(' | '));
  }, 'critical');
  await s.check('Finance: Today shows a real money figure from the seeded entry, not an empty state', async () => {
    await page.evaluate(() => { location.hash = '#/home?sec=fin-home'; }); await page.waitForTimeout(600);
    const txt = await page.locator('.hero-n').first().innerText();
    assert(/₹/.test(txt), 'no rupee figure on fin-home: ' + txt);
  }, 'major');
  await s.check('Finance: Activity lists at least one real entry', async () => {
    await page.evaluate(() => { location.hash = '#/books?sec=fin-activity'; }); await page.waitForSelector('.list .li, .empty', { timeout: 10000 });
    const n = await page.locator('.page[data-p="fin-activity"] .list .li, .list .li').count();
    assert(n > 0, 'no entries shown in Finance: Activity');
  }, 'major');
  await s.check('A plain Accounting-only tenant (no finance flag) gets the money sections in its Ledger tabs and they load', async () => {
    const ctx2 = await newCtx(browser, stack, { w: 1280, h: 900 }); const p2 = await ctx2.newPage(); const e2 = watch(p2);
    await login2(p2, 'testacct', USERS.acctOwner);
    await p2.evaluate(() => { location.hash = '#/books?sec=fin-activity'; }); await p2.waitForSelector('.fin-tabs', { timeout: 10000 }); await p2.waitForTimeout(1200);
    const bad = await p2.evaluate(() => { const e = document.querySelector('.empty h3'); return e && /Could not load/.test(e.textContent) ? (e.nextSibling && e.nextSibling.textContent) : ''; });
    assert(!bad, 'cash entries did not load for an accounting-only business: ' + bad);
    assert(!e2.filter((x) => !/sentry/i.test(x)).length, 'console errors on a plain Accounting login: ' + e2.join(' | '));
  }, 'critical');
  await s.check('Accounting\'s own pages (billing, parties, stock, GST) still work for the finance tenant -- nothing regressed', async () => {
    for (const r of ['home', 'customers', 'products', 'stock', 'gst', 'reports', 'settings']) {
      await page.evaluate((h) => { location.hash = '#/' + h; }, r);
      await page.waitForTimeout(350); await page.waitForLoadState('networkidle').catch(() => {});
      const bad = await page.evaluate(() => { const e = document.querySelector('.empty h3'); return e && /Could not load/.test(e.textContent) ? (e.nextSibling && e.nextSibling.textContent) : ''; });
      assert(!bad, r + ': ' + bad);
    }
  }, 'critical');

  s.done();
}
