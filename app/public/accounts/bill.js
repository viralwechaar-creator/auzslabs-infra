/* Public invoice view for a share link: /bill.html?t=<token>. Reads one document through public_acc_document (the unguessable token is the only access). */
'use strict';
(async () => {
  const app = document.getElementById('app');
  const el = (t, a, ...k) => { const e = document.createElement(t); for (const x in a || {}) { if (x === 'class') e.className = a[x]; else if (x === 'onclick') e.onclick = a[x]; else e.setAttribute(x, a[x]); } k.flat().forEach((c) => c != null && e.append(c instanceof Node ? c : document.createTextNode(String(c)))); return e; };
  const nf = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }), q3 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 3 });
  const fd = (s) => (s ? new Date(String(s).slice(0, 10) + 'T12:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
  const LABEL = { invoice: 'Tax invoice', credit_note: 'Credit note', quotation: 'Quotation', sales_order: 'Sales order', delivery_challan: 'Delivery challan' };
  const token = new URLSearchParams(location.search).get('t');
  let data = null;
  try {
    const res = await fetch(window.CFG.url.replace(/\/$/, '') + '/rpc/public_acc_document', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ p_token: token }) });
    data = (await res.json()).data;
  } catch { /* offline */ }
  app.replaceChildren();
  if (!data) { app.append(el('h1', null, 'This link is not valid'), el('p', { class: 'muted' }, 'The invoice may have been withdrawn, or the link is incomplete. Ask the sender for a new one.')); return; }
  const o = data.org, d = data.doc, adr = [o.address, [o.city, o.pincode].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  document.title = (LABEL[d.type] || 'Document') + ' ' + d.number + ' · ' + (o.name || '');
  if ((o.brand || {}).invoiceStyle === 'classic' && window.auzTaxInvoice) { app.classList.add('classic'); app.append(auzTaxInvoice.build(data), el('div', { class: 'bar' }, el('button', { class: 'btn fill', style: 'background:#111;color:#fff;border:0;border-radius:10px;padding:10px 18px;font:600 14px Arial,sans-serif;cursor:pointer', onclick: () => window.print() }, 'Print or save as PDF'))); return; }
  const b = o.brand || {}, k = b.bank || {}, bl = [k.holder && ['Account name', k.holder], k.name && ['Bank', k.name], k.account && ['Account no.', k.account], k.ifsc && ['IFSC', k.ifsc], k.branch && ['Branch', k.branch]].filter(Boolean);
  let qrSrc = null;
  if (b.upi && d.type === 'invoice' && !d.cancelled && typeof qrcode === 'function') { try { const due = Number(d.total) - Number(d.paid || 0); const q = qrcode(0, 'M'); q.addData('upi://pay?pa=' + encodeURIComponent(b.upi) + '&pn=' + encodeURIComponent(o.name || '') + (due > 0 ? '&am=' + due.toFixed(2) : '') + '&cu=INR&tn=' + encodeURIComponent(d.number || '')); q.make(); qrSrc = q.createDataURL(4, 0); } catch { /* no QR */ } }
  const identity = (bl.length || b.upi || b.signature || b.stamp || o.bank_details) ? el('div', { style: 'display:flex;justify-content:space-between;gap:16px;align-items:flex-end;margin:10px 0' },
    el('div', null, bl.length ? el('div', null, el('b', null, 'Bank details'), bl.map(([a, v]) => el('div', null, a + ': ' + v))) : (o.bank_details ? el('p', null, el('b', null, 'Bank details: '), o.bank_details) : null), b.upi ? el('div', null, 'UPI: ' + b.upi) : null, qrSrc ? el('img', { src: qrSrc, alt: 'UPI QR', style: 'width:96px;height:96px;margin-top:6px;display:block' }) : null),
    (b.signature || b.stamp) ? el('div', { style: 'text-align:right' }, el('div', { style: 'display:flex;gap:12px;justify-content:flex-end;align-items:flex-end' }, b.stamp ? el('img', { src: b.stamp, alt: '', style: 'max-height:80px;max-width:110px' }) : null, b.signature ? el('img', { src: b.signature, alt: '', style: 'max-height:60px;max-width:150px' }) : null), el('div', { class: 'cap' }, 'Authorised signatory for ' + (o.name || o.legal_name))) : null) : null;
  const head = ['#', 'Item', 'HSN/SAC', 'Qty', 'Rate', 'GST', 'Taxable', 'Amount'];
  const tot = [['Taxable value', d.taxable], +d.cgst ? ['CGST', d.cgst] : null, +d.sgst ? ['SGST', d.sgst] : null, +d.igst ? ['IGST', d.igst] : null, +d.cess ? ['Cess', d.cess] : null, +d.roundoff ? ['Round off', d.roundoff] : null].filter(Boolean);
  app.append(
    el('div', { class: 'row2' }, el('div', null, b.logo ? el('img', { src: b.logo, alt: '', style: 'max-height:56px;max-width:200px;display:block;margin-bottom:6px' }) : null, el('h1', null, o.name || o.legal_name), el('div', null, adr), o.gstin ? el('div', null, 'GSTIN ' + o.gstin) : null, (b.regs || []).map((r) => el('div', null, r.k + ' ' + r.v)), o.phone ? el('div', null, o.phone) : null, b.website ? el('div', null, b.website) : null),
      el('div', { style: 'text-align:right' }, el('h1', null, (LABEL[d.type] || 'Document').toUpperCase()), el('div', null, d.number), el('div', null, 'Date ' + fd(d.date)), d.due_date ? el('div', null, 'Due ' + fd(d.due_date)) : null, d.cancelled ? el('b', { style: 'color:var(--red)' }, 'CANCELLED') : el('span', { class: 'badge ' + (d.status === 'paid' ? 'green' : d.status === 'overdue' ? 'red' : '') }, d.status))),
    el('hr', { class: 'sep' }),
    el('div', { class: 'row2' }, el('div', null, el('b', null, 'Bill to'), el('div', null, d.party_name || 'Customer'), d.party_gstin ? el('div', null, 'GSTIN ' + d.party_gstin) : null, d.billing_address ? el('div', null, d.billing_address) : null), el('div', { style: 'text-align:right' }, d.place_of_supply ? el('div', null, 'Place of supply: ' + d.place_of_supply) : null, d.reverse_charge ? el('div', null, 'Reverse charge applies') : null)),
    el('div', { style: 'overflow:auto' }, el('table', null, el('thead', null, el('tr', null, head.map((x, i) => el('th', { class: i > 2 ? 'r' : '' }, x)))), el('tbody', null, data.lines.map((l) => el('tr', null, [l.n, l.description, l.hsn || '', q3.format(l.qty) + ' ' + (l.unit || ''), nf.format(l.rate), l.tax_rate + '%', nf.format(l.taxable), nf.format(l.total)].map((x, i) => el('td', { class: i > 2 ? 'r' : '' }, x)))))) ),
    el('div', { style: 'display:flex;justify-content:flex-end' }, el('table', { style: 'width:280px' }, el('tbody', null, tot.map(([a, b]) => el('tr', null, el('td', null, a), el('td', { class: 'r' }, nf.format(b)))),
      el('tr', null, el('td', null, el('b', null, 'Total')), el('td', { class: 'r' }, el('b', null, '₹' + nf.format(d.total)))), +d.paid ? el('tr', null, el('td', null, 'Received'), el('td', { class: 'r' }, nf.format(d.paid))) : null, +d.paid ? el('tr', null, el('td', null, el('b', null, 'Balance due')), el('td', { class: 'r' }, el('b', null, nf.format(d.total - d.paid)))) : null))),
    d.notes ? el('p', null, el('b', null, 'Notes: '), d.notes) : null, identity, d.terms ? el('p', { class: 'cap' }, d.terms) : null,
    data.einvoice && data.einvoice.irn ? el('p', { class: 'cap', style: 'word-break:break-all' }, 'IRN: ' + data.einvoice.irn) : null, o.footer ? el('p', { style: 'text-align:center' }, o.footer) : null,
    el('div', { class: 'bar' }, el('button', { class: 'btn fill', onclick: () => window.print() }, 'Print or save as PDF')));
})();
