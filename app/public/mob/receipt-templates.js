/* AUZsMob: a gallery of visual receipt templates for ONE sale -- shop name/logo, date, each line (item name,
   qty, price, amount; a serialized phone's line already carries its IMEI in the name, see p-sell.js's
   addUnit), subtotal/discount/total/paid/balance, payment mode, a thank-you footer. No GST anywhere:
   AUZsMob is GST-exempt (CLAUDE.md "AUZsMob and AUZsScan: no GST, no setup fee", db/159) -- this is a plain
   shop receipt, never a tax invoice, so it is deliberately much simpler than accounts/invoice-templates.js
   (no GSTIN/HSN/place-of-supply/tax-split boxes).

   Chosen per shop with mob_settings.features.receiptStyle = 'thermal' | 'modern' | 'bold' | 'classic' |
   'stamped' (Settings -> Receipt style), empty/absent = 'thermal' (the automatic default, same convention
   mob_save_settings already uses for 'nav'). Used both by mobbill.html (the public share link) and by
   Settings' own "Preview with sample data" button.

   Same hard constraint every bordered-table template in this project has learned the hard way (see CLAUDE.md
   "Invoice table lines vanished on iPhone", taxinv.js v7): a page shown at phone width through CSS `zoom`
   turns a plain 1px `border-collapse` table line into a sub-pixel line iOS Safari drops. So: tables use
   border-collapse:separate + border-spacing:0 (never border-collapse), the line width is the CSS variable
   --bw set by fit() to roughly one real screen pixel at any zoom, and every number cell is white-space:nowrap
   so a long amount never wraps and breaks the row height. Built with createElement/textContent only, no
   innerHTML (this project's XSS defence -- a customer name or item name is never trusted as markup). */
(function (root) {
  'use strict';
  const nf = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const q3 = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 3 });
  const n = (x) => { const v = Number(x); return isNaN(v) ? 0 : v; };
  const rupee = (v) => '₹' + nf.format(n(v));
  const fdate = (s) => {
    const d = s ? new Date(s) : null;
    return d && !isNaN(d) ? d.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
  };
  const PAY_LABEL = { cash: 'Cash', upi: 'UPI', card: 'Card', credit: 'Credit' };
  function el(tag, props) {
    const e = document.createElement(tag);
    for (const k in props || {}) { if (k === 'class') e.className = props[k]; else if (k === 'style') e.setAttribute('style', props[k]); else e.setAttribute(k, props[k]); }
    for (let i = 2; i < arguments.length; i++) [].concat(arguments[i]).flat(Infinity).forEach((c) => { if (c != null && c !== false) e.append(c instanceof Node ? c : document.createTextNode(String(c))); });
    return e;
  }

  /** Everything every template needs, computed once from the data shape public_mob_sale returns (or the
   *  in-app sale record, which carries the same field names camelCase/snake_case-tolerantly). */
  function computeReceipt(data) {
    const shop = data.shop || {}, sale = data.sale || {};
    const items = sale.items || [];
    const lines = items.map((it) => ({ name: it.name || '', qty: n(it.qty) || 1, price: n(it.price), amount: n(it.price) * (n(it.qty) || 1) }));
    const qtySum = lines.reduce((a, l) => a + l.qty, 0);
    const billNo = sale.billNo || sale.bill_no || '';
    const date = sale.date || sale.created_at;
    const payMode = PAY_LABEL[sale.paymentMode || sale.payment_mode] || (sale.paymentMode || sale.payment_mode || '');
    const customer = sale.customerName || sale.customer_name || '';
    const phone = sale.customerPhone || sale.customer_phone || '';
    const voided = !!sale.voided;
    const footer = shop.footer || shop.billFooter || 'Thank you for your business!';
    return { shop, sale, lines, qtySum, billNo, date, payMode, customer, phone, voided, footer,
      subtotal: n(sale.subtotal), discount: n(sale.discount), total: n(sale.total), paid: n(sale.paid), balance: n(sale.balance) };
  }

  function injectCss(id, text) { if (document.getElementById(id)) return; const st = document.createElement('style'); st.id = id; st.textContent = text; document.head.appendChild(st); }
  const PAGE_RESET = '*{box-sizing:border-box}table{border-collapse:separate;border-spacing:0;width:100%;table-layout:fixed}td,th{vertical-align:top;word-wrap:break-word}td.nw,th.nw{white-space:nowrap}@page{size:auto;margin:10mm}';

  // Shrinks a fixed-width page to whatever width it's actually shown in (never above 100%) and widens the
  // table line width as it shrinks so a line stays about one real screen pixel -- same mechanism as
  // accounts/invoice-templates.js's makeFit(), parameterised on the template's own base width since a
  // receipt is not always a fixed A4 page.
  function makeFit(wrap, page, baseW) {
    const fit = () => { const w = wrap.clientWidth || (wrap.parentNode && wrap.parentNode.clientWidth) || baseW; const z = Math.min(1, Math.max(0.3, w / baseW)); page.style.zoom = String(z); page.style.setProperty('--bw', Math.min(3, Math.max(1, 1.1 / z)).toFixed(2) + 'px'); };
    setTimeout(fit, 0); window.addEventListener('resize', fit);
    if (window.ResizeObserver) { try { new ResizeObserver(fit).observe(wrap); } catch (e) { /* ignore */ } }
    return fit;
  }

  // =====================================================================================================================
  // 1) "thermal" -- a narrow printer-roll style receipt (380px), monospace, dashed cut lines top and bottom.
  //    The automatic default: closest in spirit to the strip of paper a shop till actually hands over.
  // =====================================================================================================================
  function buildThermal(data) {
    injectCss('rc-thermal-css', '.rc-thermal-wrap{width:100%;display:flex;justify-content:center;overflow:hidden}' + PAGE_RESET +
      '.rc-thermal{width:380px;flex:none;background:#fff;color:#161616;font:13px/1.45 "Courier New",monospace;-webkit-print-color-adjust:exact;print-color-adjust:exact;padding:18px 20px}' +
      '.rc-thermal .cut{height:0;border-top:2px dashed #999;margin:12px 0}' +
      '.rc-thermal .hd{text-align:center}.rc-thermal .lg{width:48px;height:48px;margin:0 auto 8px;overflow:hidden;border-radius:6px;background:#f2f2f2}.rc-thermal .lg img{width:100%;height:100%;object-fit:contain}' +
      '.rc-thermal .nm{font-size:18px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;margin:0 0 3px}.rc-thermal .sub{font-size:11px;color:#555;line-height:1.5}' +
      '.rc-thermal .meta{font-size:11.5px;margin-top:10px;display:flex;justify-content:space-between}' +
      '.rc-thermal .it{margin-top:4px;font-size:12px}.rc-thermal .it .row{display:flex;justify-content:space-between;gap:8px;padding:3px 0;border-bottom:var(--bw,1px) dotted #ccc}' +
      '.rc-thermal .it .nm2{flex:1}.rc-thermal .it .amt{white-space:nowrap;text-align:right}' +
      '.rc-thermal .totals{margin-top:8px;font-size:12.5px}.rc-thermal .totals .row{display:flex;justify-content:space-between;padding:2px 0}' +
      '.rc-thermal .totals .gt{display:flex;justify-content:space-between;font-size:15px;font-weight:700;border-top:1.5px dashed #161616;margin-top:5px;padding-top:6px}' +
      '.rc-thermal .ft{margin-top:14px;text-align:center;font-size:11.5px;color:#444;line-height:1.6}' +
      '@media print{.rc-thermal-wrap{display:block}.rc-thermal{zoom:1!important;width:72mm;margin:0 auto}}');
    const c = computeReceipt(data), { shop, lines, billNo, date, payMode, customer, phone, voided, footer, subtotal, discount, total, paid, balance } = c;
    const page = el('div', { class: 'rc-thermal' },
      el('div', { class: 'hd' }, shop.logoUrl ? el('div', { class: 'lg' }, el('img', { src: shop.logoUrl, alt: '' })) : null,
        el('div', { class: 'nm' }, shop.name || 'Receipt'), el('div', { class: 'sub' }, [shop.address, shop.phone].filter(Boolean).join(' · '))),
      el('div', { class: 'cut' }),
      el('div', { class: 'meta' }, el('span', null, 'Bill ' + (billNo || '—')), el('span', null, fdate(date))),
      customer ? el('div', { class: 'meta', style: 'margin-top:2px' }, el('span', null, customer + (phone ? ' · ' + phone : ''))) : null,
      el('div', { class: 'it' }, lines.map((l) => el('div', { class: 'row' }, el('span', { class: 'nm2' }, l.name + (l.qty !== 1 ? '  x' + q3.format(l.qty) : '')), el('span', { class: 'amt nw' }, rupee(l.amount))))),
      el('div', { class: 'totals' },
        el('div', { class: 'row' }, el('span', null, 'Subtotal'), el('span', { class: 'nw' }, rupee(subtotal))),
        discount ? el('div', { class: 'row' }, el('span', null, 'Discount'), el('span', { class: 'nw' }, '-' + rupee(discount))) : null,
        el('div', { class: 'gt' }, el('span', null, 'TOTAL'), el('span', { class: 'nw' }, rupee(total))),
        el('div', { class: 'row' }, el('span', null, 'Paid (' + payMode + ')'), el('span', { class: 'nw' }, rupee(paid))),
        balance ? el('div', { class: 'row' }, el('span', null, 'Balance due'), el('span', { class: 'nw' }, rupee(balance))) : null),
      voided ? el('div', { style: 'text-align:center;color:#b00;font-weight:800;margin-top:10px' }, 'CANCELLED') : null,
      el('div', { class: 'cut' }), el('div', { class: 'ft' }, footer));
    const wrap = el('div', { class: 'rc-thermal-wrap' }, page);
    makeFit(wrap, page, 380);
    return wrap;
  }

  // =====================================================================================================================
  // 2) "modern" -- a clean rounded card, sans-serif, a soft colour accent. The friendliest/most app-like look.
  // =====================================================================================================================
  function buildModern(data) {
    injectCss('rc-modern-css', '.rc-modern-wrap{width:100%;display:flex;justify-content:center;overflow:hidden}' + PAGE_RESET +
      '.rc-modern{width:420px;flex:none;background:#fff;color:#1f2226;font:14px/1.45 "Segoe UI",Arial,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact;border:1px solid #e3e5e8;border-radius:18px;padding:22px 24px;box-shadow:0 1px 0 #eee}' +
      '.rc-modern .hd{display:flex;align-items:center;gap:12px}.rc-modern .lg{width:46px;height:46px;flex:none;border-radius:12px;overflow:hidden;background:#eef2ff}.rc-modern .lg img{width:100%;height:100%;object-fit:contain}' +
      '.rc-modern .nm{font-size:20px;font-weight:700;margin:0 0 2px;color:#111}.rc-modern .sub{font-size:11.5px;color:#6b7280}' +
      '.rc-modern .pill{display:inline-block;background:#eef2ff;color:#3b4ee0;border-radius:999px;padding:5px 12px;font-size:11.5px;font-weight:700;margin-top:10px}' +
      '.rc-modern .meta{font-size:11.5px;color:#6b7280;margin-top:4px}' +
      '.rc-modern table.it{margin-top:14px}.rc-modern table.it th{text-align:left;font-size:10.5px;color:#9aa1ab;text-transform:uppercase;letter-spacing:.5px;padding:6px 4px;border-bottom:1.5px solid #e3e5e8}' +
      '.rc-modern table.it td{padding:8px 4px;border-bottom:var(--bw,1px) solid #f0f1f2;font-size:13px}' +
      '.rc-modern .r{text-align:right}' +
      '.rc-modern .totals{margin-top:10px;background:#fafafa;border-radius:12px;padding:10px 14px}.rc-modern .totals .row{display:flex;justify-content:space-between;font-size:13px;padding:3px 0;color:#4b5563}' +
      '.rc-modern .totals .gt{display:flex;justify-content:space-between;font-size:17px;font-weight:800;color:#111;border-top:1.5px solid #e3e5e8;margin-top:4px;padding-top:6px}' +
      '.rc-modern .ft{margin-top:16px;text-align:center;font-size:12px;color:#6b7280}' +
      '@media print{.rc-modern-wrap{display:block}.rc-modern{zoom:1!important;width:100mm;margin:0 auto;box-shadow:none}}');
    const c = computeReceipt(data), { shop, lines, billNo, date, payMode, customer, phone, voided, footer, subtotal, discount, total, paid, balance } = c;
    const page = el('div', { class: 'rc-modern' },
      el('div', { class: 'hd' }, shop.logoUrl ? el('div', { class: 'lg' }, el('img', { src: shop.logoUrl, alt: '' })) : null,
        el('div', null, el('div', { class: 'nm' }, shop.name || 'Receipt'), el('div', { class: 'sub' }, [shop.address, shop.phone].filter(Boolean).join(' · ')))),
      el('div', { class: 'pill' }, 'Bill ' + (billNo || '—')),
      el('div', { class: 'meta' }, fdate(date) + (customer ? ' · ' + customer + (phone ? ' (' + phone + ')' : '') : '')),
      el('table', { class: 'it' }, el('thead', null, el('tr', null, el('th', null, 'Item'), el('th', { class: 'r nw' }, 'Qty'), el('th', { class: 'r nw' }, 'Amount'))),
        el('tbody', null, lines.map((l) => el('tr', null, el('td', null, l.name), el('td', { class: 'r nw' }, q3.format(l.qty)), el('td', { class: 'r nw' }, rupee(l.amount)))))),
      el('div', { class: 'totals' },
        el('div', { class: 'row' }, el('span', null, 'Subtotal'), el('span', null, rupee(subtotal))),
        discount ? el('div', { class: 'row' }, el('span', null, 'Discount'), el('span', null, '-' + rupee(discount))) : null,
        el('div', { class: 'gt' }, el('span', null, 'Total'), el('span', null, rupee(total))),
        el('div', { class: 'row' }, el('span', null, 'Paid (' + payMode + ')'), el('span', null, rupee(paid))),
        balance ? el('div', { class: 'row' }, el('span', null, 'Balance due'), el('span', null, rupee(balance))) : null),
      voided ? el('div', { style: 'text-align:center;color:#b00;font-weight:800;margin-top:10px' }, 'CANCELLED') : null,
      el('div', { class: 'ft' }, footer));
    const wrap = el('div', { class: 'rc-modern-wrap' }, page);
    makeFit(wrap, page, 420);
    return wrap;
  }

  // =====================================================================================================================
  // 3) "bold" -- a solid colour band carrying the shop name, thick ruled item table, high contrast.
  // =====================================================================================================================
  function buildBold(data) {
    injectCss('rc-bold-css', '.rc-bold-wrap{width:100%;display:flex;justify-content:center;overflow:hidden}' + PAGE_RESET +
      '.rc-bold{width:440px;flex:none;background:#fff;color:#171412;font:14px/1.35 Arial,Helvetica,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact;border:3px solid #171412}' +
      '.rc-bold .hd{background:#0f6e4a;color:#fff;padding:18px 20px;text-align:center}' +
      '.rc-bold .lg{width:44px;height:44px;margin:0 auto 6px;background:#fff;border:2px solid #171412;border-radius:8px;overflow:hidden}.rc-bold .lg img{width:100%;height:100%;object-fit:contain}' +
      '.rc-bold .nm{font-size:22px;font-weight:900;text-transform:uppercase;letter-spacing:.3px;margin:0 0 2px}.rc-bold .sub{font-size:11.5px;opacity:.92}' +
      '.rc-bold .meta{display:flex;justify-content:space-between;padding:10px 20px;font-size:12px;font-weight:700;border-bottom:3px solid #171412}' +
      '.rc-bold table.it{width:100%}.rc-bold table.it th{background:#171412;color:#fff;text-align:left;font-size:10.5px;letter-spacing:.5px;text-transform:uppercase;padding:8px 10px}' +
      '.rc-bold table.it td{padding:8px 10px;border-bottom:var(--bw,2px) solid #171412;font-size:13px;font-weight:600}' +
      '.rc-bold .r{text-align:right}' +
      '.rc-bold .totals{padding:12px 20px;background:#171412;color:#fff}.rc-bold .totals .row{display:flex;justify-content:space-between;font-size:13px;padding:3px 0}' +
      '.rc-bold .totals .gt{display:flex;justify-content:space-between;font-size:19px;font-weight:900;color:#5be09a;border-top:2px solid #555;margin-top:5px;padding-top:7px}' +
      '.rc-bold .ft{padding:12px 20px;text-align:center;font-size:12px;font-weight:700}' +
      '@media print{.rc-bold-wrap{display:block}.rc-bold{zoom:1!important;width:105mm;margin:0 auto}}');
    const c = computeReceipt(data), { shop, lines, billNo, date, payMode, customer, phone, voided, footer, subtotal, discount, total, paid, balance } = c;
    const page = el('div', { class: 'rc-bold' },
      el('div', { class: 'hd' }, shop.logoUrl ? el('div', { class: 'lg' }, el('img', { src: shop.logoUrl, alt: '' })) : null,
        el('div', { class: 'nm' }, shop.name || 'Receipt'), el('div', { class: 'sub' }, [shop.address, shop.phone].filter(Boolean).join(' · '))),
      el('div', { class: 'meta' }, el('span', null, 'Bill ' + (billNo || '—')), el('span', null, fdate(date))),
      customer ? el('div', { class: 'meta', style: 'border-bottom:3px solid #171412' }, el('span', null, customer), el('span', null, phone || '')) : null,
      el('table', { class: 'it' }, el('thead', null, el('tr', null, el('th', null, 'Item'), el('th', { class: 'r nw' }, 'Qty'), el('th', { class: 'r nw' }, 'Amount'))),
        el('tbody', null, lines.map((l) => el('tr', null, el('td', null, l.name), el('td', { class: 'r nw' }, q3.format(l.qty)), el('td', { class: 'r nw' }, rupee(l.amount)))))),
      el('div', { class: 'totals' },
        el('div', { class: 'row' }, el('span', null, 'Subtotal'), el('span', null, rupee(subtotal))),
        discount ? el('div', { class: 'row' }, el('span', null, 'Discount'), el('span', null, '-' + rupee(discount))) : null,
        el('div', { class: 'gt' }, el('span', null, 'TOTAL'), el('span', null, rupee(total))),
        el('div', { class: 'row' }, el('span', null, 'Paid (' + payMode + ')'), el('span', null, rupee(paid))),
        balance ? el('div', { class: 'row' }, el('span', null, 'Balance due'), el('span', null, rupee(balance))) : null),
      voided ? el('div', { style: 'text-align:center;background:#c21807;color:#fff;font-weight:900;padding:8px' }, 'CANCELLED') : null,
      el('div', { class: 'ft' }, footer));
    const wrap = el('div', { class: 'rc-bold-wrap' }, page);
    makeFit(wrap, page, 440);
    return wrap;
  }

  // =====================================================================================================================
  // 4) "classic" -- the traditional ruled shop bill: a formal boxed layout, serif heading, every line in a
  //    bordered table (the one template here that most needs the iPhone-safe table-line discipline).
  // =====================================================================================================================
  function buildClassic(data) {
    injectCss('rc-classic-css', '.rc-classic-wrap{width:100%;display:flex;justify-content:center;overflow:hidden}' + PAGE_RESET +
      '.rc-classic{width:460px;flex:none;background:#fff;color:#1b1b1b;font:14px/1.4 Georgia,"Times New Roman",serif;-webkit-print-color-adjust:exact;print-color-adjust:exact;border:var(--bw,1.5px) solid #1b1b1b;padding:20px 22px}' +
      '.rc-classic .hd{text-align:center;border-bottom:2px double #1b1b1b;padding-bottom:12px}' +
      '.rc-classic .lg{width:46px;height:46px;margin:0 auto 6px;overflow:hidden}.rc-classic .lg img{width:100%;height:100%;object-fit:contain}' +
      '.rc-classic .nm{font-size:20px;font-weight:700;letter-spacing:.3px;margin:0 0 3px}.rc-classic .sub{font-size:11.5px;color:#444}' +
      '.rc-classic .meta{display:flex;justify-content:space-between;font-size:12px;margin-top:10px}' +
      '.rc-classic table.it{margin-top:12px}.rc-classic table.it th{text-align:left;font-size:11px;border-bottom:1.5px solid #1b1b1b;border-top:1.5px solid #1b1b1b;padding:6px 6px}' +
      '.rc-classic table.it td{padding:6px 6px;border-bottom:var(--bw,1px) solid #bbb;font-size:12.5px}' +
      '.rc-classic .r{text-align:right}' +
      '.rc-classic .totals{margin-top:10px;width:260px;margin-left:auto}.rc-classic .totals .row{display:flex;justify-content:space-between;font-size:12.5px;padding:2px 0}' +
      '.rc-classic .totals .gt{display:flex;justify-content:space-between;font-size:16px;font-weight:700;border-top:2px double #1b1b1b;margin-top:4px;padding-top:6px}' +
      '.rc-classic .ft{margin-top:16px;text-align:center;font-size:12px;font-style:italic;border-top:1px dashed #999;padding-top:10px}' +
      '@media print{.rc-classic-wrap{display:block}.rc-classic{zoom:1!important;width:110mm;margin:0 auto}}');
    const c = computeReceipt(data), { shop, lines, billNo, date, payMode, customer, phone, voided, footer, subtotal, discount, total, paid, balance } = c;
    const page = el('div', { class: 'rc-classic' },
      el('div', { class: 'hd' }, shop.logoUrl ? el('div', { class: 'lg' }, el('img', { src: shop.logoUrl, alt: '' })) : null,
        el('div', { class: 'nm' }, shop.name || 'Receipt'), el('div', { class: 'sub' }, [shop.address, shop.phone].filter(Boolean).join(', '))),
      el('div', { class: 'meta' }, el('span', null, 'Bill No. ' + (billNo || '—')), el('span', null, fdate(date))),
      customer ? el('div', { class: 'meta' }, el('span', null, 'Customer: ' + customer + (phone ? ' (' + phone + ')' : ''))) : null,
      el('table', { class: 'it' }, el('thead', null, el('tr', null, el('th', null, 'Item'), el('th', { class: 'r nw' }, 'Qty'), el('th', { class: 'r nw' }, 'Price'), el('th', { class: 'r nw' }, 'Amount'))),
        el('tbody', null, lines.map((l) => el('tr', null, el('td', null, l.name), el('td', { class: 'r nw' }, q3.format(l.qty)), el('td', { class: 'r nw' }, rupee(l.price)), el('td', { class: 'r nw' }, rupee(l.amount)))))),
      el('div', { class: 'totals' },
        el('div', { class: 'row' }, el('span', null, 'Subtotal'), el('span', null, rupee(subtotal))),
        discount ? el('div', { class: 'row' }, el('span', null, 'Discount'), el('span', null, '-' + rupee(discount))) : null,
        el('div', { class: 'gt' }, el('span', null, 'Total'), el('span', null, rupee(total))),
        el('div', { class: 'row' }, el('span', null, 'Paid (' + payMode + ')'), el('span', null, rupee(paid))),
        balance ? el('div', { class: 'row' }, el('span', null, 'Balance due'), el('span', null, rupee(balance))) : null),
      voided ? el('div', { style: 'text-align:center;color:#b00;font-weight:800;margin-top:10px' }, 'CANCELLED') : null,
      el('div', { class: 'ft' }, footer));
    const wrap = el('div', { class: 'rc-classic-wrap' }, page);
    makeFit(wrap, page, 460);
    return wrap;
  }

  // =====================================================================================================================
  // 5) "stamped" -- a perforated-edge, typewriter/monospace receipt with a postage-stamp-style logo box and
  //    dashed tear lines, the nostalgic counterpart to "modern".
  // =====================================================================================================================
  function buildStamped(data) {
    injectCss('rc-stamped-css', '.rc-stamped-wrap{width:100%;display:flex;justify-content:center;overflow:hidden}' + PAGE_RESET +
      '.rc-stamped{width:420px;flex:none;background:#eceae3;color:#2a2823;font:13px/1.45 "Courier New",monospace;-webkit-print-color-adjust:exact;print-color-adjust:exact;padding:16px;display:flex;justify-content:center}' +
      '.rc-stamped .fr{width:388px;background:#fbfaf6;border:1px solid #2a2823;padding:18px 20px;position:relative;' +
      'background-image:radial-gradient(circle at 0 0,transparent 7px,#fbfaf6 7.5px),radial-gradient(circle at 388px 0,transparent 7px,#fbfaf6 7.5px);}' +
      '.rc-stamped .hd{text-align:center}.rc-stamped .stamp{width:52px;height:52px;margin:0 auto 8px;border:2px dashed #2a2823;border-radius:6px;overflow:hidden;background:#fff}.rc-stamped .stamp img{width:100%;height:100%;object-fit:contain}' +
      '.rc-stamped .nm{font-size:17px;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin:0 0 3px}.rc-stamped .sub{font-size:10.5px;color:#6b6657}' +
      '.rc-stamped .perf{height:0;border-top:2px dashed #b9b4a4;margin:12px 0}' +
      '.rc-stamped .meta{font-size:11px;display:flex;justify-content:space-between}' +
      '.rc-stamped .it .row{display:flex;justify-content:space-between;gap:8px;padding:3px 0;border-bottom:var(--bw,1px) dotted #b9b4a4;font-size:11.5px}' +
      '.rc-stamped .it .amt{white-space:nowrap}' +
      '.rc-stamped .totals{margin-top:8px;font-size:11.5px}.rc-stamped .totals .row{display:flex;justify-content:space-between;padding:2px 0}' +
      '.rc-stamped .totals .gt{display:flex;justify-content:space-between;font-size:14px;font-weight:700;border-top:2px dashed #2a2823;margin-top:5px;padding-top:6px}' +
      '.rc-stamped .ft{margin-top:12px;text-align:center;font-size:10.5px;color:#4a463c}' +
      '@media print{.rc-stamped-wrap{display:block;padding:0}.rc-stamped{zoom:1!important;width:100mm;background:#fff;margin:0 auto}.rc-stamped .fr{width:auto}}');
    const c = computeReceipt(data), { shop, lines, billNo, date, payMode, customer, phone, voided, footer, subtotal, discount, total, paid, balance } = c;
    const fr = el('div', { class: 'fr' },
      el('div', { class: 'hd' }, shop.logoUrl ? el('div', { class: 'stamp' }, el('img', { src: shop.logoUrl, alt: '' })) : null,
        el('div', { class: 'nm' }, shop.name || 'Receipt'), el('div', { class: 'sub' }, [shop.address, shop.phone].filter(Boolean).join(' · '))),
      el('div', { class: 'perf' }),
      el('div', { class: 'meta' }, el('span', null, 'No. ' + (billNo || '—')), el('span', null, fdate(date))),
      customer ? el('div', { class: 'meta', style: 'margin-top:3px' }, el('span', null, customer + (phone ? ' · ' + phone : ''))) : null,
      el('div', { class: 'it', style: 'margin-top:8px' }, lines.map((l) => el('div', { class: 'row' }, el('span', null, l.name + (l.qty !== 1 ? '  x' + q3.format(l.qty) : '')), el('span', { class: 'amt' }, rupee(l.amount))))),
      el('div', { class: 'totals' },
        el('div', { class: 'row' }, el('span', null, 'Subtotal'), el('span', null, rupee(subtotal))),
        discount ? el('div', { class: 'row' }, el('span', null, 'Discount'), el('span', null, '-' + rupee(discount))) : null,
        el('div', { class: 'gt' }, el('span', null, 'TOTAL'), el('span', null, rupee(total))),
        el('div', { class: 'row' }, el('span', null, 'Paid (' + payMode + ')'), el('span', null, rupee(paid))),
        balance ? el('div', { class: 'row' }, el('span', null, 'Balance due'), el('span', null, rupee(balance))) : null),
      voided ? el('div', { style: 'text-align:center;color:#b00;font-weight:800;margin-top:8px' }, 'CANCELLED') : null,
      el('div', { class: 'perf' }), el('div', { class: 'ft' }, footer));
    const page = el('div', { class: 'rc-stamped' }, fr), wrap = el('div', { class: 'rc-stamped-wrap' }, page);
    makeFit(wrap, page, 420);
    return wrap;
  }

  const api = { thermal: buildThermal, modern: buildModern, bold: buildBold, classic: buildClassic, stamped: buildStamped, computeReceipt };
  root.auzMobReceiptTemplates = Object.assign(root.auzMobReceiptTemplates || {}, api);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
