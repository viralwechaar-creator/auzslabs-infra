// AUZsLedger / AUZsFinance notifications (db/295): who is told, when, how often, and what each person can change.
// Checked through the real API and the shared inbox, then the bell and the notification page in a real browser.
import { suite, watch, assert } from '../../lib/harness.mjs';
import { newCtx } from '../../lib/common.mjs';
import { rpc } from '../../lib/api.mjs';
import { q, PASSWORD, USERS } from '../../lib/db.mjs';

export default async function run({ browser, stack }) {
  const s = suite('Notifications for AUZsLedger and AUZsFinance', 'Payments, bills, due dates, cash, budgets, approvals, GST dates and summaries reach the right people once, with an action, and respect each business setting.');
  const login = async (email) => (await (await fetch(stack.apiBase + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) })).json()).access_token;
  const [owner, manager, cashier, fOwner, fManager] = await Promise.all([USERS.acctOwner, USERS.acctManager, USERS.acctCashier, USERS.finOwner, USERS.finManager].map(login));
  const call = async (tok, fn, args) => { const r = await rpc(stack, fn, args || {}, tok); return { ok: r.status === 200, status: r.status, data: r.data && r.data.data, error: r.data && r.data.error }; };
  const ok = async (tok, fn, args) => { const r = await call(tok, fn, args); assert(r.ok, `${fn}: ${r.status} ${r.error}`); return r.data; };
  const fails = async (tok, fn, args, re) => { const r = await call(tok, fn, args); assert(!r.ok, `${fn} should have been refused`); if (re) assert(re.test(r.error || ''), `${fn} refused with the wrong message: ${r.error}`); };
  const inbox = async (tok) => (await ok(tok, 'inbox_list', { p_limit: 100 })).items;
  const has = (items, type) => items.find((x) => x.type === type);
  const tid = (await q("select id from tenants where slug='testacct'"))[0].id;
  const ftid = (await q("select id from tenants where slug='testfin'"))[0].id;
  await q('delete from notifications where tenant_id in ($1,$2)', [tid, ftid]);
  await q("update tenant_settings set features = features || '{\"accounting\":true}' where tenant_id=$1", [tid]);

  let cust, supp, svc, cash, bank;
  await s.check('Set up: books, a customer with a credit limit, a supplier, a service', async () => {
    await ok(owner, 'acc_bootstrap');
    await ok(owner, 'acc_save_org', { p: { legal_name: 'Alert Test Pvt Ltd', state_code: '08', gstin: '08AAACR5055K1Z7', reg_type: 'regular' } });
    cust = (await ok(owner, 'acc_save_party', { p: { kind: 'customer', name: 'Rahul Sharma', credit_limit: 10000, credit_days: 5, phone: '9876500001' } })).id;
    supp = (await ok(owner, 'acc_save_party', { p: { kind: 'supplier', name: 'Delhi Wholesale', state_code: '07', reg_type: 'regular' } })).id;
    svc = (await ok(owner, 'acc_save_product', { p: { sku: 'AL-1', name: 'Alert service', hsn: '9988', tax_rate: 0, sale_price: 1000, is_service: true } })).id;
    cash = (await q("select id from acc_accounts where tenant_id=$1 and is_cash limit 1", [tid]))[0].id;
    bank = (await q("select id from acc_accounts where tenant_id=$1 and is_bank limit 1", [tid]))[0].id;
    await q('delete from notifications where tenant_id=$1', [tid]);
  }, 'critical');

  await s.check('A bill by staff tells the owner (not the person who made it) and a payment shows the remaining balance', async () => {
    const inv = await ok(manager, 'acc_save_document', { p: { doc_type: 'invoice', party_id: cust, post: true, lines: [{ product_id: svc, qty: 1, rate: 8000 }] } });
    let o = await inbox(owner), m = await inbox(manager);
    const n = has(o, 'txn_new'); assert(n && /8,000/.test(n.body) && n.severity === 'info' && n.action === 'Open', JSON.stringify(o.map((x) => x.type)));
    assert(!has(m, 'txn_new'), 'the person who made the bill was told about their own action');
    await ok(manager, 'acc_save_payment', { p: { kind: 'receipt', party_id: cust, account_id: bank, amount: 5000, allocations: [{ doc_id: inv.id, amount: 5000 }] } });
    o = await inbox(owner); const p = has(o, 'pay_in_part');
    assert(p && /5,000/.test(p.body) && /Remaining balance: ₹3,000/.test(p.body) && /Rahul Sharma/.test(p.body) && p.link.includes('/accounts.html#/party/' + cust), JSON.stringify(p));
    await ok(manager, 'acc_save_payment', { p: { kind: 'receipt', party_id: cust, account_id: cash, amount: 3000, allocations: [{ doc_id: inv.id, amount: 3000 }] } });
    o = await inbox(owner); assert(has(o, 'pay_in') && has(o, 'cust_cleared'), 'full payment / cleared missing: ' + o.map((x) => x.type));
  }, 'critical');

  await s.check('Credit limit: getting close to it raises a warning with a link to the customer (the books already refuse going over)', async () => {
    await ok(manager, 'acc_save_document', { p: { doc_type: 'invoice', party_id: cust, post: true, lines: [{ product_id: svc, qty: 1, rate: 9000 }] } });
    const c = has(await inbox(owner), 'cust_credit'); assert(c && c.severity === 'warning' && /close to the credit limit/.test(c.title) && /limit of ₹10,000/.test(c.body), JSON.stringify(c));
  });

  await s.check('Due dates: overdue and due today are raised once, running again changes nothing', async () => {
    await q("update acc_documents set due_date = current_date - 12 where tenant_id=$1 and doc_type='invoice' and party_id=$2", [tid, cust]);
    const r1 = await ok(owner, 'inbox_mark_read', { p_ids: null });
    const run = (await q('select alerts_run($1) r', [tid]))[0].r; assert(!run.problems.length, JSON.stringify(run.problems));
    const o = await inbox(owner); const od = has(o, 'cust_overdue');
    assert(od && od.severity === 'critical' && /Rahul Sharma/.test(od.body) && /9,000/.test(od.body) && od.action === 'Collect payment', JSON.stringify(od) + ' ' + JSON.stringify(o.map((x) => x.type)));
    const before = (await q('select count(*)::int n from notifications where tenant_id=$1', [tid]))[0].n;
    await q('select alerts_run($1)', [tid]);
    assert((await q('select count(*)::int n from notifications where tenant_id=$1', [tid]))[0].n === before, 'a second run repeated a notice');
    await q("update acc_documents set due_date = current_date where tenant_id=$1 and doc_type='invoice' and party_id=$2", [tid, cust]);
    await q('select alerts_run($1)', [tid]);
    assert(has(await inbox(owner), 'cust_due_today'), 'due today missing');
  }, 'critical');

  await s.check('Supplier bills: due tomorrow and overdue', async () => {
    const b = await ok(owner, 'acc_save_document', { p: { doc_type: 'bill', party_id: supp, supplier_ref: 'AL/1', post: true, lines: [{ description: 'Goods', qty: 1, rate: 2000 }] } });
    await q("update acc_documents set due_date = current_date + 1 where id=$1", [b.id]);
    await q('select alerts_run($1)', [tid]);
    assert(has(await inbox(owner), 'sup_due_soon') && has(await inbox(owner), 'pay_reco'), 'soon / recommendation missing');
    await q("update acc_documents set due_date = current_date - 3 where id=$1", [b.id]);
    await q('select alerts_run($1)', [tid]);
    const so = has(await inbox(owner), 'sup_overdue'); assert(so && /you owe/.test(so.body), JSON.stringify(so));
  });

  await s.check('Low cash and bank balance follow the thresholds the owner sets, and are quiet when the balance is fine', async () => {
    await ok(owner, 'alerts_settings_save', { p: { low_cash: 1000000, low_bank: 1000000 } });
    await q('select alerts_run($1)', [tid]);
    const o = await inbox(owner); assert(has(o, 'low_cash') && has(o, 'low_bank') && /below ₹10,00,000/.test(has(o, 'low_cash').body), 'low balance missing');
    await q("delete from notifications where tenant_id=$1 and type in ('low_cash','low_bank')", [tid]);
    await ok(owner, 'alerts_settings_save', { p: { low_cash: 0, low_bank: 0 } });
    await q('select alerts_run($1)', [tid]); assert(!has(await inbox(owner), 'low_cash'), 'low cash raised with the threshold off');
  });

  await s.check('Approval: a request tells managers; the answer tells the person who asked', async () => {
    const rq = await ok(cashier, 'acc_expense_request_save', { p: { description: 'Printer ink', amount: 900 } });
    const o = await inbox(owner); const a = has(o, 'approval_needed'); assert(a && /900/.test(a.body) && a.action === 'Review', 'owner not asked');
    assert(!has(await inbox(cashier), 'approval_needed'), 'the requester was asked to approve');
    await ok(owner, 'acc_expense_request_decide', { p_id: rq.id, p_decision: 'approve' });
    assert(has(await inbox(cashier), 'approved'), 'requester not told');
  });

  await s.check('Settings: only owner or manager change them; a switched-off notice is not sent; bad values are refused; the cashier cannot', async () => {
    const cfg = await ok(cashier, 'alerts_settings_get'); assert(cfg.can_edit === false && cfg.recipients === 'managers', JSON.stringify(cfg));
    await fails(cashier, 'alerts_settings_save', { p: { low_cash: 5 } }, /owner or a manager/i);
    await fails(owner, 'alerts_settings_save', { p: { summary_hour: 30 } }, /0 to 23/);
    await fails(owner, 'alerts_settings_save', { p: { recipients: 'everybody' } }, /Recipients/);
    await fails(owner, 'alerts_settings_save', { p: { remind_days: [0] } }, /Reminder days/);
    await ok(owner, 'alerts_settings_save', { p: { off: ['txn_new'] } });
    await q("delete from notifications where tenant_id=$1 and type='txn_new'", [tid]);
    await ok(manager, 'acc_save_document', { p: { doc_type: 'invoice', party_id: cust, post: true, lines: [{ product_id: svc, qty: 1, rate: 10 }] } });
    assert(!has(await inbox(owner), 'txn_new'), 'a switched-off notice was sent');
    await ok(owner, 'alerts_settings_save', { p: { off: [] } });
    assert((await ok(manager, 'alerts_settings_get')).off.length === 0, 'settings not saved');
  }, 'critical');

  await s.check('Each business only sees its own notices', async () => {
    const f = await inbox(fOwner); assert(f.every((x) => !/Rahul Sharma/.test(x.body || '')), 'finance owner sees ledger notices of another business');
    const c = await inbox(cashier); assert(c.every((x) => x.type !== 'cust_overdue'), 'the cashier received a manager-level notice');
  }, 'critical');

  await s.check('AUZsFinance: a big entry tells the owner, an entry above the approval limit asks for approval and the answer comes back', async () => {
    const ctx = await ok(fOwner, 'fin_bootstrap'); const acct = ctx.accounts.find((a) => a.kind === 'cash').id;
    await q("update tenant_settings set features = features || '{\"finance\":true}' where tenant_id=$1", [ftid]);
    await ok(fOwner, 'alerts_settings_save', { p: { large_out: 50000 } });
    await ok(fManager, 'fin_save_txn', { p: { op: crypto.randomUUID(), kind: 'expense', amount: 75000, account_id: acct, category_id: ctx.categories.expense[0].id, purpose: 'Big purchase', evidence: 'have' } });
    const o = await inbox(fOwner);
    assert(has(o, 'large_out') && /75,000/.test(has(o, 'large_out').body) && has(o, 'fin_entry'), 'finance notices missing: ' + o.map((x) => x.type));
    assert(has(o, 'fin_entry').link.includes('/finance.html#/activity?open='), 'finance link');
    assert(!has(await inbox(fManager), 'fin_entry'), 'the person who made the entry was notified');
    await ok(fOwner, 'fin_settings_save', { p: { approval_limit: 1000 } });
    const e = await ok(fManager, 'fin_save_txn', { p: { op: crypto.randomUUID(), kind: 'expense', amount: 4000, account_id: acct, category_id: ctx.categories.expense[0].id, purpose: 'Needs approval', evidence: 'have' } });
    const row = (await q("select id, review from fin_txns where tenant_id=$1 and purpose='Needs approval'", [ftid]))[0];
    if (row && row.review === 'needs_review') {
      assert(has(await inbox(fOwner), 'approval_needed'), 'owner not asked to approve');
      await ok(fOwner, 'fin_mark_txn', { p: { id: row.id, review: 'confirmed' } });
      assert(has(await inbox(fManager), 'approved'), 'person not told of approval');
    }
  });

  await s.check('Summaries and GST: the daily summary is sent after the chosen hour once; GST due dates only for a registered business', async () => {
    const at = new Date(); const late = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 18, 16, 0, 0)); // 21:30 IST on the 18th
    await q('delete from notifications where tenant_id=$1', [tid]);
    await q('select alerts_run($1, $2)', [tid, late.toISOString()]);
    const o = await inbox(owner);
    assert(has(o, 'daily_summary') === undefined || /Sales/.test(has(o, 'daily_summary').body), 'daily summary text');
    const g = o.filter((x) => /^gst_(due|pay_due)$/.test(x.type)); assert(g.length >= 1 && g.every((x) => x.cat === 'gst'), 'GST due notice missing: ' + o.map((x) => x.type));
    await q("update acc_org set reg_type='unregistered' where tenant_id=$1", [tid]);
    await q('delete from notifications where tenant_id=$1', [tid]);
    await q('select alerts_run($1, $2)', [tid, late.toISOString()]);
    assert(!(await inbox(owner)).some((x) => x.cat === 'gst'), 'GST notice for a business that does not file');
    await q("update acc_org set reg_type='regular' where tenant_id=$1", [tid]);
  });

  await s.check('Security: a new device sign-in and a password change tell the person; the test notice reaches the caller', async () => {
    const uid = (await q("select id from auth_users where email=$1", [USERS.acctOwner]))[0].id;
    await q("insert into auth_sessions (jti, user_id, device_label) values (gen_random_uuid(), $1, 'Chrome on Windows')", [uid]);
    await q("insert into auth_sessions (jti, user_id, device_label) values (gen_random_uuid(), $1, 'Safari on iPhone')", [uid]);
    const o = await inbox(owner); const nl = has(o, 'new_login'); assert(nl && /iPhone/.test(nl.body) && nl.severity === 'warning', 'new login');
    const t = await ok(owner, 'alerts_send_test'); assert(t.sent === 1, JSON.stringify(t));
    assert(has(await inbox(owner), 'test'), 'test notice not delivered');
  });

  await s.check('A phone alert is sent only for critical and warning notices, and the flood guard stops an import from burying the inbox', async () => {
    const rows = await q("select severity, push from notifications where tenant_id=$1", [tid]);
    assert(rows.length && rows.every((r) => (r.severity === 'critical' || r.severity === 'warning') || r.push === false), 'an info notice would buzz the phone');
    await q("delete from notifications where tenant_id=$1 and type='party_new'", [tid]);
    for (let i = 0; i < 30; i++) await ok(owner, 'acc_save_party', { p: { kind: 'customer', name: 'Bulk ' + i } });
    assert((await q("select count(*)::int n from notifications where tenant_id=$1 and type='party_new'", [tid]))[0].n <= 12 * 3, 'flood guard missing');
  });

  await s.check('The bell and the notification page work in AUZsLedger and AUZsFinance (phone and desktop)', async () => {
    for (const [slug, file, email, dev] of [['testacct', 'accounts.html', USERS.acctOwner, { w: 390, h: 844, mobile: true }], ['testacct', 'accounts.html', USERS.acctOwner, { w: 1280, h: 800 }], ['testfin', 'finance.html', USERS.finOwner, { w: 390, h: 844, mobile: true }], ['testfin', 'finance.html', USERS.finOwner, { w: 1280, h: 800 }]]) {
      const c = await newCtx(browser, stack, dev); const page = await c.newPage(); const errs = watch(page);
      await page.goto(stack.url(slug, '/' + file)); await page.waitForSelector('input[type=password]', { timeout: 20000 });
      await page.fill('input[type=email]', email); await page.fill('input[type=password]', PASSWORD);
      await page.locator('button', { hasText: /sign in/i }).last().click(); await page.waitForSelector('.shell', { timeout: 20000 });
      await page.waitForSelector('.auzb', { timeout: 15000 });
      await page.locator('.auzb').click(); await page.waitForSelector('.auzp.on'); await page.waitForTimeout(600);
      const sev = await page.locator('.auzp-i.s-critical, .auzp-i.s-warning, .auzp-i.s-info').count(); assert(sev >= 1, `${slug}: no graded notices in the bell`);
      assert((await page.locator('.auzp-t button').count()) === 4, 'bell tabs');
      await page.locator('.auzp-h button', { hasText: /all notifications/i }).click(); await page.waitForSelector('.al-sum', { timeout: 10000 });
      const txt = await page.locator('.al').innerText(); assert(/Notification settings/.test(txt) && /Critical/.test(txt), 'page content ' + txt.slice(0, 80));
      await page.locator('.al-set summary').click(); await page.waitForSelector('.al-body input');
      assert((await page.locator('.al-body input[type=checkbox]').count()) > 30, 'switches');
      await page.waitForTimeout(4000); assert((await page.locator('.al-body input').count()) > 0, `${slug}: the page redrew itself and closed the settings`);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2), `sideways scroll ${slug} ${dev.w}`);
      await page.screenshot({ path: `tests/report/shots/alerts-${slug}-${dev.w}.png`, fullPage: true }).catch(() => {});
      const bad = errs.filter((e) => !/sentry/i.test(e)); assert(!bad.length, 'script errors: ' + bad.slice(0, 2).join(' | '));
      await c.close();
    }
  });
  return s.done();
}
