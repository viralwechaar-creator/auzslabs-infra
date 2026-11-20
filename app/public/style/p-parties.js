/* AUZsStyle: Parties. One combined customers+suppliers list (People and Buy -> Suppliers stay as they are for
   their own type-specific editing -- loyalty/points for a customer, GSTIN/category for a supplier) plus a
   running account statement per party: every bill/payment/return or purchase/payment in one timeline with a
   running balance, the same shape of thing the Accounting (Ledger) app calls a party's statement. */
'use strict';
page('parties', {
  title: 'Parties', perm: 'sty_view',
  async render(v) {
    v.header({ title: t('Parties') });
    let q = '', type = '', request = 0;
    const list = h('div', { class: 'people-cards' }), kp = h('div', { class: 'kpis' });
    const count = h('div', { class: 'muted small', 'aria-live': 'polite' });
    const refresh = () => load(++request);
    const filters = seg([['', t('All')], ['customer', t('Customers')], ['supplier', t('Suppliers')]], type,
      (value) => { type = value; refresh(); }, { label: t('Party type') });
    const load = debounce(async (version) => {
      clear(list).append(h('div', { class: 'spin', style: { color: 'var(--tint)', margin: '20px auto' } }));
      let rows;
      try { rows = await api('sty_list_parties', { p: { q, type } }) || []; }
      catch (error) {
        if (version === request) clear(list).append(empty('cloudOff', t('Could not load'), error.message,
          h('button', { class: 'btn', type: 'button', onclick: refresh }, t('Try again'))));
        return;
      }
      if (version !== request) return;
      const owedToYou = rows.reduce((sum, row) => sum + (Number(row.theyOweYou) || 0), 0);
      const owedByYou = rows.reduce((sum, row) => sum + (Number(row.youOweThem) || 0), 0);
      clear(kp).append(kpi(t('Owed to you'), inr(owedToYou, 0)), kpi(t('You owe'), inr(owedByYou, 0)));
      count.textContent = rows.length + ' ' + t('parties');
      clear(list).append(...(rows.length ? rows.map((party) => {
        const receivable = party.theyOweYou > 0;
        const payable = party.youOweThem > 0;
        return peopleRecordCard({
          name: party.name,
          detail: [party.type === 'customer' ? t('Customer') : t('Supplier'), party.phone,
            party.lastAt ? t('Last') + ' ' + fmtDay(party.lastAt) : ''].filter(Boolean).join(' · '),
          amount: inr(receivable ? party.theyOweYou : payable ? party.youOweThem : 0),
          status: t(receivable ? 'Owes you' : payable ? 'You owe' : 'Settled'),
          tone: receivable ? 'open' : payable ? 'due' : 'settled',
          open: () => partySheet(party),
        });
      }) : [empty('wallet', t(q || type ? 'No matching parties' : 'No parties yet'),
        t(q || type ? 'Try another search or filter.' : 'Customers and suppliers show here once added.'))]));
    }, 200);
    v.root.append(h('div', { class: 'grid' }, kp, searchField(t('Name or phone'), (value) => { q = value; refresh(); }), filters, count, list));
    refresh();

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
