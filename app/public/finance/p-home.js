/* AUZsFinance: Today. One big number (money you have), three quiet figures, what needs a look, owed both ways, recent. */
'use strict';
const PERIODS = [['month', 'This month'], ['week', 'This week'], ['year', 'This year']];
function periodDates(k) {
  const d = new Date(todayISO() + 'T00:00:00'), iso = (x) => x.toISOString().slice(0, 10), to = todayISO();
  if (k === 'week') { const f = new Date(d); f.setDate(f.getDate() - 6); return [iso(f), to]; }
  if (k === 'year') return [d.getFullYear() + '-01-01', to];
  return [to.slice(0, 8) + '01', to];
}
page('home', { title: 'Today', async render(v) {
  const per = LS.get('per', 'month');
  v.header({ title: 'Today', actions: [can('write') ? { label: 'Add entry', icon: 'plus', primary: true, run: () => addTxn() } : null] });
  const host = h('div', { class: 'grid' }); v.root.append(host);
  const load = async () => {
    const [f, to] = periodDates(per);
    const [d, bal] = await Promise.all([api('fin_dashboard', { p_from: f, p_to: to }), Promise.resolve(null)]);
    clear(host);
    const net = Number(d.money_in) - Number(d.money_out);
    host.append(
      h('div', { class: 'hero-n' }, h('div', { class: 'k' }, 'Money you have'), h('div', { class: 'n num' }, inr(d.cash_total)), h('div', { class: 'small muted' }, d.accounts.map((a) => a.name + ' ' + inr(a.balance)).join(' · '))),
      seg(PERIODS, per, (x) => { LS.set('per', x); v.refresh(); }, { full: true }),
      h('div', { class: 'trio' },
        h('div', null, h('div', { class: 'k' }, 'In'), h('div', { class: 'n num up' }, inr(d.money_in))),
        h('div', null, h('div', { class: 'k' }, 'Out'), h('div', { class: 'n num down' }, inr(d.money_out))),
        h('div', null, h('div', { class: 'k' }, 'Left'), h('div', { class: 'n num ' + (net < 0 ? 'down' : '') }, inr(net)))),
      (d.needs_review || d.no_evidence) ? h('div', { class: 'list' },
        d.needs_review ? liRow({ icon: 'alert', tone: 'orange', title: d.needs_review + ' entr' + (d.needs_review === 1 ? 'y' : 'ies') + ' to check', chevron: true, onclick: () => go('activity?review=needs_review') }) : null,
        d.no_evidence ? liRow({ icon: 'camera', tone: 'gray', title: d.no_evidence + ' without a bill or proof', chevron: true, onclick: () => go('activity?evidence=none') }) : null) : null,
      h('div', { class: 'duo' },
        kpi('To receive', inr(d.dues_in), 'Customers owe you', () => go('dues')),
        kpi('To pay', inr(d.dues_out), 'You owe suppliers', () => go('dues'))),
      (Number(d.capital) || Number(d.drawings) || Number(d.loans_taken) || Number(d.loans_given)) ? section('Owner and loans', h('div', { class: 'list' },
        liRow({ icon: 'wallet', tone: 'gray', title: 'Owner capital', value: inr(Number(d.capital) - Number(d.drawings)), chevron: true, onclick: () => go('owner') }),
        Number(d.loans_taken) ? liRow({ icon: 'download', tone: 'gray', title: 'Loans you owe', value: inr(d.loans_taken), chevron: true, onclick: () => go('owner') }) : null,
        Number(d.loans_given) ? liRow({ icon: 'upload', tone: 'gray', title: 'Loans given', value: inr(d.loans_given), chevron: true, onclick: () => go('owner') }) : null)) : null,
      d.by_category.length ? section('Where it went', h('div', { class: 'list' }, d.by_category.slice(0, 6).map((c) => liRow({ title: c.name, value: inr(c.amount), badge: h('div', { class: 'bar' }, h('i', { style: { width: Math.max(4, c.amount / d.by_category[0].amount * 100) + '%' } })) })))) : null,
      section('Recent', d.recent.length ? h('div', { class: 'list' }, d.recent.map((r) => txnRow(r, () => txnSheet(r.id)))) : empty('swap', 'Nothing yet', 'Tap the + button to record your first money in or out.', can('write') ? h('button', { class: 'btn fill', onclick: () => addTxn() }, 'Add entry') : null)));
  };
  await load();
} });
