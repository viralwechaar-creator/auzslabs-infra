/* Account dashboard (account.html): the redesigned shell (sidebar + panel layout). It draws the navigation,
   overview and headings inside a shadow root; every form and save is still the page's own code, shown through
   slots. Remove the ac5 tags from account.html to bring the old shell back. */
(function () {
  'use strict';
  var g = function (n) { try { return (0, eval)(n); } catch (e) { return undefined; } };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var host, root, ready = false;
  var $ = function (s) { return root.querySelector(s); }, $$ = function (s) { return Array.prototype.slice.call(root.querySelectorAll(s)); };
  var APPDEF = [['pos', 'AUZsPOS', 'Billing, tables, kitchen, QR orders', 'till', 'lavender'], ['payroll', 'AUZsPay', 'Attendance, leave and payslips', 'users', 'mint'], ['accounting', 'AUZsLedger', 'Accounts, GST and banking', 'book', 'peach'], ['mobile', 'AUZsMob', 'Phone shop sales and repairs', 'phone', 'sky'], ['style', 'AUZsStyle', 'Clothing and footwear shop', 'tag', 'lavender'], ['scan', 'AUZsScan', 'Scan to bill', 'scan', 'mint'], ['salon', 'AUZslab Salon', 'Booking, billing, website', 'tag', 'peach'], ['finance', 'AUZsFinance', 'Money in, out and dues', 'book', 'sky']];
  var BIZ = {}, ME = {}, ALL_APPS = [], OWNED = {}, ENABLED = {}, STAFF = [], ROLES = [], NOTIFS = [], REQS = [], CART = [], PROFILE = { products: [] };
  window.AC5 = { ACT: {}, AFTER: {}, ENTER: {}, OWN: {}, VIEWS: null };
  var S = { mode: 'owner', view: 'home', more: false, nf: 'all' };
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
    ALL_APPS = APPDEF.map(function (a) { return { k: a[0], n: a[1], d: a[2], ic: a[3], tone: a[4], href: links[a[1]] || '' }; });
    OWNED = {}; ENABLED = {}; APPDEF.forEach(function (a) { if (f[a[0]] === true) { OWNED[a[0]] = true; ENABLED[a[0]] = en[a[0]] !== false; } });
    STAFF = (g('STAFF') || []).map(function (s) { return { name: s.name || s.email || '', role: s.role }; }); if (!STAFF.length && D) STAFF = [{ name: ME.name, role: 'owner' }];
    ROLES = g('ROLES') || [];
    NOTIFS = (g('NOTIFS') || []).map(function (n) { return { t: n.title || '', b: n.body || '', at: n.created_at ? new Date(n.created_at).toLocaleDateString() : '', read: !!n.read }; });
    CART = (window.AUZcart && AUZcart.get()) || [];
    var lab = {}; (g('PRODUCT_CHOICES') || []).forEach(function (p) { lab[p[0]] = p[1].replace(/\s*\(.*$/, ''); });
    CART = CART.map(function (k) { return lab[k] || k; });
    PROFILE = { products: (P.products || []).map(function (k) { return lab[k] || k; }) };
    ME.admin = !!A;
  }
  var P = {
    home: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
    user: '<path d="M4 21V7l8-4 8 4v14"/><path d="M9 21v-6h6v6"/>',
    shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z"/><path d="M9 12l2 2 4-4"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    users: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20a6 6 0 0 1 12 0"/><path d="M16 5a3 3 0 0 1 0 6"/><path d="M18 14a6 6 0 0 1 3 6"/>',
    key: '<circle cx="8" cy="12" r="3.5"/><path d="M11.5 12H21M17 12v3M20 12v2"/>',
    bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15L6 16z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
    apps: '<rect x="4" y="4" width="6" height="6" rx="1.5"/><rect x="14" y="4" width="6" height="6" rx="1.5"/><rect x="4" y="14" width="6" height="6" rx="1.5"/><circle cx="17" cy="17" r="3"/>',
    bag: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M3 10h18"/>',
    lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7M12 17h.01"/>',
    till: '<rect x="4" y="6" width="16" height="13" rx="2"/><path d="M4 10h16M8 15h3"/>',
    book: '<path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3V4z"/><path d="M8 20a3 3 0 0 1-3-3"/>',
    phone: '<rect x="7" y="3" width="10" height="18" rx="2.5"/><path d="M11 18h2"/>',
    tag: '<path d="M4 12V5a1 1 0 0 1 1-1h7l8 8-8 8-8-8z"/><circle cx="8.5" cy="8.5" r="1.2"/>',
    scan: '<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M7 12h10"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
    chev2: '<path d="M9 6l6 6-6 6"/>', more: '<circle cx="6" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="18" cy="12" r="1.4"/>',
    out: '<path d="M14 4h5v16h-5M10 8l-4 4 4 4M6 12h10"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>', plus: '<path d="M12 5v14M5 12h14"/>',
    mail: '<path d="M4 4h16v16H4z"/><path d="M4 6l8 7 8-7"/>', call: '<path d="M4 5h16v11H9l-5 4V5Z"/>',
    calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    arrow: '<path d="M7 17 17 7M8 7h9v9"/>', download: '<path d="M12 3v12m0 0 4-4m-4 4-4-4M4 21h16"/>',
    building: '<path d="M4 21V7l8-4 8 4v14"/>', edit: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>'
  };
  var ic = function (n, c) { return '<svg class="' + (c || 'ic') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">' + (P[n] || '') + '</svg>'; };

  var SECTIONS = [
    { id: 'home', t: 'Overview', ic: 'home', g: '', need: ['owner', 'manager', 'customer', 'admin'], d: true },
    { id: 'profile', t: 'Business profile', ic: 'user', g: 'Workspace', need: ['owner', 'manager', 'customer', 'admin'] },
    { id: 'services', t: 'Services', ic: 'grid', g: 'Workspace', need: ['owner', 'manager', 'admin'], biz: true, count: true },
    { id: 'apps', t: 'Open an app', ic: 'apps', g: 'Workspace', need: ['owner', 'manager', 'admin'], biz: true },
    { id: 'staff', t: 'Staff', ic: 'users', g: 'Workspace', need: ['owner', 'manager'], biz: true },
    { id: 'roles', t: 'Roles and access', ic: 'key', g: 'Workspace', need: ['owner', 'manager'], biz: true },
    { id: 'cart', t: 'Billing and plan', ic: 'bag', g: 'Account', need: ['owner', 'manager', 'customer', 'admin'] },
    { id: 'notifications', t: 'Notifications', ic: 'bell', g: 'Account', need: ['owner', 'manager', 'admin'], biz: true, badge: true },
    { id: 'security', t: 'Account settings', ic: 'shield', g: 'Account', need: ['owner', 'manager', 'admin'], biz: true },
    { id: 'privacy', t: 'Privacy and my data', ic: 'lock', g: 'Account', need: ['owner', 'manager', 'customer', 'admin'] },
    { id: 'help', t: 'Help and support', ic: 'help', g: 'Account', need: ['owner', 'manager', 'customer', 'admin'] }];
  var can = function (sec) { return sec.need.indexOf(S.mode) > -1; };
  var isOwner = function () { return S.mode === 'owner'; };
  var hasBiz = function () { return S.mode !== 'customer'; };
  var unread = function () { return NOTIFS.filter(function (n) { return !n.read; }).length; };

  /* ---------- desktop sidebar + mobile bottom nav ---------- */
  function railHTML() {
    var out = '', last = null;
    SECTIONS.filter(function (s) { return !s.d && can(s); }).forEach(function (s) {
      if (s.g !== last) { out += '<p class="ng-h">' + esc(s.g) + '</p>'; last = s.g; }
      var count = s.count ? '<small class="cnt">' + Object.keys(OWNED).length + '</small>' : (s.badge && unread() ? '<small class="bdg">' + unread() + '</small>' : '');
      out += '<button type="button" class="nl' + (S.view === s.id ? ' on' : '') + '" data-go="' + s.id + '">' + ic(s.ic) + '<span>' + esc(s.t) + '</span>' + count + '</button>';
      if (s.g !== last) { } // group already opened above
    });
    // wrap consecutive same-group buttons into a .ng div
    return '<div class="rbrand"><span class="mk">A</span><span>auzslab<span class="dot">.</span></span></div>' +
      '<div class="wss"><span class="av">' + esc((hasBiz() ? BIZ.name : ME.name).charAt(0).toUpperCase()) + '</span><div class="cp"><strong>' + esc(hasBiz() ? BIZ.name : ME.name) + '</strong><small>Client workspace</small></div></div>' +
      '<nav class="side-nav">' + groupWrap(out) + '</nav>' +
      '<div class="rbot"><div class="hcard"><div class="ic">' + ic('help') + '</div><strong>Need a hand?</strong><p>Our team is here whenever you need us.</p><button data-go="help">Visit help centre &rarr;</button></div>' +
      '<button type="button" class="pmini" data-go="' + (hasBiz() ? 'security' : 'profile') + '"><span class="av2">' + esc((ME.name || '?').charAt(0).toUpperCase()) + '</span><div class="nm"><strong>' + esc(ME.name) + '</strong><small>' + (S.mode === 'owner' ? 'Account owner' : S.mode === 'manager' ? 'Manager' : 'Account') + '</small></div></button>' +
      '<button type="button" class="pmini" data-act="signout" style="border-top:0;padding-top:8px">' + ic('out') + '<div class="nm"><strong>Sign out</strong></div></button></div>';
  }
  function groupWrap(innerHTML) {
    // navHTML already emits <p class="ng-h"> markers between groups; wrap each run in a .ng for spacing
    var parts = innerHTML.split(/(?=<p class="ng-h">)/).filter(Boolean);
    return parts.map(function (p) { return '<div class="ng">' + p + '</div>'; }).join('');
  }
  var TABS_BIZ = ['profile', 'services', 'notifications'], TABS_CUST = ['profile', 'cart', 'privacy'];
  function tabIds() { return hasBiz() ? TABS_BIZ : TABS_CUST; }
  function rowBtn(s) { return '<button type="button" data-go="' + s.id + '"' + (S.view === s.id ? ' aria-current="true"' : '') + '>' + ic(s.ic) + '<span class="t">' + esc(s.t) + '</span>' + (s.badge && unread() ? '<span class="badge">' + unread() + '</span>' : '') + '<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg></button>'; }
  function restList() { return SECTIONS.filter(function (x) { return !x.d && can(x) && tabIds().indexOf(x.id) < 0; }); }
  function tabBtn(id, label, icn, badge) { var on = S.view === id; return '<button class="tb' + (on ? ' on' : '') + '" data-go="' + id + '" aria-label="' + esc(label) + '">' + ic(icn, 'tbi') + '<span>' + esc(label) + '</span>' + (badge ? '<i class="tbg">' + badge + '</i>' : '') + '</button>'; }
  function tabbarHTML() {
    var out = tabBtn('home', 'Home', 'home');
    tabIds().forEach(function (id) { var x = SECTIONS.filter(function (z) { return z.id === id; })[0]; out += tabBtn(id, id === 'notifications' ? 'Alerts' : (id === 'security' ? 'Settings' : x.t.replace(' and my data', '').replace(' and plan', '').replace('Business ', '')), x.ic, x.badge && unread() ? unread() : ''); });
    var moreOn = restList().some(function (x) { return x.id === S.view; });
    out += '<button class="tb' + (moreOn || S.more ? ' on' : '') + '" data-act="moreOpen" aria-label="More">' + ic('more', 'tbi') + '<span>More</span></button>';
    return out;
  }
  function moreSheet() {
    var out = '', last = null;
    restList().forEach(function (x) { if (x.g !== last) { out += '<div class="grp">' + esc(x.g) + '</div>'; last = x.g; } out += rowBtn(x); });
    return '<div class="scrim" data-act="moreClose"></div><div class="msheet" role="dialog" aria-label="More"><div class="grab"></div><div class="mh"><b>More</b><button class="btn sm" data-act="moreClose">Close</button></div><div class="nav" style="padding:0 6px 8px">' + out + '</div></div>';
  }

  /* ---------- top bar ---------- */
  var LABEL = { home: 'Overview' }; SECTIONS.forEach(function (s) { LABEL[s.id] = s.t; });
  function topbarHTML() {
    return '<div class="bc m-only" style="display:none"></div>' +
      '<button type="button" class="ibtn m-only" data-act="moreOpen" aria-label="Menu">' + ic('apps') + '</button>' +
      '<div class="bc"><span>' + (hasBiz() ? 'Workspace' : 'Account') + '</span>' + ic('chev2') + ' <strong>' + esc(LABEL[S.view]) + '</strong></div>' +
      '<div class="tacts"><div class="spill">' + ic('shield') + ' Secure portal</div>' +
      '<button type="button" class="ibtn" data-act="bell" aria-label="Notifications">' + ic('bell') + (unread() ? '<i></i>' : '') + '</button>' +
      '<button type="button" class="tuser" data-go="' + (hasBiz() ? 'security' : 'profile') + '"><span class="av2">' + esc((ME.name || '?').charAt(0).toUpperCase()) + '</span>' + ic('chev2') + '</button></div>';
  }

  /* ---------- overview (home) ---------- */
  function bentoHTML() {
    var biz = hasBiz();
    var apps = ALL_APPS.filter(function (a) { return OWNED[a.k]; });
    var on = apps.filter(function (a) { return ENABLED[a.k] !== false; }).length;
    var banner = biz ?
      '<div class="b-main2"><div class="b-lab"><span></span> YOUR CLIENT WORKSPACE</div><h2>Everything your business needs,<br><em>in one place.</em></h2><p>Manage your services, stay on top of renewals and reach your support team.</p>' +
      '<div class="b-acts"><button class="btn pri" data-go="apps">Open an app</button><button class="btn" data-go="services">Services</button></div></div>' +
      '<div class="b-side"><div class="b-symbol">' + ic('building') + '</div><span>CLIENT SINCE</span><strong>' + (BIZ.since ? esc(BIZ.since) : '&mdash;') + '</strong></div>' +
      bannerArt(on, apps.length, STAFF.length) :
      '<div class="b-main2"><div class="b-lab"><span></span> YOUR AUZSLAB ACCOUNT</div><h2>You have an account,<br><em>no business yet.</em></h2><p>Fill in your profile, add what you need to the cart and send a request. We reply with a quote.</p>' +
      '<div class="b-acts"><button class="btn pri" data-go="profile">Complete profile</button><button class="btn" data-go="cart">My cart</button></div></div>' +
      '<div class="b-side"><div class="b-symbol">' + ic('user') + '</div><span>SIGNED IN AS</span><strong style="font-size:10px">' + esc(ME.email) + '</strong></div>';
    var stats = biz ?
      scard('violet', 'grid', 'Active services', String(on), 'of ' + apps.length + ' available products') +
      scard('amber', 'calendar', 'Renewal date', BIZ.renewal === 'Not set' ? '&mdash;' : BIZ.renewal, esc(BIZ.plan) || 'No plan set') +
      scard('green', 'bag', 'People signed in', String(STAFF.length), STAFF.length === 1 ? 'just you' : 'across your team') +
      scard('blue', 'shield', 'Account status', esc(cap1(BIZ.status)), 'No outstanding balance', true) :
      scard('violet', 'user', 'Profile complete', profPct() + '%', 'Finish it for a faster quote') +
      scard('amber', 'bag', 'In your cart', String(CART.length), CART.length === 1 ? 'item ready to request' : 'items ready to request') +
      scard('green', 'grid', 'What you need', String(PROFILE.products.length), 'products picked so far') +
      scard('blue', 'shield', 'Account status', 'No business yet', 'Send a request to get started', true);
    var html = '<section class="view-home">' +
      '<div class="ph"><div><span class="bl">' + (biz ? esc(BIZ.since ? 'MEMBER SINCE ' + BIZ.since.toUpperCase() : 'YOUR ACCOUNT') : 'YOUR ACCOUNT') + '</span><h1>' + (biz ? 'Good to see you, ' + esc((ME.name || 'there').split(' ')[0]) + '.' : 'Welcome, ' + esc((ME.name || 'there').split(' ')[0]) + '.') + '</h1><p>Here&rsquo;s what&rsquo;s happening with your account today.</p></div><button class="btn pri" data-go="help">' + ic('arrow') + ' Contact your team</button></div>' +
      '<div class="banner">' + banner + '</div>' +
      '<div class="shead"><div><h2>Your account at a glance</h2><p>A quick overview of your active services and account.</p></div>' + (biz ? '<button class="lnk" data-go="services">View all services &rarr;</button>' : '') + '</div>' +
      '<div class="sgrid">' + stats + '</div>' +
      '<div class="cgrid">' + mainPanel(biz, apps) + nextPanel(biz) + '</div>' +
      '<div class="cgrid lgrid">' + noticesPanel(biz) + detailsPanel(biz) + '</div>' +
      '</section>';
    return html;
  }
  function cap1(s) { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); }
  function scard(tone, icn, lab, val, meta, compact) { return '<div class="scard"><div class="si ' + tone + '">' + ic(icn) + '</div><div class="lab">' + esc(lab) + '</div><div class="val' + (compact ? ' compact' : '') + '">' + val + '</div><div class="meta">' + esc(meta) + '</div></div>'; }
  function bannerArt(on, total, staffCount) {
    return '<div class="orb" aria-hidden="true"></div><div class="orb"><u></u></div>' +
      '<div class="barts" aria-hidden="true">' +
      '<div class="vfloat vhealth"><span class="fk">APPS RUNNING</span><b>' + on + '<span>/' + Math.max(total, 1) + '</span></b><div class="htrack"><i style="width:' + Math.round(100 * on / Math.max(1, total)) + '%"></i></div><small><b></b> ' + staffCount + ' ' + (staffCount === 1 ? 'person' : 'people') + ' can sign in</small></div>' +
      '</div>';
  }
  function mainPanel(biz, apps) {
    if (!biz) return '<section class="panel services-panel"><div class="phead"><div><h3>What you need</h3><p>Picked so far, from your profile.</p></div></div>' +
      (PROFILE.products.length ? '<div class="slist">' + PROFILE.products.slice(0, 5).map(function (p) { return '<div class="srow"><div class="sic lavender">' + ic('grid') + '</div><div class="sinfo"><strong>' + esc(p) + '</strong></div></div>'; }).join('') + '</div>' : '<div class="empty">Nothing picked yet.</div>') +
      '<a class="pflink" data-go="profile">Finish your profile &rarr;</a></section>';
    var rows = apps.length ? apps.map(function (a) {
      var o = ENABLED[a.k] !== false;
      return '<div class="srow"><div class="sic ' + a.tone + '">' + ic(a.ic) + '</div><div class="sinfo"><strong>' + esc(a.n) + '</strong><span>' + esc(a.d) + '</span></div><div class="srenew"><small>Renewal date</small><strong>' + (BIZ.renewal === 'Not set' ? '&mdash;' : esc(BIZ.renewal)) + '</strong></div><span class="pill ' + (o ? 'ok' : 'warn') + '"><i></i>' + (o ? 'Active' : 'Off') + '</span><svg class="schev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 6l6 6-6 6"/></svg></div>';
    }).join('') : '';
    return '<section class="panel services-panel"><div class="phead"><div><h3>Your services</h3><p>What&rsquo;s switched on for this business.</p></div><a class="rlink" data-go="services" href="#">' + ic('arrow') + '</a></div>' +
      (rows ? '<div class="slist">' + rows + '</div>' : '<div class="empty"><b>Nothing switched on yet.</b>Add a service and we will set it up.</div>') +
      '<button class="pflink" data-go="services">Manage services &rarr;</button></section>';
  }
  function nextPanel(biz) {
    var upc = biz ? '<div class="upc"><div class="udate"><span>' + (BIZ.renewal || '').slice(3, 6).toUpperCase() + '</span><strong>' + (BIZ.renewal || '').slice(0, 2) + '</strong></div><div><strong>' + esc(BIZ.plan || 'Your plan') + '</strong><p>Plan renewal</p></div></div>' : '';
    return '<section class="panel next-panel"><div class="phead"><div><h3>Coming up next</h3><p>Keep an eye on these dates.</p></div>' + ic('calendar') + '</div>' +
      (upc || '<div class="empty">Nothing scheduled yet.</div>') +
      '<div class="nxnote">' + ic('shield') + '<span>We&rsquo;ll remind you before every renewal.</span></div></section>';
  }
  function noticesPanel(biz) {
    var items = biz ? NOTIFS.slice(0, 3) : [];
    var rows = items.length ? items.map(function (n) { return '<div class="pmrow"><div class="picon">' + ic('bell') + '</div><div><strong>' + esc(n.t) + '</strong><small>' + esc(n.at) + '</small></div></div>'; }).join('') : '<div class="empty">Nothing yet.</div>';
    return '<section class="panel"><div class="phead"><div><h3>Latest notices</h3><p>Your most recent account activity.</p></div>' + (biz ? '<button class="lnk" data-go="notifications">See all &rarr;</button>' : '') + '</div>' + rows + '</section>';
  }
  function detailsPanel(biz) {
    return '<section class="panel"><div class="phead"><div><h3>' + (biz ? 'Business details' : 'Your details') + '</h3><p>Your primary account information.</p></div><a class="rlink" data-go="profile" href="#">' + ic('edit') + '</a></div>' +
      '<div class="aline">' + ic('building') + '<span>' + esc(biz ? BIZ.name : ME.name) + '</span></div>' +
      '<div class="aline">' + ic('mail') + '<span>' + esc(ME.email) + '</span></div>' +
      (biz ? '<div class="aline">' + ic('home') + '<span>' + (BIZ.slug ? esc(BIZ.slug + '.auzslab.in') : '&mdash;') + '</span></div>' : '') +
      '</section>';
  }

  /* ---------- section pages ---------- */
  var F = function (label, inner, cls) { return '<label class="f ' + (cls || '') + '"><span>' + esc(label) + '</span>' + inner + '</label>'; };
  var inp = function (id, val, o) { o = o || {}; return '<input id="' + id + '" type="' + (o.type || 'text') + '" value="' + esc(val) + '"' + (o.ph ? ' placeholder="' + esc(o.ph) + '"' : '') + (o.dis ? ' disabled' : '') + (o.ac ? ' autocomplete="' + o.ac + '"' : '') + '>'; };
  var sel = function (id, opts, val) { return '<select id="' + id + '">' + opts.map(function (o) { var v = Array.isArray(o) ? o[0] : o, l = Array.isArray(o) ? o[1] : o; return '<option value="' + esc(v) + '"' + (String(v) === String(val) ? ' selected' : '') + '>' + esc(l) + '</option>'; }).join('') + '</select>'; };
  var blk = function (h, d, body, cls) { return '<section class="blk ' + (cls || '') + '"><h2>' + esc(h) + '</h2>' + (d ? '<p class="d">' + d + '</p>' : '') + body + '</section>'; };
  var PSTAT = function () { var v = S.view; return { profile: [(typeof profPct === 'function' ? profPct() : 60) + '%', 'profile complete'], security: ['Account', 'password & 2FA'], services: [Object.keys(OWNED).filter(function (k) { return ENABLED[k] !== false; }).length + '/' + Object.keys(OWNED).length, 'services on'], apps: [Object.keys(OWNED).length, 'apps ready'], staff: [STAFF.length, 'people can sign in'], roles: [ROLES.length, 'custom roles'], notifications: [unread(), 'unread notices'], cart: [CART.length, 'items in request'], privacy: [REQS.length, 'open requests'], help: ['24h', 'we reply within'] }[v] || ['', '']; };
  var head = function (t, p) { var st = PSTAT(); return '<div class="ph"><div><span class="bl">' + esc(t) + '</span><h1>' + esc(t) + '</h1>' + (p ? '<p>' + p + '</p>' : '') + '</div>' + (st[0] !== '' ? '<div class="pstat"><b' + (/^\d+$/.test(String(st[0])) ? ' data-count="' + st[0] + '"' : '') + '>' + esc(st[0]) + '</b><small>' + esc(st[1]) + '</small></div>' : '') + '</div>'; };
  var copybox = function (url) { return '<div class="copybox"><code>' + esc(url) + '</code><button class="btn sm" data-copy="' + esc(url) + '">Copy</button></div>'; };

  var VIEWS = {}; AC5.VIEWS = VIEWS;
  var slot = function (id) { return '<div class="slotwrap"><slot name="p-' + id + '"></slot></div>'; };
  var TEXT = { profile: 'Your details and business information.', security: 'Your login, devices and safety settings.', services: 'What is switched on for your business.', staff: 'Staff and their sign-in details.', roles: 'Choose what each team member can open.', notifications: 'A simple inbox for your account.', privacy: 'Your consent, your data and your rights under the DPDP Act 2023.' };
  ['profile', 'security', 'services', 'staff', 'roles', 'notifications', 'privacy'].forEach(function (id) {
    VIEWS[id] = function () { return head(({ security: 'Account settings', privacy: 'Privacy and my data' })[id] || (id.charAt(0).toUpperCase() + id.slice(1)), TEXT[id]) + slot(SLOT[id]); };
  });
  VIEWS.apps = function () {
    var mine = ALL_APPS.filter(function (a) { return OWNED[a.k]; });
    var rows = mine.map(function (a) {
      var on = ENABLED[a.k] !== false;
      return '<div class="srow"><div class="sic large ' + a.tone + '">' + ic(a.ic) + '</div><div class="sinfo"><strong>' + esc(a.n) + '</strong><span>' + esc(a.d) + '</span></div><span class="pill ' + (on ? 'ok' : 'warn') + '"><i></i>' + (on ? 'Ready' : 'Switched off') + '</span>' + (on ? '<a class="btn sm" href="' + esc(a.href || '#') + '" target="_blank" rel="noopener">Open &rarr;</a>' : '<button class="btn sm" data-go="services">Turn on</button>') + '</div>';
    }).join('');
    return head('Open an app', 'One link for each app your business can use.') + '<section class="panel services-panel">' + (rows ? '<div class="slist">' + rows + '</div>' : '<div class="empty"><b>Nothing switched on yet.</b>Add a service and we will set it up.</div>') + '</section>';
  };
  VIEWS.cart = function () {
    var monthly = BIZ.plan ? esc(BIZ.plan) : 'No plan yet';
    var rows = CART.length ? CART.map(function (c) { return '<div class="pmrow"><div class="picon">' + ic('grid') + '</div><div><strong>' + esc(c) + '</strong><small>In your request</small></div></div>'; }).join('') : '<div class="empty"><b>Your cart is empty.</b>Pick a service to start a request.</div>';
    return head('Billing and plan', 'What you&rsquo;re on, what it costs, and when it renews.') +
      '<div class="bsum">' +
      '<div class="panel btot"><span>CURRENT PLAN</span><strong>' + monthly + '</strong><small>' + ic('check') + ' ' + esc(BIZ.status === 'active' ? 'All payments up to date' : cap1(BIZ.status || 'Pending')) + '</small></div>' +
      '<div class="panel bsm"><span>RENEWAL DATE</span><strong>' + (BIZ.renewal ? esc(BIZ.renewal) : '&mdash;') + '</strong><small>Auto-renews unless cancelled</small></div>' +
      '<div class="panel bsm"><span>BUSINESS ID</span><strong style="font-size:15px">' + (BIZ.slug ? esc(BIZ.slug) : '&mdash;') + '</strong><small>Use this when contacting support</small></div>' +
      '</div>' +
      '<section class="panel"><div class="phead"><div><h3>' + (CART.length ? 'Your request' : 'Add a service') + '</h3><p>Price is agreed in your quote once sent.</p></div></div>' + rows + '<div class="savebar"><a class="btn pri" href="cart.html">' + (CART.length ? 'Open cart' : 'Add services') + '</a></div></section>';
  };
  VIEWS.help = function () {
    return head('Help and support', 'Talk to a person, or tell us what went wrong.') +
      '<div class="supgrid">' +
      '<div class="panel supcard"><div class="ic">' + ic('call') + '</div><span>CALL US</span><h3>Speak to a person</h3><p>Monday to Saturday, 10 AM &ndash; 7 PM IST.</p><a href="#" data-copy="+91 92512 50829">+91 92512 50829 &rarr;</a></div>' +
      '<div class="panel supcard"><div class="ic">' + ic('mail') + '</div><span>EMAIL US</span><h3>Send us an email</h3><p>We reply within 24 hours, usually faster.</p><a href="#" data-copy="helloauzslab@gmail.com">helloauzslab@gmail.com &rarr;</a></div>' +
      '<div class="panel supcard"><div class="ic">' + ic('book') + '</div><span>BEGINNER GUIDE</span><h3>Your first day</h3><p>Step by step, from sign-up to your first sale.</p><a href="learn.html">Open guide &rarr;</a></div>' +
      '</div><div class="savebar" style="margin-top:14px"><button class="btn pri" data-act="help">Report a problem</button></div>';
  };
  var ringSVG = function (v, sz) { return '<svg class="rg" viewBox="0 0 36 36" width="' + sz + '" height="' + sz + '" aria-hidden="true"><circle class="trk" cx="18" cy="18" r="16" pathLength="100"/><circle class="arc" cx="18" cy="18" r="16" pathLength="100" style="--v:' + v + '"/></svg>'; };
  Object.assign(AC5, { g: g, esc: esc, ic: ic, head: head, F: F, inp: inp, sel: sel, ringSVG: ringSVG, toast: toast, go: go, S: S, $: function (q) { return $(q); }, $$: function (q) { return $$(q); }, render: function () { render(); }, data: function () { return { PROFILE: g('PROFILE') || {}, DASH: g('DASH'), ME: ME, CART: CART, ALL_APPS: ALL_APPS }; }, set: function (n, v) { window.__v = v; (0, eval)(n + '=window.__v'); }, can: can, hasBiz: hasBiz, isOwner: isOwner });

  /* ---------- draw ---------- */
  function setup() {
    host = document.createElement('div'); host.id = 'a5'; document.body.appendChild(host);
    root = host.attachShadow({ mode: 'open' });
    var link = document.createElement('link'); link.rel = 'stylesheet'; link.href = 'ac5.css?v=12'; root.appendChild(link);
    var fontlink = document.createElement('link'); fontlink.rel = 'stylesheet'; fontlink.href = 'https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Manrope:wght@400;500;600;700;800&display=swap'; root.appendChild(fontlink);
    var box = document.createElement('div'); box.innerHTML = '<main class="sheet m-home" id="app"><aside class="rail" id="rail"></aside><div class="mainc"><header class="top" id="topbar"></header><slot name="banner"></slot><div class="home" id="home"></div><div class="pagewrap" id="pagewrap"></div></div></main><nav class="tabbar" id="tabbar" aria-label="Main"></nav><div id="sheetwrap"></div><div class="toast" id="toast" role="status"></div>';
    while (box.firstChild) root.appendChild(box.firstChild);
    var sync_theme = function () { host.setAttribute('data-theme', document.documentElement.getAttribute('data-theme') || ''); };
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
    if (a === 'moreOpen') { S.more = true; render(); } else if (a === 'moreClose') { S.more = false; render(); }
    else if (a === 'signout') { var b = document.getElementById('signOutBtn'); if (b) b.click(); }
    else if (a === 'bell') { toast(unread() ? unread() + ' unread notice' + (unread() === 1 ? '' : 's') : "You're all caught up."); }
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
    var app = $('#app'); app.classList.toggle('m-home', S.view === 'home'); app.classList.toggle('m-page', S.view !== 'home');
    $('#rail').innerHTML = railHTML();
    $('#topbar').innerHTML = topbarHTML();
    $('#home').innerHTML = bentoHTML();
    var pw = $('#pagewrap');
    if (S.view === 'home') pw.innerHTML = '';
    else { var fn = VIEWS[S.view]; if (!fn) { S.view = 'home'; return render(); } pw.setAttribute('data-p', S.view); pw.innerHTML = '<div class="page">' + fn() + '</div>'; }
    $('#home').classList.toggle('d-hide', S.view !== 'home');
    $('#sheetwrap').innerHTML = S.more ? moreSheet() : '';
    $('#tabbar').innerHTML = tabbarHTML();
    $$('.page .ph,.view-home>*,.page>*').forEach(function (n) { n.classList.add('in'); });
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
