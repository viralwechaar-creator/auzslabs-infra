/* AUZsFinance: Accounts (where money sits) and Settings (books health). */
'use strict';
page('accounts', { title: 'Accounts', async render(v) {
  v.header({ title: 'Accounts', actions: [can('admin') ? { label: 'Add account', icon: 'plus', primary: true, run: () => accountSheet() } : null] });
  await reloadCtx();
  const tot = S.ctx.accounts.filter((a) => a.active).reduce((x, a) => x + Number(a.balance), 0);
  v.root.append(h('div', { class: 'hero-n' }, h('div', { class: 'k' }, 'Total in all accounts'), h('div', { class: 'n num' }, inr(tot))),
    h('div', { class: 'list' }, S.ctx.accounts.map((a) => liRow({ icon: a.kind === 'cash' ? 'cash' : 'building', tone: 'gray', title: a.name, sub: a.kind + (a.active ? '' : ' · hidden'), value: inr(a.balance), chevron: true, onclick: () => accountDetail(a) }))));
  if (can('write') && S.ctx.accounts.length > 1) v.root.append(h('button', { class: 'btn', onclick: () => addTxn({ kind: 'transfer' }) }, icon('swap', 18), 'Move money between accounts'));
} });
async function accountDetail(a) {
  const txns = await api('fin_txn_list', { p: { account_id: a.id, limit: 100 } });
  const body = h('div', { class: 'grid' }, h('div', { class: 'hero-n small' }, h('div', { class: 'k' }, a.name), h('div', { class: 'n num' }, inr(a.balance))),
    can('admin') ? h('button', { class: 'btn', onclick: () => { s.close(); accountSheet(a); } }, 'Rename or hide') : null,
    section('Entries', txns.length ? h('div', { class: 'list' }, txns.map((x) => txnRow(x, () => { s.close(); txnSheet(x.id, txns); }))) : empty('swap', 'Nothing yet')));
  const s = sheet({ title: a.name, closeLabel: 'Done', body });
}
function accountSheet(a) {
  const nm = input({ value: a ? a.name : '', placeholder: 'e.g. HDFC current account' });
  const kind = a ? null : selectEl([['bank', 'Bank account'], ['cash', 'Cash'], ['upi', 'UPI or wallet'], ['card', 'Card']], 'bank');
  const open = a ? null : input({ type: 'number', mode: 'decimal', step: '0.01', placeholder: '0' });
  const od = a ? null : input({ type: 'date', value: todayISO() });
  const act = a ? h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: a.active }), h('span', null, 'Show this account')) : null;
  sheet({ title: a ? 'Edit account' : 'Add account', closeLabel: 'Cancel', body: h('div', { class: 'grid' }, field('Name', nm), kind ? field('Kind', kind) : null, open ? field('Money in it today', open, 'Counted as the opening balance.') : null, od ? field('As on', od) : null, act),
    actions: [{ label: 'Save', primary: true, onclick: async (close) => { if (!nm.value.trim()) { toast('Enter a name', { err: true }); return false; }
      await api('fin_save_account', { p: a ? { id: a.id, name: nm.value.trim(), active: act.querySelector('input').checked } : { name: nm.value.trim(), kind: kind.value, opening: N(open.value), opening_date: od.value } });
      close(); await reloadCtx(); route_(); } }] });
}
page('settings', { title: 'Settings', async render(v) {
  v.header({ title: 'Settings' });
  const ic = await api('fin_integrity_check');
  v.root.append(section('Books health', h('div', { class: 'list' }, liRow({ icon: ic.ok ? 'check' : 'alert', tone: ic.ok ? 'green' : 'orange', title: ic.ok ? 'Everything adds up' : 'Something needs a look', sub: ic.txns + ' entries · debits ' + inr(ic.debit) + ' = credits ' + inr(ic.credit) }))),
    section('About', h('div', { class: 'list' }, liRow({ title: 'Locked up to', value: S.ctx.lock_date ? fmtD(S.ctx.lock_date) : 'Not locked', sub: 'Set in AUZsLedger settings. Entries on or before this date are refused.' }),
      liRow({ title: 'Nothing is ever deleted', sub: 'A wrong entry is cancelled and stays in history, so your books always have a trail.' }))));
} });
