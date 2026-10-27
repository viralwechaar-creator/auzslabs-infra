/* Reports & analytics: a dashboard and report pages built on the acc_rep_* functions (all figures are calculated on the server from the posted books).
   Route: #/analytics (dashboard) and #/analytics/<report>. Existing reports stay on #/reports. */
'use strict';
const RA_PRESETS = [['today', 'Today'], ['yesterday', 'Yesterday'], ['week', 'This week'], ['month', 'This month'], ['lastmonth', 'Last month'], ['quarter', 'This quarter'], ['fy', 'This year'], ['lastfy', 'Last year'], ['custom', 'Custom']];
function raRange(k, q) {
  const t = today(), fy = curFY(), ms = monthStart();
  if (k === 'today') return [t, t];
  if (k === 'yesterday') return [addDays(t, -1), addDays(t, -1)];
  if (k === 'week') { const d = parseD(t), off = (d.getDay() + 6) % 7; return [addDays(t, -off), t]; }
  if (k === 'lastmonth') return [monthStart(addDays(ms, -1)), addDays(ms, -1)];
  if (k === 'quarter') { let s = parseD(fy.start_date); while (true) { const n = new Date(s.getFullYear(), s.getMonth() + 3, 1); if (isoDate(n) > t) break; s = n; } return [isoDate(s), t]; }
  if (k === 'fy') return [fy.start_date, t];
  if (k === 'lastfy') { const p = S.fys.find((f) => f.end_date < fy.start_date); return p ? [p.start_date, p.end_date] : [fy.start_date, t]; }
  if (k === 'custom') return [q.get('from') || fy.start_date, q.get('to') || t];
  return [ms, t];
}
// Reads the filters from the address, draws the filter bar, and returns the current filters.
function raFilters(v, path, o = {}) {
  const preset = v.q.get('p') || o.preset || 'month', [from, to] = raRange(preset, v.q), branch = v.q.get('b') || '';
  const cur = { p: preset, from, to, b: branch };
  const keep = o.keep || [];
  const nav = (ch) => { const n = { ...cur, ...ch }; keep.forEach((k) => { if (v.q.get(k) && !(k in ch)) n[k] = v.q.get(k); }); if (n.p !== 'custom') { delete n.from; delete n.to; } if (!n.b) delete n.b;
    go(path + '?' + Object.entries(n).filter(([, x]) => x !== '' && x != null).map(([k, x]) => k + '=' + encodeURIComponent(x)).join('&')); };
  const fe = dateInput(from), te = dateInput(to);
  fe.onchange = () => nav({ p: 'custom', from: fe.value, to: te.value }); te.onchange = () => nav({ p: 'custom', from: fe.value, to: te.value });
  const bar = h('div', { class: 'grid', style: { gap: '10px' } },
    o.noPeriod ? null : chips(RA_PRESETS, preset, (k) => nav({ p: k, from: undefined, to: undefined })),
    h('div', { class: 'ra-bar' },
      o.noPeriod ? null : h('div', { class: 'grow' }, field('From', fe)), o.noPeriod ? null : h('div', { class: 'grow' }, field('To', te)),
      S.branches.length && !o.noBranch ? h('div', { class: 'grow' }, field('Branch', selectEl([['', 'All branches'], ...S.branches.map((b) => [b.id, b.name])], branch, { label: 'Branch', onchange: (e) => nav({ b: e.target.value }) }))) : null,
      h('button', { class: 'btn', type: 'button', onclick: () => v.refresh() }, icon('refresh', 16), 'Refresh'),
      h('button', { class: 'btn', type: 'button', onclick: () => go(path) }, 'Reset')));
  return { f: cur, bar, nav, label: fmtD(from) + ' to ' + fmtD(to) + (branch ? ' · ' + ((S.branches.find((b) => b.id === branch) || {}).name || 'branch') : '') };
}
// native append() prints null/arrays as text: flatten and drop empties first
function raPut(host, ...nodes) { clear(host); const flat = (a) => a.flatMap((x) => (Array.isArray(x) ? flat(x) : [x])).filter((x) => x != null && x !== false); host.append(...flat(nodes)); return host; }
const raP = (f, x = {}) => ({ from: f.from, to: f.to, ...(f.b ? { branch_id: f.b } : {}), ...x });
const raCall = (fn, p) => api(fn, { p });
// saved views: remembered filter sets per report
async function raViews(v, id, f, apply) {
  const wrap = h('div', { class: 'row wrap' });
  const load = async () => {
    const r = await api('acc_list_views', { p_scope: 'analytics:' + id }).catch(() => ({ rows: [] }));
    clear(wrap).append(h('button', { class: 'btn', type: 'button', onclick: async () => { const n = prompt('Name this view'); if (!n) return; try { await api('acc_save_view', { p: { scope: 'analytics:' + id, name: n, filters: f } }); toast('View saved'); load(); } catch (e) { toast(e.message); } } }, icon('file', 16), 'Save view'),
      ...(r.rows || []).map((x) => h('span', { class: 'chip' }, h('button', { type: 'button', class: 'linkbtn', onclick: () => apply(x.filters) }, x.name), h('button', { type: 'button', class: 'linkbtn', 'aria-label': 'Delete view ' + x.name, onclick: async () => { await api('acc_delete_view', { p_id: x.id }); load(); } }, '×'))));
  };
  await load(); return wrap;
}
const raCols = (arr) => arr.map((c, i) => ({ key: c.key, label: c.label, r: !!c.r, title: i === 0, sub: i === 1, value: !!c.value, badge: !!c.badge, hideMobile: i > 3 && !c.value, render: c.render || ((x) => (c.m ? money(x[c.key]) : x[c.key] ?? '')) }));
const raTone = { paid: 'green', partial: 'orange', unpaid: 'blue', overdue: 'red', cancelled: '', draft: '' };

// ---------- dashboard ----------
page('analytics', {
  title: 'Reports and analytics', icon: 'chart', perm: 'acc_reports',
  async render(v) {
    const id = v.args[0];
    if (id) return raReport(v, id);
    v.header({ title: 'Reports and analytics' });
    const F = raFilters(v, 'analytics', { preset: 'month' }), f = F.f;
    v.root.append(F.bar);
    const host = h('div', { class: 'grid' }, h('div', { class: 'muted' }, 'Loading...')); v.root.append(host);
    let d; try { d = await raCall('acc_rep_dashboard', raP(f)); } catch (e) { raPut(host, empty('alert', 'Could not load', e.message)); return; }
    if (!host.isConnected) return;
    const link = (rep, extra) => () => go('analytics/' + rep + '?p=' + f.p + (f.p === 'custom' ? '&from=' + f.from + '&to=' + f.to : '') + (f.b ? '&b=' + f.b : '') + (extra || ''));
    const months = d.months.map((m) => ({ ...m, label: m.label }));
    const eff = d.collection_efficiency;
    raPut(host, 
      h('div', { class: 'ra-bar' }, h('div', { class: 'muted grow' }, F.label), h('button', { class: 'btn', type: 'button', onclick: (e) => raExportDash(e.currentTarget, d, F.label) }, icon('download', 16), 'Export')),
      h('div', { class: 'ra-grid kpis' },
        kpi('Receivables', money(d.receivable), 'Customers owe you', link('customers', '&filter=outstanding')), kpi('Payables', money(d.payable), 'You owe suppliers', link('suppliers', '&filter=outstanding')),
        kpi('Cash in hand', money(d.cash), 'As on ' + fmtD(f.to), () => go('reports/cashbook')), kpi('Bank balance', money(d.bank), 'All bank accounts', () => go('reports/bankbook')),
        kpi('Income', money(d.income), 'This period', link('income')), kpi('Expenses', money(d.expense), 'This period', link('expense')),
        kpi('Net profit', money(d.net_profit), 'Income less expenses (not cash)', () => go('reports/pnl?from=' + f.from + '&to=' + f.to), Number(d.net_profit) < 0 ? 'red' : 'green'),
        kpi('Overdue from customers', money(d.receivable_overdue), 'Past due date', link('due', '&kind=receivable&bucket=overdue'), Number(d.receivable_overdue) > 0 ? 'red' : ''),
        kpi('Overdue to suppliers', money(d.payable_overdue), 'Past due date', link('due', '&kind=payable&bucket=overdue')),
        kpi('Collected', money(d.collected), eff != null ? 'Collection efficiency ' + eff + '%' : 'Received in cash or bank', link('collection')),
        kpi('Pending payments', String(d.pending_bills), inr(d.pending_bill_amount) + ' in bills to pay', link('docs', '&kind=purchase&status=unpaid'))),
      Number(d.receivable_overdue) > 0 ? h('div', { class: 'banner bad' }, icon('alert', 18), h('span', null, money(d.receivable_overdue), ' from customers is overdue. '), h('button', { class: 'linkbtn', type: 'button', onclick: link('due', '&kind=receivable&bucket=overdue') }, 'See who')) : null,
      h('div', { class: 'ra-two' },
        raCard('Income and expenses by month', multiChart(months, [{ key: 'income', label: 'Income' }, { key: 'expense', label: 'Expenses' }], { mode: 'group', label: 'Income vs expenses' })),
        raCard('Profit by month', multiChart(months, [{ key: 'profit', label: 'Net profit' }], { mode: 'line', label: 'Profit trend' })),
        raCard('Cash inflow and outflow', multiChart(months, [{ key: 'inflow', label: 'Inflow' }, { key: 'outflow', label: 'Outflow' }], { mode: 'stack', label: 'Cash movement' })),
        raCard('Receivables and payables', barChart([{ label: 'Receivable', value: Math.max(Number(d.receivable), 0), value2: 0 }, { label: 'Payable', value: Math.max(Number(d.payable), 0), value2: 0 }], { label: 'Receivables vs payables' })),
        raCard('Receivable ageing', raAgeBars(d.ageing_receivable)), raCard('Payable ageing', raAgeBars(d.ageing_payable)),
        raCard('Expense categories', donutChart(d.expense_categories.map((x) => ({ label: x.name, value: x.amount })), { label: 'Expense categories', onclick: () => link('expense')() })),
        raCard('Income categories', donutChart(d.income_categories.map((x) => ({ label: x.name, value: x.amount })), { label: 'Income categories', onclick: () => link('income')() })),
        raCard('Collections by payment method', donutChart(d.payment_modes.map((x) => ({ label: x.mode, value: x.amount })), { label: 'Payment methods', onclick: () => link('paymode')() })),
        raCard('Invoice status', donutChart(Object.entries(d.invoice_status).map(([k, n]) => ({ label: cap1(k), value: n })), { label: 'Invoice status', center: String(Object.values(d.invoice_status).reduce((a, n) => a + Number(n), 0)), onclick: (it) => link('docs', '&kind=sales&status=' + it.label.toLowerCase())() })),
        raCard('Collections by day', multiChart(d.collection_daily.map((x) => ({ label: x.d.slice(5), billed: x.billed, collected: x.collected })), [{ key: 'billed', label: 'Billed' }, { key: 'collected', label: 'Collected' }], { mode: 'line', label: 'Collection trend' })),
        raCard('Top customers by outstanding', d.top_customers.length ? hbars(d.top_customers.map((x) => ({ label: x.name, value: Number(x.total) }))) : h('div', { class: 'muted' }, 'Nothing outstanding')),
        raCard('Top suppliers by outstanding', d.top_suppliers.length ? hbars(d.top_suppliers.map((x) => ({ label: x.name, value: Number(x.total) }))) : h('div', { class: 'muted' }, 'Nothing outstanding')),
        raCard('Largest expense categories', d.expense_categories.length ? hbars(d.expense_categories.map((x) => ({ label: x.name, value: Number(x.amount) }))) : h('div', { class: 'muted' }, 'No expenses in this period')),
        raCard('Cash and bank accounts', h('div', { class: 'list' }, d.accounts.map((a) => liRow({ icon: a.bank ? 'bank' : 'cash', tone: 'gray', title: a.name, value: money(a.balance), chevron: true, onclick: () => go('ledger?account=' + a.id) }))))),
      raCard('Recent transactions', d.recent.length ? h('div', { class: 'list' }, d.recent.map((x) => liRow({ icon: 'book', tone: 'gray', title: x.number + ' · ' + cap1(x.voucher_type), sub: fmtD(x.jdate) + (x.narration ? ' · ' + x.narration : ''), value: money(x.amount), chevron: true, onclick: () => go('journal/' + x.id) }))) : h('div', { class: 'muted' }, 'No entries in this period')),
      h('div', { class: 'ra-card' }, h('h3', null, 'Quick actions'), h('div', { class: 'row wrap' },
        h('button', { class: 'btn primary', type: 'button', onclick: () => go('new/invoice') }, 'New invoice'), h('button', { class: 'btn', type: 'button', onclick: () => go('payments') }, 'Record receipt'), h('button', { class: 'btn', type: 'button', onclick: () => go('analytics/all') }, 'All reports'), h('button', { class: 'btn', type: 'button', onclick: () => go('gst') }, 'GST reports'))));
  },
});
const raCard = (title, body) => h('div', { class: 'ra-card' }, h('h3', null, title), body);
function raAgeBars(t) { const b = [['Current', t.current], ['1-30', t.d30], ['31-60', t.d60], ['61-90', t.d90], ['90+', t.d90p]]; return barChart(b.map(([label, value]) => ({ label, value: Math.max(Number(value) || 0, 0) })), { label: 'Ageing' }); }
function raExportDash(anchor, d, label) {
  const rows = [['Receivables', d.receivable], ['Payables', d.payable], ['Cash in hand', d.cash], ['Bank balance', d.bank], ['Income', d.income], ['Expenses', d.expense], ['Net profit', d.net_profit], ['Overdue from customers', d.receivable_overdue], ['Overdue to suppliers', d.payable_overdue], ['Collected', d.collected], ['Pending bills to pay', d.pending_bill_amount]].map(([a, b]) => [a, Number(b)]);
  exportMenu(anchor, 'dashboard-summary', ['Measure', 'Amount'], rows, { sub: label });
}

// ---------- report pages ----------
function raPager(v, total, limit, off, nav) {
  if (total <= limit) return null;
  return h('div', { class: 'ra-pager' }, h('span', { class: 'muted' }, (off + 1) + '-' + Math.min(off + limit, total) + ' of ' + total),
    h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', disabled: off <= 0, onclick: () => nav(Math.max(off - limit, 0)) }, 'Previous'), h('button', { class: 'btn', type: 'button', disabled: off + limit >= total, onclick: () => nav(off + limit) }, 'Next')));
}
const RA_REPORTS = {
  customers: { title: 'Customer balances', group: 'Customers and suppliers', desc: 'Opening, billed, received and closing for every customer. Filter for zero, advance, new or inactive.', run: (v, F, host) => raParties(v, F, host, 'customer') },
  suppliers: { title: 'Supplier balances', group: 'Customers and suppliers', desc: 'Opening, bought, paid and closing for every supplier.', run: (v, F, host) => raParties(v, F, host, 'supplier') },
  credit: { title: 'Credit limit use', group: 'Customers and suppliers', desc: 'How much of each customer\'s credit limit is used.', noPeriod: true, run: raCredit },
  due: { title: 'Due and overdue', group: 'Outstanding and collections', desc: 'Invoices and bills due today, coming up, or overdue.', noPeriod: true, run: raDue },
  collection: { title: 'Collections', group: 'Outstanding and collections', desc: 'Billed, collected, efficiency, payment methods and write-offs.', run: raCollection },
  unallocated: { title: 'Unallocated payments', group: 'Outstanding and collections', desc: 'Receipts and payments not yet matched to an invoice or bill (advances).', noPeriod: true, run: raUnallocated },
  income: { title: 'Income by category', group: 'Income and expenses', desc: 'Where income came from, by account, month or day.', run: (v, F, host) => raCategory(v, F, host, 'income') },
  expense: { title: 'Expenses by category', group: 'Income and expenses', desc: 'Where money went, by account, month, day or supplier.', run: (v, F, host) => raCategory(v, F, host, 'expense') },
  paymode: { title: 'Payment methods', group: 'Income and expenses', desc: 'Money received and paid by cash, UPI, card and bank.', run: raPaymode },
  docs: { title: 'Invoice and bill register', group: 'Invoices and bills', desc: 'Sales, purchases and notes with paid, partial, unpaid and cancelled status.', run: raDocs },
  journals: { title: 'Journal and audit register', group: 'Accounting and review', desc: 'Journals with reversed, backdated, adjustment and transfer review filters.', run: raJournals },
  duplicates: { title: 'Possible duplicates', group: 'Accounting and review', desc: 'Same party and amount posted more than once close together.', run: raDuplicates },
  fy: { title: 'This year against last year', group: 'Accounting and review', desc: 'Monthly income and expenses compared with the year before.', noPeriod: true, noBranch: true, run: raFyCompare },
  ratios: { title: 'Ratios and working capital', group: 'Accounting and review', desc: 'Margins, current ratio, debtor and creditor days, debt to equity.', run: raRatios },
  gstr3b: { title: 'GSTR-3B preparation', group: 'GST', desc: 'Outward supplies, reverse charge, input credit and tax payable laid out like the GSTR-3B tables. Preparation only; nothing is filed.', run: raGstr3b },
  gstr1: { title: 'GSTR-1 preparation', group: 'GST', desc: 'B2B, B2C, notes, HSN and nil/exempt totals with counts, ready to check against your return. Preparation only; nothing is filed.', run: raGstr1 },
  branch: { title: 'Branch comparison', group: 'Accounting and review', desc: 'Income, expenses and profit by branch.', noBranch: true, run: raBranch },
  cprofit: { title: 'Customer profitability', group: 'Accounting and review', desc: 'Sales less the stock cost on the invoice lines.', run: raCustProfit },
};
// existing reports shown in the same list so there is one place to look
const RA_LINKS = [['Trial balance', 'reports/tb', 'Accounting and review'], ['Profit and loss', 'reports/pnl', 'Income and expenses'], ['Balance sheet', 'reports/bs', 'Accounting and review'], ['Cash flow', 'reports/cf', 'Income and expenses'], ['Cash book', 'reports/cashbook', 'Cash and bank'], ['Bank book', 'reports/bankbook', 'Cash and bank'], ['Bank reconciliation', 'books?tab=recon', 'Cash and bank'], ['Receivables ageing', 'reports/ageing_receivable', 'Outstanding and collections'], ['Payables ageing', 'reports/ageing_payable', 'Outstanding and collections'], ['Budget vs actual', 'reports/budget', 'Income and expenses'], ['Day book', 'books?tab=daybook', 'Accounting and review'], ['GST summary, registers and returns', 'gst', 'GST'], ['Audit log', 'reports/audit', 'Accounting and review']];

async function raReport(v, id) {
  if (id === 'all') {
    v.header({ title: 'All reports', back: 'analytics' });
    const groups = uniq([...Object.values(RA_REPORTS).map((r) => r.group), ...RA_LINKS.map((x) => x[2])]);
    groups.forEach((g) => v.root.append(h('div', { class: 'sec' }, h('div', { class: 'sec-h' }, h('h3', null, g)), h('div', { class: 'list' },
      ...Object.entries(RA_REPORTS).filter(([, r]) => r.group === g).map(([k, r]) => liRow({ icon: 'chart', tone: 'gray', title: r.title, sub: r.desc, chevron: true, onclick: () => go('analytics/' + k) })),
      ...RA_LINKS.filter((x) => x[2] === g).map((x) => liRow({ icon: 'chart', tone: 'gray', title: x[0], chevron: true, onclick: () => go(x[1]) }))))));
    v.root.append(h('div', { class: 'muted' }, 'Not available: cheque register, bank charges, project and business-unit reports, forecast. The books do not hold that information yet.'));
    return;
  }
  const R = RA_REPORTS[id]; if (!R) throw new Error('Unknown report');
  v.header({ title: R.title, back: 'analytics' });
  const F = raFilters(v, 'analytics/' + id, { noPeriod: R.noPeriod, noBranch: R.noBranch, keep: ['kind', 'bucket', 'status', 'filter', 'by', 'mode', 'doc_type', 'q', 'o'] });
  const views = await raViews(v, id, Object.fromEntries([...v.q.entries()]), (fl) => go('analytics/' + id + '?' + new URLSearchParams(fl).toString()));
  v.root.append(F.bar, views);
  const host = h('div', { class: 'grid' }, h('div', { class: 'muted' }, 'Loading...')); v.root.append(host);
  try { await R.run(v, F, host); } catch (e) { if (host.isConnected) raPut(host, empty('alert', 'Could not load this report', e.message)); }
}
// a segmented/chip control that writes its value into the address
function raChip(v, F, key, opts, dflt, extra = {}) { const cur = v.q.get(key) || dflt; return chips(opts, cur, (k) => F.nav({ [key]: k, o: undefined, ...extra })); }
const raOff = (v) => Number(v.q.get('o') || 0);

async function raParties(v, F, host, kind) {
  const filter = v.q.get('filter') || 'all', off = raOff(v), lim = 50, search = v.q.get('q') || '';
  const r = await raCall('acc_rep_party_summary', raP(F.f, { kind, filter, search, limit: lim, offset: off }));
  const sw = searchField('Search by name, phone or GSTIN', () => {}, search); sw.input.onkeydown = (e) => { if (e.key === 'Enter') F.nav({ q: sw.input.value, o: undefined }); };
  const send = kind === 'customer' ? 'Received' : 'Paid';
  const rows = r.rows.map((x) => [x.name, Number(x.opening), Number(x.billed), Number(x.settled), Number(x.closing), x.last_txn || '']);
  raPut(host, 
    raChip(v, F, 'filter', [['all', 'All'], ['outstanding', kind === 'customer' ? 'Owing' : 'Owed'], ['zero', 'Zero balance'], ['advance', 'Advance'], ['new', 'New'], ['inactive', 'Inactive 90+ days'], ['moved', 'Active']], 'all'), sw,
    h('div', { class: 'ra-grid kpis' }, kpi('Opening', money(r.sums.opening)), kpi(kind === 'customer' ? 'Billed' : 'Bought', money(r.sums.billed)), kpi(send, money(r.sums.settled)), kpi('Closing', money(r.sums.closing)), kpi(kind === 'customer' ? 'Owed to you' : 'You owe', money(r.sums.owed)), kpi('Advances', money(r.sums.advance))),
    h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', onclick: (e) => exportMenu(e.currentTarget, kind + '-balances', ['Name', 'Opening', kind === 'customer' ? 'Billed' : 'Bought', send, 'Closing', 'Last activity'], rows, { sub: F.label + ' · ' + r.total + ' ' + kind + 's', foot: ['Total', Number(r.sums.opening), Number(r.sums.billed), Number(r.sums.settled), Number(r.sums.closing), ''] }) }, icon('download', 16), 'Export')),
    dataView(raCols([{ key: 'name', label: cap1(kind) }, { key: 'phone', label: 'Phone', render: (x) => x.phone || '' }, { key: 'opening', label: 'Opening', r: true, m: true }, { key: 'billed', label: kind === 'customer' ? 'Billed' : 'Bought', r: true, m: true }, { key: 'settled', label: send, r: true, m: true }, { key: 'closing', label: 'Closing', r: true, m: true, value: true }, { key: 'last_txn', label: 'Last activity', render: (x) => (x.last_txn ? fmtD(x.last_txn) : 'None') }]), r.rows.map((x) => ({ ...x, id: x.party_id })), { onRow: (x) => go('party/' + x.party_id), empty: empty('users', 'No ' + kind + 's match', 'Try another filter or period.') }),
    raPager(v, r.total, lim, off, (o) => F.nav({ o })));
}
async function raCredit(v, F, host) {
  const r = await raCall('acc_ageing', { kind: 'receivable', as_of: today() });
  const rows = r.rows.filter((x) => Number(x.credit_limit) > 0).map((x) => ({ ...x, used: Math.round(Number(x.total) / Number(x.credit_limit) * 100) })).sort((a, b) => b.used - a.used);
  raPut(host, rows.length ? [h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', onclick: (e) => exportMenu(e.currentTarget, 'credit-limit-use', ['Customer', 'Credit limit', 'Outstanding', 'Used %'], rows.map((x) => [x.name, Number(x.credit_limit), Number(x.total), x.used]), { sub: 'As on ' + fmtD(today()) }) }, icon('download', 16), 'Export')),
    dataView(raCols([{ key: 'name', label: 'Customer' }, { key: 'credit_limit', label: 'Credit limit', r: true, m: true }, { key: 'total', label: 'Outstanding', r: true, m: true }, { key: 'used', label: 'Used', r: true, value: true, render: (x) => badge(x.used + '%', x.used >= 100 ? 'red' : x.used >= 80 ? 'orange' : 'green') }]), rows.map((x) => ({ ...x, id: x.party_id })), { onRow: (x) => go('party/' + x.party_id) })] : empty('shield', 'No credit limits set', 'Set a credit limit on a customer to see how much of it is used.'));
}
async function raDue(v, F, host) {
  const kind = v.q.get('kind') || 'receivable', bucket = v.q.get('bucket') || 'overdue';
  const r = await raCall('acc_rep_due', { kind, bucket, days: 7, as_of: today(), limit: 500 });
  const rows = r.rows.map((x) => [x.number, x.party_name || '', x.due_date, Number(x.balance), x.days_over]);
  raPut(host, raChip(v, F, 'kind', [['receivable', 'Customers owe you'], ['payable', 'You owe suppliers']], 'receivable'), raChip(v, F, 'bucket', [['today', 'Due today'], ['upcoming', 'Next 7 days'], ['overdue', 'Overdue'], ['all', 'All open']], 'overdue'),
    h('div', { class: 'ra-grid kpis' }, kpi('Documents', String(r.sums.count)), kpi('Balance', money(r.sums.balance))),
    h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', onclick: (e) => exportMenu(e.currentTarget, 'due-' + kind + '-' + bucket, ['Number', 'Party', 'Due date', 'Balance', 'Days overdue'], rows, { sub: 'As on ' + fmtD(today()), foot: ['Total', '', '', Number(r.sums.balance), ''] }) }, icon('download', 16), 'Export')),
    dataView(raCols([{ key: 'number', label: 'Number' }, { key: 'party_name', label: 'Party' }, { key: 'due_date', label: 'Due', render: (x) => fmtD(x.due_date) }, { key: 'days_over', label: 'Days', r: true, render: (x) => (x.days_over > 0 ? x.days_over + ' late' : x.days_over === 0 ? 'Today' : 'In ' + -x.days_over) }, { key: 'balance', label: 'Balance', r: true, m: true, value: true }]), r.rows, { onRow: (x) => go('doc/' + x.id), empty: empty('check', 'Nothing here', 'No open ' + (kind === 'receivable' ? 'invoices' : 'bills') + ' in this group.') }));
}
async function raCollection(v, F, host) {
  const r = await raCall('acc_rep_collection', raP(F.f));
  raPut(host, 
    h('div', { class: 'ra-grid kpis' }, kpi('Opening receivable', money(r.opening_receivable)), kpi('Billed', money(r.billed)), kpi('Collected', money(r.collected), r.receipts + ' receipts'), kpi('Efficiency', r.efficiency != null ? r.efficiency + '%' : 'n/a', 'Collected / (opening + billed)'), kpi('Written off or discounted', money(r.writeoff_total))),
    h('div', { class: 'ra-two' }, raCard('Billed and collected by day', multiChart(r.daily.map((x) => ({ label: x.d.slice(5), billed: x.billed, collected: x.collected })), [{ key: 'billed', label: 'Billed' }, { key: 'collected', label: 'Collected' }], { mode: 'line' })), raCard('By payment method', donutChart(r.modes.map((x) => ({ label: x.mode, value: x.amount }))))),
    r.writeoffs.length ? [h('h3', null, 'Write-offs and discounts'), dataView(raCols([{ key: 'number', label: 'Number' }, { key: 'party_name', label: 'Party', render: (x) => x.party_name || '' }, { key: 'pay_date', label: 'Date', render: (x) => fmtD(x.pay_date) }, { key: 'mode', label: 'Type', render: (x) => x.mode || '' }, { key: 'amount', label: 'Amount', r: true, m: true, value: true }]), r.writeoffs.map((x) => ({ ...x })))] : null,
    h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', onclick: (e) => exportMenu(e.currentTarget, 'collections', ['Date', 'Billed', 'Collected'], r.daily.map((x) => [x.d, Number(x.billed), Number(x.collected)]), { sub: F.label + ' · efficiency ' + (r.efficiency ?? 'n/a') + '%', foot: ['Total', Number(r.billed), Number(r.collected)] }) }, icon('download', 16), 'Export daily table')));
}
async function raUnallocated(v, F, host) {
  const r = await raCall('acc_rep_unallocated', {});
  raPut(host, h('div', { class: 'ra-grid kpis' }, kpi('Receipts not matched', money(r.sums.receipts)), kpi('Payments not matched', money(r.sums.payments)), kpi('Entries', String(r.sums.count))),
    dataView(raCols([{ key: 'number', label: 'Number' }, { key: 'party_name', label: 'Party', render: (x) => x.party_name || 'No party' }, { key: 'pay_date', label: 'Date', render: (x) => fmtD(x.pay_date) }, { key: 'kind', label: 'Type', render: (x) => cap1(x.kind) }, { key: 'open', label: 'Unmatched', r: true, m: true, value: true }]), r.rows, { onRow: (x) => x.party_id && go('party/' + x.party_id), empty: empty('check', 'Everything is matched', 'Every receipt and payment is allocated.') }),
    r.rows.length ? h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', onclick: (e) => exportMenu(e.currentTarget, 'unallocated-payments', ['Number', 'Party', 'Date', 'Type', 'Amount', 'Unmatched'], r.rows.map((x) => [x.number, x.party_name || '', x.pay_date, x.kind, Number(x.amount), Number(x.open)]), { sub: 'As on ' + fmtD(r.as_of) }) }, icon('download', 16), 'Export')) : null);
}
async function raCategory(v, F, host, kind) {
  const by = v.q.get('by') || 'account';
  const r = await raCall('acc_rep_category', raP(F.f, { kind, by }));
  const byOpts = [['account', 'By account'], ['month', 'By month'], ['day', 'By day']].concat(kind === 'expense' ? [['vendor', 'By supplier']] : []);
  const rows = r.rows.map((x) => [x.name, Number(x.amount), x.n || '']);
  raPut(host, raChip(v, F, 'by', byOpts, 'account'),
    h('div', { class: 'ra-grid kpis' }, kpi(kind === 'income' ? 'Total income' : by === 'vendor' ? 'Total bought (before tax)' : 'Total expenses', money(r.total))),
    by === 'account' || by === 'vendor' ? raCard('Share', donutChart(r.rows.slice(0, 8).map((x) => ({ label: x.name, value: x.amount })))) : raCard('Trend', multiChart(r.rows.map((x) => ({ label: x.name, amount: x.amount })), [{ key: 'amount', label: kind === 'income' ? 'Income' : 'Expenses' }], { mode: 'group' })),
    h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', onclick: (e) => exportMenu(e.currentTarget, kind + '-by-' + by, ['Name', 'Amount', 'Entries'], rows, { sub: F.label, foot: ['Total', Number(r.total), ''] }) }, icon('download', 16), 'Export')),
    dataView(raCols([{ key: 'name', label: by === 'account' ? 'Account' : by === 'vendor' ? 'Supplier' : 'Period' }, { key: 'grp', label: 'Group', render: (x) => x.grp || '' }, { key: 'n', label: 'Entries', r: true, render: (x) => x.n || '' }, { key: 'amount', label: 'Amount', r: true, m: true, value: true }]), r.rows.map((x, i) => ({ ...x, id: x.key || x.party_id || i })), { onRow: by === 'account' ? (x) => go('ledger?account=' + x.key + '&from=' + F.f.from + '&to=' + F.f.to) : by === 'vendor' && r.rows.some((x) => x.party_id) ? (x) => x.party_id && go('party/' + x.party_id) : undefined, empty: empty('chart', 'Nothing in this period') }));
}
async function raPaymode(v, F, host) {
  const r = await raCall('acc_rep_paymode', raP(F.f));
  raPut(host, h('div', { class: 'ra-two' }, raCard('Received', donutChart(r.rows.map((x) => ({ label: x.mode, value: x.received })))), raCard('Paid out', donutChart(r.rows.map((x) => ({ label: x.mode, value: x.paid }))))),
    h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', onclick: (e) => exportMenu(e.currentTarget, 'payment-methods', ['Method', 'Received', 'Paid', 'Entries'], r.rows.map((x) => [x.mode, Number(x.received), Number(x.paid), x.n]), { sub: F.label, foot: ['Total', r.rows.reduce((a, x) => a + Number(x.received), 0), r.rows.reduce((a, x) => a + Number(x.paid), 0), r.rows.reduce((a, x) => a + Number(x.n), 0)] }) }, icon('download', 16), 'Export')),
    dataView(raCols([{ key: 'mode', label: 'Method' }, { key: 'n', label: 'Entries', r: true }, { key: 'received', label: 'Received', r: true, m: true }, { key: 'paid', label: 'Paid', r: true, m: true, value: true }]), r.rows.map((x, i) => ({ ...x, id: i }))));
}
async function raDocs(v, F, host) {
  const kind = v.q.get('kind') || 'sales', status = v.q.get('status') || 'all', dt = v.q.get('doc_type') || '', off = raOff(v), lim = 50, search = v.q.get('q') || '';
  const r = await raCall('acc_rep_docs', raP(F.f, { kind, status, doc_type: dt, search, limit: lim, offset: off }));
  const sw = searchField('Search number, party or supplier invoice', () => {}, search); sw.input.onkeydown = (e) => { if (e.key === 'Enter') F.nav({ q: sw.input.value, o: undefined }); };
  const typeOpts = kind === 'sales' ? [['', 'All'], ['invoice', 'Invoices'], ['credit_note', 'Credit notes']] : [['', 'All'], ['bill', 'Bills'], ['expense', 'Expenses'], ['debit_note', 'Debit notes']];
  const rows = r.rows.map((x) => [x.number, x.doc_date, x.party_name || '', cap1(x.state), Number(x.total), Number(x.paid), Number(x.balance)]);
  raPut(host, raChip(v, F, 'kind', [['sales', 'Sales'], ['purchase', 'Purchases']], 'sales', { doc_type: undefined }), raChip(v, F, 'doc_type', typeOpts, ''), raChip(v, F, 'status', [['all', 'All'], ['paid', 'Paid'], ['partial', 'Partly paid'], ['unpaid', 'Unpaid'], ['cancelled', 'Cancelled']], 'all'), sw,
    h('div', { class: 'ra-grid kpis' }, kpi('Documents', String(r.total)), kpi('Total', money(r.sums.total), 'Credit and debit notes subtracted'), kpi('Taxable', money(r.sums.taxable)), kpi('Tax', money(r.sums.tax)), kpi('Balance open', money(r.sums.balance)),
      ...Object.entries(r.counts).map(([k, n]) => kpi(cap1(k), String(n)))),
    h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', onclick: (e) => exportMenu(e.currentTarget, kind + '-register', ['Number', 'Date', 'Party', 'Status', 'Total', 'Paid', 'Balance'], rows, { sub: F.label + ' · ' + cap1(status), foot: ['Total', '', '', '', Number(r.sums.total), '', Number(r.sums.balance)] }) }, icon('download', 16), 'Export this page')),
    dataView(raCols([{ key: 'number', label: 'Number' }, { key: 'party_name', label: 'Party', render: (x) => (x.party_name || '') + (x.ref_number ? ' · against ' + x.ref_number : '') }, { key: 'doc_date', label: 'Date', render: (x) => fmtD(x.doc_date) }, { key: 'state', label: 'Status', badge: true, render: (x) => badge(cap1(x.state), raTone[x.state] || '') }, { key: 'total', label: 'Total', r: true, m: true, value: true }, { key: 'balance', label: 'Balance', r: true, m: true }]), r.rows, { onRow: (x) => go('doc/' + x.id), empty: empty('file', 'No documents match') }),
    raPager(v, r.total, lim, off, (o) => F.nav({ o })));
}
async function raJournals(v, F, host) {
  const mode = v.q.get('mode') || 'all', off = raOff(v), lim = 50;
  const r = await raCall('acc_rep_journals', raP(F.f, { mode, limit: lim, offset: off }));
  const rows = r.rows.map((x) => [x.number, x.jdate, cap1(x.voucher_type), x.narration || '', Number(x.amount), x.reversed ? 'Reversed' : x.is_reversal ? 'Reversal' : x.backdated ? 'Backdated' : '']);
  raPut(host, raChip(v, F, 'mode', [['all', 'All'], ['reversed', 'Reversed'], ['backdated', 'Backdated entries'], ['adjustment', 'Manual journals'], ['transfer', 'Cash and bank transfers']], 'all'),
    h('div', { class: 'ra-grid kpis' }, kpi('Entries', String(r.total)), kpi('Value', money(r.sums.amount)), kpi('Reversed or reversals', String(r.sums.reversed)), kpi('Backdated (7+ days)', String(r.sums.backdated))),
    h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', onclick: (e) => exportMenu(e.currentTarget, 'journal-register', ['Number', 'Date', 'Type', 'Narration', 'Amount', 'Flag'], rows, { sub: F.label + ' · ' + mode }) }, icon('download', 16), 'Export this page')),
    dataView(raCols([{ key: 'number', label: 'Journal' }, { key: 'narration', label: 'Narration', render: (x) => x.narration || x.doc_number || '' }, { key: 'jdate', label: 'Date', render: (x) => fmtD(x.jdate) }, { key: 'voucher_type', label: 'Type', render: (x) => cap1(x.voucher_type) }, { key: 'flag', label: 'Flag', badge: true, render: (x) => (x.reversed ? badge('Reversed', 'orange') : x.is_reversal ? badge('Reversal', 'orange') : x.backdated ? badge('Backdated', 'red') : '') }, { key: 'amount', label: 'Amount', r: true, m: true, value: true }]), r.rows, { onRow: (x) => go('journal/' + x.id), empty: empty('book', 'No entries match') }),
    raPager(v, r.total, lim, off, (o) => F.nav({ o })));
}
async function raDuplicates(v, F, host) {
  const r = await raCall('acc_rep_duplicates', raP(F.f));
  const none = !r.documents.length && !r.payments.length;
  raPut(host, none ? empty('check', 'No likely duplicates', 'No two documents or payments share a party, amount and date window.') : [
    r.documents.length ? [h('h3', null, 'Documents with the same party and amount within 7 days'), dataView(raCols([{ key: 'party_name', label: 'Party' }, { key: 'numbers', label: 'Numbers', render: (x) => x.numbers.join(', ') }, { key: 'n', label: 'Times', r: true }, { key: 'total', label: 'Amount', r: true, m: true, value: true }]), r.documents.map((x, i) => ({ ...x, id: i })), { onRow: (x) => go('doc/' + x.ids[0]) })] : null,
    r.payments.length ? [h('h3', null, 'Payments with the same party, amount and date'), dataView(raCols([{ key: 'party_name', label: 'Party', render: (x) => x.party_name || 'No party' }, { key: 'numbers', label: 'Numbers', render: (x) => x.numbers.join(', ') }, { key: 'pay_date', label: 'Date', render: (x) => fmtD(x.pay_date) }, { key: 'amount', label: 'Amount', r: true, m: true, value: true }]), r.payments.map((x, i) => ({ ...x, id: i })))] : null,
    h('div', { class: 'muted' }, 'These are only possible duplicates. Nothing is changed; check each pair before cancelling one.')]);
}
async function raFyCompare(v, F, host) {
  const r = await raCall('acc_rep_fy_compare', {});
  const pts = r.rows.map((x) => ({ label: x.label, income: x.income, prev_income: x.prev_income, expense: x.expense, prev_expense: x.prev_expense }));
  const sum = (k) => r.rows.reduce((a, x) => a + Number(x[k]), 0);
  raPut(host, h('div', { class: 'ra-grid kpis' }, kpi('Income this year', money(sum('income'))), kpi('Income last year', money(sum('prev_income'))), kpi('Expenses this year', money(sum('expense'))), kpi('Expenses last year', money(sum('prev_expense')))),
    raCard('Income: this year against last year', multiChart(pts, [{ key: 'income', label: 'This year' }, { key: 'prev_income', label: 'Last year' }], { mode: 'group' })),
    raCard('Expenses: this year against last year', multiChart(pts, [{ key: 'expense', label: 'This year' }, { key: 'prev_expense', label: 'Last year' }], { mode: 'group' })),
    h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', onclick: (e) => exportMenu(e.currentTarget, 'year-comparison', ['Month', 'Income', 'Income last year', 'Expenses', 'Expenses last year'], r.rows.map((x) => [x.label, Number(x.income), Number(x.prev_income), Number(x.expense), Number(x.prev_expense)]), { sub: 'Year from ' + fmtD(r.fy_start), foot: ['Total', sum('income'), sum('prev_income'), sum('expense'), sum('prev_expense')] }) }, icon('download', 16), 'Export')));
}
async function raRatios(v, F, host) {
  const r = await raCall('acc_rep_ratios', raP(F.f));
  const pct = (x) => (x == null ? 'n/a' : x + '%'), num = (x) => (x == null ? 'n/a' : String(x));
  const list = [['Working capital', money(r.working_capital)], ['Current ratio', num(r.current_ratio)], ['Quick ratio', num(r.quick_ratio)], ['Gross margin', pct(r.gross_margin_pct)], ['Net margin', pct(r.net_margin_pct)], ['Expense ratio', pct(r.expense_ratio_pct)], ['Debtor days', num(r.debtor_days)], ['Creditor days', num(r.creditor_days)], ['Debt to equity', num(r.debt_to_equity)]];
  raPut(host, h('div', { class: 'ra-grid kpis' }, list.map(([a, b]) => kpi(a, b))),
    raCard('Working capital by month', multiChart(r.trend.map((x) => ({ label: x.label, wc: x.working_capital })), [{ key: 'wc', label: 'Working capital' }], { mode: 'line' })),
    h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', onclick: (e) => exportMenu(e.currentTarget, 'ratios', ['Measure', 'Value'], list.map(([a, b]) => [a, b]), { sub: F.label }) }, icon('download', 16), 'Export')),
    h('div', { class: 'muted' }, 'Ratios use the posted books. Margins and days are for the selected period; balances are as on the end date.'));
}
async function raBranch(v, F, host) {
  const r = await raCall('acc_rep_branch', raP(F.f));
  raPut(host, raCard('Income, expenses and profit', multiChart(r.rows.map((x) => ({ label: x.name, income: x.income, expense: x.expense, profit: x.profit })), [{ key: 'income', label: 'Income' }, { key: 'expense', label: 'Expenses' }, { key: 'profit', label: 'Profit' }], { mode: 'group' })),
    dataView(raCols([{ key: 'name', label: 'Branch' }, { key: 'income', label: 'Income', r: true, m: true }, { key: 'expense', label: 'Expenses', r: true, m: true }, { key: 'profit', label: 'Profit', r: true, m: true, value: true }]), r.rows.map((x, i) => ({ ...x, id: i }))),
    h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', onclick: (e) => exportMenu(e.currentTarget, 'branch-comparison', ['Branch', 'Income', 'Expenses', 'Profit'], r.rows.map((x) => [x.name, Number(x.income), Number(x.expense), Number(x.profit)]), { sub: F.label }) }, icon('download', 16), 'Export')));
}
async function raCustProfit(v, F, host) {
  const r = await raCall('acc_rep_customer_profit', raP(F.f));
  const rows = r.rows.map((x) => ({ ...x, profit: Number(x.sales) - Number(x.cost), margin: Number(x.sales) ? Math.round((Number(x.sales) - Number(x.cost)) / Number(x.sales) * 100) : 0 }));
  raPut(host, dataView(raCols([{ key: 'name', label: 'Customer' }, { key: 'bills', label: 'Bills', r: true }, { key: 'sales', label: 'Sales', r: true, m: true }, { key: 'cost', label: 'Stock cost', r: true, m: true }, { key: 'margin', label: 'Margin', r: true, render: (x) => x.margin + '%' }, { key: 'profit', label: 'Profit', r: true, m: true, value: true }]), rows.map((x, i) => ({ ...x, id: x.party_id || i })), { onRow: (x) => x.party_id && go('party/' + x.party_id) }),
    h('div', { class: 'muted' }, 'Profit here is sales less the stock cost on product lines. Service lines carry no stock cost, so they show as full margin.'),
    h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', onclick: (e) => exportMenu(e.currentTarget, 'customer-profitability', ['Customer', 'Bills', 'Sales', 'Cost', 'Margin %', 'Profit'], rows.map((x) => [x.name, x.bills, Number(x.sales), Number(x.cost), x.margin, x.profit]), { sub: F.label }) }, icon('download', 16), 'Export')));
}

// GST preparation views: built from the same functions as the GST centre, so the figures match it. Nothing is filed or sent to the GST portal.
const raGstNote = () => h('div', { class: 'banner info' }, icon('info', 18), 'Preparation only: working figures from your books. AUZslab does not file returns or call the GST portal. Have your CA confirm before filing.');
function raTaxTable(head, rows) { return dataView(raCols(head.map((c, i) => ({ key: 'c' + i, label: c, r: i > 0, m: i > 0, value: i === 1 }))), rows.map((r, i) => { const o = { id: i }; r.forEach((x, j) => { o['c' + j] = x; }); return o; })); }
async function raGstr3b(v, F, host) {
  const [g, ss] = await Promise.all([raCall2('acc_gst_summary', { p_from: F.f.from, p_to: F.f.to }), raCall2('acc_sales_sync_totals', { p_from: F.f.from, p_to: F.f.to })]);
  const sx = { net: Number(ss.pos.net || 0), tax: Number(ss.pos.tax || 0) }, mobNet = Number(ss.mob.net || 0);
  const n = (x) => Number(x || 0), rate0 = g.output_by_rate.filter((x) => n(x.tax_rate) === 0), rated = g.output_by_rate.filter((x) => n(x.tax_rate) > 0), sum = (a, k) => a.reduce((t, x) => t + n(x[k]), 0);
  const rows = [
    ['3.1(a) Outward taxable supplies', sum(rated, 'taxable'), sum(rated, 'igst'), sum(rated, 'cgst'), sum(rated, 'sgst'), sum(rated, 'cess')],
    ...(sx.net || sx.tax ? [['3.1(a) POS and shop sales posted to the books (not in invoice registers; tax shown split evenly CGST/SGST)', sx.net, 0, sx.tax / 2, sx.tax / 2, 0]] : []),
    ['3.1(c) Nil rated and exempt supplies' + (mobNet ? ' (includes AUZsMob shop sales)' : ''), sum(rate0, 'taxable') + mobNet, 0, 0, 0, 0],
    ['3.1(d) Inward supplies on reverse charge (tax)', '', n(g.rcm.igst), n(g.rcm.cgst), n(g.rcm.sgst), n(g.rcm.cess)],
    ['4(A) Input tax credit available', '', n(g.itc.igst), n(g.itc.cgst), n(g.itc.sgst), n(g.itc.cess)],
    ['4(D) Credit not allowed (blocked)', '', '', '', '', n(g.itc.blocked)],
    ['6.1 Tax payable after set-off', '', n(g.payable.igst), n(g.payable.cgst), n(g.payable.sgst), n(g.payable.cess)],
    ['Credit carried forward', '', n(g.carry_forward_itc.igst), n(g.carry_forward_itc.cgst), n(g.carry_forward_itc.sgst), '']];
  const head = ['Table', 'Taxable value', 'IGST', 'CGST', 'SGST', 'Cess'];
  raPut(host, raGstNote(), g.locked ? h('div', { class: 'banner ok' }, icon('lock', 18), 'This return period is marked filed and locked.') : null, raTaxTable(head, rows),
    h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', onclick: (e) => exportMenu(e.currentTarget, 'gstr3b-preparation', head, rows.map((r) => r.map((x) => (x === '' ? '' : x))), { sub: F.label + ' · preparation only' }) }, icon('download', 16), 'Export'), h('button', { class: 'btn', type: 'button', onclick: () => { try { raDownloadJSON('GSTR3B-' + F.f.from.slice(0, 7) + '.json', raGstr3bJson(F, g, rated, rate0, mobNet, sx)); } catch (e) { toast(e.message, { error: true }); } } }, icon('download', 16), 'Download return file (JSON)'), h('button', { class: 'btn', type: 'button', onclick: () => go('gst?tab=summary&m=' + F.f.from.slice(0, 7)) }, 'Open GST centre')),
    h('div', { class: 'muted small' }, 'The JSON follows the GSTR-3B offline file layout for sections 3.1 and 4. Interest, late fee, ineligible credit and the tax payment table are not in it. Check it in the GST offline tool before you upload.'));
}
async function raGstr1(v, F, host) {
  const types = [['b2b', '4 B2B invoices'], ['b2c', '5/7 B2C sales'], ['cdn', '9B Credit and debit notes'], ['hsn', '12 HSN summary'], ['exempt', '8 Nil rated and exempt']];
  const res = await Promise.all(types.map(([t]) => raCall2('acc_gst_register', { p: { type: t, from: F.f.from, to: F.f.to } })));
  const ex = await raCall2('acc_gst_exceptions', { p_from: F.f.from, p_to: F.f.to });
  const n = (x) => Number(x || 0), tot = (r, k) => r.rows.reduce((a, x) => a + n(x[k]), 0);
  const rows = types.map(([t, l], i) => [l, res[i].rows.length, tot(res[i], 'taxable'), tot(res[i], 'igst'), tot(res[i], 'cgst'), tot(res[i], 'sgst'), tot(res[i], 'cess')]);
  const head = ['Section', 'Rows', 'Taxable value', 'IGST', 'CGST', 'SGST', 'Cess'];
  raPut(host, raGstNote(), ex.rows.length ? h('div', { class: 'banner bad' }, icon('alert', 18), ex.rows.length + ' issue(s) to fix before filing (missing GSTIN or HSN, tax-type mismatch, unposted drafts). ', h('button', { class: 'linkbtn', type: 'button', onclick: () => go('gst?tab=checks&m=' + F.f.from.slice(0, 7)) }, 'See checks')) : h('div', { class: 'banner ok' }, icon('check', 18), 'No data issues found for this period.'),
    raTaxTable(head, rows),
    h('div', { class: 'row wrap' }, h('button', { class: 'btn', type: 'button', onclick: (e) => exportMenu(e.currentTarget, 'gstr1-preparation', head, rows, { sub: F.label + ' · preparation only' }) }, icon('download', 16), 'Export'),
      h('button', { class: 'btn', type: 'button', onclick: () => { try { raDownloadJSON('GSTR1-' + F.f.from.slice(0, 7) + '.json', raGstr1Json(F, { b2b: res[0], b2c: res[1], hsn: res[3] })); } catch (e) { toast(e.message, { error: true }); } } }, icon('download', 16), 'Download return file (JSON)'),
      ...types.map(([t, l]) => h('button', { class: 'btn', type: 'button', onclick: () => go('gst?tab=registers&type=' + t + '&m=' + F.f.from.slice(0, 7)) }, 'Open ' + l.replace(/^[\d/]+ /, '')))),
    h('div', { class: 'muted small' }, 'The JSON carries B2B invoices (4), B2C small supplies (7) and the HSN summary (12), following the GSTR-1 offline file layout. Credit and debit notes, nil-rated, exports and document series are not in it: add them in the GST offline tool. Check the file there before you upload.'));
}
const raCall2 = (fn, args) => api(fn, args);
const r2n = (x) => Math.round((Number(x) || 0) * 100) / 100, dmy = (d) => { const [y, m, dd] = String(d).slice(0, 10).split('-'); return dd + '-' + m + '-' + y; };
const taxBlock = (t, i, c, sg, cs) => ({ txval: r2n(t), iamt: r2n(i), camt: r2n(c), samt: r2n(sg), csamt: r2n(cs) });
function raDownloadJSON(name, obj) { const a = h('a', { href: URL.createObjectURL(new Blob([JSON.stringify(obj, null, 1)], { type: 'application/json' })), download: name }); document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500); }
function raFiling(F) { const gstin = (S.org && S.org.gstin) || ''; if (!/^\d{2}[A-Z0-9]{13}$/.test(gstin)) throw new Error('Set your business GSTIN in Settings > Organisation before downloading a return file'); const [y, m] = F.f.from.split('-'); return { gstin, fp: m + y }; }
function raGstr3bJson(F, g, rated, rate0, mobNet, sx) {
  const n = (x) => Number(x || 0), sum = (a, k) => a.reduce((t, x) => t + n(x[k]), 0), base = raFiling(F);
  return { gstin: base.gstin, ret_period: base.fp, sup_details: {
      osup_det: taxBlock(sum(rated, 'taxable') + sx.net, sum(rated, 'igst'), sum(rated, 'cgst') + sx.tax / 2, sum(rated, 'sgst') + sx.tax / 2, sum(rated, 'cess')),
      osup_zero: taxBlock(0, 0, 0, 0, 0), osup_nil_exmp: { txval: r2n(sum(rate0, 'taxable') + mobNet) }, isup_rev: taxBlock(0, g.rcm.igst, g.rcm.cgst, g.rcm.sgst, g.rcm.cess), osup_nongst: { txval: 0 } },
    itc_elg: { itc_avl: [{ ty: 'OTH', iamt: r2n(g.itc.igst), camt: r2n(g.itc.cgst), samt: r2n(g.itc.sgst), csamt: r2n(g.itc.cess) }], itc_net: { iamt: r2n(g.itc.igst), camt: r2n(g.itc.cgst), samt: r2n(g.itc.sgst), csamt: r2n(g.itc.cess) } } };
}
function raGstr1Json(F, reg) {
  const base = raFiling(F), n = (x) => Number(x || 0), b2b = {};
  reg.b2b.rows.forEach((x) => { const c = b2b[x.gstin] || (b2b[x.gstin] = { ctin: x.gstin, inv: {} }); const inv = c.inv[x.number] || (c.inv[x.number] = { inum: x.number, idt: dmy(x.doc_date), val: r2n(x.total), pos: x.place_of_supply, rchrg: x.reverse_charge ? 'Y' : 'N', inv_typ: 'R', itms: [] });
    inv.itms.push({ num: inv.itms.length + 1, itm_det: { rt: n(x.rate), txval: r2n(x.taxable), iamt: r2n(x.igst), camt: r2n(x.cgst), samt: r2n(x.sgst), csamt: r2n(x.cess) } }); });
  return { gstin: base.gstin, fp: base.fp, b2b: Object.values(b2b).map((c) => ({ ctin: c.ctin, inv: Object.values(c.inv) })),
    b2cs: reg.b2c.rows.map((x) => ({ sply_ty: x.supply_type === 'inter' ? 'INTER' : 'INTRA', pos: x.place_of_supply, typ: 'OE', rt: n(x.rate), txval: r2n(x.taxable), iamt: r2n(x.igst), camt: r2n(x.cgst), samt: r2n(x.sgst), csamt: r2n(x.cess) })),
    hsn: { data: reg.hsn.rows.map((x, i) => ({ num: i + 1, hsn_sc: x.hsn === '-' ? '' : x.hsn, uqc: String(x.unit || 'NOS').toUpperCase().slice(0, 3) === 'PCS' ? 'PCS' : 'NOS', qty: n(x.qty), val: r2n(x.value), txval: r2n(x.taxable), iamt: r2n(x.igst), camt: r2n(x.cgst), samt: r2n(x.sgst), csamt: r2n(x.cess) })) } };
}

// one place to find everything from the existing Reports list
Object.assign(REPORTS, { analytics_dash: { title: 'Reports dashboard', group: 'Dashboard and analytics', desc: 'Receivables, payables, cash, profit, trends and alerts in one view.', link: 'analytics' } });
Object.entries(RA_REPORTS).forEach(([k, r]) => { REPORTS['analytics_' + k] = { title: r.title, group: 'Dashboard and analytics', desc: r.desc, link: 'analytics/' + k }; });
