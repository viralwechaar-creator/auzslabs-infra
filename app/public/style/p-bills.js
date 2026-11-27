/* AUZsStyle: Bills. Find a bill, reprint, share, take a return or exchange back, or cancel it (manager). */
'use strict';
const BU = { k: 'today', from: null, to: null, q: '', status: '', src: 'shop' };
page('bills', {
  title: 'Bills', perm: 'sty_view',
  async render(v) {
    v.header({ title: t('Bills'), actions: can('sty_sell') ? [{ label: t('New invoice'), icon: 'plus', primary: true, run: () => go('invoice') }] : [] });
    Object.assign(BU, rangeFor(BU.k, BU.from ? { from: BU.from, to: BU.to } : null));
    const custId = v.q.get('customer') || '';
    const list = h('div', { class: 'list' }), kp = h('div', { class: 'kpis' });
    async function load() {
      clear(list).append(h('div', { class: 'spin', style: { color: 'var(--tint)', margin: '20px auto' } }));
      if (BU.src === 'web') return loadWeb();
      if (BU.src === 'requests') return loadRequests();
      if (BU.src === 'returns') return loadReturns();
      if (BU.src === 'quotes') return loadQuotes();
      let rows = []; try { rows = await api('sty_list_sales', { p: { from: custId ? '' : BU.from, to: custId ? '' : BU.to, q: BU.q, status: BU.status, customerId: custId, limit: 200 } }) || []; } catch (e) { return clear(list).append(empty('cloudOff', t('Could not load'), e.message)); }
      const live = rows.filter((r) => r.status !== 'void'), tot = live.reduce((a, r) => a + r.total, 0);
      clear(kp).append(kpi(t('Sales'), inr(tot, 0), live.length + ' ' + t('Bills')), kpi(t('Due'), inr(live.reduce((a, r) => a + Math.max(r.total - r.paid, 0), 0), 0), '', null, ''));
      clear(list).append(...(rows.length ? rows.map((r) => liRow({ icon: r.status === 'void' ? 'x' : 'tag', title: r.number + (r.customer ? ' · ' + r.customer : ''),
        sub: fmtDT(r.at) + ' · ' + r.units + ' ' + t('Units') + (r.staff ? ' · ' + r.staff : '') + (r.returned ? ' · ' + (r.exchanged ? t('Exchanged') : t('Returned')) + ' ' + inr(r.refunded, 0) : ''),
        value: inr(r.total), valueSub: r.status === 'void' ? t('Cancelled') : r.status === 'due' ? t('Due') + ' ' + inr(r.total - r.paid) : (r.returned ? (r.exchanged ? t('Exchanged') : t('Returned')) : ''),
        chevron: !r.waiting, onclick: () => (r.waiting ? toast(t('This bill is saved on this device and will be sent when the connection is back.')) : billSheet(r.id, load)) })) : [empty('tag', t('No bills'), t('Bills show here as you sell.'))]));
    }
    async function loadQuotes() {
      let rows = []; try { rows = await api('sty_quote_list', { p: {} }) || []; } catch (e) { return clear(list).append(empty('cloudOff', t('Could not load'), e.message)); }
      const open = rows.filter((r) => r.status === 'open');
      clear(kp).append(kpi(t('Open quotations'), open.length, inr(open.reduce((a, r) => a + r.total, 0), 0)), kpi(t('Converted'), String(rows.filter((r) => r.status === 'converted').length), '', null, ''));
      clear(list).append(...(rows.length ? rows.map((r) => liRow({ icon: 'tag', title: r.number + (r.customer ? ' · ' + r.customer : ''), sub: fmtDT(r.at) + ' · ' + r.units + ' ' + t('Units') + (r.validUntil ? ' · ' + t('Valid till') + ' ' + fmtDay(r.validUntil) : ''), value: inr(r.total), valueSub: r.status === 'converted' ? t('Converted') : r.status === 'void' ? t('Cancelled') : t('Open'), chevron: true, onclick: () => quoteSheet(r, load) })) : [empty('tag', t('No quotations yet'), t('Save a cart as a quote from the Sell page.'))]));
    }
    function quoteSheet(row, reload) {
      sheet({ title: row.number, closeLabel: t('Done'), body: h('div', { class: 'grid' },
        h('div', { class: 'kv' }, h('span', null, t('Total')), h('b', { class: 'num' }, inr(row.total))),
        row.customer ? h('div', { class: 'muted small' }, row.customer) : null,
        row.validUntil ? h('div', { class: 'muted small' }, t('Valid till') + ' ' + fmtDay(row.validUntil)) : null,
        row.status !== 'open' ? h('div', { class: 'muted small' }, row.status === 'converted' ? t('Already converted to a bill') : t('Cancelled')) : null),
        actions: row.status === 'open' ? [
          { label: t('Cancel quotation'), onclick: async (close) => { if (!await confirmBox(t('Cancel this quotation?'), '', t('Cancel quotation'), true)) return false; try { await api('sty_quote_void', { p_id: row.id }); } catch (e) { return fail(e); } close(); toast(t('Quotation cancelled')); reload && reload(); } },
          { label: t('Convert to bill'), primary: true, onclick: async (close) => { close(); await openQuoteInSell(row.id); } }] : [] });
    }
    async function loadReturns() {
      let rows = []; try { rows = await api('sty_list_returns', { p: { from: BU.from, to: BU.to } }) || []; } catch (e) { return clear(list).append(empty('cloudOff', t('Could not load'), e.message)); }
      const exch = rows.filter((r) => r.mode === 'exchange');
      clear(kp).append(kpi(t('Refunded'), inr(rows.reduce((a, r) => a + r.refund, 0), 0), rows.length + ' ' + t('Returns')), kpi(t('Exchanges'), String(exch.length), '', null, ''));
      clear(list).append(...(rows.length ? rows.map((r) => liRow({ icon: 'swap', title: r.saleNumber + (r.customer ? ' · ' + r.customer : ''), sub: fmtDT(r.at) + ' · ' + r.units + ' ' + t('Units') + (r.reason ? ' · ' + r.reason : '') + (r.staff ? ' · ' + r.staff : ''), value: inr(r.refund), valueSub: r.mode === 'exchange' ? t('Exchange') : t('Refund'), chevron: true, onclick: () => billSheet(r.saleId, load) })) : [empty('swap', t('No returns or exchanges in this period'))]));
    }
    const WST = { new: 'New', confirmed: 'Confirmed', packed: 'Packed', shipped: 'Shipped', delivered: 'Delivered', cancelled: 'Cancelled' };
    async function loadWeb() {
      let rows = []; try { rows = await api('sty_web_orders_list', { p: {} }) || []; } catch (e) { return clear(list).append(empty('cloudOff', t('Could not load'), e.message)); }
      const q = BU.q.trim().toLowerCase();
      if (q) rows = rows.filter((r) => (r.number + ' ' + (r.customer.name || '') + ' ' + (r.customer.phone || '')).toLowerCase().includes(q));
      const live = rows.filter((r) => r.status !== 'cancelled');
      clear(kp).append(kpi(t('Website orders'), inr(live.reduce((a, r) => a + r.total, 0), 0), live.length + ' ' + t('Orders')), kpi(t('New'), String(rows.filter((r) => r.status === 'new').length), '', null, ''));
      clear(list).append(...(rows.length ? rows.map((r) => liRow({ icon: 'globe', title: r.number + ' · ' + r.customer.name, sub: fmtDT(r.createdAt) + ' · ' + r.lines.reduce((a, l) => a + l.qty, 0) + ' ' + t('Units') + (r.saleNo ? ' · ' + t('Bill') + ' ' + r.saleNo : ''), value: inr(r.total), valueSub: t(WST[r.status] || r.status) + (r.paymentStatus === 'paid' ? ' · ' + t('Paid') : ''), chevron: true, onclick: () => orderSheet(r, load) })) : [empty('globe', t('No website orders'), t('Orders from your online store show here.'))]));
    }
    async function loadRequests() {
      let rows = []; try { rows = await api('sty_return_requests_list') || []; } catch (e) { return clear(list).append(empty('cloudOff', t('Could not load'), e.message)); }
      const pending = rows.filter((r) => r.status === 'pending');
      clear(kp).append(kpi(t('Pending requests'), String(pending.length), '', null, ''), kpi(t('Handled'), String(rows.length - pending.length), '', null, ''));
      clear(list).append(...(rows.length ? rows.map((r) => liRow({ icon: 'swap', title: r.number + (r.customer ? ' · ' + r.customer : ''), sub: fmtDT(r.createdAt) + ' · ' + r.lines.reduce((a, l) => a + l.qty, 0) + ' ' + t('Units') + ' · ' + r.reason, value: r.mode === 'exchange' ? t('Exchange') : t('Return'), valueSub: r.status === 'pending' ? t('Pending') : r.status === 'rejected' ? t('Rejected') : t('Done'), chevron: r.status === 'pending', onclick: () => r.status === 'pending' && requestSheet(r, load) })) : [empty('swap', t('No requests'), t('Return/exchange requests customers send from their bill link show here.'))]));
    }
    function requestSheet(req, reload) {
      const rejectNote = input({ placeholder: t('Reason (shown only to staff)') });
      sheet({ title: req.number, body: h('div', { class: 'grid' },
        h('div', { class: 'list' }, liRow({ icon: 'user', title: req.customer || t('Walk-in customer'), sub: (req.mode === 'exchange' ? t('Wants to exchange') : t('Wants to return')) + ' · ' + req.reason })),
        section(t('Items'), h('div', { class: 'list' }, req.lines.map((l) => liRow({ icon: 'tag', title: l.name, sub: [l.colour, l.size].filter(Boolean).join(' · '), value: l.qty + ' ' + t('pcs') })))),
        h('div', { class: 'muted small' }, t('When the customer brings the item in, press Process -- it opens the usual return screen with these items already picked.')),
        field(t('If you reject instead') + ' (' + t('optional note') + ')', rejectNote)),
        actions: [
          { label: t('Reject'), onclick: async (close) => {
            try { await api('sty_return_requests_decide', { p_id: req.id, p: { status: 'rejected', note: rejectNote.value } }); close(); reload && reload(); toast(t('Rejected')); } catch (e) { fail(e); }
          } },
          { label: t('Process now'), primary: true, onclick: async (close) => {
            let sale; try { sale = await api('sty_get_sale', { p_id: req.saleId }); } catch (e) { return fail(e); }
            // The item may have already been returned/exchanged directly (not through this request) since
            // it was submitted -- sty_return auto-completes a request when that happens, but a request
            // that still shows "Pending" here (page not yet refreshed) would otherwise open a return screen
            // with nothing left to pick. Check first and say so plainly instead of a confusing dead end.
            const stillOwed = req.lines.some((l) => { const sl = sale.lines.find((x) => x.id === l.saleLineId); return sl && (sl.qty - sl.returned) > 0; });
            if (!stillOwed) { close(); toast(t('This was already taken back in the shop -- nothing left to process.')); reload && reload(); return; }
            close();
            returnSheet(sale, reload, { requestId: req.id, mode: req.mode, reason: req.reason, lines: req.lines.map((l) => ({ saleLineId: l.saleLineId, qty: l.qty })) });
          } }] });
    }
    const srcSeg = seg([['shop', t('Shop bills')], ['quotes', t('Quotations')], ['returns', t('Returns & exchanges')]].concat(storefrontOn() ? [] : [['web', t('Website orders')], ['requests', t('Return requests')]]), BU.src, (x) => { BU.src = x; v.refresh(); }, { full: true });
    v.root.append(h('div', { class: 'grid' }, srcSeg, custId ? banner('', 'user', t('Bills of one customer'), ' ', h('button', { class: 'btn plain sm', onclick: () => go('bills') }, t('Show all'))) : (BU.src === 'web' || BU.src === 'requests' || BU.src === 'quotes' ? null : rangePicker(BU, load)),
      BU.src === 'requests' || BU.src === 'returns' || BU.src === 'quotes' ? null : searchField(t('Bill number, customer, phone'), debounce((x) => { BU.q = x; load(); }, 250), BU.q), kp, list));
    load();
  },
});
// Deliberately does not duplicate sty_sell's pricing/stock/tax logic: this just drops the quote's items into a
// normal Sell cart and sends the cashier there -- the actual sale still goes through the one real sty_sell path.
async function openQuoteInSell(quoteId) {
  if (BILL.lines.length) { toast(t('Finish or clear the current bill first'), { err: true }); return; }
  let q; try { q = await api('sty_quote_get', { p_id: quoteId }); } catch (e) { return fail(e); }
  if (q.status !== 'open') { toast(t('This quotation is no longer open'), { err: true }); return; }
  try { await loadCatalog(); } catch (e) { return fail(e); }
  const missing = [];
  const lines = (q.lines || []).map((l) => {
    const vv = allVariants().find((x) => x.id === l.variantId);
    if (!vv) { missing.push(l.name); return null; }
    return { variantId: vv.id, styleId: vv.style.id, name: vv.style.name, colour: vv.colour, size: vv.size, barcode: vv.barcode, price: l.price, mrp: vv.style.mrp, taxPct: vv.style.taxPct, qty: l.qty, discPct: 0, discAmt: 0, stock: vv.stock };
  }).filter(Boolean);
  if (!lines.length) { toast(t('None of these items are available any more'), { err: true }); return; }
  BILL.lines = lines; BILL.customer = q.customer || null; BILL.quoteId = q.id;
  if (missing.length) toast(t('Not added (no longer available)') + ': ' + missing.join(', '), { err: true });
  go('sell'); window.dispatchEvent(new Event('sty:cartchanged'));
}
async function billSheet(id, changed) {
  let sale; try { sale = await api('sty_get_sale', { p_id: id }); } catch (e) { return fail(e); }
  if (!sale) return;
  const open = sale.status !== 'void';
  const s = sheet({ title: sale.number, closeLabel: t('Done'), body: h('div', { class: 'grid' }, sale.status === 'void' ? banner('warn', 'alert', t('Cancelled') + (sale.voidReason ? ': ' + sale.voidReason : '')) : null,
    sale.returns && sale.returns.length ? banner('warn', 'swap', (sale.returns.some((r) => r.mode === 'exchange') ? t('This bill has an exchange') : t('This bill has a return')) + ' · ' + t('Refunded') + ' ' + inr(sale.returns.reduce((a, r) => a + r.refund, 0))) : null,
    receiptNode(sale),
    sale.returns && sale.returns.length ? section(t('Returns'), h('div', { class: 'list' }, sale.returns.map((r) => liRow({ icon: 'swap', title: inr(r.refund), sub: fmtDT(r.at) + ' · ' + r.mode + (r.reason ? ' · ' + r.reason : '') })))) : null,
    h('div', { class: 'row', style: { gap: '8px', flexWrap: 'wrap' } },
      h('button', { class: 'btn', type: 'button', onclick: () => printReceipt(sale) }, icon('print', 18), t('Print')),
      h('button', { class: 'btn', type: 'button', onclick: () => shareWa(sale) }, icon('share', 18), t('WhatsApp')),
      open && sale.lines.some((l) => l.qty > l.returned) ? h('button', { class: 'btn', type: 'button', onclick: () => { s.close(); returnSheet(sale, changed); } }, icon('swap', 18), t('Return or exchange')) : null,
      open && sale.status === 'due' && sale.customer ? h('button', { class: 'btn', type: 'button', onclick: () => { s.close(); collectDue(sale, changed); } }, icon('cash', 18), t('Collect due')) : null,
      open && can('sty_manage') ? h('button', { class: 'btn', type: 'button', onclick: () => { s.close(); editBill(sale, changed); } }, icon('edit', 18), t('Edit details')) : null,
      open && can('sty_manage') && (sale.payments || []).length ? h('button', { class: 'btn', type: 'button', onclick: () => { s.close(); correctPaymentSheet(sale, changed); } }, icon('cash', 18), t('Correct payment mode')) : null,
      open && can('sty_manage') && !(sale.returns || []).length ? h('button', { class: 'btn danger', type: 'button', onclick: async () => { const r = await cancelSheet(); if (!r) return; await api('sty_void_sale', { p_id: sale.id, p_reason: r.reason, p_restock: r.restock }); s.close(); S.catAt = 0; toast(r.restock ? t('Bill cancelled, items put back in stock') : t('Bill cancelled')); changed && changed(); } }, icon('trash', 18), t('Cancel bill')) : null,
      !open && can('sty_manage') ? h('button', { class: 'btn danger', type: 'button', onclick: async () => { if (!await confirmBox(t('Delete this bill?'), t('It is removed for good, with its stock entries. This cannot be undone.'), t('Delete'), true)) return; try { await api('sty_delete_sale', { p_id: sale.id }); } catch (e) { return fail(e); } s.close(); S.catAt = 0; toast(t('Bill deleted')); changed && changed(); } }, icon('trash', 18), t('Delete bill')) : null)) });
}
// cancel: a reason, and whether the items go back into stock (leave it unticked for goods that are damaged or lost)
function cancelSheet() {
  return new Promise((res) => {
    const i = input({ placeholder: t('Reason') }); const back = h('input', { type: 'checkbox', checked: true });
    sheet({ title: t('Cancel this bill?'), onClose: (v) => { if (v === undefined) res(null); }, body: h('div', { class: 'grid' }, field(t('Reason'), i),
      h('label', { class: 'swrow' }, h('div', { class: 'grow' }, h('div', null, t('Put the items back in stock')), h('div', { class: 'muted small' }, t('Untick if the goods are damaged or lost'))), back)),
      actions: [{ label: t('Confirm'), danger: true, onclick: (close) => { res({ reason: i.value.trim(), restock: back.checked }); close('ok'); } }] });
  });
}
// change who the bill was for and its note (amounts and items stay as billed)
function editBill(sale, changed) {
  const nm = input({ value: sale.customer ? sale.customer.name || '' : '', placeholder: t('Customer name') }), ph = input({ value: sale.customer ? sale.customer.phone || '' : '', mode: 'tel', placeholder: t('Phone') });
  const note = h('textarea', { class: 'textarea', rows: 2 }, sale.note || '');
  sheet({ title: t('Edit') + ' ' + sale.number, body: h('div', { class: 'grid' }, field(t('Customer name'), nm), field(t('Phone'), ph), field(t('Note'), note), h('div', { class: 'hint' }, t('Items and amounts stay as billed. To change those, cancel the bill and make a new one.'))),
    actions: [{ label: t('Save'), primary: true, onclick: async (close) => {
      try { await api('sty_edit_sale', { p_id: sale.id, p: { customerName: nm.value, customerPhone: ph.value, note: note.value } }); } catch (e) { fail(e); return false; }
      close(); S.catAt = 0; toast(t('Saved')); changed && changed();
    } }] });
}
// Fix which payment method(s) a bill is attributed to -- e.g. a cashier picked UPI but it got saved as Cash.
// Deliberately narrow: the corrected amounts must add up to exactly the same total as before, so this can
// never change what the bill was actually billed for, only which method(s) it's recorded under.
function correctPaymentSheet(sale, done) {
  const ALL = [['cash', t('Cash')], ['upi', t('UPI')], ['card', t('Card')], ['exchange', t('Exchange credit')], ['credit', t('Store credit')]];
  const present = new Set((sale.payments || []).map((p) => p.mode));
  const MODES = ALL.filter(([m]) => m === 'cash' || m === 'upi' || m === 'card' || present.has(m));
  const start = {}; MODES.forEach(([m]) => start[m] = 0);
  (sale.payments || []).forEach((p) => { start[p.mode] = r2((start[p.mode] || 0) + N(p.amount)); });
  const origTotal = r2((sale.payments || []).reduce((a, p) => a + N(p.amount), 0));
  const pay = { ...start };
  const rows = h('div', { class: 'grid' }), sum = h('div', { class: 'tot2' }); const inputs = {};
  const sumNow = () => MODES.reduce((a, [m]) => a + (pay[m] || 0), 0);
  const upd = () => {
    const s2 = r2(sumNow()), diff = r2(s2 - origTotal);
    clear(sum).append(h('span', null, diff === 0 ? t('Matches the original total') : t('Must match the original total')), h('b', { class: 'num' + (diff === 0 ? '' : ' neg') }, inr(s2) + (diff === 0 ? '' : ' / ' + inr(origTotal))));
    ok.disabled = diff !== 0;
  };
  MODES.forEach(([m, l]) => {
    const i = input({ type: 'number', value: pay[m] || '', mode: 'decimal', placeholder: '0', oninput: () => { pay[m] = N(i.value); upd(); } }); inputs[m] = i;
    rows.append(field(l, i));
  });
  const ok = h('button', { class: 'btn fill', type: 'button', onclick: async () => {
    const payments = MODES.map(([m]) => ({ mode: m, amount: pay[m] })).filter((p) => p.amount > 0);
    try { await api('sty_correct_payment_mode', { p_id: sale.id, p_payments: payments }); } catch (e) { return fail(e); }
    sh.close(); toast(t('Payment method corrected')); done && done();
  } }, t('Save correction'));
  const sh = sheet({ title: t('Correct payment mode') + ' · ' + sale.number, body: h('div', { class: 'grid' },
    h('div', { class: 'muted small' }, t('Fix which method(s) this bill is attributed to -- the corrected amounts must add up to the original total; the bill itself, its items and stock are unchanged.')),
    rows, sum), actions: [] });
  sh.el.querySelector('.sheet-f') || sh.el.append(h('div', { class: 'sheet-f' }));
  sh.el.querySelector('.sheet-f').append(ok);
  upd();
}
function promptReason(title) {
  return new Promise((res) => { const i = input({ placeholder: t('Reason') }); sheet({ title, onClose: (v) => { if (v === undefined) res(null); }, body: h('div', { class: 'grid' }, field(t('Reason'), i)), actions: [{ label: t('Confirm'), danger: true, onclick: (close) => { res(i.value.trim()); close('ok'); } }] }); });
}
function collectDue(sale, done) {
  const amt = input({ type: 'number', mode: 'decimal', value: sale.balance }), mode = selectEl([['cash', t('Cash')], ['upi', 'UPI'], ['card', t('Card')]], 'cash');
  sheet({ title: t('Collect due'), body: h('div', { class: 'grid' }, h('div', { class: 'kv' }, h('span', null, t('Due')), h('b', { class: 'num' }, inr(sale.balance))), field(t('Amount'), amt), field(t('Mode'), mode)),
    actions: [{ label: t('Save'), primary: true, onclick: async (close) => { if (!N(amt.value)) { toast(t('Enter an amount'), { err: true }); return false; } await api('sty_collect_due', { p_id: sale.id, p_amount: N(amt.value), p_mode: mode.value }); close(); toast(t('Payment saved')); done && done(); } }] });
}
function returnSheet(sale, done, prefill) {
  const picks = {}; sale.lines.forEach((l) => picks[l.id] = { qty: 0, dmg: false });
  let clamped = false;
  if (prefill && prefill.lines) prefill.lines.forEach((pl) => {
    const l = sale.lines.find((x) => x.id === pl.saleLineId); if (!l || !picks[l.id]) return;
    const avail = Math.max(0, l.qty - l.returned); const got = Math.min(pl.qty, avail);
    if (got < pl.qty) clamped = true;
    picks[l.id].qty = got;
  });
  const st = S.ctx.settings;
  const mode = selectEl([['cash', t('Cash refund')], ['upi', t('UPI refund')], ['card', t('Card refund')], ['credit_note', t('Store credit')], ['exchange', t('Exchange for other items')]], (prefill && prefill.mode === 'exchange') ? 'exchange' : sale.customer ? 'credit_note' : 'cash');
  const reason = input({ placeholder: t('Reason (size, defect, changed mind)'), value: (prefill && prefill.reason) || '' });
  const tot = h('div', { class: 'paytot' }); const rows = h('div', { class: 'list' });
  const paintTot = () => { const amt = sale.lines.reduce((a, l) => a + (picks[l.id].qty ? l.net / l.qty * picks[l.id].qty : 0), 0); clear(tot).append(h('span', null, t('Refund value')), h('b', { class: 'num' }, inr(r2(amt)))); };
  sale.lines.forEach((l) => {
    const max = l.qty - l.returned; if (max <= 0) return;
    const q = h('b', { class: 'num' }, String(picks[l.id].qty)); const dm = h('input', { type: 'checkbox', 'aria-label': t('Damaged'), onchange: () => { picks[l.id].dmg = dm.checked; } });
    rows.append(h('div', { class: 'li' }, h('div', { class: 'grow' }, h('div', { class: 't' }, l.name), h('div', { class: 's' }, [l.colour, l.size].filter(Boolean).join(' · ') + ' · ' + t('bought') + ' ' + l.qty + (l.returned ? ' · ' + t('returned') + ' ' + l.returned : ''))),
      h('label', { class: 'small muted', style: { display: 'flex', gap: '4px', alignItems: 'center' } }, dm, t('Damaged')),
      h('div', { class: 'stp' }, h('button', { type: 'button', onclick: () => { picks[l.id].qty = Math.max(0, picks[l.id].qty - 1); q.textContent = picks[l.id].qty; paintTot(); } }, icon('minus', 16)), q, h('button', { type: 'button', onclick: () => { picks[l.id].qty = Math.min(max, picks[l.id].qty + 1); q.textContent = picks[l.id].qty; paintTot(); } }, icon('plus', 16)))));
  });
  paintTot();
  const old = (Date.now() - new Date(sale.at).getTime()) / 86400000 > st.returnDays;
  sheet({ title: t('Return or exchange'), full: true, body: h('div', { class: 'grid' }, old && !can('sty_manage') ? banner('warn', 'alert', t('This bill is older than') + ' ' + st.returnDays + ' ' + t('days. A manager must take it back.')) : null,
    clamped ? banner('warn', 'alert', t('Some of what the customer asked for was already taken back separately -- only what is still available is picked below.')) : null, rows, tot, field(t('How to settle'), mode), field(t('Reason'), reason)),
    actions: [{ label: t('Take back'), primary: true, onclick: async (close) => {
      const lines = sale.lines.filter((l) => picks[l.id].qty > 0).map((l) => ({ saleLineId: l.id, qty: picks[l.id].qty, damaged: picks[l.id].dmg }));
      if (!lines.length) { toast(t('Pick what is coming back'), { err: true }); return false; }
      const value = r2(sale.lines.reduce((a, l) => a + (picks[l.id].qty ? l.net / l.qty * picks[l.id].qty : 0), 0));
      const retId = uid();
      const r = await sendOrQueue('sty_return', { p: { id: retId, saleId: sale.id, mode: mode.value, reason: reason.value, lines } });
      if (prefill && prefill.requestId) { try { await api('sty_return_requests_decide', { p_id: prefill.requestId, p: { status: 'completed', returnId: retId } }); } catch { /* already handled, not fatal */ } }
      close(); S.catAt = 0; toast(r.done ? t('Return saved') : t('Saved on this device'));
      if (mode.value === 'exchange') { BILL.customer = sale.customer || null; BILL.exchange = value; go('sell'); } else done && done();
    } }] });
}
