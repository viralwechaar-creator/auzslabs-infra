/* "Classic Indian tax invoice" layout (logo box, TAX INVOICE heading, Billed to / Shipped to, S.N. table with MRP, tax summary, amount in words,
   bank details, terms, receiver's signature). One drawing used by the in-app print (accounts/p-docs.js) and the public bill page (accounts/bill.js).
   Turned on per business with settings.brand.invoiceStyle = 'classic' (Settings -> Organisation -> Invoice layout). Built with createElement and textContent only. */
(function (root) {
  'use strict';
  const STATES = { '01': 'Jammu & Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh', '05': 'Uttarakhand', '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh', '10': 'Bihar', '11': 'Sikkim', '12': 'Arunachal Pradesh', '13': 'Nagaland', '14': 'Manipur', '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya', '18': 'Assam', '19': 'West Bengal', '20': 'Jharkhand', '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh', '24': 'Gujarat', '26': 'Dadra & Nagar Haveli and Daman & Diu', '27': 'Maharashtra', '29': 'Karnataka', '30': 'Goa', '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry', '35': 'Andaman & Nicobar Islands', '36': 'Telangana', '37': 'Andhra Pradesh', '38': 'Ladakh', '97': 'Other Territory' };
  const nf = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const q3 = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 3 });
  const n = (x) => { const v = Number(x); return isNaN(v) ? 0 : v; };
  const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  function below1000(v) { let s = ''; if (v >= 100) { s += ONES[Math.floor(v / 100)] + ' Hundred '; v %= 100; } if (v >= 20) { s += TENS[Math.floor(v / 10)] + ' '; v %= 10; } if (v > 0) s += ONES[v] + ' '; return s; }
  /** 45 -> "Rupees Forty Five Only"; 1234.5 -> "Rupees One Thousand Two Hundred Thirty Four and Fifty Paise Only" (Indian lakh / crore grouping) */
  function inWords(amount) {
    let rupees = Math.floor(Math.abs(amount) + 1e-9), paise = Math.round((Math.abs(amount) - rupees) * 100); if (paise === 100) { rupees += 1; paise = 0; }
    let s = '';
    const cr = Math.floor(rupees / 10000000); rupees %= 10000000; const lk = Math.floor(rupees / 100000); rupees %= 100000; const th = Math.floor(rupees / 1000); rupees %= 1000;
    if (cr) s += below1000(cr) + 'Crore '; if (lk) s += below1000(lk) + 'Lakh '; if (th) s += below1000(th) + 'Thousand '; s += below1000(rupees);
    s = s.trim() || 'Zero';
    return 'Rupees ' + s + (paise ? ' and ' + below1000(paise).trim() + ' Paise' : '') + ' Only';
  }
  const fdate = (s) => { const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? m[3] + '-' + m[2] + '-' + m[1] : ''; };
  const stateText = (c) => { c = String(c || '').trim(); if (!c) return ''; const code = /^\d{1,2}$/.test(c) ? c.padStart(2, '0') : ''; return code && STATES[code] ? STATES[code] + ' (' + code + ')' : c; };
  // The sheet is drawn at A4 size (794 x 1123 CSS px = 210 x 297 mm) and scaled to fit the screen with zoom, so a phone shows the SAME
  // page, not a squeezed one. Printing uses real A4. More items than fit simply make the page longer (a second printed page).
  function css() {
    if (document.getElementById('taxinv-css')) return;
    const st = document.createElement('style'); st.id = 'taxinv-css';
    st.textContent = '.ti-wrap{width:100%;display:flex;justify-content:center;overflow:hidden}' +
      '.ti{width:794px;min-height:1123px;box-sizing:border-box;padding:12px;background:#fff;color:#111;font:15px/1.3 Arial,Helvetica,"Liberation Sans",sans-serif;flex:none;-webkit-print-color-adjust:exact;print-color-adjust:exact}' +
      '.ti *{box-sizing:border-box}.ti .fr{border:1px solid #111;min-height:1099px;display:flex;flex-direction:column;position:relative}' +
      '.ti .cp{position:absolute;right:12px;top:6px;font-style:italic;font-size:15px}' +
      '.ti .hd{display:flex;align-items:flex-start;gap:0;padding:14px 8px 8px 8px;border-bottom:1px solid #111;min-height:153px;position:relative}' +
      '.ti .hd .lg{width:136px;flex:none;margin-top:0}.ti .hd .lg img{width:136px;height:auto;display:block;background:#000}' +
      '.ti .hd .ct{position:absolute;left:0;right:0;top:12px;text-align:center;pointer-events:none}' +
      '.ti .ttl{font-weight:700;font-size:18px;text-decoration:underline;margin-bottom:2px}.ti .nm{font-weight:700;font-size:37px;line-height:1.1;margin:0 0 3px}' +
      '.ti .ad{font-size:16px;line-height:1.35}.ti .gs{font-weight:700;font-size:18px;margin:2px 0}.ti .tl{font-style:italic;font-weight:700;font-size:14px;margin-top:2px}' +
      '.ti .g2{display:grid;grid-template-columns:1fr 1fr}.ti .g2>div{padding:10px 10px}.ti .g2>div+div{border-left:1px solid #111}.ti .r1{border-bottom:1px solid #111;min-height:55px;font-size:16px}' +
      '.ti .r2{border-bottom:1px solid #111;min-height:141px;font-size:15.5px}.ti .r2>div{padding:8px 10px;display:flex;flex-direction:column}' +
      '.ti .kv{display:grid;grid-template-columns:111px 14px 1fr;margin:1px 0}.ti .bt{font-weight:700;font-style:italic;font-size:17px}.ti .mu{flex:1;min-height:56px;padding-top:4px}' +
      '.ti .strip{height:26px;border-bottom:1px solid #111}' +
      '.ti .itw{flex:1;display:flex;flex-direction:column;min-height:200px}.ti table.it{width:100%;flex:1;border-collapse:collapse;table-layout:fixed;height:100%}' +
      '.ti table.it th{border-bottom:1px solid #111;border-right:1px solid #111;padding:7px 7px;font-size:15px;height:36px}.ti table.it th:last-child,.ti table.it td:last-child{border-right:0}' +
      '.ti table.it th.sn{font-size:11px;text-align:left}.ti table.it th.hs{font-size:10px}' +
      '.ti table.it td{border-right:1px solid #111;padding:6px 8px;vertical-align:top;font-size:15px;word-wrap:break-word}.ti .r{text-align:right}.ti table.it tr.fill td{height:auto}' +
      '.ti .sum{display:grid;grid-template-columns:1fr 14.9%;border-top:1px solid #111;min-height:49px}.ti .sum .l{text-align:center;font-style:italic;display:flex;align-items:center;justify-content:center;padding-right:70px;font-size:15px}' +
      '.ti .sum .rr{border-left:1px solid #111;padding:4px 8px}.ti .sum .rr div{text-align:right;font-size:15px}' +
      '.ti .gt{display:grid;grid-template-columns:1fr 14.9%;border-top:1px solid #111;border-bottom:1px solid #111;font-weight:700;font-size:15px;min-height:30px}.ti .gt .a{display:flex;justify-content:center;align-items:center;gap:22px;padding-left:110px}' +
      '.ti .gt .a i{display:inline-block;min-width:60px;text-align:center;border-bottom:1.5px solid #111;font-style:normal;height:18px;line-height:16px}.ti .gt .a .rs{margin-left:60px}.ti .gt .b{border-left:1px solid #111;padding:4px 8px;text-align:right}' +
      '.ti .tx{padding:11px 12px 8px;min-height:123px;display:flex;flex-direction:column;border-bottom:1px solid #111}.ti .tx table{border-collapse:collapse;font-size:14px}.ti .tx th{font-size:11.5px;text-align:left;font-weight:700;padding:1px 22px 1px 0;white-space:nowrap}.ti .tx th span{border-bottom:1px solid #111;padding-bottom:2px}.ti .tx td{padding:3px 22px 2px 0;text-align:left;font-size:14px}.ti .tx th:first-child{font-size:15px}' +
      '.ti .wd{margin-top:auto;font-weight:700;font-size:17px;padding-top:10px}' +
      '.ti .bk{padding:9px 12px;border-bottom:1px solid #111;font-size:15px;min-height:43px;display:flex;gap:14px}.ti .bk b{font-size:16px;white-space:nowrap}' +
      '.ti .ft{display:grid;grid-template-columns:1fr 1fr;min-height:141px}.ti .ft .tc{padding:7px 10px;font-size:13.5px}.ti .ft .tc b{text-decoration:underline;font-size:11px}.ti .ft .tc p{margin:2px 0;line-height:1.3}' +
      '.ti .ft .sg{border-left:1px solid #111;display:grid;grid-template-rows:55px 1fr}.ti .ft .sg .rc{font-weight:700;font-size:12px;padding:10px;border-bottom:1px solid #111}.ti .ft .sg .au{text-align:right;font-weight:700;font-size:16px;padding:10px 14px 8px;display:flex;flex-direction:column;justify-content:space-between;gap:10px}.ti .ft .sg img{max-height:48px;max-width:150px;align-self:flex-end}' +
      '@page{size:A4;margin:0}' +
      '@media print{html,body{background:#fff!important}.ti-wrap{display:block;overflow:visible}.ti{zoom:1!important;width:210mm;min-height:297mm;padding:4mm}.ti .fr{min-height:289mm}}';
    document.head.appendChild(st);
  }
  function el(tag, props) {
    const e = document.createElement(tag);
    for (const k in props || {}) { if (k === 'class') e.className = props[k]; else if (k === 'style') e.setAttribute('style', props[k]); else e.setAttribute(k, props[k]); }
    for (let i = 2; i < arguments.length; i++) [].concat(arguments[i]).flat(Infinity).forEach((c) => { if (c != null && c !== false) e.append(c instanceof Node ? c : document.createTextNode(String(c))); });
    return e;
  }
  const kv = (k, v) => el('div', { class: 'kv' }, el('span', null, k), el('span', null, ':'), el('span', null, v));

  /** data = { org, doc, lines } as returned by public_acc_document (the app builds the same shape for printing). Lines may carry mrp. */
  function build(data, opts) {
    css(); opts = opts || {};
    const o = data.org || {}, d = data.doc || {}, b = o.brand || {}, k = b.bank || {}, lines = data.lines || [];
    const adr = [o.address, [o.city, o.pincode].filter(Boolean).join(' ')].filter(Boolean).join(' ');
    const title = { invoice: 'TAX INVOICE', credit_note: 'CREDIT NOTE', quotation: 'QUOTATION', sales_order: 'SALES ORDER', delivery_challan: 'DELIVERY CHALLAN' }[d.type] || 'TAX INVOICE';
    const gross = lines.reduce((s, l) => s + n(l.qty) * n(l.rate), 0), disc = n(d.discount) || lines.reduce((s, l) => s + n(l.disc_amt), 0);
    const intra = n(d.igst) === 0, qtySum = lines.reduce((s, l) => s + n(l.qty), 0);
    const groups = {}; lines.forEach((l) => { const r = n(l.tax_rate), g = groups[r] || (groups[r] = { rate: r, taxable: 0, tax: 0 }); g.taxable += n(l.taxable); g.tax += n(l.tax != null ? l.tax : n(l.total) - n(l.taxable)); });
    const rows = Object.values(groups).sort((a, c) => a.rate - c.rate);
    const addRows = [];
    if (n(d.cgst)) addRows.push(['Add : CGST', d.cgst]); if (n(d.sgst)) addRows.push(['Add : SGST', d.sgst]); if (n(d.igst)) addRows.push(['Add : IGST', d.igst]); if (n(d.cess)) addRows.push(['Add : Cess', d.cess]); if (n(d.roundoff)) addRows.push(['Round off', d.roundoff]);
    const phone = d.party_phone || '', billTo = !d.party_name || /^walk[- ]?in/i.test(d.party_name) ? 'Cash' : d.party_name;
    const blk = (label) => el('div', null, el('div', { class: 'bt' }, label + ' :'), el('div', { class: 'mu' }, billTo, d.billing_address ? el('div', null, d.billing_address) : null), kv('Party Mobile No', phone), kv('GSTIN / UIN', d.party_gstin || ''));
    const terms = String(d.terms || o.terms || b.terms || '').split('\n').map((x) => x.trim()).filter(Boolean);
    const hasBank = k.name || k.account || k.ifsc;
    const W = ['5.2%', '40.1%', '8.7%', '8.3%', '7.2%', '15.5%', '14.9%'];
    const th = (txt, cls, st) => el('th', { class: cls || '', style: st || '' }, txt);
    const fr = el('div', { class: 'fr' },
      opts.copy === false ? null : el('div', { class: 'cp' }, opts.copy || 'Original Copy'),
      el('div', { class: 'hd' }, b.logo ? el('div', { class: 'lg' }, el('img', { src: b.logo, alt: '' })) : null,
        el('div', { class: 'ct' }, el('div', { class: 'ttl' }, title), el('div', { class: 'nm' }, o.name || o.legal_name || ''), el('div', { class: 'ad' }, adr), o.gstin ? el('div', { class: 'gs' }, 'GSTIN : ' + o.gstin) : null,
          (o.phone || o.email) ? el('div', { class: 'tl' }, [o.phone ? 'Tel. : ' + o.phone : '', o.email ? 'email : ' + o.email : ''].filter(Boolean).join('     ')) : null)),
      el('div', { class: 'g2 r1' }, el('div', null, kv('Invoice No.', d.number || ''), kv('Dated', fdate(d.date))),
        el('div', null, el('div', null, 'Place of Supply  : ' + stateText(d.place_of_supply || o.state_code)), el('div', null, 'Reverse Charge : ' + (d.reverse_charge ? 'Y' : 'N')))),
      el('div', { class: 'g2 r2' }, blk('Billed to'), blk('Shipped to')),
      el('div', { class: 'strip' }),
      el('div', { class: 'itw' }, el('table', { class: 'it' }, el('colgroup', null, W.map((w) => el('col', { style: 'width:' + w }))),
        el('thead', null, el('tr', null, th('S.N.', 'sn'), th('Description of Goods', '', 'text-align:left'), th('HSN/SAC Cod', 'hs'), th('Qty.', 'r'), th('MRP', 'r'), th('Price', 'r'), th('Amount(₹)', 'r'))),
        el('tbody', null, lines.map((l, i) => el('tr', null, [(l.n || i + 1) + '.', l.description || '', l.hsn || '', q3.format(n(l.qty)), n(l.mrp) ? nf.format(n(l.mrp)) : '', nf.format(n(l.rate)), nf.format(n(l.qty) * n(l.rate))].map((x, j) => el('td', { class: j > 2 || j === 0 ? 'r' : '' }, x)))),
          el('tr', { class: 'fill' }, [0, 1, 2, 3, 4, 5, 6].map(() => el('td', null)))))),
      el('div', { class: 'sum' }, el('div', { class: 'l' }, 'Less : Discount'), el('div', { class: 'rr' }, el('div', { style: 'font-weight:700' }, nf.format(gross)), el('div', null, nf.format(disc)), addRows.map(([a, v]) => el('div', null, el('span', { style: 'float:left;font-style:italic;font-size:11px' }, a), nf.format(n(v)))))),
      el('div', { class: 'gt' }, el('div', { class: 'a' }, el('span', null, 'Grand Total'), el('i', null, nf.format(qtySum)), el('span', { class: 'rs' }, '₹')), el('div', { class: 'b' }, nf.format(n(d.total)))),
      el('div', { class: 'tx' }, el('table', null, el('thead', null, el('tr', null, ['Tax Rate', 'Taxable Amt.', intra ? 'CGST Amt.' : 'IGST Amt.', intra ? 'SGST Amt.' : '', 'Total Tax'].filter((x, i) => x || i !== 3).map((x) => el('th', null, el('span', null, x))))),
        el('tbody', null, rows.map((g) => el('tr', null, [g.rate ? g.rate + '%' : 'Exempt', nf.format(g.taxable), ...(intra ? [g.tax ? nf.format(g.tax / 2) : '--', g.tax ? nf.format(g.tax / 2) : '--'] : [g.tax ? nf.format(g.tax) : '--']), nf.format(g.tax)].map((x) => el('td', null, x)))))),
        el('div', { class: 'wd' }, inWords(n(d.total)))),
      (hasBank || o.bank_details) ? el('div', { class: 'bk' }, el('b', null, 'Bank Details:'), hasBank ? el('div', null, [k.name ? k.name : '', k.account ? ' : Account Number:' + k.account : ''].join(''), k.ifsc ? el('div', null, 'IFSC : ' + k.ifsc) : null) : el('div', null, o.bank_details)) : null,
      el('div', { class: 'ft' }, el('div', { class: 'tc' }, el('b', null, 'Terms & Conditions'), terms.length ? terms.map((t) => el('p', null, t)) : null),
        el('div', { class: 'sg' }, el('div', { class: 'rc' }, "Receiver's Signature :"), el('div', { class: 'au' }, el('span', null, 'For ' + (o.name || o.legal_name || '')), b.signature ? el('img', { src: b.signature, alt: '' }) : null, el('span', null, 'Authorised Signatory')))),
      d.cancelled ? el('div', { style: 'text-align:center;color:#b00;font-weight:700;padding:6px;border-top:1px solid #111' }, 'CANCELLED') : null);
    const ti = el('div', { class: 'ti' }, fr), wrap = el('div', { class: 'ti-wrap' }, ti);
    // scale the A4 page to the width it is shown in (never above 100%)
    const fit = () => { const w = wrap.clientWidth || wrap.parentNode && wrap.parentNode.clientWidth || 794; ti.style.zoom = String(Math.min(1, Math.max(0.3, w / 794))); };
    setTimeout(fit, 0); window.addEventListener('resize', fit); if (window.ResizeObserver) { try { new ResizeObserver(fit).observe(wrap); } catch (e) { /* ignore */ } }
    return wrap;
  }
  const api = { build, inWords, stateText };
  root.auzTaxInvoice = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
