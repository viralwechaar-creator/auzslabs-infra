/* Public bill for a short AUZsStyle link: https://<shop>.auzslab.in/b/<token> (or /stybill.html?t=<token>).
   public_sty_sale answers only for the unguessable token and never returns staff, cost or the customer's phone. Built with textContent only. */
'use strict';
(async () => {
  const app = document.getElementById('app');
  const el = (tag, cls, ...kids) => { const e = document.createElement(tag); if (cls) e.className = cls; kids.flat().forEach((k) => { if (k != null && k !== false) e.append(k.nodeType ? k : document.createTextNode(String(k))); }); return e; };
  const inr = (n) => '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
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
  const row = (a, b, cls) => el('div', cls, el('span', null, a), el('span', null, b));
  const logo = sh.logoUrl ? (() => { const i = el('img'); i.src = sh.logoUrl; i.alt = ''; return i; })() : null;
  const bill = el('div', 'bill',
    el('div', 'hd', logo, el('h1', null, sh.name), sh.address ? el('div', null, sh.address) : null, sh.phone ? el('div', null, sh.phone) : null, sh.gstin ? el('div', null, 'GSTIN ' + sh.gstin) : null),
    (s.status === 'void' || s.status === 'cancelled') ? el('div', null, el('span', 'tag', 'Cancelled bill')) : null,
    el('div', 'meta', el('span', null, 'Bill ', el('b', null, s.number)), el('span', null, d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }))),
    s.customerName ? el('div', 'meta', el('span', null, 'Billed to ', el('b', null, s.customerName))) : null,
    ...(s.lines || []).map((l) => el('div', 'ln', el('div', null, l.name, el('small', null, [l.colour, l.size].filter(Boolean).join(' · ') + ((l.colour || l.size) ? ' · ' : '') + l.qty + ' × ' + inr(l.price))), el('div', 'a', inr(l.net)))),
    el('div', 'sum',
      row('Subtotal', inr(s.subtotal)), s.discount > 0 ? row('Discount', '-' + inr(s.discount)) : null,
      s.tax > 0 ? row('Includes tax', inr(s.tax)) : null, s.rounding ? row('Round off', inr(s.rounding)) : null,
      row('Total', inr(s.total), 't'),
      ...(s.payments || []).map((p) => row('Paid by ' + String(p.mode).toLowerCase(), inr(p.amount))),
      s.balance > 0 ? row('Balance due', inr(s.balance), 'due') : null),
    el('div', 'ft', sh.returnDays ? 'Exchange or return within ' + sh.returnDays + ' days with this bill.' : null, sh.returnDays ? el('br') : null, sh.footer || 'Thank you for shopping with us.'));
  app.append(bill, el('div', 'bar', (() => { const b = el('button', null, 'Print or save as PDF'); b.onclick = () => window.print(); return b; })()));
})();
