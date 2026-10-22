// AUZsFinance: a money-tracking layer on the AUZsLedger books. Drives every kind of entry through the real API (owner, manager,
// plain staff, another business), re-checks that the books balance after each step, then runs the app in a real browser.
import { suite, watch, assert } from '../../lib/harness.mjs';
import { newCtx, layoutIssues } from '../../lib/common.mjs';
import { rpc } from '../../lib/api.mjs';
import { q, PASSWORD, USERS } from '../../lib/db.mjs';

export default async function run({ browser, stack }) {
  const s = suite('AUZsFinance: money in and out, owner capital, loans, dues, evidence and the books', 'Posts every kind of entry, checks balances, dues, loans and permissions on the server, then opens the app on phone and desktop.');
  const login = async (email) => (await (await fetch(stack.apiBase + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) })).json()).access_token;
  const [owner, manager, staff, cafe] = await Promise.all([USERS.finOwner, USERS.finManager, USERS.finStaff, USERS.cafeOwner].map(login));
  const call = async (tok, fn, args) => { const r = await rpc(stack, fn, args || {}, tok); return { ok: r.status === 200, status: r.status, data: r.data && r.data.data, error: r.data && r.data.error }; };
  const ok = async (tok, fn, args) => { const r = await call(tok, fn, args); assert(r.ok, `${fn}: ${r.status} ${r.error}`); return r.data; };
  const fails = async (tok, fn, args, re) => { const r = await call(tok, fn, args); assert(!r.ok, `${fn} should have been refused: ${JSON.stringify(r).slice(0,300)}`); if (re) assert(re.test(r.error || ''), `${fn} refused with the wrong message: ${r.error}`); };
  const uid = () => crypto.randomUUID();
  const integrity = async () => { const r = await ok(owner, 'fin_integrity_check'); assert(r.ok, 'books out of line: ' + JSON.stringify(r)); };
  const bal = async (id) => Number((await ok(owner, 'fin_bootstrap')).accounts.find((a) => a.id === id).balance);

  await s.check('A refused call is a real error with a message (not an empty 200)', async () => { const r = await fetch(stack.apiBase + '/rpc/fin_bootstrap', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + cafe }, body: '{}' }); const t = await r.text(); assert(r.status === 400 && /not enabled/i.test(t), r.status + ' ' + t); }, 'critical');
  await s.check('Logged out: every AUZsFinance call is refused', async () => { for (const fn of ['fin_bootstrap', 'fin_dashboard', 'fin_save_txn']) assert((await call(null, fn, {})).status === 401, fn); }, 'critical');
  await s.check('A business without AUZsFinance in its plan is refused server-side', async () => { await fails(cafe, 'fin_bootstrap', {}, /not enabled/i); await fails(cafe, 'fin_txn_list', {}, /not enabled/i); }, 'critical');

  let ctx, bank, cash, mahendra, loan, sita;
  await s.check('Owner opens it: a cash and a bank account exist, dues ledgers are set up, permissions are right', async () => {
    ctx = await ok(owner, 'fin_bootstrap');
    assert(ctx.perms.write && ctx.perms.admin, JSON.stringify(ctx.perms));
    bank = ctx.accounts.find((a) => a.kind === 'bank').id; cash = ctx.accounts.find((a) => a.kind === 'cash').id;
    assert(ctx.categories.expense.length > 3 && ctx.categories.income.length > 0, 'categories');
  }, 'critical');
  await s.check('Staff cannot add entries; a manager can add entries but cannot create accounts or partners', async () => {
    await fails(staff, 'fin_save_txn', { p: { kind: 'expense', amount: 10, account_id: cash } }, /does not allow/i);
    const m = await ok(manager, 'fin_bootstrap'); assert(m.perms.write && !m.perms.admin, JSON.stringify(m.perms));
    await fails(manager, 'fin_save_account', { p: { name: 'X', kind: 'bank' } }, /does not allow/i);
    await fails(manager, 'fin_save_partner', { p: { name: 'X' } }, /does not allow/i);
  }, 'critical');

  await s.check('An account can be added with an opening balance, and the opening posts to the books', async () => {
    const a = await ok(owner, 'fin_save_account', { p: { name: 'UPI wallet', kind: 'upi', opening: 2500 } });
    assert(await bal(a.id) === 2500, 'opening balance');
    await integrity();
  });
  await s.check('Owner puts capital in; the same entry sent twice (same op) is recorded once', async () => {
    mahendra = (await ok(owner, 'fin_save_partner', { p: { name: 'Mahendra', kind: 'owner' } })).id;
    const op = uid(); const p = { op, kind: 'capital_in', amount: 100000, account_id: bank, partner_id: mahendra, evidence: 'have' };
    const a = await ok(owner, 'fin_save_txn', { p }); const b = await ok(owner, 'fin_save_txn', { p });
    assert(a.id === b.id && b.duplicate === true, 'duplicate not detected');
    assert(await bal(bank) === 100000, 'bank after capital');
    const pl = await ok(owner, 'fin_partner_list'); assert(Number(pl[0].capital) === 100000 && Number(pl[0].net) === 100000, JSON.stringify(pl[0]));
    await integrity();
  }, 'critical');
  await s.check('Move money between accounts, expense and income each change exactly the right balances', async () => {
    await ok(owner, 'fin_save_txn', { p: { kind: 'transfer', amount: 20000, account_id: bank, to_account_id: cash } });
    assert(await bal(bank) === 80000 && await bal(cash) === 20000, 'transfer');
    const rent = ctx.categories.expense.find((c) => /rent/i.test(c.name)).id;
    const e = await ok(owner, 'fin_save_txn', { p: { kind: 'expense', amount: 1500, account_id: cash, category_id: rent, purpose: 'October rent' } });
    assert(await bal(cash) === 18500, 'expense'); assert(e.evidence === 'none' && e.review === 'confirmed', 'defaults');
    await ok(owner, 'fin_save_txn', { p: { kind: 'money_in', amount: 5000, account_id: cash, purpose: 'Sales' } });
    assert(await bal(cash) === 23500, 'income');
    await ok(owner, 'fin_save_txn', { p: { kind: 'drawing', amount: 3000, account_id: cash, partner_id: mahendra, review: 'needs_review' } });
    assert(await bal(cash) === 20500, 'drawing');
    const pl = await ok(owner, 'fin_partner_list'); assert(Number(pl[0].net) === 97000 && Number(pl[0].drawings) === 3000, JSON.stringify(pl[0]));
    await integrity();
  }, 'critical');
  await s.check('Loan taken, then repaid with interest: principal reduces the loan, interest is an expense', async () => {
    loan = (await ok(owner, 'fin_save_loan', { p: { direction: 'taken', counterparty: 'Ramesh', rate_pct: 12 } })).id;
    await ok(owner, 'fin_save_txn', { p: { kind: 'loan_taken', amount: 50000, account_id: bank, loan_id: loan } });
    await ok(owner, 'fin_save_txn', { p: { kind: 'loan_repay', amount: 10000, interest: 500, account_id: bank, loan_id: loan } });
    assert(await bal(bank) === 80000 + 50000 - 10500, 'bank after loan');
    const l = (await ok(owner, 'fin_loan_list')).find((x) => x.id === loan);
    assert(Number(l.outstanding) === 40000 && Number(l.interest) === 500 && Number(l.principal_total) === 50000, JSON.stringify(l));
    await fails(owner, 'fin_save_txn', { p: { kind: 'loan_given', amount: 1, account_id: bank, loan_id: loan } }, /choose the account and the loan/i);
    await integrity();
  }, 'critical');
  await s.check('Credit sale and part payment: dues show who owes what, and a person is not duplicated by name', async () => {
    sita = (await ok(owner, 'fin_save_person', { p: { name: 'Sita', kind: 'customer' } })).id;
    assert((await ok(owner, 'fin_save_person', { p: { name: 'sita', kind: 'customer' } })).id === sita, 'duplicate person');
    await ok(owner, 'fin_save_txn', { p: { kind: 'credit_sale', amount: 8000, person_id: sita } });
    await ok(owner, 'fin_save_txn', { p: { kind: 'dues_in', amount: 3000, account_id: cash, person_id: sita } });
    const b = (await ok(owner, 'fin_people_balances')).find((x) => x.id === sita); assert(Number(b.balance) === 5000 && Number(b.owed_to_us) === 5000, JSON.stringify(b));
    const sup = (await ok(owner, 'fin_save_person', { p: { name: 'Cloth Mart', kind: 'supplier' } })).id;
    await ok(owner, 'fin_save_txn', { p: { kind: 'credit_purchase', amount: 12000, person_id: sup } });
    const d = await ok(owner, 'fin_dashboard', {}); assert(Number(d.dues_in) === 5000 && Number(d.dues_out) === 12000, JSON.stringify([d.dues_in, d.dues_out]));
    await fails(owner, 'fin_save_txn', { p: { kind: 'credit_sale', amount: 10 } }, /who owes/i);
    await integrity();
  });
  await s.check('A wrong entry is cancelled by a reversal (never deleted): balances return and the trail stays', async () => {
    const before = await bal(cash);
    const e = await ok(owner, 'fin_save_txn', { p: { kind: 'expense', amount: 999, account_id: cash, purpose: 'Typo' } });
    assert(await bal(cash) === before - 999, 'posted');
    await fails(owner, 'fin_reverse_txn', { p_id: e.id, p_reason: '' }, /why/i);
    const r = await ok(owner, 'fin_reverse_txn', { p_id: e.id, p_reason: 'Entered twice' }); assert(r.status === 'reversed', 'status');
    assert(await bal(cash) === before, 'balance did not return');
    await fails(owner, 'fin_reverse_txn', { p_id: e.id, p_reason: 'again' }, /already cancelled/i);
    const l = await ok(owner, 'fin_txn_list', { p: { q: 'Typo' } }); assert(l.length === 1 && l[0].status === 'reversed', 'the cancelled entry must stay in the list');
    assert(await q('select count(*)::int n from acc_journals where source_id = $1', [e.id]).then((x) => x[0].n) === 2, 'original + reversal journal');
    await integrity();
  }, 'critical');
  await s.check('Evidence and review: attach, mark, only a manager can clear "needs review", dashboard counts follow', async () => {
    const d0 = await ok(owner, 'fin_dashboard', {}); assert(d0.needs_review >= 1, 'needs_review count');
    const l = (await ok(owner, 'fin_txn_list', { p: { review: 'needs_review' } })); assert(l.length >= 1, 'filter');
    await ok(owner, 'fin_attach', { p_id: l[0].id, p_name: 'bill.jpg', p_url: '/storage/acc/x/y.jpg' });
    const again = (await ok(owner, 'fin_txn_list', { p: { review: 'needs_review' } }))[0]; assert(again.evidence === 'have' && again.files.length === 1, 'attached');
    await fails(staff, 'fin_mark_txn', { p_id: l[0].id, p: { review: 'confirmed' } }, /does not allow/i);
    await ok(manager, 'fin_mark_txn', { p_id: l[0].id, p: { review: 'confirmed' } });
    assert((await ok(owner, 'fin_dashboard', {})).needs_review === d0.needs_review - 1, 'count after confirm');
  });
  await s.check('Refusals: zero amount, future date, other business ids, locked period', async () => {
    await fails(owner, 'fin_save_txn', { p: { kind: 'expense', amount: 0, account_id: cash } }, /above zero/i);
    await fails(owner, 'fin_save_txn', { p: { kind: 'expense', amount: 5, account_id: cash, date: '2099-01-01' } }, /future/i);
    await fails(owner, 'fin_save_txn', { p: { kind: 'expense', amount: 5, account_id: uid() } }, /choose where/i);
    await q("update acc_org set lock_date = current_date - 1 where tenant_id = (select id from tenants where slug='testfin')");
    await fails(owner, 'fin_save_txn', { p: { kind: 'expense', amount: 5, account_id: cash, date: new Date(Date.now() - 3 * 864e5).toISOString().slice(0, 10) } }, /locked/i);
    await q("update acc_org set lock_date = null where tenant_id = (select id from tenants where slug='testfin')");
  });
  await s.check('Dashboard adds up: money in, out, by category and the monthly trend', async () => {
    const d = await ok(owner, 'fin_dashboard', {});
    assert(Number(d.cash_total) === (await ok(owner, 'fin_bootstrap')).accounts.reduce((x, a) => x + Number(a.balance), 0), 'cash total');
    assert(d.by_category.length >= 1 && d.by_month.length >= 1 && d.recent.length >= 5, JSON.stringify(Object.keys(d)));
    assert(Number(d.expenses) > 0 && Number(d.income) > 0, 'expenses / income');
  });

  // ---------- the app in a browser ----------
  const open = async (dev) => {
    const c = await newCtx(browser, stack, dev); const page = await c.newPage(); const errs = watch(page);
    await page.goto(stack.url('testfin', '/finance.html')); await page.waitForSelector('input[type=password]', { timeout: 20000 });
    await page.fill('input[type=email]', USERS.finOwner); await page.fill('input[type=password]', PASSWORD);
    await page.locator('button', { hasText: /sign in/i }).last().click(); await page.waitForSelector('.shell', { timeout: 20000 });
    return { c, page, errs: { get length() { return this.l().length; }, l: () => errs.filter((e) => !/sentry/i.test(e)), slice(a, b) { return this.l().slice(a, b); } } };
  };
  for (const dev of [{ name: 'phone', w: 390, h: 844, mobile: true }, { name: 'desktop', w: 1366, h: 800 }]) {
    await s.check(`Every screen opens on ${dev.name}: no script errors, no sideways scroll`, async () => {
      const { c, page, errs } = await open(dev);
      await page.waitForSelector('.hero-n .n', { timeout: 15000 });
      for (const id of ['home', 'activity', 'dues', 'owner', 'accounts', 'settings']) {
        await page.evaluate((x) => { location.hash = '#/' + x; }, id); await page.waitForTimeout(700);
        await page.waitForSelector('.page[data-p="' + id + '"]', { timeout: 10000 });
        const txt = await page.locator('.page').innerText(); assert(!/undefined|NaN|\[object/i.test(txt), id + ' shows a bad value: ' + txt.slice(0, 200));
        const iss = await layoutIssues(page); assert(!iss.length, id + ': ' + iss.join('; '));
      }
      await s.shot(page, 'finance ' + dev.name);
      assert(!errs.length, 'script errors: ' + errs.slice(0, 2).join(' | ')); await c.close();
    }, 'major');
  }
  await s.check('Add entry in the app: pick "Paid out", type an amount and save; the balance and the list change', async () => {
    const { c, page, errs } = await open({ name: 'phone', w: 390, h: 844, mobile: true });
    const before = (await ok(owner, 'fin_txn_list', { p: { limit: 500 } })).length;
    await page.locator('.fab').click(); await page.locator('.sheet .li', { hasText: 'Paid out' }).click();
    await page.locator('input.bigamt').fill('250'); await page.locator('input[aria-label="Note"]').fill('Tea and snacks');
    await page.locator('.preview').waitFor(); assert(/goes down by/i.test(await page.locator('.preview').innerText()), 'preview text');
    await page.locator('.sheet-f button', { hasText: 'Save' }).click(); await page.waitForSelector('.toast', { timeout: 8000 });
    const after = await ok(owner, 'fin_txn_list', { p: { limit: 500 } }); assert(after.length === before + 1 && after[0].purpose === 'Tea and snacks' && Number(after[0].amount) === 250, 'entry not saved');
    await page.evaluate(() => { location.hash = '#/activity'; }); await page.waitForSelector('text=Tea and snacks', { timeout: 8000 });
    await s.shot(page, 'finance add entry'); assert(!errs.length, 'script errors: ' + errs.slice(0, 2).join(' | ')); await c.close();
    await integrity();
  }, 'major');
  await s.check('Someone without AUZsFinance in their plan sees "not part of your plan", not the app', async () => {
    const c = await newCtx(browser, stack, { w: 1000, h: 700 }); const page = await c.newPage();
    await page.goto(stack.url('testcafe', '/finance.html')); await page.waitForSelector('input[type=password]', { timeout: 20000 });
    await page.fill('input[type=email]', USERS.cafeOwner); await page.fill('input[type=password]', PASSWORD);
    await page.locator('button', { hasText: /sign in/i }).last().click(); await page.waitForSelector('text=not part of your plan', { timeout: 15000 }); await c.close();
  });
  s.done();
}
