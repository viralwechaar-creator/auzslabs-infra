// Returns and exchanges: every item that came back (credit notes for sales, debit notes for purchases), with the invoice it was against.
// An exchange is a return where the same customer was billed again the same day.
page('returns', {
  title: 'Returns and exchanges', icon: 'undo', perm: 'acc_view',
  async render(v) {
    v.header({ title: 'Returns and exchanges' });
    const kind = v.q.get('k') || 'sale';
    v.root.append(seg([['sale', 'Sales returns'], ['purchase', 'Purchase returns']], kind, (t) => go('returns?k=' + t)));
    const rows = (await api('acc_returns_list', { p: { kind } })).rows;
    const qtyN = rows.reduce((a, x) => a + Number(x.qty || 0), 0), amt = rows.reduce((a, x) => a + Number(x.amount || 0), 0), ex = rows.filter((x) => x.exchanged_for).length;
    v.root.append(h('div', { class: 'kpis k3' }, kpi('Items returned', qty(qtyN), rows.length + ' lines'), kpi('Value returned', inr(amt), ''), kpi('Exchanges', String(ex), 'Billed again the same day')));
    v.root.append(rows.length ? dataView([
      { key: 'item', label: 'Item', title: true, render: (x) => x.item || 'Item' },
      { key: 'party_name', label: kind === 'sale' ? 'Customer' : 'Supplier', sub: true, render: (x) => [x.party_name, fmtD(x.doc_date), x.number].filter(Boolean).join(' · ') },
      { key: 'kind', label: 'Type', badge: true, render: (x) => (x.exchanged_for ? badge('Exchange', 'blue') : badge('Return')) },
      { key: 'qty', label: 'Qty', r: true, render: (x) => qty(x.qty), sortVal: (x) => Number(x.qty) },
      { key: 'amount', label: 'Value', r: true, value: true, render: (x) => money(x.amount), sortVal: (x) => Number(x.amount) },
    ], rows, { onRow: (x) => sheet({ title: x.item || 'Returned item', closeLabel: 'Close', body: h('div', { class: 'grid' },
        h('div', null, (x.party_name || '') + ' · ' + fmtD(x.doc_date)),
        h('div', { class: 'muted small' }, 'Quantity ' + qty(x.qty) + ' · value ' + inr(x.amount)),
        h('div', { class: 'muted small' }, (kind === 'sale' ? 'Credit note ' : 'Debit note ') + x.number + (x.against ? ' against ' + x.against : '')),
        x.exchanged_for ? h('div', { class: 'small' }, 'Exchange: billed again on ' + x.exchanged_for) : h('div', { class: 'muted small' }, 'Plain return: no new bill the same day.')),
      actions: [{ label: 'Open the note', primary: true, onclick: (c) => { c(); go('doc/' + x.id); } }].concat(x.against_id ? [{ label: 'Open the original', onclick: (c) => { c(); go('doc/' + x.against_id); } }] : []) }) })
      : empty('undo', 'Nothing returned yet', 'Returns made with a credit note show here, item by item.'));
  },
});
