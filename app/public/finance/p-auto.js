/* AUZsFinance phase 3: approvals, repeating entries, bank statement import, insights and reminders, bill scanning.
   List rows follow the app rule: icon, name, amount; everything else lives in the sheet that opens. */
'use strict';

// ---------- Approvals ----------
page('approvals', { title: 'Approvals', async render(v) {
  v.header({ title: 'Approvals' });
  const [list, st] = await Promise.all([api('fin_txn_list', { p: { review: 'needs_review', limit: 200 } }), api('fin_settings_get')]);
  const open = list.filter((r) => r.status === 'posted');
  v.root.append(section('Waiting for a check', open.length ? h('div', { class: 'list' }, open.map((r) => txnRow(r, () => approveSheet(r)))) : empty('check', 'Nothing waiting', 'Entries marked "not sure" or above your limit show here.')));
  v.root.append(section('Approval limit', h('div', { class: 'list' }, liRow({ icon: 'lock', tone: 'gray', title: 'Entries from this amount', value: Number(st.approval_limit) ? inr(st.approval_limit) : 'Off', chevron: can('admin'), onclick: can('admin') ? () => limitSheet(st, v) : null }))));
} });
function approveSheet(r) {
  const body = h('div', { class: 'grid' },
    h('div', { class: 'hero-n small' }, h('div', { class: 'k' }, kindName(r.kind)), h('div', { class: 'n num' }, amountNode(r))),
    h('div', { class: 'list' }, liRow({ title: 'Date', value: fmtD(r.txn_date) }), r.account ? liRow({ title: 'Account', value: r.account }) : null, r.person ? liRow({ title: 'Person', value: r.person }) : null, r.purpose ? liRow({ title: 'Note', value: r.purpose }) : null, r.reference ? liRow({ title: 'Reference', value: r.reference }) : null, liRow({ title: 'Proof', value: EVIDENCE[r.evidence] })),
    can('write') ? h('div', { class: 'row' },
      h('button', { class: 'btn fill grow', onclick: async () => { try { await api('fin_mark_txn', { p_id: r.id, p: { review: 'confirmed' } }); toast('Approved'); s.close(); route_(); } catch (e) { fail(e); } } }, 'Approve'),
      h('button', { class: 'btn danger grow', onclick: async () => {
        const why = input({ placeholder: 'Why is it being rejected?', label: 'Reason' });
        const ok = await alertBox({ title: 'Reject this entry?', message: 'It is cancelled and stays in history. Balances go back.', body: why, actions: [{ label: 'Reject', value: true, role: 'danger' }, { label: 'Keep', value: false }], focus: 'input' });
        if (!ok) return; if (!why.value.trim()) return toast('Please give a reason', { err: true });
        try { await api('fin_reverse_txn', { p_id: r.id, p_reason: 'Rejected: ' + why.value.trim() }); toast('Rejected'); s.close(); await reloadCtx(); route_(); } catch (e) { fail(e); } } }, 'Reject')) : null);
  const s = sheet({ title: 'Check this entry', closeLabel: 'Close', body });
}
function limitSheet(st, v) {
  const lim = input({ type: 'number', mode: 'decimal', min: '0', value: Number(st.approval_limit) || '', placeholder: '0 = off', label: 'Approval limit' });
  const days = input({ type: 'number', mode: 'numeric', min: '1', value: st.reminder_days || 7, label: 'Reminder days' });
  sheet({ title: 'Limits', closeLabel: 'Cancel', body: h('div', { class: 'grid' }, field('Entries from this amount wait for a manager', lim, 'Staff who cannot approve save them as "to check". Leave empty to turn off.'), field('Remind about money owed after (days)', days)),
    actions: [{ label: 'Save', primary: true, onclick: async (close) => { try { await api('fin_settings_save', { p: { approval_limit: N(lim.value), reminder_days: Math.round(N(days.value)) || 7 } }); close(); toast('Saved'); v.refresh(); } catch (e) { fail(e); return false; } } }] });
}

// ---------- Repeating entries ----------
const REC_KINDS = ['expense', 'money_in', 'transfer', 'drawing', 'loan_repay', 'dues_out', 'dues_in'];
const FREQ = [['weekly', 'Every week'], ['monthly', 'Every month'], ['yearly', 'Every year']];
page('repeat', { title: 'Repeating', async render(v) {
  v.header({ title: 'Repeating', actions: [can('write') ? { label: 'New repeating entry', icon: 'plus', primary: true, run: () => recSheet(null, v) } : null] });
  if (can('write')) {
    try { const r = await api('fin_recurring_run', { p_to: null }); if (r.posted) toast(r.posted + ' repeating entr' + (r.posted === 1 ? 'y' : 'ies') + ' added'); } catch { /* shown below */ }
  }
  const rows = await api('fin_recurring_list');
  const row = (r) => liRow({ icon: (KINDS[r.kind] || {}).ic || 'refresh', tone: r.active ? 'gray' : 'gray', title: (r.payload && r.payload.purpose) || kindName(r.kind), value: inr(r.amount), chevron: true, onclick: () => recSheet(r, v) });
  const on = rows.filter((r) => r.active), off = rows.filter((r) => !r.active);
  v.root.append(on.length ? h('div', { class: 'list' }, on.map(row)) : empty('refresh', 'Nothing repeats yet', 'Rent, salary, EMI or a subscription: add it once and it is entered for you.', can('write') ? h('button', { class: 'btn fill', onclick: () => recSheet(null, v) }, 'New repeating entry') : null));
  if (off.length) v.root.append(section('Paused', h('div', { class: 'list' }, off.map(row))));
} });
function recSheet(r, v) {
  if (!can('write')) return;
  const accounts = S.ctx.accounts.filter((a) => a.active);
  const pay = (r && r.payload) || {};
  const kind = selectEl(REC_KINDS.map((k) => [k, kindName(k)]), r ? r.kind : 'expense', { label: 'What' });
  const amount = input({ type: 'number', mode: 'decimal', min: '0', step: '0.01', value: r ? r.amount : '', placeholder: '0', label: 'Amount' });
  const freq = selectEl(FREQ, r ? r.freq : 'monthly', { label: 'How often' });
  const start = input({ type: 'date', value: r ? String(r.next_date).slice(0, 10) : todayISO() });
  const end = input({ type: 'date', value: r && r.end_date ? String(r.end_date).slice(0, 10) : '' });
  const acc = selectEl(accounts.map((a) => [a.id, a.name]), pay.account_id || (accounts[0] || {}).id, { label: 'Account' });
  const cat = selectEl([['', 'General'], ...S.ctx.categories.expense.map((c) => [c.id, c.name])], pay.category_id || '', { label: 'Kind of expense' });
  const note = input({ placeholder: 'e.g. Shop rent', value: pay.purpose || '', label: 'Note' });
  const auto = h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: r ? r.auto : true }), h('span', null, 'Enter it as confirmed. Untick to have each one wait for a check.'));
  const body = h('div', { class: 'grid' }, field('What', kind), field('Amount', amount), field('How often', freq), field(r ? 'Next on' : 'First on', start), field('Last on (optional)', end), field('Account', acc), field('Kind of expense', cat), field('Note', note), auto);
  const save = async (extra) => {
    const a = N(amount.value); if (a <= 0) { toast('Enter an amount above zero', { err: true }); return false; }
    const payload = { account_id: acc.value, purpose: note.value.trim() }; if (cat.value && kind.value === 'expense') payload.category_id = cat.value;
    if (kind.value === 'transfer') { const to = accounts.find((x) => x.id !== acc.value); if (!to) { toast('Add a second account first', { err: true }); return false; } payload.to_account_id = to.id; }
    await api('fin_recurring_save', { p: { id: r && r.id, kind: kind.value, amount: a, freq: freq.value, start_date: start.value, end_date: end.value || null, auto: auto.querySelector('input').checked, payload, ...(extra || {}) } });
    return true;
  };
  const actions = [{ label: 'Save', primary: true, onclick: async (close) => { try { if (!await save()) return false; close(); toast('Saved'); v.refresh(); } catch (e) { fail(e); return false; } } }];
  if (r) actions.push({ label: r.active ? 'Pause' : 'Resume', onclick: async (close) => { try { await api('fin_recurring_stop', { p_id: r.id, p_active: !r.active }); close(); v.refresh(); } catch (e) { fail(e); return false; } } });
  sheet({ title: r ? 'Repeating entry' : 'New repeating entry', closeLabel: 'Cancel', body, actions });
}

// ---------- Bank statement import ----------
function csvRows(text) {
  const out = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ',' || c === '\t' || c === ';') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); cur = ''; if (row.some((x) => x.trim())) out.push(row); row = []; }
    else cur += c;
  }
  row.push(cur); if (row.some((x) => x.trim())) out.push(row);
  return out;
}
function statementDate(s) {
  s = String(s || '').trim(); let m;
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return m[1] + '-' + m[2].padStart(2, '0') + '-' + m[3].padStart(2, '0');
  if ((m = s.match(/^(\d{1,2})[\/\-. ](\d{1,2})[\/\-. ](\d{2,4})/))) { let y = m[3]; if (y.length === 2) y = '20' + y; return y + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0'); }
  const d = new Date(s); return isNaN(d) ? '' : d.toISOString().slice(0, 10);
}
function statementRows(text) {
  const t = csvRows(text); if (t.length < 2) return [];
  let hi = t.findIndex((r) => r.some((c) => /date/i.test(c)) && r.some((c) => /(debit|withdraw|credit|deposit|amount|dr|cr)/i.test(c)));
  if (hi < 0) hi = 0;
  const head = t[hi].map((c) => c.trim().toLowerCase());
  const at = (re) => head.findIndex((c) => re.test(c));
  const iD = at(/date/), iDesc = at(/(narration|description|particular|remark|detail)/), iRef = at(/(ref|chq|cheque|utr|txn id|transaction id)/);
  const iDr = at(/(debit|withdraw|\bdr\b)/), iCr = at(/(credit|deposit|\bcr\b)/), iAmt = at(/^amount/);
  const num = (x) => { const n = parseFloat(String(x || '').replace(/[,\s₹]/g, '')); return Number.isFinite(n) ? Math.abs(n) : 0; };
  return t.slice(hi + 1).map((r) => {
    const o = { date: statementDate(r[iD]), desc: (r[iDesc] || '').trim(), ref: (r[iRef] || '').trim() };
    if (iDr >= 0 || iCr >= 0) { o.debit = num(r[iDr]); o.credit = num(r[iCr]); }
    else if (iAmt >= 0) { const raw = String(r[iAmt] || ''); const n = num(raw); if (/-|dr/i.test(raw)) o.debit = n; else o.credit = n; }
    return o;
  }).filter((o) => o.date && (o.debit || o.credit));
}
page('bank', { title: 'Bank import', perm: 'write', async render(v) {
  v.header({ title: 'Bank import' });
  const accounts = S.ctx.accounts.filter((a) => a.active && a.kind !== 'cash');
  if (!accounts.length) return v.root.append(empty('cash', 'Add a bank account first', 'Accounts is where you add one.', h('button', { class: 'btn fill', onclick: () => go('accounts') }, 'Open Accounts')));
  const acc = selectEl(accounts.map((a) => [a.id, a.name]), accounts[0].id, { label: 'Bank account' });
  const file = h('input', { type: 'file', accept: '.csv,.txt,text/csv', style: { display: 'none' } });
  const out = h('div', { class: 'grid' });
  const pick = h('button', { class: 'btn fill', onclick: () => file.click() }, icon('download', 18), 'Choose statement file (CSV)');
  v.root.append(h('div', { class: 'grid' }, field('Bank account', acc, 'Download the statement from your bank as CSV. Nothing is added until you confirm.'), pick, file, out));
  file.onchange = async () => {
    const f = file.files[0]; if (!f) return; clear(out);
    let rows; try { rows = statementRows(await f.text()); } catch (e) { return fail(e); }
    if (!rows.length) return out.append(empty('alert', 'No rows found', 'The file needs a date column and debit/credit (or amount) columns.'));
    if (rows.length > 2000) rows = rows.slice(0, 2000), toast('Only the first 2000 rows are used', { err: true });
    let pv; try { pv = await api('fin_import_preview', { p_account: acc.value, p_rows: rows }); } catch (e) { return fail(e); }
    const items = pv.rows.map((x, i) => ({ ...rows[i], status: x.status, txn_id: x.txn_id, txn_title: x.txn_title, amount: x.amount }));
    const cnt = (s) => items.filter((x) => x.status === s).length;
    const row = (x) => liRow({ icon: x.status === 'matched' ? 'check' : x.status === 'new' ? 'plus' : 'swap', tone: 'gray', title: (x.desc || 'Entry') + ' · ' + fmtShort(x.date), value: h('span', { class: 'money num ' + (x.amount > 0 ? 'up' : 'down') }, (x.amount > 0 ? '+' : '-') + inr(Math.abs(x.amount))), onclick: () => rowSheet(x) });
    const rowSheet = (x) => sheet({ title: x.desc || 'Statement row', closeLabel: 'Close', body: h('div', { class: 'list' }, liRow({ title: 'Date', value: fmtD(x.date) }), x.ref ? liRow({ title: 'Reference', value: x.ref }) : null,
      liRow({ title: 'What will happen', value: x.status === 'matched' ? 'Ticked against "' + (x.txn_title || 'your entry') + '"' : x.status === 'new' ? 'Added as a new entry to check' : x.status === 'duplicate' ? 'Already imported, skipped' : 'Skipped' })) });
    clear(out).append(
      h('div', { class: 'trio' }, h('div', null, h('div', { class: 'k' }, 'Matched'), h('div', { class: 'n num' }, cnt('matched'))), h('div', null, h('div', { class: 'k' }, 'New'), h('div', { class: 'n num' }, cnt('new'))), h('div', null, h('div', { class: 'k' }, 'Skipped'), h('div', { class: 'n num' }, cnt('duplicate') + cnt('skip')))),
      h('div', { class: 'list' }, items.map(row)),
      h('button', { class: 'btn fill', onclick: async (ev) => {
        const b = ev.currentTarget; b.disabled = true;
        try {
          const send = items.map((x) => ({ date: x.date, desc: x.desc, ref: x.ref, debit: x.debit || 0, credit: x.credit || 0, action: x.status === 'matched' ? 'match' : x.status === 'new' ? 'new' : 'skip', txn_id: x.txn_id }));
          const r = await api('fin_import_commit', { p_account: acc.value, p_rows: send });
          toast(r.matched + ' matched, ' + r.created + ' added'); await reloadCtx(); go('activity?review=needs_review');
        } catch (e) { fail(e); b.disabled = false; }
      } }, 'Import ' + (cnt('matched') + cnt('new')) + ' rows'));
  };
} });

// ---------- Insights: reminders, things that look wrong, cash outlook ----------
page('insights', { title: 'Insights', async render(v) {
  v.header({ title: 'Insights' });
  const [fc, an, rem] = await Promise.all([api('fin_forecast'), api('fin_anomalies'), api('fin_reminders')]);
  v.root.append(h('div', { class: 'hero-n' }, h('div', { class: 'k' }, 'Money in 30 days, at this pace'), h('div', { class: 'n num ' + (Number(fc.cash_in_30) < 0 ? 'down' : '') }, inr(fc.cash_in_30)), h('div', { class: 'small muted' }, 'Now ' + inr(fc.cash_now))));
  v.root.append(section('Outlook', h('div', { class: 'list' },
    liRow({ icon: 'download', tone: 'green', title: 'Comes in each day', value: inr(fc.avg_in_per_day) }), liRow({ icon: 'upload', tone: '', title: 'Goes out each day', value: inr(fc.avg_out_per_day) }),
    liRow({ icon: 'users', tone: 'gray', title: 'To receive', value: inr(fc.to_receive), onclick: () => go('dues') }), liRow({ icon: 'users', tone: 'gray', title: 'To pay', value: inr(fc.to_pay), onclick: () => go('dues') }),
    Number(fc.recurring_out_30) || Number(fc.recurring_in_30) ? liRow({ icon: 'refresh', tone: 'gray', title: 'Repeating next 30 days', value: inr(Number(fc.recurring_in_30) - Number(fc.recurring_out_30)), onclick: () => go('repeat') }) : null,
    fc.runway_days != null ? liRow({ icon: 'alert', tone: 'orange', title: 'Cash lasts about', value: fc.runway_days + ' days' }) : null)));
  v.root.append(section('Worth a look', an.length ? h('div', { class: 'list' }, an.map((a) => liRow({ icon: 'alert', tone: a.tone || 'orange', title: a.title, value: a.amount != null ? inr(Math.abs(a.amount)) : '', onclick: () => anomalySheet(a) }))) : empty('check', 'Nothing looks wrong', 'Doubles, unusually big bills, missing proof and overdue loans show here.')));
  v.root.append(section('Money to ask for', rem.length ? h('div', { class: 'list' }, rem.map((p) => liRow({ icon: 'user', tone: 'gray', title: p.name, value: inr(p.amount), chevron: true, onclick: () => remindSheet(p) }))) : empty('check', 'No one is late', 'People who owe you for longer than your reminder days show here.')));
} });
function anomalySheet(a) {
  const ids = a.txn_ids || [];
  const body = h('div', { class: 'grid' }, a.amount != null ? h('div', { class: 'hero-n small' }, h('div', { class: 'k' }, a.title), h('div', { class: 'n num' }, inr(Math.abs(a.amount)))) : h('p', null, a.title),
    a.detail ? h('p', { class: 'muted' }, a.detail) : null, a.date ? h('div', { class: 'list' }, liRow({ title: 'Date', value: fmtD(a.date) })) : null,
    ids.length ? h('button', { class: 'btn fill', onclick: async () => { s.close(); try { const l = await api('fin_txn_list', { p: { limit: 500 } }); const x = l.find((r) => r.id === ids[0]); if (x) txnSheet(x.id, l); } catch (e) { fail(e); } } }, 'Open the entry') : null);
  const s = sheet({ title: 'Look at this', closeLabel: 'Close', body });
}
function remindSheet(p) {
  const wa = p.phone ? 'https://wa.me/' + (String(p.phone).replace(/\D/g, '').length === 10 ? '91' : '') + String(p.phone).replace(/\D/g, '') + '?text=' + encodeURIComponent('Hello ' + p.name + ', a reminder that ' + inr(p.amount) + ' is pending. Thank you.') : null;
  const body = h('div', { class: 'grid' }, h('div', { class: 'hero-n small' }, h('div', { class: 'k' }, p.name + ' owes you'), h('div', { class: 'n num' }, inr(p.amount))),
    h('div', { class: 'list' }, liRow({ title: 'Oldest entry', value: p.age_days + ' days ago' }), p.phone ? liRow({ title: 'Phone', value: p.phone }) : liRow({ title: 'No phone number saved' })),
    p.phone && can('write') ? h('button', { class: 'btn fill', onclick: async () => { try { const r = await api('fin_send_reminder', { p_person: p.id }); toast(r.sent ? 'Reminder sent' : r.reason === 'off' ? 'WhatsApp messages are off for this business' : r.reason === 'already_sent' ? 'Already sent today' : 'Could not send'); } catch (e) { fail(e); } } }, 'Send WhatsApp reminder') : null,
    wa ? h('a', { class: 'btn', href: wa, target: '_blank', rel: 'noopener' }, 'Open in WhatsApp') : null);
  sheet({ title: 'Remind', closeLabel: 'Close', body });
}

// ---------- Scan a bill (used from Add entry) ----------
let docReadP;
function loadBillReader() { return window.auzDocRead ? Promise.resolve() : (docReadP = docReadP || new Promise((res, rej) => { const s = document.createElement('script'); s.src = '/ds/docread.js?v=2'; s.onload = res; s.onerror = () => rej(new Error('Could not load the bill reader')); document.head.appendChild(s); })); }
async function scanBill(file) {
  await loadBillReader();
  const ex = await auzDocRead.extract(file);
  const d = auzDocRead.parseInvoice(ex.text || '', {});
  const total = d.total || d.subtotal || 0;
  return { amount: total || '', date: d.date || '', purpose: [d.supplier && d.supplier.name, d.invoice_no ? 'Bill ' + d.invoice_no : ''].filter(Boolean).join(' · '), notes: d.notes || [] };
}
