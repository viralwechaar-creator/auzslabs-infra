/* Finance: Activity (ported from AUZsFinance's p-activity.js) -- every entry, filters, and the entry detail
   sheet. Nothing is ever deleted: a wrong entry is cancelled (reversed) and can be re-entered. */
'use strict';
let FIN_ACT = { q: '', kind: '', review: '', evidence: '', from: '', to: '' };
page('fin-activity', { title: 'Cash entries', icon: 'swap', async render(v) {
  await ensureFin();
  ['review', 'evidence'].forEach((k) => { if (v.q.get(k)) FIN_ACT[k] = v.q.get(k); });
  v.header({ title: 'Cash entries', actions: [canFin('write') ? { label: 'Add entry', icon: 'plus', primary: true, run: () => addTxn() } : null, { label: 'Export', icon: 'download', run: () => exportCsv() }] });
  const list = h('div'); let rows = [];
  const chipsEl = h('div', { class: 'chips' });
  const FILT = [['', 'All'], ['review:needs_review', 'To check'], ['evidence:none', 'No proof'], ['evidence:pending', 'Bill to come'], ['kind:expense', 'Paid out'], ['kind:money_in', 'Received'], ['kind:drawing', 'Owner took'], ['kind:capital_in', 'Owner put in']];
  const cur = () => FIN_ACT.review ? 'review:' + FIN_ACT.review : FIN_ACT.evidence ? 'evidence:' + FIN_ACT.evidence : FIN_ACT.kind ? 'kind:' + FIN_ACT.kind : '';
  const paintChips = () => { clear(chipsEl).append(...FILT.map(([k, l]) => h('button', { class: 'chip', type: 'button', 'aria-pressed': String(cur() === k), onclick: () => { FIN_ACT.review = FIN_ACT.evidence = FIN_ACT.kind = ''; if (k) { const [a, b] = k.split(':'); FIN_ACT[a] = b; } paintChips(); load(); } }, l))); };
  const load = async () => {
    clear(list).append(h('div', { class: 'skel', style: { height: '120px' } }));
    rows = await api('fin_txn_list', { p: { q: FIN_ACT.q, kind: FIN_ACT.kind, review: FIN_ACT.review, evidence: FIN_ACT.evidence, limit: 300 } });
    clear(list).append(rows.length ? h('div', { class: 'list' }, rows.map((r) => txnRow(r, () => finTxnSheet(r.id, rows)))) : empty('swap', 'No entries', FIN_ACT.q || cur() ? 'Nothing matches this filter.' : 'Entries show here as you add them.'));
    if (cur()) return;
    let feed = []; try { feed = await api('fin_ledger_feed', { p: { q: FIN_ACT.q, limit: 60 } }); } catch (e) { feed = []; }
    if (feed.length) list.append(h('div', { class: 'sec' }, h('div', { class: 'sec-h' }, h('h3', null, 'From AUZsLedger')), h('div', { class: 'list' }, feed.map((f) => liRow({ icon: FIN_LEDGER_IC[f.kind] || 'doc', tone: f.status === 'cancelled' ? 'gray' : 'blue', title: finLedgerTitle(f), value: h('span', { class: 'num' }, inr(f.amount)), chevron: true, onclick: () => finLedgerSheet(f) })))));
  };
  const search = searchField('Search notes', debounce((x) => { FIN_ACT.q = x; load(); }, 300), FIN_ACT.q);
  v.root.append(search, chipsEl, list); paintChips(); await load();
  if (v.q.get('open')) finTxnSheet(v.q.get('open'), rows).catch(() => {});
  async function exportCsv() {
    const all = await api('fin_txn_list', { p: { limit: 500 } });
    const head = ['Date', 'Type', 'Amount', 'Interest', 'Account', 'To account', 'Category', 'Person', 'Owner/partner', 'Loan', 'Reference', 'Paid by', 'Party', 'Party GST', 'Note', 'Proof', 'Review', 'Status'];
    const q = (x) => '"' + String(x == null ? '' : x).replace(/"/g, '""') + '"';
    const csv = '﻿' + [head, ...all.map((r) => [r.txn_date, kindName(r.kind), r.amount, r.interest, r.account, r.to_account, r.category, r.person, r.partner, r.loan, r.reference, modeName(r.method), r.party_name, r.party_gstin, r.purpose, EVIDENCE[r.evidence], r.review === 'needs_review' ? 'Needs check' : 'OK', r.status])].map((l) => l.map(q).join(',')).join('\n');
    const a = h('a', { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })), download: 'finance-entries.csv' }); document.body.append(a); a.click(); a.remove();
  }
} });

async function finTxnSheet(id, known) {
  let r = (known || []).find((x) => x.id === id);
  if (!r) { const l = await api('fin_txn_list', { p: { limit: 500 } }); r = l.find((x) => x.id === id); }
  if (!r) return toast('Entry not found', { err: true });
  const K = KINDS[r.kind] || {};
  const row = (a, b) => b ? liRow({ title: a, value: b }) : null;
  const file = h('input', { type: 'file', accept: 'image/*,application/pdf', style: { display: 'none' } });
  file.onchange = async () => { if (!file.files[0]) return; try { await uploadEvidence(r.id, file.files[0]); toast('Attached'); s.close(); route_(); } catch (e) { fail(e); } };
  const body = h('div', { class: 'grid' },
    h('div', { class: 'hero-n small' }, h('div', { class: 'k' }, K.label), h('div', { class: 'n num' }, amountNode(r)), r.status === 'reversed' ? h('div', { class: 'small muted' }, 'Cancelled: ' + (r.reversed_reason || '')) : null),
    h('div', { class: 'list' }, row('Date', fmtD(r.txn_date)), row('Time', r.created_at ? new Date(r.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : ''), row('Type', K.label), row('Reference / UTR', r.reference), row('Paid by', modeName(r.method)), row('Cheque number', r.cheque_no), row('Cheque date', r.cheque_date ? fmtD(r.cheque_date) : ''), row('Cheque bank', r.cheque_bank),
      row(['money_in', 'credit_sale', 'dues_in'].includes(r.kind) ? 'Who paid' : 'Paid to', r.party_name), row('GST number', r.party_gstin), row('Why it is earlier', r.early_reason ? (EARLY.find((x) => x[0] === r.early_reason) || [0, r.early_reason])[1] : ''),
      row('Account', r.kind === 'transfer' ? r.account + ' → ' + r.to_account : r.account), row('Category', r.category), row('Person', r.person), row('Owner / partner', r.partner), row('Loan', r.loan),
      Number(r.interest) ? row('Interest', inr(r.interest)) : null, row('Note', r.purpose), row('Due date', r.due_date ? fmtD(r.due_date) : ''), Number(r.tax_rate) ? row('GST', Number(r.tax_rate) + '% included') : null, Number(r.tds_amt) ? row('TDS cut', inr(r.tds_amt)) : null, row('Proof', EVIDENCE[r.evidence]), row('Review', r.review === 'needs_review' ? 'Needs a check' : 'Confirmed'), row('Journal', r.journal_no)),
    r.files && r.files.length ? section('Proof files', h('div', { class: 'list' }, r.files.map((f) => liRow({ icon: 'eye', tone: 'gray', title: f.name, chevron: true, onclick: () => openEvidence(f).catch(fail) })))) : null,
    canFin('write') && r.status === 'posted' ? h('div', { class: 'col' },
      h('button', { class: 'btn', onclick: () => file.click() }, icon('camera', 18), 'Add photo or file'), file,
      r.review === 'needs_review' ? h('button', { class: 'btn', onclick: async () => { try { await api('fin_mark_txn', { p_id: r.id, p: { review: 'confirmed' } }); toast('Confirmed'); s.close(); route_(); } catch (e) { fail(e); } } }, icon('check', 18), 'Mark as checked') : h('button', { class: 'btn', onclick: async () => { try { await api('fin_mark_txn', { p_id: r.id, p: { review: 'needs_review' } }); toast('Marked to check'); s.close(); route_(); } catch (e) { fail(e); } } }, icon('alert', 18), 'Ask for a check'),
      h('button', { class: 'btn', onclick: async () => { const v = input({ value: r.reference || '', placeholder: 'UTR or reference number', label: 'Reference' }); const ok = await alertBox({ title: 'Reference or UTR', message: 'Bank or UPI reference for this entry.', body: v, actions: [{ label: 'Save', value: true, role: 'primary' }, { label: 'Cancel', value: false }], focus: 'input' }); if (!ok) return; try { await api('fin_mark_txn', { p_id: r.id, p: { reference: v.value } }); toast('Saved'); s.close(); route_(); } catch (e) { fail(e); } } }, icon('edit', 18), r.reference ? 'Change reference' : 'Add reference / UTR'),
      r.evidence !== 'have' && r.evidence !== 'pending' ? h('button', { class: 'btn', onclick: async () => { try { await api('fin_mark_txn', { p_id: r.id, p: { evidence: 'pending' } }); s.close(); route_(); } catch (e) { fail(e); } } }, 'Bill will come later') : null,
      h('button', { class: 'btn', onclick: async () => { if (!await confirmBox('Correct this entry?', 'The old entry is cancelled (kept in history) and a new one opens with the same details for you to fix.', 'Correct')) return; try { await api('fin_reverse_txn', { p_id: r.id, p_reason: 'Corrected' }); s.close(); addTxn({ kind: r.kind, amount: r.amount, interest: r.interest, date: r.txn_date, account_id: r.account_id, to_account_id: r.to_account_id, category_id: r.category_id, person_id: r.person_id, partner_id: r.partner_id, loan_id: r.loan_id, purpose: r.purpose, evidence: r.evidence }); } catch (e) { fail(e); } } }, icon('edit', 18), 'Correct this entry'),
      h('button', { class: 'btn danger', onclick: async () => {
        const why = input({ placeholder: 'Why is it being cancelled?', label: 'Reason' });
        const ok = await alertBox({ title: 'Cancel this entry?', message: 'It stays in history, marked cancelled, and balances go back as if it never happened.', body: why, actions: [{ label: 'Cancel entry', value: true, role: 'danger' }, { label: 'Keep', value: false }], focus: 'input' });
        if (!ok) return; if (!why.value.trim()) return toast('Please give a reason', { err: true });
        try { await api('fin_reverse_txn', { p_id: r.id, p_reason: why.value.trim() }); toast('Cancelled'); s.close(); await reloadFin(); route_(); } catch (e) { fail(e); } } }, icon('trash', 18), 'Cancel this entry')) : null);
  const s = sheet({ title: 'Entry', closeLabel: 'Done', body });
}

const FIN_LEDGER_IC = { invoice: 'receipt', bill: 'doc', expense: 'cash', credit_note: 'swap', debit_note: 'swap', receipt: 'cash', payment: 'cash' };
const FIN_LEDGER_NAME = { invoice: 'Sales bill', bill: 'Purchase bill', expense: 'Expense', credit_note: 'Credit note', debit_note: 'Debit note', receipt: 'Money received', payment: 'Money paid' };
function finLedgerTitle(f) { return (FIN_LEDGER_NAME[f.kind] || f.kind) + ' · ' + (f.party || f.number); }
function finLedgerSheet(f) {
  const row = (a, b) => b ? liRow({ title: a, value: b }) : null;
  const body = h('div', { class: 'grid' },
    h('div', { class: 'hero-n small' }, h('div', { class: 'k' }, FIN_LEDGER_NAME[f.kind] || f.kind), h('div', { class: 'n num' }, inr(f.amount)), f.status === 'cancelled' ? h('div', { class: 'small muted' }, 'Cancelled') : null),
    h('div', { class: 'list' }, row('Number', f.number), row('Date', fmtD(f.txn_date)), row('Party', f.party), row('Account', f.account), row('Paid by', modeName(f.mode)), row('Reference / UTR', f.reference), row('Settled', Number(f.paid) ? inr(f.paid) : '')),
    h('div', { class: 'banner info' }, icon('info', 18), 'This entry was made in AUZsLedger’s own books (Sales / Purchases). Open that section to edit, cancel or share it.'),
    null);
  sheet({ title: 'From AUZsLedger', closeLabel: 'Done', body });
}
