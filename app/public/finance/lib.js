/* AUZsFinance: shared helpers (names for kinds, pickers, formatting). */
'use strict';
const KINDS = {
  money_in:        { label: 'Money received', hint: 'Sales, fees, any money coming in', sign: 1, ic: 'download', acc: 'Received into', cat: 'income', catLabel: 'What for', person: 'opt', personLabel: 'From (optional)' },
  expense:         { label: 'Paid out', hint: 'Rent, stock, salary, any expense', sign: -1, ic: 'cash', acc: 'Paid from', cat: 'expense', catLabel: 'Kind of expense', person: 'opt', personLabel: 'Paid to (optional)' },
  transfer:        { label: 'Move between accounts', hint: 'Cash to bank, bank to cash', sign: 0, ic: 'swap', acc: 'From', to: 'To' },
  capital_in:      { label: 'Owner put money in', hint: 'Capital added by you or a partner', sign: 1, ic: 'plus', acc: 'Received into', partner: true, partnerLabel: 'Who put it in' },
  drawing:         { label: 'Owner took money out', hint: 'Drawings, personal use', sign: -1, ic: 'user', acc: 'Paid from', partner: true, partnerLabel: 'Who took it' },
  loan_taken:      { label: 'Loan received', hint: 'You borrowed money', sign: 1, ic: 'wallet', acc: 'Received into', loan: 'taken' },
  loan_repay:      { label: 'Loan repaid', hint: 'Instalment: principal and interest', sign: -1, ic: 'wallet', acc: 'Paid from', loan: 'taken', interest: true },
  loan_given:      { label: 'Loan given', hint: 'You lent money to someone', sign: -1, ic: 'wallet', acc: 'Paid from', loan: 'given' },
  loan_collect:    { label: 'Loan money back', hint: 'Someone returned what you lent', sign: 1, ic: 'wallet', acc: 'Received into', loan: 'given', interest: true },
  credit_sale:     { label: 'Sold on credit', hint: 'They will pay you later', sign: 0, ic: 'tag', cat: 'income', catLabel: 'What for', person: 'req', personLabel: 'Who owes you', due: true },
  credit_purchase: { label: 'Bought on credit', hint: 'You will pay them later', sign: 0, ic: 'truck', cat: 'expense', catLabel: 'Kind of expense', person: 'req', personLabel: 'Who you owe', due: true },
  dues_in:         { label: 'They paid me', hint: 'A customer cleared their dues', sign: 1, ic: 'check', acc: 'Received into', person: 'req', personLabel: 'Who paid' },
  dues_out:        { label: 'I paid them', hint: 'You cleared what you owed', sign: -1, ic: 'check', acc: 'Paid from', person: 'req', personLabel: 'Who you paid' },
  asset_buy:       { label: 'Bought an asset', hint: 'Machine, furniture, vehicle', sign: -1, ic: 'building', acc: 'Paid from' },
};
const GROUPS = [
  ['Everyday', ['money_in', 'expense', 'transfer']],
  ['Owner and partners', ['capital_in', 'drawing']],
  ['Loans', ['loan_taken', 'loan_repay', 'loan_given', 'loan_collect']],
  ['Credit and dues', ['credit_sale', 'credit_purchase', 'dues_in', 'dues_out']],
  ['Assets', ['asset_buy']],
];
const kindName = (k) => (KINDS[k] || {}).label || k;
const EVIDENCE = { have: 'Bill kept', pending: 'Bill to come', none: 'No bill' };
const todayISO = () => (S.ctx && S.ctx.today) || new Date().toISOString().slice(0, 10);
const fmtD = (s) => s ? new Date(String(s).slice(0, 10) + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
const fmtShort = (s) => s ? new Date(String(s).slice(0, 10) + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '';
const signed = (r) => { const k = KINDS[r.kind] || {}; return k.sign * Number(r.amount) + (r.kind === 'loan_repay' ? -Number(r.interest) : 0) + (r.kind === 'loan_collect' ? Number(r.interest) : 0); };
function amountNode(r) {
  const k = KINDS[r.kind] || {}; let v = Number(r.amount);
  if (r.kind === 'loan_repay') v += Number(r.interest); if (r.kind === 'loan_collect') v += Number(r.interest);
  const cls = r.status === 'reversed' ? 'muted' : k.sign > 0 ? 'up' : k.sign < 0 ? 'down' : '';
  const e = h('span', { class: 'money num ' + cls, style: r.status === 'reversed' ? { textDecoration: 'line-through' } : null }, (k.sign > 0 ? '+' : k.sign < 0 ? '-' : '') + inr(v));
  return e;
}
function txnTitle(r) {
  const who = r.person || r.partner || r.loan || '';
  return (r.purpose || r.category || kindName(r.kind)) + (who && !(r.purpose || '').includes(who) ? ' · ' + who : '');
}
function txnSub(r) {
  const acc = r.kind === 'transfer' ? r.account + ' → ' + r.to_account : (r.account || (r.person ? kindName(r.kind) : ''));
  return [fmtShort(r.txn_date), kindName(r.kind), acc].filter(Boolean).join(' · ');
}
function flags(r) {
  const f = [];
  if (r.status === 'reversed') f.push(badge('Cancelled', 'red'));
  else {
    if (r.review === 'needs_review') f.push(badge('Check', 'orange'));
    if (r.evidence === 'none' && ['expense', 'drawing', 'asset_buy', 'money_in'].includes(r.kind)) f.push(badge('No bill', ''));
    else if (r.evidence === 'pending') f.push(badge('Bill to come', 'blue'));
  }
  return f;
}
function txnRow(r, onclick) {
  return liRow({ icon: (KINDS[r.kind] || {}).ic || 'cash', tone: r.status === 'reversed' ? 'gray' : (KINDS[r.kind] || {}).sign > 0 ? 'green' : (KINDS[r.kind] || {}).sign < 0 ? '' : 'blue', title: txnTitle(r), sub: txnSub(r), value: amountNode(r), valueSub: null, badge: flags(r).length ? h('span', { class: 'flags' }, flags(r)) : null, onclick });
}
function pickOrNew(opts, o) {
  // select of existing + "Add new…" which reveals a name box. get() -> {id} | {name}
  const sel = selectEl([['', o.placeholder || 'Choose…'], ...opts.map((x) => [x.id, x.name]), ['__new', '+ Add new…']], o.value || '', { label: o.label });
  const nm = input({ placeholder: o.newPlaceholder || 'Name', label: 'New name' }); nm.style.display = 'none';
  const extra = o.extra ? o.extra() : null; if (extra) extra.style.display = 'none';
  sel.onchange = () => { const n = sel.value === '__new'; nm.style.display = n ? '' : 'none'; if (extra) extra.style.display = n ? '' : 'none'; if (n) nm.focus(); o.onchange && o.onchange(sel.value); };
  const el = h('div', { class: 'col' }, sel, nm, extra);
  return { el, get: () => sel.value === '__new' ? { name: nm.value.trim(), extra } : sel.value ? { id: sel.value } : null, sel };
}
