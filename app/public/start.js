/* One address for every AUZslab app: app.auzslab.in. Sign in once (owner or manager with Google or email, staff with
   a username and PIN), and this page finds your business, shows the apps you can use and opens them. Everything runs on
   this one address, so a single home-screen icon covers every app. Plain DOM, textContent only. */
(function () {
  var sb = supabase.createClient(CFG.url, CFG.key);
  var box = document.getElementById('box'), foot = document.getElementById('foot');
  var LAST = 'auz.last';
  function el(tag, props, kids) {
    var n = document.createElement(tag);
    Object.keys(props || {}).forEach(function (k) { if (k === 'style') n.style.cssText = props[k]; else if (k === 'text') n.textContent = props[k]; else if (k.slice(0, 2) === 'on') n[k] = props[k]; else n.setAttribute(k, props[k]); });
    (kids || []).forEach(function (c) { if (c != null) n.append(c); });
    return n;
  }
  function set(nodes) { box.textContent = ''; nodes.forEach(function (n) { box.append(n); }); }
  function own(d, k) { return d.features && d.features[k] === true && (d.enabled_features || {})[k] !== false; }
  function lastGet() { try { return localStorage.getItem(LAST) || ''; } catch (e) { return ''; } }
  function lastSet(v) { try { localStorage.setItem(LAST, v); } catch (e) { /* private mode */ } }

  // id, name, what it is, address, and who gets it
  var APPS = [
    ['pos', 'AUZsPOS', 'Billing, tables and kitchen', '/index.html', function (d) { return own(d, 'pos'); }],
    ['mob', 'AUZsMob', 'Phone shop stock, sales and repairs', '/mob.html', function (d) { return own(d, 'mobile'); }],
    ['payroll', 'AUZsPay', 'Attendance, salary and leave', '/payroll.html', function (d) { return own(d, 'payroll'); }],
    ['accounts', 'AUZsLedger', 'Invoices, GST and books', '/accounts.html', function (d) { return own(d, 'accounting'); }],
    ['scan', 'AUZsScan', 'Scan, sell and add stock', '/scan.html', function (d) { return own(d, 'accounting') || own(d, 'scan'); }],
    ['console', 'Admin console', 'Reports, menu, stock and settings', '/dashboard.html', function (d) { return own(d, 'pos') && (d.my_role === 'owner' || d.my_role === 'manager'); }],
    ['builder', 'Website Builder', 'Edit your shop website', '/builder.html', function (d) { return own(d, 'website_builder') && d.my_role === 'owner'; }]
  ];

  function login(msg) {
    foot.textContent = '';
    var email = el('input', { class: 'input', type: 'email', placeholder: 'Email', autocomplete: 'username', 'aria-label': 'Email' });
    var pw = el('input', { class: 'input', type: 'password', placeholder: 'Password', autocomplete: 'current-password', 'aria-label': 'Password' });
    var m = el('div', { class: 'msg', role: 'alert', text: msg || '' });
    var go = el('button', { class: 'btn fill', type: 'button', text: 'Sign in' });
    var forgot = el('button', { type: 'button', style: 'justify-self:end;background:none;border:0;color:inherit;text-decoration:underline;font:inherit;font-size:14px;cursor:pointer', text: 'Forgot password?' });
    var googleHost = el('div');
    var owner = el('div', { class: 'grid' }, [googleHost, el('div', { class: 'sep', text: 'or' }), email, pw, forgot, go]);
    var staff = auzStaffPinForm(sb, boot);
    var tOwner = el('button', { type: 'button', 'aria-selected': 'true', text: 'Owner or manager' }), tStaff = el('button', { type: 'button', 'aria-selected': 'false', text: 'Staff' });
    function which(w) { owner.style.display = w === 'owner' ? 'grid' : 'none'; staff.style.display = w === 'staff' ? 'grid' : 'none'; tOwner.setAttribute('aria-selected', String(w === 'owner')); tStaff.setAttribute('aria-selected', String(w === 'staff')); m.textContent = ''; }
    tOwner.onclick = function () { which('owner'); }; tStaff.onclick = function () { which('staff'); };
    if (CFG.googleClientId) auzGoogleLink(googleHost, 'start'); else googleHost.remove();
    async function doLogin() {
      m.textContent = ''; go.disabled = true;
      try {
        var r = await sb.auth.signInWithPassword({ email: email.value.trim(), password: pw.value });
        r = await auz2fa.resolve(sb, r);
        if (r.error) { m.textContent = r.error.message || 'Wrong email or password'; return; }
        boot();
      } finally { go.disabled = false; }
    }
    go.onclick = doLogin; pw.addEventListener('keydown', function (e) { if (e.key === 'Enter') doLogin(); });
    forgot.onclick = async function () {
      if (!email.value.trim()) { m.textContent = 'Type your email above first.'; return; }
      var r = await sb.auth.forgotPassword(email.value.trim(), 'https://auzslab.in/signup.html');
      m.style.color = r.error ? '#c2183f' : 'inherit'; m.textContent = r.error ? r.error.message : 'If that email has an account, a reset link is on its way.';
    };
    set([el('h1', { text: 'Sign in' }), el('p', { class: 'sub', text: 'One place for all your AUZslab apps.' }), el('div', { class: 'seg' }, [tOwner, tStaff]), owner, staff, m]);
    which('owner');
    foot.append(el('a', { href: 'https://auzslab.in/', text: 'Explore AUZslab' }), el('a', { href: 'https://auzslab.in/signup.html', text: 'Create an account' }));
  }

  function signOut() { sb.auth.signOut().then(function () { try { localStorage.removeItem('u'); } catch (e) { /* ignore */ } location.replace('/start.html'); }); }

  // ---- the marketing site, the account page and the admin panel live on https://auzslab.in. The hub hands the signed-in
  // session over in the URL fragment (same #auz_gt hand-off the Google sign-in uses: never sent to any server) so the person
  // is already signed in there. Inside the app (AUZslabApp) these stay in the same window.
  var SITE = 'https://auzslab.in/';
  function b64(o) { return btoa(unescape(encodeURIComponent(JSON.stringify(o)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
  async function siteHref(path) {
    var sess = (await sb.auth.getSession()).data.session;
    if (!sess || !sess.access_token) return SITE + path;
    return SITE + path + '#auz_gt=' + b64({ t: sess.access_token, u: sess.user });
  }
  function siteTile(name, note, path) {
    return el('a', { class: 'tile', href: SITE + path, onclick: function (e) { e.preventDefault(); siteHref(path).then(function (u) { location.href = u; }); } }, [el('b', { text: name }), el('span', { text: note })]);
  }
  function exploreTiles() {
    return [siteTile('Explore AUZslab', 'Products, pricing, demos and guides', ''), siteTile('Products and pricing', 'See what each product does and costs', 'products.html')];
  }
  function accountTiles() {
    return [siteTile('My account and purchases', 'Profile, orders, bills and add-ons', 'account.html'), siteTile('My cart', 'Products you asked for', 'cart.html')];
  }
  function tilesBox(title, sub, tiles, extra) {
    set([el('h1', { text: title }), el('p', { class: 'sub', text: sub }), el('div', { class: 'tiles' }, tiles)].concat(extra || []));
  }
  function customerHome() {
    foot.textContent = ''; foot.append(el('button', { type: 'button', onclick: signOut, text: 'Sign out' }));
    tilesBox('Welcome', 'Look at the products, set up your account and ask for what your business needs.', accountTiles().concat(exploreTiles()));
  }
  function adminHome(me) {
    foot.textContent = ''; foot.append(el('span', { text: me.email || '' }), el('button', { type: 'button', onclick: signOut, text: 'Sign out' }));
    tilesBox('AUZslab admin', 'Clients, requests, pricing and the team.', [siteTile('Admin panel', 'Leads, clients, payments, team and settings', 'admin.html')].concat(exploreTiles()));
  }

  function apps(d) {
    var list = APPS.filter(function (a) { return a[4](d); }).map(function (a) { return { id: a[0], name: a[1], note: a[2], path: a[3] }; });
    if (d.tenant && d.tenant.niche === 'salon') list.unshift({ id: 'salon', name: 'AUZslab Salon', note: 'Bookings, billing and clients', path: 'https://' + d.tenant.slug + '.auzslab.in/salon/admin/' });
    return list;
  }

  async function boot() {
    var sess = (await sb.auth.getSession()).data.session;
    if (!sess) return login();
    // one call says what kind of person this is (admin / team / business / customer), so nobody is sent down a dead end
    var hm = await sb.rpc('hub_me'), me = hm && hm.data;
    if (hm && hm.error && (hm.error.status || 0) === 401) { await sb.auth.signOut(); return login('Your session ended. Please sign in again.'); }
    if (me && me.admin) return adminHome(me);
    if (me && me.team && !me.business) { location.replace('/salesman.html'); return; }
    if (me && !me.business) return customerHome();
    var r = await sb.rpc('my_dashboard');
    if (r.error || !r.data) {
      var s = r.error && (r.error.status || 0);
      if (s === 401) { await sb.auth.signOut(); return login('Your session ended. Please sign in again.'); }
      return customerHome();
    }
    var d = r.data, list = apps(d), sw = new URLSearchParams(location.search).get('switch') === '1';
    if (me && me.team) list.unshift({ id: 'team', name: 'Team workspace', note: 'Leads, client setups and your team work', path: '/salesman.html' });
    foot.textContent = ''; foot.append(el('span', { text: (d.my_email || '') }), el('button', { type: 'button', onclick: signOut, text: 'Sign out' }));
    if (!list.length) return set([el('h1', { text: d.tenant ? d.tenant.name : 'AUZslab' }), el('p', { class: 'sub', text: 'No apps are switched on for this login yet. Ask AUZslab or your owner.' })]);
    if (list.length === 1 && !sw) { lastSet(list[0].id); location.replace(list[0].path); return; }
    set([el('h1', { text: d.tenant ? d.tenant.name : 'AUZslab' }), el('p', { class: 'sub', text: 'Choose an app.' }),
      el('div', { class: 'tiles' }, list.map(function (a) { return el('a', { class: 'tile', href: a.path, onclick: function () { lastSet(a.id); } }, [el('b', { text: a.name }), el('span', { text: a.note })]); }).concat(accountTiles()).concat(exploreTiles().slice(0, 1)))]);
  }
  boot().catch(function (e) { set([el('h1', { text: 'Could not load' }), el('p', { class: 'sub', text: (e && e.message) || 'Check your connection and try again.' }), el('button', { class: 'btn', type: 'button', onclick: boot, text: 'Try again' })]); });
})();
