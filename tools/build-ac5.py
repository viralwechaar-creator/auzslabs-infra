#!/usr/bin/env python3
"""Builds site/ac5.css and site/ac5.js (the account dashboard design) from the approved design file.
Usage: python3 tools/build-ac5.py /path/to/design-lite.html   (design file with image data removed)"""
import re, sys
src = open(sys.argv[1]).read().split('\n')
L = lambda a, b: '\n'.join(src[a - 1:b])          # 1-based inclusive
css = L(6, 1060)
css = re.sub(r'body::before\{.*?\}\n', '', css, flags=re.S, count=1)
css = css.replace('@media (prefers-color-scheme:dark){:root:not([data-theme="light"])', '@media (prefers-color-scheme:dark){:host(:not([data-theme="light"]))')
css = css.replace(':root:not([data-theme="light"])', ':host(:not([data-theme="light"]))')
css = re.sub(r':root\[data-theme="dark"\]', ':host([data-theme="dark"])', css)
css = css.replace(':root{', ':host{')
css = css.replace('html,body{margin:0}', '').replace('html body ', ':host ')
css = re.sub(r'(^|\n)body\{', r'\1:host{display:block;', css)
css = css.replace(':host{display:block;padding-top:54px}', ':host{display:block}')
css += '''
:host{display:block;min-height:100vh;position:relative;padding-block:10px 24px}
slot{display:block}.slotwrap{background:var(--sheet);border-radius:18px;padding:6px 14px}
.pv,.cur,.sprog,.wl{display:none!important}
/* full-page layout: a side menu panel and the main area, no outer card */
:host{padding:0!important}
.sheet{max-width:none!important;width:100%;margin:0!important;border-radius:0!important;box-shadow:none!important;background:var(--bg)!important;min-height:100vh!important}
.mainc{zoom:.94}
@media (min-width:900px){
 .rail{position:sticky;top:0;height:100vh;overflow-y:auto;background:var(--sheet)!important;border-right:1px solid var(--line)!important;zoom:.95}
 .mainc{padding:18px 26px 40px}
}
@media (max-width:899px){.mainc{padding:6px 10px 100px}}
/* phone: solid fixed header, band behind the tab bar, nav a little lower; stronger contrast everywhere */
:host{--bg:#e6e6e3;--line:rgba(0,0,0,.14);--dim:#5f5f64}
:host([data-theme="dark"]){--bg:#0e0e0e}
@media (prefers-color-scheme:dark){:host(:not([data-theme="light"])){--bg:#0e0e0e}}
.bento>section,.bento>label,.b-pill,.page .blk,.pbody,.svc,.rmat,.rmk,.tkt{box-shadow:0 0 0 1px var(--line),0 8px 18px -12px rgba(0,0,0,.35)!important}
.b-stack,.b-chips,.b-team,.b-sec{background:var(--sheet)!important}
.b-fan{background:var(--soft)!important}
.b-qa{background:var(--ink)!important;color:var(--sheet)}
.b-qa .bl{color:rgba(255,255,255,.7)}
:host([data-theme="dark"]) .b-qa{color:#111}
.bl,.bs,.bkv dt,.lab{color:var(--dim)}
.tbig b{font-weight:800}
@media (max-width:899px){
 :host::before{content:"";position:fixed;left:0;right:0;top:0;height:env(safe-area-inset-top,0px);background:var(--bg);z-index:40}
 .top{position:fixed!important;top:env(safe-area-inset-top,0px);left:0;right:0;z-index:30;padding:10px 18px 10px!important;background:var(--bg);box-shadow:0 1px 0 var(--line);margin:0}
 .top .lab{display:inline!important}
 .mainc{padding-top:calc(54px + env(safe-area-inset-top,0px))!important}
 .home{padding-top:0}
 :host::after{content:"";position:fixed;left:0;right:0;bottom:0;height:calc(70px + env(safe-area-inset-bottom,0px));background:linear-gradient(transparent 0,var(--bg) 22px);z-index:11;pointer-events:none}
 .tabbar{bottom:calc(6px + env(safe-area-inset-bottom,0px))!important;z-index:12}
 .mainc{padding-bottom:120px!important}
}

.nxg{margin:0 0 8px}.nxh{display:flex;align-items:center;gap:10px;width:100%;border:0;background:var(--field);border-radius:12px;padding:10px 12px;font:600 12px var(--font);color:var(--ink);cursor:pointer;justify-content:space-between}
.nxh i{font-style:normal;font-size:16px;color:var(--dim)}
.nxr{display:grid;grid-template-columns:10px 1fr;gap:4px 10px;align-items:center;padding:8px 6px;border-bottom:1px solid var(--line)}
.nxr .nxb{display:grid;grid-template-columns:minmax(0,1fr) auto;width:100%;gap:10px;text-align:left;border:0;background:none;padding:0;font:500 12.5px var(--font);color:var(--ink);min-width:0}
.nxr .nxb b{flex:1;min-width:0;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.nxr .nxb em{font-style:normal;color:var(--dim);font-size:11px;white-space:nowrap}
.nxr .nxd{grid-column:2;display:grid;gap:8px;padding:2px 0 6px}.nxr .nxd small{color:var(--dim);font-size:12px}
.nxr.un .nxt{background:var(--ink)}.nxr .nxt{width:7px;height:7px;border-radius:50%;background:var(--line)}
.tline{max-height:none}
/* phone: balanced cards. Team and sign-ins sit side by side, apps as a two-column grid, plan card filled */
@media (max-width:899px){
 .bento{grid-template-columns:1fr 1fr!important}
 .bento>*{grid-column:1/-1}
 .b-team,.b-sec{grid-column:span 1!important;min-width:0;padding:12px!important}
 .b-team .tbig,.b-sec .tbig{flex-direction:column;align-items:flex-start;gap:0}
 .b-team .tbig b,.b-sec .tbig b{font-size:34px;line-height:1}
 .b-team .tbig small,.b-sec .tbig small{font-size:11px}
 .avrow{display:flex;flex-wrap:wrap;gap:6px}
 .bars{height:44px}
 .bchips{display:grid!important;grid-template-columns:1fr 1fr;gap:8px}
 .bchips .bc{width:100%;text-align:center;padding:10px 8px}
 .b-fan{min-height:150px}
 .b-qa .qa button{color:var(--ink)!important}
 .b-stack{min-height:0!important}.stk:has(.empty){height:auto!important;min-height:0!important}.b-stack .empty{padding:16px 0}
 .fan{width:100%!important;right:0!important;left:0;transform:none!important;display:flex;justify-content:center}
 .fan .f0,.fan .f1{display:none}
 .fan .f2{position:relative!important;right:auto!important;bottom:auto!important;width:80%!important;height:auto!important;margin-top:6px;border-radius:14px}
}

.mainc .blk,.mainc .pbody,.mainc .pcard,.mainc .svc,.mainc .b-main,.mainc .b-stack,.mainc .b-chips,.mainc .b-fan,.mainc .b-team,.mainc .b-sec,.mainc .b-qa{border-radius:16px}
a{color:inherit;text-decoration:none}a.svc.add{text-decoration:none}
'''
open('site/ac5.css', 'w').write(css)

blocks = [L(1118, 1128), L(1130, 1172), L(1177, 1231), L(1232, 1239)]
core = '\n'.join(blocks)
core = core.replace('data-toast="Signed out (example)"', 'data-act="signout"')

js = r'''/* Account dashboard (account.html): the redesigned shell. Generated by tools/build-ac5.py from the approved design.
   It draws the navigation, overview and headings inside a shadow root; every form and save is still the page's own code,
   shown through slots. Remove the ac5 tags from account.html to bring the old shell back. */
(function () {
  'use strict';
  var g = function (n) { try { return (0, eval)(n); } catch (e) { return undefined; } };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var host, root, ready = false;
  var $ = function (s) { return root.querySelector(s); }, $$ = function (s) { return Array.prototype.slice.call(root.querySelectorAll(s)); };
  var APPDEF = [['pos', 'AUZsPOS', 'Billing, tables, kitchen, QR orders', 'till'], ['payroll', 'AUZsPay', 'Attendance, leave and payslips', 'users'], ['accounting', 'AUZsLedger', 'Accounts, GST and banking', 'book'], ['mobile', 'AUZsMob', 'Phone shop sales and repairs', 'phone'], ['style', 'AUZsStyle', 'Clothing and footwear shop', 'tag'], ['scan', 'AUZsScan', 'Scan to bill', 'scan'], ['salon', 'AUZslab Salon', 'Booking, billing, website', 'tag'], ['finance', 'AUZsFinance', 'Money in, out and dues', 'book']];
  var BIZ = {}, ME = {}, ALL_APPS = [], OWNED = {}, ENABLED = {}, STAFF = [], ROLES = [], NOTIFS = [], SESSIONS = [], REQS = [], CART = [], PROFILE = { products: [] };
  window.AC5 = { ACT: {}, AFTER: {}, ENTER: {}, OWN: {}, VIEWS: null };
  var S = { mode: 'owner', view: 'home', more: false, railOpen: false, nf: 'all' };
  var PANES = ['profile', 'account', 'services', 'staff', 'roles', 'notifications', 'privacy'];
  var SLOT = { profile: 'profile', security: 'account', services: 'services', staff: 'staff', roles: 'roles', notifications: 'notifications', privacy: 'privacy' };
  function profPct() { var P = g('PROFILE') || {}, k = ['name', 'phone', 'contact_email', 'business_name', 'business_type', 'city', 'address'], d = k.filter(function (x) { return P[x]; }).length; return Math.round(d / k.length * 100); }
  function sync() {
    var D = g('DASH'), P = g('PROFILE') || {}, A = g('IS_ADMIN');
    S.mode = D ? (D.my_role === 'owner' ? 'owner' : 'manager') : 'customer';
    var t = (D && D.tenant) || {};
    BIZ = { name: t.name || '', slug: t.slug || '', plan: t.plan || '', status: t.status || 'active', renewal: t.renewal_date ? new Date(t.renewal_date).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : 'Not set', since: t.created_at ? new Date(t.created_at).toLocaleDateString(undefined, { month: 'short', year: 'numeric' }) : '' };
    ME = { name: P.name || (D && D.my_email) || 'Welcome', email: (D && D.my_email) || g('LOGIN_EMAIL') || '', phone: P.phone || '' };
    var f = (D && D.features) || {}, en = (D && D.enabled_features) || {}, links = {};
    document.querySelectorAll('#acctNav a[id^=open]').forEach(function (a) { if (a.style.display !== 'none') links[a.textContent.trim().replace(/^Open /, '').replace(/ system$/i, '')] = a.href; });
    ALL_APPS = APPDEF.map(function (a) { return { k: a[0], n: a[1], d: a[2], ic: a[3], href: links[a[1]] || '' }; });
    OWNED = {}; ENABLED = {}; APPDEF.forEach(function (a) { if (f[a[0]] === true) { OWNED[a[0]] = true; ENABLED[a[0]] = en[a[0]] !== false; } });
    STAFF = (g('STAFF') || []).map(function (s) { return { name: s.name || s.email || '', role: s.role }; }); if (!STAFF.length && D) STAFF = [{ name: ME.name, role: 'owner' }];
    ROLES = g('ROLES') || [];
    NOTIFS = (g('NOTIFS') || []).map(function (n) { return { t: n.title || '', b: n.body || '', at: n.created_at ? new Date(n.created_at).toLocaleDateString() : '', read: !!n.read }; });
    SESSIONS = g('SESSIONS') || [];
    CART = (window.AUZcart && AUZcart.get()) || [];
    var lab = {}; (g('PRODUCT_CHOICES') || []).forEach(function (p) { lab[p[0]] = p[1].replace(/\s*\(.*$/, ''); });
    CART = CART.map(function (k) { return lab[k] || k; });
    PROFILE = { products: (P.products || []).map(function (k) { return lab[k] || k; }) };
    ME.admin = !!A;
  }
''' + core + r'''

  /* ---------- section pages ---------- */
  var VIEWS = {}; AC5.VIEWS = VIEWS;
  var slot = function (id) { return '<div class="slotwrap"><slot name="p-' + id + '"></slot></div>'; };
  var TEXT = { profile: 'Your details and business information.', security: 'Your login, devices and safety settings.', services: 'What is switched on for your business.', staff: 'Staff and their sign-in details.', roles: 'Choose what each team member can open.', notifications: 'A simple inbox for your account.', privacy: 'Your consent, your data and your rights under the DPDP Act 2023.' };
  ['profile', 'security', 'services', 'staff', 'roles', 'notifications', 'privacy'].forEach(function (id) {
    VIEWS[id] = function () { return head(({ security: 'Account and security', privacy: 'Privacy and my data' })[id] || (id.charAt(0).toUpperCase() + id.slice(1)), TEXT[id]) + slot(SLOT[id]); };
  });
  VIEWS.apps = function () {
    var mine = ALL_APPS.filter(function (a) { return OWNED[a.k]; });
    return head('Open an app', 'One link for each app your business can use.') + '<div class="lp">' + (mine.length ? mine.map(function (a, i) { var on = ENABLED[a.k] !== false; return '<div class="lpi' + (on ? '' : ' off') + '" style="--i:' + i + '"><a class="lpa" href="' + esc(a.href || '#') + '" target="_blank" rel="noopener" aria-label="Open ' + esc(a.n) + '">' + ic(a.ic) + '</a><b>' + esc(a.n) + '</b><small>' + (on ? 'Ready' : 'Switched off') + '</small>' + (on ? '<a class="btn sm" href="' + esc(a.href || '#') + '" target="_blank" rel="noopener">Open</a>' : '<button class="btn sm" data-go="services">Turn on</button>') + '</div>'; }).join('') : '<div class="empty"><b>Nothing switched on yet.</b> Add a service and we will set it up.</div>') + '</div>';
  };
  VIEWS.cart = function () {
    var steps = ['Request', 'Check', 'Quote', 'Pay', 'Live'], cur = CART.length ? 0 : -1;
    var trk = '<div class="trk2">' + steps.map(function (t, i) { return '<span class="tk' + (i <= cur ? ' on' : '') + '"><i>' + (i + 1) + '</i>' + t + '</span>'; }).join('<u></u>') + '</div>';
    var tk = CART.length ? '<div class="tkt"><div class="tkl"><span class="bl">Your request</span>' + CART.map(function (c, i) { return '<div class="tki"><b>' + esc(c) + '</b></div>'; }).join('') + '<p class="d" style="margin:10px 0 0;color:var(--dim);font-size:11.5px">Price is agreed in your quote.</p></div><div class="tkr"><b>' + CART.length + '</b><small>item' + (CART.length == 1 ? '' : 's') + '</small><a class="btn pri" href="cart.html">Open cart</a></div></div>' : '<div class="empty"><b>Your cart is empty.</b> Pick a service to start a request.</div>';
    return head('My cart', 'Pick services, send a request, and we reply with a quote.') + trk + tk + '<div class="savebar"><a class="btn" href="cart.html">Add services</a></div>';
  };
  VIEWS.help = function () {
    var c = '<div class="hc"><a class="hcc" href="#" data-copy="+91 92512 50829"><span class="ri">' + ic('call') + '</span><b>Call us</b><small>+91 92512 50829</small><em>Tap to copy</em></a><a class="hcc" href="#" data-copy="helloauzslab@gmail.com"><span class="ri">' + ic('mail') + '</span><b>Email us</b><small>helloauzslab@gmail.com</small><em>Tap to copy</em></a><a class="hcc" href="learn.html"><span class="ri">' + ic('book') + '</span><b>Beginner guide</b><small>Your first day, step by step</small><em>Open</em></a></div>';
    return head('Help and support', 'Talk to a person, or tell us what went wrong.') + c + '<div class="savebar"><button class="btn pri" data-act="help">Report a problem</button></div>';
  };
  var ringSVG = function (v, sz) { return '<svg class="rg" viewBox="0 0 36 36" width="' + sz + '" height="' + sz + '" aria-hidden="true"><circle class="trk" cx="18" cy="18" r="16" pathLength="100"/><circle class="arc" cx="18" cy="18" r="16" pathLength="100" style="--v:' + v + '"/></svg>'; };
  Object.assign(AC5, { g: g, esc: esc, ic: ic, head: head, F: F, inp: inp, sel: sel, ringSVG: ringSVG, toast: toast, go: go, S: S, $: function (q) { return $(q); }, $$: function (q) { return $$(q); }, render: function () { render(); }, data: function () { return { PROFILE: g('PROFILE') || {}, DASH: g('DASH'), ME: ME, CART: CART, ALL_APPS: ALL_APPS }; }, set: function (n, v) { window.__v = v; (0, eval)(n + '=window.__v'); }, can: can, hasBiz: hasBiz, isOwner: isOwner });
  var LABEL = { home: 'Overview' }; SECTIONS.forEach(function (s) { LABEL[s.id] = s.t; });

  /* ---------- draw ---------- */
  function setup() {
    host = document.createElement('div'); host.id = 'a5'; document.body.appendChild(host);
    root = host.attachShadow({ mode: 'open' });
    var link = document.createElement('link'); link.rel = 'stylesheet'; link.href = 'ac5.css?v=10'; root.appendChild(link);
    var fonts = document.createElement('style'); fonts.textContent = ''; root.appendChild(fonts);
    var box = document.createElement('div'); box.innerHTML = '<main class="sheet m-home" id="app"><aside class="rail" id="rail"></aside><div class="mainc"><slot name="banner"></slot><div class="home" id="home"></div><div class="pagewrap" id="pagewrap"></div></div></main><nav class="tabbar" id="tabbar" aria-label="Main"></nav><div id="sheetwrap"></div><div class="toast" id="toast" role="status"></div>';
    while (box.firstChild) root.appendChild(box.firstChild);
    var wrap = document.getElementById('a5') ; var sync_theme = function () { host.setAttribute('data-theme', document.documentElement.getAttribute('data-theme') || ''); };
    sync_theme(); new MutationObserver(sync_theme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    PANES.forEach(function (id) { var p = document.getElementById('pane-' + id); if (p) { p.setAttribute('slot', 'p-' + id); p.classList.add('a3-pane', 'a3-multi'); host.appendChild(p); } });
    var foldAll = function () { PANES.forEach(function (id) { var p = document.getElementById('pane-' + id); if (!p) return; p.querySelectorAll(':scope>.card:not(.fc2)').forEach(function (c, i) { var h = c.firstElementChild; if (!h || !/^(H2|H3|H4)$/.test(h.tagName) && !h.classList.contains('h-2')) return; c.classList.add('fc2'); var b = document.createElement('div'); b.className = 'fc2b'; while (h.nextSibling) b.appendChild(h.nextSibling); c.appendChild(b); if (i === 0) c.classList.add('open'); h.addEventListener('click', function () { c.classList.toggle('open'); }); }); }); };
    PANES.forEach(function (id) { var p = document.getElementById('pane-' + id); if (p) new MutationObserver(function () { clearTimeout(foldAll.t); foldAll.t = setTimeout(foldAll, 40); }).observe(p, { childList: true }); }); foldAll();
    root.addEventListener('click', function (e) {
      var d = e.target.closest('[data-go]'); if (d) { e.preventDefault(); go(d.getAttribute('data-go')); return; }
      var c = e.target.closest('[data-copy]'); if (c) { e.preventDefault(); copy(c.getAttribute('data-copy')); return; }
      var a = e.target.closest('[data-act]'); if (a) { e.preventDefault(); act(a.getAttribute('data-act'), a); }
    });
    root.addEventListener('keydown', function (e) { if (e.target.id !== 'hAsk' || e.key !== 'Enter') return; var q = e.target.value.trim().toLowerCase(); var hit = SECTIONS.filter(function (x) { return !x.d && can(x) && x.t.toLowerCase().indexOf(q) > -1; })[0]; if (hit) go(hit.id); else toast('No section called "' + e.target.value + '"'); });
  }
  function toast(t) { var e = $('#toast'); e.textContent = t; e.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(function () { e.classList.remove('on'); }, 2200); }
  function copy(t) { try { navigator.clipboard.writeText(t).then(function () { toast('Copied'); }, function () { toast(t); }); } catch (e) { toast(t); } }
  function act(a, el) {
    if (AC5.ACT[a]) { AC5.ACT[a](el); return; }
    if (a === 'railToggle') { S.railOpen = !S.railOpen; render(); }
    else if (a === 'moreOpen') { S.more = true; render(); } else if (a === 'moreClose') { S.more = false; render(); }
    else if (a === 'signout') { var b = document.getElementById('signOutBtn'); if (b) b.click(); }
    else if (a === 'help') { try { auzHelp.open(g('sb')); } catch (e) {} }
  }
  function go(v) {
    var s = SECTIONS.filter(function (x) { return x.id === v; })[0]; if (v !== 'home' && (!s || !can(s))) v = 'home';
    S.more = false; S.view = v;
    if (AC5.ENTER[v]) { try { AC5.ENTER[v](); } catch (e) {} }
    if (SLOT[v] && !AC5.OWN[v] && typeof window.showTab === 'function') { try { window.showTab(SLOT[v]); } catch (e) {} }
    try { history.replaceState(null, '', '#' + (v === 'home' ? 'overview' : v)); } catch (e) {}
    render(); window.scrollTo({ top: 0 });
  }
  function render() {
    sync();
    var app = $('#app'); app.classList.toggle('m-home', S.view === 'home'); app.classList.toggle('m-page', S.view !== 'home'); app.classList.toggle('rail-open', !!S.railOpen);
    $('#rail').innerHTML = railHTML();
    $('#home').innerHTML = '<div class="top m-only"><span class="brand">AUZslab</span><span class="lab">Account</span></div>' + bentoHTML();
    var pw = $('#pagewrap');
    if (S.view === 'home') pw.innerHTML = '';
    else { var fn = VIEWS[S.view]; if (!fn) { S.view = 'home'; return render(); } pw.setAttribute('data-p', S.view); pw.innerHTML = '<div class="top"><span class="brand m-only">AUZslab</span><span class="lab">' + esc(LABEL[S.view]) + '</span></div><div class="page">' + fn() + '</div>'; }
    $('#home').classList.toggle('d-hide', S.view !== 'home');
    $('#sheetwrap').innerHTML = S.more ? moreSheet() : '';
    $('#tabbar').innerHTML = tabbarHTML();
    $$('.page .ph,.bento>*,.page>*').forEach(function (n) { n.classList.add('in'); });
    $$('[data-count]').forEach(function (c) { c.textContent = c.getAttribute('data-count'); });
    if (AC5.AFTER[S.view]) { try { AC5.AFTER[S.view](); } catch (e) { console.error(e); } }
    var bn = document.getElementById('consentBanner'); if (bn && bn.getAttribute('slot') !== 'banner') { bn.setAttribute('slot', 'banner'); host.appendChild(bn); }
  }
  var st = document.createElement('style'); st.textContent = '@media (min-width:900px){.d-hide{display:none}.m-page .home{display:none}.m-page .pagewrap{display:block}.m-home .pagewrap{display:none}}@media (max-width:899px){.d-hide{display:none}}'; 
  function start() {
    document.body.classList.add('ac3', 'ac5');
    var tries = 0, t = setInterval(function () {
      tries++; var nav = document.getElementById('acctNav');
      if (nav && nav.style.display !== 'none' && nav.style.display !== '') {
        clearInterval(t); setup(); root.appendChild(st); ready = true;
        var h = (location.hash || '').slice(1); var map = { overview: 'home', account: 'security' };
        sync(); S.view = 'home'; render(); var v = map[h] || h; if (!v && !g('DASH')) v = 'profile'; if (v && v !== 'home') go(v);
        window.addEventListener('hashchange', function () { var x = (location.hash || '').slice(1); x = map[x] || x; if (x && x !== S.view) go(x); });
        setInterval(function () { if (!document.hidden && (S.view === 'home' || S.view === 'cart' || S.view === 'apps')) render(); }, 15000);
        document.addEventListener('click', function (e) { if (e.target.closest && e.target.closest('#consentBanner #cbOpen')) go('privacy'); });
      } else if (tries > 100) clearInterval(t);
    }, 150);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
'''
open('site/ac5.js', 'w').write(js)
print('ok', len(css), len(js))
