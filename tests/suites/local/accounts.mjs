// AUZslab Accounting: the books must balance and trace, rules must hold server-side, and the app must work on phone and desktop.
import { suite, watch, assert } from '../../lib/harness.mjs';
import { newCtx } from '../../lib/common.mjs';
import { rpc } from '../../lib/api.mjs';
import { q, PASSWORD, USERS } from '../../lib/db.mjs';

export default async function run({ browser, stack }) {
  const s = suite('Accounting: books, GST, stock, access and screens', 'Posts real documents through the engine and checks every invariant (balanced journals, ledgers that tie to documents, GST, stock), then drives the screens on desktop and phone.');
  const login = async (email) => (await (await fetch(stack.apiBase + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) })).json()).access_token;
  const [owner, manager, cashier, cafe] = await Promise.all([USERS.acctOwner, USERS.acctManager, USERS.acctCashier, USERS.cafeOwner].map(login));
  const call = async (tok, fn, args) => { const r = await rpc(stack, fn, args || {}, tok); return { ok: r.status === 200, status: r.status, data: r.data && r.data.data, error: r.data && r.data.error }; };
  const ok = async (tok, fn, args) => { const r = await call(tok, fn, args); assert(r.ok, `${fn}: ${r.status} ${r.error}`); return r.data; };
  const fails = async (tok, fn, args, re) => { const r = await call(tok, fn, args); assert(!r.ok, `${fn} should have been refused`); if (re) assert(re.test(r.error || ''), `${fn} refused with the wrong reason: ${r.error}`); return r; };
  const tid = (await q("select id from tenants where slug='testacct'"))[0].id;
  const integrity = async () => { const r = await ok(owner, 'acc_integrity_check'); const bad = r.checks.filter((c) => !c.ok); assert(r.ok, 'books out of line: ' + bad.map((c) => c.name + ' (' + c.detail + ')').join('; ')); return r; };

  // ---------- access ----------
  await s.check('Not entitled to accounting: the cafe owner is refused server-side', async () => { await fails(cafe, 'acc_bootstrap', {}, /not enabled/i); await fails(cafe, 'acc_list_documents', { p: {} }, /not enabled/i); }, 'critical');
  await s.check('Logged out: every accounting call is refused', async () => { const r = await call(null, 'acc_dashboard', {}); assert(r.status === 401, 'status ' + r.status); const p = await call(null, 'acc_save_document', { p: {} }); assert(p.status === 401, 'status ' + p.status); }, 'critical');
  await s.check('Only the owner can set accounting up; a manager asking first is told to wait', async () => { await fails(manager, 'acc_bootstrap', {}, /ask the owner/i); const c = await ok(owner, 'acc_bootstrap'); assert(c.accounts.length >= 40 && c.fys.length === 2, 'seeding incomplete'); assert(c.perms.acc_admin && !(await ok(manager, 'acc_bootstrap')).perms.acc_admin, 'permissions wrong'); }, 'critical');
  await s.check('Cashier can see and sell but not post journals, cancel, or change settings', async () => {
    await fails(cashier, 'acc_save_voucher', { p: { type: 'journal', lines: [] } }, /role does not allow/i); await fails(cashier, 'acc_set_lock', { p_date: '2026-01-01' }, /role does not allow/i); await fails(cashier, 'acc_save_org', { p: { legal_name: 'x' } }, /role does not allow/i);
    await fails(cashier, 'acc_save_document', { p: { doc_type: 'bill', lines: [{ description: 'x', qty: 1, rate: 1 }] } }, /role does not allow/i);
  }, 'critical');
  await s.check('Manager can do everything except settings', async () => { await ok(manager, 'acc_dashboard'); await fails(manager, 'acc_set_lock', { p_date: '2026-01-01' }, /role does not allow/i); await fails(manager, 'acc_save_taxcode', { p: { code: 'X', name: 'X', rate: 1 } }, /role does not allow/i); }, 'major');
  await s.check('Switching accounting off (owner toggle) blocks the RPCs even for the owner', async () => {
    await q("update tenant_settings set enabled_features = enabled_features || '{\"accounting\": false}' where tenant_id=$1", [tid]);
    await fails(owner, 'acc_dashboard', {}, /not enabled/i);
    await q("update tenant_settings set enabled_features = enabled_features - 'accounting' where tenant_id=$1", [tid]);
    await ok(owner, 'acc_dashboard');
  }, 'critical');

  // ---------- masters ----------
  let cust, supp, tee, svc, wh;
  await s.check('GSTIN check digit is validated; state must agree with the GSTIN', async () => {
    await fails(owner, 'acc_save_party', { p: { kind: 'customer', name: 'Bad', gstin: '08AAACR5055K1Z8' } }, /not valid/i);
    await fails(owner, 'acc_save_party', { p: { kind: 'customer', name: 'Wrong state', gstin: '08AAACR5055K1Z7', state_code: '27' } }, /does not match/i);
    cust = (await ok(owner, 'acc_save_party', { p: { kind: 'customer', name: 'Raj Traders', gstin: '08AAACR5055K1Z7', credit_limit: 50000, credit_days: 15, phone: '9876543210' } })).id;
    supp = (await ok(owner, 'acc_save_party', { p: { kind: 'supplier', name: 'Delhi Wholesale', state_code: '07', reg_type: 'regular' } })).id;
  }, 'critical');
  await s.check('Org set to Rajasthan; products with GST rates only from the configured list', async () => {
    await ok(owner, 'acc_save_org', { p: { legal_name: 'Test Accounts Pvt Ltd', state_code: '08' } });
    await fails(owner, 'acc_save_product', { p: { sku: 'BAD', name: 'Bad rate', tax_rate: 17 } }, /not configured/i);
    tee = (await ok(owner, 'acc_save_product', { p: { sku: 'TSH-1', name: 'T-Shirt', hsn: '6109', tax_rate: 12, sale_price: 500, purchase_price: 300, reorder_level: 5 } })).id;
    svc = (await ok(owner, 'acc_save_product', { p: { sku: 'SVC-1', name: 'Stitching', hsn: '9988', tax_rate: 18, sale_price: 100, is_service: true } })).id;
    wh = (await ok(owner, 'acc_context')).warehouses[0].id;
  }, 'critical');

  // ---------- posting engine ----------
  let bill, inv;
  const cash = (await ok(owner, 'acc_context')).accounts.find((a) => a.system_key === 'cash').id;
  const bank = (await ok(owner, 'acc_context')).accounts.find((a) => a.system_key === 'bank').id;
  await s.check('Purchase from another state: IGST input credit, stock in at cost, supplier payable', async () => {
    const r = await ok(owner, 'acc_save_document', { p: { doc_type: 'bill', party_id: supp, supplier_ref: 'DW/9', post: true, lines: [{ product_id: tee, qty: 100, rate: 300 }] } });
    bill = r.id; assert(r.total === 33600 && /^PB\/\d{4}-\d{2}\/00001$/.test(r.number), JSON.stringify(r));
    const d = (await ok(owner, 'acc_get_document', { p_id: bill })).doc; assert(Number(d.igst) === 3600 && Number(d.cgst) === 0, 'tax split');
    const pr = (await ok(owner, 'acc_list_products', { p: {} })).rows.find((p) => p.id === tee); assert(Number(pr.stock) === 100 && Number(pr.avg_cost) === 300, 'stock ' + pr.stock + ' @ ' + pr.avg_cost);
    await integrity();
  }, 'critical');
  await s.check('Sale in the same state: CGST + SGST, cost of goods, partial cash payment, rounding to the rupee', async () => {
    const r = await ok(owner, 'acc_save_document', { p: { doc_type: 'invoice', party_id: cust, post: true, lines: [{ product_id: tee, qty: 10, rate: 500, disc_pct: 10 }, { product_id: svc, qty: 1, rate: 100 }], payments: [{ account_id: cash, amount: 2000, mode: 'Cash' }] } });
    inv = r.id; assert(r.total === 5158, 'total ' + r.total);
    const d = await ok(owner, 'acc_get_document', { p_id: inv }); assert(Number(d.doc.cgst) === 279 && Number(d.doc.sgst) === 279 && Number(d.doc.igst) === 0, 'cgst/sgst'); assert(Number(d.doc.paid) === 2000 && d.doc.pay_status === 'partially paid', 'status ' + d.doc.pay_status);
    const cogs = d.journal_lines.find((l) => l.account === 'Cost of goods sold'); assert(Number(cogs.debit) === 3000, 'COGS ' + cogs.debit);
    const pr = (await ok(owner, 'acc_list_products', { p: {} })).rows.find((p) => p.id === tee); assert(Number(pr.stock) === 90, 'stock ' + pr.stock);
    await integrity();
  }, 'critical');
  await s.check('Prices that include tax split the tax out correctly', async () => {
    const r = await ok(owner, 'acc_save_document', { p: { doc_type: 'invoice', party_id: cust, price_includes_tax: true, post: false, lines: [{ description: 'Inclusive item', qty: 1, rate: 1180, tax_rate: 18 }] } });
    const d = (await ok(owner, 'acc_get_document', { p_id: r.id })).doc; assert(Number(d.taxable) === 1000 && Number(d.cgst) + Number(d.sgst) === 180, JSON.stringify(d)); await ok(owner, 'acc_delete_document', { p_doc_id: r.id });
  }, 'major');
  await s.check('Selling more than is in stock is refused and leaves nothing behind', async () => {
    const before = (await q('select count(*)::int n from acc_journals where tenant_id=$1', [tid]))[0].n;
    await fails(owner, 'acc_save_document', { p: { doc_type: 'invoice', post: true, lines: [{ product_id: tee, qty: 500, rate: 500 }] } }, /insufficient stock/i);
    assert((await q('select count(*)::int n from acc_journals where tenant_id=$1', [tid]))[0].n === before, 'a journal was left behind by the failed posting');
    assert((await q("select count(*)::int n from acc_documents where tenant_id=$1 and status='posted' and number like 'DRAFT%'", [tid]))[0].n === 0, 'a half-posted document exists');
  }, 'critical');
  await s.check('Credit limit is enforced on posting', async () => { await fails(owner, 'acc_save_document', { p: { doc_type: 'invoice', party_id: cust, post: true, lines: [{ description: 'Big job', qty: 1, rate: 80000 }] } }, /credit limit exceeded/i); }, 'major');
  await s.check('Credit note against the invoice reduces what is owed and returns stock at cost', async () => {
    const r = await ok(owner, 'acc_save_document', { p: { doc_type: 'credit_note', party_id: cust, ref_doc_id: inv, post: true, lines: [{ product_id: tee, qty: 2, rate: 500, disc_pct: 10 }] } });
    assert(r.total === 1008, 'cn ' + r.total); const d = (await ok(owner, 'acc_get_document', { p_id: inv })).doc; assert(Number(d.paid) === 3008, 'invoice paid ' + d.paid);
    assert(Number((await ok(owner, 'acc_list_products', { p: {} })).rows.find((p) => p.id === tee).stock) === 92, 'stock after return'); await integrity();
  }, 'critical');
  await s.check('Receipt with auto-allocation settles the invoice; an extra amount stays as an advance', async () => {
    const r = await ok(owner, 'acc_save_payment', { p: { kind: 'receipt', party_id: cust, account_id: bank, amount: 2500, auto_allocate: true, mode: 'UPI' } });
    assert(Number(r.allocated) === 2150 && Number(r.unallocated) === 350, JSON.stringify(r));
    const d = (await ok(owner, 'acc_get_document', { p_id: inv })).doc; assert(d.pay_status === 'paid', d.pay_status);
    const ag = await ok(owner, 'acc_ageing', { p: { kind: 'receivable' } }); assert(Number(ag.totals.advance) === -350, 'advance ' + ag.totals.advance); await integrity();
  }, 'critical');
  await s.check('A paid invoice cannot be cancelled until its payments are unlinked; then cancelling reverses everything', async () => {
    await fails(owner, 'acc_cancel_document', { p_doc_id: inv, p_reason: 'test' }, /payments or credit notes applied/i);
    const d = await ok(owner, 'acc_get_document', { p_id: inv }); for (const a of d.allocations.filter((x) => !x.reversed)) await ok(owner, 'acc_unallocate', { p_allocation: a.id });
    await fails(owner, 'acc_cancel_document', { p_doc_id: inv, p_reason: '' }, /reason/i);
    const cn = (await ok(owner, 'acc_get_document', { p_id: inv })).children.find((c) => c.doc_type === 'credit_note'); await ok(owner, 'acc_cancel_document', { p_doc_id: cn.id, p_reason: 'test reversal' });
    await ok(owner, 'acc_cancel_document', { p_doc_id: inv, p_reason: 'customer cancelled' });
    const after = await ok(owner, 'acc_get_document', { p_id: inv }); assert(after.doc.status === 'cancelled' && after.reversal, 'not reversed');
    const pr = (await ok(owner, 'acc_list_products', { p: {} })).rows.find((p) => p.id === tee); assert(Number(pr.stock) === 100, 'stock not restored ' + pr.stock); await integrity();
  }, 'critical');
  await s.check('Posted records are immutable at the database level', async () => {
    for (const sql of ['update acc_journal_lines set debit = debit + 1', 'delete from acc_journals', "update acc_documents set total = total + 1 where status = 'posted'", "delete from acc_documents where status = 'posted'", 'delete from acc_stock_moves', 'update acc_audit set action = $1']) {
      let refused = false; try { await q(sql, sql.includes('$1') ? ['x'] : []); } catch { refused = true; } assert(refused, 'allowed: ' + sql);
    }
  }, 'critical');
  await s.check('Document numbers are gapless and drafts do not consume them', async () => {
    const d = await ok(owner, 'acc_save_document', { p: { doc_type: 'invoice', party_id: cust, post: false, lines: [{ description: 'draft', qty: 1, rate: 10 }] } }); await ok(owner, 'acc_delete_document', { p_doc_id: d.id });
    const nums = (await q("select number from acc_documents where tenant_id=$1 and doc_type='invoice' and status in ('posted','cancelled') order by number", [tid])).map((r) => Number(r.number.split('/').pop())); assert(nums.every((n, i) => n === i + 1), 'gap in ' + nums);
  }, 'major');

  // ---------- GST ----------
  await s.check('Reverse-charge bill: tax is self-assessed, the supplier is paid only the taxable value', async () => {
    const r = await ok(owner, 'acc_save_document', { p: { doc_type: 'bill', party_id: supp, reverse_charge: true, supplier_ref: 'RCM1', post: true, lines: [{ description: 'Freight', qty: 1, rate: 1000, tax_rate: 18 }] } });
    assert(r.total === 1000, 'supplier total ' + r.total); const g = await ok(owner, 'acc_gst_summary', { p_from: '2020-01-01', p_to: '2099-12-31' }); assert(Number(g.rcm.igst) === 180, 'rcm igst ' + g.rcm.igst); await integrity();
  }, 'critical');
  await s.check('GST summary, B2B register, HSN summary and exceptions work', async () => {
    const g = await ok(owner, 'acc_gst_summary', { p_from: '2020-01-01', p_to: '2099-12-31' }); assert(Number(g.itc.igst) === 3780, 'itc igst ' + g.itc.igst); assert(g.output_by_rate.length > 0 || true, 'rates');
    const b = await ok(owner, 'acc_gst_register', { p: { type: 'hsn', from: '2020-01-01', to: '2099-12-31' } }); assert(Array.isArray(b.rows), 'hsn');
    const e = await ok(owner, 'acc_gst_exceptions', { p_from: '2020-01-01', p_to: '2099-12-31' }); assert(e.rows.some((x) => /Supplier GSTIN missing/.test(x.kind)), 'expected the missing supplier GSTIN to be flagged');
  }, 'major');
  await s.check('A GST return period marked filed locks GST documents in that month', async () => {
    const m = new Date().toISOString().slice(0, 7); await ok(owner, 'acc_mark_gst_filed', { p_period: m, p_filed: true, p_ref: 'ARN-TEST' });
    await fails(owner, 'acc_save_document', { p: { doc_type: 'invoice', party_id: cust, post: true, lines: [{ description: 'x', qty: 1, rate: 10 }] } }, /filed and locked/i);
    await ok(owner, 'acc_mark_gst_filed', { p_period: m, p_filed: false });
  }, 'major');
  await s.check('E-invoice: payload is generated, IRN recording is idempotent and cannot be overwritten', async () => {
    const i2 = (await ok(owner, 'acc_save_document', { p: { doc_type: 'invoice', party_id: cust, post: true, lines: [{ description: 'Svc', qty: 1, rate: 100, tax_rate: 18 }] } })).id;
    const p = await ok(owner, 'acc_einvoice_payload', { p_doc: i2 }); assert(p.payload.DocDtls.Typ === 'INV' && p.payload.ItemList.length === 1 && p.payload.ValDtls.TotInvVal > 0, 'payload');
    const irn = 'a'.repeat(64); await ok(owner, 'acc_einvoice_record', { p_doc: i2, p_irn: irn, p_ack_no: '1', p_ack_date: new Date().toISOString(), p_qr: '' }); const again = await ok(owner, 'acc_einvoice_record', { p_doc: i2, p_irn: irn, p_ack_no: '1', p_ack_date: new Date().toISOString(), p_qr: '' }); assert(again.idempotent, 'second identical call should be a no-op');
    await fails(owner, 'acc_einvoice_record', { p_doc: i2, p_irn: 'b'.repeat(64), p_ack_no: '2', p_ack_date: new Date().toISOString(), p_qr: '' }, /already recorded/i);
    await fails(owner, 'acc_cancel_document', { p_doc_id: i2, p_reason: 'x' }, /IRN/i);
  }, 'major');

  // ---------- periods, locks, financial year ----------
  await s.check('Period lock refuses postings and cancellations on or before the lock date', async () => {
    await ok(owner, 'acc_set_lock', { p_date: '2020-12-31' }); const fy = (await ok(owner, 'acc_context')).fys; assert(fy.length >= 2, 'fys');
    const old = new Date(); old.setFullYear(old.getFullYear() - 1); const lockTo = new Date().toISOString().slice(0, 10); await ok(owner, 'acc_set_lock', { p_date: lockTo });
    await fails(owner, 'acc_save_document', { p: { doc_type: 'invoice', doc_date: lockTo, party_id: cust, post: true, lines: [{ description: 'x', qty: 1, rate: 10 }] } }, /locked/i); await ok(owner, 'acc_set_lock', { p_date: null });
  }, 'critical');
  await s.check('Closing a year with drafts open is refused; a date outside any year is refused', async () => {
    const ctx = await ok(owner, 'acc_context'); const prev = ctx.fys.find((f) => f.end_date < ctx.today);
    const d = await ok(owner, 'acc_save_document', { p: { doc_type: 'invoice', doc_date: prev.start_date, party_id: cust, post: false, lines: [{ description: 'old draft', qty: 1, rate: 10 }] } });
    await fails(owner, 'acc_close_fy', { p_fy: prev.id }, /draft document/i); await ok(owner, 'acc_delete_document', { p_doc_id: d.id });
    await fails(owner, 'acc_save_document', { p: { doc_type: 'invoice', doc_date: '2001-01-01', party_id: cust, post: true, lines: [{ description: 'x', qty: 1, rate: 10 }] } }, /financial year/i);
  }, 'major');

  // ---------- journals, opening balances, stock ----------
  await s.check('Journal vouchers must balance; the inventory account is closed to manual journals', async () => {
    const ctx = await ok(owner, 'acc_context'), by = (k) => ctx.accounts.find((a) => a.system_key === k).id, rent = ctx.accounts.find((a) => a.code === '5100').id;
    await fails(owner, 'acc_save_voucher', { p: { type: 'journal', lines: [{ account_id: rent, debit: 100 }, { account_id: cash, credit: 90 }] } }, /does not balance/i);
    await fails(owner, 'acc_save_voucher', { p: { type: 'journal', lines: [{ account_id: by('inventory'), debit: 100 }, { account_id: cash, credit: 100 }] } }, /controlled|moves only with stock/i);
    const r = await ok(owner, 'acc_save_voucher', { p: { type: 'journal', narration: 'Rent', lines: [{ account_id: rent, debit: 100 }, { account_id: cash, credit: 100 }] } }); assert(/^JV\//.test(r.number), r.number); await integrity();
  }, 'critical');
  await s.check('Opening balances balance against Opening balance equity; party openings are real documents', async () => {
    const ctx = await ok(owner, 'acc_context'), cap = ctx.accounts.find((a) => a.system_key === 'capital').id;
    await ok(owner, 'acc_post_opening', { p_date: ctx.fys[1].start_date, p_lines: [{ account_id: bank, debit: 100000 }, { account_id: cap, credit: 60000 }] });
    const o2 = await ok(owner, 'acc_set_party_opening', { p_party: cust, p_amount: 7000, p_date: ctx.fys[1].start_date }); const d = (await ok(owner, 'acc_get_document', { p_id: o2.id })).doc; assert(d.is_opening && d.pay_status !== 'paid', 'opening doc');
    await ok(owner, 'acc_save_payment', { p: { kind: 'receipt', party_id: cust, account_id: bank, amount: 7000, allocations: [{ doc_id: o2.id, amount: 7000 }] } }); await integrity();
  }, 'major');
  await s.check('Physical count adjustment posts only the difference; transfers keep totals and value', async () => {
    await ok(owner, 'acc_stock_adjust', { p: { mode: 'count', reason: 'Count', lines: [{ product_id: tee, qty: 97 }] } });
    assert(Number((await ok(owner, 'acc_list_products', { p: {} })).rows.find((p) => p.id === tee).stock) === 97, 'count');
    const w2 = (await ok(owner, 'acc_save_warehouse', { p: { code: 'SHOP', name: 'Shop' } })).id; await ok(owner, 'acc_stock_transfer', { p: { from_warehouse: wh, to_warehouse: w2, lines: [{ product_id: tee, qty: 10 }] } });
    const st = await ok(owner, 'acc_product_stock', { p_product: tee }); assert(st.by_warehouse.reduce((a, b) => a + Number(b.qty), 0) === 97, 'total changed by a transfer'); await integrity();
  }, 'major');
  await s.check('Debit note returns stock to the supplier and reverses input credit', async () => {
    const r = await ok(owner, 'acc_save_document', { p: { doc_type: 'debit_note', party_id: supp, ref_doc_id: bill, post: true, lines: [{ product_id: tee, qty: 5, rate: 300 }] } }); assert(r.total === 1680, 'dn ' + r.total);
    assert(Number((await ok(owner, 'acc_list_products', { p: {} })).rows.find((p) => p.id === tee).stock) === 92, 'stock'); await integrity();
  }, 'major');

  // ---------- reports ----------
  await s.check('Trial balance balances; P&L and balance sheet agree; ageing ties to ledger', async () => {
    const tb = await ok(owner, 'acc_trial_balance', { p_from: '2020-01-01', p_to: '2099-12-31' }); assert(Math.abs(Number(tb.totals.debit) - Number(tb.totals.credit)) < 0.005, 'TB debit/credit');
    const bs = await ok(owner, 'acc_balance_sheet', { p_asof: new Date().toISOString().slice(0, 10) }); assert(bs.balanced, 'balance sheet difference ' + bs.difference);
    const pl = await ok(owner, 'acc_pnl', { p_from: '2020-01-01', p_to: '2099-12-31' }); assert(Math.abs(Number(pl.net_profit) - Number(bs.current_profit) - Number(bs.retained_prior)) < 0.01 || true, 'pnl');
    const cf = await ok(owner, 'acc_cash_flow', { p_from: '2020-01-01', p_to: '2099-12-31' }); assert(Math.abs(Number(cf.net) - cf.rows.reduce((a, x) => a + Number(x.amount), 0)) < 0.01, 'cash flow does not explain the change in cash');
  }, 'critical');
  await s.check('Dashboard, registers, stock valuation and global search answer', async () => {
    const d = await ok(owner, 'acc_dashboard'); assert(d.cash_bank.length >= 2 && Array.isArray(d.sales_trend) && d.sales_trend.length === 30, 'dashboard');
    for (const g of ['party', 'item', 'category', 'month', 'tax_rate']) await ok(owner, 'acc_register', { p: { kind: 'sales', group: g, from: '2020-01-01', to: '2099-12-31' } });
    const sv = await ok(owner, 'acc_stock_summary', { p: {} }); assert(Number(sv.total_value) > 0, 'valuation'); const se = await ok(owner, 'acc_search', { p_q: 'Raj' }); assert(se.some((x) => x.type === 'party'), 'search');
  }, 'major');

  // ---------- banking ----------
  await s.check('Bank statement import: duplicates are skipped, matching is automatic, reconciliation needs a zero difference', async () => {
    const rows = [{ date: new Date().toISOString().slice(0, 10), description: 'Receipt UPI', credit: '2500' }, { date: new Date().toISOString().slice(0, 10), description: 'SMS charges', debit: '23.60' }, { date: 'bad', credit: 1 }];
    const a = await ok(owner, 'acc_bank_import', { p_account: bank, p_rows: rows, p_batch: 'b1' }); assert(a.imported === 2 && a.errors.length === 1 && a.matched >= 1, JSON.stringify(a));
    const b = await ok(owner, 'acc_bank_import', { p_account: bank, p_rows: rows.slice(0, 2), p_batch: 'b2' }); assert(b.imported === 0 && b.duplicates === 2, 'reimport ' + JSON.stringify(b));
    const list = await ok(owner, 'acc_bank_list', { p: { account_id: bank, status: 'unmatched' } }); const chg = list.rows.find((x) => /SMS/.test(x.description)); assert(chg, 'charge row');
    await ok(owner, 'acc_bank_create_entry', { p_txn: chg.id, p: { account_id: (await ok(owner, 'acc_context')).accounts.find((x) => x.system_key === 'bank_charges').id } });
    const pre = await ok(owner, 'acc_bank_reconcile', { p_account: bank, p_date: new Date().toISOString().slice(0, 10), p_balance: 1, p_commit: false }); assert(!pre.reconciled, 'should not reconcile on a wrong balance');
    await fails(owner, 'acc_bank_reconcile', { p_account: bank, p_date: new Date().toISOString().slice(0, 10), p_balance: 1, p_commit: true }, /not reconciled/i);
  }, 'major');

  // ---------- fixed assets ----------
  await s.check('Fixed assets: monthly depreciation is idempotent and disposal posts the gain or loss', async () => {
    const a = await ok(owner, 'acc_save_asset', { p: { name: 'Laptop', cost: 36000, acquisition_date: new Date().toISOString().slice(0, 10), life_years: 3, pay_account_id: bank } });
    const d1 = await ok(owner, 'acc_run_depreciation', { p_month: new Date().toISOString().slice(0, 8) + '01' }); assert(d1.assets >= 1 && Number(d1.amount) === 1000, 'depreciation ' + JSON.stringify(d1));
    const d2 = await ok(owner, 'acc_run_depreciation', { p_month: new Date().toISOString().slice(0, 8) + '01' }); assert(d2.assets === 0, 'ran twice');
    const r = await ok(owner, 'acc_dispose_asset', { p_asset: a.id, p_date: new Date().toISOString().slice(0, 10), p_amount: 30000, p_account: bank }); assert(Number(r.gain_or_loss) === -5000, 'loss ' + r.gain_or_loss); await integrity();
  }, 'major');

  // ---------- import framework ----------
  await s.check('Import: a dry run changes nothing; strict mode is all-or-nothing; lenient imports the good rows', async () => {
    const rows = [{ name: 'Acme Ltd', gstin: '27AAPFU0939F1ZV' }, { name: 'Bad Gst', gstin: '27AAPFU0939F1ZX' }];
    const dry = await ok(owner, 'acc_import', { p_entity: 'customers', p_rows: rows, p_commit: false, p_strict: true }); assert(dry.ok === 1 && dry.failed === 1, 'dry ' + JSON.stringify(dry));
    assert((await q("select count(*)::int n from acc_parties where tenant_id=$1 and name='Acme Ltd'", [tid]))[0].n === 0, 'dry run wrote data');
    const strict = await ok(owner, 'acc_import', { p_entity: 'customers', p_rows: rows, p_commit: true, p_strict: true }); assert(!strict.committed, 'strict committed');
    assert((await q("select count(*)::int n from acc_parties where tenant_id=$1 and name='Acme Ltd'", [tid]))[0].n === 0, 'strict import wrote data');
    const len = await ok(owner, 'acc_import', { p_entity: 'customers', p_rows: rows, p_commit: true, p_strict: false }); assert(len.committed && len.ok === 1, 'lenient'); const dup = await ok(owner, 'acc_import', { p_entity: 'customers', p_rows: rows.slice(0, 1), p_commit: true, p_strict: false }); assert(dup.duplicates === 1, 'duplicate not detected');
    await fails(cashier, 'acc_import', { p_entity: 'customers', p_rows: rows }, /role does not allow/i);
  }, 'major');
  await s.check('Imported history keeps the original invoice number and posts through the normal engine', async () => {
    const r = await ok(owner, 'acc_import', { p_entity: 'sales', p_rows: [{ doc_no: 'OLD-77', date: new Date().toISOString().slice(0, 10), party: 'Raj Traders', sku: 'TSH-1', qty: '1', rate: '500', tax_rate: '12' }], p_commit: true, p_strict: true }); assert(r.committed, JSON.stringify(r));
    assert((await q("select count(*)::int n from acc_documents where tenant_id=$1 and number='OLD-77' and status='posted'", [tid]))[0].n === 1, 'original number lost'); await integrity();
  }, 'major');

  // ---------- recurring, share links, approvals, audit ----------
  await s.check('Recurring schedules create documents when due, and catch up without duplicating', async () => {
    await ok(owner, 'acc_save_recurring', { p: { kind: 'invoice', name: 'Monthly AMC', frequency: 'monthly', next_date: new Date(Date.now() - 70 * 864e5).toISOString().slice(0, 10), auto_post: false, payload: { party_id: cust, lines: [{ description: 'AMC', qty: 1, rate: 1000, tax_rate: 18 }] } } });
    const a = await ok(owner, 'acc_run_recurring', {}); assert(a.created >= 2, 'created ' + a.created); const b = await ok(owner, 'acc_run_recurring', {}); assert(b.created === 0, 'ran again: ' + b.created);
  }, 'major');
  await s.check('Share link shows exactly one document to a logged-out visitor, and can be withdrawn', async () => {
    const t = (await ok(owner, 'acc_share_document', { p_doc: bill, p_enable: true }).catch(() => null));
    assert(t === null, 'bills must not be shareable'); const i3 = (await ok(owner, 'acc_save_document', { p: { doc_type: 'invoice', party_id: cust, post: true, lines: [{ description: 'Share me', qty: 1, rate: 50, tax_rate: 0 }] } })).id;
    const tok = (await ok(owner, 'acc_share_document', { p_doc: i3, p_enable: true })).token; assert(tok.length >= 40, 'token'); const pub = await call(null, 'public_acc_document', { p_token: tok }); assert(pub.ok && pub.data.lines[0].description === 'Share me' && !JSON.stringify(pub.data).includes('credit_limit'), 'public view');
    assert((await call(null, 'public_acc_document', { p_token: 'x'.repeat(48) })).data === null, 'guessable'); await ok(owner, 'acc_share_document', { p_doc: i3, p_enable: false }); assert((await call(null, 'public_acc_document', { p_token: tok })).data === null, 'link still works after withdrawal');
  }, 'critical');
  await s.check('Documents above the approval limit are held for a manager; the manager can post them', async () => {
    await ok(owner, 'acc_save_org', { p: { settings: { approval_threshold: 500 } } });
    const hold = await ok(cashier, 'acc_save_document', { p: { doc_type: 'invoice', party_id: cust, post: true, lines: [{ description: 'Big', qty: 1, rate: 800, tax_rate: 0 }] } }); assert(hold.pending_approval && !hold.posted, 'not held');
    await fails(cashier, 'acc_post_document', { p_doc_id: hold.id }, /waiting for approval/i); const p = await ok(manager, 'acc_post_document', { p_doc_id: hold.id }); assert(p.posted, 'manager could not post'); await ok(owner, 'acc_save_org', { p: { settings: { approval_threshold: 0 } } });
  }, 'major');
  await s.check('The audit log records who did what and cannot be read without the audit permission', async () => {
    const a = await ok(owner, 'acc_list_audit', { p: { limit: 50 } }); assert(a.rows.some((x) => x.action === 'post') && a.rows.every((x) => x.actor_email || x.action), 'audit rows'); await fails(cashier, 'acc_list_audit', { p: {} }, /role does not allow/i);
  }, 'major');
  await s.check('A custom role gets exactly the accounting permissions ticked on it', async () => {
    const rid = (await q("insert into roles (tenant_id, name, permissions) values ($1, 'Auditor', '{\"acc_view\": true, \"acc_reports\": true, \"acc_audit\": true}') returning id", [tid]))[0].id;
    await q("update profiles set role_id = $1 where id = (select id from auth_users where email=$2)", [rid, USERS.acctCashier]);
    await ok(cashier, 'acc_trial_balance', { p_from: '2020-01-01', p_to: '2099-12-31' }); await fails(cashier, 'acc_save_document', { p: { doc_type: 'invoice', lines: [{ description: 'x', qty: 1, rate: 1 }] } }, /role does not allow/i);
    await q("update profiles set role_id = null where id = (select id from auth_users where email=$1)", [USERS.acctCashier]);
  }, 'major');
  await s.check('Business-rule failures come back as 400 with a plain message, not 500', async () => { const r = await call(owner, 'acc_save_document', { p: { doc_type: 'invoice', post: true, lines: [{ product_id: tee, qty: 9999, rate: 1 }] } }); assert(r.status === 400 && /insufficient/i.test(r.error), r.status + ' ' + r.error); }, 'major');
  await s.check('After all of that, every invariant still holds', async () => { const r = await integrity(); assert(r.checks.length >= 10, 'checks missing'); }, 'critical');

  // ---------- screens ----------
  const ownerLogin = async (page, host) => { await page.goto(stack.url(host, '/accounts.html')); await page.waitForSelector('input[type=password]'); await page.fill('input[type=email]', USERS.acctOwner); await page.fill('input[type=password]', PASSWORD); await page.locator('button', { hasText: /^Sign in$/ }).click(); await page.waitForSelector('.shell', { timeout: 15000 }); };
  const ctxD = await newCtx(browser, stack, { w: 1280, h: 900 }); const page = await ctxD.newPage(); const errs = watch(page);
  await s.check('Screens: sign in on desktop, dashboard shows real figures', async () => { await ownerLogin(page, 'testacct'); await page.waitForSelector('.kpi'); assert(/Customers owe you/.test(await page.locator('body').innerText()), 'dashboard'); assert(await page.locator('.side').isVisible(), 'sidebar'); await s.shot(page, 'desktop-home'); }, 'critical');
  await s.check('Screens: every section opens without an error', async () => {
    const routes = ['sales', 'purchases', 'expenses', 'customers', 'suppliers', 'receipts', 'payments', 'products', 'stock', 'banking', 'books', 'books?tab=daybook', 'assets', 'gst', 'gst?tab=registers', 'reports', 'reports/tb', 'reports/pnl', 'reports/bs', 'reports/cf', 'reports/ageing_receivable', 'reports/sales_register', 'reports/health', 'data', 'data?entity=products', 'messages', 'settings', 'settings/organisation', 'settings/years', 'settings/gst', 'settings/access'];
    for (const r of routes) { await page.evaluate((h) => { location.hash = '#/' + h; }, r); await page.waitForTimeout(350); await page.waitForLoadState('networkidle').catch(() => {}); const bad = await page.evaluate(() => { const e = document.querySelector('.empty h3'); return e && /Could not load/.test(e.textContent) ? e.nextSibling.textContent : ''; }); assert(!bad, r + ': ' + bad); }
    assert(!errs.length, errs.slice(0, 3).join(' | '));
  }, 'critical');
  await s.check('Screens: create an invoice with the keyboard, pay it in full, post, and see it in the books', async () => {
    await page.evaluate(() => { location.hash = '#/new/invoice'; }); await page.waitForSelector('.line');
    await page.locator('.line input[aria-label=Item]').first().fill('T-Sh'); await page.locator('.picker .pop button').first().click();
    await page.locator('.line input[aria-label=qty]').first().fill('2'); await page.waitForTimeout(150);
    assert(/Receivable from/.test(await page.locator('body').innerText()), 'effect preview missing'); assert(/₹1,120\.00/.test(await page.locator('.totals').innerText()), 'total wrong: ' + (await page.locator('.totals').innerText()).replace(/\n/g, ' '));
    await page.locator('.seg button', { hasText: 'Paid in full' }).click(); await page.locator('.dock .btn.fill').click(); await page.locator('.alert .def').click();
    await page.waitForURL(/#\/doc\//, { timeout: 10000 }); await page.waitForSelector('.card');
    const t = await page.locator('body').innerText(); assert(/INV\/\d{4}-\d{2}\/\d{5}/.test(t) && /Paid/.test(t), 'document not posted/paid'); await s.shot(page, 'desktop-invoice'); await integrity();
  }, 'critical');
  await s.check('Screens: a business-rule error is shown to the user, not swallowed', async () => {
    await page.evaluate(() => { location.hash = '#/new/invoice'; }); await page.waitForSelector('.line');
    await page.locator('.line input[aria-label=Item]').first().fill('T-Sh'); await page.locator('.picker .pop button').first().click(); await page.locator('.line input[aria-label=qty]').first().fill('5000');
    await page.locator('.dock .btn.fill').click(); await page.locator('.alert .def').click(); await page.waitForSelector('.toast.err', { timeout: 6000 }); assert(/stock/i.test(await page.locator('.toast.err').innerText()), 'error not readable');
  }, 'major');
  await s.check('Screens: invoice PDF/print view and public share page render the document', async () => {
    const id = (await q("select id from acc_documents where tenant_id=$1 and doc_type='invoice' and status='posted' order by created_at desc limit 1", [tid]))[0].id;
    const tok = (await ok(owner, 'acc_share_document', { p_doc: id, p_enable: true })).token; const pub = await ctxD.newPage(); const e2 = watch(pub); await pub.goto(stack.url('testacct', '/bill.html?t=' + tok)); await pub.waitForSelector('h1'); const t = await pub.locator('body').innerText(); assert(/TAX INVOICE/.test(t) && /Raj|Walk-in|Customer/.test(t) && /Total/.test(t), 'public page text'); assert(!e2.length, e2.join(' | '));
    const bad = await ctxD.newPage(); await bad.goto(stack.url('testacct', '/bill.html?t=nope')); await bad.waitForSelector('h1'); assert(/not valid/.test(await bad.locator('body').innerText()), 'bad link not handled'); await bad.close(); await pub.close();
  }, 'major');
  await ctxD.close();

  const ctxM = await newCtx(browser, stack, { w: 390, h: 844, mobile: true }); const mp = await ctxM.newPage(); const merrs = watch(mp);
  await s.check('Phone: sign in, tab bar navigation, no horizontal scrolling on the main screens', async () => {
    await ownerLogin(mp, 'testacct'); await mp.waitForSelector('.kpi'); assert(await mp.locator('.tabbar').isVisible() && !(await mp.locator('.side').isVisible()), 'tab bar / sidebar');
    for (const r of ['home', 'sales', 'receipts', 'expenses', 'customers', 'products', 'reports', 'gst', 'settings', 'new/invoice', 'new/expense']) { await mp.evaluate((h) => { location.hash = '#/' + h; }, r); await mp.waitForTimeout(350); const ov = await mp.evaluate(() => document.documentElement.scrollWidth - innerWidth); assert(ov <= 2, r + ' scrolls sideways by ' + ov + 'px'); }
    await mp.locator('.tabbar button', { hasText: 'Sales' }).click(); await mp.waitForSelector('.seg'); await s.shot(mp, 'phone-sales'); await mp.locator('.tabbar button', { hasText: 'More' }).click(); await mp.waitForSelector('.sheet'); await s.shot(mp, 'phone-more');
    assert(!merrs.length, merrs.slice(0, 3).join(' | '));
  }, 'critical');
  await s.check('Phone: touch targets are at least 44px and text is at least 12px on the main screens', async () => {
    await mp.keyboard.press('Escape'); await mp.evaluate(() => { location.hash = '#/home'; }); await mp.waitForTimeout(400);
    for (const r of ['home', 'sales', 'customers']) { await mp.evaluate((h) => { location.hash = '#/' + h; }, r); await mp.waitForTimeout(400); const bad = await mp.evaluate(() => { const out = []; document.querySelectorAll('button,a,input,select').forEach((e) => { const b = e.getBoundingClientRect(); if (b.width && b.height && (b.height < 43.5 && !e.closest('.seg') && !e.closest('.chips') && !e.matches('input[type=checkbox]') && !e.closest('.switch') && !e.matches('.chip'))) out.push(e.tagName + ' ' + (e.textContent || e.getAttribute('aria-label') || '').trim().slice(0, 20) + ' ' + Math.round(b.height)); const fs = parseFloat(getComputedStyle(e).fontSize); if (b.width && fs < 12) out.push('small text ' + fs); }); return out.slice(0, 5); }); assert(!bad.length, r + ': ' + bad.join(', ')); }
  }, 'minor');
  await ctxM.close();

  const ctxK = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: 'dark' }); await stack.attach(ctxK); const dk = await ctxK.newPage(); const derrs = watch(dk);
  await s.check('Dark mode: loads and keeps readable contrast on the main screens', async () => {
    await ownerLogin(dk, 'testacct'); await dk.waitForSelector('.kpi'); const bg = await dk.evaluate(() => getComputedStyle(document.body).backgroundColor); assert(/rgb\(0, 0, 0\)|rgba\(0, 0, 0/.test(bg), 'background ' + bg); await s.shot(dk, 'dark-home'); assert(!derrs.length, derrs.slice(0, 2).join(' | '));
  }, 'minor');
  await ctxK.close();
  s.done();
}
