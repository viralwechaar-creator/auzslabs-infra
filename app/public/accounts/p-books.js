/* Banking and reconciliation, chart of accounts, ledgers, journals, vouchers, opening balances and fixed assets. */
'use strict';

// ---------- date parsing for statement imports ----------
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
function toISO(s) {
  s = String(s ?? '').trim(); if (!s) return '';
  let m;
  if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s))) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  if ((m = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/.exec(s))) { const y = m[3].length === 2 ? '20' + m[3] : m[3]; return `${y}-${pad(m[2])}-${pad(m[1])}`; }
  if ((m = /^(\d{1,2})[\s\-]([A-Za-z]{3})[a-z]*[\s\-,]*(\d{2,4})/.exec(s))) { const mo = MONTHS[m[2].toLowerCase()]; if (mo) return `${m[3].length === 2 ? '20' + m[3] : m[3]}-${pad(mo)}-${pad(m[1])}`; }
  if (/^\d{5}$/.test(s)) { const d = new Date(Date.UTC(1899, 11, 30) + Number(s) * 864e5); return isoDate(new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); } // Excel serial date
  return '';
}

// ---------- banking ----------
page('banking', {
  title: 'Bank and cash', icon: 'bank', perm: 'acc_view',
  async render(v) {
    const writable = can('acc_banking');
    v.header({ title: 'Bank and cash', actions: [writable ? { label: 'Transfer money', icon: 'swap', primary: true, run: () => voucherSheet('contra') } : null, can('acc_admin') ? { label: 'Add account', icon: 'plus', run: () => accountSheet(null, () => route_(), { is_bank: true, type: 'asset', grp: 'Cash and bank' }) } : null].filter(Boolean) });
    const d = await api('acc_dashboard');
    const accts = payAccounts();
    const total = d.cash_bank.reduce((s, c) => s + Number(c.balance), 0);
    v.root.append(h('div', { class: 'kpis k3' }, kpi('Total cash and bank', inr(total, 0), accts.length + ' accounts'), kpi('Unmatched statement rows', String(d.alerts.unmatched_bank), 'Across all bank accounts'), kpi('Bills due this week', String(d.alerts.bills_due_week), 'Keep cash ready', () => go('purchases?status=unpaid'))));
    v.root.append(h('div', { class: 'sec' }, h('div', { class: 'sec-h' }, h('h3', null, 'Accounts')), h('div', { class: 'list' }, d.cash_bank.map((c) => { const a = S.accounts.find((x) => x.id === c.id) || {}; return liRow({ icon: a.is_bank ? 'bank' : 'wallet', tone: a.is_bank ? 'blue' : 'green', title: c.name, sub: a.is_bank ? 'Bank account · statement and reconciliation' : 'Cash in hand', value: money(c.balance, { signed: true }), chevron: true, onclick: () => go(a.is_bank ? 'bank/' + c.id : 'ledger?account=' + c.id) }); }))));
  },
});

page('bank', {
  title: 'Bank account', icon: 'bank', nav: false, navAs: 'banking',
  async render(v) {
    const id = v.args[0], acct = S.accounts.find((a) => a.id === id); if (!acct) throw new Error('Account not found');
    const tab = v.q.get('tab') || 'unmatched', writable = can('acc_banking');
    v.header({ title: acct.name, back: 'banking', actions: [writable ? { label: 'Import statement', icon: 'upload', primary: true, run: () => statementImport(id, () => v.refresh()) } : null, writable ? { label: 'Reconcile', icon: 'check', run: () => reconcileSheet(id, () => v.refresh()) } : null, { label: 'Ledger', icon: 'book', run: () => go('ledger?account=' + id) }].filter(Boolean) });
    const info = await api('acc_bank_list', { p: { account_id: id, status: tab === 'matched' ? 'matched' : tab === 'ignored' ? 'ignored' : tab === 'unmatched' ? 'unmatched' : null, limit: 500 } });
    v.root.append(h('div', { class: 'kpis k3' }, kpi('Book balance', inr(info.book_balance, 0), 'Per your ledger'), kpi('To match', String(info.unmatched), 'Statement rows'), kpi('Last reconciled', info.last_recon ? fmtD(info.last_recon.statement_date) : 'Never', info.last_recon ? 'Balance ' + inr(info.last_recon.statement_balance, 0) : '')));
    v.root.append(seg([['unmatched', 'To match'], ['matched', 'Matched'], ['ignored', 'Ignored'], ['books', 'Not on statement'], ['history', 'Reconciliations']], tab, (t) => go('bank/' + id + '?tab=' + t)));
    const host = h('div', { class: 'grid' }); v.root.append(host);
    if (tab === 'books') {
      const r = await api('acc_bank_book_lines', { p_account: id });
      host.append(h('p', { class: 'muted small' }, 'Entries in your books that no statement row has claimed yet: cheques not presented, deposits in transit, or entries to check.'), dataView([{ key: 'jdate', label: 'Date', title: true, render: (x) => fmtD(x.jdate) }, { key: 'narration', label: 'Entry', sub: true, render: (x) => (x.doc_number || x.number) + ' · ' + (x.narration || '') }, { key: 'debit', label: 'In', r: true, render: (x) => (Number(x.debit) ? money(x.debit) : '') }, { key: 'credit', label: 'Out', r: true, value: true, render: (x) => (Number(x.credit) ? money(x.credit) : money(x.debit)) }], r.rows, { empty: empty('check', 'Everything in the books is on the statement') }));
    } else if (tab === 'history') {
      const r = (await api('acc_bank_recons', { p_account: id })).rows;
      host.append(dataView([{ key: 'statement_date', label: 'Statement date', title: true, render: (x) => fmtD(x.statement_date) }, { key: 'items', label: 'Rows cleared', sub: true, render: (x) => x.items + ' rows · by ' + fmtDT(x.created_at) }, { key: 'statement_balance', label: 'Statement balance', r: true, value: true, render: (x) => money(x.statement_balance) }, { key: 'uncleared', label: 'Uncleared', r: true, render: (x) => money(x.uncleared) }], r, { empty: empty('check', 'No reconciliations yet', 'Import a statement, match the rows, then reconcile.') }));
    } else {
      host.append(dataView([
        { key: 'txn_date', label: 'Date', hideMobile: true, render: (x) => fmtD(x.txn_date) },
        { key: 'description', label: 'Description', title: true, render: (x) => h('div', null, h('div', { class: 't' }, x.description || 'Bank row'), isDesk() ? null : h('div', { class: 's' }, fmtD(x.txn_date) + (x.reference ? ' · ' + x.reference : ''))) },
        { key: 'reference', label: 'Reference', render: (x) => x.reference || '' },
        { key: 'status', label: 'Status', badge: true, render: (x) => statusBadge(x.recon_id ? 'reconciled' : x.status) },
        { key: 'debit', label: 'Money out', r: true, render: (x) => (Number(x.debit) ? money(x.debit) : '') },
        { key: 'credit', label: 'Money in', r: true, render: (x) => (Number(x.credit) ? money(x.credit) : '') },
        { key: 'amt', label: '', value: true, hideDesk: true, render: (x) => (Number(x.credit) ? h('span', { class: 'up' }, '+' + inr(x.credit)) : h('span', null, '−' + inr(x.debit))) },
      ], info.rows, { onRow: (x) => bankRowSheet(x, id, () => v.refresh()), sortKey: null, empty: empty('bank', tab === 'unmatched' ? 'Nothing to match' : 'No rows', tab === 'unmatched' ? 'Import a statement to start matching.' : '') }));
    }
  },
});

async function statementImport(accountId, done) {
  const file = h('input', { type: 'file', accept: '.csv,.xlsx,.txt', class: 'input' });
  const out = h('div', { class: 'grid' });
  let table = null, hdr = [], map = {};
  const FIELDS = [['date', 'Date'], ['description', 'Description'], ['reference', 'Reference / cheque no.'], ['debit', 'Withdrawal (debit)'], ['credit', 'Deposit (credit)'], ['amount', 'Amount (single column, − = out)'], ['balance', 'Balance']];
  const guess = (names) => { const g = {}; const find = (re) => names.findIndex((n) => re.test(String(n).toLowerCase())); g.date = find(/date|txn dt|value/); g.description = find(/desc|narration|particular|remark|details/); g.reference = find(/ref|chq|cheque|utr|instr/); g.debit = find(/withdraw|debit|dr\b|paid out/); g.credit = find(/deposit|credit|cr\b|paid in/); g.amount = (g.debit < 0 && g.credit < 0) ? find(/^amount$/) : -1; g.balance = find(/balance/); return g; };
  const draw = () => {
    clear(out);
    if (!table) return;
    const rows = table.slice(1);
    out.append(h('p', { class: 'muted small' }, rows.length + ' rows found. Check that each field points at the right column.'),
      ...FIELDS.map(([k, label]) => { const sel = selectEl([['-1', k === 'amount' ? 'Not used' : (k === 'description' || k === 'reference' || k === 'balance' || k === 'debit' || k === 'credit' ? 'Not used' : 'Choose column')], ...hdr.map((n, i) => [String(i), String(n || 'Column ' + (i + 1))])], String(map[k] ?? -1), { label, onchange: () => { map[k] = Number(sel.value); draw2(); } }); return field(label, sel); }));
    out.append(h('div', { id: 'imp-prev' }));
    draw2();
  };
  const draw2 = () => {
    const prev = $('#imp-prev'); if (!prev) return;
    const rows = table.slice(1, 6);
    clear(prev).append(h('div', { class: 'cap' }, 'Preview of the first rows'), h('div', { class: 'list' }, rows.map((r) => h('div', { class: 'li' }, h('div', { class: 'grow' }, h('div', { class: 't' }, (map.description >= 0 ? r[map.description] : '') || '—'), h('div', { class: 's' }, (map.date >= 0 ? toISO(r[map.date]) || 'check the date' : 'no date column'))), h('div', { class: 'v' }, [map.debit >= 0 ? r[map.debit] : '', map.credit >= 0 ? r[map.credit] : '', map.amount >= 0 ? r[map.amount] : ''].filter(Boolean).join(' / '))))));
  };
  file.onchange = async () => {
    try { table = await readTable(file.files[0]); if (table.length < 2) throw new Error('The file has no rows'); hdr = table[0]; map = guess(hdr); try { const saved = JSON.parse(localStorage.getItem('acc_map_' + accountId) || 'null'); if (saved && saved.hdr === hdr.join('|')) map = saved.map; } catch { /* ignore */ } draw(); } catch (e) { fail(e); table = null; clear(out); }
  };
  sheet({ title: 'Import bank statement', body: h('div', { class: 'grid' }, h('p', { class: 'muted' }, 'Use the CSV or Excel file from your bank’s net banking. Rows already imported are skipped, so importing an overlapping file is safe.'), field('File', file), out), actions: [{ label: 'Import', primary: true, onclick: async (c) => {
    if (!table) { toast('Choose a file first', { err: true }); return false; }
    if (!(map.date >= 0) || (!(map.debit >= 0 || map.credit >= 0 || map.amount >= 0))) { toast('Choose the date column and the amount columns', { err: true }); return false; }
    const rows = table.slice(1).map((r, i) => ({ _row: i + 2, date: toISO(r[map.date]), description: map.description >= 0 ? r[map.description] : '', reference: map.reference >= 0 ? r[map.reference] : '', debit: map.debit >= 0 ? r[map.debit] : '', credit: map.credit >= 0 ? r[map.credit] : '', amount: map.amount >= 0 ? r[map.amount] : '', balance: map.balance >= 0 ? r[map.balance] : '' }));
    let imp = 0, dup = 0, mt = 0, errs = [];
    for (let i = 0; i < rows.length; i += 2000) { const r = await api('acc_bank_import', { p_account: accountId, p_rows: rows.slice(i, i + 2000), p_batch: 'import ' + new Date().toISOString().slice(0, 16) }); imp += r.imported; dup += r.duplicates; mt += r.matched; errs = errs.concat(r.errors); }
    try { localStorage.setItem('acc_map_' + accountId, JSON.stringify({ hdr: hdr.join('|'), map })); } catch { /* ignore */ }
    c(); toast(imp + ' imported, ' + mt + ' matched automatically' + (dup ? ', ' + dup + ' already there' : '') + (errs.length ? ', ' + errs.length + ' skipped' : '')); if (errs.length) await alertBox({ title: errs.length + ' rows skipped', message: errs.slice(0, 5).map((e) => 'Row ' + e.row + ': ' + e.message).join('\n'), cancel: false }); done();
  } }] });
}
async function bankRowSheet(x, accountId, done) {
  const isIn = Number(x.credit) > 0, amount = isIn ? x.credit : x.debit;
  const body = h('div', { class: 'grid' }, h('div', { class: 'card' }, h('div', { class: 'cap' }, fmtD(x.txn_date)), h('div', { class: 't', style: { fontWeight: 600 } }, x.description || 'Bank row'), x.reference ? h('div', { class: 'small muted' }, x.reference) : null, h('div', { style: { fontSize: '24px', fontWeight: 700, marginTop: '6px' } }, (isIn ? '+' : '−') + inr(amount))));
  const acts = [];
  if (x.status === 'matched' && !x.recon_id) acts.push({ label: 'Unmatch', onclick: async (c) => { await api('acc_bank_unmatch', { p_txn: x.id }); c(); done(); } });
  if (x.status === 'ignored') acts.push({ label: 'Restore', onclick: async (c) => { await api('acc_bank_ignore', { p_txn: x.id, p_ignore: false }); c(); done(); } });
  if (x.status === 'unmatched') {
    const lines = (await api('acc_bank_book_lines', { p_account: accountId })).rows.filter((l) => (isIn ? Number(l.debit) === Number(amount) : Number(l.credit) === Number(amount)));
    body.append(h('div', { class: 'sec' }, h('div', { class: 'sec-h' }, h('h3', null, 'Match with an entry in your books')), h('div', { class: 'list' }, lines.length ? lines.map((l) => liRow({ icon: 'link', title: (l.doc_number || l.number), sub: fmtD(l.jdate) + ' · ' + (l.narration || ''), value: money(amount), chevron: true, onclick: async () => { try { await api('acc_bank_match', { p_txn: x.id, p_line: l.id }); s.close(); toast('Matched'); done(); } catch (e) { fail(e); } } })) : [h('div', { class: 'li muted' }, 'No entry for exactly ' + inr(amount) + '. Create one below.')])));
    acts.push({ label: 'Create entry…', primary: true, onclick: (c) => { c(); createBankEntry(x, isIn, done); } }, { label: 'Ignore', onclick: async (c) => { await api('acc_bank_ignore', { p_txn: x.id, p_ignore: true }); c(); done(); } });
  }
  const s = sheet({ title: 'Statement row', closeLabel: 'Close', body, actions: acts });
}
function createBankEntry(x, isIn, done) {
  let party = null;
  const accs = S.accounts.filter((a) => a.active && !a.is_bank && !a.is_cash && !['ar', 'ap', 'inventory'].includes(a.system_key) && (isIn ? ['income', 'liability', 'equity', 'asset'].includes(a.type) : true));
  const acc = selectEl([['', 'Choose account'], ...accs.map((a) => [a.id, a.code + ' ' + a.name])], isIn ? (acctBy('other_income') || {}).id : (acctBy('bank_charges') || {}).id), nt = input({ value: x.description || '' });
  const pb = h('button', { class: 'li', type: 'button', style: { borderRadius: '14px', background: 'var(--card)', boxShadow: '0 0 0 .5px var(--sep)' }, onclick: async () => { const p = await pickParty('any', party && party.id); if (p) { party = p; pb.firstChild.nextSibling.firstChild.textContent = p.name; } } }, icon('user', 18), h('div', { class: 'grow' }, h('div', { class: 't' }, 'Or choose a customer / supplier')), h('span', { class: 'chev' }, icon('chevR', 18)));
  sheet({ title: 'Create entry', body: h('div', { class: 'grid' }, h('p', { class: 'muted' }, 'Book ' + inr(isIn ? x.credit : x.debit) + (isIn ? ' received' : ' paid') + ' on ' + fmtD(x.txn_date) + '. Pick an account (bank charges, interest…) or a party (it becomes a ' + (isIn ? 'receipt' : 'payment') + ' you can allocate later).'), field('Account', acc), pb, field('Narration', nt)),
    actions: [{ label: 'Post and match', primary: true, onclick: async (c) => { if (!acc.value && !party) { toast('Choose an account or a party', { err: true }); return false; } await api('acc_bank_create_entry', { p_txn: x.id, p: { account_id: party ? null : acc.value, party_id: party ? party.id : null, narration: nt.value } }); c(); toast('Entry posted and matched'); done(); } }] });
}
async function reconcileSheet(accountId, done) {
  const dt = dateInput(today()), bal = h('input', { class: 'input', inputmode: 'decimal', placeholder: 'Closing balance on the statement', 'aria-label': 'Statement balance' }), out = h('div', { class: 'grid' });
  const check = async (commit) => {
    if (bal.value === '') { toast('Enter the statement closing balance', { err: true }); return false; }
    const r = await api('acc_bank_reconcile', { p_account: accountId, p_date: dt.value, p_balance: N(bal.value), p_commit: commit });
    clear(out).append(h('div', { class: 'list' }, [['Balance in your books', r.book_balance], ['Statement balance', r.statement_balance], ['+ Deposits in transit', r.deposits_in_transit], ['− Cheques not yet presented', r.cheques_outstanding], ['Adjusted statement balance', r.adjusted_statement]].map(([a, b]) => h('div', { class: 'li' }, h('div', { class: 'grow' }, a), money(b)))),
      h('div', { class: 'banner ' + (r.reconciled ? 'ok' : 'bad') }, icon(r.reconciled ? 'check' : 'alert', 18), r.reconciled ? 'Reconciled. The books agree with the statement.' : r.unmatched_rows ? r.unmatched_rows + ' statement row(s) are still unmatched.' : 'Difference of ' + inr(r.difference) + '. Look for a missing entry or a wrong amount.'));
    return r;
  };
  sheet({ title: 'Reconcile', body: h('div', { class: 'grid' }, h('p', { class: 'muted' }, 'Enter the closing balance shown on your bank statement for a date. We compare it with your books after allowing for cheques and deposits still in transit.'), field('Statement date', dt), field('Closing balance', bal), out),
    actions: [{ label: 'Check', onclick: async () => { await check(false); return false; } }, { label: 'Finish reconciliation', primary: true, onclick: async (c) => { const r = await check(false); if (!r) return false; if (!r.reconciled) { toast('Not reconciled yet', { err: true }); return false; } await api('acc_bank_reconcile', { p_account: accountId, p_date: dt.value, p_balance: N(bal.value), p_commit: true }); c(); toast('Reconciled'); done(); } }] });
}

// ---------- books: chart of accounts, day book ----------
page('books', {
  title: 'Books', icon: 'book', perm: 'acc_view',
  async render(v) {
    const tab = v.q.get('tab') || 'accounts';
    v.header({ title: 'Books', actions: [can('acc_post') ? { label: 'Journal voucher', icon: 'plus', primary: true, run: () => voucherSheet('journal') } : null, can('acc_post') ? { label: 'Transfer money', icon: 'swap', run: () => voucherSheet('contra') } : null, can('acc_admin') ? { label: 'Opening balances', icon: 'scale', run: () => openingBalancesSheet(() => v.refresh()) } : null, can('acc_admin') ? { label: 'New account', icon: 'plus', run: () => accountSheet(null, () => v.refresh()) } : null].filter(Boolean) });
    v.root.append(seg([['accounts', 'Chart of accounts'], ['daybook', 'Day book']], tab, (t) => go('books?tab=' + t)));
    const host = h('div', { class: 'grid' }); v.root.append(host);
    if (tab === 'accounts') {
      const fy = curFY(), tb = await api('acc_trial_balance', { p_from: fy.start_date, p_to: today(), p_all: true });
      const bal = {}; tb.rows.forEach((r) => (bal[r.id] = Number(r.closing)));
      let q = ''; const list = h('div', { class: 'grid' });
      const draw = () => {
        clear(list);
        ['asset', 'liability', 'equity', 'income', 'expense'].forEach((t) => {
          const rows = S.accounts.filter((a) => a.type === t && (!q || a.name.toLowerCase().includes(q.toLowerCase()) || a.code.includes(q)));
          if (!rows.length) return;
          const grps = uniq(rows.map((a) => a.grp));
          list.append(h('div', { class: 'sec' }, h('div', { class: 'sec-h' }, h('h3', null, cap1(t === 'asset' ? 'assets' : t === 'liability' ? 'liabilities' : t === 'equity' ? 'equity' : t === 'income' ? 'income' : 'expenses'))), h('div', { class: 'list' }, grps.map((g) => [h('div', { class: 'li', style: { minHeight: '34px', background: 'var(--card2)' } }, h('div', { class: 'cap', style: { fontWeight: 600 } }, g)), ...rows.filter((a) => a.grp === g).map((a) => { const b = bal[a.id] || 0, nat = t === 'asset' || t === 'expense' ? b : -b; return liRow({ title: a.name, sub: a.code + (a.system_key ? ' · system' : '') + (a.active ? '' : ' · inactive'), value: money(nat, { signed: true }), chevron: true, onclick: () => go('ledger?account=' + a.id) }); })]))));
        });
      };
      host.append(searchField('Search accounts', (x) => { q = x; draw(); }), list); draw();
      host.append(h('p', { class: 'cap' }, 'Balances are for the current financial year (balance-sheet accounts include everything before it).'));
    } else {
      const from = v.q.get('from') || monthStart(), to = v.q.get('to') || today(), type = v.q.get('type') || '';
      const r = await api('acc_daybook', { p_from: from, p_to: to, p_type: type || null });
      const fe = dateInput(from, { onchange: () => go('books?tab=daybook&from=' + fe.value + '&to=' + te.value + '&type=' + ts.value) }), te = dateInput(to, { onchange: () => go('books?tab=daybook&from=' + fe.value + '&to=' + te.value + '&type=' + ts.value) });
      const ts = selectEl([['', 'All vouchers'], 'sales', 'purchase', 'receipt', 'payment', 'contra', 'journal', 'credit_note', 'debit_note', 'expense', 'depreciation', 'opening', 'stock', 'reversal'].map((x) => (Array.isArray(x) ? x : [x, cap1(x)])), type, { label: 'Voucher type', onchange: () => go('books?tab=daybook&from=' + fe.value + '&to=' + te.value + '&type=' + ts.value) });
      host.append(h('div', { class: 'row wrap' }, h('div', { class: 'grow' }, field('From', fe)), h('div', { class: 'grow' }, field('To', te)), h('div', { class: 'grow' }, field('Type', ts))),
        h('div', { class: 'row' }, h('button', { class: 'btn', onclick: (e) => exportMenu(e.currentTarget, 'day-book', ['Date', 'Voucher', 'Type', 'Document', 'Narration', 'Amount'], r.rows.map((x) => [x.jdate, x.number, x.voucher_type, x.doc_number || '', x.narration || '', Number(x.amount)])) }, icon('download', 18), 'Export')),
        dataView([{ key: 'jdate', label: 'Date', title: true, render: (x) => h('div', null, h('div', { class: 't' }, x.doc_number || x.number), h('div', { class: 's' }, fmtD(x.jdate) + ' · ' + cap1(x.voucher_type))) }, { key: 'number', label: 'Voucher', hideMobile: true, render: (x) => x.number }, { key: 'voucher_type', label: 'Type', render: (x) => cap1(x.voucher_type) }, { key: 'doc_number', label: 'Document', render: (x) => x.doc_number || '' },
          { key: 'narration', label: 'Narration', sub: true, render: (x) => x.narration || '' }, { key: 'reversed', label: '', badge: true, render: (x) => (x.reversed ? badge('Reversed') : x.reverses_id ? badge('Reversal') : '') }, { key: 'amount', label: 'Amount', r: true, value: true, render: (x) => money(x.amount), sortVal: (x) => Number(x.amount) }], r.rows, { onRow: (x) => go('journal/' + x.id), sortKey: null, empty: empty('book', 'No vouchers in this period') }));
    }
  },
});
function accountSheet(a, done, preset = {}) {
  const isNew = !a; a = a || preset;
  const code = input({ value: a.code || '', placeholder: 'e.g. 5120' }), nm = input({ value: a.name || '', placeholder: 'Account name' }), type = selectEl([['asset', 'Asset'], ['liability', 'Liability'], ['equity', 'Equity'], ['income', 'Income'], ['expense', 'Expense']], a.type || 'expense'), grp = input({ value: a.grp || '', placeholder: 'Group, e.g. Operating expenses' });
  let bank = !!a.is_bank, cash = !!a.is_cash, act = a.active !== false;
  const locked = !isNew && !!a.system_key;
  sheet({ title: isNew ? 'New account' : 'Edit account', body: h('div', { class: 'grid' }, locked ? h('div', { class: 'banner info' }, icon('info', 18), 'Used by the posting engine. You can rename it but not change its type or deactivate it.') : null, field('Code', code), field('Name', nm), field('Type', type), field('Group', grp),
    type.value === 'asset' || isNew ? toggleRow('Bank account', bank, (x) => { bank = x; if (x) cash = false; }, 'Appears under Bank and cash with statement matching') : null, toggleRow('Cash account', cash, (x) => { cash = x; if (x) bank = false; }), !isNew && !locked ? toggleRow('Active', act, (x) => { act = x; }) : null),
    actions: [{ label: 'Save', primary: true, onclick: async (c) => { if (!code.value.trim() || !nm.value.trim()) { toast('Code and name are required', { err: true }); return false; } await api('acc_save_account', { p: { id: a.id || null, code: code.value, name: nm.value, type: type.value, grp: grp.value, is_bank: bank, is_cash: cash, active: act } }); await loadCtx(); c(); toast('Saved'); done && done(); } }] });
}

// ---------- ledger and journal pages ----------
page('ledger', {
  title: 'Ledger', icon: 'book', nav: false, navAs: 'books',
  async render(v) {
    const aid = v.q.get('account'), pid = v.q.get('party'); if (!aid && !pid) throw new Error('Choose an account or party');
    const from = v.q.get('from') || curFY().start_date, to = v.q.get('to') || today();
    const acct = aid && S.accounts.find((a) => a.id === aid);
    v.header({ title: acct ? acct.name : 'Party ledger', back: () => back('books'), actions: [] });
    const L = await api('acc_ledger', { p: { account_id: aid, party_id: pid, from, to } });
    const fe = dateInput(from), te = dateInput(to); const nav = () => go('ledger?' + (aid ? 'account=' + aid : 'party=' + pid) + '&from=' + fe.value + '&to=' + te.value); fe.onchange = nav; te.onchange = nav;
    v.root.append(h('div', { class: 'row wrap' }, h('div', { class: 'grow' }, field('From', fe)), h('div', { class: 'grow' }, field('To', te))), h('div', { class: 'kpis k3' }, kpi('Opening', inr(L.opening), 'Debit-positive'), kpi('Closing', inr(L.closing), ''), kpi('Entries', String(L.rows.length), '')),
      h('div', { class: 'row' }, h('button', { class: 'btn', onclick: (e) => exportMenu(e.currentTarget, 'ledger-' + (acct ? acct.name : 'party'), ['Date', 'Voucher', 'Document', 'Counter account', 'Narration', 'Debit', 'Credit', 'Balance'], [['', '', '', '', 'Opening balance', '', '', Number(L.opening)], ...L.rows.map((x) => [x.jdate, x.jv, x.doc_number || '', x.counter || '', x.narration || '', Number(x.debit), Number(x.credit), Number(x.balance)])]) }, icon('download', 18), 'Export')),
      dataView([{ key: 'jdate', label: 'Date', title: true, render: (x) => h('div', null, h('div', { class: 't' }, x.doc_number || x.jv), h('div', { class: 's' }, fmtD(x.jdate) + ' · ' + (x.counter || ''))) }, { key: 'jv', label: 'Voucher', render: (x) => x.jv }, { key: 'doc_number', label: 'Document', render: (x) => x.doc_number || '' }, { key: 'counter', label: 'Against', render: (x) => x.counter || '' }, { key: 'narration', label: 'Narration', sub: true, render: (x) => x.narration || '' },
        { key: 'debit', label: 'Debit', r: true, render: (x) => (Number(x.debit) ? money(x.debit) : '') }, { key: 'credit', label: 'Credit', r: true, render: (x) => (Number(x.credit) ? money(x.credit) : '') }, { key: 'balance', label: 'Balance', r: true, value: true, render: (x) => money(x.balance, { signed: true }) }], L.rows,
        { sortKey: null, onRow: (x) => (x.source_type === 'document' ? go('doc/' + x.source_id) : x.source_type === 'payment' ? go('payment/' + x.source_id) : go('journal/' + x.jid)), empty: empty('book', 'No entries in this period') }));
  },
});
page('journal', {
  title: 'Journal', icon: 'book', nav: false, navAs: 'books',
  async render(v) {
    const r = await api('acc_journal_detail', { p_id: v.args[0] }); if (!r) throw new Error('Journal not found');
    const j = r.journal;
    v.header({ title: j.number, back: () => back('books?tab=daybook'), actions: [j.source_type === 'document' ? { label: 'Open document', icon: 'doc', run: () => go('doc/' + j.source_id) } : j.source_type === 'payment' ? { label: 'Open payment', icon: 'wallet', run: () => go('payment/' + j.source_id) } : null].filter(Boolean) });
    const dr = r.lines.reduce((s, l) => s + Number(l.debit), 0), cr = r.lines.reduce((s, l) => s + Number(l.credit), 0);
    v.root.append(h('div', { class: 'card grid', style: { gap: '6px' } }, h('div', { class: 'row sp wrap' }, h('div', null, h('div', { class: 'cap' }, cap1(j.voucher_type) + ' voucher'), h('h2', { style: { fontSize: '22px' } }, j.number)), badge(r.reversal ? 'Reversed' : j.reverses_id ? 'Reversal' : 'Posted', r.reversal ? '' : 'green')), h('div', { class: 'small muted' }, fmtD(j.jdate) + (j.narration ? ' · ' + j.narration : '')),
      r.reversal ? h('div', { class: 'small' }, 'Reversed by ', h('a', { href: '#/journal/' + r.reversal.id }, r.reversal.number)) : null, r.reverses ? h('div', { class: 'small' }, 'Reverses ', h('a', { href: '#/journal/' + r.reverses.id }, r.reverses.number)) : null));
    v.root.append(dataView([{ key: 'account', label: 'Account', title: true, render: (l) => h('div', null, h('div', { class: 't' }, l.account), l.party ? h('div', { class: 's' }, l.party) : null) }, { key: 'code', label: 'Code', render: (l) => l.code }, { key: 'debit', label: 'Debit', r: true, render: (l) => (Number(l.debit) ? money(l.debit) : '') }, { key: 'credit', label: 'Credit', r: true, render: (l) => (Number(l.credit) ? money(l.credit) : '') }, { key: 'amt', label: '', value: true, hideDesk: true, render: (l) => (Number(l.debit) ? 'Dr ' + inr(l.debit) : 'Cr ' + inr(l.credit)) }], r.lines, { sortKey: null, footer: { debit: money(dr), credit: money(cr) } }));
  },
});

// ---------- vouchers ----------
function voucherSheet(type, done) {
  const dt = dateInput(today()), nar = input({ placeholder: type === 'contra' ? 'Narration (optional)' : 'Narration' });
  if (type === 'contra') {
    const pa = payAccounts(), from = selectEl(pa.map((a) => [a.id, a.name]), pa[0] && pa[0].id), to = selectEl(pa.map((a) => [a.id, a.name]), (pa[1] || pa[0] || {}).id), amt = h('input', { class: 'input', inputmode: 'decimal', placeholder: '0.00', 'aria-label': 'Amount' });
    sheet({ title: 'Transfer money', body: h('div', { class: 'grid' }, h('p', { class: 'muted' }, 'Move money between your own cash and bank accounts. No tax or party is involved.'), field('From', from), field('To', to), field('Amount', amt), field('Date', dt), field('Narration', nar)),
      actions: [{ label: 'Transfer', primary: true, onclick: async (c) => { await api('acc_save_voucher', { p: { type: 'contra', from_account: from.value, to_account: to.value, amount: N(amt.value), date: dt.value, narration: nar.value } }); c(); toast('Transferred'); done ? done() : route_(); } }] });
    return;
  }
  const rows = [{ account_id: '', party_id: '', debit: '', credit: '' }, { account_id: '', party_id: '', debit: '', credit: '' }];
  const host = h('div', { class: 'grid' }), foot = h('div', { class: 'row sp', style: { fontWeight: 600 } });
  const accs = S.accounts.filter((a) => a.active && a.system_key !== 'inventory');
  const tot = () => { const d = rows.reduce((s, r) => s + N(r.debit), 0), c = rows.reduce((s, r) => s + N(r.credit), 0); clear(foot).append(h('span', null, 'Debit ' + inr(d)), h('span', null, 'Credit ' + inr(c)), h('span', { class: d === c && d > 0 ? 'up' : 'down' }, d === c && d > 0 ? 'Balanced' : 'Difference ' + inr(d - c))); };
  const draw = () => {
    clear(host);
    rows.forEach((r, i) => {
      const a = S.accounts.find((x) => x.id === r.account_id), needParty = a && (a.system_key === 'ar' || a.system_key === 'ap');
      const as = selectEl([['', 'Choose account'], ...accs.map((x) => [x.id, x.code + ' ' + x.name])], r.account_id, { label: 'Account', onchange: () => { r.account_id = as.value; r.party_id = ''; draw(); } });
      const di = h('input', { class: 'input', inputmode: 'decimal', value: r.debit, placeholder: '0.00', 'aria-label': 'Debit', oninput: () => { r.debit = di.value; if (di.value) { r.credit = ''; ci.value = ''; } tot(); } });
      const ci = h('input', { class: 'input', inputmode: 'decimal', value: r.credit, placeholder: '0.00', 'aria-label': 'Credit', oninput: () => { r.credit = ci.value; if (ci.value) { r.debit = ''; di.value = ''; } tot(); } });
      host.append(h('div', { class: 'card pad-s grid', style: { gap: '8px' } }, h('div', { class: 'row' }, h('div', { class: 'grow' }, as), rows.length > 2 ? h('button', { class: 'btn plain icon', 'aria-label': 'Remove line', onclick: () => { rows.splice(i, 1); draw(); } }, icon('trash', 18)) : null),
        needParty ? h('button', { class: 'li', type: 'button', style: { background: 'var(--fill)', borderRadius: '12px' }, onclick: async () => { const p = await pickParty('any', r.party_id); if (p) { r.party_id = p.id; r._pn = p.name; draw(); } } }, h('div', { class: 'grow' }, r.party_id ? r._pn || 'Party chosen' : 'Choose customer or supplier (required)')) : null,
        h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' } }, field('Debit', di), field('Credit', ci))));
    });
    host.append(h('button', { class: 'btn', type: 'button', onclick: () => { rows.push({ account_id: '', party_id: '', debit: '', credit: '' }); draw(); } }, icon('plus', 18), 'Add line'), foot); tot();
  };
  draw();
  sheet({ title: 'Journal voucher', full: false, body: h('div', { class: 'grid' }, h('p', { class: 'muted small' }, 'For adjustments that have no invoice or payment behind them. The inventory account moves only with stock, so use Stock adjustment for that.'), field('Date', dt), field('Narration', nar), host),
    actions: [{ label: 'Post journal', primary: true, onclick: async (c) => {
      const lines = rows.filter((r) => r.account_id && (N(r.debit) || N(r.credit))).map((r) => ({ account_id: r.account_id, party_id: r.party_id || null, debit: N(r.debit), credit: N(r.credit) }));
      if (lines.length < 2) { toast('A journal needs at least two lines', { err: true }); return false; }
      const d = lines.reduce((s, r) => s + r.debit, 0), cr = lines.reduce((s, r) => s + r.credit, 0);
      if (Math.abs(d - cr) > 0.004) { toast('Debits and credits must be equal (difference ' + inr(d - cr) + ')', { err: true }); return false; }
      if (!(await confirmBox('Post journal of ' + inr(d) + '?', 'It cannot be edited afterwards; only reversed.', 'Post'))) return false;
      const r = await api('acc_save_voucher', { p: { type: 'journal', date: dt.value, narration: nar.value, lines } }); c(); toast('Posted ' + r.number); done ? done() : go('journal/' + r.id);
    } }] });
}
function openingBalancesSheet(done) {
  const accs = S.accounts.filter((a) => a.active && ['asset', 'liability', 'equity'].includes(a.type) && !['ar', 'ap', 'inventory', 'opening_equity'].includes(a.system_key));
  const dt = dateInput(curFY().start_date), vals = {}, diff = h('div', { class: 'banner info' });
  const upd = () => { const n = accs.reduce((s, a) => s + N((vals[a.id] || {}).dr) - N((vals[a.id] || {}).cr), 0); diff.replaceChildren(icon('info', 18), n === 0 ? 'Balanced: nothing goes to Opening balance equity.' : inr(Math.abs(n)) + ' will be posted to “Opening balance equity” to balance the entry.'); };
  sheet({ title: 'Opening balances', full: true, body: h('div', { class: 'grid' }, h('p', { class: 'muted' }, 'Enter what each account held when you started. Customers and suppliers are set on their own page; opening stock is entered through Stock adjustment.'), field('As of', dt), diff,
    h('div', { class: 'list' }, accs.map((a) => h('div', { class: 'li' }, h('div', { class: 'grow' }, h('div', { class: 't' }, a.name), h('div', { class: 's' }, a.code + ' · ' + cap1(a.type))),
      h('input', { class: 'input', style: { width: '112px', textAlign: 'right' }, inputmode: 'decimal', placeholder: 'Debit', 'aria-label': a.name + ' debit', oninput: (e) => { (vals[a.id] = vals[a.id] || {}).dr = e.target.value; upd(); } }), h('input', { class: 'input', style: { width: '112px', textAlign: 'right' }, inputmode: 'decimal', placeholder: 'Credit', 'aria-label': a.name + ' credit', oninput: (e) => { (vals[a.id] = vals[a.id] || {}).cr = e.target.value; upd(); } }))))),
    actions: [{ label: 'Post opening balances', primary: true, onclick: async (c) => {
      const lines = accs.filter((a) => N((vals[a.id] || {}).dr) || N((vals[a.id] || {}).cr)).map((a) => ({ account_id: a.id, debit: N(vals[a.id].dr), credit: N(vals[a.id].cr) }));
      if (!lines.length) { toast('Enter at least one balance', { err: true }); return false; }
      await api('acc_post_opening', { p_date: dt.value, p_lines: lines }); c(); toast('Opening balances posted'); done && done();
    } }] });
  upd();
}

// ---------- fixed assets ----------
page('assets', {
  title: 'Fixed assets', icon: 'building', perm: 'acc_view',
  async render(v) {
    const writable = can('acc_post');
    v.header({ title: 'Fixed assets', actions: [writable ? { label: 'New asset', icon: 'plus', primary: true, run: () => assetSheet(() => v.refresh()) } : null, writable ? { label: 'Run depreciation', icon: 'refresh', run: () => depreciationSheet(() => v.refresh()) } : null].filter(Boolean) });
    const r = await api('acc_list_assets');
    v.root.append(h('div', { class: 'kpis k3' }, kpi('Cost of active assets', inr(r.totals.cost, 0), ''), kpi('Accumulated depreciation', inr(r.totals.accumulated, 0), ''), kpi('Carrying value', inr(Number(r.totals.cost) - Number(r.totals.accumulated), 0), 'Book value today')),
      h('div', { class: 'row' }, h('button', { class: 'btn', onclick: (e) => exportMenu(e.currentTarget, 'asset-register', ['Code', 'Asset', 'Class', 'Purchased', 'Cost', 'Accumulated', 'Carrying value', 'Method', 'Life (yrs)', 'Status', 'Location', 'Custodian'], r.rows.map((a) => [a.code, a.name, a.class || '', a.acquisition_date, Number(a.cost), Number(a.accumulated), Number(a.carrying_value), a.method.toUpperCase(), Number(a.life_years), a.status, a.location || '', a.custodian || ''])) }, icon('download', 18), 'Export register')),
      dataView([{ key: 'name', label: 'Asset', title: true, render: (a) => h('div', null, h('div', { class: 't' }, a.name), h('div', { class: 's' }, a.code + (a.class ? ' · ' + a.class : ''))) }, { key: 'acquisition_date', label: 'Purchased', render: (a) => fmtD(a.acquisition_date) }, { key: 'cost', label: 'Cost', r: true, render: (a) => money(a.cost) }, { key: 'accumulated', label: 'Depreciation', r: true, render: (a) => money(a.accumulated) },
        { key: 'status', label: 'Status', badge: true, render: (a) => badge(cap1(a.status), a.status === 'active' ? 'green' : '') }, { key: 'carrying_value', label: 'Carrying value', r: true, value: true, render: (a) => money(a.carrying_value), sortVal: (a) => Number(a.carrying_value) }], r.rows, { onRow: (a) => assetDetail(a, () => v.refresh()), empty: empty('building', 'No fixed assets', 'Record vehicles, machinery, computers or furniture to track their depreciation.') }));
  },
});
function assetSheet(done) {
  const nm = input({ placeholder: 'e.g. Delivery scooter' }), cl = input({ placeholder: 'e.g. Vehicles' }), dt = dateInput(today()), cost = h('input', { class: 'input', inputmode: 'decimal', placeholder: '0.00', 'aria-label': 'Cost' }), sal = input({ placeholder: '0', mode: 'decimal' }), life = input({ value: '5', mode: 'decimal' }), meth = selectEl([['slm', 'Straight line'], ['wdv', 'Written down value']], 'slm'), rate = input({ placeholder: '15', mode: 'decimal' });
  const pa = selectEl([['', 'Opening balance (already owned)'], ...payAccounts().map((a) => [a.id, 'Paid from ' + a.name])], ''), loc = input({ placeholder: 'Location' }), cu = input({ placeholder: 'Custodian' });
  sheet({ title: 'New fixed asset', body: h('div', { class: 'grid' }, field('Name', nm), field('Class', cl), h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' } }, field('Purchase date', dt), field('Cost', cost)), field('Funded by', pa), h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' } }, field('Residual value', sal), field('Life (years)', life)), field('Method', meth), field('Rate % (written down value)', rate), field('Location', loc), field('Custodian', cu)),
    actions: [{ label: 'Add asset', primary: true, onclick: async (c) => { await api('acc_save_asset', { p: { name: nm.value, class: cl.value, acquisition_date: dt.value, cost: N(cost.value), salvage: N(sal.value), life_years: N(life.value), method: meth.value, rate_pct: rate.value || null, pay_account_id: pa.value || null, location: loc.value, custodian: cu.value } }); c(); toast('Asset added'); done(); } }] });
}
function depreciationSheet(done) {
  const m = input({ type: 'month', value: today().slice(0, 7) });
  sheet({ title: 'Run depreciation', body: h('div', { class: 'grid' }, h('p', { class: 'muted' }, 'Posts one depreciation journal for the month for every active asset. Running a month twice does nothing.'), field('Month', m)), actions: [{ label: 'Run', primary: true, onclick: async (c) => { const r = await api('acc_run_depreciation', { p_month: m.value + '-01' }); c(); toast(r.assets ? 'Depreciation ' + inr(r.amount) + ' for ' + r.assets + ' asset(s)' : 'Nothing to depreciate for that month'); done(); } }] });
}
function assetDetail(a, done) {
  const acts = [];
  if (a.status === 'active' && can('acc_post')) acts.push({ label: 'Dispose or sell…', danger: true, onclick: (c) => { c(); disposeSheet(a, done); } });
  sheet({ title: a.name, closeLabel: 'Close', body: h('div', { class: 'list' }, [['Code', a.code], ['Class', a.class || '—'], ['Purchased', fmtD(a.acquisition_date)], ['Cost', inr(a.cost)], ['Residual value', inr(a.salvage)], ['Method', a.method === 'slm' ? 'Straight line, ' + a.life_years + ' years' : 'Written down value ' + (a.rate_pct || 15) + '%'], ['Accumulated depreciation', inr(a.accumulated)], ['Carrying value', inr(a.carrying_value)], ['Depreciated to', a.depreciated_to ? fmtD(a.depreciated_to) : 'Not yet'], ['Location', a.location || '—'], ['Custodian', a.custodian || '—'], ['Status', a.status === 'disposed' ? 'Disposed ' + fmtD(a.disposal_date) + ' for ' + inr(a.disposal_amount) : 'Active']].map(([k, x]) => h('div', { class: 'li' }, h('div', { class: 'grow muted' }, k), h('div', null, x)))), actions: acts });
}
function disposeSheet(a, done) {
  const dt = dateInput(today()), amt = input({ placeholder: '0 if scrapped', mode: 'decimal' }), acc = selectEl(payAccounts().map((x) => [x.id, x.name]), (payAccounts()[0] || {}).id);
  sheet({ title: 'Dispose of ' + a.name, body: h('div', { class: 'grid' }, h('p', { class: 'muted' }, 'Carrying value is ' + inr(a.carrying_value) + '. Any difference is posted as a gain or loss on disposal.'), field('Date', dt), field('Sale amount', amt), field('Received into', acc)), actions: [{ label: 'Dispose', danger: true, onclick: async (c) => { if (!(await confirmBox('Dispose of ' + a.name + '?', 'This closes the asset and posts the entries.', 'Dispose', true))) return false; const r = await api('acc_dispose_asset', { p_asset: a.id, p_date: dt.value, p_amount: N(amt.value), p_account: acc.value }); c(); toast((Number(r.gain_or_loss) >= 0 ? 'Gain ' : 'Loss ') + inr(Math.abs(r.gain_or_loss))); done(); } }] });
}
