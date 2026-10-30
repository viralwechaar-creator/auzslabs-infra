/* Client dashboard (account.html): the new shell. It only builds the rail, the pages and the tiles; every section's content
   (profile, services, staff, roles, notifications, privacy, account) is still drawn by the page's own code and saved the same way.
   Remove the two ac2 files from account.html and the old page is back. */
(function () {
  'use strict';
  var body = document.body; body.classList.add('ac3');
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var g = function (n) { try { return (0, eval)(n); } catch (e) { return undefined; } };   // the page's own top-level variables
  var I = {
    grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    user: '<circle cx="12" cy="8" r="3"/><path d="M5 20c.5-4 3-6 7-6s6.5 2 7 6"/>',
    lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    svc: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>',
    cart: '<path d="M3 4h2l2 11h11l2-8H6"/><circle cx="9" cy="19" r="1"/><circle cx="17" cy="19" r="1"/>',
    team: '<circle cx="9" cy="8" r="3"/><path d="M3 19c0-3 2-5 6-5s6 2 6 5M16 6a3 3 0 0 1 0 5M17 14c2 0 4 2 4 4"/>',
    bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>',
    app: '<path d="M7 7h10v10H7z"/><path d="M12 3v4M12 17v4M3 12h4M17 12h4"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 4.4 1.7c-1.3 1-1.9 1.4-1.9 3M12 17.5v.1"/>'
  };
  var svg = function (k) { return '<svg viewBox="0 0 24 24">' + I[k] + '</svg>'; };
  var PRODUCTS = ['pos', 'self_order', 'payroll', 'accounting', 'mobile', 'scan', 'salon', 'style', 'finance'];
  var TITLES = { overview: 'Overview', profile: 'Profile', account: 'Account', services: 'Services', cart: 'Cart', staff: 'Staff', roles: 'Roles & access', notifications: 'Notifications', apps: 'Apps', privacy: 'Privacy', help: 'Help & support' };
  var RAIL = [['overview', 'grid'], ['profile', 'user'], ['account', 'lock'], ['services', 'svc'], ['cart', 'cart'], ['staff', 'team'], ['notifications', 'bell'], ['apps', 'app']];
  var BOTTOM = [['overview', 'grid'], ['apps', 'app'], ['services', 'svc'], ['notifications', 'bell'], ['profile', 'user']];
  var cur = 'overview', ready = false, shell, userGo = false;

  /* ---------- shell ---------- */
  function build() {
    shell = document.createElement('div'); shell.className = 'a3'; shell.id = 'a3';
    var nb = function (p) { return '<button class="a3-nb" data-go="' + p[0] + '" aria-label="' + TITLES[p[0]] + '">' + svg(p[1]) + '<span class="tip">' + TITLES[p[0]] + '</span>' + (p[0] === 'notifications' ? '<span class="dot" id="a3-dotn" hidden></span>' : '') + '</button>'; };
    shell.innerHTML =
      '<aside class="a3-rail"><a class="a3-logo" href="index.html" aria-label="AUZslab home">A.</a>' + RAIL.map(nb).join('') +
      '<div class="a3-rb"><button class="a3-nb" data-go="help" aria-label="Help">' + svg('help') + '<span class="tip">Help &amp; support</span></button></div></aside>' +
      '<main class="a3-main"><header class="a3-top"><div class="a3-crumb">AUZslab <span style="padding:0 8px">/</span><span id="a3-crumb">Overview</span></div>' +
      '<div class="a3-ta"><button class="a3-rb2" data-go="notifications" aria-label="Notifications">' + svg('bell') + '<span class="a3-badge" id="a3-badge"></span></button><button class="a3-user" id="a3-user">Account</button></div></header>' +
      '<div id="a3-pages"></div>' +
      '<div class="a3-foot"><span>AUZslab · Account</span><button class="a3-out" id="a3-out" type="button">Sign out</button></div></main>' +
      '<nav class="a3-bn" aria-label="Sections">' + BOTTOM.map(nb).join('') + '</nav>' +
      '<div class="a3-mb" id="a3-mb"><div class="a3-md"><h3 id="a3-mt"></h3><p class="a3-sub" id="a3-mp"></p><div class="a3-acts"><button class="a3-btn k" id="a3-mx" type="button">Close</button></div></div></div>';
    body.appendChild(shell);
    shell.addEventListener('click', function (e) {
      var t = e.target.closest('[data-go]'); if (t) { e.preventDefault(); go(t.getAttribute('data-go'), true); }
      var a = e.target.closest('[data-act]'); if (a) act(a.getAttribute('data-act'), a);
    });
    $('#a3-out').onclick = function () { var b = $('#signOutBtn'); if (b) b.click(); };
    $('#a3-user').onclick = function () { go('profile', true); };
    $('#a3-mx').onclick = function () { $('#a3-mb').classList.remove('on'); };
    $('#a3-mb').onclick = function (e) { if (e.target.id === 'a3-mb') e.target.classList.remove('on'); };
    // every section the page already draws gets its own place
    ['account', 'services', 'staff', 'roles', 'notifications', 'profile', 'privacy'].forEach(function (id) { ensurePage(id); });
    ['overview', 'cart', 'apps', 'help'].forEach(function (id) { ensurePage(id); });
  }
  function ensurePage(id) {
    var host = $('#a3-pages'), pg = $('#a3p-' + id); if (pg) return pg;
    pg = document.createElement('section'); pg.className = 'a3-page'; pg.id = 'a3p-' + id; host.appendChild(pg);
    pg.innerHTML = '<div class="a3-head" id="a3h-' + id + '"></div><div class="a3-canvas"><div class="a3-mos" id="a3m-' + id + '"></div></div>';
    var pane = $('#pane-' + id);
    if (pane) { pane.dataset.pane = id; pane.classList.add('a3-pane'); pg.querySelector('.a3-canvas').appendChild(pane); }
    return pg;
  }
  
  /* ---------- tiles ---------- */
  var tn = 0;
  function tile(cls, html, go_) { var i = tn++; return '<div class="a3-t ' + cls + (go_ ? ' c' : '') + '" style="--i:' + i + '"' + (go_ ? ' data-go="' + go_ + '"' : '') + '>' + html + '</div>'; }
  function foot(a, b) { return '<div class="a3-f"><span>' + a + '</span><span>' + (b || '↗') + '</span></div>'; }
  function head(id, k, h, sub, btns) {
    $('#a3h-' + id).innerHTML = '<div><div class="a3-k">' + k + '</div><h1 class="a3-h">' + h + '</h1><p class="a3-sub">' + sub + '</p></div><div class="a3-hb">' + (btns || '') + '</div>';
  }
  var btn = function (t, go_, k) { return '<button type="button" class="a3-btn' + (k ? ' k' : '') + '" data-go="' + go_ + '">' + t + '</button>'; };
  function apps() {
    var out = [];
    document.querySelectorAll('#acctNav a[id^=open]').forEach(function (a) { if (a.style.display === 'none') return; out.push({ name: a.textContent.trim().replace(/^Open /, ''), href: a.href }); });
    return out;
  }
  function counts() {
    var D = g('DASH'), N = g('NOTIFS') || [], S = g('STAFF') || [];
    var f = (D && D.features) || {}, en = (D && D.enabled_features) || {};
    return {
      D: D, services: PRODUCTS.filter(function (k) { return f[k] === true && en[k] !== false; }).length,
      unread: N.filter(function (n) { return !n.read; }).length, staff: S.length + 1,
      cart: (window.AUZcart && AUZcart.get().length) || 0, owner: !!(D && D.my_role === 'owner'),
      name: D ? D.tenant.name : ((g('PROFILE') || {}).business_name || (g('PROFILE') || {}).name || 'Welcome'), role: D ? D.my_role : 'customer'
    };
  }
  var pad = function (n) { return String(n).padStart(2, '0'); };

  function render(id) {
    var c = counts(), m = $('#a3m-' + id), D = c.D, P = g('PROFILE') || {}; tn = 0; var h = '';
    if (id === 'overview') {
      head('overview', 'Your account / Overview', 'Everything.<br>In its place.', 'A quiet space for your AUZslab account.',
        btn('Explore services ↗', D ? 'services' : 'cart') + (apps().length ? btn('Open your apps ↗', 'apps', 1) : ''));
      h += tile('dk s8 r2 a3-tp', '<div class="a3-l">Account / 01</div><h2>Welcome<br>back.</h2><p>' + esc(c.name) + ' · ' + esc(c.role) + '</p>' + foot('View your profile'), 'profile');
      if (D) {
        h += tile('s4 a3-tp', '<div class="a3-l">Services</div><div class="a3-s">' + pad(c.services) + '</div><p>Switched on for you</p>' + foot('Browse'), 'services');
        h += tile('sf s4 a3-tp', '<div class="a3-l">Notifications</div><div class="a3-s">' + pad(c.unread) + '</div><p>Unread</p>' + foot('View inbox'), 'notifications');
      }
      h += tile('wh s4 a3-tp', '<div class="a3-l">Your cart</div><div class="a3-s">' + pad(c.cart) + '</div><p>Selected services</p>' + foot('Review cart'), 'cart');
      if (c.owner) h += tile('s4 a3-tp', '<div class="a3-l">People / Access</div><h3>Team<br>space</h3><p>Staff and roles</p>' + foot('Manage access'), 'staff');
      else if (D) h += tile('s4 a3-tp', '<div class="a3-l">Security</div><h3>Account<br>settings</h3><p>Login and privacy</p>' + foot('Open'), 'account');
      if (apps().length) h += tile('dk s5 a3-tp', '<div class="a3-l">Workspace / 02</div><h2>' + esc(apps()[0].name.replace(/ system$/i, '')) + '</h2><p>Continue to your business workspace.</p>' + foot('Open your apps'), 'apps');
      h += tile('s7 a3-tp', '<div class="a3-l">Need a hand?</div><h2>Help, when<br>you need it.</h2>' + foot('Support &amp; report a problem'), 'help');
    } else if (id === 'profile') {
      head('profile', 'Account / Details', 'Your profile.', 'Personal details and business information.', btn('Privacy &amp; my data ↗', 'privacy'));
      h += tile('dk s4 r2 a3-tp', '<div class="a3-l">Profile / 01</div><div class="a3-n">' + esc(((P.name || c.name || 'A').match(/\b\w/g) || ['A']).slice(0, 2).join('').toUpperCase()) + '</div><h3>' + esc(P.name || c.name) + '</h3><p>' + esc(c.role === 'customer' ? 'Customer' : c.role) + '</p>' + foot('Account active', '●'));
      h += tile('s8 sf', '<div class="a3-l">Business</div><h3>' + esc(P.business_name || (D && D.tenant.name) || 'Your business') + '</h3><p>Everything below can be changed and saved.</p>');
    } else if (id === 'account') {
      head('account', 'Account / Security', 'Account.', 'Your login, business and safety settings.', btn('Privacy &amp; my data ↗', 'privacy'));
      h += tile('dk s5 a3-tp', '<div class="a3-l">Signed in as</div><h3 style="font-size:20px;word-break:break-all">' + esc(D ? D.my_email : '') + '</h3><p>' + esc(c.role) + '</p>' + foot('Your profile'), 'profile');
      h += tile('sf s7 a3-tp', '<div class="a3-l">Privacy</div><h3>Your data,<br>your choice.</h3>' + foot('Consent, download, requests'), 'privacy');
    } else if (id === 'services') {
      head('services', 'Account / Catalogue', 'Services.', 'What is switched on, and what you can add.', btn('View cart (' + c.cart + ') ↗', 'cart'));
      h += tile('dk s5 a3-tp', '<div class="a3-l">Active</div><div class="a3-n">' + pad(c.services) + '</div><p>Services on your account</p>');
      h += tile('sf s7 a3-tp', '<div class="a3-l">Add more</div><h3>Make it<br>yours.</h3><p>Pick products and send a request.</p>' + foot('Open cart'), 'cart');
    } else if (id === 'staff') {
      head('staff', 'Account / Team', 'Your people.', 'Staff and access in one place.', btn('Roles ↗', 'roles', 1));
      h += tile('dk s4 a3-tp', '<div class="a3-l">Team members</div><div class="a3-n">' + pad(c.staff) + '</div><p>Including you</p>');
      h += tile('sf s8 a3-tp', '<div class="a3-l">Roles</div><h3>Access by design.</h3><p>Set what each person can open.</p>' + foot('Manage roles'), 'roles');
    } else if (id === 'roles') {
      head('roles', 'Account / Permissions', 'Roles &amp; access.', 'Choose what each team member can open.', btn('← Staff', 'staff'));
      h += tile('dk s5 a3-tp', '<div class="a3-l">Account owner</div><h2>Full<br>access.</h2><p>All permissions, always.</p>');
    } else if (id === 'notifications') {
      head('notifications', 'Account / Activity', 'Updates.', 'A simple inbox for your account.', '<button type="button" class="a3-btn k" data-act="readall">Mark all read</button>');
      h += tile('dk s4 a3-tp', '<div class="a3-l">Unread</div><div class="a3-n">' + pad(c.unread) + '</div><p>Notifications</p>');
    } else if (id === 'privacy') {
      head('privacy', 'Account / Privacy', 'Privacy.', 'Consent, your data, and requests to us.', btn('← Account', D ? 'account' : 'profile'));
      h += tile('dk s5 a3-tp', '<div class="a3-l">Your rights</div><h2>Your data,<br>your call.</h2><p>Download it, correct it, or ask us to remove it.</p>');
    } else if (id === 'cart') {
      head('cart', 'Account / Request', 'Your cart.', 'Services you picked. We reply with a quote.', btn('Add service +', D ? 'services' : 'cart') + '<a class="a3-btn k" href="cart.html">Continue ↗</a>');
      var items = (window.AUZcart && AUZcart.get()) || [], labs = {}; (g('PRODUCT_CHOICES') || []).forEach(function (p) { labs[p[0]] = p[1].replace(/\s*\(.*$/, ''); });
      h += tile('s8 a3-tp', '<div class="a3-l">Selected</div><div class="a3-list">' + (items.length ? items.map(function (k) { return '<div class="a3-li"><b>' + esc(labs[k] || k) + '</b><button type="button" data-act="rmcart" data-k="' + esc(k) + '" aria-label="Remove">×</button></div>'; }).join('') : '<div class="a3-li"><b>Your cart is empty.</b><i>·</i></div>') + '</div>');
      h += tile('dk s4 a3-tp', '<div class="a3-l">Next step</div><h2>Make it<br>yours.</h2><p>No payment now: we send a quote first.</p>' + foot('Continue'), 'cart');
    } else if (id === 'apps') {
      var A = apps();
      head('apps', 'Workspace / Launch', 'Your apps.', 'Open the software your business uses.', '');
      h += A.length ? A.map(function (a, i) { return '<a class="a3-t ' + (i === 0 ? 'dk s6' : i % 2 ? 's6 wh' : 's6 sf') + ' c a3-tp" style="--i:' + (tn++) + '" href="' + esc(a.href) + '" target="_blank" rel="noopener"><div class="a3-l">Open</div><h2>' + esc(a.name) + '</h2>' + foot('Launch workspace') + '</a>'; }).join('')
        : tile('dk s12', '<div class="a3-l">Apps</div><h2>Nothing<br>switched on yet.</h2><p>Add a service and we will set it up.</p>');
    } else if (id === 'help') {
      head('help', 'Account / Support', 'We’re here.', 'Ask a question, get help, or report a problem.', '');
      h += tile('dk s5 a3-tp', '<div class="a3-l">Support</div><h2>Tell us<br>what’s up.</h2><p>Opens a short form with the details we need.</p><div class="a3-acts"><button type="button" class="a3-btn" style="background:#fff;color:#111" data-act="help">Report a problem ↗</button></div>');
      h += tile('s7 sf a3-tp', '<div class="a3-l">Talk to us</div><h3>One short message<br>is enough.</h3><p>We reply on WhatsApp or email.</p><div class="a3-acts"><a class="a3-btn" href="contact.html">Contact page ↗</a><a class="a3-btn" href="learn.html">Beginner guide ↗</a></div>');
    }
    m.innerHTML = h;
  }

  /* ---------- foldable cards ---------- */
  function fold() {
    document.querySelectorAll('.a3-pane .card:not(.fc)').forEach(function (card) {
      var first = card.firstElementChild, head = null;
      for (var k = 0; k < card.children.length && k < 3; k++) { var c = card.children[k]; if (/^(H2|H3|H4)$/.test(c.tagName) || c.classList.contains('h-2')) { head = c; break; } }
      if (!head || head !== first) return;
      var wrap = document.createElement('div'); wrap.className = 'fc-h'; wrap.setAttribute('role', 'button'); wrap.tabIndex = 0; wrap.setAttribute('aria-expanded', 'false');
      card.insertBefore(wrap, head); wrap.appendChild(head);
      var b = document.createElement('div'); b.className = 'fc-b'; var inn = document.createElement('div'); inn.className = 'fc-in'; b.appendChild(inn);
      while (wrap.nextSibling) inn.appendChild(wrap.nextSibling);
      card.appendChild(b); card.classList.add('fc');
      var toggle = function () { card.dataset.touched = '1'; var o = card.classList.toggle('open'); wrap.setAttribute('aria-expanded', o ? 'true' : 'false'); };
      wrap.onclick = toggle; wrap.onkeydown = function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } };
    });
    document.querySelectorAll('.a3-pane').forEach(function (pane) {
      var cards = pane.querySelectorAll(':scope > .card.fc'); if (!cards.length || cards.length > 4) return;
      cards.forEach(function (c) { if (c.dataset.touched || c.dataset.auto) return; c.dataset.auto = '1'; c.classList.add('open'); var h = c.querySelector('.fc-h'); if (h) h.setAttribute('aria-expanded', 'true'); });
    });
  }

  /* ---------- go / actions ---------- */
  function visible(id) {
    var D = g('DASH'); var tenant = !!D, owner = tenant && D.my_role === 'owner';
    if (id === 'overview' || id === 'cart' || id === 'help' || id === 'profile' || id === 'privacy') return true;
    if (id === 'staff' || id === 'roles') return owner;
    if (id === 'apps') return tenant;
    return tenant;
  }
  function go(id, byUser) {
    if (!TITLES[id] || !visible(id)) id = 'overview';
    if (byUser) userGo = true;
    cur = id;
    document.querySelectorAll('.a3-page').forEach(function (p) { p.classList.toggle('on', p.id === 'a3p-' + id); });
    var rail = id === 'roles' ? 'staff' : id === 'privacy' ? 'account' : id;
    document.querySelectorAll('[data-go].a3-nb').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-go') === rail); });
    $('#a3-crumb').textContent = TITLES[id];
    render(id);
    var real = ['account', 'services', 'staff', 'roles', 'notifications', 'profile', 'privacy'];
    if (real.indexOf(id) > -1 && typeof window.showTab === 'function') { try { window.__a3 = true; window.showTab(id); } catch (e) {} finally { window.__a3 = false; } }
    document.querySelectorAll('.a3-pane').forEach(function (p) { p.classList.add('on'); });
    setTimeout(fold, 30); setTimeout(fold, 400);
    try { history.replaceState(null, '', '#' + id); } catch (e) {}
    window.scrollTo({ top: 0 });
    top_();
  }
  function act(a, el) {
    if (a === 'help') { try { auzHelp.open(g('sb')); } catch (e) {} }
    if (a === 'rmcart') { if (window.AUZcart) AUZcart.remove(el.getAttribute('data-k')); render('cart'); top_(); }
    if (a === 'readall') {
      var N = g('NOTIFS') || [], sb = g('sb'); var ids = N.filter(function (n) { return !n.read; });
      Promise.all(ids.map(function (n) { n.read = true; return sb.from('notifications').update({ read: true }).eq('id', n.id); })).then(function () { try { loadNotifications(); renderNotifications(); } catch (e) {} setTimeout(function () { if (cur === 'notifications') go('notifications'); }, 200); });
    }
  }
  function top_() {
    var c = counts(), b = $('#a3-badge'), d = $('#a3-dotn');
    if (b) b.textContent = c.unread ? String(c.unread) : ''; if (d) { d.hidden = !c.unread; d.textContent = c.unread || ''; }
    var u = $('#a3-user'); if (u) u.textContent = (c.name || 'Account').toUpperCase() + ' ↗';
    // rail items that do not apply to this person
    document.querySelectorAll('.a3-rail [data-go],.a3-bn [data-go]').forEach(function (btn_) { btn_.style.display = visible(btn_.getAttribute('data-go')) ? '' : 'none'; });
    // the button inside a bottom bar for a person with no business
    if (!g('DASH')) document.querySelectorAll('.a3-bn [data-go=apps],.a3-bn [data-go=services],.a3-bn [data-go=notifications]').forEach(function (x) { x.style.display = 'none'; });
  }

  /* ---------- start ---------- */
  function start() {
    build();
    // the page's own showTab (called by its code) must not pull the new shell to another page
    var orig = window.showTab;
    if (typeof orig === 'function') window.showTab = function (t) { orig(t); if (!window.__a3) { fold(); } };
    var tries = 0;
    var t = setInterval(function () {
      tries++;
      var nav = $('#acctNav');
      if (nav && nav.style.display !== 'none' && nav.style.display !== '') {
        clearInterval(t); ready = true;
        var h = (location.hash || '').slice(1), tgt = TITLES[h] && h !== 'overview' ? h : (g('DASH') ? 'overview' : 'profile');
        go(tgt);
        new MutationObserver(function () { top_(); if (cur === 'overview') render('overview'); }).observe($('#acctNav'), { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] });
        setInterval(function () { if (document.hidden) return; var N = g('NOTIFS'); if (cur === 'overview' || cur === 'notifications') { var before = $('#a3m-' + cur).innerHTML; render(cur); } top_(); }, 21000);
        window.addEventListener('hashchange', function () { var x = (location.hash || '').slice(1); if (TITLES[x] && x !== cur) go(x, true); });
      } else if (tries > 100) clearInterval(t);
    }, 150);
    // the privacy notice the page draws next to its old layout belongs at the top of the new one
    new MutationObserver(function () {
      var b = $('#consentBanner'); var host = $('#a3-pages');
      if (b && host && b.parentNode !== host.parentNode) { host.parentNode.insertBefore(b, host); var o = $('#cbOpen'); if (o) o.addEventListener('click', function () { go('privacy', true); }); }
    }).observe(document.body, { childList: true, subtree: true });
    new MutationObserver(function () { clearTimeout(window.__a3f); window.__a3f = setTimeout(fold, 30); }).observe(shell, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
