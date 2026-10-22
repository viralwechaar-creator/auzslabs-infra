/* Public bill for a short AUZsStyle link: https://<shop>.auzslab.in/b/<token> (or /stybill.html?t=<token>).
   public_sty_sale answers only for the unguessable token and never returns staff, cost or the customer's phone. Built with textContent only.
   Design: black sheet, bracketed shop name, big INVOICE, hairlines, payment block with a QR to this page (like the studio invoice reference). */
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
  const dt = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const lines = s.lines || []; const anyDisc = lines.some((l) => Number(l.disc) > 0);
  const row = (a, b, cls) => el('div', 'tr' + (cls ? ' ' + cls : ''), el('span', null, a), el('span', null, b));
  const cancelled = s.status === 'void' || s.status === 'cancelled';
  const due = Number(s.balance) > 0;
  const qrBox = el('div', 'qr');
  try { const q = qrcode(0, 'M'); q.addData(location.href); q.make(); qrBox.innerHTML = q.createImgTag(4, 0); } catch { /* no QR */ }
  const sheet = el('div', 'sheet' + (anyDisc ? '' : ' nodisc'),
    el('h1', 'brand', '[' + sh.name + ']'),
    el('div', 'meta', el('div', 'm', '[' + dt + ']', el('br'), '[' + (s.customerName || 'Walk-in') + ']'), el('div', 'm', '[' + s.number + ']', el('br'), '[' + (sh.phone || sh.name) + ']'), el('h2', 'h1', 'INVOICE')),
    cancelled ? el('div', null, el('span', 'tag', 'CANCELLED BILL')) : null,
    el('hr'),
    el('div', 'th', el('div', null, 'ITEMS'), el('div', 'r', 'QTY'), el('div', 'r', 'PRICE'), el('div', 'r', 'DISCOUNT'), el('div', 'r', 'TOTAL')),
    ...lines.map((l) => el('div', 'ln', el('div', null, l.name, el('small', null, [l.colour, l.size].filter(Boolean).join(' · '))), el('div', 'r', l.qty), el('div', 'r', inr(l.price)), el('div', 'r', inr(l.disc || 0)), el('div', 'r', inr(l.net)))),
    el('div', 'tots',
      row('SUB TOTAL:', inr(s.subtotal)), s.discount > 0 ? row('DISCOUNT:', '-' + inr(s.discount)) : null,
      s.tax > 0 ? row('TAX (INCLUDED):', inr(s.tax)) : null, s.rounding ? row('ROUND OFF:', inr(s.rounding)) : null,
      row('TOTAL:', inr(s.total), 'big'),
      row('BALANCE DUE (INR) :', inr(s.balance), 'sp')),
    el('div', 'pay',
      el('div', null, el('h2', null, 'PAYMENT'), el('span', 'ref', '[BILL NO. ' + s.number + ']'),
        el('div', 'info', ...(s.payments || []).map((p) => el('div', null, '[' + String(p.mode).toUpperCase() + ': ' + inr(p.amount) + ']')), el('div', null, due ? '[BALANCE DUE ' + inr(s.balance) + ']' : '[PAID IN FULL]')),
        qrBox, el('div', 'scan', 'SCAN QR TO', el('br'), 'VIEW THIS BILL')),
      el('div', 'terms', el('b', null, 'TERMS & CONDITIONS:'), el('br'), sh.returnDays ? '1. Exchange or return within ' + sh.returnDays + ' days of purchase with this bill, tags intact.' : '1. Please keep this bill for any exchange or return.', el('br'), '2. ' + (sh.footer || 'Thank you for shopping with us.'))),
    el('div', 'foot', el('div', null, '[' + sh.name + ']'), el('div', null, sh.address || ''), el('div', null, sh.gstin ? '[GSTIN: ' + sh.gstin + ']' : ''), el('div', null, sh.phone ? '[' + sh.phone + ']' : '')));
  const printBtn = el('button', null, 'Print or save as PDF'); printBtn.onclick = () => window.print();
  app.append(sheet, el('div', 'bar', printBtn));
})();
