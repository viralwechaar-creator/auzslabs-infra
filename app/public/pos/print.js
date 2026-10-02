/* Printing through the browser (hidden iframe): kitchen tickets and slips on the thermal width set in Settings
   (58/80 mm), the customer invoice in the business's own invoice style. Plus the WhatsApp bill link. */
'use strict';
function printFrame(css, html) {
  const f = h('iframe', { style: 'position:fixed;width:0;height:0;border:0', 'aria-hidden': 'true' });
  document.body.append(f); const d = f.contentDocument;
  d.open(); d.write('<!doctype html><meta charset="utf-8"><style>' + css + '</style>' + html); d.close();
  // the frame stays until the print dialog is finished with it (afterprint), with a one-minute fallback
  setTimeout(() => {
    const w = f.contentWindow, done = () => setTimeout(() => f.remove(), 500);
    try { w.addEventListener('afterprint', done, { once: true }); w.focus(); w.print(); } catch { done(); }
    setTimeout(() => { if (f.isConnected) f.remove(); }, 60000);
  }, 60);
}
// thermal: KOT, cancellation slips, register summary
function prn(html) {
  const c = cfg();
  printFrame('body{font:' + (c.fs || 12) + 'px ' + (c.sty === 'sans' ? 'system-ui,sans-serif' : 'ui-monospace,Menlo,monospace') + ';width:' + (+c.w === 58 ? 48 : 72) + 'mm;margin:0}td{padding:1px 0;vertical-align:top}.r{text-align:right}.c{text-align:center}.big{font-size:1.5em;font-weight:700}.hd{text-align:center;border:2px solid #000;padding:2px;margin-bottom:4px;font-weight:700}hr{border:0;border-top:1px dashed #000;margin:6px 0}.note{padding-left:12px;font-style:italic}', html);
}
function kotHtml(o, items, opt = {}) {
  const c = cfg(), stations = [...new Set(items.map((x) => x.s || 'Kitchen'))], who = o.captain ? o.captain.name : '';
  return (opt.head ? '<div class="hd">' + esc(opt.head) + '</div>' : '') +
    '<div class="big">KOT ' + esc(opt.no ? '#' + opt.no : '') + '</div>' + esc(o.no || '') + (o.token ? ' · Token #' + o.token : '') + '<br>' +
    esc(o.type) + (o.table ? ' · ' + esc(tn(o.table)) : '') + (o.covers ? ' · ' + o.covers + ' guests' : '') + '<br>' + new Date().toLocaleTimeString() + (who ? ' · ' + esc(who) : '') +
    (o.comment ? '<br><b>Note: ' + esc(o.comment) + '</b>' : '') + '<hr>' +
    stations.map((s) => (stations.length > 1 || s !== 'Kitchen' ? '<u>' + esc(s) + '</u><br>' : '') + items.filter((x) => (x.s || 'Kitchen') === s).map((x) => '<b>' + (opt.cancel ? '−' : '') + Math.abs(x.q) + '× ' + esc(x.n) + '</b><br>' + (x.note ? '<div class="note">' + esc(x.note) + '</div>' : '')).join('')).join('<hr>') +
    (c.name ? '<hr><div class="c">' + esc(c.name) + '</div>' : '');
}

// customer invoice (also the provisional "check" before payment)
function prnInv(html) {
  printFrame(`@page{margin:16mm}
:root{--ink:#161513;--line:rgba(22,21,19,.14);--mute:#6b675e}
body{font-family:Inter,-apple-system,BlinkMacSystemFont,Helvetica,Arial,sans-serif;color:var(--ink);margin:0;padding:0;max-width:680px}
.dup{display:inline-block;border:1px solid var(--ink);padding:5px 12px;font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;margin-bottom:22px}
.hd{display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:20px}
.mark{font-size:38px;font-weight:800;letter-spacing:-.02em;line-height:1}.mark img{max-height:36px;display:block}
.meta-r{text-align:right;font-size:12px;color:var(--mute);line-height:1.6}.meta-r b{color:var(--ink);font-weight:600}
hr{border:none;border-top:1px solid var(--line);margin:0}
.billto{padding:16px 0;font-size:13px;line-height:1.7}.billto b{display:block;font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--mute);margin-bottom:5px}
table{width:100%;border-collapse:collapse;margin:0}
th{font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--mute);text-align:left;padding:12px 0 8px}
td{padding:10px 0;font-size:13px;border-top:1px solid var(--line)}
td small{display:block;color:var(--mute);font-size:11px}
th.c,td.c{text-align:center}th.r,td.r{text-align:right}
.tot{display:flex;justify-content:flex-end;padding:16px 0 0}.tot table{width:auto;min-width:240px}
.tot td{border-top:none;padding:4px 0;font-size:13px}.tot td:first-child{color:var(--mute);padding-right:28px}.tot td:last-child{text-align:right}
.tot .big td{border-top:1px solid var(--ink);padding-top:10px;font-size:17px;font-weight:700}
.thanks{font-size:15px;font-weight:500;padding:26px 0 0}
.ft{display:flex;justify-content:space-between;gap:16px;padding:22px 0 0;font-size:12px;line-height:1.7}
.ft b{display:block;font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--mute);margin-bottom:5px}
.sig{text-align:right}.sig b:first-child{font-size:13px;font-weight:700;letter-spacing:0;text-transform:none;color:var(--ink);margin-bottom:2px}`, html);
}
// GST lines: per rate when the bill has the breakup, else the old equal CGST/SGST split
function gstRows(t) {
  const rates = t.rates ? Object.entries(t.rates).filter(([r, x]) => +r > 0 && x.tax > 0) : null;
  if (!rates) return [['CGST', r2(t.tax / 2)], ['SGST', r2(t.tax / 2)]];
  return rates.flatMap(([r, x]) => [['CGST ' + +r / 2 + '%', r2(x.tax / 2)], ['SGST ' + +r / 2 + '%', r2(x.tax / 2)]]);
}
function rcpt(o, dup, provisional) {
  const s = cfg(), t = o.t || tot(o), refunded = refundedOf(o), cust = o.cust || {};
  const rows = o.lines.map((l) => `<tr><td>${esc(l.name)}${l.size ? ' (' + esc(l.size) + ')' : ''}${l.note ? '<small>' + esc(l.note) + '</small>' : ''}</td><td class=c>${l.qty}</td><td class=r>${inr(l.price)}</td><td class=r>${inr(l.price * l.qty)}</td></tr>`).join('');
  const tr = (a, b) => `<tr><td>${a}</td><td>${b}</td></tr>`;
  return `${provisional ? '<div class=dup>Provisional bill, not a tax invoice</div>' : dup ? '<div class=dup>Duplicate, reprint</div>' : ''}<div class=hd><div class=mark>${s.logo ? '<img src="' + esc(s.logo) + '">' : 'Invoice'}</div><div class=meta-r><b>${provisional ? 'Bill' : 'Invoice No.'}</b> ${esc(o.no || '')}<br>${fmtDate(o.paidAt || o.created)}${o.table ? '<br>' + esc(tn(o.table)) + (o.covers ? ' · ' + o.covers + ' guests' : '') : ''}</div></div>
<hr>
<div class=billto><b>Billed to</b>${esc(cust.name || 'Guest')}${cust.phone ? '<br>' + esc(cust.phone) : ''}${cust.gst ? '<br>GSTIN ' + esc(cust.gst) : ''}${o.addr ? '<br>' + esc(o.addr) : ''}${o.captain ? '<br><b>Served by</b> ' + esc(o.captain.name) : ''}${o.comment ? '<br><b>Note</b> ' + esc(o.comment) : ''}${o.complimentary ? '<br><b>Complimentary</b>' + (o.compReason ? ' · ' + esc(o.compReason) : '') : ''}</div>
<hr>
<table><thead><tr><th>Item</th><th class=c>Qty</th><th class=r>Unit price</th><th class=r>Amount</th></tr></thead><tbody>${rows}</tbody></table>
<div class=tot><table>
${tr('Subtotal', inr(t.sub))}
${t.d ? tr('Discount' + (o.coupon ? ' (' + esc(o.coupon) + ')' : ''), '−' + inr(t.d)) : ''}
${t.svc ? tr('Service charge', inr(t.svc)) : ''}${t.pack ? tr('Packing', inr(t.pack)) : ''}${t.deliv ? tr('Delivery', inr(t.deliv)) : ''}
${gstRows(t).map(([a, b]) => tr(a, inr(b))).join('')}
${t.round ? tr('Round off', (t.round >= 0 ? '+' : '−') + inr(Math.abs(t.round))) : ''}
<tr class=big><td>Total</td><td>${inr(t.total)}</td></tr>
${refunded ? tr('Refunded', '−' + inr(refunded)) : ''}
${o.tip && o.tip.amt ? tr('Tip (not part of the bill)', inr(o.tip.amt)) : ''}
</table></div>
<p class=thanks>${esc(s.ftr)}</p>
<hr style="margin-top:20px">
<div class=ft><div><b>${provisional ? 'Payment' : 'Paid via'}</b>${provisional ? 'Not paid yet' : (o.pays || []).map((p) => esc(PAY_LABEL[p.m] || p.m) + ' · ' + inr(p.amt)).join('<br>') || '—'}</div><div class=sig><b>${esc(s.name)}</b><br>${esc(s.addr)}${s.gstin ? '<br>GSTIN ' + esc(s.gstin) : ''}${s.phone ? '<br>' + esc(s.phone) : ''}</div></div>`;
}
const PAY_LABEL = { cash: 'Cash', upi: 'UPI', card: 'Card', giftcard: 'Gift card', other: 'Other', wallet: 'Wallet' };

async function wa(o) {
  let p = digits((o.cust || {}).phone);
  if (!p) { const v = await promptBox('Send the bill on WhatsApp', { placeholder: 'Customer phone', type: 'tel', mode: 'tel' }); p = digits(v); }
  if (!p) return;
  if (p.length === 10) p = '91' + p;
  const url = location.origin + '/i.html?o=' + encodeURIComponent(o.tok || o.no), items = o.lines.map((l) => `${l.name}${l.size ? ' (' + l.size + ')' : ''} × ${l.qty}: ${inr(l.price * l.qty)}`).join('\n');
  const msg = `Hi ${(o.cust || {}).name || ''}, thank you for visiting ${cfg().name}.\n\nInvoice ${o.no} (${fmtDate(o.paidAt || o.created)})\n${items}\nTotal: ${inr(o.t.total)}\n\nView or download your invoice:\n${url}`;
  open('https://wa.me/' + p + '?text=' + encodeURIComponent(msg), '_blank');
}
function waLink(phone, msg) { let p = digits(phone); if (p.length === 10) p = '91' + p; return 'https://wa.me/' + p + '?text=' + encodeURIComponent(msg); }
