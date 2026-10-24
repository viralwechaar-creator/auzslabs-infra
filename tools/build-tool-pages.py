#!/usr/bin/env python3
"""Writes site/cart.html and site/pay.html in the new design (u.css + t.css).
The header, menu sheet and phone dock are copied from site/contact.html so they always match the marketing pages."""
import re, sys, os
ROOT = os.path.join(os.path.dirname(__file__), '..')
SITE = os.path.join(ROOT, 'site')

def chrome():
    s = open(os.path.join(SITE, 'contact.html')).read().split('\n')
    top = '\n'.join(s[104:124])
    dock = s[158]
    top = top.replace(' class="on"', '')
    # no contact modal on tool pages: Let's talk / chat open the contact page
    top = top.replace('<button class="btn" data-open-contact>Let\'s talk</button>', '<a class="btn" href="contact.html">Let\'s talk</a>')
    dock = dock.replace('<button class="chat" data-open-contact aria-label="Talk to us">', '<a class="chat" href="contact.html" aria-label="Talk to us">')
    dock = re.sub(r'(<a class="chat"[^>]*>.*?</svg>)</button>', r'\1</a>', dock)
    return top, dock

HEAD = '''<!doctype html>
<html lang="en">
<head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="robots" content="noindex,nofollow">
<title>%(title)s</title>
<link rel="icon" href="/logo.png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="manifest" href="/manifest.json">
<script src="theme.js?v=101"></script>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="u.css?v=4"><link rel="stylesheet" href="t.css?v=2"><link rel="stylesheet" href="fluid.css?v=3">
<meta name="theme-color" content="#efeeed">
</head>
<body class="mk-page">
'''

def page(title, body, scripts):
    top, dock = chrome()
    return (HEAD % {'title': title}) + top + '\n  <main class="content">\n' + body + '\n  </main>\n</div>\n' + dock + '\n' + scripts + '\n</body>\n</html>\n'

CHECK = '<span class="bx"><svg viewBox="0 0 12 12"><path d="M2 6.5l2.7 2.7L10 3.5"/></svg></span>'
def opt(key, name, desc):
    return '<label class="tl-opt"><input type="checkbox" data-k="%s">%s<span><b>%s</b><small>%s</small></span></label>' % (key, CHECK, name, desc)

CART_BODY = '''    <div class="tl">
      <div class="tl-head"><span class="tl-eye">Your request</span><h1 class="tl-h">Tell us what you need.</h1>
      <p class="tl-sub">Choose your services and tell us about your business. We check it, send you a quote made for your business, and you pay. Nothing is charged on this page.</p></div>
      <ol class="tl-steps" id="steps"><li class="on">Choose and tell us</li><li>We send your quote</li><li>You pay</li></ol>

      <div id="formWrap" class="tl-grid two">
        <div>
          <section class="tl-card">
            <span class="tl-cap">1 &middot; What do you want?</span>
            <div class="tl-pick" id="pick">
              %(opts)s
            </div>
            <div class="tl-notice" id="yearNote"></div>
          </section>
          <section class="tl-card">
            <span class="tl-cap">Add-ons, quoted separately</span>
            <div class="tl-pick" id="pickAdd">
              %(adds)s
            </div>
            <p class="tl-note">One-time onboarding fee: &#8377;1,360. These add-ons are not part of any service and are priced in your quote.</p>
          </section>
        </div>

        <div class="side">
          <section class="tl-card" id="signedOut" style="display:none">
            <h2>Sign in to send your request</h2>
            <p class="tl-note">Use your Google account or email. Your choices above are saved.</p>
            <div class="tl-actions"><a class="tb pri wide" href="signup.html?next=cart.html">Sign in or create account</a></div>
          </section>

          <form class="tl-card" id="reqForm" novalidate style="display:none">
            <span class="tl-cap">2 &middot; Your business</span>
            <p class="tl-note" id="whoLine" style="margin:-4px 0 10px"></p>
            <div id="detail">
              <div class="tf-row two">
                <label class="tf"><span>Your name</span><input id="rqName" autocomplete="name" required></label>
                <label class="tf"><span>Mobile / WhatsApp</span><input id="rqPhone" type="tel" inputmode="tel" autocomplete="tel" placeholder="9876543210" required></label>
              </div>
              <div id="newBiz">
                <label class="tf"><span>Business name</span><input id="rqBiz" autocomplete="organization"></label>
                <div class="tf-row two">
                  <label class="tf"><span>Business type</span><select id="rqNiche"><option value="cafe">Cafe / restaurant / hotel</option><option value="retail">Retail / general shop</option><option value="salon">Salon / spa</option><option value="mobile">Mobile shop / repair</option><option value="general">Something else</option></select></label>
                  <label class="tf"><span>Email <em>(optional)</em></span><input id="rqEmail" type="email" autocomplete="email"></label>
                </div>
              </div>
              <label class="tf"><span>Business address <em>(optional)</em></span><textarea id="rqAddress" rows="2" autocomplete="street-address" placeholder="Shop, area, city, PIN"></textarea></label>
              <label class="tf"><span>GSTIN <em>(if you have one)</em></span><input id="rqGstin" maxlength="15" autocapitalize="characters" autocomplete="off" placeholder="08ABCDE1234F1Z5"></label>
              <label class="tf"><span>Anything we should know? <em>(optional)</em></span><textarea id="rqReq" rows="3" placeholder="How many outlets and staff, when you want to start"></textarea></label>
            </div>
            <div class="tl-actions"><button class="tb pri wide" id="rqSend" type="submit">Send request</button></div>
            <div class="tl-err" id="rqErr"></div>
            <p class="tl-note">We read every request and reply on WhatsApp.</p>
          </form>

          <section class="tl-card" id="mine" style="display:none"><span class="tl-cap">Your earlier requests</span><div id="mineList"></div></section>
        </div>
      </div>

      <section class="tl-card" id="sent" style="display:none;max-width:560px">
        <span class="tl-cap">Request received</span>
        <h2 style="font-size:20px">Thank you. We have your request.</h2>
        <p class="tl-note" style="font-size:12.5px;margin-top:8px">We will check your business and send your quote and payment page on WhatsApp, usually the same day. You can follow it here any time.</p>
        <div class="tl-actions"><a id="trackLink" class="tb pri" href="#">Follow my request</a><a class="tb" href="index.html">Back to home</a></div>
      </section>
    </div>'''

CART_JS = r'''<script>
const sb = supabase.createClient(CFG.url, CFG.key);
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// only the restaurant POS (and its QR ordering) can be bought monthly; every other service is a yearly plan
const MONTHLY_OK = ['pos', 'self_order'];
const NAME = { pos: 'AUZsPOS', self_order: 'AUZsPOS QR', payroll: 'AUZsPay', accounting: 'AUZsLedger', scan: 'AUZsScan', mobile: 'AUZsMob', style: 'AUZsStyle', finance: 'AUZsFinance', salon: 'AUZslab Salon' };
const KEY = 'auz_cart';
const getSel = () => { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (e) { return []; } };
const setSel = (a) => { try { localStorage.setItem(KEY, JSON.stringify(a)); } catch (e) {} };
let DASH = null, SESSION = null;

try { const pre = new URLSearchParams(location.search).get('add'); if (pre && NAME[pre]) { const a = getSel(); if (!a.includes(pre)) { a.push(pre); setSel(a); } } } catch (e) {}

function paint() {
  const sel = getSel();
  document.querySelectorAll('#pick input,#pickAdd input').forEach((i) => { i.checked = sel.includes(i.dataset.k); });
  const yearly = sel.filter((k) => NAME[k] && !MONTHLY_OK.includes(k));
  const n = $('yearNote');
  if (yearly.length) {
    n.classList.add('on');
    n.innerHTML = esc(yearly.map((k) => NAME[k]).join(', ')) + (yearly.length > 1 ? ' are' : ' is') + ' currently available on a <b>yearly plan</b>. For further queries <a href="contact.html">contact AUZslab</a>.';
  } else n.classList.remove('on');
}
document.querySelectorAll('#pick input,#pickAdd input').forEach((i) => {
  i.addEventListener('change', () => {
    let a = getSel().filter((k) => k !== i.dataset.k);
    if (i.checked) a.push(i.dataset.k);
    setSel(a); paint();
  });
});

(function () {
  $('rqGstin').addEventListener('input', () => { $('rqGstin').value = $('rqGstin').value.toUpperCase().replace(/[^0-9A-Z]/g, ''); });
})();

async function loadMine() {
  const { data } = await sb.rpc('my_client_orders').catch(() => ({ data: null }));
  const rows = data || [];
  $('mine').style.display = rows.length ? 'block' : 'none';
  const T = { requested: 'Received', verifying: 'Checking', confirmed: 'Preparing quote', link_sent: 'Quote ready', payment_submitted: 'Payment received', paid: 'Active', rejected: 'Closed' };
  $('mineList').innerHTML = rows.map((o) => `<a class="tl-row" href="pay.html?t=${esc(o.token)}"><span><b>${esc(o.business_name || 'Request')}</b><br><span class="m">${esc((o.products || []).map((k) => NAME[k] || k).join(', '))}</span></span><span class="tl-chip ${o.status === 'link_sent' ? 'warn' : o.status === 'paid' ? 'ok' : ''}">${esc(T[o.status] || o.status)}</span></a>`).join('');
}

async function checkSession() {
  const { data: { session } } = await sb.auth.getSession();
  SESSION = session;
  if (!session) { $('signedOut').style.display = 'block'; $('reqForm').style.display = 'none'; return; }
  $('signedOut').style.display = 'none'; $('reqForm').style.display = 'block';
  $('rqEmail').value = session.user.email || '';
  DASH = await AUZaccount.fetch(sb);
  if (DASH) {
    $('newBiz').style.display = 'none';
    $('whoLine').innerHTML = 'Adding services to <b>' + esc(DASH.tenant.name) + '</b>';
  } else {
    $('whoLine').innerHTML = 'Signed in as <b>' + esc(session.user.email) + '</b>';
    const { data: pr } = await sb.rpc('my_profile').catch(() => ({ data: null }));
    const P = (pr && pr.profile) || null;
    if (P) {
      if (P.name) $('rqName').value = P.name; if (P.phone) $('rqPhone').value = P.phone; if (P.business_name) $('rqBiz').value = P.business_name;
      if (P.address) $('rqAddress').value = P.address;
      if (P.niche && $('rqNiche').querySelector('option[value="' + P.niche + '"]')) $('rqNiche').value = P.niche;
    }
  }
  loadMine();
}

$('reqForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('rqErr'); err.textContent = '';
  const sel = getSel();
  const p = { contact_name: $('rqName').value.trim(), phone: $('rqPhone').value.trim(), email: $('rqEmail').value.trim(), business_name: $('rqBiz').value.trim(), niche: $('rqNiche').value,
    gstin: $('rqGstin').value.trim(), address: $('rqAddress').value.trim(), requirement: $('rqReq').value.trim(), products: sel };
  if (!sel.length) { err.textContent = 'Please choose at least one service above.'; window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
  if (!p.contact_name) { err.textContent = 'Please enter your name.'; return; }
  if (p.phone.replace(/\D/g, '').length < 10) { err.textContent = 'Please enter your mobile number (10 digits).'; return; }
  if (!DASH && !p.business_name) { err.textContent = 'Please enter your business name.'; return; }
  if (p.gstin && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/.test(p.gstin)) { err.textContent = 'That GSTIN does not look right. Leave it empty if you have none.'; return; }
  const btn = $('rqSend'); btn.disabled = true; btn.textContent = 'Sending...';
  const { data, error } = await sb.rpc('submit_client_order', { p });
  btn.disabled = false; btn.textContent = 'Send request';
  if (error) { err.textContent = error.message; return; }
  setSel([]);
  try { localStorage.setItem('auz_order_token', data.token); } catch (x) {}
  $('formWrap').style.display = 'none'; $('sent').style.display = 'block';
  const st = document.querySelectorAll('#steps li'); st[0].className = 'done'; st[1].className = 'on';
  $('trackLink').href = 'pay.html?t=' + encodeURIComponent(data.token);
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

paint(); checkSession();
</script>'''

SCRIPTS_COMMON = '''<script src="/sb-client.js?v=105"></script>
<script src="site.js?v=113"></script>
<script>window.CFG = { url: 'https://api.auzslab.in', key: '' };</script>
<script src="orderterms.js?v=105"></script>'''

def build_cart():
    prods = [
        ('pos', 'AUZsPOS', 'Billing, tables, kitchen, stock and customers for cafes and restaurants'),
        ('self_order', 'AUZsPOS QR', 'Customers order from the table by scanning a QR'),
        ('payroll', 'AUZsPay', 'Attendance, leave and salary for your staff'),
        ('accounting', 'AUZsLedger', 'Invoices, bills, GST and full accounts'),
        ('scan', 'AUZsScan', 'Scan barcodes to bill and manage stock'),
        ('mobile', 'AUZsMob', 'For mobile phone shops: sales, repairs, stock, dues'),
        ('style', 'AUZsStyle', 'Clothing and footwear: sizes, colours, tags, online store'),
        ('finance', 'AUZsFinance', 'Money in and out, loans, dues, cash and bank'),
        ('salon', 'AUZslab Salon', 'Salon website, bookings, billing and clients'),
    ]
    adds = [('addon_hardware', 'Hardware integration', 'Printers, scanners, cash drawers, devices'),
            ('addon_website', 'Website', 'A website made for your business'),
            ('addon_whatsapp', 'WhatsApp automation', 'Automatic messages to your customers')]
    body = CART_BODY % {'opts': '\n              '.join(opt(*p) for p in prods), 'adds': '\n              '.join(opt(*a) for a in adds)}
    return page('Your request — AUZslab', body, SCRIPTS_COMMON + '\n' + CART_JS)

# ---------------------------------------------------------------- pay page
PAY_BODY = '''    <div class="tl narrow">
      <div class="tl-head"><span class="tl-eye" id="eye">Your quote</span><h1 class="tl-h" id="ttl">Loading...</h1><p class="tl-sub" id="sub"></p></div>
      <ol class="tl-steps" id="steps"><li class="done">Request sent</li><li class="on">Your quote</li><li>Pay</li></ol>
      <div id="box"></div>
    </div>'''

PAY_JS = r'''<script>
const sb = supabase.createClient(CFG.url, CFG.key);
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const inr = (n) => '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const TOKEN = new URLSearchParams(location.search).get('t') || (function () { try { return localStorage.getItem('auz_order_token') || ''; } catch (e) { return ''; } })();
let O = null, CFGPAY = { enabled: false };

function steps(n) { const li = document.querySelectorAll('#steps li'); li.forEach((x, i) => { x.className = i < n ? 'done' : i === n ? 'on' : ''; }); }
function head(eye, title, sub) { $('eye').textContent = eye; $('ttl').textContent = title; $('sub').textContent = sub || ''; }

function billHtml(o) {
  const t = o.totals, q = o.quote || {};
  const lines = (t.lines || []).map((l) => `<tr><td>${esc(l.label)}${l.type === 'product' ? `<small>${l.plan === 'year' ? 'Yearly plan' : 'Monthly plan'}</small>` : ''}</td><td class="r">${inr(l.net)}</td></tr>`).join('');
  const gst = Number(t.gst) > 0 ? (t.intra ? `<tr class="sub"><td>CGST</td><td class="r">${inr(t.cgst)}</td></tr><tr class="sub"><td>SGST</td><td class="r">${inr(t.sgst)}</td></tr>` : `<tr class="sub"><td>IGST</td><td class="r">${inr(t.igst)}</td></tr>`) : '';
  return `<table class="tl-bill"><thead><tr><th>Service</th><th class="r">Amount</th></tr></thead><tbody>${lines}${gst}<tr class="tot"><td>Total to pay</td><td class="r">${inr(t.total)}</td></tr></tbody></table>${q.note ? `<p class="tl-note" style="margin-top:12px">${esc(q.note)}</p>` : ''}`;
}

function termsHtml() {
  const T = (window.AUZ_ORDER || {}).terms || [];
  return `<details class="tl-fold"><summary>Read the terms</summary>${T.map((t) => `<p><b>${esc(t[0])}.</b> ${esc(t[1])}</p>`).join('')}</details>`;
}

function show() {
  const o = O, st = o.status, box = $('box');
  const who = esc(o.business_name || '');
  if (st === 'rejected') { head('Request closed', 'This request is closed.', ''); steps(0); box.innerHTML = '<section class="tl-card"><p class="tl-note" style="font-size:12.5px">If you think this is a mistake, please contact AUZslab.</p><div class="tl-actions"><a class="tb pri" href="contact.html">Contact AUZslab</a></div></section>'; return; }
  if (st === 'requested' || st === 'verifying' || st === 'confirmed') {
    head('Request received', 'We are preparing your quote.', 'We check your business first. Your quote and payment page arrive on WhatsApp, usually the same day. This page updates when it is ready.');
    steps(1);
    box.innerHTML = `<section class="tl-card"><span class="tl-cap">${who}</span>${(o.products || []).map((k) => `<div class="tl-row"><b>${esc((window.AUZ_ORDER.labels || {})[k] || k)}</b><span class="tl-chip">Requested</span></div>`).join('')}<div class="tl-actions"><a class="tb" href="index.html">Back to home</a></div></section>`;
    return;
  }
  if (st === 'paid') {
    head('Paid', 'Thank you. You are all set.', 'Your payment is confirmed and your access is on.');
    steps(3);
    box.innerHTML = `<section class="tl-card"><div class="tl-row"><span>Bill number</span><b>${esc(o.invoice_no || '')}</b></div><div class="tl-row"><span>Amount paid</span><b>${inr(o.totals && o.totals.total)}</b></div><div class="tl-actions">${o.invoice_no ? `<a class="tb pri" href="inv.html?t=${encodeURIComponent(TOKEN)}">View my bill</a>` : ''}<a class="tb" href="https://app.auzslab.in/start.html">Open my apps</a></div></section>`;
    return;
  }
  if (st === 'payment_submitted') {
    const cash = o.payment && o.payment.method === 'cash';
    head('Payment', cash ? 'You chose cash in hand.' : 'We have your payment.', cash ? 'Please hand the amount to AUZslab. We switch your access on as soon as we receive it.' : 'We are confirming it. Your access starts as soon as it is confirmed.');
    steps(2);
    box.innerHTML = `<section class="tl-card"><span class="tl-cap">${who}</span>${billHtml(o)}</section>`;
    return;
  }
  // link_sent: the quote, then pay
  head('Your quote', 'Your quote is ready.', 'Check it, choose how you want to pay, and you are done.');
  steps(1);
  box.innerHTML = `<section class="tl-card"><span class="tl-cap">${who}</span>${billHtml(o)}</section>
  <section class="tl-card"><span class="tl-cap">Pay</span>
    <div class="tl-paychoice">
      ${CFGPAY.enabled ? `<label><input type="radio" name="pm" value="online" checked><span><b>Pay online</b><small>Card, UPI or net banking, safely through Razorpay</small></span></label>` : ''}
      <label><input type="radio" name="pm" value="cash" ${CFGPAY.enabled ? '' : 'checked'}><span><b>Cash in hand</b><small>Pay AUZslab in cash. We confirm it when we receive it</small></span></label>
    </div>
    <label class="tl-terms"><input type="checkbox" id="agree"><span>I accept the <a href="terms.html" target="_blank" rel="noopener">Terms</a>, <a href="privacy.html" target="_blank" rel="noopener">Privacy Policy</a> and <a href="refund.html" target="_blank" rel="noopener">Refund Policy</a>.</span></label>
    ${termsHtml()}
    <div class="tl-actions"><button class="tb pri wide" id="payBtn" type="button">Continue</button></div>
    <div class="tl-err" id="payErr"></div>
  </section>`;
  const pm = () => (document.querySelector('input[name=pm]:checked') || {}).value;
  const upd = () => { $('payBtn').textContent = pm() === 'online' ? 'Pay ' + inr(o.totals.total) : 'Confirm cash in hand'; };
  document.querySelectorAll('input[name=pm]').forEach((r) => r.addEventListener('change', upd)); upd();
  $('payBtn').onclick = () => pm() === 'online' ? payOnline() : payCash();
}

async function payCash() {
  const err = $('payErr'); err.textContent = '';
  if (!$('agree').checked) { err.textContent = 'Please tick the box to accept the Terms, Privacy Policy and Refund Policy.'; return; }
  $('payBtn').disabled = true;
  const { error } = await sb.rpc('public_order_choose_cash', { p_token: TOKEN, p_terms: true });
  $('payBtn').disabled = false;
  if (error) { err.textContent = error.message; return; }
  await load();
}

function loadCheckout() { return new Promise((res, rej) => { if (window.Razorpay) return res(); const s = document.createElement('script'); s.src = 'https://checkout.razorpay.com/v1/checkout.js'; s.onload = res; s.onerror = () => rej(new Error('Could not load the payment window. Check your internet and try again.')); document.head.appendChild(s); }); }
async function payOnline() {
  const err = $('payErr'); err.textContent = '';
  if (!$('agree').checked) { err.textContent = 'Please tick the box to accept the Terms, Privacy Policy and Refund Policy.'; return; }
  $('payBtn').disabled = true;
  try {
    const r = await fetch(CFG.url + '/payments/order/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: TOKEN, terms: true }) });
    const d = await r.json(); if (!r.ok) throw new Error(d.error || d.message || 'Could not start the payment.');
    await loadCheckout();
    const rz = new Razorpay({ key: d.keyId, amount: d.amount, currency: d.currency, order_id: d.orderId, name: 'AUZslab', description: d.description || 'AUZslab quote', prefill: d.prefill || { name: O.contact_name || '', contact: O.phone || '', email: O.email || '' }, theme: { color: '#800020' },
      handler: () => { waitPaid(); }, modal: { ondismiss: () => { $('payBtn').disabled = false; } } });
    rz.on('payment.failed', (resp) => { err.textContent = (resp && resp.error && resp.error.description) || 'The payment did not go through. You can try again.'; $('payBtn').disabled = false; });
    rz.open();
  } catch (e) { err.textContent = e.message; $('payBtn').disabled = false; }
}
async function waitPaid() {
  head('Payment', 'Confirming your payment...', 'Please keep this page open for a few seconds.');
  for (let i = 0; i < 30; i++) { await new Promise((r) => setTimeout(r, 1500)); await load(); if (O.status === 'paid') return; }
  $('sub').textContent = 'It is taking longer than usual. You do not need to pay again; we will confirm it shortly.';
}

async function load() {
  if (!TOKEN) { head('Your quote', 'We could not find your request.', ''); $('box').innerHTML = '<section class="tl-card"><div class="tl-actions"><a class="tb pri" href="cart.html">Start a request</a></div></section>'; return; }
  const { data, error } = await sb.rpc('public_client_order', { p_token: TOKEN });
  if (error || !data) { head('Your quote', 'This link is not valid.', ''); $('box').innerHTML = '<section class="tl-card"><div class="tl-actions"><a class="tb pri" href="cart.html">Start a request</a></div></section>'; return; }
  O = data; show();
}
(async function () {
  try { const c = await sb.payments.config(); CFGPAY = (c && c.data) || { enabled: false }; } catch (e) {}
  await load();
  setInterval(() => { if (O && ['requested', 'verifying', 'confirmed', 'payment_submitted'].includes(O.status)) load(); }, 20000);
})();
</script>'''

def build_pay():
    return page('Your quote — AUZslab', PAY_BODY, SCRIPTS_COMMON + '\n' + PAY_JS)

if __name__ == '__main__':
    open(os.path.join(SITE, 'cart.html'), 'w').write(build_cart())
    open(os.path.join(SITE, 'pay.html'), 'w').write(build_pay())
    print('cart + pay written')
