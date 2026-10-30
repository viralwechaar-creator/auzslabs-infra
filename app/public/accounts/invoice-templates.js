/* A gallery of extra invoice/receipt visual templates, each a real GST-compliant Indian tax invoice underneath (same required
   fields as accounts/taxinv.js's classic layout: GSTIN, HSN, invoice no., place of supply, CGST/SGST/IGST breakdown, amount in
   words, bank details, terms, signature) but with a genuinely different visual personality. Sits ALONGSIDE taxinv.js, never
   replaces it -- auzTaxInvoice.build() (settings.brand.invoiceStyle = 'classic') is unchanged.
   One rule followed by every template here (owner instruction -- 'classic' already follows it too, see taxinv.js's .nm/.ttl
   sizes): the BUSINESS NAME is the large, bold, highlighted element. The document type ("Invoice"/"Tax Invoice") stays small
   and secondary -- it can appear, never as the dominant headline.
   Chosen per business with settings.brand.invoiceStyle = 'noir' | 'playful' | 'bold' | 'minimal' | 'stamped' (Settings ->
   Organisation -> Invoice layout), wired through the same branch point as 'classic' in accounts/p-docs.js and accounts/bill.js.
   Same hard constraints as taxinv.js v7 learned the hard way (see CLAUDE.md "Invoice table lines vanished on iPhone"):
   border-collapse:separate + border-spacing:0 (never border-collapse, which drops sub-pixel lines on iOS Safari once the page
   is zoom-scaled down for a phone), the line width is a CSS variable scaled by the zoom factor in fit(), number cells are
   white-space:nowrap. The page is a fixed A4 (794 x 1123 CSS px), shown at any width with CSS zoom (never squeezed), real A4
   on paper. Built with createElement/textContent only, no innerHTML. */
(function (root) {
  'use strict';
  const TI = root.auzTaxInvoice || {}; // reuse the classic layout's number-to-words / state-name helpers rather than duplicate them
  const nf = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const q3 = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 3 });
  const n = (x) => { const v = Number(x); return isNaN(v) ? 0 : v; };
  const fdate = (s) => { const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? m[3] + '-' + m[2] + '-' + m[1] : ''; };
  const stateText = TI.stateText || ((c) => String(c || ''));
  const inWords = TI.inWords || ((v) => '₹' + nf.format(v));
  function el(tag, props) {
    const e = document.createElement(tag);
    for (const k in props || {}) { if (k === 'class') e.className = props[k]; else if (k === 'style') e.setAttribute('style', props[k]); else e.setAttribute(k, props[k]); }
    for (let i = 2; i < arguments.length; i++) [].concat(arguments[i]).flat(Infinity).forEach((c) => { if (c != null && c !== false) e.append(c instanceof Node ? c : document.createTextNode(String(c))); });
    return e;
  }
  const DOC_TITLE = { invoice: 'Tax Invoice', credit_note: 'Credit Note', quotation: 'Quotation', sales_order: 'Sales Order', delivery_challan: 'Delivery Challan' };

  /** Everything every template needs, computed once from the same data shape taxinv.js uses (public_acc_document / in-app). */
  function computeDoc(data) {
    const o = data.org || {}, d = data.doc || {}, b = o.brand || {}, k = b.bank || {}, lines = data.lines || [];
    const adr = [o.address, [o.city, o.pincode].filter(Boolean).join(', ')].filter(Boolean).join(', ');
    const title = DOC_TITLE[d.type] || 'Tax Invoice';
    const gross = lines.reduce((s, l) => s + n(l.qty) * n(l.rate), 0);
    const disc = n(d.discount) || lines.reduce((s, l) => s + n(l.disc_amt), 0);
    const intra = n(d.igst) === 0, qtySum = lines.reduce((s, l) => s + n(l.qty), 0);
    const groups = {};
    lines.forEach((l) => { const r = n(l.tax_rate), g = groups[r] || (groups[r] = { rate: r, taxable: 0, tax: 0 }); g.taxable += n(l.taxable); g.tax += n(l.tax != null ? l.tax : n(l.total) - n(l.taxable)); });
    const rows = Object.values(groups).sort((a, c) => a.rate - c.rate);
    const addRows = [];
    if (n(d.cgst)) addRows.push(['CGST', d.cgst]); if (n(d.sgst)) addRows.push(['SGST', d.sgst]); if (n(d.igst)) addRows.push(['IGST', d.igst]);
    if (n(d.cess)) addRows.push(['Cess', d.cess]); if (n(d.roundoff)) addRows.push(['Round off', d.roundoff]);
    const phone = d.party_phone || '';
    const billTo = !d.party_name || /^walk[- ]?in/i.test(d.party_name) ? 'Cash' : d.party_name;
    const terms = String(d.terms || o.terms || b.terms || '').split('\n').map((x) => x.trim()).filter(Boolean);
    const hasBank = !!(k.name || k.account || k.ifsc);
    return { o, d, b, k, lines, adr, title, gross, disc, intra, qtySum, rows, addRows, phone, billTo, terms, hasBank };
  }

  /** Tax-summary table rows, shared by every template: [rate-label, taxable, ...CGST/SGST or IGST cells]. */
  function taxTableRows(c) {
    return c.rows.map((g) => [g.rate ? g.rate + '%' : 'Exempt', nf.format(g.taxable)].concat(
      c.intra ? [g.tax ? nf.format(g.tax / 2) : '-', g.tax ? nf.format(g.tax / 2) : '-'] : [g.tax ? nf.format(g.tax) : '-']));
  }
  function taxTableHead(c) { return ['Rate', 'Taxable'].concat(c.intra ? ['CGST', 'SGST'] : ['IGST']); }

  // Same zoom-scaling mechanism as taxinv.js's fit(): shrink the fixed-A4 page to the width it's shown in (never above 100%),
  // and widen the table-line width as the page shrinks so a line stays about one real screen pixel (iOS Safari drops
  // sub-pixel borders). `wrap` is the unscaled parent used to measure available width; `page` is the scaled A4 element.
  function makeFit(wrap, page) {
    const fit = () => { const w = wrap.clientWidth || (wrap.parentNode && wrap.parentNode.clientWidth) || 794; const z = Math.min(1, Math.max(0.3, w / 794)); page.style.zoom = String(z); page.style.setProperty('--bw', Math.min(3, Math.max(1, 1.1 / z)).toFixed(2) + 'px'); };
    setTimeout(fit, 0); window.addEventListener('resize', fit);
    if (window.ResizeObserver) { try { new ResizeObserver(fit).observe(wrap); } catch (e) { /* ignore */ } }
    return fit;
  }
  function injectCss(id, text) { if (document.getElementById(id)) return; const st = document.createElement('style'); st.id = id; st.textContent = text; document.head.appendChild(st); }
  const ITEM_COLS = ['S.N.', 'Description', 'HSN', 'Qty', 'MRP', 'Price', 'Amount'];
  function itemRow(l, i) { return [i + 1, l.description || '', l.hsn || '', q3.format(n(l.qty)), n(l.mrp) ? nf.format(n(l.mrp)) : '-', nf.format(n(l.rate)), nf.format(n(l.qty) * n(l.rate))]; }
  const PAGE_RESET = '*{box-sizing:border-box}table{border-collapse:separate;border-spacing:0;width:100%;table-layout:fixed}td,th{vertical-align:top;word-wrap:break-word}td.nw,th.nw{white-space:nowrap}@page{size:A4;margin:0}';

  // =====================================================================================================================
  // 1) "noir" -- dark, minimalist, condensed. A near-black header band, thin olive hairline rules, restrained mono accents.
  //    Closest in spirit to the dark, stapled-paper service-receipt reference.
  // =====================================================================================================================
  function buildNoir(data) {
    injectCss('inv-noir-css', '.inv-noir-wrap{width:100%;display:flex;justify-content:center;overflow:hidden}' + PAGE_RESET +
      '.inv-noir{width:794px;min-height:1123px;flex:none;background:#fff;color:#1b1b1b;font:14px/1.4 "Helvetica Neue",Arial,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}' +
      '.inv-noir .fr{border:1px solid #1b1b1b;min-height:1121px;display:flex;flex-direction:column;position:relative}' +
      '.inv-noir .hd{background:#181815;color:#f3f1ea;padding:26px 30px 20px;display:flex;justify-content:space-between;align-items:flex-start;gap:14px}' +
      '.inv-noir .lg{width:52px;height:52px;flex:none;background:#2a2a24;display:flex;align-items:center;justify-content:center;overflow:hidden}.inv-noir .lg img{width:100%;height:100%;object-fit:contain}' +
      '.inv-noir .nm{font-size:30px;font-weight:800;letter-spacing:-.3px;margin:0 0 4px}.inv-noir .sub{font-size:11px;opacity:.75;line-height:1.5;max-width:320px}' +
      '.inv-noir .doctag{font-size:10px;letter-spacing:2px;text-transform:uppercase;opacity:.75;border:1px solid rgba(255,255,255,.4);border-radius:3px;padding:3px 9px;display:inline-block;margin-bottom:8px}' +
      '.inv-noir .meta{text-align:right;font-size:12px;line-height:1.7}.inv-noir .meta b{color:#f3f1ea;font-weight:700}' +
      '.inv-noir .bar{height:4px;background:#8a7c5a}' +
      '.inv-noir .g2{display:grid;grid-template-columns:1fr 1fr;border-bottom:var(--bw,1px) solid #1b1b1b}.inv-noir .g2>div{padding:14px 20px}.inv-noir .g2>div+div{border-left:var(--bw,1px) solid #1b1b1b}' +
      '.inv-noir .lab{font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:#8a7c5a;font-weight:700;margin-bottom:4px}' +
      '.inv-noir .itw{flex:1;padding:0 20px;display:flex;flex-direction:column}.inv-noir table.it{margin-top:12px}' +
      '.inv-noir table.it th{text-align:left;font-size:10px;letter-spacing:1px;text-transform:uppercase;color:#8a7c5a;border-bottom:1.5px solid #1b1b1b;padding:6px 6px}' +
      '.inv-noir table.it td{padding:7px 6px;border-bottom:var(--bw,1px) solid #ddd;font-size:13px}.inv-noir table.it tr.fill td{border-bottom:none;height:auto}' +
      '.inv-noir .r{text-align:right}' +
      '.inv-noir .totals{margin:10px 20px 0;align-self:flex-end;width:280px}' +
      '.inv-noir .totals .row{display:flex;justify-content:space-between;font-size:13px;padding:3px 0}.inv-noir .totals .gt{display:flex;justify-content:space-between;font-size:17px;font-weight:800;border-top:2px solid #181815;margin-top:4px;padding-top:6px}' +
      '.inv-noir .tx{margin:14px 20px 0;font-size:11.5px;border-top:var(--bw,1px) dashed #999;padding-top:10px}.inv-noir .tx table{font-size:11px}.inv-noir .tx th{text-align:left;font-weight:700;color:#8a7c5a;padding:2px 14px 2px 0}.inv-noir .tx td{padding:2px 14px 2px 0}' +
      '.inv-noir .words{margin:10px 20px 0;font-size:12px;font-style:italic;color:#333}' +
      '.inv-noir .ft{margin-top:auto;border-top:var(--bw,1px) solid #1b1b1b;display:grid;grid-template-columns:1.3fr 1fr}.inv-noir .ft>div{padding:14px 20px;font-size:11px;line-height:1.5}.inv-noir .ft>div+div{border-left:var(--bw,1px) solid #1b1b1b;text-align:right}' +
      '.inv-noir .sign{margin-top:28px;font-weight:700;font-size:12px}' +
      '@media print{html,body{background:#fff!important}.inv-noir-wrap{display:block;overflow:visible}.inv-noir{zoom:1!important;width:210mm;min-height:297mm}.inv-noir .fr{min-height:295mm}}');
    const c = computeDoc(data), { o, d, b, k, lines, adr, title, gross, disc, qtySum, addRows, phone, billTo, terms, hasBank } = c;
    const W = ['5%', '38%', '9%', '8%', '8%', '15%', '17%'];
    const fr = el('div', { class: 'fr' },
      el('div', { class: 'hd' },
        b.logo ? el('div', { class: 'lg' }, el('img', { src: b.logo, alt: '' })) : null,
        el('div', null, el('div', { class: 'doctag' }, title), el('div', { class: 'nm' }, o.name || o.legal_name || ''), el('div', { class: 'sub' }, adr)),
        el('div', { class: 'meta' }, o.gstin ? el('div', null, el('b', null, 'GSTIN '), o.gstin) : null, el('div', null, el('b', null, 'No. '), d.number || ''), el('div', null, el('b', null, 'Date '), fdate(d.date)))),
      el('div', { class: 'bar' }),
      el('div', { class: 'g2' }, el('div', null, el('div', { class: 'lab' }, 'Billed to / Shipped to'), el('div', null, billTo), phone ? el('div', null, phone) : null, d.party_gstin ? el('div', null, 'GSTIN ' + d.party_gstin) : null),
        el('div', null, el('div', { class: 'lab' }, 'Place of supply / reverse charge'), el('div', null, stateText(d.place_of_supply || o.state_code)), el('div', null, 'Reverse charge: ' + (d.reverse_charge ? 'Yes' : 'No')))),
      el('div', { class: 'itw' }, el('table', { class: 'it' }, el('colgroup', null, W.map((w) => el('col', { style: 'width:' + w }))),
        el('thead', null, el('tr', null, ITEM_COLS.map((x, i) => el('th', { class: i > 2 ? 'r nw' : '' }, x)))),
        el('tbody', null, lines.map((l, i) => el('tr', null, itemRow(l, i).map((x, j) => el('td', { class: j > 2 ? 'r nw' : '' }, x)))),
          el('tr', { class: 'fill' }, el('td', { colspan: '7' }))))),
      el('div', { class: 'totals' }, el('div', { class: 'row' }, el('span', null, 'Subtotal'), el('span', null, nf.format(gross))),
        disc ? el('div', { class: 'row' }, el('span', null, 'Discount'), el('span', null, '-' + nf.format(disc))) : null,
        addRows.map(([a, v]) => el('div', { class: 'row' }, el('span', null, a), el('span', null, nf.format(n(v))))),
        el('div', { class: 'gt' }, el('span', null, 'Total (' + q3.format(qtySum) + ' qty)'), el('span', null, '₹' + nf.format(n(d.total))))),
      el('div', { class: 'tx' }, el('table', null, el('thead', null, el('tr', null, taxTableHead(c).map((x) => el('th', null, x)))),
        el('tbody', null, taxTableRows(c).map((rr) => el('tr', null, rr.map((x, i) => el('td', { class: i ? 'nw' : '' }, x))))))),
      el('div', { class: 'words' }, inWords(n(d.total))),
      el('div', { class: 'ft' }, el('div', null, el('div', { class: 'lab' }, 'Terms'), terms.length ? terms.map((t) => el('div', null, t)) : el('div', null, '—'),
        (hasBank || o.bank_details) ? el('div', { style: 'margin-top:8px' }, el('div', { class: 'lab' }, 'Bank details'), hasBank ? el('div', null, [k.name, k.account ? 'A/c ' + k.account : '', k.ifsc].filter(Boolean).join(' · ')) : el('div', null, o.bank_details)) : null),
        el('div', null, el('div', { class: 'sign' }, 'For ' + (o.name || o.legal_name || '')), el('div', { style: 'margin-top:40px;font-size:11px' }, 'Authorised signatory'))),
      d.cancelled ? el('div', { style: 'text-align:center;color:#b00;font-weight:800;padding:8px;border-top:1px solid #1b1b1b' }, 'CANCELLED') : null);
    const page = el('div', { class: 'inv-noir' }, fr), wrap = el('div', { class: 'inv-noir-wrap' }, page);
    makeFit(wrap, page);
    return wrap;
  }

  // =====================================================================================================================
  // 2) "playful" -- cream & blue, friendly, rounded, a small drawn doodle accent. Inspired by the playful cream/blue +
  //    illustration reference, kept abstract (a simple drawn mark, not a literal copy of any specific illustration).
  // =====================================================================================================================
  function buildPlayful(data) {
    injectCss('inv-playful-css', '.inv-playful-wrap{width:100%;display:flex;justify-content:center;overflow:hidden}' + PAGE_RESET +
      '.inv-playful{width:794px;min-height:1123px;flex:none;background:#fdf8ef;color:#2b2a26;font:14px/1.4 "Trebuchet MS",Arial,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}' +
      '.inv-playful .fr{border:2px solid #2b2a26;border-radius:22px;margin:14px;min-height:1095px;display:flex;flex-direction:column;overflow:hidden;position:relative}' +
      '.inv-playful .hd{display:flex;justify-content:space-between;align-items:flex-start;gap:14px;padding:26px 28px 16px;background:#eaf2fb}' +
      '.inv-playful .doodle{width:46px;height:46px;border-radius:50%;background:#ffd166;border:2px solid #2b2a26;display:flex;align-items:center;justify-content:center;flex:none}' +
      '.inv-playful .lg{width:46px;height:46px;border-radius:50%;overflow:hidden;border:2px solid #2b2a26;flex:none}.inv-playful .lg img{width:100%;height:100%;object-fit:cover}' +
      '.inv-playful .nm{font-size:32px;font-weight:800;color:#2a5f9e;margin:0 0 2px}.inv-playful .sub{font-size:12px;color:#55554c}' +
      '.inv-playful .pill{display:inline-block;background:#fff;border:1.5px solid #2b2a26;border-radius:999px;padding:3px 12px;font-size:11px;font-weight:700;margin-bottom:6px}' +
      '.inv-playful .meta{text-align:right;font-size:12px;line-height:1.8}.inv-playful .meta .big{font-size:14px;font-weight:800;color:#2a5f9e}' +
      '.inv-playful .g2{display:grid;grid-template-columns:1fr 1fr;gap:12px;padding:14px 28px}.inv-playful .box{background:#fff;border:1.5px solid #2b2a26;border-radius:14px;padding:12px 14px}' +
      '.inv-playful .lab{font-size:10px;letter-spacing:1px;text-transform:uppercase;color:#2a5f9e;font-weight:800;margin-bottom:4px}' +
      '.inv-playful .itw{flex:1;padding:0 28px;display:flex;flex-direction:column}.inv-playful table.it{background:#fff;border:1.5px solid #2b2a26;border-radius:14px;overflow:hidden}' +
      '.inv-playful table.it th{background:#eaf2fb;text-align:left;font-size:11px;padding:8px 8px;border-bottom:var(--bw,1.5px) solid #2b2a26}' +
      '.inv-playful table.it td{padding:7px 8px;border-bottom:var(--bw,1px) solid #e6e1d4;font-size:13px}.inv-playful table.it tr.fill td{border-bottom:none;height:auto}' +
      '.inv-playful .r{text-align:right}' +
      '.inv-playful .totals{margin:12px 28px 0;align-self:flex-end;width:290px;background:#fff;border:1.5px solid #2b2a26;border-radius:14px;padding:10px 16px}' +
      '.inv-playful .totals .row{display:flex;justify-content:space-between;font-size:13px;padding:3px 0}.inv-playful .totals .gt{display:flex;justify-content:space-between;font-size:17px;font-weight:800;color:#2a5f9e;border-top:1.5px dashed #2b2a26;margin-top:4px;padding-top:6px}' +
      '.inv-playful .tx{margin:12px 28px 0;background:#fff;border:1.5px solid #2b2a26;border-radius:14px;padding:10px 16px;font-size:11.5px}.inv-playful .tx th{text-align:left;font-weight:700;color:#2a5f9e;padding:2px 14px 2px 0}.inv-playful .tx td{padding:2px 14px 2px 0}' +
      '.inv-playful .words{margin:10px 28px 0;font-size:12px;font-style:italic}' +
      '.inv-playful .ft{margin-top:auto;display:grid;grid-template-columns:1.3fr 1fr;gap:12px;padding:14px 28px 20px}.inv-playful .ft .box2{font-size:11px;line-height:1.6}' +
      '.inv-playful .sign{margin-top:30px;font-weight:800;font-size:12px;color:#2a5f9e;text-align:right}' +
      '@media print{html,body{background:#fff!important}.inv-playful-wrap{display:block;overflow:visible}.inv-playful{zoom:1!important;width:210mm;min-height:297mm}}');
    const c = computeDoc(data), { o, d, b, k, lines, adr, title, gross, disc, qtySum, addRows, phone, billTo, terms, hasBank } = c;
    const W = ['5%', '37%', '9%', '8%', '8%', '15%', '18%'];
    const fr = el('div', { class: 'fr' },
      el('div', { class: 'hd' },
        b.logo ? el('div', { class: 'lg' }, el('img', { src: b.logo, alt: '' })) : el('div', { class: 'doodle' }, '☕'),
        el('div', { style: 'flex:1;text-align:center' }, el('div', { class: 'pill' }, title), el('div', { class: 'nm' }, o.name || o.legal_name || ''), el('div', { class: 'sub' }, adr)),
        el('div', { class: 'meta' }, el('div', { class: 'big' }, d.number || ''), el('div', null, fdate(d.date)), o.gstin ? el('div', null, 'GSTIN ' + o.gstin) : null)),
      el('div', { class: 'g2' }, el('div', { class: 'box' }, el('div', { class: 'lab' }, 'Billed to / Shipped to'), el('div', null, billTo), phone ? el('div', null, phone) : null, d.party_gstin ? el('div', null, 'GSTIN ' + d.party_gstin) : null),
        el('div', { class: 'box' }, el('div', { class: 'lab' }, 'Place of supply / reverse charge'), el('div', null, stateText(d.place_of_supply || o.state_code)), el('div', null, 'Reverse charge: ' + (d.reverse_charge ? 'Yes' : 'No')))),
      el('div', { class: 'itw' }, el('table', { class: 'it' }, el('colgroup', null, W.map((w) => el('col', { style: 'width:' + w }))),
        el('thead', null, el('tr', null, ITEM_COLS.map((x, i) => el('th', { class: i > 2 ? 'r nw' : '' }, x)))),
        el('tbody', null, lines.map((l, i) => el('tr', null, itemRow(l, i).map((x, j) => el('td', { class: j > 2 ? 'r nw' : '' }, x)))),
          el('tr', { class: 'fill' }, el('td', { colspan: '7' }))))),
      el('div', { class: 'totals' }, el('div', { class: 'row' }, el('span', null, 'Subtotal'), el('span', null, nf.format(gross))),
        disc ? el('div', { class: 'row' }, el('span', null, 'Discount'), el('span', null, '-' + nf.format(disc))) : null,
        addRows.map(([a, v]) => el('div', { class: 'row' }, el('span', null, a), el('span', null, nf.format(n(v))))),
        el('div', { class: 'gt' }, el('span', null, 'Total (' + q3.format(qtySum) + ' qty)'), el('span', null, '₹' + nf.format(n(d.total))))),
      el('div', { class: 'tx' }, el('table', null, el('thead', null, el('tr', null, taxTableHead(c).map((x) => el('th', null, x)))),
        el('tbody', null, taxTableRows(c).map((rr) => el('tr', null, rr.map((x, i) => el('td', { class: i ? 'nw' : '' }, x))))))),
      el('div', { class: 'words' }, inWords(n(d.total))),
      el('div', { class: 'ft' }, el('div', { class: 'box2' }, el('div', { class: 'lab' }, 'Terms'), terms.length ? terms.map((t) => el('div', null, t)) : el('div', null, '—'),
        (hasBank || o.bank_details) ? el('div', { style: 'margin-top:8px' }, el('div', { class: 'lab' }, 'Bank details'), hasBank ? el('div', null, [k.name, k.account ? 'A/c ' + k.account : '', k.ifsc].filter(Boolean).join(' · ')) : el('div', null, o.bank_details)) : null),
        el('div', { class: 'sign' }, el('div', null, 'For ' + (o.name || o.legal_name || '')), el('div', { style: 'margin-top:40px;font-size:11px;font-weight:400' }, 'Authorised signatory'))),
      d.cancelled ? el('div', { style: 'text-align:center;color:#b00;font-weight:800;padding:8px' }, 'CANCELLED') : null);
    const page = el('div', { class: 'inv-playful' }, fr), wrap = el('div', { class: 'inv-playful-wrap' }, page);
    makeFit(wrap, page);
    return wrap;
  }

  // =====================================================================================================================
  // 3) "bold" -- graphic, high-contrast, thick ruled table, a solid colour band carrying the business name.
  // =====================================================================================================================
  function buildBold(data) {
    injectCss('inv-bold-css', '.inv-bold-wrap{width:100%;display:flex;justify-content:center;overflow:hidden}' + PAGE_RESET +
      '.inv-bold{width:794px;min-height:1123px;flex:none;background:#fff;color:#171412;font:14px/1.35 Arial,Helvetica,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}' +
      '.inv-bold .fr{border:3px solid #171412;min-height:1117px;display:flex;flex-direction:column;position:relative}' +
      '.inv-bold .hd{background:#c21807;color:#fff;padding:28px 30px 22px;display:flex;justify-content:space-between;align-items:flex-start;gap:14px}' +
      '.inv-bold .lg{width:58px;height:58px;flex:none;background:#fff;border:3px solid #171412;display:flex;align-items:center;justify-content:center;overflow:hidden}.inv-bold .lg img{width:100%;height:100%;object-fit:contain}' +
      '.inv-bold .nm{font-size:34px;font-weight:900;letter-spacing:-.5px;text-transform:uppercase;margin:0 0 2px}.inv-bold .sub{font-size:12px;opacity:.92;line-height:1.4}' +
      '.inv-bold .doctag{font-size:11px;letter-spacing:2px;text-transform:uppercase;font-weight:700;opacity:.9}' +
      '.inv-bold .meta{text-align:right;font-size:13px;line-height:1.8;font-weight:700}' +
      '.inv-bold .g2{display:grid;grid-template-columns:1fr 1fr;border-bottom:3px solid #171412}.inv-bold .g2>div{padding:12px 20px}.inv-bold .g2>div+div{border-left:3px solid #171412}' +
      '.inv-bold .lab{font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#c21807;font-weight:800;margin-bottom:4px}' +
      '.inv-bold .itw{flex:1;padding:0;display:flex;flex-direction:column}' +
      '.inv-bold table.it th{background:#171412;color:#fff;text-align:left;font-size:11px;letter-spacing:.5px;text-transform:uppercase;padding:9px 8px;border-right:2px solid #444}.inv-bold table.it th:last-child{border-right:0}' +
      '.inv-bold table.it td{padding:8px 8px;border-bottom:var(--bw,2px) solid #171412;border-right:var(--bw,1px) solid #ccc;font-size:13.5px;font-weight:600}.inv-bold table.it td:last-child{border-right:0}.inv-bold table.it tr.fill td{border-bottom:3px solid #171412;height:auto}' +
      '.inv-bold .r{text-align:right}' +
      '.inv-bold .totals{margin:0;padding:12px 20px;background:#171412;color:#fff;display:flex;justify-content:flex-end}' +
      '.inv-bold .totals .box{width:300px}.inv-bold .totals .row{display:flex;justify-content:space-between;font-size:13px;padding:3px 0}.inv-bold .totals .gt{display:flex;justify-content:space-between;font-size:20px;font-weight:900;color:#ff5a3c;border-top:2px solid #555;margin-top:5px;padding-top:7px}' +
      '.inv-bold .tx{padding:12px 20px;font-size:12px;border-bottom:3px solid #171412}.inv-bold .tx th{text-align:left;font-weight:800;padding:2px 16px 2px 0}.inv-bold .tx td{padding:2px 16px 2px 0}' +
      '.inv-bold .words{padding:10px 20px 0;font-size:12.5px;font-weight:700}' +
      '.inv-bold .ft{margin-top:auto;display:grid;grid-template-columns:1.3fr 1fr}.inv-bold .ft>div{padding:14px 20px;font-size:11.5px;line-height:1.5}.inv-bold .ft>div+div{border-left:3px solid #171412;text-align:right}' +
      '.inv-bold .sign{margin-top:36px;font-weight:900;font-size:13px}' +
      '@media print{html,body{background:#fff!important}.inv-bold-wrap{display:block;overflow:visible}.inv-bold{zoom:1!important;width:210mm;min-height:297mm}.inv-bold .fr{min-height:294mm}}');
    const c = computeDoc(data), { o, d, b, k, lines, adr, title, gross, disc, qtySum, addRows, phone, billTo, terms, hasBank } = c;
    const W = ['5%', '36%', '9%', '8%', '8%', '15%', '19%'];
    const fr = el('div', { class: 'fr' },
      el('div', { class: 'hd' }, b.logo ? el('div', { class: 'lg' }, el('img', { src: b.logo, alt: '' })) : null,
        el('div', { style: 'flex:1' }, el('div', { class: 'doctag' }, title), el('div', { class: 'nm' }, o.name || o.legal_name || ''), el('div', { class: 'sub' }, adr)),
        el('div', { class: 'meta' }, el('div', null, d.number || ''), el('div', null, fdate(d.date)), o.gstin ? el('div', null, 'GSTIN ' + o.gstin) : null)),
      el('div', { class: 'g2' }, el('div', null, el('div', { class: 'lab' }, 'Billed to / Shipped to'), el('div', null, billTo), phone ? el('div', null, phone) : null, d.party_gstin ? el('div', null, 'GSTIN ' + d.party_gstin) : null),
        el('div', null, el('div', { class: 'lab' }, 'Place of supply / reverse charge'), el('div', null, stateText(d.place_of_supply || o.state_code)), el('div', null, 'Reverse charge: ' + (d.reverse_charge ? 'Yes' : 'No')))),
      el('div', { class: 'itw' }, el('table', { class: 'it' }, el('colgroup', null, W.map((w) => el('col', { style: 'width:' + w }))),
        el('thead', null, el('tr', null, ITEM_COLS.map((x, i) => el('th', { class: i > 2 ? 'r nw' : '' }, x)))),
        el('tbody', null, lines.map((l, i) => el('tr', null, itemRow(l, i).map((x, j) => el('td', { class: j > 2 ? 'r nw' : '' }, x)))),
          el('tr', { class: 'fill' }, el('td', { colspan: '7' }))))),
      el('div', { class: 'totals' }, el('div', { class: 'box' }, el('div', { class: 'row' }, el('span', null, 'Subtotal'), el('span', null, nf.format(gross))),
        disc ? el('div', { class: 'row' }, el('span', null, 'Discount'), el('span', null, '-' + nf.format(disc))) : null,
        addRows.map(([a, v]) => el('div', { class: 'row' }, el('span', null, a), el('span', null, nf.format(n(v))))),
        el('div', { class: 'gt' }, el('span', null, 'TOTAL (' + q3.format(qtySum) + ' qty)'), el('span', null, '₹' + nf.format(n(d.total)))))),
      el('div', { class: 'tx' }, el('table', null, el('thead', null, el('tr', null, taxTableHead(c).map((x) => el('th', null, x)))),
        el('tbody', null, taxTableRows(c).map((rr) => el('tr', null, rr.map((x, i) => el('td', { class: i ? 'nw' : '' }, x))))))),
      el('div', { class: 'words' }, inWords(n(d.total))),
      el('div', { class: 'ft' }, el('div', null, el('div', { class: 'lab' }, 'Terms'), terms.length ? terms.map((t) => el('div', null, t)) : el('div', null, '—'),
        (hasBank || o.bank_details) ? el('div', { style: 'margin-top:8px' }, el('div', { class: 'lab' }, 'Bank details'), hasBank ? el('div', null, [k.name, k.account ? 'A/c ' + k.account : '', k.ifsc].filter(Boolean).join(' · ')) : el('div', null, o.bank_details)) : null),
        el('div', null, el('div', { class: 'sign' }, 'For ' + (o.name || o.legal_name || '')), el('div', { style: 'margin-top:40px;font-size:11px;font-weight:600' }, 'Authorised signatory'))),
      d.cancelled ? el('div', { style: 'text-align:center;background:#c21807;color:#fff;font-weight:900;padding:8px' }, 'CANCELLED') : null);
    const page = el('div', { class: 'inv-bold' }, fr), wrap = el('div', { class: 'inv-bold-wrap' }, page);
    makeFit(wrap, page);
    return wrap;
  }

  // =====================================================================================================================
  // 4) "minimal" -- clean, corporate, lots of whitespace, pill-shaped info boxes for invoice no./date/place of supply.
  // =====================================================================================================================
  function buildMinimal(data) {
    injectCss('inv-minimal-css', '.inv-minimal-wrap{width:100%;display:flex;justify-content:center;overflow:hidden}' + PAGE_RESET +
      '.inv-minimal{width:794px;min-height:1123px;flex:none;background:#fff;color:#1f2226;font:14px/1.45 "Segoe UI",Arial,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}' +
      '.inv-minimal .fr{border:1px solid #e3e5e8;min-height:1121px;display:flex;flex-direction:column;position:relative;padding:34px 36px}' +
      '.inv-minimal .hd{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:18px}' +
      '.inv-minimal .lg{width:48px;height:48px;flex:none;border-radius:10px;overflow:hidden;background:#f3f4f6}.inv-minimal .lg img{width:100%;height:100%;object-fit:contain}' +
      '.inv-minimal .nm{font-size:28px;font-weight:700;letter-spacing:-.4px;margin:0 0 4px;color:#111}.inv-minimal .sub{font-size:12px;color:#6b7280;line-height:1.5}' +
      '.inv-minimal .doctag{font-size:11px;color:#9aa1ab;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:4px}' +
      '.inv-minimal .pills{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}.inv-minimal .pill{background:#f3f4f6;border-radius:999px;padding:7px 14px;font-size:11.5px;color:#374151}.inv-minimal .pill b{color:#111;font-weight:700}' +
      '.inv-minimal .g2{display:flex;gap:14px;margin:16px 0}.inv-minimal .box{flex:1;background:#fafafa;border:1px solid #eee;border-radius:14px;padding:14px 16px}' +
      '.inv-minimal .lab{font-size:10.5px;letter-spacing:1px;text-transform:uppercase;color:#9aa1ab;font-weight:700;margin-bottom:5px}' +
      '.inv-minimal .itw{flex:1;display:flex;flex-direction:column}' +
      '.inv-minimal table.it th{text-align:left;font-size:11px;color:#9aa1ab;text-transform:uppercase;letter-spacing:.5px;padding:8px 8px;border-bottom:1.5px solid #e3e5e8}' +
      '.inv-minimal table.it td{padding:10px 8px;border-bottom:var(--bw,1px) solid #f0f1f2;font-size:13.5px}.inv-minimal table.it tr.fill td{border-bottom:none;height:auto}' +
      '.inv-minimal .r{text-align:right}' +
      '.inv-minimal .totals{margin:14px 0 0;align-self:flex-end;width:300px}' +
      '.inv-minimal .totals .row{display:flex;justify-content:space-between;font-size:13px;padding:4px 0;color:#4b5563}.inv-minimal .totals .gt{display:flex;justify-content:space-between;font-size:19px;font-weight:800;color:#111;border-top:1.5px solid #e3e5e8;margin-top:6px;padding-top:8px}' +
      '.inv-minimal .tx{margin-top:16px;background:#fafafa;border:1px solid #eee;border-radius:14px;padding:12px 16px;font-size:12px}.inv-minimal .tx th{text-align:left;font-weight:700;color:#6b7280;padding:2px 16px 2px 0}.inv-minimal .tx td{padding:2px 16px 2px 0}' +
      '.inv-minimal .words{margin-top:12px;font-size:12px;color:#4b5563;font-style:italic}' +
      '.inv-minimal .ft{margin-top:auto;display:flex;gap:16px;padding-top:20px;border-top:1px solid #e3e5e8}.inv-minimal .ft>div{flex:1;font-size:11.5px;color:#4b5563;line-height:1.5}' +
      '.inv-minimal .sign{margin-top:40px;font-weight:700;font-size:12.5px;text-align:right;color:#111}' +
      '@media print{html,body{background:#fff!important}.inv-minimal-wrap{display:block;overflow:visible}.inv-minimal{zoom:1!important;width:210mm;min-height:297mm}.inv-minimal .fr{min-height:287mm}}');
    const c = computeDoc(data), { o, d, b, k, lines, adr, title, gross, disc, qtySum, addRows, phone, billTo, terms, hasBank } = c;
    const W = ['5%', '38%', '9%', '8%', '8%', '15%', '17%'];
    const fr = el('div', { class: 'fr' },
      el('div', { class: 'hd' }, el('div', null, b.logo ? el('div', { class: 'lg' }, el('img', { src: b.logo, alt: '' })) : null, el('div', { class: 'doctag', style: 'margin-top:8px' }, title), el('div', { class: 'nm' }, o.name || o.legal_name || ''), el('div', { class: 'sub' }, adr)),
        el('div', { class: 'pills' }, el('div', { class: 'pill' }, el('b', null, d.number || '')), el('div', { class: 'pill' }, fdate(d.date)), o.gstin ? el('div', { class: 'pill' }, 'GSTIN ' + o.gstin) : null)),
      el('div', { class: 'g2' }, el('div', { class: 'box' }, el('div', { class: 'lab' }, 'Billed to / Shipped to'), el('div', null, billTo), phone ? el('div', null, phone) : null, d.party_gstin ? el('div', null, 'GSTIN ' + d.party_gstin) : null),
        el('div', { class: 'box' }, el('div', { class: 'lab' }, 'Place of supply / reverse charge'), el('div', null, stateText(d.place_of_supply || o.state_code)), el('div', null, 'Reverse charge: ' + (d.reverse_charge ? 'Yes' : 'No')))),
      el('div', { class: 'itw' }, el('table', { class: 'it' }, el('colgroup', null, W.map((w) => el('col', { style: 'width:' + w }))),
        el('thead', null, el('tr', null, ITEM_COLS.map((x, i) => el('th', { class: i > 2 ? 'r nw' : '' }, x)))),
        el('tbody', null, lines.map((l, i) => el('tr', null, itemRow(l, i).map((x, j) => el('td', { class: j > 2 ? 'r nw' : '' }, x)))),
          el('tr', { class: 'fill' }, el('td', { colspan: '7' }))))),
      el('div', { class: 'totals' }, el('div', { class: 'row' }, el('span', null, 'Subtotal'), el('span', null, nf.format(gross))),
        disc ? el('div', { class: 'row' }, el('span', null, 'Discount'), el('span', null, '-' + nf.format(disc))) : null,
        addRows.map(([a, v]) => el('div', { class: 'row' }, el('span', null, a), el('span', null, nf.format(n(v))))),
        el('div', { class: 'gt' }, el('span', null, 'Total (' + q3.format(qtySum) + ' qty)'), el('span', null, '₹' + nf.format(n(d.total))))),
      el('div', { class: 'tx' }, el('table', null, el('thead', null, el('tr', null, taxTableHead(c).map((x) => el('th', null, x)))),
        el('tbody', null, taxTableRows(c).map((rr) => el('tr', null, rr.map((x, i) => el('td', { class: i ? 'nw' : '' }, x))))))),
      el('div', { class: 'words' }, inWords(n(d.total))),
      el('div', { class: 'ft' }, el('div', null, el('div', { class: 'lab' }, 'Terms'), terms.length ? terms.map((t) => el('div', null, t)) : el('div', null, '—'),
        (hasBank || o.bank_details) ? el('div', { style: 'margin-top:8px' }, el('div', { class: 'lab' }, 'Bank details'), hasBank ? el('div', null, [k.name, k.account ? 'A/c ' + k.account : '', k.ifsc].filter(Boolean).join(' · ')) : el('div', null, o.bank_details)) : null),
        el('div', null, el('div', { class: 'sign' }, 'For ' + (o.name || o.legal_name || '')), el('div', { style: 'margin-top:40px;font-size:11px;font-weight:400;text-align:right;color:#6b7280' }, 'Authorised signatory'))),
      d.cancelled ? el('div', { style: 'text-align:center;color:#b00;font-weight:800;padding:8px' }, 'CANCELLED') : null);
    const page = el('div', { class: 'inv-minimal' }, fr), wrap = el('div', { class: 'inv-minimal-wrap' }, page);
    makeFit(wrap, page);
    return wrap;
  }

  // =====================================================================================================================
  // 5) "stamped" -- a narrow perforated receipt column centred on the A4 sheet, typewriter/monospace, dashed tear lines,
  //    a postage-stamp-style logo box. Inspired by the perforated-edge receipt reference.
  // =====================================================================================================================
  function buildStamped(data) {
    injectCss('inv-stamped-css', '.inv-stamped-wrap{width:100%;display:flex;justify-content:center;overflow:hidden}' + PAGE_RESET +
      '.inv-stamped{width:794px;min-height:1123px;flex:none;background:#eceae3;color:#2a2823;font:13px/1.45 "Courier New",monospace;-webkit-print-color-adjust:exact;print-color-adjust:exact;display:flex;justify-content:center;padding:28px 0}' +
      '.inv-stamped .fr{width:520px;background:#fbfaf6;border:1px solid #2a2823;min-height:1065px;display:flex;flex-direction:column;position:relative;' +
      'background-image:radial-gradient(circle at 0 0,transparent 7px,#fbfaf6 7.5px),radial-gradient(circle at 520px 0,transparent 7px,#fbfaf6 7.5px);}' +
      '.inv-stamped .perf{height:0;border-top:2px dashed #b9b4a4;margin:0 14px}' +
      '.inv-stamped .hd{padding:20px 22px 14px;text-align:center}' +
      '.inv-stamped .stamp{width:64px;height:64px;margin:0 auto 10px;border:2px dashed #2a2823;border-radius:6px;display:flex;align-items:center;justify-content:center;overflow:hidden;background:#fff}.inv-stamped .stamp img{width:100%;height:100%;object-fit:contain}' +
      '.inv-stamped .doctag{font-size:10.5px;letter-spacing:3px;text-transform:uppercase;color:#8a8372;margin-bottom:6px}' +
      '.inv-stamped .nm{font-size:24px;font-weight:700;letter-spacing:1px;text-transform:uppercase;margin:0 0 4px}.inv-stamped .sub{font-size:11px;color:#6b6657;line-height:1.5}' +
      '.inv-stamped .meta{font-size:11.5px;margin-top:10px;display:flex;justify-content:space-between;padding:0 4px}' +
      '.inv-stamped .sec{padding:12px 22px;font-size:11.5px}.inv-stamped .lab{font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:#8a8372;margin-bottom:3px}' +
      '.inv-stamped .itw{flex:1;padding:0 18px;display:flex;flex-direction:column}' +
      '.inv-stamped table.it th{text-align:left;font-size:10px;border-bottom:1.5px solid #2a2823;padding:5px 4px}.inv-stamped table.it td{padding:5px 4px;border-bottom:var(--bw,1px) dotted #b9b4a4;font-size:11.5px}.inv-stamped table.it tr.fill td{border-bottom:none;height:auto}' +
      '.inv-stamped .r{text-align:right}' +
      '.inv-stamped .totals{padding:10px 22px 0}.inv-stamped .totals .row{display:flex;justify-content:space-between;font-size:11.5px;padding:2px 0}' +
      '.inv-stamped .totals .gt{display:flex;justify-content:space-between;font-size:15px;font-weight:700;border-top:2px dashed #2a2823;margin-top:5px;padding-top:6px}' +
      '.inv-stamped .tx{padding:10px 22px;font-size:10.5px;border-top:1px dashed #b9b4a4}.inv-stamped .tx th{text-align:left;font-weight:700;padding:1px 10px 1px 0}.inv-stamped .tx td{padding:1px 10px 1px 0}' +
      '.inv-stamped .words{padding:8px 22px 0;font-size:11px;font-style:italic}' +
      '.inv-stamped .ft{margin-top:auto;padding:14px 22px 20px;font-size:10.5px;line-height:1.5;text-align:center;border-top:2px dashed #2a2823}' +
      '.inv-stamped .sign{margin-top:18px;font-weight:700;font-size:11.5px}' +
      '@media print{html,body{background:#fff!important}.inv-stamped-wrap{display:block;overflow:visible}.inv-stamped{zoom:1!important;width:210mm;min-height:297mm;padding:6mm 0}}');
    const c = computeDoc(data), { o, d, b, k, lines, adr, title, gross, disc, qtySum, addRows, phone, billTo, terms, hasBank } = c;
    const W = ['6%', '36%', '10%', '9%', '9%', '14%', '16%'];
    const fr = el('div', { class: 'fr' },
      el('div', { class: 'hd' }, b.logo ? el('div', { class: 'stamp' }, el('img', { src: b.logo, alt: '' })) : null,
        el('div', { class: 'doctag' }, title), el('div', { class: 'nm' }, o.name || o.legal_name || ''), el('div', { class: 'sub' }, adr),
        el('div', { class: 'meta' }, el('span', null, 'No. ' + (d.number || '')), el('span', null, fdate(d.date)))),
      el('div', { class: 'perf' }),
      el('div', { class: 'sec' }, el('div', { class: 'lab' }, 'Billed to / Shipped to'), el('div', null, billTo), phone ? el('div', null, phone) : null, d.party_gstin ? el('div', null, 'GSTIN ' + d.party_gstin) : null, o.gstin ? el('div', { style: 'margin-top:4px' }, 'Seller GSTIN ' + o.gstin) : null,
        el('div', { style: 'margin-top:4px' }, 'Place of supply: ' + stateText(d.place_of_supply || o.state_code) + ' · Reverse charge: ' + (d.reverse_charge ? 'Y' : 'N'))),
      el('div', { class: 'perf' }),
      el('div', { class: 'itw' }, el('table', { class: 'it' }, el('colgroup', null, W.map((w) => el('col', { style: 'width:' + w }))),
        el('thead', null, el('tr', null, ITEM_COLS.map((x, i) => el('th', { class: i > 2 ? 'r nw' : '' }, x)))),
        el('tbody', null, lines.map((l, i) => el('tr', null, itemRow(l, i).map((x, j) => el('td', { class: j > 2 ? 'r nw' : '' }, x)))),
          el('tr', { class: 'fill' }, el('td', { colspan: '7' }))))),
      el('div', { class: 'totals' }, el('div', { class: 'row' }, el('span', null, 'Subtotal'), el('span', null, nf.format(gross))),
        disc ? el('div', { class: 'row' }, el('span', null, 'Discount'), el('span', null, '-' + nf.format(disc))) : null,
        addRows.map(([a, v]) => el('div', { class: 'row' }, el('span', null, a), el('span', null, nf.format(n(v))))),
        el('div', { class: 'gt' }, el('span', null, 'TOTAL (' + q3.format(qtySum) + ' qty)'), el('span', null, '₹' + nf.format(n(d.total))))),
      el('div', { class: 'tx' }, el('table', null, el('thead', null, el('tr', null, taxTableHead(c).map((x) => el('th', null, x)))),
        el('tbody', null, taxTableRows(c).map((rr) => el('tr', null, rr.map((x, i) => el('td', { class: i ? 'nw' : '' }, x))))))),
      el('div', { class: 'words' }, inWords(n(d.total))),
      el('div', { class: 'ft' }, terms.length ? terms.map((t) => el('div', null, t)) : null,
        (hasBank || o.bank_details) ? el('div', { style: 'margin-top:4px' }, hasBank ? [k.name, k.account ? 'A/c ' + k.account : '', k.ifsc].filter(Boolean).join(' · ') : o.bank_details) : null,
        el('div', { class: 'sign' }, 'For ' + (o.name || o.legal_name || '') + ' · Authorised signatory')),
      d.cancelled ? el('div', { style: 'text-align:center;color:#b00;font-weight:800;padding:6px;border-top:2px dashed #2a2823' }, 'CANCELLED') : null);
    const page = el('div', { class: 'inv-stamped' }, fr), wrap = el('div', { class: 'inv-stamped-wrap' }, page);
    makeFit(wrap, page);
    return wrap;
  }

  // =====================================================================================================================
  // 6) "auzslab" -- the AUZslab main bill: big light "Invoice" word with the number small under it, logo top right, small
  //    From / To / Payment / Date blocks, hairline-ruled item table, large total, PAID stamp when settled, two-column
  //    small terms, signature. The same design AUZslab sends its own clients (site/inv.html), here for AUZsLedger data.
  //    Here the document word is the headline on purpose (it is the AUZslab house design); the business name sits in From.
  // =====================================================================================================================
  const SVGNS = 'http://www.w3.org/2000/svg';
  function svg(tag, props) {
    const e = document.createElementNS(SVGNS, tag);
    for (const k in props || {}) e.setAttribute(k, props[k]);
    for (let i = 2; i < arguments.length; i++) [].concat(arguments[i]).flat(Infinity).forEach((c) => { if (c != null && c !== false) e.append(c instanceof Node ? c : document.createTextNode(String(c))); });
    return e;
  }
  function paidStamp(name, dateTxt) {
    const f = { 'font-family': 'Helvetica,Arial,sans-serif', fill: 'currentColor', 'text-anchor': 'middle' };
    const o = svg('svg', { viewBox: '0 0 200 200', width: '100%', height: '100%', 'aria-hidden': 'true' },
      svg('defs', null, svg('path', { id: 'auzcpt', d: 'M24,100 A76,76 0 0 1 176,100' }), svg('path', { id: 'auzcpb', d: 'M20,100 A80,80 0 0 0 180,100' })),
      svg('circle', { cx: 100, cy: 100, r: 96, fill: 'none', stroke: 'currentColor', 'stroke-width': 4 }),
      svg('circle', { cx: 100, cy: 100, r: 90, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.2 }),
      svg('circle', { cx: 100, cy: 100, r: 58, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.4 }),
      svg('text', Object.assign({ 'font-size': 15, 'font-weight': 700, 'letter-spacing': 5 }, f), svg('textPath', { href: '#auzcpt', startOffset: '50%' }, String(name || '').toUpperCase().slice(0, 18))),
      svg('text', Object.assign({ 'font-size': 8.6, 'font-weight': 600, 'letter-spacing': 1.6 }, f), svg('textPath', { href: '#auzcpb', startOffset: '50%' }, 'PAID IN FULL')),
      svg('text', Object.assign({ x: 100, y: 108, 'font-size': 26, 'font-weight': 800, 'letter-spacing': 3 }, f), 'PAID'),
      svg('text', Object.assign({ x: 100, y: 132, 'font-size': 10, 'font-weight': 600 }, f), dateTxt));
    return o;
  }
  function buildAuzslab(data) {
    injectCss('inv-auz-css', '.inv-auz-wrap{width:100%;display:flex;justify-content:center;overflow:hidden}' + PAGE_RESET +
      '.inv-auz{width:794px;min-height:1118px;flex:none;position:relative;background:#fff;color:#161616;padding:36px 46px 28px;display:flex;flex-direction:column;font:11px/1.45 Inter,-apple-system,"Helvetica Neue",Arial,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}' +
      '.inv-auz .row{display:flex;justify-content:space-between;align-items:flex-start;gap:30px}' +
      '.inv-auz .h1{font-size:46px;line-height:1;font-weight:500;letter-spacing:-2px;margin:0}.inv-auz .no{font-size:12px;font-weight:500;color:#555;margin:2px 0 0;white-space:nowrap}' +
      '.inv-auz .lg{height:120px;width:auto;max-width:280px;object-fit:contain;object-position:right center;display:block}' +
      '.inv-auz .cols{display:grid;grid-template-columns:1fr 1fr;gap:30px;margin-top:16px}.inv-auz .cols.t2{margin-top:10px}' +
      '.inv-auz .h2{font-size:17px;font-weight:500;letter-spacing:-.3px;margin:0 0 4px}' +
      '.inv-auz .kv{display:grid;grid-template-columns:62px 1fr;gap:0 7px;font-size:8.6px;line-height:1.32}.inv-auz .kv span:nth-child(odd){color:#8a8a8a}.inv-auz .kv b{font-weight:500;word-break:break-word}' +
      '.inv-auz .svc{margin-top:14px;position:relative;flex:1}' +
      '.inv-auz .gr{display:grid;grid-template-columns:1fr 44px 92px 92px;gap:8px}' +
      '.inv-auz .gr.hd{align-items:end;border-bottom:1.5px solid #161616;padding-bottom:6px}.inv-auz .gr.hd .h2{margin:0;font-size:26px;letter-spacing:-1px}.inv-auz .gr.hd .c{font-size:15px;font-weight:500}' +
      '.inv-auz .gr.ln{padding:5px 0;border-bottom:var(--bw,1px) solid #ececec;font-size:10.5px}.inv-auz .gr.ln small{display:block;color:#8a8a8a;font-size:9px}' +
      '.inv-auz .r{text-align:right;white-space:nowrap}' +
      '.inv-auz .tots{margin-left:auto;width:290px;margin-top:8px}.inv-auz .tr{display:flex;justify-content:space-between;padding:1.5px 0;font-size:10px;color:#555}.inv-auz .tr b{color:#161616;font-weight:500}' +
      '.inv-auz .tr.big{border-top:1.5px solid #161616;margin-top:5px;padding-top:7px;font-size:20px;color:#161616;letter-spacing:-.4px}.inv-auz .tr.big b{font-weight:600}' +
      '.inv-auz .words{font-size:9.5px;color:#555;text-align:right;margin-top:3px}' +
      '.inv-auz .stamp{position:absolute;left:140px;bottom:20px;width:118px;height:118px;transform:rotate(-13deg);opacity:.88;pointer-events:none;color:#800020}' +
      '.inv-auz .terms{margin-top:6px;columns:2;column-gap:24px;font-size:7.3px;line-height:1.3;color:#444}.inv-auz .terms p{margin:0 0 3.5px;break-inside:avoid}' +
      '.inv-auz .foot{margin-top:12px;display:flex;justify-content:space-between;align-items:flex-end}.inv-auz .foot small{font-size:8.5px;color:#8a8a8a}' +
      '.inv-auz .sign{width:240px;text-align:center;font-size:9.5px;color:#555}.inv-auz .sign div{border-top:1px solid #161616;margin-top:30px;padding-top:4px}' +
      '.inv-auz .cx{position:absolute;top:40%;left:0;right:0;text-align:center;font-size:70px;font-weight:800;color:rgba(176,0,0,.16);transform:rotate(-18deg);pointer-events:none}' +
      '@media print{html,body{background:#fff!important}.inv-auz-wrap{display:block;overflow:visible}.inv-auz{zoom:1!important;width:210mm;min-height:297mm}}');
    const c = computeDoc(data), { o, d, b, k, lines, adr, title, gross, disc, intra, addRows, phone, billTo, terms } = c;
    const paid = n(d.total) > 0 && n(d.paid) >= n(d.total) - 0.005 && !d.cancelled;
    const kv = (rows) => el('div', { class: 'kv' }, rows.filter((r) => r[1]).map((r) => [el('span', null, r[0]), el('b', null, r[1])]));
    const bankRows = [['Pay to', b.upi], ['Bank', k.name], ['Account', [k.holder, k.account].filter(Boolean).join(' · ')], ['IFSC', k.ifsc], ['Branch', k.branch]];
    if (!(k.name || k.account) && o.bank_details) bankRows.push(['Bank', o.bank_details]);
    const lineEls = lines.map((l) => {
      const sub = [l.hsn ? 'HSN/SAC ' + l.hsn : '', n(l.mrp) ? 'MRP ' + nf.format(n(l.mrp)) : '', n(l.tax_rate) ? 'GST ' + n(l.tax_rate) + '%' : 'No GST', n(l.disc_amt) ? 'discount ' + nf.format(n(l.disc_amt)) : ''].filter(Boolean).join(' · ');
      return el('div', { class: 'gr ln' }, el('div', null, l.description || '', el('small', null, sub)), el('div', { class: 'r' }, q3.format(n(l.qty))), el('div', { class: 'r' }, '₹' + nf.format(n(l.rate))), el('div', { class: 'r' }, '₹' + nf.format(n(l.taxable))));
    });
    const sheet = el('div', { class: 'inv-auz' },
      d.cancelled ? el('div', { class: 'cx' }, 'CANCELLED') : null,
      el('div', { class: 'row' }, el('div', null, el('h1', { class: 'h1' }, title.replace(/^Tax /, '')), el('div', { class: 'no' }, d.number || '')), el('img', { class: 'lg', src: b.logo || '/logo.png', alt: '' })),
      el('div', { class: 'cols' },
        el('div', null, el('h2', { class: 'h2' }, 'From'), kv([['Name', o.legal_name || o.name], ['GSTIN', o.gstin], ['Address', adr], ['Phone', o.phone], ['Email', o.email]])),
        el('div', null, el('h2', { class: 'h2' }, 'To'), kv([['Name', billTo], ['GSTIN', d.party_gstin || 'Unregistered'], ['Address', d.billing_address], ['Phone', phone]]))),
      el('div', { class: 'cols t2' },
        el('div', null, el('h2', { class: 'h2' }, 'Payment'), kv([['Status', d.cancelled ? 'Cancelled' : (paid ? 'Paid in full' : 'Payment due')]].concat(bankRows))),
        el('div', null, el('h2', { class: 'h2' }, 'Date'), kv([['Invoice', fdate(d.date)], ['Due', fdate(d.due_date)], ['Place', stateText(d.place_of_supply || o.state_code)], ['Supply', intra ? 'Within state (CGST + SGST)' : 'Inter-state (IGST)'], ['Reverse chg.', d.reverse_charge ? 'Yes' : 'No']]))),
      el('div', { class: 'svc' },
        el('div', { class: 'gr hd' }, el('h2', { class: 'h2' }, 'Items'), el('div', { class: 'c r' }, 'Qty'), el('div', { class: 'c r' }, 'Price'), el('div', { class: 'c r' }, 'Total')),
        lineEls,
        el('div', { class: 'tots' },
          el('div', { class: 'tr' }, el('span', null, 'Subtotal'), el('b', null, '₹' + nf.format(gross))),
          disc ? el('div', { class: 'tr' }, el('span', null, 'Discount'), el('b', null, '-₹' + nf.format(disc))) : null,
          el('div', { class: 'tr' }, el('span', null, 'Taxable value'), el('b', null, '₹' + nf.format(n(d.taxable)))),
          addRows.map(([a, v]) => el('div', { class: 'tr' }, el('span', null, a), el('b', null, '₹' + nf.format(n(v))))),
          el('div', { class: 'tr big' }, el('span', null, 'Total'), el('b', null, '₹' + nf.format(n(d.total)))),
          el('div', { class: 'words' }, inWords(n(d.total)))),
        paid ? el('div', { class: 'stamp' }, paidStamp(o.name || o.legal_name, fdate(d.date))) : null),
      terms.length ? el('div', { class: 'terms' }, terms.map((t) => el('p', null, t))) : null,
      el('div', { class: 'foot' }, el('small', null, o.footer || ''), el('div', { class: 'sign' }, el('div', null, 'For ' + (o.legal_name || o.name || ''), el('br'), 'Authorised signatory'))));
    const wrap = el('div', { class: 'inv-auz-wrap' }, sheet);
    makeFit(wrap, sheet);
    return wrap;
  }

  const api = { auzslab: buildAuzslab, noir: buildNoir, playful: buildPlayful, bold: buildBold, minimal: buildMinimal, stamped: buildStamped, computeDoc };
  root.auzInvoiceTemplates = Object.assign(root.auzInvoiceTemplates || {}, api);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
