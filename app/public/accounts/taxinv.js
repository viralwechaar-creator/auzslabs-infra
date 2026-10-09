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
  function css() {
    if (document.getElementById('taxinv-css')) return;
    const st = document.createElement('style'); st.id = 'taxinv-css';
    st.textContent = '.ti{background:#fff;color:#111;font:13px/1.35 Arial,Helvetica,sans-serif;border:1px solid #222;width:100%;max-width:820px;margin:0 auto;position:relative;-webkit-print-color-adjust:exact;print-color-adjust:exact}' +
      '.ti *{box-sizing:border-box}.ti .cp{position:absolute;right:10px;top:4px;font-style:italic;font-size:12px}' +
      '.ti .hd{display:flex;gap:12px;align-items:center;padding:6px;border-bottom:1px solid #222;min-height:112px}.ti .hd .lg{width:118px;flex:none}.ti .hd .lg img{width:118px;height:auto;display:block;background:#000}' +
      '.ti .hd .ct{flex:1;text-align:center}.ti .ttl{font-weight:700;font-size:17px;text-decoration:underline;letter-spacing:.2px}.ti .nm{font-weight:700;font-size:28px;line-height:1.1;margin:2px 0}' +
      '.ti .gs{font-weight:700;font-size:15px}.ti .ct i{font-size:12px}' +
      '.ti .g2{display:grid;grid-template-columns:1fr 1fr;border-bottom:1px solid #222}.ti .g2>div{padding:6px 8px}.ti .g2>div+div{border-left:1px solid #222}' +
      '.ti .kv{display:grid;grid-template-columns:118px 12px 1fr;gap:0 2px;margin:1px 0}.ti .big{font-size:15px}.ti .bt{font-weight:700;font-style:italic}.ti .mu{min-height:62px}' +
      '.ti table.it{width:100%;border-collapse:collapse;table-layout:fixed}.ti table.it th{border-bottom:1px solid #222;border-right:1px solid #222;padding:6px 6px;font-size:12px}.ti table.it th:last-child,.ti table.it td:last-child{border-right:0}' +
      '.ti table.it td{border-right:1px solid #222;padding:6px 6px;vertical-align:top;font-size:13px;word-wrap:break-word}.ti .r{text-align:right}.ti .bodyrow td{height:330px}.ti .itm td{height:auto}' +
      '.ti .sum{display:grid;grid-template-columns:1fr 150px;border-top:1px solid #222}.ti .sum .l{text-align:center;font-style:italic;display:flex;align-items:center;justify-content:flex-end;padding-right:60px}.ti .sum .rr{border-left:1px solid #222}.ti .sum .rr div{padding:2px 8px;text-align:right}' +
      '.ti .gt{display:grid;grid-template-columns:1fr 150px;border-top:1px solid #222;font-weight:700;font-size:13px}.ti .gt .a{display:flex;justify-content:center;gap:34px;align-items:center;padding:6px}.ti .gt .b{border-left:1px solid #222;padding:6px 8px;display:flex;justify-content:space-between}' +
      '.ti .tx{padding:8px 10px;border-top:1px solid #222}.ti .tx table{border-collapse:collapse;font-size:12px}.ti .tx th{font-size:11px;text-align:right;padding:2px 10px 2px 0;border-bottom:1px solid #444}.ti .tx th:first-child,.ti .tx td:first-child{text-align:left}.ti .tx td{padding:2px 10px 2px 0;text-align:right}' +
      '.ti .wd{padding:8px 10px;font-weight:700;font-size:15px;border-top:1px solid #222}.ti .bk{padding:8px 10px;border-top:1px solid #222;font-size:14px}.ti .bk b{font-size:14px}' +
      '.ti .ft{display:grid;grid-template-columns:1fr 1fr;border-top:1px solid #222}.ti .ft>div{padding:6px 8px}.ti .ft .tc{font-size:12px}.ti .ft .tc b{text-decoration:underline;font-size:11px}.ti .ft .tc p{margin:2px 0}' +
      '.ti .ft .sg{border-left:1px solid #222;display:grid;grid-template-rows:auto 1fr}.ti .ft .sg .rc{font-weight:700;font-size:12px;padding-bottom:26px;border-bottom:1px solid #222}.ti .ft .sg .au{text-align:right;font-weight:700;padding-top:8px;display:flex;flex-direction:column;justify-content:space-between;min-height:84px}.ti .ft .sg img{max-height:48px;max-width:150px;align-self:flex-end}' +
      '@media (max-width:620px){.ti{font-size:11px}.ti .nm{font-size:20px}.ti .hd .lg,.ti .hd .lg img{width:76px}.ti .hd{min-height:80px}.ti .kv{grid-template-columns:90px 8px 1fr}.ti .bodyrow td{height:200px}.ti table.it th,.ti table.it td{padding:4px 3px;font-size:11px}.ti .big{font-size:12px}.ti .sum,.ti .gt{grid-template-columns:1fr 104px}.ti .sum .l{padding-right:8px}.ti .gt .a{gap:12px}.ti .wd{font-size:12px}}' +
      '@media print{.ti{border-color:#000;max-width:none}}';
    document.head.appendChild(st);
  }
  function el(tag, props) {
    const e = document.createElement(tag);
    for (const k in props || {}) { if (k === 'class') e.className = props[k]; else if (k === 'style') e.setAttribute('style', props[k]); else e.setAttribute(k, props[k]); }
    for (let i = 2; i < arguments.length; i++) [].concat(arguments[i]).flat(Infinity).forEach((c) => { if (c != null && c !== false) e.append(c instanceof Node ? c : document.createTextNode(String(c))); });
    return e;
  }
  const kv = (k, v, cls) => el('div', { class: 'kv' + (cls ? ' ' + cls : '') }, el('span', null, k), el('span', null, ':'), el('span', null, v));

  /** data = { org, doc, lines } as returned by public_acc_document (the app builds the same shape for printing). Lines may carry mrp. */
  function build(data, opts) {
    css(); opts = opts || {};
    const o = data.org || {}, d = data.doc || {}, b = o.brand || {}, k = b.bank || {}, lines = data.lines || [];
    const adr = [o.address, [o.city, o.pincode].filter(Boolean).join(' ')].filter(Boolean).join(', ');
    const title = { invoice: 'TAX INVOICE', credit_note: 'CREDIT NOTE', quotation: 'QUOTATION', sales_order: 'SALES ORDER', delivery_challan: 'DELIVERY CHALLAN' }[d.type] || 'TAX INVOICE';
    const gross = lines.reduce((s, l) => s + n(l.qty) * n(l.rate), 0), disc = n(d.discount) || lines.reduce((s, l) => s + n(l.disc_amt), 0);
    const intra = n(d.igst) === 0, qtySum = lines.reduce((s, l) => s + n(l.qty), 0);
    // tax summary grouped by rate (CGST/SGST are half the tax each for an in-state sale)
    const groups = {}; lines.forEach((l) => { const r = n(l.tax_rate), g = groups[r] || (groups[r] = { rate: r, taxable: 0, tax: 0 }); g.taxable += n(l.taxable); g.tax += n(l.tax != null ? l.tax : n(l.total) - n(l.taxable)); });
    const rows = Object.values(groups).sort((a, c) => a.rate - c.rate);
    const addRows = [];
    if (n(d.cgst)) addRows.push(['Add : CGST', d.cgst]); if (n(d.sgst)) addRows.push(['Add : SGST', d.sgst]); if (n(d.igst)) addRows.push(['Add : IGST', d.igst]); if (n(d.cess)) addRows.push(['Add : Cess', d.cess]); if (n(d.roundoff)) addRows.push(['Round off', d.roundoff]);
    const phone = d.party_phone || '', billTo = !d.party_name || /^walk[- ]?in/i.test(d.party_name) ? 'Cash' : d.party_name;
    const blk = (label) => el('div', null, el('div', { class: 'bt' }, label + ' :'), el('div', { class: 'mu' }, billTo, d.billing_address ? el('div', null, d.billing_address) : null), kv('Party Mobile No', phone), kv('GSTIN / UIN', d.party_gstin || ''));
    const terms = String(d.terms || o.terms || b.terms || '').split('\n').map((x) => x.trim()).filter(Boolean);
    const bankLine = k.name || k.account || k.ifsc ? [k.name ? el('b', null, k.name) : null, k.account ? ' : Account Number:' + k.account : null] : null;
    const sheet = el('div', { class: 'ti' },
      opts.copy === false ? null : el('div', { class: 'cp' }, opts.copy || 'Original Copy'),
      el('div', { class: 'hd' }, b.logo ? el('div', { class: 'lg' }, el('img', { src: b.logo, alt: '' })) : null,
        el('div', { class: 'ct' }, el('div', { class: 'ttl' }, title), el('div', { class: 'nm' }, o.name || o.legal_name || ''), el('div', null, adr), o.gstin ? el('div', { class: 'gs' }, 'GSTIN : ' + o.gstin) : null,
          (o.phone || o.email) ? el('i', null, [o.phone ? 'Tel. : ' + o.phone : '', o.email ? 'email : ' + o.email : ''].filter(Boolean).join('    ')) : null)),
      el('div', { class: 'g2' }, el('div', { class: 'big' }, kv('Invoice No.', d.number || ''), kv('Dated', fdate(d.date))), el('div', { class: 'big' }, kv('Place of Supply', stateText(d.place_of_supply || o.state_code)), kv('Reverse Charge', d.reverse_charge ? 'Y' : 'N'))),
      el('div', { class: 'g2' }, blk('Billed to'), blk('Shipped to')),
      el('table', { class: 'it' }, el('colgroup', null, ['6%', '', '14%', '9%', '11%', '12%', '15%'].map((w) => el('col', w ? { style: 'width:' + w } : null))),
        el('thead', null, el('tr', null, ['S.N.', 'Description of Goods', 'HSN/SAC Cod', 'Qty.', 'MRP', 'Price', 'Amount(₹)'].map((x, i) => el('th', { class: i > 2 ? 'r' : (i === 1 ? '' : '') , style: i === 1 ? 'text-align:left' : '' }, x)))),
        el('tbody', null, lines.map((l, i) => el('tr', { class: 'itm' }, [(l.n || i + 1) + '.', l.description || '', l.hsn || '', q3.format(n(l.qty)), n(l.mrp) ? nf.format(n(l.mrp)) : '', nf.format(n(l.rate)), nf.format(n(l.qty) * n(l.rate))].map((x, j) => el('td', { class: j > 2 ? 'r' : (j === 0 ? 'r' : '') }, x)))),
          el('tr', { class: 'bodyrow' }, [0, 1, 2, 3, 4, 5, 6].map(() => el('td', null))))),
      el('div', { class: 'sum' }, el('div', { class: 'l' }, 'Less : Discount'), el('div', { class: 'rr' }, el('div', { style: 'font-weight:700' }, nf.format(gross)), el('div', null, nf.format(disc)), addRows.map(([a, v]) => el('div', null, el('span', { style: 'float:left;font-style:italic;font-size:11px' }, a), nf.format(n(v)))))),
      el('div', { class: 'gt' }, el('div', { class: 'a' }, el('span', null, 'Grand Total'), el('span', null, nf.format(qtySum))), el('div', { class: 'b' }, el('span', null, '₹'), el('span', null, nf.format(n(d.total))))),
      el('div', { class: 'tx' }, el('table', null, el('thead', null, el('tr', null, ['Tax Rate', 'Taxable Amt.', intra ? 'CGST Amt.' : 'IGST Amt.', intra ? 'SGST Amt.' : '', 'Total Tax'].filter((x, i) => x || i !== 3).map((x) => el('th', null, x)))),
        el('tbody', null, rows.map((g) => el('tr', null, [g.rate ? g.rate + '%' : 'Exempt', nf.format(g.taxable), ...(intra ? [g.tax ? nf.format(g.tax / 2) : '--', g.tax ? nf.format(g.tax / 2) : '--'] : [g.tax ? nf.format(g.tax) : '--']), nf.format(g.tax)].map((x) => el('td', null, x))))))),
      el('div', { class: 'wd' }, inWords(n(d.total))),
      (bankLine || o.bank_details) ? el('div', { class: 'bk' }, el('b', null, 'Bank Details: '), bankLine ? [bankLine, k.ifsc ? el('div', { style: 'margin-left:98px' }, 'IFSC : ' + k.ifsc) : null] : o.bank_details) : null,
      el('div', { class: 'ft' }, el('div', { class: 'tc' }, el('b', null, 'Terms & Conditions'), terms.length ? terms.map((t) => el('p', null, t)) : null),
        el('div', { class: 'sg' }, el('div', { class: 'rc' }, "Receiver's Signature :"), el('div', { class: 'au' }, el('span', null, 'For ' + (o.name || o.legal_name || '')), b.signature ? el('img', { src: b.signature, alt: '' }) : null, el('span', null, 'Authorised Signatory')))),
      d.cancelled ? el('div', { style: 'text-align:center;color:#b00;font-weight:700;padding:6px;border-top:1px solid #222' }, 'CANCELLED') : null);
    return sheet;
  }
  const api = { build, inWords, stateText };
  root.auzTaxInvoice = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
