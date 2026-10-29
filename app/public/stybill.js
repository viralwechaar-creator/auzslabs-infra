/* Public bill for a short AUZsStyle link: https://<shop>.auzslab.in/b/<token> (or /stybill.html?t=<token>).
   public_sty_sale answers only for the unguessable token and never returns staff, cost or the customer's phone.
   A plain white tax invoice built from the shop's own saved details (name, logo, address, phone, GSTIN, UPI). textContent only. */
'use strict';
(async () => {
  const app = document.getElementById('app');
  const el = (tag, cls, ...kids) => { const e = document.createElement(tag); if (cls) e.className = cls; kids.flat().forEach((k) => { if (k != null && k !== false) e.append(k.nodeType ? k : document.createTextNode(String(k))); }); return e; };
  const inr = (n) => '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const m = location.pathname.match(/\/b\/([a-z0-9]+)\/?$/i);
  const token = (m && m[1]) || new URLSearchParams(location.search).get('t') || '';
  let data = null;
  try {
    const res = await fetch(window.CFG.url.replace(/\/$/, '') + '/rpc/public_sty_sale', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ p_token: token }) });
    data = (await res.json()).data;
  } catch { /* offline */ }
  app.replaceChildren();
  if (!data || !data.sale) { app.append(el('div', 'msg', el('h1', null, 'This link is not valid'), el('p', null, 'The bill may have been removed, or the link is incomplete. Please ask the shop for a new link.'))); return; }
  const sh = data.shop, s = data.sale, d = new Date(s.at);
  document.title = 'Bill ' + s.number + ' · ' + sh.name;
  const dt = d.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const lines = s.lines || [], anyDisc = lines.some((l) => Number(l.disc) > 0), anyHsn = lines.some((l) => l.hsn);
  const row = (a, b, cls) => el('div', 'tr' + (cls ? ' ' + cls : ''), el('span', null, a), el('span', null, b));
  const cancelled = s.status === 'void' || s.status === 'cancelled';
  const due = Number(s.balance) > 0;
  const gst = !!sh.gstin, stateCode = gst ? String(sh.gstin).slice(0, 2) : '';
  const head = ['#', 'Item'].concat(anyHsn ? ['HSN'] : [], ['Qty', 'Rate'], anyDisc ? ['Disc'] : [], gst ? ['GST'] : [], ['Amount']);
  const body = lines.map((l, i) => el('tr', null,
    el('td', null, i + 1),
    el('td', null, l.name, el('small', null, [l.colour, l.size].filter(Boolean).join(' · '))),
    anyHsn ? el('td', null, l.hsn || '') : null,
    el('td', null, l.qty), el('td', null, inr(l.price)),
    anyDisc ? el('td', null, Number(l.disc) > 0 ? inr(l.disc) : '') : null,
    gst ? el('td', null, (l.taxPct != null ? Number(l.taxPct) : 0) + '%') : null,
    el('td', null, inr(l.net))));
  // prices include tax: the shop's tax is shown split half and half (CGST + SGST)
  const half = Number(s.tax || 0) / 2;
  let pay = null;
  if (due && sh.upiId) {
    const qrBox = el('div', 'qr');
    try { const q = qrcode(0, 'M'); q.addData('upi://pay?pa=' + encodeURIComponent(sh.upiId) + '&pn=' + encodeURIComponent(sh.upiName || sh.name) + '&am=' + Number(s.balance).toFixed(2) + '&cu=INR&tn=' + encodeURIComponent('Bill ' + s.number)); q.make(); qrBox.innerHTML = q.createImgTag(4, 0); } catch { /* no QR */ }
    pay = el('div', 'pay', qrBox, el('div', null, el('b', null, 'Pay ' + inr(s.balance) + ' on UPI'), el('div', 'muted', 'Scan with any UPI app'), el('div', 'muted', sh.upiId)));
  }
  const sheet = el('div', 'sheet',
    el('div', 'top',
      el('div', 'shop', sh.logoUrl ? el('img') : null, el('div', null, el('h1', null, sh.name), sh.address ? el('div', null, sh.address) : null, sh.phone ? el('div', null, 'Phone: ' + sh.phone) : null, gst ? el('div', null, 'GSTIN: ' + sh.gstin) : null)),
      el('div', 'doc', el('b', null, gst ? 'TAX INVOICE' : 'INVOICE'), el('span', null, 'No. ' + s.number), el('span', null, dt), cancelled ? el('span', 'tag', 'CANCELLED') : null)),
    el('div', 'info', el('div', null, el('small', null, 'Billed to'), s.customerName || 'Walk-in customer'), gst ? el('div', null, el('small', null, 'Place of supply'), 'State code ' + stateCode) : null),
    el('table', null, el('thead', null, el('tr', null, head.map((x) => el('th', null, x)))), el('tbody', null, body)),
    el('div', 'sum',
      el('div', null, pay, (s.payments || []).length ? el('div', 'muted', 'Paid by ' + s.payments.map((p) => String(p.mode).toUpperCase() + ' ' + inr(p.amount)).join(', ')) : null),
      el('div', null,
        row('Subtotal', inr(s.subtotal)), s.discount > 0 ? row('Discount', '-' + inr(s.discount)) : null,
        s.tax > 0 && gst ? row('CGST (incl.)', inr(half)) : null, s.tax > 0 && gst ? row('SGST (incl.)', inr(half)) : null,
        s.tax > 0 && !gst ? row('Tax (incl.)', inr(s.tax)) : null,
        s.rounding ? row('Round off', inr(s.rounding)) : null,
        row('Total', inr(s.total), 'big'),
        due ? row('Balance due', inr(s.balance), 'due') : row('Paid in full', inr(s.total), 'ok'))),
    el('div', 'terms', sh.returnDays ? 'Exchange or return within ' + sh.returnDays + ' days of purchase with this bill, tags intact.' : 'Please keep this bill for any exchange or return.'),
    el('div', 'foot', sh.footer || 'Thank you, visit again'));
  if (sh.logoUrl) { const im = sheet.querySelector('.shop img'); im.alt = ''; im.src = sh.logoUrl; im.onerror = () => im.remove(); }
  const printBtn = el('button', null, 'Print or save as PDF'); printBtn.onclick = () => window.print();
  app.append(sheet, el('div', 'bar', printBtn));
})();
