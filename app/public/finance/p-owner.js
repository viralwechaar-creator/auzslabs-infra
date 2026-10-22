/* AUZsFinance: Owner & loans. Capital put in, drawings taken, and loans taken or given with principal and interest kept apart. */
'use strict';
page('owner', { title: 'Owner & loans', async render(v) {
  v.header({ title: 'Owner & loans', actions: [can('admin') ? { label: 'Add owner or partner', icon: 'plus', run: () => partnerSheet() } : null] });
  const [partners, loans] = await Promise.all([api('fin_partner_list'), api('fin_loan_list')]);
  v.root.append(section('Owner and partners', partners.length ? h('div', { class: 'list' }, partners.map((p) => liRow({ icon: 'user', tone: 'gray', title: p.name, value: inr(p.net), onclick: () => partnerDetail(p) })))
    : empty('user', 'No owner added yet', 'Record money you put in or take out and it appears here.', can('write') ? h('button', { class: 'btn fill', onclick: () => addTxn({ kind: 'capital_in' }) }, 'Owner put money in') : null)));
  const open = loans.filter((l) => l.status === 'open'), done = loans.filter((l) => l.status !== 'open');
  const loanRow = (l) => liRow({ icon: 'wallet', tone: 'gray', title: (l.direction === 'taken' ? 'From ' : 'To ') + l.counterparty, value: inr(l.outstanding), onclick: () => loanDetail(l) });
  v.root.append(section('Loans', h('div', { class: 'row', style: { gap: '8px' } }, can('write') ? h('button', { class: 'btn sm', onclick: () => addTxn({ kind: 'loan_taken' }) }, 'Loan received') : null, can('write') ? h('button', { class: 'btn sm', onclick: () => addTxn({ kind: 'loan_given' }) }, 'Loan given') : null),
    open.length ? h('div', { class: 'list' }, open.map(loanRow)) : empty('wallet', 'No open loans', 'Loans you take or give show here with the balance and interest.'),
    done.length ? h('div', { class: 'list' }, done.map(loanRow)) : null));
} });
async function partnerDetail(p) {
  const txns = await api('fin_txn_list', { p: { partner_id: p.id, limit: 100 } });
  const body = h('div', { class: 'grid' }, h('div', { class: 'hero-n small' }, h('div', { class: 'k' }, 'Net capital'), h('div', { class: 'n num' }, inr(p.net))),
    h('div', { class: 'list' }, liRow({ title: 'Put in', value: inr(p.capital) }), liRow({ title: 'Took out', value: inr(p.drawings) }), p.share_pct ? liRow({ title: 'Share of business', value: p.share_pct + '%' }) : null),
    can('write') ? h('div', { class: 'row' }, h('button', { class: 'btn fill grow', onclick: () => { s.close(); addTxn({ kind: 'capital_in', partner_id: p.id }); } }, 'Put money in'), h('button', { class: 'btn grow', onclick: () => { s.close(); addTxn({ kind: 'drawing', partner_id: p.id }); } }, 'Take money out')) : null,
    can('admin') ? h('button', { class: 'btn', onclick: () => { s.close(); partnerSheet(p); } }, 'Edit details') : null,
    section('History', txns.length ? h('div', { class: 'list' }, txns.map((x) => txnRow(x, () => { s.close(); txnSheet(x.id, txns); }))) : empty('swap', 'Nothing yet')));
  const s = sheet({ title: p.name, closeLabel: 'Done', body });
}
function partnerSheet(p) {
  const nm = input({ value: p ? p.name : '', placeholder: 'Name' }), kind = selectEl([['owner', 'Owner'], ['partner', 'Partner'], ['investor', 'Investor']], p ? p.kind : 'owner'), share = input({ type: 'number', mode: 'decimal', value: p && p.share_pct || '', placeholder: 'Share %, optional' });
  sheet({ title: p ? 'Edit' : 'Add owner or partner', closeLabel: 'Cancel', body: h('div', { class: 'grid' }, field('Name', nm), field('Role', kind), field('Share of business (%)', share)),
    actions: [{ label: 'Save', primary: true, onclick: async (close) => { if (!nm.value.trim()) { toast('Enter a name', { err: true }); return false; } await api('fin_save_partner', { p: { id: p && p.id, name: nm.value.trim(), kind: kind.value, share_pct: share.value } }); close(); await reloadCtx(); route_(); } }] });
}
async function loanDetail(l) {
  const txns = await api('fin_txn_list', { p: { loan_id: l.id, limit: 100 } });
  const taken = l.direction === 'taken';
  const body = h('div', { class: 'grid' }, h('div', { class: 'hero-n small' }, h('div', { class: 'k' }, taken ? 'Still owe' : 'To get back'), h('div', { class: 'n num' }, inr(l.outstanding))),
    h('div', { class: 'list' }, liRow({ title: taken ? 'Borrowed' : 'Lent', value: inr(l.principal_total) }), liRow({ title: 'Interest', value: inr(l.interest) }), l.rate_pct ? liRow({ title: 'Rate', value: l.rate_pct + '% a year' }) : null, l.due_date ? liRow({ title: 'Due on', value: fmtD(l.due_date) }) : null),
    can('write') && l.status === 'open' ? h('div', { class: 'row' }, h('button', { class: 'btn fill grow', onclick: () => { s.close(); addTxn({ kind: taken ? 'loan_repay' : 'loan_collect', loan_id: l.id }); } }, taken ? 'Record repayment' : 'Record money back'), h('button', { class: 'btn grow', onclick: () => { s.close(); addTxn({ kind: taken ? 'loan_taken' : 'loan_given', loan_id: l.id }); } }, taken ? 'Borrow more' : 'Lend more')) : null,
    can('write') ? h('button', { class: 'btn', onclick: async () => { await api('fin_save_loan', { p: { id: l.id, counterparty: l.counterparty, status: l.status === 'open' ? 'closed' : 'open' } }); s.close(); await reloadCtx(); route_(); } }, l.status === 'open' ? 'Mark loan as closed' : 'Reopen loan') : null,
    section('History', txns.length ? h('div', { class: 'list' }, txns.map((x) => txnRow(x, () => { s.close(); txnSheet(x.id, txns); }))) : empty('swap', 'Nothing yet')));
  const s = sheet({ title: (taken ? 'Loan from ' : 'Loan to ') + l.counterparty, closeLabel: 'Done', body });
}
