/* AUZsStyle: Parties. One combined customers+suppliers list (People and Buy -> Suppliers stay as they are for
   their own type-specific editing -- loyalty/points for a customer, GSTIN/category for a supplier) plus a
   running account statement per party: every bill/payment/return or purchase/payment in one timeline with a
   running balance, the same shape of thing the Accounting (Ledger) app calls a party's statement. */
'use strict';
page('parties', {
  title: 'Parties', perm: 'sty_view',
  async render(v, { embedded = false } = {}) {
    if (!embedded) v.header({ title: t('Parties') });
    let q = '', type = '', request = 0, gstOnly = false;
    const list = h('div', { class: 'people-cards' }), kp = h('div', { class: 'kpis' });
    const count = h('div', { class: 'muted small', 'aria-live': 'polite' });
    const refresh = () => load(++request);
    const filters = seg([['', t('All')], ['customer', t('Customers')], ['supplier', t('Suppliers')]], type,
      (value) => { type = value; refresh(); }, { label: t('Party type') });
    const gstFilter = h('button', { class: 'chip', type: 'button', 'aria-pressed': 'false', onclick: () => {
      gstOnly = !gstOnly;
      gstFilter.setAttribute('aria-pressed', String(gstOnly));
      refresh();
    } }, t('With GST number'));
    const load = debounce(async (version) => {
      clear(list).append(h('div', { class: 'spin', style: { color: 'var(--tint)', margin: '20px auto' } }));
      let rows;
      try { rows = await api('sty_list_parties', { p: { q, type, gstOnly } }) || []; }
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
          detail: [party.type === 'customer' ? t('Customer') : t('Supplier'), party.phone, party.gstin,
            party.lastAt ? t('Last') + ' ' + fmtDay(party.lastAt) : ''].filter(Boolean).join(' · '),
          amount: inr(receivable ? party.theyOweYou : payable ? party.youOweThem : 0),
          status: t(receivable ? 'Owes you' : payable ? 'You owe' : 'Settled'),
          tone: receivable ? 'open' : payable ? 'due' : 'settled',
          open: () => party.type === 'supplier' && can('sty_purchase')
            ? go('supplier/' + encodeURIComponent(party.id) + '?from=parties') : partySheet(party, refresh),
        });
      }) : [empty('wallet', t(q || type || gstOnly ? 'No matching parties' : 'No parties yet'),
        t(q || type || gstOnly ? 'Try another search or filter.' : 'Customers and suppliers show here once added.'))]));
    }, 200);
    v.root.append(h('div', { class: 'grid' }, kp, searchField(t('Name, phone or GSTIN'), (value) => { q = value; refresh(); }), h('div', { class: 'row wrap', style: { gap: '8px' } }, filters, gstFilter), count, list));
    refresh();

  },
});

function partySheet(party, done) {
  const customer = party.type === 'customer';
  const panel = h('div', { class: 'grid' });
  const actions = h('div', { class: 'row wrap', style: { gap: '8px' } });
  const view = sheet({ title: party.name, closeLabel: t('Done'), wide: true,
    body: h('div', { class: 'grid style-party-detail' },
      h('div', { class: 'kpis' }, customer ? kpi(t('Owed to you'), inr(party.theyOweYou || 0)) : null,
        kpi(t(customer ? 'Store credit' : 'You owe'), inr(Math.max(0, party.youOweThem || 0)))),
      actions, seg([['details', t('Details')], ['statement', t('Statement')]], 'details', select, { full: true }), panel) });
  let profile = party, tab = 'details', statement, request = 0;
  function details() {
    const fields = [
      ['Type', t(customer ? 'Customer' : 'Supplier')], ['Contact person', profile.contact],
      ['Phone', profile.phone], ['Email', profile.email], ['Address', profile.address], ['City', profile.city],
      ['GSTIN', profile.gstin], ['PAN', profile.pan], ['Category', profile.category],
      ['Credit limit', profile.creditLimit == null ? null : inr(profile.creditLimit)],
      ['Payment due in (days)', profile.creditDays], ['Notes', profile.notes],
    ];
    clear(panel).append(h('dl', { class: 'style-party-fields' }, fields
      .filter(([, value]) => value != null && value !== '')
      .map(([label, value]) => h('div', null, h('dt', null, t(label)), h('dd', null, String(value))))));
  }
  async function select(next) {
    tab = next;
    const current = ++request;
    if (next === 'details') return details();
    clear(panel).append(h('div', { class: 'spin' }));
    try {
      statement ||= await api('sty_party_statement', { p_type: party.type, p_id: party.id });
      if (current !== request) return;
      const kinds = { bill: 'Bill', payment: 'Payment', return: 'Return', purchase: 'Purchase' };
      const entries = (statement.entries || []).slice().reverse();
      clear(panel).append(h('div', { class: 'list' }, entries.length ? entries.map((entry) => liRow({
        icon: entry.debit > 0 ? 'tag' : 'cash',
        title: [t(kinds[entry.kind] || entry.kind), entry.ref].filter(Boolean).join(' · '),
        sub: fmtDT(entry.at) + ' · ' + t(entry.debit > 0 ? 'Debit' : 'Credit') + ' ' + inr(entry.debit || entry.credit),
        value: inr(entry.balance), valueSub: t('Running balance'),
      })) : [empty('wallet', t('No activity yet'))]));
    } catch (error) {
      if (current === request) clear(panel).append(empty('cloudOff', t('Could not load statement'), error.message,
        h('button', { class: 'btn', type: 'button', onclick: () => select('statement') }, t('Try again'))));
    }
  }
  details();
  const lookup = customer ? api('sty_customer_detail', { p_id: party.id })
    : party.due != null ? Promise.resolve(party)
      : api('sty_list_suppliers').then((rows) => (rows || []).find((row) => row.id === party.id));
  lookup.then((record) => {
    if (!record) throw new Error(t('Party details unavailable'));
    profile = { ...party, ...record };
    if (tab === 'details') details();
    const action = (label, symbol, run) => h('button', { class: 'btn', type: 'button', onclick: () => { view.close(); run(); } }, icon(symbol, 18), t(label));
    if (customer) {
      actions.append(action('Customer history', 'user', () => customerSheet(profile, done)));
      if (can('sty_sell')) actions.append(action('Edit customer', 'edit', () => customerForm(profile, done)));
    } else if (can('sty_purchase')) {
      actions.append(action('Edit supplier', 'edit', () => supplierForm(profile, done)));
      if (profile.due > 0) actions.append(action('Pay supplier', 'cash', () => supplierSheet(profile, done)));
    }
  }).catch((error) => actions.append(h('p', { class: 'muted small', role: 'status' }, t('Could not load full details') + ' · ' + error.message)));
}
