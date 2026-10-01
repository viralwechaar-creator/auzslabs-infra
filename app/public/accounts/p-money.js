/* Money in and out: receipts (collections), payments, allocation, payment detail. */
'use strict';
const payDocTypes = (kind, party, doc) => {
  if (doc) return [doc.doc_type];
  const k = party && party.kind;
  if (k === 'customer') return kind === 'receipt' ? ['invoice'] : ['credit_note'];
  if (k === 'supplier') return kind === 'payment' ? ['bill', 'expense'] : ['debit_note'];
  return kind === 'receipt' ? ['invoice', 'debit_note'] : ['bill', 'expense', 'credit_note'];
};
async function receiptSheet(kind, o = {}) {
  await parties();
  let party = o.party || null, items = [];
  const isIn = kind === 'receipt';
  const partyBtn = h('button', { class: 'li', type: 'button', style: { borderRadius: '14px', background: 'var(--card)', boxShadow: '0 0 0 .5px var(--sep)' }, disabled: !!o.party, onclick: async () => { const p = await pickParty(isIn ? 'customer' : 'supplier', party && party.id); if (p) { party = p; drawParty(); loadItems(); } } });
  const drawParty = () => { clear(partyBtn).append(h('span', { class: 'tile gray' }, icon(isIn ? 'user' : 'building', 18)), h('div', { class: 'grow' }, h('div', { class: 'cap' }, isIn ? 'Received from' : 'Paid to'), h('div', { class: 't' }, party ? party.name : 'Choose ' + (isIn ? 'customer' : 'supplier'))), o.party ? null : h('span', { class: 'chev' }, icon('chevR', 18))); };
  drawParty();
  const accSel = selectEl(payAccounts().map((a) => [a.id, a.name]), (payAccounts().find((a) => a.is_bank) || payAccounts()[0] || {}).id);
  const amt = h('input', { class: 'input', inputmode: 'decimal', placeholder: '0.00', 'aria-label': 'Amount', oninput: () => { auto = false; refresh(); } });
  const dt = dateInput(today()), md = selectEl([['', 'Method'], 'Cash', 'UPI', 'Card', 'NEFT/RTGS', 'Cheque'], ''), rf = input({ placeholder: 'UTR / cheque number' }), nt = input({ placeholder: 'Note (optional)' });
  const itemsEl = h('div', { class: 'list' }), foot = h('div', { class: 'small muted' });
  let auto = true; const alloc = {};
  const refresh = () => {
    const a = N(amt.value); let left = a;
    if (auto) { items.forEach((x) => { const t = Math.min(left, Number(x.outstanding)); alloc[x.id] = t > 0 ? t : 0; left -= Math.max(t, 0); }); }
    $$('input[data-doc]', itemsEl).forEach((i) => { i.value = alloc[i.dataset.doc] ? String(r2(alloc[i.dataset.doc])) : ''; });
    const used = Object.values(alloc).reduce((s, x) => s + x, 0);
    foot.textContent = a > 0 ? (used > a + 0.005 ? 'Allocations are more than the amount.' : used < a - 0.005 ? inr(a - used) + ' will be kept as an advance for ' + (party ? party.name : 'the party') + ' and can be settled later.' : 'Fully allocated.') : '';
    foot.style.color = used > a + 0.005 ? 'var(--red)' : '';
  };
  const loadItems = async () => {
    clear(itemsEl); items = []; for (const k in alloc) delete alloc[k];
    if (!party) return;
    const r = await api('acc_list_documents', { p: { types: payDocTypes(kind, party, o.doc), party_id: party.id, limit: 200 } });
    items = r.rows.filter((x) => x.status === 'posted' && Number(x.outstanding) > 0).sort((a, b) => (a.due_date || a.doc_date).localeCompare(b.due_date || b.doc_date));
    if (o.doc && items.length === 1 && !amt.value) { amt.value = String(items[0].outstanding); }
    if (!items.length) { itemsEl.append(h('div', { class: 'li muted' }, 'Nothing is outstanding. The amount will be recorded as an advance.')); refresh(); return; }
    items.forEach((x) => itemsEl.append(h('div', { class: 'li' }, h('div', { class: 'grow' }, h('div', { class: 't' }, x.number), h('div', { class: 's' }, DOC_LABEL[x.doc_type] + ' · due ' + fmtD(x.due_date || x.doc_date) + ' · ' + inr(x.outstanding) + ' left')),
      h('input', { class: 'input', style: { width: '120px', textAlign: 'right' }, inputmode: 'decimal', 'data-doc': x.id, placeholder: '0.00', 'aria-label': 'Allocate to ' + x.number, oninput: (e) => { auto = false; alloc[x.id] = Math.min(N(e.target.value), Number(x.outstanding)); const used = Object.values(alloc).reduce((s, y) => s + y, 0); if (!N(amt.value) || N(amt.value) < used) amt.value = String(r2(used)); refresh2(); } }))));
    refresh();
  };
  const refresh2 = () => { const a = N(amt.value), used = Object.values(alloc).reduce((s, x) => s + x, 0); foot.textContent = a > 0 ? (used > a + 0.005 ? 'Allocations are more than the amount.' : used < a - 0.005 ? inr(a - used) + ' will be kept as an advance.' : 'Fully allocated.') : ''; };
  const autoBtn = h('button', { class: 'btn sm', type: 'button', onclick: () => { auto = true; refresh(); } }, 'Settle oldest first');
  const s = sheet({ title: isIn ? 'Receive money' : 'Pay money', wide: false, body: h('div', { class: 'grid' }, partyBtn, h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' } }, field('Amount', amt), field('Date', dt)),
    h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' } }, field(isIn ? 'Into account' : 'From account', accSel), field('Method', md)), field('Reference', rf), field('Note', nt),
    h('div', { class: 'sec' }, h('div', { class: 'sec-h' }, h('h3', null, 'Settle against'), autoBtn), itemsEl, foot)),
    actions: [{ label: isIn ? 'Record receipt' : 'Record payment', primary: true, onclick: async (c) => {
      if (!party) { toast('Choose a ' + (isIn ? 'customer' : 'supplier'), { err: true }); return false; }
      const a = N(amt.value); if (a <= 0) { amt.classList.add('err'); amt.focus(); return false; }
      const allocations = Object.entries(alloc).filter(([, x]) => x > 0).map(([doc_id, x]) => ({ doc_id, amount: r2(x) }));
      if (allocations.reduce((s2, x) => s2 + x.amount, 0) > a + 0.005) { toast('Allocations are more than the amount', { err: true }); return false; }
      const r = await api('acc_save_payment', { p: { kind, party_id: party.id, account_id: accSel.value, amount: a, date: dt.value, mode: md.value, reference: rf.value, notes: nt.value, allocations } });
      bust('parties'); c(); toast((isIn ? 'Received ' : 'Paid ') + inr(a) + ' · ' + r.number); o.done ? o.done() : go('payment/' + r.id);
    } }] });
  await loadItems();
  amt.focus();
}

function moneyPage(id, kind, title, tabLabel, icn) {
  page(id, {
    title, tabLabel, icon: icn, perm: 'acc_view',
    async render(v) {
      const isIn = kind === 'receipt', writable = can(isIn ? 'acc_sales' : 'acc_purchase');
      v.header({ title, actions: [writable ? { label: isIn ? 'Receive money' : 'Pay money', icon: 'plus', primary: true, run: () => receiptSheet(kind, { done: () => v.refresh() }) } : null, { label: 'Ageing report', icon: 'clock', run: () => go('reports/ageing_' + (isIn ? 'receivable' : 'payable')) }].filter(Boolean) });
      const [age, pays] = await Promise.all([api('acc_ageing', { p: { kind: isIn ? 'receivable' : 'payable' } }), api('acc_list_payments', { p: { kind, limit: 100 } })]);
      const t = age.totals, overdue = Number(t.d30) + Number(t.d60) + Number(t.d90) + Number(t.d90p);
      v.root.append(h('div', { class: 'kpis k3' }, kpi(isIn ? 'To collect' : 'To pay', inr(t.total, 0), Number(t.advance) ? inr(Math.abs(t.advance), 0) + ' in advances' : '', () => go('reports/ageing_' + (isIn ? 'receivable' : 'payable'))), kpi('Overdue', inr(overdue, 0), overdue ? 'Past the due date' : 'Nothing overdue', null), kpi('Not yet due', inr(t.current, 0), '')));
      const rows = age.rows.filter((r) => Number(r.total) > 0).slice(0, 12);
      v.root.append(h('div', { class: 'sec' }, h('div', { class: 'sec-h' }, h('h3', null, isIn ? 'Who owes you' : 'Who you owe'), h('button', { class: 'btn plain sm', onclick: () => remindersSheet(isIn ? 'receivable' : 'payable') }, isIn ? 'Send reminders' : 'View due')),
        rows.length ? h('div', { class: 'list' }, rows.map((r) => h('div', { class: 'li' }, h('button', { class: 'grow', style: { textAlign: 'left' }, onclick: () => go('party/' + r.party_id + '?tab=ageing') }, h('div', { class: 't' }, r.name), h('div', { class: 's' }, [Number(r.d30) + Number(r.d60) + Number(r.d90) + Number(r.d90p) > 0 ? inr(Number(r.d30) + Number(r.d60) + Number(r.d90) + Number(r.d90p), 0) + ' overdue' : 'Within terms', Number(r.advance) ? inr(Math.abs(r.advance), 0) + ' advance' : ''].filter(Boolean).join(' · '))),
          h('div', { class: 'v' }, h('div', { class: 't' }, money(r.total)), writable ? h('button', { class: 'btn sm', style: { marginTop: '4px' }, onclick: async () => { const ps = await parties(); receiptSheet(kind, { party: ps.find((x) => x.id === r.party_id), done: () => v.refresh() }); } }, isIn ? 'Collect' : 'Pay') : null)))) : empty('check', isIn ? 'Nothing to collect' : 'Nothing to pay', 'Everything is settled.')));
      v.root.append(h('div', { class: 'sec' }, h('div', { class: 'sec-h' }, h('h3', null, isIn ? 'Recent receipts' : 'Recent payments')),
        dataView([{ key: 'number', label: 'Number', title: true }, { key: 'party_name', label: 'Party', sub: true, render: (x) => (x.party_name || '') + ' · ' + fmtD(x.pay_date) }, { key: 'pay_date', label: 'Date', render: (x) => fmtD(x.pay_date) }, { key: 'account', label: 'Account' }, { key: 'mode', label: 'Method', render: (x) => x.mode || '' },
          { key: 'status', label: 'Status', badge: true, render: (x) => statusBadge(x.status === 'cancelled' ? 'cancelled' : Number(x.unallocated) > 0 ? 'open' : 'posted') }, { key: 'amount', label: 'Amount', r: true, value: true, render: (x) => money(x.amount), sortVal: (x) => Number(x.amount) }, { key: 'unallocated', label: 'Unallocated', r: true, render: (x) => (x.status === 'posted' && Number(x.unallocated) > 0 ? money(x.unallocated) : '') }],
          pays.rows, { onRow: (x) => go('payment/' + x.id), empty: empty('wallet', 'No ' + (isIn ? 'receipts' : 'payments') + ' yet') })));
    },
  });
}
moneyPage('receipts', 'receipt', 'Collect', 'Collect', 'wallet');
moneyPage('payments', 'payment', 'Pay suppliers', 'Pay', 'cash');

page('payment', {
  title: 'Payment', icon: 'wallet', nav: false, navAs: 'receipts',
  async render(v) {
    const r = await api('acc_get_payment', { p_id: v.args[0] }), p = r.payment, isIn = p.kind === 'receipt', cancelled = p.status === 'cancelled';
    const acts = [];
    if (!cancelled && Number(p.amount) > Number(p.allocated) && can(isIn ? 'acc_sales' : 'acc_purchase')) acts.push({ label: 'Allocate', icon: 'link', primary: true, run: () => allocateSheet(r, () => v.refresh()) });
    if (!cancelled && can('acc_cancel')) acts.push({ label: 'Cancel…', icon: 'x', danger: true, run: async () => { const why = await askText('Cancel ' + p.number + '?', 'Posts a reversing entry and releases anything it settled. A reason is required.', 'Reason'); if (why == null) return; if (!why) return toast('Enter a reason', { err: true }); try { await api('acc_cancel_payment', { p_payment: p.id, p_reason: why }); toast('Cancelled'); v.refresh(); } catch (e) { fail(e); } } });
    v.header({ title: p.number, back: isIn ? 'receipts' : 'payments', actions: acts });
    v.root.append(h('div', { class: 'card grid' }, h('div', { class: 'row sp wrap' }, h('div', null, h('div', { class: 'cap' }, isIn ? 'Receipt' : 'Payment'), h('h2', { style: { fontSize: '22px' } }, inr(p.amount))), statusBadge(cancelled ? 'cancelled' : Number(p.amount) > Number(p.allocated) ? 'open' : 'posted')),
      h('div', { class: 'row sp wrap' }, h('div', null, h('div', { class: 'cap' }, isIn ? 'From' : 'To'), r.party ? h('a', { href: '#/party/' + r.party.id, style: { fontWeight: 600 } }, r.party.name) : '—'), h('div', { style: { textAlign: 'right' } }, h('div', { class: 'cap' }, fmtD(p.pay_date)), h('div', null, r.account + (p.mode ? ' · ' + p.mode : '')))),
      p.reference ? h('div', { class: 'small muted' }, 'Reference ' + p.reference) : null, p.notes ? h('div', { class: 'small' }, p.notes) : null,
      cancelled ? h('div', { class: 'banner bad' }, icon('x', 18), 'Cancelled' + (p.cancel_reason ? ': ' + p.cancel_reason : '')) : Number(p.amount) > Number(p.allocated) ? h('div', { class: 'banner info' }, icon('info', 18), inr(Number(p.amount) - Number(p.allocated)) + ' is not yet allocated to a document (held as an advance).') : null));
    v.root.append(h('div', { class: 'sec' }, h('div', { class: 'sec-h' }, h('h3', null, 'Settled documents')), h('div', { class: 'list' }, r.allocations.length ? r.allocations.map((a) => liRow({ icon: 'doc', tone: a.reversed ? 'gray' : 'green', title: DOC_LABEL[a.doc_type] + ' ' + a.doc_number, sub: a.reversed ? 'Unlinked' : '', value: money(a.amount), chevron: true, onclick: () => go('doc/' + a.doc_id) })) : [liRow({ title: 'Not allocated to any document' })])));
    if (r.journal_lines.length) v.root.append(h('div', { class: 'sec' }, h('div', { class: 'sec-h' }, h('h3', null, 'Accounting entries')), h('div', { class: 'card flush' }, h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' }, h('thead', null, h('tr', null, h('th', null, 'Account'), h('th', { class: 'r' }, 'Debit'), h('th', { class: 'r' }, 'Credit'))), h('tbody', null, r.journal_lines.map((j) => h('tr', null, h('td', null, j.account), h('td', { class: 'r' }, Number(j.debit) ? money(j.debit) : ''), h('td', { class: 'r' }, Number(j.credit) ? money(j.credit) : '')))))))));
    v.root.append(attachmentsCard('payment', p.id, r.attachments, can(isIn ? 'acc_sales' : 'acc_purchase'), () => v.refresh()));
  },
});
async function allocateSheet(r, done) {
  const p = r.payment, party = r.party, unalloc = Number(p.amount) - Number(p.allocated);
  const types = payDocTypes(p.kind, party);
  const docs = (await api('acc_list_documents', { p: { types, party_id: p.party_id, limit: 200 } })).rows.filter((x) => x.status === 'posted' && Number(x.outstanding) > 0);
  const inputs = {};
  const s = sheet({ title: 'Allocate ' + inr(unalloc), body: h('div', { class: 'grid' }, h('p', { class: 'muted' }, 'Choose which documents this money settles.'), h('div', { class: 'list' }, docs.length ? docs.map((x) => h('div', { class: 'li' }, h('div', { class: 'grow' }, h('div', { class: 't' }, x.number), h('div', { class: 's' }, 'Due ' + fmtD(x.due_date || x.doc_date) + ' · ' + inr(x.outstanding) + ' left')),
    inputs[x.id] = h('input', { class: 'input', style: { width: '120px', textAlign: 'right' }, inputmode: 'decimal', placeholder: '0.00', 'aria-label': 'Allocate to ' + x.number }))) : [h('div', { class: 'li muted' }, 'Nothing is outstanding for this party.')])),
    actions: [{ label: 'Allocate', primary: true, onclick: async (c) => {
      const rows = docs.map((x) => [x, Math.min(N(inputs[x.id].value), Number(x.outstanding))]).filter(([, a]) => a > 0);
      if (!rows.length) { toast('Enter an amount', { err: true }); return false; }
      if (rows.reduce((s2, [, a]) => s2 + a, 0) > unalloc + 0.005) { toast('More than the unallocated ' + inr(unalloc), { err: true }); return false; }
      for (const [x, a] of rows) await api('acc_allocate', { p_payment: p.id, p_doc: x.id, p_amount: a });
      c(); toast('Allocated'); done();
    } }] });
}
