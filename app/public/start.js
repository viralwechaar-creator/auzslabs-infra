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
  function set(nodes) { box.textContent = ''; nodes.forEach(function (n) { box.append(n); }); Array.prototype.forEach.call(box.querySelectorAll('.tile'), function (t, i) { t.style.setProperty('--i', i); }); }
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
  // ---- My requests: what the person asked for and where each request is (asked -> checked -> payment link -> paid -> active).
  // Paying happens on the website's payment page (opened in the same window); the iPhone/iPad app never offers it (Apple's rules)
  // and says so. A paid request shows the bill. Payment is confirmed by AUZslab (automatically once an online gateway is on).
  var STATUS = {
    requested: ['Received', 'We have your request.', 1], new: ['Received', 'We have your request.', 1],
    verifying: ['Being checked', 'We are checking your business details.', 2], confirmed: ['Confirmed', 'Your payment link is being prepared.', 2],
    link_sent: ['Ready to pay', 'Your quote is ready. Read it and pay.', 3], payment_submitted: ['Payment received', 'We are confirming your payment.', 4],
    paid: ['Active', 'Paid. Your access is active.', 5], rejected: ['Not accepted', 'We could not accept this request. Contact us for help.', 0]
  };
  var STEPS = ['Asked', 'Checked', 'Pay', 'Confirmed', 'Active'];
  var IOS = function () { return document.documentElement.classList.contains('ios-app'); };
  var reqTimer = null;
  function reqNeeds(rows) { return rows.filter(function (o) { return o.status === 'link_sent'; }).length; }
  function requestsTile() {
    var note = el('span', { text: 'Status of what you asked for, payment and bills' });
    var t = el('a', { class: 'tile', href: '#requests', onclick: function (e) { e.preventDefault(); showRequests(); } }, [el('b', { text: 'My requests' }), note]);
    sb.rpc('my_client_orders').then(function (r) {
      var rows = (r && r.data) || [];
      if (!rows.length) { t.style.display = 'none'; return; }
      var n = reqNeeds(rows); if (n) note.textContent = n === 1 ? '1 request is ready for payment' : n + ' requests are ready for payment';
    }, function () { /* quiet: the tile just keeps its default text */ });
    return t;
  }
  function stepBar(n) {
    return el('div', { style: 'display:flex;gap:4px;margin:8px 0 2px' }, STEPS.map(function (name, i) {
      var on = n > 0 && i < n;
      return el('div', { style: 'flex:1;text-align:center;font-size:11px;color:' + (on ? 'var(--accent,#800020)' : 'var(--label2,#6a625b)') }, [
        el('div', { style: 'height:4px;border-radius:2px;margin-bottom:4px;background:' + (on ? 'var(--accent,#800020)' : 'var(--sep,#ddd)') }), el('span', { text: name })]);
    }));
  }
  function requestCard(o) {
    var st = STATUS[o.status] || [o.status, '', 0];
    var prods = (o.products || []).join(', ');
    var kids = [el('div', { style: 'display:flex;justify-content:space-between;gap:8px;align-items:baseline' }, [el('b', { text: o.business_name || 'Request' }), el('span', { style: 'font-size:12px;color:var(--label2,#6a625b)', text: String(o.created_at || '').slice(0, 10) })]),
      prods ? el('div', { style: 'font-size:13px;color:var(--label2,#6a625b)', text: prods }) : null,
      stepBar(st[2]),
      el('div', { style: 'font-weight:700;margin-top:6px', text: st[0] }), el('div', { style: 'font-size:14px;color:var(--label2,#6a625b)', text: st[1] })];
    if (o.status === 'link_sent') {
      if (IOS()) kids.push(el('p', { style: 'font-size:14px;margin:10px 0 0', text: 'To pay, open auzslab.in in your browser and sign in. Your account and apps stay right here.' }));
      else kids.push(el('a', { class: 'btn fill', style: 'margin-top:10px', href: SITE + 'pay.html?t=' + encodeURIComponent(o.token), text: 'Read quote and pay' }));
    } else if (o.status === 'payment_submitted' && !IOS()) {
      kids.push(el('a', { class: 'btn', style: 'margin-top:10px', href: SITE + 'pay.html?t=' + encodeURIComponent(o.token), text: 'View payment details' }));
    } else if (o.status === 'paid') {
      if (o.invoice_no) kids.push(el('div', { style: 'font-size:13px;margin-top:6px', text: 'Bill ' + o.invoice_no }));
      kids.push(el('a', { class: 'btn', style: 'margin-top:10px', href: SITE + 'inv.html?t=' + encodeURIComponent(o.token), text: 'View bill' }));
      kids.push(el('button', { class: 'btn fill', type: 'button', style: 'margin-top:8px', onclick: function () { boot(); }, text: 'Open my apps' }));
    }
    return el('div', { style: 'border:1px solid var(--sep,#e4dfda);border-radius:16px;padding:14px;background:var(--surface,#fff)' }, kids);
  }
  async function showRequests() {
    clearInterval(reqTimer);
    var list = el('div', { class: 'grid', style: 'margin-top:12px' }, [el('p', { class: 'sub', text: 'Loading...' })]);
    var msg = el('div', { class: 'msg', role: 'status' });
    async function load() {
      var r = await sb.rpc('my_client_orders');
      if (!list.isConnected) { clearInterval(reqTimer); return; }
      if (r.error) { msg.textContent = 'Could not load your requests. Check your connection.'; return; }
      msg.textContent = ''; var rows = r.data || []; list.textContent = '';
      if (!rows.length) list.append(el('p', { class: 'sub', text: 'You have not asked for anything yet.' }));
      rows.forEach(function (o) { list.append(requestCard(o)); });
    }
    var head = [el('button', { type: 'button', style: 'background:none;border:0;color:inherit;font:inherit;text-decoration:underline;cursor:pointer;padding:0;margin-bottom:8px', onclick: function () { clearInterval(reqTimer); boot(); }, text: 'Back' }),
      el('h1', { text: 'My requests' }), el('p', { class: 'sub', text: 'You ask for products, we check, send a quote, and your access starts after payment is confirmed.' })];
    var more = [list, msg];
    if (!IOS()) more.push(el('a', { class: 'btn', style: 'margin-top:12px', href: SITE + 'cart.html', text: 'Ask for more products' }));
    more.push(el('button', { class: 'btn', type: 'button', style: 'margin-top:8px', onclick: load, text: 'Refresh' }));
    set(head.concat(more));
    await load();
    reqTimer = setInterval(load, 30000);
  }
  function accountTiles() {
    var t = [requestsTile(), siteTile('My account and purchases', 'Profile, orders, bills and add-ons', 'account.html')];
    // no buying inside the iPhone/iPad app (Apple's rules): the cart is only offered on the website, Android and desktop
    if (!document.documentElement.classList.contains('ios-app')) t.push(siteTile('My cart', 'Products you asked for', 'cart.html'));
    return t;
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
    var tiles = [siteTile('Admin panel', 'Leads, clients, payments, team and settings', 'admin.html')];
    var np = window.auzNativePush, st = np && np.webState();
    if (st && st !== 'native' && st !== 'on' && st !== 'unsupported') {
      var a = el('a', { class: 'tile', href: '#' }, [el('b', { text: 'Turn on alerts on this device' }), el('span', { text: st === 'ios-install' ? 'Add this app to your Home Screen first' : 'New client requests, team work and notices' })]);
      a.onclick = function (ev) { ev.preventDefault(); np.enablePlatformWeb(sb, true).then(function (r) { alert(r.message); if (r.ok) adminHome(me); }); };
      tiles.push(a);
    }
    tilesBox('AUZslab admin', 'Clients, requests, pricing and the team.', tiles.concat(exploreTiles()));
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
    if (me && (me.admin || me.team) && window.auzNativePush) { try { window.auzNativePush.enablePlatform(sb); window.auzNativePush.enablePlatformWeb(sb, false); } catch (e) {} }
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
