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
// With a receipt printer connected on this device (Staff & settings -> Receipt printer) the slip goes straight to it;
// otherwise, or if the printer does not answer, the normal print window opens.
const directReady = () => typeof auzPrinter !== 'undefined' && auzPrinter.ready();
const slipWidth = () => (+cfg().w === 58 ? 32 : 48);
function viaPrinter(makeBytes, fallback) {
  let bytes; try { bytes = makeBytes(); } catch (e) { return fallback(); }
  auzPrinter.print(bytes).catch((e) => { toast('Printer did not answer: ' + (e && e.message ? e.message : e) + ' Opening the print window instead.', { err: true }); fallback(); });
}
function prn(html) { if (directReady()) return viaPrinter(() => auzEsc.htmlToEsc(html, slipWidth()), () => browserPrn(html)); browserPrn(html); }
function browserPrn(html) {
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
// customer bill: straight to the receipt printer when one is connected, else the invoice print window
function prnReceipt(o, dup, provisional) {
  if (directReady()) return viaPrinter(() => escReceipt(o, dup, provisional), () => prnInv(rcpt(o, dup, provisional)));
  prnInv(rcpt(o, dup, provisional));
}
function escReceipt(o, dup, prov) {
  const s = cfg(), t = o.t || tot(o), refunded = refundedOf(o), cust = o.cust || {}, w = slipWidth(), e = new auzEsc.Esc(w), wrap = auzEsc.wrap;
  const lr = (a, b) => e.lr(a, b);
  if (prov) e.align('center').bold(true).line('PROVISIONAL BILL').line('not a tax invoice').bold(false).align('left').nl();
  else if (dup) e.align('center').bold(true).line('DUPLICATE - REPRINT').bold(false).align('left').nl();
  e.align('center').bold(true).size(2, 2); for (const p of wrap(auzEsc.ascii(s.name || ''), Math.floor(w / 2))) e.line(p); e.size(1, 1).bold(false);
  if (s.addr) e.wrapLine(s.addr); if (s.phone) e.line('Ph ' + s.phone); if (s.gstin) e.line('GSTIN ' + s.gstin);
  e.align('left').hr();
  lr(prov ? 'Bill' : 'Invoice', String(o.no || '')); lr('Date', fmtDate(o.paidAt || o.created) + ' ' + new Date(o.paidAt || o.created || Date.now()).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }));
  if (cust.name || cust.phone) lr('Customer', [cust.name, cust.phone].filter(Boolean).join(' '));
  if (cust.gst) lr('Cust GSTIN', cust.gst);
  if (o.type) lr('Order', o.type + (o.table ? ' ' + tn(o.table) : '') + (o.token ? ' #' + o.token : ''));
  if (o.captain) lr('Served by', o.captain.name);
  e.hr();
  for (const l of o.lines) {
    e.wrapLine(l.name + (l.size ? ' (' + l.size + ')' : ''));
    lr('  ' + l.qty + ' x ' + inr(l.price), inr(l.price * l.qty));
    if (l.note) e.wrapLine(l.note, 4);
  }
  e.hr();
  lr('Subtotal', inr(t.sub));
  if (t.d) lr('Discount' + (o.coupon ? ' (' + o.coupon + ')' : ''), '-' + inr(t.d));
  if (t.svc) lr('Service charge', inr(t.svc)); if (t.pack) lr('Packing', inr(t.pack)); if (t.deliv) lr('Delivery', inr(t.deliv));
  for (const [a, b] of gstRows(t)) lr(a, inr(b));
  if (t.round) lr('Round off', (t.round >= 0 ? '+' : '-') + inr(Math.abs(t.round)));
  e.hr('=').bold(true).size(1, 2); lr('TOTAL', inr(t.total)); e.size(1, 1).bold(false);
  if (refunded) lr('Refunded', '-' + inr(refunded));
  if (o.tip && o.tip.amt) lr('Tip (not in the bill)', inr(o.tip.amt));
  e.hr();
  if (prov) e.line('Payment: not paid yet'); else for (const p of (o.pays || [])) lr(PAY_LABEL[p.m] || p.m, inr(p.amt));
  if (s.ftr) { e.nl().align('center').wrapLine(s.ftr).align('left'); }
  if (!prov && !dup && localStorage['pos.drawer'] === '1' && (o.pays || []).some((p) => p.m === 'cash')) e.drawer();
  e.cut();
  return e.bytes();
}
// Staff & settings -> Receipt printer: connect, test, forget (WebUSB / Web Serial / Web Bluetooth; see ds/escpos.js)
function printerSheet() {
  const P = window.auzPrinter;
  if (!P) return toast('Direct printing is not available here', { err: true });
  const sup = P.supported(), any = P.anySupported();
  const s = sheet({ title: 'Receipt printer', body: '', actions: [] });
  const draw = () => {
    const inf = P.info(), rows = [];
    rows.push(liRow({ ic: 'printer', tone: inf && inf.connected ? 'green' : 'gray', title: inf ? inf.name : 'Print window (default)', sub: inf ? (inf.connected ? 'Connected (' + inf.kind + ')' : 'Chosen on this device, reconnects when you print (' + inf.kind + ')') : 'Bills and kitchen tickets open the normal print window' }));
    if (!any) rows.push(h('p', { class: 'muted', style: { padding: '8px 4px' } }, 'This browser cannot print straight to a receipt printer. Use Chrome or Edge on a computer or Android phone, not Safari, not an iPhone and not the packaged Android app. The print window keeps working everywhere.'));
    const conn = (kind, label, sub) => liRow({ ic: 'plus', tone: 'blue', title: label, sub, chev: true, onclick: async () => { try { await P.pair(kind); toast('Printer connected'); } catch (e) { if (!/cancel|chosen|no device selected|aborted/i.test(String(e && e.message))) toast(String(e && e.message || e), { err: true }); } draw(); } });
    if (sup.usb) rows.push(conn('usb', 'Connect a USB printer', 'Plug it into this device, then choose it'));
    if (sup.bluetooth) rows.push(conn('bluetooth', 'Connect a Bluetooth printer', 'Switch the printer on, then choose it'));
    if (sup.serial) rows.push(conn('serial', 'Connect a serial printer', 'Older receipt printers on a USB-serial cable'));
    if (sup.bridge) rows.push(liRow({ ic: 'plus', tone: 'blue', title: 'Bridge Server (network printer)', sub: 'A kitchen or network printer, via the small program running on this PC', chev: true, onclick: bridgeForm }));
    if (inf) {
      rows.push(liRow({ ic: 'receipt', tone: 'purple', title: 'Print a test slip', chev: true, onclick: async () => { try { const e = new auzEsc.Esc(slipWidth()); e.align('center').bold(true).size(2, 2).line('TEST').size(1, 1).bold(false).line(cfg().name || 'AUZslab').line('Printer works.').align('left').hr().lr('Width', slipWidth() + ' characters').cut(); await P.print(e.bytes()); toast('Test slip sent'); } catch (e) { toast(String(e && e.message || e), { err: true }); } draw(); } }));
      rows.push(liRow({ ic: 'cash', tone: 'orange', title: 'Open the cash drawer on cash bills', sub: 'For a drawer wired to the printer', right: seg([['0', 'Off'], ['1', 'On']], localStorage['pos.drawer'] === '1' ? '1' : '0', (v) => { try { localStorage['pos.drawer'] = v; } catch {} }) }));
      rows.push(liRow({ ic: 'trash', tone: 'red', title: 'Disconnect and use the print window', chev: true, onclick: async () => { await P.forget(); draw(); } }));
    }
    rows.push(h('p', { class: 'muted', style: { padding: '10px 4px', fontSize: '13px' } }, 'Prints plain English text (₹ prints as Rs). The paper width (58 or 80 mm) is set in the admin console, Settings. A printer that does not answer falls back to the print window.'));
    s.setBody(h('div', { class: 'list' }, rows));
  };
  // The Bridge Server's own setup (bridge/README.md) prints a port, a token and the printer
  // names from config.json -- this form is just those three values, typed once.
  function bridgeForm() {
    const portEl = h('input', { value: '7777', inputmode: 'numeric', placeholder: '7777' });
    const tokenEl = h('input', { placeholder: 'From the Bridge Server\'s first run' });
    const printerEl = h('input', { placeholder: 'The printer\'s name in config.json' });
    const errEl = h('p', { class: 'muted', style: { color: 'var(--danger,#c2183f)', minHeight: '18px' } });
    const connectBtn = h('button', { class: 'btn btn-primary', onclick: async () => {
      const port = (portEl.value || '').trim() || '7777', token = (tokenEl.value || '').trim(), printer = (printerEl.value || '').trim();
      if (!token || !printer) { errEl.textContent = 'Enter the token and the printer name.'; return; }
      connectBtn.disabled = true; errEl.textContent = '';
      try { await P.pair('bridge', { port, token, printer }); toast('Bridge Server connected'); draw(); }
      catch (e) { errEl.textContent = String(e && e.message || e); connectBtn.disabled = false; }
    } }, 'Connect');
    s.setBody(h('div', { class: 'list', style: { padding: '0 4px' } }, [
      field('Bridge Server port', portEl, 'The port it printed when you first ran it (7777 unless you changed it)'),
      field('Access token', tokenEl),
      field('Printer name', printerEl, 'Exactly as it appears in the Bridge Server\'s config.json'),
      errEl,
      h('div', { style: { display: 'flex', gap: '10px', marginTop: '4px' } }, [connectBtn, h('button', { class: 'btn', onclick: draw }, 'Back')]),
    ]));
  }
  P.onchange(() => { if (s.el.isConnected) draw(); });
  draw();
}
const printerLabel = () => { const i = typeof auzPrinter !== 'undefined' ? auzPrinter.info() : null; return i ? i.name : 'Print window'; };
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
