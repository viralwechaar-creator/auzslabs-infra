/* Customers, suppliers, and the party page (documents, payments, statement, ageing). */
'use strict';
const GST_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
function gstinValid(g) {
  g = String(g || '').trim().toUpperCase();
  if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(g)) return false;
  let f = 1, s = 0;
  for (let i = 0; i < 14; i++) { const c = GST_CHARS.indexOf(g[i]) * f; s += Math.floor(c / 36) + (c % 36); f = f === 1 ? 2 : 1; }
  return GST_CHARS[(36 - (s % 36)) % 36] === g[14];
}
const waLink = (phone, text) => { const ph = String(phone || '').replace(/\D/g, ''); return 'https://wa.me/' + (ph.length === 10 ? '91' + ph : ph) + '?text=' + encodeURIComponent(text); };

function partiesPage(id, kind, title, icon_) {
  page(id, {
    title, icon: icon_, perm: 'acc_view',
    async render(v) {
      const writable = can(kind === 'customer' ? 'acc_sales' : 'acc_purchase'), noun = kind === 'customer' ? 'customer' : 'supplier';
      v.header({ title, actions: [writable ? { label: 'New ' + noun, icon: 'plus', primary: true, run: () => partySheet(kind, null, () => v.refresh()) } : null,
        { label: 'Reminders', icon: 'chat', run: () => remindersSheet(kind === 'customer' ? 'receivable' : 'payable') }, writable && can('acc_import') ? { label: 'Import', icon: 'upload', run: () => go('data?entity=' + (kind === 'customer' ? 'customers' : 'suppliers')) } : null].filter(Boolean) });
      const r = (await api('acc_list_parties', { p: { kind, limit: 5000 } })).rows.filter((p) => !p.is_walkin);
      let f = v.q.get('f') || '', q = '';
      const host = h('div'), bulk = h('div', { class: 'row sp hidden banner info' });
      const tot = r.reduce((s, p) => s + Number(p.balance), 0), over = r.reduce((s, p) => s + Number(p.overdue), 0);
      const draw = () => {
        let rows = r.filter((p) => (!q || p.name.toLowerCase().includes(q.toLowerCase()) || (p.gstin || '').toLowerCase().includes(q.toLowerCase()) || (p.phone || '').includes(q)) && (f === 'inactive' ? !p.active : p.active) && (f === 'owing' ? Number(p.balance) !== 0 : f === 'overdue' ? Number(p.overdue) > 0 : true));
        clear(host);
        if (!rows.length) { host.append(empty(icon_, r.length ? 'No matches' : 'No ' + noun + 's yet', r.length ? 'Try another search or filter.' : 'Add your first ' + noun + ' to start billing.', writable && !r.length ? h('button', { class: 'btn fill', onclick: () => partySheet(kind, null, () => v.refresh()) }, 'New ' + noun) : null)); return; }
        host.append(dataView([
          { key: 'name', label: 'Name', title: true, render: (p) => h('div', null, h('div', { class: 't' }, p.name), h('div', { class: 's' }, [p.gstin, p.phone].filter(Boolean).join(' · ') || (p.state_code ? stateName(p.state_code) : ''))) },
          { key: 'gstin', label: 'GSTIN', render: (p) => (p.gstin ? h('span', { class: 'mono' }, p.gstin) : h('span', { class: 'muted' }, 'Unregistered')) },
          { key: 'phone', label: 'Phone', render: (p) => p.phone || '' },
          { key: 'credit_days', label: 'Terms', render: (p) => (p.credit_days ? p.credit_days + ' days' : 'Immediate'), r: true },
          { key: 'overdue', label: 'Overdue', r: true, sub: false, render: (p) => (Number(p.overdue) ? money(p.overdue, { cls: 'neg' }) : h('span', { class: 'muted' }, '–')), sortVal: (p) => Number(p.overdue) },
          { key: 'balance', label: kind === 'customer' ? 'Owes you' : 'You owe', r: true, value: true, sortVal: (p) => Math.abs(p.balance), render: (p) => Number(p.balance) === 0 ? h('span', { class: 'muted' }, 'Settled') : h('span', null, money(Math.abs(p.balance)), h('div', { class: 'cap' }, (kind === 'customer' ? Number(p.balance) > 0 : Number(p.balance) < 0) ? (kind === 'customer' ? 'to collect' : 'to pay') : 'advance')) },
        ], rows, { onRow: (p) => go('party/' + p.id), selectable: writable, onSelect: (s) => { bulk.classList.toggle('hidden', !s.size); bulk.replaceChildren(h('span', null, s.size + ' selected'), h('button', { class: 'btn sm fill', onclick: () => bulkParties([...s], () => v.refresh()) }, 'Edit selected')); } }));
      };
      v.root.append(h('div', { class: 'kpis k3' }, kpi(kind === 'customer' ? 'Owed to you' : 'You owe', inr(Math.abs(tot), 0), r.length + ' ' + noun + 's'), kpi('Overdue', inr(over, 0), over > 0 ? 'Chase these first' : 'Nothing overdue', null), kpi('Active', String(r.filter((p) => p.active).length), r.filter((p) => !p.active).length + ' inactive')),
        h('div', { class: 'toolbar' }, searchField('Search ' + noun + 's', debounce((x) => { q = x; draw(); }, 200)), chips([['', 'All'], ['owing', kind === 'customer' ? 'Owing' : 'To pay'], ['overdue', 'Overdue'], ['inactive', 'Inactive']], f, (x) => { f = x; draw(); }),
          h('div', { class: 'row' }, h('button', { class: 'btn', onclick: (e) => exportMenu(e.currentTarget, title.toLowerCase(), ['Name', 'GSTIN', 'State', 'Phone', 'Email', 'Credit days', 'Credit limit', 'Balance', 'Overdue'], r.map((p) => [p.name, p.gstin || '', p.state_code || '', p.phone || '', p.email || '', p.credit_days, Number(p.credit_limit), Number(p.balance), Number(p.overdue)])) }, icon('download', 18), 'Export'))), bulk, host);
      draw();
    },
  });
}
partiesPage('customers', 'customer', 'Customers', 'users');
partiesPage('suppliers', 'supplier', 'Suppliers', 'building');

function bulkParties(ids, done) {
  const cd = input({ type: 'number', placeholder: 'No change', mode: 'numeric' }), cl = input({ type: 'number', placeholder: 'No change', mode: 'numeric' }), tg = input({ placeholder: 'No change' }), st = selectEl([['', 'No change'], ['true', 'Active'], ['false', 'Inactive']], '');
  sheet({ title: 'Edit ' + ids.length + ' selected', body: h('div', { class: 'grid' }, field('Credit days', cd), field('Credit limit (₹, 0 = none)', cl), field('Tags', tg), field('Status', st)), actions: [{ label: 'Apply', primary: true, onclick: async (c) => {
    const ch = {}; if (cd.value !== '') ch.credit_days = cd.value; if (cl.value !== '') ch.credit_limit = cl.value; if (tg.value) ch.tags = tg.value; if (st.value) ch.active = st.value === 'true';
    if (!Object.keys(ch).length) { toast('Nothing to change', { err: true }); return false; }
    const r = await api('acc_bulk_update', { p_entity: 'parties', p_ids: ids, p_changes: ch }); c(); toast(r.updated + ' updated'); bust('parties'); done(); } }] });
}

// ---------- create / edit sheet ----------
function partySheet(kind, p, onSaved) {
  const isNew = !p; p = p || {};
  let k = p.kind || kind || 'customer';
  const name = input({ value: p.name || '', placeholder: 'Name', label: 'Name' }), gst = input({ value: p.gstin || '', placeholder: '15-character GSTIN', max: 15, label: 'GSTIN' }), pan = input({ value: p.pan || '', placeholder: 'PAN', max: 10 });
  const gstMsg = h('div', { class: 'hint' }, 'Optional. Registered businesses should have one so they can claim input credit.');
  const stSel = selectEl([['', 'Choose state'], ...Object.keys(STATES).map((c) => [c, stateName(c)])], p.state_code || '', {});
  const reg = selectEl([['unregistered', 'Unregistered'], ['regular', 'Registered (regular)'], ['composition', 'Composition scheme'], ['sez', 'SEZ'], ['overseas', 'Overseas (export)']], p.reg_type || 'unregistered');
  gst.addEventListener('input', () => { const g = gst.value.trim().toUpperCase(); gst.value = g; if (!g) { gst.classList.remove('err'); gstMsg.textContent = 'Optional. Registered businesses should have one so they can claim input credit.'; return; }
    if (g.length < 15) { gst.classList.remove('err'); gstMsg.textContent = g.length + ' of 15 characters'; return; }
    if (gstinValid(g)) { gst.classList.remove('err'); gstMsg.textContent = 'Valid GSTIN · ' + (STATES[g.slice(0, 2)] || 'unknown state'); stSel.value = g.slice(0, 2); if (reg.value === 'unregistered') reg.value = 'regular'; } else { gst.classList.add('err'); gstMsg.textContent = 'This GSTIN is not valid. Check the characters and the last check digit.'; } });
  const ph = input({ value: p.phone || '', type: 'tel', mode: 'tel', placeholder: 'Mobile number' }), em = input({ value: p.email || '', type: 'email', placeholder: 'name@example.com' }), cn = input({ value: p.contact_name || '', placeholder: 'Contact person' });
  const ba = h('textarea', { class: 'textarea', placeholder: 'Billing address', style: { minHeight: '70px' } }, p.billing_address || ''), sa = h('textarea', { class: 'textarea', placeholder: 'Shipping address (if different)', style: { minHeight: '70px' } }, p.shipping_address || '');
  const cl = input({ value: p.credit_limit && Number(p.credit_limit) ? p.credit_limit : '', type: 'number', mode: 'decimal', placeholder: '0 = no limit' }), cd = input({ value: p.credit_days || '', type: 'number', mode: 'numeric', placeholder: '0 = immediate' }), tg = input({ value: p.tags || '' }), nt = h('textarea', { class: 'textarea', style: { minHeight: '70px' } }, p.notes || '');
  const kindSeg = isNew && kind !== 'any' ? null : null;
  const s = sheet({ title: (isNew ? 'New ' : 'Edit ') + (k === 'supplier' ? 'supplier' : 'customer'), body: h('div', { class: 'grid' },
    field('Name', name), field('GSTIN', gst, null), gstMsg, h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' } }, field('State', stSel), field('Registration', reg)), field('PAN', pan),
    h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' } }, field('Phone', ph), field('Email', em)), field('Contact person', cn), field('Billing address', ba), field('Shipping address', sa),
    h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' } }, field('Credit days', cd), field('Credit limit (₹)', cl)), field('Tags', tg), field('Notes', nt),
    !isNew ? toggleRow('Active', p.active !== false, (x) => { p.active = x; }) : null),
    actions: [{ label: isNew ? 'Add' : 'Save', primary: true, onclick: async (c) => {
      if (!name.value.trim()) { name.classList.add('err'); name.focus(); return false; }
      const body = { id: p.id || null, kind: p.kind || k, name: name.value, gstin: gst.value, pan: pan.value, state_code: stSel.value, reg_type: reg.value, phone: ph.value, email: em.value, contact_name: cn.value, billing_address: ba.value, shipping_address: sa.value, credit_days: cd.value || 0, credit_limit: cl.value || 0, tags: tg.value, notes: nt.value, active: p.active !== false };
      const r = await api('acc_save_party', { p: body }); bust('parties'); c();
      if (r.duplicate_gstin_of) toast('Saved. Note: another party already uses this GSTIN (' + r.duplicate_gstin_of + ')'); else toast(isNew ? 'Added' : 'Saved');
      const list = await parties(true); onSaved && onSaved(list.find((x) => x.id === r.id));
    } }] });
  name.focus();
}

// ---------- reminders ----------
async function remindersSheet(side) {
  const r = (await api('acc_due_reminders', { p_side: side })).rows;
  const org = S.org.trade_name || S.org.legal_name;
  const msg = (x) => side === 'receivable' ? `Hello ${x.name}, a gentle reminder from ${org}: ${inr(x.overdue, 0)} is overdue (${x.items.map((i) => i.number + ' due ' + fmtD(i.due)).slice(0, 4).join(', ')}). Please pay at your earliest. Thank you.` : `Payment due to ${x.name}: ${inr(x.overdue, 0)} (${x.items.map((i) => i.number).slice(0, 4).join(', ')}).`;
  const log = (channel, x) => api('acc_log_comm', { p: { channel, kind: 'payment_reminder', party_id: x.party_id, recipient: channel === 'email' ? x.email : x.phone, subject: 'Payment reminder', body: msg(x), status: 'logged' } }).catch(() => {});
  sheet({ title: side === 'receivable' ? 'Payment reminders' : 'Payables due', closeLabel: 'Done', body: h('div', { class: 'grid' },
    h('p', { class: 'muted small' }, side === 'receivable' ? 'These customers have overdue invoices. Choose how to remind each one; the message opens in WhatsApp or your email app and is logged under Messages.' : 'Suppliers whose bills are past due.'),
    r.length ? h('div', { class: 'list' }, r.map((x) => h('div', { class: 'li' }, h('div', { class: 'grow' }, h('div', { class: 't' }, x.name), h('div', { class: 's' }, x.docs + ' overdue · oldest ' + fmtD(x.oldest_due))), h('div', { class: 'v' }, h('div', { class: 't' }, money(x.overdue)), side === 'receivable' ? h('div', { class: 'row', style: { gap: '6px', marginTop: '4px', justifyContent: 'flex-end' } },
      h('button', { class: 'btn sm', disabled: !x.phone, onclick: () => { window.open(waLink(x.phone, msg(x)), '_blank'); log('whatsapp', x); } }, 'WhatsApp'), h('button', { class: 'btn sm', disabled: !x.email, onclick: () => { location.href = 'mailto:' + x.email + '?subject=' + encodeURIComponent('Payment reminder') + '&body=' + encodeURIComponent(msg(x)); log('email', x); } }, 'Email')) : null)))) : empty('check', 'Nothing overdue', side === 'receivable' ? 'Every customer is within terms.' : 'You are within terms with every supplier.')) });
}

// ---------- party page ----------
page('party', {
  title: 'Party', icon: 'user', nav: false, navAs: 'customers',
  async render(v) {
    const id = v.args[0];
    const all = await parties(true); const p = all.find((x) => x.id === id);
    if (!p) throw new Error('Customer or supplier not found');
    const isCust = p.kind !== 'supplier', writable = can(isCust ? 'acc_sales' : 'acc_purchase'), tab = v.q.get('tab') || 'documents';
    v.header({ title: p.name, back: isCust ? 'customers' : 'suppliers', actions: [
      writable && isCust ? { label: 'New invoice', icon: 'plus', primary: true, run: () => go('new/invoice?party=' + p.id) } : null, writable && !isCust ? { label: 'New bill', icon: 'plus', primary: true, run: () => go('new/bill?party=' + p.id) } : null,
      writable ? { label: isCust ? 'Receive money' : 'Pay money', icon: 'wallet', run: () => receiptSheet(isCust ? 'receipt' : 'payment', { party: p, done: () => v.refresh() }) } : null,
      writable ? { label: 'Edit', icon: 'edit', run: () => partySheet(p.kind, p, () => v.refresh()) } : null,
      can('acc_admin') && !p.is_walkin ? { label: 'Opening balance', icon: 'book', run: () => openingSheet(p, () => v.refresh()) } : null].filter(Boolean) });
    v.root.append(h('div', { class: 'card grid', style: { gap: '10px' } },
      h('div', { class: 'row sp wrap' }, h('div', null, p.gstin ? h('div', { class: 'mono' }, p.gstin) : h('div', { class: 'muted' }, 'Unregistered'), h('div', { class: 'small muted' }, [p.state_code ? stateName(p.state_code) : '', p.phone, p.email].filter(Boolean).join(' · '))), p.active ? null : badge('Inactive')),
      p.billing_address ? h('div', { class: 'small' }, p.billing_address) : null, p.notes ? h('div', { class: 'small muted' }, p.notes) : null));
    const bal = Number(p.balance);
    v.root.append(h('div', { class: 'kpis k3' }, kpi(isCust ? (bal >= 0 ? 'Owes you' : 'Advance held') : (bal <= 0 ? 'You owe' : 'Advance paid'), inr(Math.abs(bal), 0), bal === 0 ? 'Settled' : ''), kpi('Overdue', inr(p.overdue, 0), Number(p.overdue) ? 'Past due date' : 'None', null), kpi('Terms', p.credit_days ? p.credit_days + ' days' : 'Immediate', Number(p.credit_limit) ? 'Limit ' + inr(p.credit_limit, 0) : 'No credit limit')));
    v.root.append(seg([['documents', 'Documents'], ['payments', 'Payments'], ['statement', 'Statement'], ['ageing', 'Ageing']], tab, (t) => go('party/' + id + '?tab=' + t)));
    const host = h('div', { class: 'grid' }); v.root.append(host);
    if (tab === 'documents') {
      const types = isCust ? ['invoice', 'credit_note', 'quotation', 'sales_order'] : ['bill', 'debit_note', 'expense', 'purchase_order'];
      const r = await api('acc_list_documents', { p: { types, party_id: id, limit: 200 } });
      host.append(dataView([
        { key: 'number', label: 'Document', title: true, render: (x) => (x.number.startsWith('DRAFT-') ? 'Draft' : x.number) }, { key: 'doc_type', label: 'Type', sub: true, render: (x) => DOC_LABEL[x.doc_type] + ' · ' + fmtD(x.doc_date) },
        { key: 'due_date', label: 'Due', render: (x) => (x.due_date ? fmtD(x.due_date) : '') }, { key: 'pay_status', label: 'Status', badge: true, render: (x) => statusBadge(x.pay_status) },
        { key: 'total', label: 'Total', r: true, value: true, render: (x) => money(x.total), sortVal: (x) => Number(x.total) }, { key: 'outstanding', label: 'Outstanding', r: true, render: (x) => (x.status === 'posted' && Number(x.outstanding) > 0 ? money(x.outstanding) : '') },
      ], r.rows, { onRow: (x) => go(docPath(x)), empty: empty('doc', 'No documents yet', 'Documents for this ' + (isCust ? 'customer' : 'supplier') + ' appear here.') }));
    } else if (tab === 'payments') {
      const r = (await api('acc_list_payments', { p: { party_id: id, limit: 200 } })).rows;
      host.append(dataView([{ key: 'number', label: 'Number', title: true }, { key: 'pay_date', label: 'Date', sub: true, render: (x) => fmtD(x.pay_date) + ' · ' + x.account }, { key: 'mode', label: 'Method', render: (x) => x.mode || '' },
        { key: 'status', label: 'Status', badge: true, render: (x) => statusBadge(x.status === 'cancelled' ? 'cancelled' : Number(x.unallocated) > 0 ? 'open' : 'posted') }, { key: 'amount', label: 'Amount', r: true, value: true, render: (x) => money(x.amount) }, { key: 'unallocated', label: 'Unallocated', r: true, render: (x) => (Number(x.unallocated) > 0 && x.status === 'posted' ? money(x.unallocated) : '') }],
        r, { onRow: (x) => go('payment/' + x.id), empty: empty('wallet', 'No payments yet') }));
    } else if (tab === 'statement') {
      const from = v.q.get('from') || curFY().start_date, to = v.q.get('to') || today();
      const st = await api('acc_party_statement', { p_party: id, p_from: from, p_to: to });
      const fe = dateInput(from), te = dateInput(to); const go2 = () => go('party/' + id + '?tab=statement&from=' + fe.value + '&to=' + te.value); fe.onchange = go2; te.onchange = go2;
      const L = st.ledger;
      host.append(h('div', { class: 'row wrap' }, h('div', { class: 'grow', style: { minWidth: '140px' } }, field('From', fe)), h('div', { class: 'grow', style: { minWidth: '140px' } }, field('To', te))),
        h('div', { class: 'row wrap' }, h('button', { class: 'btn', onclick: () => printStatement(st, from, to) }, icon('print', 18), 'Print or PDF'),
          h('button', { class: 'btn', onclick: () => { const text = `Statement from ${S.org.trade_name || S.org.legal_name}: balance on ${fmtD(to)} is ${inr(Math.abs(L.closing))}${L.closing > 0 ? ' payable by you' : L.closing < 0 ? ' in your favour' : ''}.`; window.open(waLink(p.phone, text), '_blank'); api('acc_log_comm', { p: { channel: 'whatsapp', kind: 'statement', party_id: id, recipient: p.phone, subject: 'Statement', body: text } }).catch(() => {}); } }, icon('chat', 18), 'WhatsApp'),
          h('button', { class: 'btn', onclick: (e) => exportMenu(e.currentTarget, 'statement-' + p.name, ['Date', 'Voucher', 'Document', 'Narration', 'Debit', 'Credit', 'Balance'], [['', '', '', 'Opening balance', '', '', Number(L.opening)], ...L.rows.map((x) => [x.jdate, x.jv, x.doc_number || '', x.narration || '', Number(x.debit), Number(x.credit), Number(x.balance)])]) }, icon('download', 18), 'Export')),
        h('div', { class: 'card flush' }, h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' }, h('thead', null, h('tr', null, ['Date', 'Entry', 'Debit', 'Credit', 'Balance'].map((x, i) => h('th', { class: i > 1 ? 'r' : '' }, x)))), h('tbody', null,
          h('tr', null, h('td', null, fmtD(from)), h('td', { class: 'muted' }, 'Opening balance'), h('td'), h('td'), h('td', { class: 'r' }, money(L.opening, { signed: true }))),
          L.rows.map((x) => h('tr', { class: x.doc_number ? 'click' : '', onclick: () => { if (x.source_type === 'document') go('doc/' + x.source_id); else if (x.source_type === 'payment') go('payment/' + x.source_id); } }, h('td', null, fmtD(x.jdate)), h('td', null, h('div', { class: 't' }, x.doc_number || x.jv), h('div', { class: 's' }, x.narration || '')), h('td', { class: 'r' }, Number(x.debit) ? money(x.debit) : ''), h('td', { class: 'r' }, Number(x.credit) ? money(x.credit) : ''), h('td', { class: 'r' }, money(x.balance, { signed: true })))),
          h('tr', null, h('td', null), h('td', { style: { fontWeight: 600 } }, 'Closing balance'), h('td'), h('td'), h('td', { class: 'r', style: { fontWeight: 700 } }, money(L.closing, { signed: true }))))))),
        h('p', { class: 'cap' }, 'Positive = the party owes you (receivable). Negative = you owe them or hold their advance.'));
    } else {
      const a = await api('acc_ageing', { p: { kind: isCust ? 'receivable' : 'payable', party_id: id } });
      const t = a.totals;
      host.append(h('div', { class: 'kpis' }, [['Current', t.current], ['1–30 days', t.d30], ['31–60 days', t.d60], ['61–90 days', t.d90], ['Over 90', t.d90p], ['Advances', t.advance]].map(([l, x]) => kpi(l, inr(x, 0), ''))),
        a.docs.length ? h('div', { class: 'list' }, a.docs.map((x) => liRow({ icon: x.doc_type === 'receipt' || x.doc_type === 'payment' ? 'wallet' : 'doc', tone: x.bucket === 'd90p' || x.bucket === 'd90' ? 'orange' : 'gray', title: x.number, sub: (x.bucket === 'advance' ? 'Unallocated ' : 'Due ') + fmtD(x.due_date) + (x.bucket !== 'current' && x.bucket !== 'advance' ? ' · ' + x.days + ' days late' : ''), value: money(x.amount, { signed: true }), chevron: true, onclick: () => go((x.doc_type === 'receipt' || x.doc_type === 'payment' ? 'payment/' : 'doc/') + x.doc_id) }))) : empty('check', 'Nothing outstanding'));
    }
  },
});
function openingSheet(p, done) {
  const amt = input({ type: 'number', mode: 'decimal', placeholder: '0.00' }), d = dateInput(curFY().start_date);
  sheet({ title: 'Opening balance', body: h('div', { class: 'grid' }, h('p', { class: 'muted' }, 'Money ' + (p.kind === 'supplier' ? 'you already owed ' : 'they already owed you ') + 'before you started using AUZslab. It becomes an opening ' + (p.kind === 'supplier' ? 'bill' : 'invoice') + ' you can settle like any other, balanced against “Opening balance equity”.'), field('Amount', amt), field('As of', d)),
    actions: [{ label: 'Save', primary: true, onclick: async (c) => { await api('acc_set_party_opening', { p_party: p.id, p_amount: amt.value, p_date: d.value }); bust('parties'); c(); toast('Opening balance recorded'); done(); } }] });
}
function printStatement(st, from, to) {
  const p = st.party, L = st.ledger, o = S.org;
  let ps = $('#printSheet'); if (!ps) { ps = h('div', { id: 'printSheet', class: 'print-only' }); document.body.append(ps); }
  clear(ps).append(h('h1', null, 'Statement of account'), h('div', null, (o.trade_name || o.legal_name) + (o.gstin ? ' · GSTIN ' + o.gstin : '')), h('div', { class: 'rule' }), h('div', null, h('b', null, p.name), p.gstin ? ' · ' + p.gstin : ''), h('div', null, fmtD(from) + ' to ' + fmtD(to)), h('div', { style: { height: '8px' } }),
    h('table', null, h('thead', null, h('tr', null, ['Date', 'Entry', 'Debit', 'Credit', 'Balance'].map((x, i) => h('th', { class: i > 1 ? 'r' : '' }, x)))), h('tbody', null, h('tr', null, h('td', null, fmtD(from)), h('td', null, 'Opening balance'), h('td'), h('td'), h('td', { class: 'r' }, nf2.format(L.opening))),
      L.rows.map((x) => h('tr', null, h('td', null, fmtD(x.jdate)), h('td', null, (x.doc_number || x.jv) + (x.narration ? ' · ' + x.narration : '')), h('td', { class: 'r' }, Number(x.debit) ? nf2.format(x.debit) : ''), h('td', { class: 'r' }, Number(x.credit) ? nf2.format(x.credit) : ''), h('td', { class: 'r' }, nf2.format(x.balance)))),
      h('tr', null, h('td'), h('td', null, h('b', null, 'Closing balance')), h('td'), h('td'), h('td', { class: 'r' }, h('b', null, nf2.format(L.closing)))))));
  setTimeout(() => window.print(), 50);
}
