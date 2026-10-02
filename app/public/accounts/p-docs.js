/* Sales and purchase documents: list pages (sales, purchases, expenses), the recurring schedules, and the document detail page. */
'use strict';
const SALES_TABS = [['invoice', 'Invoices'], ['quotation', 'Quotations'], ['sales_order', 'Orders'], ['delivery_challan', 'Challans'], ['credit_note', 'Credit notes'], ['recurring', 'Recurring']];
const PURCH_TABS = [['bill', 'Bills'], ['purchase_order', 'Orders'], ['purchase_request', 'Requests'], ['goods_receipt', 'Receipts'], ['debit_note', 'Debit notes'], ['recurring', 'Recurring']];
const POSTING = ['invoice', 'credit_note', 'bill', 'debit_note', 'expense'];
const SALES_TYPES = ['invoice', 'credit_note', 'quotation', 'sales_order', 'delivery_challan'];
const CONVERT = { quotation: ['sales_order', 'invoice'], sales_order: ['delivery_challan', 'invoice'], delivery_challan: ['invoice'], purchase_request: ['purchase_order'], purchase_order: ['goods_receipt', 'bill'], goods_receipt: ['bill'] };
const docPerm = (t) => (SALES_TYPES.includes(t) ? 'acc_sales' : 'acc_purchase');
const docPath = (d) => (d.status === 'draft' || (d.status === 'open' && !POSTING.includes(d.doc_type)) ? 'edit/' + d.id : 'doc/' + d.id);

function statusOptions(type) {
  return POSTING.includes(type) ? [['', 'All'], ['unpaid', 'Unpaid'], ['overdue', 'Overdue'], ['paid', 'Paid'], ['draft', 'Draft'], ['cancelled', 'Cancelled']] : [['', 'All'], ['open', 'Open'], ['converted', 'Converted'], ['cancelled', 'Cancelled']];
}
function docsPage(id, title, icon, tabs, perm, tabLabel) {
  page(id, {
    title, icon, perm: 'acc_view', tabLabel,
    async render(v) {
      const tab = v.q.get('tab') || tabs[0][0];
      const newType = tab === 'recurring' ? tabs[0][0] : tab;
      const writable = can(perm);
      v.header({ title, actions: [writable && tab !== 'recurring' ? { label: 'New ' + DOC_LABEL[newType].toLowerCase(), icon: 'plus', primary: true, run: () => go('new/' + newType) } : null, writable && tab === 'recurring' ? { label: 'New schedule', icon: 'plus', primary: true, run: () => go('new/' + tabs[0][0] + '?recurring=1') } : null].filter(Boolean) });
      v.root.append(seg(tabs, tab, (t) => go(id + '?tab=' + t), { label: title + ' views' }));
      if (tab === 'recurring') return recurringList(v, tabs[0][0]);
      return docList(v, { types: [tab], scope: id + ':' + tab, status: v.q.get('status') || '', writable });
    },
  });
}
docsPage('sales', 'Sales', 'doc', SALES_TABS, 'acc_sales');
docsPage('purchases', 'Purchases', 'receipt', PURCH_TABS, 'acc_purchase');
page('expenses', {
  title: 'Expenses', tabLabel: 'Expenses', icon: 'cash', perm: 'acc_view',
  async render(v) {
    v.header({ title: 'Expenses', actions: [can('acc_purchase') ? { label: 'New expense', icon: 'plus', primary: true, run: () => go('new/expense') } : null, can('acc_purchase') ? { label: 'Recurring expenses', icon: 'repeat', run: () => go('expenses?tab=recurring') } : null].filter(Boolean) });
    if (v.q.get('tab') === 'recurring') { v.root.append(seg([['', 'All expenses'], ['recurring', 'Recurring']], 'recurring', (t) => go('expenses' + (t ? '?tab=' + t : '')))); return recurringList(v, 'expense'); }
    v.root.append(seg([['', 'All expenses'], ['recurring', 'Recurring']], '', (t) => go('expenses' + (t ? '?tab=' + t : ''))));
    return docList(v, { types: ['expense'], scope: 'expenses', status: v.q.get('status') || '', writable: can('acc_purchase') });
  },
});

async function docList(v, o) {
  const F = { search: '', status: o.status, from: '', to: '', party_id: '', limit: 50, offset: 0 };
  const host = h('div', { class: 'grid' }), listEl = h('div'), more = h('div', { style: { textAlign: 'center' } });
  let rows = [], total = 0, sums = null, sel = new Set(), busyLoad = false;
  const bar = h('div', { class: 'sum row sp small muted' });
  const load = async (append) => {
    if (busyLoad) return; busyLoad = true;
    try {
      const r = await api('acc_list_documents', { p: { types: o.types, search: F.search, status: F.status, from: F.from, to: F.to, party_id: F.party_id, limit: F.limit, offset: append ? rows.length : 0 } });
      rows = append ? rows.concat(r.rows) : r.rows; total = r.count; sums = r.sums; paint();
    } catch (e) { clear(listEl).append(empty('alert', 'Could not load', e.message)); } finally { busyLoad = false; }
  };
  const typeLabel = DOC_LABEL[o.types[0]].toLowerCase();
  const cols = [
    { key: 'number', label: 'Number', title: true, render: (r) => h('span', { class: 't' }, r.number.startsWith('DRAFT-') ? 'Draft' : r.number, r.reverse_charge ? h('span', { class: 'cap' }, ' · RCM') : '') },
    { key: 'party_name', label: 'Party', sub: true, render: (r) => (r.party_name || 'Walk-in') + (isDesk() ? '' : ' · ' + fmtD(r.doc_date)) },
    { key: 'doc_date', label: 'Date', hideMobile: true, render: (r) => fmtD(r.doc_date) },
    { key: 'due_date', label: 'Due', render: (r) => (POSTING.includes(r.doc_type) && r.due_date ? fmtD(r.due_date) : '') },
    { key: 'pay_status', label: 'Status', badge: true, render: (r) => statusBadge(r.pay_status) },
    { key: 'total', label: 'Total', r: true, value: true, render: (r) => money(r.total), sortVal: (r) => Number(r.total) },
    { key: 'outstanding', label: 'Outstanding', r: true, render: (r) => (r.status === 'posted' && Number(r.outstanding) > 0 ? money(r.outstanding) : h('span', { class: 'muted' }, '–')), sortVal: (r) => Number(r.outstanding), hideDesk: !POSTING.includes(o.types[0]) },
  ];
  const bulkBar = h('div', { class: 'row sp hidden banner info', role: 'status' });
  function paint() {
    clear(listEl); clear(more); sel = new Set(); bulkBar.classList.add('hidden');
    bar.replaceChildren(h('span', null, total + ' ' + (total === 1 ? typeLabel : typeLabel + 's')), sums && POSTING.includes(o.types[0]) ? h('span', null, 'Total ', money(sums.total, { compact: true }), ' · Outstanding ', money(sums.outstanding, { compact: true })) : null);
    if (!rows.length) { listEl.append(empty('doc', F.search || F.status || F.from ? 'No matches' : 'No ' + typeLabel + 's yet', F.search || F.status ? 'Try a different search or clear the filters.' : o.writable ? 'Create your first ' + typeLabel + '.' : '', o.writable && !F.search && !F.status ? h('button', { class: 'btn fill', onclick: () => go('new/' + o.types[0]) }, 'New ' + typeLabel) : null)); return; }
    const canBulk = o.writable && can('acc_post') && POSTING.includes(o.types[0]);
    listEl.append(dataView(cols, rows, { onRow: (r) => go(docPath(r)), selectable: canBulk, sortKey: null, onSelect: (s) => { sel = s; bulkBar.classList.toggle('hidden', !s.size); bulkBar.replaceChildren(h('span', null, s.size + ' selected'), h('button', { class: 'btn sm fill', onclick: bulkPost }, 'Post selected drafts')); } }));
    if (rows.length < total) more.append(h('button', { class: 'btn', onclick: () => load(true) }, 'Show more (' + (total - rows.length) + ' left)'));
  }
  async function bulkPost() {
    const ids = [...sel].filter((id) => (rows.find((r) => r.id === id) || {}).status === 'draft');
    if (!ids.length) return toast('Select draft documents to post', { err: true });
    if (!(await confirmBox('Post ' + ids.length + ' draft' + (ids.length > 1 ? 's' : '') + '?', 'Each one creates ledger entries and gets its final number. Failures are listed and the rest still post.', 'Post'))) return;
    try { const r = await api('acc_bulk_post', { p_ids: ids }); toast(r.posted + ' posted' + (r.failed ? ', ' + r.failed + ' failed' : '')); if (r.failed) await alertBox({ title: r.failed + ' could not be posted', message: r.results.filter((x) => !x.ok).map((x) => x.error).slice(0, 4).join(' · '), cancel: false }); load(); } catch (e) { fail(e); }
  }
  // toolbar: search, status chips, date range, saved views, export
  const search = searchField('Search ' + typeLabel + 's', debounce((q) => { F.search = q; load(); }, 300));
  const dateBtn = h('button', { class: 'btn', onclick: dateSheet }, icon('calendar', 18), h('span', { class: 'dl' }, 'Dates'));
  const viewsBtn = h('button', { class: 'btn', onclick: () => viewsMenu(viewsBtn) }, icon('star', 18), h('span', null, 'Views'));
  const expBtn = h('button', { class: 'btn', onclick: () => doExport(expBtn) }, icon('download', 18), h('span', null, 'Export'));
  function dateSheet() {
    const f = dateInput(F.from), t = dateInput(F.to);
    const s = sheet({ title: 'Date range', body: h('div', { class: 'grid' }, field('From', f), field('To', t), h('div', { class: 'row wrap' }, [['This month', monthStart(), monthEnd()], ['Last month', monthStart(addDays(monthStart(), -1)), addDays(monthStart(), -1)], ['Last 30 days', addDays(today(), -30), today()], ['This year', curFY().start_date, curFY().end_date]].map(([l, a, b]) => h('button', { class: 'chip', onclick: () => { f.value = a; t.value = b; } }, l)))),
      actions: [{ label: 'Clear', onclick: (c) => { F.from = F.to = ''; dateBtn.lastChild.textContent = 'Dates'; c(); load(); } }, { label: 'Apply', primary: true, onclick: (c) => { F.from = f.value; F.to = t.value; dateBtn.lastChild.textContent = F.from || F.to ? (F.from ? fmtD(F.from) : '…') + ' – ' + (F.to ? fmtD(F.to) : '…') : 'Dates'; c(); load(); } }] });
  }
  async function viewsMenu(anchor) {
    try {
      const vs = (await api('acc_list_views', { p_scope: o.scope })).rows;
      menu(anchor, [...vs.map((x) => ({ label: x.name, icon: 'star', run: () => { Object.assign(F, x.filters, { offset: 0 }); search.input.value = F.search || ''; chipsHost.replaceChildren(statusChips()); load(); } })), vs.length ? '-' : null,
        { label: 'Save current view…', icon: 'plus', run: async () => { const n = await askText('Save view', 'Saves the current search, status and dates.', 'Name'); if (n) { await api('acc_save_view', { p: { scope: o.scope, name: n, filters: { search: F.search, status: F.status, from: F.from, to: F.to } } }); toast('View saved'); } } },
        ...vs.map((x) => ({ label: 'Delete “' + x.name + '”', icon: 'trash', danger: true, run: async () => { await api('acc_delete_view', { p_id: x.id }); toast('View deleted'); } }))].filter(Boolean));
    } catch (e) { fail(e); }
  }
  async function doExport(anchor) {
    try {
      const r = await api('acc_list_documents', { p: { types: o.types, search: F.search, status: F.status, from: F.from, to: F.to, limit: 500, offset: 0 } });
      exportMenu(anchor, o.types[0] + 's', ['Number', 'Date', 'Due', 'Party', 'Status', 'Taxable', 'Tax', 'Total', 'Paid', 'Outstanding'], r.rows.map((x) => [x.number, x.doc_date, x.due_date || '', x.party_name || '', x.pay_status, Number(x.taxable), Number(x.tax), Number(x.total), Number(x.paid), Number(x.outstanding)]));
    } catch (e) { fail(e); }
  }
  const statusChips = () => chips(statusOptions(o.types[0]), F.status, (x) => { F.status = x; load(); });
  const chipsHost = h('div', null, statusChips());
  v.root.append(h('div', { class: 'toolbar' }, search, chipsHost, h('div', { class: 'row wrap' }, dateBtn, viewsBtn, expBtn)), bar, bulkBar, listEl, more);
  await load();
}

// ---------- recurring schedules ----------
async function recurringList(v, kind) {
  const holder = h('div', { class: 'grid' });
  v.root.append(holder);
  const draw = async () => {
    const r = (await api('acc_list_recurring')).rows.filter((x) => x.kind === kind);
    clear(holder);
    holder.append(h('div', { class: 'banner info' }, icon('info', 20), h('div', null, 'Schedules create a draft (or post it, if you chose auto-post) on each due date. There is no background worker: due documents are created when someone opens Accounting, or when you press ', h('b', null, 'Run due now'), '.')));
    if (!r.length) { holder.append(empty('repeat', 'No recurring ' + (kind === 'expense' ? 'expenses' : kind + 's'), 'Open a new ' + kind + ' and choose “Make recurring” to schedule it.', can(docPerm(kind)) ? h('button', { class: 'btn fill', onclick: () => go('new/' + kind + '?recurring=1') }, 'New schedule') : null)); return; }
    holder.append(h('div', { class: 'row sp' }, h('span', { class: 'muted' }, r.filter((x) => x.due).length + ' due now'), h('button', { class: 'btn fill', onclick: async () => { try { const o = await api('acc_run_recurring'); toast(o.created + ' created' + (o.failed ? ', ' + o.failed + ' failed' : '')); draw(); } catch (e) { fail(e); } } }, 'Run due now')));
    holder.append(dataView([
      { key: 'name', label: 'Schedule', title: true, render: (x) => h('div', null, h('div', { class: 't' }, x.name), x.last_error ? h('div', { class: 's', style: { color: 'var(--red)' } }, x.last_error) : null) },
      { key: 'party_name', label: 'Party', sub: true, render: (x) => (x.party_name || 'No party') + ' · ' + cap1(x.frequency) },
      { key: 'next_date', label: 'Next', value: true, render: (x) => fmtD(x.next_date) },
      { key: 'auto_post', label: 'Creates', render: (x) => (x.auto_post ? 'Posted' : 'Draft') },
      { key: 'runs', label: 'Runs', r: true, render: (x) => x.runs },
      { key: 'active', label: 'Status', badge: true, render: (x) => (x.due ? badge('Due', 'orange') : badge(x.active ? 'Active' : 'Paused', x.active ? 'green' : '')) },
    ], r, { onRow: (x) => recurringSheet(x, draw) }));
  };
  await draw();
}
function recurringSheet(x, done) {
  const name = input({ value: x.name }), fr = selectEl([['weekly', 'Weekly'], ['monthly', 'Monthly'], ['quarterly', 'Quarterly'], ['yearly', 'Yearly']], x.frequency), nd = dateInput(x.next_date), ed = dateInput(x.end_date || ''), ap = checkbox('Post automatically (otherwise create a draft to review)', x.auto_post), ac = checkbox('Active', x.active);
  const apI = $('input', ap), acI = $('input', ac);
  sheet({ title: 'Recurring schedule', body: h('div', { class: 'grid' }, field('Name', name), field('Repeats', fr), field('Next date', nd), field('Stop after (optional)', ed), ap, ac), actions: [
    { label: 'Delete', danger: true, onclick: async (c) => { if (!(await confirmBox('Delete this schedule?', 'Documents already created are kept.', 'Delete', true))) return false; await api('acc_delete_recurring', { p_id: x.id }); c(); done(); } },
    { label: 'Save', primary: true, onclick: async (c) => { await api('acc_save_recurring', { p: { id: x.id, kind: x.kind, name: name.value, frequency: fr.value, next_date: nd.value, end_date: ed.value, auto_post: apI.checked, active: acI.checked, payload: x.payload } }); c(); toast('Schedule saved'); done(); } }] });
}

// ---------- document detail ----------
page('doc', {
  title: 'Document', navAs: 'sales', icon: 'doc', nav: false,
  async render(v) {
    const id = v.args[0];
    const r = await api('acc_get_document', { p_id: id });
    const d = r.doc, party = r.party, t = d.doc_type, posting = POSTING.includes(t), perm = docPerm(t), isSales = SALES_TYPES.includes(t);
    const num = d.number.startsWith('DRAFT-') ? 'Draft ' + DOC_LABEL[t].toLowerCase() : d.number;
    const listPath = t === 'expense' ? 'expenses' : (isSales ? 'sales' : 'purchases') + '?tab=' + t;
    const acts = [];
    if ((d.status === 'draft' || (d.status === 'open' && !posting)) && can(perm)) acts.push({ label: 'Edit', icon: 'edit', primary: d.status === 'open', run: () => go('edit/' + d.id) });
    const pending = !!(d.meta && d.meta.pending_approval);
    if (d.status === 'draft' && posting && can(perm) && (!pending || can('acc_approve'))) acts.push({ label: 'Post', icon: 'check', primary: true, run: () => postDoc(d) });
    const payKind = t === 'invoice' || t === 'debit_note' ? 'receipt' : 'payment';
    if (d.status === 'posted' && Number(d.outstanding) > 0 && can(perm)) acts.push({ label: { invoice: 'Record receipt', bill: 'Record payment', expense: 'Record payment', credit_note: 'Refund customer', debit_note: 'Record refund' }[t], icon: 'wallet', primary: true, run: () => receiptSheet(payKind, { party, doc: d, done: () => v.refresh() }) });
    acts.push({ label: 'Print or PDF', icon: 'print', run: () => printDoc(r) });
    if (['invoice', 'credit_note', 'quotation', 'sales_order', 'delivery_challan'].includes(t) && ['posted', 'open', 'converted'].includes(d.status)) acts.push({ label: 'Share', icon: 'share', run: (b) => shareMenu(b, r) });
    const more = [];
    if (CONVERT[t] && d.status === 'open' && can(perm)) CONVERT[t].forEach((to) => more.push({ label: 'Convert to ' + DOC_LABEL[to].toLowerCase(), icon: 'refresh', run: () => convertDoc(d, to) }));
    if (t === 'invoice' && d.status === 'posted' && can('acc_sales')) more.push({ label: 'Create credit note', icon: 'undo', run: () => go('new/credit_note?ref=' + d.id) });
    if (t === 'bill' && d.status === 'posted' && can('acc_purchase')) more.push({ label: 'Create debit note', icon: 'undo', run: () => go('new/debit_note?ref=' + d.id) });
    if (can(perm) && !d.is_opening) more.push({ label: 'Duplicate', icon: 'file', run: () => go('new/' + t + '?copy=' + d.id) });
    if (d.status === 'posted' && can('acc_cancel') && !d.is_opening) more.push({ label: 'Cancel with reversal…', icon: 'x', danger: true, run: () => cancelDoc(d) });
    if ((d.status === 'open') && can('acc_cancel')) more.push({ label: 'Cancel…', icon: 'x', danger: true, run: () => cancelDoc(d) });
    if ((d.status === 'draft' || d.status === 'open') && can(perm)) more.push({ label: 'Delete', icon: 'trash', danger: true, run: () => deleteDoc(d, listPath) });
    if (more.length) acts.push({ label: 'More', icon: 'more', menu: more });
    v.header({ title: num, back: listPath, actions: acts });

    // summary
    const head = h('div', { class: 'card grid', style: { gap: '12px' } },
      h('div', { class: 'row sp wrap' }, h('div', null, h('div', { class: 'cap' }, DOC_LABEL[t] + (d.is_opening ? ' · opening balance' : '')), h('h2', { style: { fontSize: '22px' } }, num)), statusBadge(d.pay_status)),
      h('div', { class: 'row sp wrap' }, h('div', null, h('div', { class: 'cap' }, isSales ? 'Customer' : 'Supplier'), party && !party.is_walkin ? h('a', { href: '#/party/' + party.id, style: { fontWeight: 600 } }, d.party_name) : h('span', null, d.party_name || 'Walk-in'), d.party_gstin ? h('div', { class: 'cap mono' }, d.party_gstin) : null),
        h('div', { style: { textAlign: 'right' } }, h('div', { class: 'cap' }, 'Date'), fmtD(d.doc_date), d.due_date && posting ? h('div', { class: 'cap' }, 'Due ' + fmtD(d.due_date)) : null)),
      d.parent ? h('div', { class: 'small muted' }, 'From ', h('a', { href: '#/doc/' + d.parent.id }, d.parent.number)) : null,
      d.supplier_ref ? h('div', { class: 'small muted' }, 'Supplier invoice ' + d.supplier_ref + (d.supplier_ref_date ? ' dated ' + fmtD(d.supplier_ref_date) : '')) : null,
      d.reverse_charge ? h('div', { class: 'banner info' }, icon('info', 18), 'Reverse charge: the tax is paid by you, not added to the supplier’s bill.') : null,
      d.meta && d.meta.pending_approval ? h('div', { class: 'banner' }, icon('shield', 18), 'Waiting for approval. A manager must post it.') : null,
      d.status === 'cancelled' ? h('div', { class: 'banner bad' }, icon('x', 18), 'Cancelled' + (d.cancel_reason ? ': ' + d.cancel_reason : '') + (r.reversal ? ' · reversed by ' + r.reversal.number : '')) : null);
    v.root.append(head);

    const totals = h('div', { class: 'card totals' },
      h('div', { class: 't' }, h('span', { class: 'muted' }, 'Subtotal'), money(d.subtotal)), Number(d.discount) ? h('div', { class: 't' }, h('span', { class: 'muted' }, 'Discount'), money(-d.discount)) : null,
      h('div', { class: 't' }, h('span', { class: 'muted' }, 'Taxable value'), money(d.taxable)),
      Number(d.cgst) ? h('div', { class: 't' }, h('span', { class: 'muted' }, 'CGST'), money(d.cgst)) : null, Number(d.sgst) ? h('div', { class: 't' }, h('span', { class: 'muted' }, 'SGST'), money(d.sgst)) : null, Number(d.igst) ? h('div', { class: 't' }, h('span', { class: 'muted' }, 'IGST'), money(d.igst)) : null, Number(d.cess) ? h('div', { class: 't' }, h('span', { class: 'muted' }, 'Cess'), money(d.cess)) : null,
      Number(d.roundoff) ? h('div', { class: 't' }, h('span', { class: 'muted' }, 'Round off'), money(d.roundoff)) : null,
      h('div', { class: 't big' }, h('span', null, 'Total'), money(d.total)),
      posting && d.status === 'posted' ? [h('div', { class: 't' }, h('span', { class: 'muted' }, 'Settled'), money(d.paid)), h('div', { class: 't', style: { fontWeight: 600 } }, h('span', null, 'Outstanding'), money(d.outstanding))] : null);
    const lines = r.lines.length ? dataView([
      { key: 'description', label: 'Item', title: true, render: (l) => h('div', null, h('div', { class: 't' }, l.description || l.sku), l.hsn ? h('div', { class: 's' }, 'HSN ' + l.hsn + (l.batch_no ? ' · batch ' + l.batch_no : '')) : null) },
      { key: 'qty', label: 'Qty', r: true, sub: true, render: (l) => qty(l.qty) + ' ' + (l.unit || '') + ' × ' + inr(l.rate) },
      { key: 'rate', label: 'Rate', r: true, hideMobile: true, render: (l) => money(l.rate) },
      { key: 'disc', label: 'Disc.', r: true, hideMobile: true, render: (l) => (Number(l.disc_amt) ? money(l.disc_amt) : '') },
      { key: 'tax_rate', label: 'GST', r: true, hideMobile: true, render: (l) => l.tax_rate + '%' },
      { key: 'taxable', label: 'Taxable', r: true, hideMobile: true, render: (l) => money(l.taxable) },
      { key: 'total', label: 'Amount', r: true, value: true, render: (l) => money(l.total) },
    ], r.lines, { sortKey: null }) : h('div', { class: 'card' }, h('p', { class: 'muted' }, 'This opening balance has no line items.'));
    v.root.append(h('div', { class: 'two wide-left' }, h('div', { class: 'sec' }, h('div', { class: 'sec-h' }, h('h3', null, 'Items')), lines), h('div', { class: 'sec' }, h('div', { class: 'sec-h' }, h('h3', null, 'Amounts')), totals)));

    // payments, credits, related
    const al = r.allocations.filter((a) => !a.reversed);
    if (al.length || r.children.length) {
      v.root.append(h('div', { class: 'sec' }, h('div', { class: 'sec-h' }, h('h3', null, 'Payments, credits and related documents')), h('div', { class: 'list' },
        al.map((a) => liRow({ icon: a.payment_id ? 'wallet' : 'undo', tone: 'green', title: (a.payment_number || (a.note_id === d.id ? 'Applied to ' + a.doc_number : 'Credit note ' + a.note_number)), sub: fmtD(a.date), value: money(a.amount), chevron: true,
          onclick: () => (a.payment_id ? go('payment/' + a.payment_id) : go('doc/' + (a.note_id === d.id ? a.doc_id : a.note_id))) })),
        r.children.map((c) => liRow({ icon: 'doc', tone: 'gray', title: DOC_LABEL[c.doc_type] + ' ' + c.number, sub: cap1(c.status), value: money(c.total), chevron: true, onclick: () => go('doc/' + c.id) })))));
    }
    if (can('acc_post') && al.some((a) => a.payment_id || a.note_id)) v.root.append(h('div', { class: 'row' }, h('button', { class: 'btn sm', onclick: () => unlinkSheet(al, () => v.refresh()) }, 'Unlink a payment…')));

    // e-invoice / e-way
    if (t === 'invoice' && d.status === 'posted' && can('acc_sales') && d.party_gstin) v.root.append(einvoiceCard(r, () => v.refresh()));
    // accounting entries
    if (r.journal_lines.length) v.root.append(h('div', { class: 'sec' }, h('div', { class: 'sec-h' }, h('h3', null, 'Accounting entries')), h('div', { class: 'card flush' }, h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' },
      h('thead', null, h('tr', null, h('th', null, 'Account'), h('th', { class: 'r' }, 'Debit'), h('th', { class: 'r' }, 'Credit'))),
      h('tbody', null, r.journal_lines.map((j) => h('tr', null, h('td', null, j.account), h('td', { class: 'r' }, Number(j.debit) ? money(j.debit) : ''), h('td', { class: 'r' }, Number(j.credit) ? money(j.credit) : ''))))
    )), h('div', { class: 'row sp small muted', style: { padding: '10px 14px' } }, h('a', { href: '#/journal/' + r.journal.id }, 'Journal ' + r.journal.number), r.reversal ? h('a', { href: '#/journal/' + r.reversal.id }, 'Reversal ' + r.reversal.number) : null))));
    // notes / terms
    if (d.notes || d.terms) v.root.append(h('div', { class: 'card' }, d.notes ? h('div', null, h('div', { class: 'cap' }, 'Notes'), h('p', null, d.notes)) : null, d.terms ? h('div', { style: { marginTop: d.notes ? '10px' : 0 } }, h('div', { class: 'cap' }, 'Terms'), h('p', { class: 'small' }, d.terms)) : null));
    // attachments
    v.root.append(attachmentsCard('document', d.id, r.attachments, can(perm), () => v.refresh()));
    // history
    v.root.append(h('div', { class: 'sec' }, h('div', { class: 'sec-h' }, h('h3', null, 'History')), h('div', { class: 'list' }, r.audit.length ? r.audit.map((a) => liRow({ title: cap1(a.action), sub: (a.actor || 'system') + (a.reason ? ' · ' + a.reason : ''), value: fmtDT(a.at) })) : [liRow({ title: 'No history yet' })])));
  },
});
async function postDoc(d) {
  const msg = 'Posting creates ledger' + (d.doc_type === 'invoice' || d.doc_type === 'credit_note' || d.doc_type === 'bill' || d.doc_type === 'debit_note' ? ', stock' : '') + ' and GST entries and gives it its final number. You cannot edit it afterwards; you can cancel it with a reversal.';
  if (!(await confirmBox('Post ' + DOC_LABEL[d.doc_type].toLowerCase() + '?', msg, 'Post'))) return;
  try { const r = await api('acc_post_document', { p_doc_id: d.id }); toast('Posted ' + r.number); go('doc/' + d.id); route_(); } catch (e) { fail(e); }
}
async function cancelDoc(d) {
  const reason = await askText('Cancel ' + (d.number.startsWith('DRAFT') ? 'document' : d.number) + '?', d.status === 'posted' ? 'This posts a reversing entry and returns the stock. The original stays on record. A reason is required.' : 'A reason is required.', 'Reason');
  if (reason == null) return; if (!reason) return toast('Enter a reason to cancel', { err: true });
  try { await api('acc_cancel_document', { p_doc_id: d.id, p_reason: reason }); toast('Cancelled'); route_(); } catch (e) { fail(e); }
}
async function deleteDoc(d, listPath) {
  if (!(await confirmBox('Delete this ' + DOC_LABEL[d.doc_type].toLowerCase() + '?', 'It has not been posted, so nothing in the books changes.', 'Delete', true))) return;
  try { await api('acc_delete_document', { p_doc_id: d.id }); toast('Deleted'); go(listPath); } catch (e) { fail(e); }
}
async function convertDoc(d, to) {
  if (!(await confirmBox('Convert to ' + DOC_LABEL[to].toLowerCase() + '?', 'A new ' + DOC_LABEL[to].toLowerCase() + ' is created from ' + d.number + ' with the same lines.', 'Convert'))) return;
  try { const r = await api('acc_convert_document', { p_src: d.id, p_to: to }); toast('Created ' + (r.number.startsWith('DRAFT') ? 'draft' : r.number)); go(docPath({ id: r.id, status: r.status, doc_type: to })); } catch (e) { fail(e); }
}
function unlinkSheet(al, done) {
  const body = h('div', { class: 'list' }, al.map((a) => liRow({ icon: 'link', title: (a.payment_number || 'Credit note ' + a.note_number), sub: fmtD(a.date), value: money(a.amount), chevron: true, onclick: async () => {
    if (!(await confirmBox('Unlink ' + inr(a.amount) + '?', 'The amount becomes outstanding again (a receipt or payment returns to unallocated).', 'Unlink'))) return;
    try { await api('acc_unallocate', { p_allocation: a.id }); s.close(); toast('Unlinked'); done(); } catch (e) { fail(e); }
  } })));
  const s = sheet({ title: 'Unlink', closeLabel: 'Done', body });
}
function attachmentsCard(entity, id, list, writable, done) {
  const file = h('input', { type: 'file', accept: 'image/jpeg,image/png,application/pdf', class: 'vh', onchange: async () => {
    const f = file.files[0]; if (!f) return;
    try { await uploadAttachment(entity, id, f); toast('Attached'); done(); } catch (e) { fail(e); } file.value = '';
  } });
  return h('div', { class: 'sec' }, h('div', { class: 'sec-h' }, h('h3', null, 'Attachments'), writable ? h('button', { class: 'btn sm', onclick: () => file.click() }, icon('upload', 16), 'Attach file') : null, file),
    h('div', { class: 'list' }, list.length ? list.map((a) => h('div', { class: 'li' }, h('button', { class: 'row grow', style: { textAlign: 'left' }, onclick: () => openAttachment(a).catch(fail) }, icon('file', 20), h('div', { class: 'grow' }, h('div', { class: 't' }, a.name), h('div', { class: 's' }, fmtD(a.created_at) + (a.size_bytes ? ' · ' + Math.round(a.size_bytes / 1024) + ' KB' : '')))),
      writable ? h('button', { class: 'btn plain icon', 'aria-label': 'Remove ' + a.name, onclick: async () => { if (await confirmBox('Remove attachment?', a.name, 'Remove', true)) { await api('acc_remove_attachment', { p_id: a.id }); done(); } } }, icon('trash', 18)) : null)) : [h('div', { class: 'li muted' }, 'No files attached. JPEG, PNG or PDF, up to 10 MB.')]));
}

// ---------- e-invoice and e-way bill ----------
function einvoiceCard(r, done) {
  const e = r.einvoice, ew = r.eway, d = r.doc;
  const body = h('div', { class: 'grid' },
    h('div', { class: 'row sp wrap' }, h('div', null, h('div', { class: 't', style: { fontWeight: 600 } }, 'E-invoice'), h('div', { class: 'small muted' }, e && e.status === 'generated' ? 'IRN recorded ' + (e.irn || '').slice(0, 12) + '…' : 'Create the JSON, upload it to the IRP, then record the IRN here.')), statusBadge(e ? e.status : 'not_generated')),
    h('div', { class: 'row wrap' },
      h('button', { class: 'btn sm', onclick: async () => { try { const o = await api('acc_einvoice_payload', { p_doc: d.id }); download(d.number.replace(/[^\w-]/g, '_') + '-einvoice.json', new Blob([JSON.stringify(o.payload, null, 2)], { type: 'application/json' })); if (o.warnings.length) await alertBox({ title: 'Check before uploading', message: o.warnings.join(' · '), cancel: false }); done(); } catch (x) { fail(x); } } }, icon('download', 16), 'Download JSON'),
      e && e.status === 'generated' ? h('button', { class: 'btn sm danger', onclick: async () => { const why = await askText('Cancel the IRN?', 'Only after cancelling on the IRP. A reason is required.', 'Reason'); if (why) try { await api('acc_einvoice_cancel', { p_doc: d.id, p_reason: why }); done(); } catch (x) { fail(x); } } }, 'Cancel IRN') : h('button', { class: 'btn sm', onclick: () => irnSheet(d, done) }, 'Record IRN')),
    h('hr', { class: 'sep' }),
    h('div', { class: 'row sp wrap' }, h('div', null, h('div', { class: 't', style: { fontWeight: 600 } }, 'E-way bill'), h('div', { class: 'small muted' }, ew && ew.status === 'generated' ? 'EWB ' + ew.ewb_no : Number(d.total) >= 50000 ? 'Needed for goods above ₹50,000 moving by road.' : 'Optional below ₹50,000.')), statusBadge(ew ? ew.status : 'not_generated')),
    h('div', { class: 'row wrap' }, h('button', { class: 'btn sm', onclick: () => ewaySheet(d, done) }, 'Prepare JSON'), ew && ew.status === 'generated' ? null : h('button', { class: 'btn sm', onclick: () => ewbSheet(d, done) }, 'Record e-way bill no.')));
  return h('div', { class: 'sec' }, h('div', { class: 'sec-h' }, h('h3', null, 'GST e-documents')), h('div', { class: 'card' }, body, h('p', { class: 'cap', style: { marginTop: '10px' } }, 'AUZslab prepares the government JSON and stores the numbers you get back. It does not call the IRP or e-way portal for you.')));
}
function irnSheet(d, done) {
  const irn = input({ placeholder: '64-character IRN', mode: 'text' }), ack = input({ placeholder: 'Ack number' }), ad = dateInput(today()), qr = h('textarea', { class: 'textarea', placeholder: 'Signed QR (optional)' });
  sheet({ title: 'Record IRN', body: h('div', { class: 'grid' }, field('IRN', irn), field('Acknowledgement number', ack), field('Acknowledgement date', ad), field('Signed QR code', qr)), actions: [{ label: 'Save', primary: true, onclick: async (c) => { await api('acc_einvoice_record', { p_doc: d.id, p_irn: irn.value, p_ack_no: ack.value, p_ack_date: ad.value, p_qr: qr.value }); c(); toast('IRN recorded'); done(); } }] });
}
function ewaySheet(d, done) {
  const veh = input({ placeholder: 'e.g. RJ19AB1234' }), dist = input({ type: 'number', mode: 'numeric', value: '0' }), mode = selectEl([['1', 'Road'], ['2', 'Rail'], ['3', 'Air'], ['4', 'Ship']], '1'), tid = input({ placeholder: 'Transporter GSTIN (optional)' });
  sheet({ title: 'E-way bill JSON', body: h('div', { class: 'grid' }, field('Mode', mode), field('Vehicle number', veh), field('Distance (km)', dist), field('Transporter ID', tid)), actions: [{ label: 'Download JSON', primary: true, onclick: async (c) => { const o = await api('acc_eway_payload', { p_doc: d.id, p_transport: { mode: mode.value, vehicle_no: veh.value, distance_km: dist.value, transporter_id: tid.value } }); download(d.number.replace(/[^\w-]/g, '_') + '-eway.json', new Blob([JSON.stringify(o.payload, null, 2)], { type: 'application/json' })); c(); if (o.warnings.length) toast(o.warnings[0]); done(); } }] });
}
function ewbSheet(d, done) {
  const no = input({ placeholder: '12-digit number', mode: 'numeric' }), vu = input({ type: 'datetime-local' });
  sheet({ title: 'Record e-way bill', body: h('div', { class: 'grid' }, field('E-way bill number', no), field('Valid until', vu)), actions: [{ label: 'Save', primary: true, onclick: async (c) => { await api('acc_eway_record', { p_doc: d.id, p_ewb: no.value, p_valid_upto: vu.value ? new Date(vu.value).toISOString() : null }); c(); toast('Saved'); done(); } }] });
}

// ---------- print, share, message ----------
function docLines(r) { return r.lines.map((l, i) => [i + 1, l.description || '', l.hsn || '', qty(l.qty) + ' ' + (l.unit || ''), nf2.format(l.rate), l.tax_rate + '%', nf2.format(l.taxable), nf2.format(l.total)]); }
function invoiceSheetNode(data) { // data: {org, doc, lines} shapes of public_acc_document (also used in-app)
  const o = data.org, d = data.doc;
  const adr = [o.address, [o.city, o.pincode].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  return h('div', null,
    h('div', { style: { display: 'flex', justifyContent: 'space-between', gap: '16px' } }, h('div', null, h('h1', null, o.name || o.legal_name), h('div', null, adr), o.gstin ? h('div', null, 'GSTIN ' + o.gstin) : null, o.phone ? h('div', null, o.phone) : null),
      h('div', { style: { textAlign: 'right' } }, h('h1', null, DOC_LABEL[d.type].toUpperCase()), h('div', null, d.number), h('div', null, 'Date ' + fmtD(d.date)), d.due_date ? h('div', null, 'Due ' + fmtD(d.due_date)) : null)),
    h('div', { class: 'rule' }),
    h('div', { style: { display: 'flex', justifyContent: 'space-between', gap: '16px' } }, h('div', null, h('b', null, 'Bill to'), h('div', null, d.party_name || 'Walk-in'), d.party_gstin ? h('div', null, 'GSTIN ' + d.party_gstin) : null, d.billing_address ? h('div', null, d.billing_address) : null),
      h('div', { style: { textAlign: 'right' } }, d.place_of_supply ? h('div', null, 'Place of supply: ' + stateName(d.place_of_supply)) : null, d.reverse_charge ? h('div', null, 'Reverse charge applies') : null, d.cancelled ? h('b', null, 'CANCELLED') : null)),
    h('div', { style: { height: '10px' } }),
    h('table', null, h('thead', null, h('tr', null, ['#', 'Item', 'HSN/SAC', 'Qty', 'Rate', 'GST', 'Taxable', 'Amount'].map((x, i) => h('th', { class: i > 2 ? 'r' : '' }, x)))), h('tbody', null, data.lines.map((l) => h('tr', null, [l.n, l.description, l.hsn || '', qty(l.qty) + ' ' + (l.unit || ''), nf2.format(l.rate), l.tax_rate + '%', nf2.format(l.taxable), nf2.format(l.total)].map((x, i) => h('td', { class: i > 2 ? 'r' : '' }, x)))))),
    h('div', { style: { display: 'flex', justifyContent: 'flex-end', marginTop: '10px' } }, h('table', { style: { width: '260px' } }, h('tbody', null,
      [['Taxable value', d.taxable], Number(d.cgst) ? ['CGST', d.cgst] : null, Number(d.sgst) ? ['SGST', d.sgst] : null, Number(d.igst) ? ['IGST', d.igst] : null, Number(d.cess) ? ['Cess', d.cess] : null, Number(d.roundoff) ? ['Round off', d.roundoff] : null].filter(Boolean).map(([a, b]) => h('tr', null, h('td', null, a), h('td', { class: 'r' }, nf2.format(b)))),
      h('tr', null, h('td', null, h('b', null, 'Total')), h('td', { class: 'r' }, h('b', null, '₹' + nf2.format(d.total)))), Number(d.paid) ? h('tr', null, h('td', null, 'Received'), h('td', { class: 'r' }, nf2.format(d.paid))) : null, Number(d.paid) ? h('tr', null, h('td', null, 'Balance due'), h('td', { class: 'r' }, nf2.format(d.total - d.paid))) : null))),
    d.notes ? h('p', null, h('b', null, 'Notes: '), d.notes) : null, o.bank_details ? h('p', null, h('b', null, 'Bank details: '), o.bank_details) : null, d.terms ? h('p', { style: { fontSize: '11px' } }, d.terms) : null,
    data.einvoice && data.einvoice.irn ? h('p', { style: { fontSize: '11px', wordBreak: 'break-all' } }, 'IRN: ' + data.einvoice.irn + (data.einvoice.ack_no ? ' · Ack ' + data.einvoice.ack_no : '')) : null, o.footer ? h('p', { style: { textAlign: 'center' } }, o.footer) : null);
}
function printDoc(r) {
  const d = r.doc, o = S.org;
  const data = { org: { name: o.trade_name || o.legal_name, legal_name: o.legal_name, gstin: o.gstin, address: o.address, city: o.city, pincode: o.pincode, phone: o.phone, bank_details: o.bank_details, footer: o.invoice_footer },
    doc: { type: d.doc_type, number: d.number.startsWith('DRAFT') ? 'DRAFT' : d.number, date: d.doc_date, due_date: d.due_date, party_name: d.party_name, party_gstin: d.party_gstin, billing_address: d.billing_address, place_of_supply: d.place_of_supply, reverse_charge: d.reverse_charge,
      taxable: d.taxable, cgst: d.cgst, sgst: d.sgst, igst: d.igst, cess: d.cess, roundoff: d.roundoff, total: d.total, paid: d.paid, notes: d.notes, terms: d.terms, cancelled: d.status === 'cancelled' },
    lines: r.lines.map((l) => ({ n: l.line_no, description: l.description, hsn: l.hsn, qty: l.qty, unit: l.unit, rate: l.rate, tax_rate: l.tax_rate, taxable: l.taxable, total: l.total })), einvoice: r.einvoice && r.einvoice.status === 'generated' ? r.einvoice : null };
  let ps = $('#printSheet'); if (!ps) { ps = h('div', { id: 'printSheet', class: 'print-only' }); document.body.append(ps); }
  clear(ps).append(invoiceSheetNode(data));
  setTimeout(() => window.print(), 50);
}
async function shareLink(doc) { const o = await api('acc_share_document', { p_doc: doc.id, p_enable: true }); return location.origin + '/bill.html?t=' + o.token; }
function shareMenu(anchor, r) {
  const d = r.doc, p = r.party || {};
  const msg = (link) => `Hello ${d.party_name || ''}, here is your ${DOC_LABEL[d.doc_type].toLowerCase()} ${d.number} from ${S.org.trade_name || S.org.legal_name} for ${inr(d.total)}${Number(d.outstanding) > 0 && d.status === 'posted' ? ' (balance ' + inr(d.outstanding) + (d.due_date ? ', due ' + fmtD(d.due_date) : '') + ')' : ''}.\n${link}`;
  const log = (channel, link, recipient) => api('acc_log_comm', { p: { channel, kind: d.doc_type, party_id: d.party_id, doc_id: d.id, recipient, subject: DOC_LABEL[d.doc_type] + ' ' + d.number, body: msg(link), status: 'logged' } }).catch(() => {});
  menu(anchor, [
    { label: 'Copy link', icon: 'link', run: async () => { try { const l = await shareLink(d); await navigator.clipboard.writeText(l); toast('Link copied'); } catch (e) { fail(e); } } },
    { label: 'WhatsApp', icon: 'chat', run: async () => { try { const l = await shareLink(d), ph = (p.phone || '').replace(/\D/g, ''); window.open('https://wa.me/' + (ph.length === 10 ? '91' + ph : ph) + '?text=' + encodeURIComponent(msg(l)), '_blank'); log('whatsapp', l, p.phone); } catch (e) { fail(e); } } },
    { label: 'Email', icon: 'mail', run: async () => { try { const l = await shareLink(d); location.href = 'mailto:' + (p.email || '') + '?subject=' + encodeURIComponent(DOC_LABEL[d.doc_type] + ' ' + d.number) + '&body=' + encodeURIComponent(msg(l)); log('email', l, p.email); } catch (e) { fail(e); } } },
    '-', { label: 'Stop sharing link', icon: 'lock', run: async () => { await api('acc_share_document', { p_doc: d.id, p_enable: false }); toast('Link disabled'); } }]);
}
