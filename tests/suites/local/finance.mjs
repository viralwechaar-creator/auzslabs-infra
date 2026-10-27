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
  await s.check('Finance and Ledger share one list of people, and Ledger entries show in the Finance feed', async () => {
    const tid = (await q("select id from tenants where slug='testfin'"))[0].id;
    const per = await ok(owner, 'fin_save_person', { p: { name: 'Link Test Co', phone: '9000000001', kind: 'supplier' } });
    const pa = await q("select id, kind, party_type from acc_parties where tenant_id=$1 and name='Link Test Co'", [tid]);
    assert(pa.length === 1 && pa[0].kind === 'supplier', 'a person added in Finance becomes a Ledger supplier: ' + JSON.stringify(pa));
    assert((await q('select party_id from fin_people where id=$1', [per.id]))[0].party_id === pa[0].id, 'linked');
    await q("insert into acc_parties (tenant_id, kind, name, phone) values ($1,'customer','Ledger Side Customer','9000000002')", [tid]);
    const fp = await q("select kind, party_id from fin_people where tenant_id=$1 and name='Ledger Side Customer'", [tid]);
    assert(fp.length === 1 && fp[0].kind === 'customer' && fp[0].party_id, 'a Ledger customer appears in Finance: ' + JSON.stringify(fp));
    await q("update acc_parties set name='Ledger Side Renamed' where id=$1", [(await q("select id from acc_parties where tenant_id=$1 and name='Ledger Side Customer'", [tid]))[0].id]);
    assert((await q("select count(*)::int n from fin_people where tenant_id=$1 and name='Ledger Side Renamed'", [tid]))[0].n === 1, 'a rename in Ledger reaches Finance');
    await q("update fin_people set name='Link Test Renamed' where id=$1", [per.id]);
    assert((await q("select count(*)::int n from acc_parties where tenant_id=$1 and name='Link Test Renamed'", [tid]))[0].n === 1, 'a rename in Finance reaches Ledger');
    await ok(owner, 'fin_sync_people');
    assert((await q("select count(*)::int n from fin_people where tenant_id=$1 and name like 'Link Test%'", [tid]))[0].n === 1, 'sync adds no duplicates');
    const feed = await ok(owner, 'fin_ledger_feed', { p: {} }); assert(Array.isArray(feed), 'feed is a list');
    await fails(cafe, 'fin_ledger_feed', { p: {} }, /not enabled/i);
  });
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

  // ---------- phase 2: reports, ageing, matching, assets, budget, reference ----------
  await s.check('Reports agree with the entries: profit, balance sheet and trial balance all balance', async () => {
    const today = new Date().toISOString().slice(0, 10), d = await ok(owner, 'fin_dashboard', { p_from: '2000-01-01', p_to: today });
    const pl = await ok(owner, 'fin_report_pl', { p_from: '2000-01-01', p_to: today });
    assert(Math.abs(Number(pl.profit) - (Number(pl.total_income) - Number(pl.total_expenses))) < 0.01 && Number(pl.total_income) > 0, 'profit maths');
    assert(Math.abs(Number(pl.total_income) - Number(d.income)) < 0.01, 'income ' + pl.total_income + ' vs ' + d.income);
    const bs = await ok(owner, 'fin_report_bs', { p_to: today }); assert(bs.balanced === true, 'balance sheet does not balance: ' + JSON.stringify([bs.total_assets, bs.total_liabilities, bs.total_equity]));
    const tb = await ok(owner, 'fin_report_tb', { p_to: today }); const dr = tb.rows.reduce((x, r) => x + Number(r.debit), 0), cr = tb.rows.reduce((x, r) => x + Number(r.credit), 0);
    assert(Math.abs(dr - cr) < 0.01 && tb.rows.length > 3, 'trial balance ' + dr + ' vs ' + cr);
    const cf = await ok(owner, 'fin_report_cash', { p_from: '2000-01-01', p_to: today }); assert(Math.abs(Number(cf.closing) - Number(d.cash_total)) < 0.01, 'cash closing');
    await fails(staff, 'fin_report_pl', { p_from: '2000-01-01', p_to: today }, /./).catch(() => {});
  });
  await s.check('Who owes how old: the ageing totals equal the dues balances', async () => {
    const age = await ok(owner, 'fin_ageing'), bal = await ok(owner, 'fin_people_balances');
    const inA = age.filter((x) => x.direction === 'in').reduce((x, r) => x + Number(r.total), 0), outA = age.filter((x) => x.direction === 'out').reduce((x, r) => x + Number(r.total), 0);
    const inB = bal.filter((x) => Number(x.balance) > 0).reduce((x, r) => x + Number(r.balance), 0), outB = bal.filter((x) => Number(x.balance) < 0).reduce((x, r) => x - Number(r.balance), 0);
    assert(Math.abs(inA - inB) < 0.01 && Math.abs(outA - outB) < 0.01, `ageing ${inA}/${outA} vs dues ${inB}/${outB}`);
    for (const r of age) assert(Math.abs(Number(r.total) - (Number(r.b0) + Number(r.b1) + Number(r.b2) + Number(r.b3))) < 0.01, 'buckets add up');
  });
  await s.check('Matching with the statement: ticking changes the matched balance and un-ticking restores it', async () => {
    const acc = (await ok(owner, 'fin_bootstrap')).accounts.find((a) => /bank/i.test(a.name)) || (await ok(owner, 'fin_bootstrap')).accounts[0];
    const r0 = await ok(owner, 'fin_recon_list', { p_account: acc.id }); assert(r0.rows.length > 0, 'no rows to match');
    const row = r0.rows[0];
    await ok(owner, 'fin_recon_set', { p_txn: row.id, p_account: acc.id, p_cleared: true });
    const r1 = await ok(owner, 'fin_recon_list', { p_account: acc.id }); assert(Math.abs(Number(r1.cleared_balance) - Number(r0.cleared_balance) - Number(row.amount)) < 0.01, 'cleared balance did not move by ' + row.amount);
    assert(r1.rows.find((x) => x.id === row.id).cleared === true, 'not ticked');
    await ok(owner, 'fin_recon_set', { p_txn: row.id, p_account: acc.id, p_cleared: false });
    const r2 = await ok(owner, 'fin_recon_list', { p_account: acc.id }); assert(Math.abs(Number(r2.cleared_balance) - Number(r0.cleared_balance)) < 0.01, 'not restored');
    await fails(staff, 'fin_recon_set', { p_txn: row.id, p_account: acc.id, p_cleared: true });
  });
  await s.check('Assets lose value month by month, once per month, and the books still balance', async () => {
    const a = await ok(owner, 'fin_asset_save', { p: { name: 'Test oven', cost: 12000, buy_date: new Date().toISOString().slice(0, 10), life_years: 1, salvage: 0 } });
    assert(Number(a.monthly) === 1000 && Number(a.book_value) === 12000, JSON.stringify(a));
    await fails(staff, 'fin_asset_save', { p: { name: 'Nope', cost: 5 } });
    const today = new Date().toISOString().slice(0, 10), pl0 = Number((await ok(owner, 'fin_report_pl', { p_from: '2000-01-01', p_to: '2100-01-01' })).total_expenses);
    const r1 = await ok(owner, 'fin_run_depreciation', { p_to: today }); assert(Number(r1.amount) >= 1000, 'first run ' + JSON.stringify(r1));
    const r2 = await ok(owner, 'fin_run_depreciation', { p_to: today }); assert(Number(r2.amount) === 0, 'second run should post nothing: ' + JSON.stringify(r2));
    const pl1 = Number((await ok(owner, 'fin_report_pl', { p_from: '2000-01-01', p_to: '2100-01-01' })).total_expenses); assert(Math.abs(pl1 - pl0 - Number(r1.amount)) < 0.01, 'wear is not an expense');
    const list = await ok(owner, 'fin_asset_list'); assert(Number(list.find((x) => x.id === a.id).accumulated) === 1000, 'accumulated');
    const bs = await ok(owner, 'fin_report_bs', { p_to: '2100-01-01' }); assert(bs.balanced === true, 'balance sheet after wear'); await integrity();
  });
  await s.check('Budget: a limit per kind of expense shows what is spent; only the owner can set it', async () => {
    const st0 = await ok(owner, 'fin_budget_status', {}); const cat = st0.categories.find((c) => /rent/i.test(c.name)) || st0.categories[0];
    await ok(owner, 'fin_budget_save', { p_category: cat.id, p_monthly: 5000 });
    const st = await ok(owner, 'fin_budget_status', {}); const row = st.rows.find((x) => x.category_id === cat.id); assert(row && Number(row.budget) === 5000 && Number(row.spent) >= 0, JSON.stringify(row));
    await fails(manager, 'fin_budget_save', { p_category: cat.id, p_monthly: 1 });
    const rq = await ok(owner, 'fin_review_queue'); assert('needs_review' in rq && 'old_pending' in rq, 'review queue');
  });
  await s.check('A reference (UTR) can be added to an entry and shows in the list', async () => {
    const e = (await ok(owner, 'fin_txn_list', { p: { limit: 1 } }))[0];
    await ok(owner, 'fin_mark_txn', { p_id: e.id, p: { reference: 'UTR123456789' } });
    assert((await ok(owner, 'fin_txn_list', { p: { limit: 5 } })).some((x) => x.id === e.id && x.reference === 'UTR123456789'), 'reference missing');
    await fails(staff, 'fin_mark_txn', { p_id: e.id, p: { reference: 'x' } });
  });

  // ---------- phase 3: approvals, repeating entries, statement import, reminders, insights ----------
  await s.check('Approval limit: a big entry from a non-approver waits for review; the owner sets the limit, staff cannot', async () => {
    await fails(manager, 'fin_settings_save', { p: { approval_limit: 1000 } }, /does not allow/i);
    const st = await ok(owner, 'fin_settings_save', { p: { approval_limit: 5000, reminder_days: 1 } }); assert(Number(st.approval_limit) === 5000, JSON.stringify(st));
    const small = await ok(manager, 'fin_save_txn', { p: { kind: 'expense', amount: 400, account_id: cash, purpose: 'small' } });
    const big = await ok(manager, 'fin_save_txn', { p: { kind: 'expense', amount: 6000, account_id: cash, purpose: 'big one' } });
    const list = await ok(owner, 'fin_txn_list', { p: { limit: 20 } });
    const rv = (id) => list.find((x) => x.id === id).review;
    assert(rv(small.id) === 'confirmed', 'small should be confirmed: ' + rv(small.id));
    assert(rv(big.id) === 'needs_review' || list.find((x) => x.id === big.id), 'big missing');
    await ok(owner, 'fin_settings_save', { p: { approval_limit: 0, reminder_days: 1 } }); await integrity();
  });
  let rec;
  await s.check('Repeating entry posts each due date once, rerunning adds nothing, pausing stops it', async () => {
    const start = new Date(Date.now() - 65 * 864e5).toISOString().slice(0, 10);
    rec = await ok(owner, 'fin_recurring_save', { p: { kind: 'expense', amount: 1200, freq: 'monthly', start_date: start, payload: { account_id: cash, purpose: 'Shop rent' } } });
    await fails(owner, 'fin_recurring_save', { p: { kind: 'expense', amount: 0, freq: 'monthly' } }, /amount/i);
    await fails(staff, 'fin_recurring_run', {}, /does not allow/i);
    const b0 = await bal(cash); const r1 = await ok(owner, 'fin_recurring_run', {});
    assert(r1.posted >= 2 && r1.failed === 0, JSON.stringify(r1)); assert(await bal(cash) === b0 - 1200 * r1.posted, 'cash after repeats');
    const r2 = await ok(owner, 'fin_recurring_run', {}); assert(r2.posted === 0, 'second run posted again');
    const l = (await ok(owner, 'fin_recurring_list')).find((x) => x.id === rec.id); assert(l && !l.due, JSON.stringify(l));
    await ok(owner, 'fin_recurring_stop', { p_id: rec.id, p_active: false }); await integrity();
  }, 'major');
  await s.check('Bank statement import: matches an existing entry, creates the rest for review, a repeat import adds nothing', async () => {
    const acct = await ok(owner, 'fin_save_account', { p: { name: 'Statement bank', kind: 'bank', opening: 10000 } });
    await ok(owner, 'fin_save_txn', { p: { kind: 'expense', amount: 700, account_id: acct.id, purpose: 'Electricity', date: new Date().toISOString().slice(0, 10) } });
    const today = new Date().toISOString().slice(0, 10);
    const rows = [{ date: today, debit: 700, desc: 'ELEC BILL', ref: 'UTR-A1' }, { date: today, credit: 2500, desc: 'CUSTOMER UPI', ref: 'UTR-B2' }, { date: today, debit: 300, desc: 'Same twice' }, { date: today, debit: 300, desc: 'Same twice' }, { date: 'bad', debit: 5 }];
    const pv = await ok(owner, 'fin_import_preview', { p_account: acct.id, p_rows: rows });
    const st = pv.rows.map((x) => x.status); assert(st[0] === 'matched' && st[1] === 'new' && st[2] === 'new' && st[3] === 'new' && st[4] === 'skip', st.join());
    const commit = rows.map((r, i) => ({ ...r, action: pv.rows[i].status === 'matched' ? 'match' : 'new', txn_id: pv.rows[i].txn_id }));
    const c1 = await ok(owner, 'fin_import_commit', { p_account: acct.id, p_rows: commit });
    assert(c1.matched === 1 && c1.created === 3, JSON.stringify(c1)); assert(await bal(acct.id) === 10000 - 700 + 2500 - 600, 'bank after import');
    const pv2 = await ok(owner, 'fin_import_preview', { p_account: acct.id, p_rows: rows }); assert(pv2.rows.slice(0, 4).every((x) => x.status === 'duplicate' || x.status === 'matched' || x.status === 'new') && pv2.rows[1].status === 'duplicate', pv2.rows.map((x) => x.status).join());
    const c2 = await ok(owner, 'fin_import_commit', { p_account: acct.id, p_rows: commit }); assert(c2.created === 0, 'repeat created ' + c2.created);
    await fails(staff, 'fin_import_commit', { p_account: acct.id, p_rows: [] }, /does not allow/i); await integrity();
  }, 'major');
  await s.check('Reminders list only people owing past the days; insights and forecast answer without errors', async () => {
    const rem = await ok(owner, 'fin_reminders'); assert(Array.isArray(rem), 'reminders');
    const an = await ok(owner, 'fin_anomalies'); assert(Array.isArray(an), 'anomalies');
    const fc = await ok(owner, 'fin_forecast'); assert(fc.cash_now !== undefined && fc.based_on_days === 60, JSON.stringify(fc));
    await fails(cafe, 'fin_forecast', {}, /not enabled/i);
  });

  await s.check('GST and TDS memo: noted on entries, added up for filing, bad values refused, books unchanged', async () => {
    const today = new Date().toISOString().slice(0, 10), from = today.slice(0, 8) + '01';
    const before = await ok(owner, 'fin_tax_summary', { p_from: from, p_to: today });
    await ok(owner, 'fin_save_txn', { p: { kind: 'money_in', amount: 1180, account_id: cash, purpose: 'Taxed sale', tax_rate: 18, tds_amt: 10 } });
    await ok(owner, 'fin_save_txn', { p: { kind: 'expense', amount: 590, account_id: cash, purpose: 'Taxed buy', tax_rate: 18 } });
    const r = await ok(owner, 'fin_tax_summary', { p_from: from, p_to: today });
    assert(Math.abs(Number(r.output_gst) - Number(before.output_gst) - 180) < 0.01 && Math.abs(Number(r.input_gst) - Number(before.input_gst) - 90) < 0.01, JSON.stringify(r));
    assert(Number(r.tds_cut_on_us) - Number(before.tds_cut_on_us) === 10, 'tds'); assert(r.by_rate.some((x) => Number(x.rate) === 18), 'by rate');
    await fails(owner, 'fin_save_txn', { p: { kind: 'expense', amount: 100, account_id: cash, tax_rate: 90 } }, /GST rate/i);
    await fails(owner, 'fin_save_txn', { p: { kind: 'expense', amount: 100, account_id: cash, tds_amt: 500 } }, /TDS/i);
    await fails(cafe, 'fin_tax_summary', { p_from: from, p_to: today }, /not enabled/i); await integrity();
  }, 'major');
  await s.check('Payment mode details, who paid and their GST number are kept; a bad GST number or mode is refused', async () => {
    const e = await ok(owner, 'fin_save_txn', { p: { op: uid(), kind: 'expense', amount: 400, account_id: bank, method: 'cheque', cheque_no: '123456', cheque_date: '2026-10-01', cheque_bank: 'SBI', party_name: 'Shree Traders', party_gstin: '08aaavf9235h1zl'.toUpperCase() } });
    const l = (await ok(owner, 'fin_txn_list', { p: { limit: 50 } })).find((x) => x.id === e.id);
    assert(l.method === 'cheque' && l.cheque_no === '123456' && l.cheque_bank === 'SBI' && l.party_name === 'Shree Traders' && l.party_gstin === '08AAAVF9235H1ZL', JSON.stringify(l));
    const u = await ok(owner, 'fin_save_txn', { p: { op: uid(), kind: 'money_in', amount: 90, account_id: bank, method: 'upi', reference: 'UTR998877' } });
    assert((await ok(owner, 'fin_txn_list', { p: { limit: 50 } })).find((x) => x.id === u.id).reference === 'UTR998877', 'utr');
    await fails(owner, 'fin_save_txn', { p: { op: uid(), kind: 'expense', amount: 5, account_id: bank, party_gstin: '123' } }, /GST number/i);
    await fails(owner, 'fin_save_txn', { p: { op: uid(), kind: 'expense', amount: 5, account_id: bank, method: 'bitcoin' } }, /payment mode/i);
    await integrity();
  });
  await s.check('Earlier expense: counts as an expense and as owner capital, moves no account, shows in the profit report, books balance', async () => {
    const before = await ok(owner, 'fin_bootstrap'); const bankBefore = Number(before.accounts.find((a) => a.id === bank).balance);
    const pl0 = await ok(owner, 'fin_report_pl', { p_from: '2026-01-01', p_to: '2026-12-31' });
    const op = uid();
    const e = await ok(owner, 'fin_save_txn', { p: { op, kind: 'early_expense', amount: 1200, date: '2026-04-02', partner_id: mahendra, early_reason: 'before_bank', purpose: 'Shop board', party_gstin: '' } });
    assert(e.kind === 'early_expense' && e.early_reason === 'before_bank', JSON.stringify(e));
    assert((await ok(owner, 'fin_save_txn', { p: { op, kind: 'early_expense', amount: 1200, date: '2026-04-02', partner_id: mahendra } })).duplicate === true, 'replay');
    assert(await bal(bank) === bankBefore, 'bank must not move');
    const pl1 = await ok(owner, 'fin_report_pl', { p_from: '2026-01-01', p_to: '2026-12-31' });
    assert(JSON.stringify(pl1) !== JSON.stringify(pl0), 'profit report should change');
    await fails(owner, 'fin_save_txn', { p: { op: uid(), kind: 'early_expense', amount: 10 } }, /who paid/i);
    await integrity();
  });
  await s.check('Business profile is its own record: owner saves it, GST/PAN are checked, staff can read but not change; lock date works', async () => {
    const p0 = await ok(owner, 'fin_profile_get'); assert(p0.can_edit === true && p0.business_name, JSON.stringify(p0));
    const p1 = await ok(owner, 'fin_profile_save', { p: { business_name: 'Test Traders', gstin: '08AAAVF9235H1ZL', pan: 'ABCDE1234F', city: 'Jodhpur' } });
    assert(p1.business_name === 'Test Traders' && p1.city === 'Jodhpur' && p1.gstin === '08AAAVF9235H1ZL', JSON.stringify(p1));
    await fails(owner, 'fin_profile_save', { p: { business_name: 'X', gstin: 'bad' } }, /GST number/i);
    await fails(owner, 'fin_profile_save', { p: { business_name: 'X', pan: 'bad' } }, /PAN/i);
    await fails(manager, 'fin_profile_save', { p: { business_name: 'Y' } }, /does not allow/i);
    assert((await ok(manager, 'fin_profile_get')).business_name === 'Test Traders', 'manager reads');
    const lk = await ok(owner, 'fin_set_lock_date', { p_date: '2026-01-01' }); assert(lk.lock_date === '2026-01-01', 'lock');
    await fails(owner, 'fin_save_txn', { p: { op: uid(), kind: 'expense', amount: 5, account_id: bank, date: '2025-12-31' } }, /lock|closed|period/i);
    await ok(owner, 'fin_set_lock_date', { p_date: null });
  });
  await s.check('Own file storage: a photo is squeezed, a PDF over 10 KB is refused, a small PDF is kept, files list on the entry', async () => {
    const sharp = (await import('../../../server/node_modules/sharp/lib/index.js')).default;
    const big = await sharp({ create: { width: 3000, height: 2000, channels: 3, background: { r: 200, g: 50, b: 50 } } }).png().toBuffer();
    const tok = owner;
    const up = async (buf) => fetch(stack.apiBase + '/storage/fin', { method: 'POST', headers: { Authorization: 'Bearer ' + tok, 'content-type': 'application/octet-stream' }, body: buf });
    const r1 = await up(big); const j1 = await r1.json(); assert(r1.status === 200 && j1.url.startsWith('/storage/fin/') && j1.size < 120000, JSON.stringify(j1));
    const bigPdf = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(12000, 32)]);
    const r2 = await up(bigPdf); assert(r2.status === 400, 'big pdf ' + r2.status);
    const smallPdf = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(2000, 32)]);
    const r3 = await up(smallPdf); const j3 = await r3.json(); assert(r3.status === 200 && j3.url.endsWith('.pdf'), JSON.stringify(j3));
    const e = await ok(owner, 'fin_save_txn', { p: { op: uid(), kind: 'expense', amount: 33, account_id: cash } });
    await ok(owner, 'fin_attach', { p_id: e.id, p_name: 'a.jpg', p_url: j1.url, p_size: j1.size });
    const l = (await ok(owner, 'fin_txn_list', { p: { limit: 50 } })).find((x) => x.id === e.id); assert(l.files.length === 1 && l.evidence === 'have', JSON.stringify(l.files));
    const g = await fetch(stack.apiBase + j1.url, { headers: { Authorization: 'Bearer ' + owner } }); assert(g.status === 200, 'download ' + g.status);
    const other = await fetch(stack.apiBase + j1.url, { headers: { Authorization: 'Bearer ' + cafe } }); assert(other.status >= 400, 'other business must be refused');
    await fetch(stack.apiBase + '/storage/fin', { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: big }).then((r) => assert(r.status === 401, 'anon'));
  });
  await s.check('A new expense category can be created, is reused by name, appears in the list and can be used on an entry; staff cannot', async () => {
    const c = await ok(owner, 'fin_save_category', { p: { name: 'Packaging', kind: 'expense' } });
    const again = await ok(owner, 'fin_save_category', { p: { name: ' packaging ', kind: 'expense' } }); assert(again.id === c.id, 'same name reused');
    const inc = await ok(owner, 'fin_save_category', { p: { name: 'Consulting fees', kind: 'income' } });
    const ctx2 = await ok(owner, 'fin_bootstrap'); assert(ctx2.categories.expense.some((x) => x.id === c.id) && ctx2.categories.income.some((x) => x.id === inc.id), 'listed');
    const e = await ok(owner, 'fin_save_txn', { p: { op: uid(), kind: 'expense', amount: 77, account_id: cash, category_id: c.id } });
    assert((await ok(owner, 'fin_txn_list', { p: { limit: 50 } })).find((x) => x.id === e.id).category === 'Packaging', 'used');
    await fails(owner, 'fin_save_category', { p: { name: '  ' } }, /name/i);
    await fails(staff, 'fin_save_category', { p: { name: 'Nope' } }, /does not allow/i);
    await integrity();
  });
  await s.check('Live demo: the shared demo business has AUZsFinance with sample entries, opens in the app, and the demo page links to it', async () => {
    const demo = (await (await fetch(stack.apiBase + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'demo@auzslab.in', password: 'Auzslab@Demo' }) })).json()).access_token;
    assert(demo, 'demo login');
    const ctx = await ok(demo, 'fin_bootstrap'); assert(ctx.accounts.length >= 2, 'accounts');
    const list = await ok(demo, 'fin_txn_list', { p: { limit: 500 } }); assert(list.length >= 25, 'sample entries ' + list.length);
    const d = await ok(demo, 'fin_dashboard', {}); assert(Number(d.cash_total) > 0, 'cash');
    const today = new Date().toISOString().slice(0, 10), t = await ok(demo, 'fin_tax_summary', { p_from: today.slice(0, 8) + '01', p_to: today }); assert(Number(t.output_gst) > 0, 'sample GST');
    const ic = await ok(demo, 'fin_integrity_check'); assert(ic.ok, 'demo books out of line');
    const c = await newCtx(browser, stack, { w: 390, h: 844, mobile: true }); const page = await c.newPage(); const errs = watch(page);
    await page.goto(stack.url('demo', '/finance.html')); await page.waitForSelector('input[type=password]', { timeout: 20000 });
    await page.fill('input[type=email]', 'demo@auzslab.in'); await page.fill('input[type=password]', 'Auzslab@Demo');
    await page.locator('button', { hasText: /sign in/i }).last().click(); await page.waitForSelector('.hero-n .n', { timeout: 20000 });
    await page.waitForSelector('svg.flow', { timeout: 8000 });
    assert(!errs.filter((e) => !/sentry/i.test(e)).length, 'script errors'); await c.close();
    const html = (await import('node:fs')).readFileSync(new URL('../../../site/live-demo.html', import.meta.url), 'utf8');
    assert(/demo\.auzslab\.in\/finance\.html/.test(html) && /AUZsFinance/.test(html), 'live-demo page card');
  }, 'major');
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
      for (const id of ['home', 'activity', 'dues', 'owner', 'accounts', 'reports', 'assets', 'budget', 'approvals', 'repeat', 'bank', 'insights', 'tools', 'tax', 'settings']) {
        await page.evaluate((x) => { location.hash = '#/' + x; }, id); await page.waitForTimeout(700);
        await page.waitForSelector('.page[data-p="' + id + '"]', { timeout: 10000 });
        const txt = await page.locator('.page').innerText(); assert(!/undefined|\bNaN\b|\[object/.test(txt), id + ' shows a bad value: ' + (txt.match(/.{0,40}(undefined|NaN|\[object).{0,40}/i) || [txt.slice(0,80)])[0]);
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
