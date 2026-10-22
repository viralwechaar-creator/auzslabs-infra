/* AUZsFinance: Dues. Who owes you, who you owe, how old it is; tap a person for their history and to record a payment. */
'use strict';
const ageDays = (d) => d ? Math.max(0, Math.floor((Date.parse(todayISO()) - Date.parse(String(d).slice(0, 10))) / 864e5)) : 0;
page('dues', { title: 'Dues', async render(v) {
  v.header({ title: 'Dues', actions: [can('write') ? { label: 'New credit entry', icon: 'plus', primary: true, run: () => kindPicker2() } : null] });
  const rows = await api('fin_people_balances');
  const toGet = rows.filter((r) => Number(r.balance) > 0), toPay = rows.filter((r) => Number(r.balance) < 0);
  const sum = (a) => a.reduce((x, r) => x + Math.abs(Number(r.balance)), 0);
  v.root.append(h('div', { class: 'duo' }, kpi('To receive', inr(sum(toGet)), toGet.length + ' people'), kpi('To pay', inr(sum(toPay)), toPay.length + ' people')));
  const person = (r) => liRow({ icon: 'user', tone: 'gray', title: r.name, sub: (r.oldest ? ageDays(r.oldest) + ' days old' : '') + (r.phone ? ' · ' + r.phone : ''), value: h('span', { class: 'money num ' + (Number(r.balance) > 0 ? 'up' : 'down') }, inr(Math.abs(r.balance))), chevron: true, onclick: () => personSheet(r) });
  v.root.append(section('Owes you', toGet.length ? h('div', { class: 'list' }, toGet.map(person)) : empty('check', 'No one owes you', 'Credit sales you record show here.')),
    section('You owe', toPay.length ? h('div', { class: 'list' }, toPay.map(person)) : empty('check', 'You owe no one', 'Credit purchases you record show here.')));
} });
function kindPicker2() {
  const s = sheet({ title: 'Credit entry', closeLabel: 'Close', body: h('div', { class: 'list' }, ['credit_sale', 'credit_purchase', 'dues_in', 'dues_out'].map((k) => liRow({ icon: KINDS[k].ic, tone: 'gray', title: KINDS[k].label, sub: KINDS[k].hint, chevron: true, onclick: () => { s.close(); addTxn({ kind: k }); } }))) });
}
async function personSheet(r) {
  const txns = await api('fin_txn_list', { p: { person_id: r.id, limit: 100 } });
  const owed = Number(r.balance) > 0;
  const wa = r.phone ? 'https://wa.me/' + (String(r.phone).replace(/\D/g, '').length === 10 ? '91' : '') + String(r.phone).replace(/\D/g, '') + '?text=' + encodeURIComponent('Hello ' + r.name + ', a reminder that ' + inr(Math.abs(r.balance)) + ' is pending. Thank you.') : null;
  const body = h('div', { class: 'grid' },
    h('div', { class: 'hero-n small' }, h('div', { class: 'k' }, owed ? 'Owes you' : 'You owe'), h('div', { class: 'n num' }, inr(Math.abs(r.balance))), r.oldest ? h('div', { class: 'small muted' }, 'Oldest entry ' + ageDays(r.oldest) + ' days ago') : null),
    can('write') ? h('div', { class: 'row' }, h('button', { class: 'btn fill grow', onclick: () => { s.close(); addTxn({ kind: owed ? 'dues_in' : 'dues_out', person_id: r.id, amount: Math.abs(r.balance) }); } }, owed ? 'Record payment received' : 'Record payment made'),
      owed && wa ? h('a', { class: 'btn', href: wa, target: '_blank', rel: 'noopener' }, 'Remind') : null) : null,
    section('History', h('div', { class: 'list' }, txns.map((x) => txnRow(x, () => { s.close(); txnSheet(x.id, txns); })))));
  const s = sheet({ title: r.name, closeLabel: 'Done', body });
}
