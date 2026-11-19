/* AUZsStyle: Parties. One combined customers+suppliers list (People and Buy -> Suppliers stay as they are for
   their own type-specific editing -- loyalty/points for a customer, GSTIN/category for a supplier) plus a
   running account statement per party: every bill/payment/return or purchase/payment in one timeline with a
   running balance, the same shape of thing the Accounting (Ledger) app calls a party's statement. */
'use strict';
page('parties', {
  title: 'Parties', perm: 'sty_view',
  async render(v) {
    v.header({ title: t('Parties') });
    let q = '', type = '';
    const list = h('div', { class: 'list' }), kp = h('div', { class: 'kpis' });
    const chipRow = h('div', { class: 'chips' }, [['', t('All')], ['customer', t('Customers')], ['supplier', t('Suppliers')]].map(([k, l]) =>
      h('button', { class: 'chip', type: 'button', 'aria-pressed': String(type === k), onclick: () => { type = k; load(); } }, l)));
    const load = debounce(async () => {
      clear(list).append(h('div', { class: 'spin', style: { color: 'var(--tint)', margin: '20px auto' } }));
      let rows = []; try { rows = await api('sty_list_parties', { p: { q, type } }) || []; } catch (e) { return clear(list).append(empty('cloudOff', t('Could not load'), e.message)); }
      const owedToYou = rows.reduce((a, r) => a + (r.theyOweYou || 0), 0), owedByYou = rows.reduce((a, r) => a + (r.youOweThem || 0), 0);
      clear(kp).append(kpi(t('Owed to you'), inr(owedToYou, 0), '', null, owedToYou > 0 ? 'neg' : ''), kpi(t('You owe'), inr(owedByYou, 0), '', null, owedByYou > 0 ? 'neg' : ''));
      clear(list).append(...(rows.length ? rows.map((r) => liRow({ icon: r.type === 'customer' ? 'user' : 'truck', title: r.name, sub: [r.phone, r.type === 'customer' ? t('Customer') : t('Supplier'), r.lastAt ? t('Last') + ' ' + fmtDay(r.lastAt) : ''].filter(Boolean).join(' · '),
        value: r.theyOweYou > 0 ? inr(r.theyOweYou) : r.youOweThem > 0 ? '-' + inr(r.youOweThem) : inr(0), valueSub: r.theyOweYou > 0 ? t('Owes you') : r.youOweThem > 0 ? t('You owe') : t('Settled'),
        chevron: true, onclick: () => partySheet(r) })) : [empty('wallet', t('No parties yet'), t('Customers and suppliers show here once added.'))]));
    }, 200);
    v.root.append(h('div', { class: 'grid' }, kp, searchField(t('Name or phone'), (x) => { q = x; load(); }), chipRow, list));
    load();
  },
});
function partySheet(p0) {
  const s = sheet({ title: p0.name, closeLabel: t('Done'), body: h('div', { class: 'grid' }, h('div', { class: 'spin', style: { color: 'var(--tint)', margin: '20px auto' } })) });
  (async () => {
    let st; try { st = await api('sty_party_statement', { p_type: p0.type, p_id: p0.id }); } catch (e) { s.close(); return fail(e); }
    const KIND = { bill: t('Bill'), payment: t('Payment'), return: t('Return'), purchase: t('Purchase') };
    const rows = (st.entries || []).slice().reverse();
    const bal = rows.length ? rows[0].balance : 0;
    clear(s.body).append(h('div', { class: 'grid' },
      h('div', { class: 'kv' }, h('span', null, p0.type === 'customer' ? t('Owes you') : t('You owe')), h('b', { class: 'num' }, inr(Math.max(bal, 0)))),
      h('div', { class: 'list' }, rows.length ? rows.map((r) => liRow({ icon: r.debit > 0 ? 'tag' : 'cash', title: t(KIND[r.kind] || r.kind) + (r.ref ? ' · ' + r.ref : ''), sub: fmtDT(r.at), value: inr(r.debit > 0 ? r.debit : r.credit), valueSub: r.debit > 0 ? t('Debit') : t('Credit'), chevron: false })) : [empty('wallet', t('No activity yet'))])));
  })();
}
