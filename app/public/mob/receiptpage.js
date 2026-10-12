/* Public receipt view for a share link: /mobbill.html?t=<token>. Reads one sale through public_mob_sale
   (the unguessable token is the only access) and renders it with the shop's chosen receipt template.
   Mirrors accounts/bill.js's own shape for the same purpose. */
'use strict';
(async () => {
  const app = document.getElementById('app');
  const el = (t, a, ...k) => { const e = document.createElement(t); for (const x in a || {}) { if (x === 'class') e.className = a[x]; else if (x === 'onclick') e.onclick = a[x]; else e.setAttribute(x, a[x]); } k.flat().forEach((c) => c != null && e.append(c instanceof Node ? c : document.createTextNode(String(c)))); return e; };
  const q = new URLSearchParams(location.search);
  const token = q.get('t');
  let data = null;
  // ?sample=1&style=modern&shop=Name : a made-up bill in a chosen template, so an owner can see a style before choosing it. No shop data is read.
  if (q.get('sample') === '1') {
    data = { shop: { name: (q.get('shop') || 'My Mobile Shop').slice(0, 60), address: '123 Market Road', phone: '98765 43210', footer: 'Thank you!', receiptStyle: q.get('style') || '' },
      sale: { billNo: 'BILL-1024', date: new Date().toISOString(), items: [{ name: 'iPhone 13 (128GB)', qty: 1, price: 38999 }, { name: 'Tempered Glass', qty: 2, price: 299 }, { name: 'Screen repair', qty: 1, price: 800 }],
        subtotal: 40397, discount: 100, total: 40297, paid: 40297, balance: 0, paymentMode: 'upi', customerName: 'Rahul Sharma', customerPhone: '98765 12345', voided: false } };
  }
  if (!data) try {
    const res = await fetch(window.CFG.url.replace(/\/$/, '') + '/rpc/public_mob_sale', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ p_token: token }) });
    data = (await res.json()).data;
  } catch { /* offline */ }
  app.replaceChildren();
  if (!data) {
    app.append(el('div', { style: 'text-align:center' },
      el('h1', { style: 'font-size:20px' }, 'This link is not valid'),
      el('p', { class: 'msg' }, 'The receipt may have been withdrawn, or the link is incomplete. Ask the shop for a new one.')));
    return;
  }
  document.title = 'Receipt ' + (data.sale.billNo || '') + ' · ' + (data.shop.name || '');
  const style = data.shop.receiptStyle || 'thermal';  // '' = the automatic default
  const build = (window.auzMobReceiptTemplates && auzMobReceiptTemplates[style]) || (window.auzMobReceiptTemplates && auzMobReceiptTemplates.thermal);
  const node = build ? build(data) : el('p', { class: 'msg' }, 'Could not render this receipt.');
  const printBtn = el('div', { class: 'bar' }, el('button', { onclick: () => window.print() }, 'Print or save as PDF'));
  app.append(node, printBtn);
})();
