/* AUZsStyle: a GST invoice-style billing screen -- customer first, then items, then the tax breakdown, then
   payment -- a second way to build the same bill as Sell's cart-first flow, for when the cashier wants the
   customer and GST split visible up front instead of a product grid with a cart on the side. Opened from the
   Bills page ("New invoice"); Sell itself is unchanged.

   Reuses the exact same shared BILL state, billCalc(), customerPicker, addLine, paySheet, saveAsQuote and
   discountSheet that Sell uses (all plain top-level functions in p-sell.js/lib.js, shared globals like every
   other page in this app) -- so a bill started here can be paid, held or saved as a quote exactly like one
   started on Sell, and the two screens can never drift out of sync with each other or with the server. */
'use strict';
// A compact item search + add, standalone (Sell's own pickVariant/paintGrid are local to its render closure).
function invoicePickItem(onAdded) {
  let list = [], q = '';
  const box = h('div', { class: 'list' });
  const paint = () => {
    clear(box).append(...(list.length ? list.slice(0, 60) : []).map((s) => liRow({
      icon: 'shirt', title: s.name, sub: [s.brand, s.category].filter(Boolean).join(' · ') + (styleStock(s) <= 0 ? ' · ' + t('Sold out') : ''),
      value: inr(s.price), chevron: true, onclick: () => pick(s),
    })));
    if (!list.length) box.append(h('div', { class: 'muted small', style: { padding: '14px' } }, q ? t('No match') : t('Search a style or scan a tag')));
  };
  function pick(s) {
    if (s.badge === 'soldout') { toast(`${s.name}: ${t('Marked as sold out')}`, { err: true }); return; }
    const actives = s.variants.filter((x) => x.active !== false);
    if (actives.length === 1) { if (addLine(s, actives[0])) { onAdded(); ps.close(); } return; }
    const cols = [...new Set(actives.map((x) => x.colour))];
    let col = cols.find((c) => s.variants.some((x) => x.colour === c && x.stock > 0)) ?? cols[0];
    const body = h('div', { class: 'grid' });
    const paintV = () => {
      const vs = s.variants.filter((x) => x.colour === col && x.active !== false).sort(byRank);
      clear(body).append(
        h('div', { class: 'vp-h' }, h('div', null, h('b', null, s.name), h('div', { class: 'muted small' }, [s.brand, s.category].filter(Boolean).join(' · ')), h('div', { class: 'num' }, inr(s.price)))),
        cols.length > 1 || (cols[0] || '') ? h('div', null, h('div', { class: 'cap' }, t('Colour')), h('div', { class: 'chips wrap' }, cols.map((c) => h('button', { class: 'chip', type: 'button', 'aria-pressed': String(c === col), onclick: () => { col = c; paintV(); } }, colourDot(c, 14), c || '—')))) : null,
        h('div', null, h('div', { class: 'cap' }, t('Size')), h('div', { class: 'sizes' }, vs.map((x) => {
          const dis = x.stock <= 0 && !S.ctx.settings.allowNegativeStock;
          return h('button', { class: 'sz' + (dis ? ' dis' : ''), type: 'button', disabled: dis, onclick: () => { if (addLine(s, x)) { onAdded(); ps.close(); } } }, h('b', null, x.size || '—'), h('span', null, x.stock));
        }))));
    };
    const ps = sheet({ title: s.name, closeLabel: t('Done'), body }); paintV();
  }
  const load = () => { const qq = q.trim().toLowerCase(); list = S.cat.filter((x) => x.active !== false && (!qq || (x.name + ' ' + (x.brand || '') + ' ' + x.category).toLowerCase().includes(qq) || x.variants.some((v) => v.barcode === qq))); paint(); };
  sheet({ title: t('Add item'), closeLabel: t('Done'), body: h('div', { class: 'grid' }, searchField(t('Search or scan a tag'), (v) => { q = v; load(); }), box) });
  load();
}
page('invoice', {
  title: 'New invoice', perm: 'sty_sell',
  async render(v) {
    v.header({ title: t('New invoice') });
    const root = v.root;
    try { await loadCatalog(); } catch (e) { return clear(root).append(empty('cloudOff', t('Could not load the catalogue'), e.message, h('button', { class: 'btn fill', onclick: () => v.refresh() }, t('Try again')))); }
    paint();
    function paint() { clear(root).append(body()); }
    function custSection() {
      return section(t('Customer'), BILL.customer
        ? h('button', { class: 'cust', type: 'button', onclick: () => customerPicker((cu) => { selectBillCustomer(cu); paint(); }) },
            icon('user', 18), h('span', { class: 'grow' }, BILL.customer.name + (BILL.customer.phone ? ' · ' + BILL.customer.phone : '')), h('span', { class: 'muted small' }, (BILL.customer.points || 0) + ' ' + t('Points')),
            h('span', { class: 'cust-x', role: 'button', 'aria-label': t('Clear'), onclick: (e) => { e.stopPropagation(); BILL.customer = null; BILL.exchange = 0; paint(); } }, icon('x', 14)))
        : h('div', { class: 'grid', style: { gap: '8px' } },
            h('div', { class: 'custrow' },
              h('input', { class: 'input cin', placeholder: t('Customer name'), value: BILL.custName, 'aria-label': t('Customer name'), autocomplete: 'off', oninput: (e) => { BILL.custName = e.target.value; } }),
              h('input', { class: 'input cin', placeholder: t('Phone'), value: BILL.custPhone, inputmode: 'tel', 'aria-label': t('Phone'), autocomplete: 'off', oninput: (e) => { BILL.custPhone = e.target.value; } }),
              h('button', { class: 'btn icon sm', type: 'button', 'aria-label': t('Customer'), title: t('Find a customer'), onclick: () => customerPicker((cu) => { selectBillCustomer(cu); paint(); }) }, icon('search', 16))),
            canGstLookup() ? (BILL.showGstin ? gstBillRow(paint, null) : h('button', { class: 'btn plain sm', type: 'button', style: { alignSelf: 'flex-start' }, onclick: () => { BILL.showGstin = true; paint(); } }, icon('plus', 14), t('Bill to a GST number'))) : null,
            h('div', { class: 'muted small' }, t('Walk-in') + ' — ' + t('add a customer to leave a balance due'))));
    }
    function itemsSection(c) {
      const lines = BILL.lines.length ? h('div', { class: 'blines' }, BILL.lines.map((l, i) => h('div', { class: 'bl' },
        h('div', { class: 'grow' }, h('div', { class: 't' }, l.name), h('div', { class: 's' }, [l.colour, l.size].filter(Boolean).join(' · ') + ' · ' + inr(l.price))),
        h('div', { class: 'stp' },
          h('button', { type: 'button', 'aria-label': '-', onclick: () => { if (l.qty > 1) l.qty--; else BILL.lines.splice(i, 1); paint(); } }, icon('minus', 16)), h('b', { class: 'num' }, l.qty),
          h('button', { type: 'button', 'aria-label': '+', onclick: () => { const vv = allVariants().find((x) => x.id === l.variantId); if (vv && addLine(vv.style, vv)) paint(); } }, icon('plus', 16))),
        h('div', { class: 'amt num' }, inr(c.lines[i].net))))) : h('div', { class: 'bempty' }, icon('tag', 26), h('div', null, t('No items yet')), h('div', { class: 'small' }, t('Tap Add item to search your catalogue')));
      return section(t('Items'), h('button', { class: 'btn wide', type: 'button', onclick: () => invoicePickItem(() => paint()) }, icon('plus', 18), t('Add item')), lines);
    }
    function gstSection(c) {
      if (!BILL.lines.length) return null;
      const trow = (a, b, cls) => h('div', { class: 'tr' + (cls ? ' ' + cls : '') }, h('span', null, a), h('span', { class: 'num' }, b));
      // Same inter- vs intra-state rule as sty_sell (db/335): a customer with no GSTIN, or whose GSTIN's state
      // code matches the shop's own, is intra-state (CGST+SGST); only a differing state code is IGST. This is
      // only a preview -- the server (sty_sell) computes and stores the real split at the moment of payment.
      const shopState = String((S.ctx.settings.gstin || '')).slice(0, 2);
      const custGstin = (BILL.customer && BILL.customer.gstin) || BILL.custGstin || '';
      const custState = custGstin.slice(0, 2);
      const interstate = !!(custState && shopState && custState !== shopState);
      const cgst = interstate ? 0 : r2(c.tax / 2), sgst = interstate ? 0 : r2(c.tax - cgst);
      const byRate = {};
      c.lines.forEach((l) => { const key = l.rate; byRate[key] = byRate[key] || { rate: l.rate, taxable: 0, tax: 0 }; byRate[key].taxable += (l.net - l.tax); byRate[key].tax += l.tax; });
      const rateRows = Object.values(byRate).sort((a, b) => a.rate - b.rate);
      return section(t('Bill summary'), h('div', { class: 'tots' },
        trow(t('Items'), inr(c.subtotal)),
        c.discount > 0 ? trow(t('Discount'), '-' + inr(c.discount), 'g') : null,
        trow(t('Taxable value'), inr(r2(c.total - c.tax - c.rounding))),
        interstate ? trow('IGST', inr(c.tax)) : [trow('CGST', inr(cgst)), trow('SGST', inr(sgst))],
        c.rounding ? trow(t('Round off'), inr(c.rounding)) : null,
        h('div', { class: 'kv' }, h('span', null, h('b', null, t('Total'))), h('b', { class: 'num' }, inr(c.total))),
        rateRows.length > 1 ? h('details', null, h('summary', { class: 'muted small' }, t('GST by rate')),
          h('div', { class: 'list' }, rateRows.map((r) => liRow({ title: r.rate + '% GST', sub: t('Taxable') + ' ' + inr(r.taxable), value: inr(r.tax) })))) : null,
        h('button', { class: 'btn wide sm', type: 'button', onclick: () => discountSheet(() => paint()) }, icon('tag', 16), t('Discount'))));
    }
    function body() {
      const c = billCalc();
      return h('div', { class: 'grid invoicepage' }, custSection(), itemsSection(c), gstSection(c),
        BILL.lines.length ? h('div', { class: 'row', style: { gap: '8px' } },
          // saveAsQuote/paySheet already call newBill() themselves on success -- just repaint.
          h('button', { class: 'btn', type: 'button', onclick: () => saveAsQuote(() => paint()) }, t('Save draft')),
          h('button', { class: 'btn fill grow', type: 'button', onclick: async () => { if (!await resolveTypedCustomer()) return; paySheet(billCalc(), () => paint()); } }, t('Charge') + ' ' + inr(c.total))) : null);
    }
  },
});
