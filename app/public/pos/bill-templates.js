/* A gallery of visual designs for the POS's own bill/receipt (the in-POS print and the public app/public/i.html share
   link) -- the POS's version of accounts/invoice-templates.js. This is a bill/receipt, not a GST tax invoice: no
   place-of-supply/reverse-charge block, no HSN column by default, no "amount in words" -- the shape CLAUDE.md's
   "Restaurant POS rebuild" section describes (business name/logo, date, itemised lines with qty/price/amount, a tax
   breakup when there is one, total, payment mode, a thank-you footer). Sits alongside the existing default design in
   pos/print.js (rcpt()/escReceipt()) and app/public/i.html's generic brand-driven render -- neither is replaced; a
   template here is picked per business with settings.billStyle (Admin console -> Management -> Configuration ->
   "Look & invoice"), read as cfg().billStyle in the POS and as cfg.billStyle (the settings record `public_invoice`
   already returns in full) on the public page. Deliberately NOT the same five names/looks as AUZsLedger's invoice
   gallery (classic/noir/playful/bold/minimal/stamped) -- this is the POS's own set, suited to a bill, not an A4
   invoice.

   Self-contained on purpose (an IIFE, no top-level const/let): app/public/i.html does not load pos/core.js, so this
   file never reads cfg()/tot()/esc()/inr()/fmtDate()/tn() -- the caller (pos/print.js or i.html) passes a plain
   order object (o.t must already be the computed tot() result -- both callers already have this) and a plain
   settings-like object. This also avoids the classic-script "separate <script> tags share one top-level lexical
   scope" trap: a bare `const esc = ...` here would collide with pos/core.js's own `const esc` and throw on load.

   Bordered tables follow the same iPhone-safety rules CLAUDE.md documents for the AUZsLedger gallery (border-
   collapse:separate + border-spacing:0, never border-collapse; a --bw line-width variable; white-space:nowrap on
   number cells) -- the "ruled" template is the one that actually uses a bordered table. */
(function (root) {
  'use strict';
  const nn = (x) => { const v = Number(x); return isNaN(v) ? 0 : v; };
  const r2 = (n) => Math.round(nn(n) * 100) / 100;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const inr = (n) => (n < 0 ? '−₹' : '₹') + Math.abs(r2(n)).toLocaleString('en-IN', { maximumFractionDigits: 2 });
  const fdate = (d) => { const t = new Date(d); return isNaN(t) ? '' : t.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }); };
  const ftime = (d) => { const t = new Date(d); return isNaN(t) ? '' : t.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }); };
  const PAY_LABEL = { cash: 'Cash', upi: 'UPI', card: 'Card', giftcard: 'Gift card', other: 'Other', wallet: 'Wallet' };
  const refundedOf = (o) => r2((o.refunds || []).reduce((a, r) => a + nn(r.amt), 0));

  /** GST rows: per rate when the bill carries a breakup, else an old-style equal CGST/SGST split. Same rule as print.js's gstRows(). */
  function gstRows(t) {
    const rates = t.rates ? Object.entries(t.rates).filter(([r, x]) => +r > 0 && x.tax > 0) : null;
    if (!rates) return t.tax ? [['CGST', r2(t.tax / 2)], ['SGST', r2(t.tax / 2)]] : [];
    return rates.flatMap(([r, x]) => [['CGST ' + (+r / 2) + '%', r2(x.tax / 2)], ['SGST ' + (+r / 2) + '%', r2(x.tax / 2)]]);
  }

  /** Everything every template needs, computed once from the order + settings. `opts.tableLabel` is the already-
   *  resolved table/section name (the caller knows how to look it up; this file never does -- see header note). */
  function computeBill(o, c, opts) {
    opts = opts || {}; c = c || {};
    const t = o.t || { sub: 0, tax: 0, total: 0, rates: {} };
    const cust = o.cust || {};
    const billTo = cust.name || 'Guest';
    const rows = (o.lines || []).map((l) => ({ name: l.name || '', size: l.size || '', note: l.note || '', qty: nn(l.qty), price: nn(l.price), amt: r2(nn(l.price) * nn(l.qty)) }));
    const pays = (o.pays || []).map((p) => ({ label: PAY_LABEL[p.m] || p.m, amt: nn(p.amt) }));
    const refunded = refundedOf(o);
    const when = o.paidAt || o.created || Date.now();
    return { o, c, t, cust, billTo, rows, pays, refunded, when, gst: gstRows(t), dup: !!opts.dup, provisional: !!opts.provisional, tableLabel: opts.tableLabel || '' };
  }

  function injectCss(id, text) { if (typeof document === 'undefined' || document.getElementById(id)) return; const st = document.createElement('style'); st.id = id; st.textContent = text; document.head.appendChild(st); }
  const PAGE_RESET = 'table{border-collapse:separate;border-spacing:0}td.nw,th.nw{white-space:nowrap}';

  // =======================================================================================================
  // 1) "ticket" -- a narrow thermal-receipt column, dropped on a wider page: monospace, dashed rules, a
  //    perforated top edge. The closest in spirit to the paper that actually comes out of a till printer.
  // =======================================================================================================
  function buildTicket(o, c, opts) {
    const b = computeBill(o, c, opts), css = `
.bt-ticket-wrap{display:flex;justify-content:center;background:#ece9e2;padding:22px 10px;font-family:ui-monospace,Menlo,Consolas,monospace}
.bt-ticket{width:320px;background:#fffdf8;color:#1c1b17;padding:18px 16px 22px;position:relative;font-size:12.5px;line-height:1.55;
  box-shadow:0 1px 2px rgba(0,0,0,.06),0 10px 24px -10px rgba(0,0,0,.25);
  -webkit-mask-image:radial-gradient(circle 5px at 10px 0,transparent 5px,#000 5.5px);mask-image:radial-gradient(circle 5px at 10px 0,transparent 5px,#000 5.5px)}
.bt-ticket .dup{text-align:center;font-weight:700;letter-spacing:.08em;text-transform:uppercase;font-size:10.5px;border:1px dashed #1c1b17;padding:4px;margin-bottom:10px}
.bt-ticket .hd{text-align:center;margin-bottom:8px}
.bt-ticket .hd img{max-height:34px;display:block;margin:0 auto 6px;object-fit:contain}
.bt-ticket .nm{font-size:16px;font-weight:700;letter-spacing:.02em;text-transform:uppercase}
.bt-ticket .sub{font-size:11px;color:#6b665c}
.bt-ticket hr{border:0;border-top:1px dashed #9b958490%;margin:10px 0}
.bt-ticket .row{display:flex;justify-content:space-between;gap:10px}
.bt-ticket .items .ln{margin-bottom:5px}
.bt-ticket .items .nm2{display:flex;justify-content:space-between;font-weight:600}
.bt-ticket .items .nm2 small{font-weight:400;color:#6b665c;display:block}
.bt-ticket .items .q{color:#6b665c;font-size:11.5px}
.bt-ticket .tot .row{padding:1.5px 0}
.bt-ticket .tot .big{font-weight:700;font-size:15px;border-top:1px dashed #1c1b17;margin-top:5px;padding-top:6px}
.bt-ticket .thanks{text-align:center;margin-top:12px;font-weight:600}
.bt-ticket .ft{text-align:center;color:#6b665c;font-size:10.5px;margin-top:4px}
@media print{.bt-ticket-wrap{background:#fff;padding:0}.bt-ticket{box-shadow:none}}`;
    const html = `
${b.dup ? '<div class=dup>Duplicate &middot; reprint</div>' : b.provisional ? '<div class=dup>Provisional bill, not a tax invoice</div>' : ''}
<div class=hd>${c.logo ? '<img src="' + esc(c.logo) + '">' : ''}<div class=nm>${esc(c.name || '')}</div>${c.addr ? '<div class=sub>' + esc(c.addr) + '</div>' : ''}${c.phone ? '<div class=sub>Ph ' + esc(c.phone) + '</div>' : ''}${c.gstin ? '<div class=sub>GSTIN ' + esc(c.gstin) + '</div>' : ''}</div>
<hr>
<div class=row><span>${b.provisional ? 'Bill' : 'Invoice'}</span><span>${esc(o.no || '')}</span></div>
<div class=row><span>${fdate(b.when)}</span><span>${ftime(b.when)}</span></div>
${b.tableLabel ? '<div class=row><span>' + esc(o.type || '') + '</span><span>' + esc(b.tableLabel) + '</span></div>' : o.type ? '<div class=row><span>Order</span><span>' + esc(o.type) + '</span></div>' : ''}
${b.billTo !== 'Guest' || b.cust.phone ? '<div class=row><span>Customer</span><span>' + esc(b.billTo) + (b.cust.phone ? ' ' + esc(b.cust.phone) : '') + '</span></div>' : ''}
<hr>
<div class=items>${b.rows.map((l) => `<div class=ln><div class=nm2><span>${esc(l.name)}${l.size ? ' (' + esc(l.size) + ')' : ''}</span><span>${inr(l.amt)}</span></div><div class=q>${l.qty} &times; ${inr(l.price)}${l.note ? ' &middot; ' + esc(l.note) : ''}</div></div>`).join('')}</div>
<hr>
<div class=tot>
<div class=row><span>Subtotal</span><span>${inr(b.t.sub)}</span></div>
${(b.t.offers || []).map((x) => `<div class=row><span>${esc(x.desc)}</span><span>-${inr(x.amt)}</span></div>`).join('')}
${b.t.d ? `<div class=row><span>Discount</span><span>-${inr(b.t.d)}</span></div>` : ''}
${b.t.svc ? `<div class=row><span>Service chg</span><span>${inr(b.t.svc)}</span></div>` : ''}${b.t.pack ? `<div class=row><span>Packing</span><span>${inr(b.t.pack)}</span></div>` : ''}${b.t.deliv ? `<div class=row><span>Delivery</span><span>${inr(b.t.deliv)}</span></div>` : ''}
${b.gst.map(([a, v]) => `<div class=row><span>${a}</span><span>${inr(v)}</span></div>`).join('')}
${b.t.round ? `<div class=row><span>Round off</span><span>${b.t.round >= 0 ? '+' : '-'}${inr(Math.abs(b.t.round))}</span></div>` : ''}
<div class="row big"><span>TOTAL</span><span>${inr(b.t.total)}</span></div>
${b.refunded ? `<div class=row><span>Refunded</span><span>-${inr(b.refunded)}</span></div>` : ''}
</div>
<hr>
${b.provisional ? '<div class=row><span>Payment</span><span>not paid yet</span></div>' : b.pays.map((p) => `<div class=row><span>${esc(p.label)}</span><span>${inr(p.amt)}</span></div>`).join('') || '<div class=row><span>Payment</span><span>&mdash;</span></div>'}
<div class=thanks>${esc(c.ftr || 'Thank you!')}</div>
<div class=ft>Printed by AUZslab POS</div>`;
    return { css, html: `<div class=bt-ticket-wrap><div class=bt-ticket>${html}</div></div>` };
  }

  // =======================================================================================================
  // 2) "modern" -- clean sans-serif, generous whitespace, pill info badges. No borders anywhere.
  // =======================================================================================================
  function buildModern(o, c, opts) {
    const b = computeBill(o, c, opts), css = `
.bt-modern-wrap{display:flex;justify-content:center;background:#fff;padding:20px 12px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Arial,sans-serif;color:#15181c}
.bt-modern{width:420px}
.bt-modern .dup{display:inline-block;background:#f1f3f5;color:#495057;border-radius:999px;padding:5px 12px;font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;margin-bottom:16px}
.bt-modern .hd{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:18px}
.bt-modern .hd img{max-height:34px;object-fit:contain;display:block}
.bt-modern .nm{font-size:22px;font-weight:700;letter-spacing:-.01em}
.bt-modern .sub{font-size:12px;color:#868e96;margin-top:2px;line-height:1.5}
.bt-modern .pills{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}
.bt-modern .pill{background:#f1f3f5;border-radius:999px;padding:6px 12px;font-size:11.5px;color:#495057}
.bt-modern .pill b{color:#15181c}
.bt-modern .sec{margin:16px 0;font-size:13px;line-height:1.6;color:#495057}
.bt-modern .sec b{display:block;font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;color:#adb5bd;margin-bottom:4px;font-weight:700}
.bt-modern table{width:100%;margin:14px 0}
.bt-modern th{text-align:left;font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;color:#adb5bd;font-weight:700;padding:0 0 8px}
.bt-modern td{padding:9px 0;font-size:13.5px;border-top:1px solid #f1f3f5}
.bt-modern td small{display:block;color:#adb5bd;font-size:11px}
.bt-modern .r{text-align:right}.bt-modern .c{text-align:center}
.bt-modern .tot{margin-top:14px}
.bt-modern .row{display:flex;justify-content:space-between;font-size:13px;padding:3px 0;color:#495057}
.bt-modern .big{display:flex;justify-content:space-between;font-size:18px;font-weight:700;color:#15181c;border-top:1.5px solid #15181c;margin-top:6px;padding-top:9px}
.bt-modern .thanks{margin-top:20px;font-size:14px;font-weight:600}
.bt-modern .ft{display:flex;justify-content:space-between;gap:14px;margin-top:18px;padding-top:14px;border-top:1px solid #f1f3f5;font-size:11.5px;color:#868e96}
@media print{.bt-modern-wrap{padding:0}}`;
    const html = `
${b.dup ? '<div class=dup>Duplicate reprint</div>' : b.provisional ? '<div class=dup>Provisional &middot; not a tax invoice</div>' : ''}
<div class=hd>
  <div>${c.logo ? '<img src="' + esc(c.logo) + '">' : '<div class=nm>' + esc(c.name || '') + '</div>'}${c.logo ? '<div class=nm style="margin-top:6px">' + esc(c.name || '') + '</div>' : ''}<div class=sub>${esc(c.addr || '')}${c.phone ? '<br>' + esc(c.phone) : ''}</div></div>
  <div class=pills><div class=pill><b>${esc(o.no || '')}</b></div><div class=pill>${fdate(b.when)}</div></div>
</div>
<div class=sec><b>Billed to</b>${esc(b.billTo)}${b.cust.phone ? '<br>' + esc(b.cust.phone) : ''}${b.cust.gst ? '<br>GSTIN ' + esc(b.cust.gst) : ''}${b.tableLabel ? '<br>' + esc(o.type || '') + ' &middot; ' + esc(b.tableLabel) : ''}</div>
<table><thead><tr><th>Item</th><th class=c>Qty</th><th class=r>Amount</th></tr></thead><tbody>
${b.rows.map((l) => `<tr><td>${esc(l.name)}${l.size ? ' (' + esc(l.size) + ')' : ''}${l.note ? '<small>' + esc(l.note) + '</small>' : ''}</td><td class=c>${l.qty}</td><td class=r>${inr(l.amt)}</td></tr>`).join('')}
</tbody></table>
<div class=tot>
<div class=row><span>Subtotal</span><span>${inr(b.t.sub)}</span></div>
${(b.t.offers || []).map((x) => `<div class=row><span>${esc(x.desc)}</span><span>-${inr(x.amt)}</span></div>`).join('')}
${b.t.d ? `<div class=row><span>Discount</span><span>-${inr(b.t.d)}</span></div>` : ''}
${b.t.svc ? `<div class=row><span>Service charge</span><span>${inr(b.t.svc)}</span></div>` : ''}${b.t.pack ? `<div class=row><span>Packing</span><span>${inr(b.t.pack)}</span></div>` : ''}${b.t.deliv ? `<div class=row><span>Delivery</span><span>${inr(b.t.deliv)}</span></div>` : ''}
${b.gst.map(([a, v]) => `<div class=row><span>${a}</span><span>${inr(v)}</span></div>`).join('')}
${b.t.round ? `<div class=row><span>Round off</span><span>${b.t.round >= 0 ? '+' : '-'}${inr(Math.abs(b.t.round))}</span></div>` : ''}
<div class=big><span>Total</span><span>${inr(b.t.total)}</span></div>
${b.refunded ? `<div class=row><span>Refunded</span><span>-${inr(b.refunded)}</span></div>` : ''}
</div>
<div class=thanks>${esc(c.ftr || 'Thank you!')}</div>
<div class=ft><div>${b.provisional ? 'Not paid yet' : b.pays.map((p) => esc(p.label) + ' · ' + inr(p.amt)).join('<br>') || '&mdash;'}</div><div>${esc(c.name || '')}${c.gstin ? '<br>GSTIN ' + esc(c.gstin) : ''}</div></div>`;
    return { css, html: `<div class=bt-modern-wrap><div class=bt-modern>${html}</div></div>` };
  }

  // =======================================================================================================
  // 3) "brand" -- a solid colour band (the business's own accent, settings.col) carries the name. Bold,
  //    high-contrast, built for a business that wants its colour on every bill that goes out.
  // =======================================================================================================
  function buildBrand(o, c, opts) {
    const b = computeBill(o, c, opts), accent = c.col || '#800020', css = `
.bt-brand-wrap{display:flex;justify-content:center;background:#f3f1ee;padding:22px 12px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif;color:#1b1a17}
.bt-brand{width:420px;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 10px 28px -14px rgba(0,0,0,.3)}
.bt-brand .band{background:${esc(accent)};color:#fff;padding:22px 22px 18px}
.bt-brand .band .dup{display:inline-block;border:1px solid rgba(255,255,255,.6);border-radius:999px;padding:4px 11px;font-size:10.5px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;margin-bottom:10px}
.bt-brand .band .row1{display:flex;justify-content:space-between;align-items:flex-start;gap:10px}
.bt-brand .lg{width:40px;height:40px;border-radius:10px;background:rgba(255,255,255,.18);display:flex;align-items:center;justify-content:center;overflow:hidden;flex:none}
.bt-brand .lg img{width:100%;height:100%;object-fit:contain}
.bt-brand .nm{font-size:22px;font-weight:800;letter-spacing:-.01em}
.bt-brand .sub{font-size:11.5px;opacity:.88;margin-top:3px;line-height:1.5}
.bt-brand .meta{text-align:right;font-size:11.5px;line-height:1.7;opacity:.92}
.bt-brand .meta b{display:block;font-size:15px;font-weight:800}
.bt-brand .body{padding:20px 22px 22px}
.bt-brand .sec{margin-bottom:14px;font-size:13px;line-height:1.6;color:#4b4942}
.bt-brand .sec b{display:block;font-size:10.5px;letter-spacing:.07em;text-transform:uppercase;color:${esc(accent)};margin-bottom:4px;font-weight:800}
.bt-brand table{width:100%;margin:12px 0}
.bt-brand th{text-align:left;font-size:10.5px;letter-spacing:.05em;text-transform:uppercase;color:#9b968a;font-weight:700;padding:0 0 8px}
.bt-brand td{padding:9px 0;font-size:13.5px;border-top:1px solid #f1efe9}
.bt-brand td small{display:block;color:#9b968a;font-size:11px}
.bt-brand .r{text-align:right}.bt-brand .c{text-align:center}
.bt-brand .tot .row{display:flex;justify-content:space-between;font-size:13px;padding:3px 0;color:#4b4942}
.bt-brand .tot .big{display:flex;justify-content:space-between;font-size:19px;font-weight:800;color:${esc(accent)};border-top:2px solid #1b1a17;margin-top:7px;padding-top:9px}
.bt-brand .thanks{margin-top:18px;font-size:14px;font-weight:700;color:${esc(accent)}}
.bt-brand .ft{display:flex;justify-content:space-between;gap:14px;margin-top:16px;padding-top:14px;border-top:1px solid #f1efe9;font-size:11.5px;color:#4b4942}
@media print{.bt-brand-wrap{background:#fff;padding:0}.bt-brand{box-shadow:none;border-radius:0}}`;
    const html = `
<div class=band>
${b.dup ? '<div class=dup>Duplicate reprint</div>' : b.provisional ? '<div class=dup>Provisional bill</div>' : ''}
<div class=row1>
  <div style="display:flex;gap:12px;align-items:center">${c.logo ? '<div class=lg><img src="' + esc(c.logo) + '"></div>' : ''}<div><div class=nm>${esc(c.name || '')}</div><div class=sub>${esc(c.addr || '')}</div></div></div>
  <div class=meta><b>${esc(o.no || '')}</b>${fdate(b.when)}</div>
</div>
</div>
<div class=body>
<div class=sec><b>Billed to</b>${esc(b.billTo)}${b.cust.phone ? ' &middot; ' + esc(b.cust.phone) : ''}${b.cust.gst ? '<br>GSTIN ' + esc(b.cust.gst) : ''}${b.tableLabel ? '<br>' + esc(o.type || '') + ' &middot; ' + esc(b.tableLabel) : ''}</div>
<table><thead><tr><th>Item</th><th class=c>Qty</th><th class=r>Amount</th></tr></thead><tbody>
${b.rows.map((l) => `<tr><td>${esc(l.name)}${l.size ? ' (' + esc(l.size) + ')' : ''}${l.note ? '<small>' + esc(l.note) + '</small>' : ''}</td><td class=c>${l.qty}</td><td class=r>${inr(l.amt)}</td></tr>`).join('')}
</tbody></table>
<div class=tot>
<div class=row><span>Subtotal</span><span>${inr(b.t.sub)}</span></div>
${(b.t.offers || []).map((x) => `<div class=row><span>${esc(x.desc)}</span><span>-${inr(x.amt)}</span></div>`).join('')}
${b.t.d ? `<div class=row><span>Discount</span><span>-${inr(b.t.d)}</span></div>` : ''}
${b.t.svc ? `<div class=row><span>Service charge</span><span>${inr(b.t.svc)}</span></div>` : ''}${b.t.pack ? `<div class=row><span>Packing</span><span>${inr(b.t.pack)}</span></div>` : ''}${b.t.deliv ? `<div class=row><span>Delivery</span><span>${inr(b.t.deliv)}</span></div>` : ''}
${b.gst.map(([a, v]) => `<div class=row><span>${a}</span><span>${inr(v)}</span></div>`).join('')}
${b.t.round ? `<div class=row><span>Round off</span><span>${b.t.round >= 0 ? '+' : '-'}${inr(Math.abs(b.t.round))}</span></div>` : ''}
<div class=big><span>TOTAL</span><span>${inr(b.t.total)}</span></div>
${b.refunded ? `<div class=row><span>Refunded</span><span>-${inr(b.refunded)}</span></div>` : ''}
</div>
<div class=thanks>${esc(c.ftr || 'Thank you!')}</div>
<div class=ft><div>${b.provisional ? 'Not paid yet' : b.pays.map((p) => esc(p.label) + ' · ' + inr(p.amt)).join('<br>') || '&mdash;'}</div><div>${c.phone ? esc(c.phone) : ''}${c.gstin ? '<br>GSTIN ' + esc(c.gstin) : ''}</div></div>
</div>`;
    return { css, html: `<div class=bt-brand-wrap><div class=bt-brand>${html}</div></div>` };
  }

  // =======================================================================================================
  // 4) "ruled" -- a classic ruled table, boxed header, double hairline under the grand total. The one
  //    template that uses a real bordered table, so it follows the iPhone border-safety rules exactly.
  // =======================================================================================================
  function buildRuled(o, c, opts) {
    const b = computeBill(o, c, opts), css = PAGE_RESET + `
.bt-ruled-wrap{display:flex;justify-content:center;background:#fff;padding:20px 12px;font-family:Georgia,"Times New Roman",serif;color:#1c1c1a}
.bt-ruled{width:420px;border:1.5px solid #1c1c1a;padding:18px 18px 20px}
.bt-ruled .dup{text-align:center;font-weight:700;letter-spacing:.06em;text-transform:uppercase;font-size:11px;border:1px dashed #1c1c1a;padding:5px;margin-bottom:12px}
.bt-ruled .hd{text-align:center;border-bottom:2px solid #1c1c1a;padding-bottom:12px;margin-bottom:10px}
.bt-ruled .hd img{max-height:36px;display:block;margin:0 auto 6px;object-fit:contain}
.bt-ruled .nm{font-size:19px;font-weight:700;letter-spacing:.01em}
.bt-ruled .sub{font-size:11.5px;color:#55534c;margin-top:2px;font-family:Arial,sans-serif}
.bt-ruled .meta{display:flex;justify-content:space-between;font-size:11.5px;margin-bottom:10px;font-family:Arial,sans-serif}
.bt-ruled .sec{font-size:12.5px;margin-bottom:10px;line-height:1.5;font-family:Arial,sans-serif}
.bt-ruled .sec b{font-weight:700}
.bt-ruled table.it{width:100%;border:var(--bw,1px) solid #1c1c1a;font-family:Arial,sans-serif}
.bt-ruled table.it th{background:#efeee8;text-align:left;font-size:10.5px;letter-spacing:.03em;text-transform:uppercase;padding:6px 6px;border-bottom:var(--bw,1px) solid #1c1c1a}
.bt-ruled table.it th+th,.bt-ruled table.it td+td{border-left:var(--bw,1px) solid #ddd9cf}
.bt-ruled table.it td{padding:6px 6px;font-size:12.5px;border-bottom:var(--bw,1px) solid #ddd9cf}
.bt-ruled .r{text-align:right}.bt-ruled .c{text-align:center}
.bt-ruled .tot{margin-top:10px;font-family:Arial,sans-serif}
.bt-ruled .row{display:flex;justify-content:space-between;font-size:12.5px;padding:2px 0}
.bt-ruled .big{display:flex;justify-content:space-between;font-size:16px;font-weight:700;border-top:2px solid #1c1c1a;border-bottom:1px solid #1c1c1a;margin-top:6px;padding:7px 0}
.bt-ruled .thanks{text-align:center;margin-top:14px;font-weight:700;font-size:13px}
.bt-ruled .ft{display:flex;justify-content:space-between;gap:12px;margin-top:14px;padding-top:10px;border-top:1px dashed #1c1c1a;font-size:11px;font-family:Arial,sans-serif;color:#55534c}
@media print{.bt-ruled-wrap{padding:0}}`;
    const html = `
${b.dup ? '<div class=dup>Duplicate &middot; reprint</div>' : b.provisional ? '<div class=dup>Provisional bill, not a tax invoice</div>' : ''}
<div class=hd>${c.logo ? '<img src="' + esc(c.logo) + '">' : ''}<div class=nm>${esc(c.name || '')}</div>${c.addr ? '<div class=sub>' + esc(c.addr) + '</div>' : ''}${c.gstin ? '<div class=sub>GSTIN ' + esc(c.gstin) + '</div>' : ''}</div>
<div class=meta><span><b>${b.provisional ? 'Bill' : 'Invoice'} No.</b> ${esc(o.no || '')}</span><span>${fdate(b.when)}</span></div>
<div class=sec><b>Billed to:</b> ${esc(b.billTo)}${b.cust.phone ? ', ' + esc(b.cust.phone) : ''}${b.cust.gst ? ' &middot; GSTIN ' + esc(b.cust.gst) : ''}${b.tableLabel ? '<br><b>' + esc(o.type || 'Order') + ':</b> ' + esc(b.tableLabel) : ''}</div>
<table class=it><colgroup><col style="width:48%"><col style="width:14%"><col style="width:19%"><col style="width:19%"></colgroup>
<thead><tr><th>Item</th><th class="c nw">Qty</th><th class="r nw">Price</th><th class="r nw">Amount</th></tr></thead>
<tbody>${b.rows.map((l) => `<tr><td>${esc(l.name)}${l.size ? ' (' + esc(l.size) + ')' : ''}${l.note ? '<br><small>' + esc(l.note) + '</small>' : ''}</td><td class="c nw">${l.qty}</td><td class="r nw">${inr(l.price)}</td><td class="r nw">${inr(l.amt)}</td></tr>`).join('')}</tbody></table>
<div class=tot>
<div class=row><span>Subtotal</span><span>${inr(b.t.sub)}</span></div>
${(b.t.offers || []).map((x) => `<div class=row><span>${esc(x.desc)}</span><span>-${inr(x.amt)}</span></div>`).join('')}
${b.t.d ? `<div class=row><span>Discount</span><span>-${inr(b.t.d)}</span></div>` : ''}
${b.t.svc ? `<div class=row><span>Service charge</span><span>${inr(b.t.svc)}</span></div>` : ''}${b.t.pack ? `<div class=row><span>Packing</span><span>${inr(b.t.pack)}</span></div>` : ''}${b.t.deliv ? `<div class=row><span>Delivery</span><span>${inr(b.t.deliv)}</span></div>` : ''}
${b.gst.map(([a, v]) => `<div class=row><span>${a}</span><span>${inr(v)}</span></div>`).join('')}
${b.t.round ? `<div class=row><span>Round off</span><span>${b.t.round >= 0 ? '+' : '-'}${inr(Math.abs(b.t.round))}</span></div>` : ''}
<div class=big><span>TOTAL</span><span>${inr(b.t.total)}</span></div>
${b.refunded ? `<div class=row><span>Refunded</span><span>-${inr(b.refunded)}</span></div>` : ''}
</div>
<div class=thanks>${esc(c.ftr || 'Thank you!')}</div>
<div class=ft><div>${b.provisional ? 'Payment not made yet' : 'Paid via ' + (b.pays.map((p) => esc(p.label) + ' ' + inr(p.amt)).join(', ') || '&mdash;')}</div><div style="text-align:right">For ${esc(c.name || '')}</div></div>`;
    return { css, html: `<div class=bt-ruled-wrap><div class=bt-ruled>${html}</div></div>` };
  }

  // =======================================================================================================
  // 5) "soft" -- a rounded, warm card with soft shadows and pill totals. Friendly, low-contrast, cafe/salon
  //    leaning -- the gentlest of the five.
  // =======================================================================================================
  function buildSoft(o, c, opts) {
    const b = computeBill(o, c, opts), css = `
.bt-soft-wrap{display:flex;justify-content:center;background:#f6f1e9;padding:24px 12px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif;color:#3a342c}
.bt-soft{width:420px;background:#fffaf2;border-radius:24px;padding:26px 24px;box-shadow:0 18px 40px -22px rgba(60,45,20,.35)}
.bt-soft .dup{display:inline-block;background:#fdeee0;color:#9a5b1f;border-radius:999px;padding:5px 13px;font-size:11px;font-weight:700;margin-bottom:14px}
.bt-soft .hd{text-align:center;margin-bottom:16px}
.bt-soft .lg{width:52px;height:52px;border-radius:50%;background:#fdeee0;display:flex;align-items:center;justify-content:center;margin:0 auto 10px;overflow:hidden}
.bt-soft .lg img{width:100%;height:100%;object-fit:cover}
.bt-soft .nm{font-size:21px;font-weight:700}
.bt-soft .sub{font-size:12px;color:#8a7f6e;margin-top:3px}
.bt-soft .meta{display:flex;justify-content:center;gap:10px;margin-top:10px;font-size:11.5px;color:#8a7f6e}
.bt-soft .meta b{color:#3a342c}
.bt-soft .sec{background:#fdf7ec;border-radius:14px;padding:12px 14px;margin:14px 0;font-size:13px;line-height:1.6}
.bt-soft .sec b{display:block;font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;color:#c6894a;margin-bottom:3px;font-weight:700}
.bt-soft table{width:100%;margin:6px 0}
.bt-soft th{text-align:left;font-size:10.5px;letter-spacing:.05em;text-transform:uppercase;color:#b7ac98;font-weight:700;padding:0 2px 8px}
.bt-soft td{padding:8px 2px;font-size:13.5px;border-top:1px solid #f0e7d8}
.bt-soft td small{display:block;color:#b7ac98;font-size:11px}
.bt-soft .r{text-align:right}.bt-soft .c{text-align:center}
.bt-soft .tot{margin-top:12px}
.bt-soft .row{display:flex;justify-content:space-between;font-size:13px;padding:3px 2px;color:#5c5346}
.bt-soft .big{display:flex;justify-content:space-between;align-items:center;font-size:17px;font-weight:700;background:#fdeee0;border-radius:999px;padding:10px 16px;margin-top:8px;color:#9a5b1f}
.bt-soft .thanks{text-align:center;margin-top:18px;font-size:14px;font-weight:700;color:#9a5b1f}
.bt-soft .ft{display:flex;justify-content:space-between;gap:12px;margin-top:14px;font-size:11px;color:#8a7f6e}
@media print{.bt-soft-wrap{background:#fff;padding:0}.bt-soft{box-shadow:none}}`;
    const html = `
${b.dup ? '<div class=dup>Duplicate reprint</div>' : b.provisional ? '<div class=dup>Provisional bill</div>' : ''}
<div class=hd>${c.logo ? '<div class=lg><img src="' + esc(c.logo) + '"></div>' : ''}<div class=nm>${esc(c.name || '')}</div>${c.addr ? '<div class=sub>' + esc(c.addr) + '</div>' : ''}
<div class=meta><span><b>${esc(o.no || '')}</b></span><span>${fdate(b.when)}</span></div></div>
<div class=sec><b>Billed to</b>${esc(b.billTo)}${b.cust.phone ? ' &middot; ' + esc(b.cust.phone) : ''}${b.tableLabel ? '<br>' + esc(o.type || '') + ' &middot; ' + esc(b.tableLabel) : ''}</div>
<table><thead><tr><th>Item</th><th class=c>Qty</th><th class=r>Amount</th></tr></thead><tbody>
${b.rows.map((l) => `<tr><td>${esc(l.name)}${l.size ? ' (' + esc(l.size) + ')' : ''}${l.note ? '<small>' + esc(l.note) + '</small>' : ''}</td><td class=c>${l.qty}</td><td class=r>${inr(l.amt)}</td></tr>`).join('')}
</tbody></table>
<div class=tot>
<div class=row><span>Subtotal</span><span>${inr(b.t.sub)}</span></div>
${(b.t.offers || []).map((x) => `<div class=row><span>${esc(x.desc)}</span><span>-${inr(x.amt)}</span></div>`).join('')}
${b.t.d ? `<div class=row><span>Discount</span><span>-${inr(b.t.d)}</span></div>` : ''}
${b.t.svc ? `<div class=row><span>Service charge</span><span>${inr(b.t.svc)}</span></div>` : ''}${b.t.pack ? `<div class=row><span>Packing</span><span>${inr(b.t.pack)}</span></div>` : ''}${b.t.deliv ? `<div class=row><span>Delivery</span><span>${inr(b.t.deliv)}</span></div>` : ''}
${b.gst.map(([a, v]) => `<div class=row><span>${a}</span><span>${inr(v)}</span></div>`).join('')}
${b.t.round ? `<div class=row><span>Round off</span><span>${b.t.round >= 0 ? '+' : '-'}${inr(Math.abs(b.t.round))}</span></div>` : ''}
<div class=big><span>Total</span><span>${inr(b.t.total)}</span></div>
${b.refunded ? `<div class=row><span>Refunded</span><span>-${inr(b.refunded)}</span></div>` : ''}
</div>
<div class=thanks>${esc(c.ftr || 'Thank you!')}</div>
<div class=ft><div>${b.provisional ? 'Not paid yet' : b.pays.map((p) => esc(p.label) + ' · ' + inr(p.amt)).join('<br>') || '&mdash;'}</div><div>${c.gstin ? 'GSTIN ' + esc(c.gstin) : ''}</div></div>`;
    return { css, html: `<div class=bt-soft-wrap><div class=bt-soft>${html}</div></div>` };
  }

  // =======================================================================================================
  // 6) "a4" -- a full A4 printed page (like a GST tax invoice), not a receipt-width card. For a business that
  //    wants a formal, letter-sized document to print or save as PDF rather than a till-style slip. Uses the
  //    same iPhone-safe table-border rules as "ruled" (border-collapse:separate + a --bw line width), and a
  //    real @page rule so a browser's own "Print" / "Save as PDF" actually renders one clean A4 sheet.
  // =======================================================================================================
  function buildA4(o, c, opts) {
    const b = computeBill(o, c, opts), accent = c.col || '#800020', css = PAGE_RESET + `
.bt-a4-wrap{display:flex;justify-content:center;background:#e9e7e2;padding:18px 10px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif;color:#1c1c1a}
.bt-a4{width:210mm;min-height:297mm;box-sizing:border-box;background:#fff;padding:14mm 14mm 12mm;box-shadow:0 1px 3px rgba(0,0,0,.08),0 18px 40px -20px rgba(0,0,0,.3)}
.bt-a4 .dup{display:inline-block;border:1px solid ${esc(accent)};color:${esc(accent)};border-radius:999px;padding:4px 12px;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;margin-bottom:14px}
.bt-a4 .hd{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;border-bottom:2px solid ${esc(accent)};padding-bottom:16px;margin-bottom:18px}
.bt-a4 .hd .lg{display:flex;gap:14px;align-items:center}
.bt-a4 .hd img{max-height:56px;max-width:140px;object-fit:contain;display:block}
.bt-a4 .nm{font-size:24px;font-weight:800;letter-spacing:-.01em}
.bt-a4 .sub{font-size:12px;color:#5b584f;margin-top:3px;line-height:1.6}
.bt-a4 .tt{text-align:right}
.bt-a4 .tt .cap{font-size:26px;font-weight:800;letter-spacing:.02em;color:${esc(accent)};text-transform:uppercase}
.bt-a4 .tt .meta{font-size:12.5px;color:#5b584f;margin-top:6px;line-height:1.7}
.bt-a4 .tt .meta b{color:#1c1c1a}
.bt-a4 .secs{display:flex;justify-content:space-between;gap:24px;margin-bottom:20px}
.bt-a4 .sec{font-size:13px;line-height:1.7;color:#3a3832}
.bt-a4 .sec b{display:block;font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;color:#9b968a;margin-bottom:5px;font-weight:700}
.bt-a4 table.it{width:100%;border:var(--bw,1px) solid #1c1c1a;font-size:13px}
.bt-a4 table.it th{background:#f6f4f0;text-align:left;font-size:11px;letter-spacing:.03em;text-transform:uppercase;padding:9px 10px;border-bottom:var(--bw,1px) solid #1c1c1a}
.bt-a4 table.it th+th,.bt-a4 table.it td+td{border-left:var(--bw,1px) solid #e3e0d8}
.bt-a4 table.it td{padding:9px 10px;border-bottom:var(--bw,1px) solid #e3e0d8}
.bt-a4 .r{text-align:right}.bt-a4 .c{text-align:center}
.bt-a4 .foot{display:flex;justify-content:space-between;gap:24px;margin-top:20px}
.bt-a4 .notes{flex:1;font-size:12px;color:#5b584f;line-height:1.7;max-width:60%}
.bt-a4 .tot{width:260px}
.bt-a4 .tot .row{display:flex;justify-content:space-between;font-size:13px;padding:4px 0;color:#3a3832}
.bt-a4 .tot .big{display:flex;justify-content:space-between;font-size:19px;font-weight:800;color:${esc(accent)};border-top:2px solid #1c1c1a;margin-top:8px;padding-top:10px}
.bt-a4 .sign{margin-top:46px;display:flex;justify-content:flex-end}
.bt-a4 .sign div{text-align:center;font-size:12px;color:#5b584f}
.bt-a4 .sign .ln{width:180px;border-top:1px solid #1c1c1a;margin-bottom:6px;height:38px}
.bt-a4 .thanks{margin-top:22px;text-align:center;font-size:13px;color:#5b584f}
@media print{@page{size:A4;margin:0}.bt-a4-wrap{background:#fff;padding:0}.bt-a4{box-shadow:none;width:auto;min-height:0}}`;
    const html = `
${b.dup ? '<div class=dup>Duplicate &middot; reprint</div>' : b.provisional ? '<div class=dup>Provisional bill, not a tax invoice</div>' : ''}
<div class=hd>
  <div class=lg>${c.logo ? '<img src="' + esc(c.logo) + '">' : ''}<div><div class=nm>${esc(c.name || '')}</div>${c.addr ? '<div class=sub>' + esc(c.addr) + '</div>' : ''}${[c.phone ? 'Ph ' + esc(c.phone) : '', c.gstin ? 'GSTIN ' + esc(c.gstin) : ''].filter(Boolean).length ? '<div class=sub>' + [c.phone ? 'Ph ' + esc(c.phone) : '', c.gstin ? 'GSTIN ' + esc(c.gstin) : ''].filter(Boolean).join(' &middot; ') + '</div>' : ''}</div></div>
  <div class=tt><div class=cap>${b.provisional ? 'Bill' : 'Invoice'}</div><div class=meta><b>No.</b> ${esc(o.no || '')}<br><b>Date</b> ${fdate(b.when)}, ${ftime(b.when)}${b.tableLabel ? '<br><b>' + esc(o.type || 'Order') + '</b> ' + esc(b.tableLabel) : ''}</div></div>
</div>
<div class=secs>
  <div class=sec><b>Billed to</b>${esc(b.billTo)}${b.cust.phone ? '<br>' + esc(b.cust.phone) : ''}${b.cust.gst ? '<br>GSTIN ' + esc(b.cust.gst) : ''}</div>
  <div class=sec style="text-align:right"><b>Payment</b>${b.provisional ? 'Not paid yet' : b.pays.map((p) => esc(p.label) + ' &middot; ' + inr(p.amt)).join('<br>') || '&mdash;'}</div>
</div>
<table class=it><colgroup><col style="width:48%"><col style="width:13%"><col style="width:19%"><col style="width:20%"></colgroup>
<thead><tr><th>Item</th><th class=c>Qty</th><th class=r>Price</th><th class=r>Amount</th></tr></thead>
<tbody>${b.rows.map((l) => `<tr><td>${esc(l.name)}${l.size ? ' (' + esc(l.size) + ')' : ''}${l.note ? '<br><small>' + esc(l.note) + '</small>' : ''}</td><td class=c>${l.qty}</td><td class=r>${inr(l.price)}</td><td class=r>${inr(l.amt)}</td></tr>`).join('')}</tbody></table>
<div class=foot>
<div class=notes>${c.ftr ? esc(c.ftr) : ''}</div>
<div class=tot>
<div class=row><span>Subtotal</span><span>${inr(b.t.sub)}</span></div>
${(b.t.offers || []).map((x) => `<div class=row><span>${esc(x.desc)}</span><span>-${inr(x.amt)}</span></div>`).join('')}
${b.t.d ? `<div class=row><span>Discount</span><span>-${inr(b.t.d)}</span></div>` : ''}
${b.t.svc ? `<div class=row><span>Service charge</span><span>${inr(b.t.svc)}</span></div>` : ''}${b.t.pack ? `<div class=row><span>Packing</span><span>${inr(b.t.pack)}</span></div>` : ''}${b.t.deliv ? `<div class=row><span>Delivery</span><span>${inr(b.t.deliv)}</span></div>` : ''}
${b.gst.map(([a, v]) => `<div class=row><span>${a}</span><span>${inr(v)}</span></div>`).join('')}
${b.t.round ? `<div class=row><span>Round off</span><span>${b.t.round >= 0 ? '+' : '-'}${inr(Math.abs(b.t.round))}</span></div>` : ''}
<div class=big><span>Total</span><span>${inr(b.t.total)}</span></div>
${b.refunded ? `<div class=row><span>Refunded</span><span>-${inr(b.refunded)}</span></div>` : ''}
</div>
</div>
<div class=sign><div><div class=ln></div>Authorised signatory</div></div>
<div class=thanks>Thank you for your business!</div>`;
    return { css, html: `<div class=bt-a4-wrap><div class=bt-a4>${html}</div></div>` };
  }

  const STYLES = { ticket: buildTicket, modern: buildModern, brand: buildBrand, ruled: buildRuled, soft: buildSoft, a4: buildA4 };
  const LIST = [
    ['ticket', 'Ticket', 'A narrow thermal-style column with dashed rules and a perforated edge -- looks like the paper that comes out of a till.'],
    ['modern', 'Modern', 'Clean sans-serif, pill badges, generous whitespace. No borders.'],
    ['brand', 'Brand', 'A solid colour band in the business’s own accent carries the name. Bold and high-contrast.'],
    ['ruled', 'Ruled', 'A classic ruled table on a letterhead-style header. Traditional and formal.'],
    ['soft', 'Soft', 'A rounded, warm card with soft shadows and pill-shaped totals. Friendly, cafe/salon leaning.'],
    ['a4', 'A4 page', 'A full letter-size page, like a formal GST tax invoice -- prints or saves as one clean A4 sheet instead of a receipt-width slip.'],
  ];
  root.auzBillTemplates = Object.assign(root.auzBillTemplates || {}, { styles: STYLES, list: LIST, computeBill, gstRows });
  if (typeof module !== 'undefined' && module.exports) module.exports = root.auzBillTemplates;
})(typeof window !== 'undefined' ? window : globalThis);
