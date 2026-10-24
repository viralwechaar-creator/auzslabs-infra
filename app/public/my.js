/* One page for the whole "build your own software" idea. Signed out or without a business: pick blocks and watch your
   software assemble, then start a 3-day trial (or use the demo login while testing). With a business: the same page is the
   combined app: one bar, one chip per block, each block's full app inside (same address, same login). A trial that ended
   shows a lock screen with Subscribe. Plain DOM, textContent only. */
(function () {
  var sb = supabase.createClient(CFG.url, CFG.key);
  var $ = function (id) { return document.getElementById(id); };
  var SEL = 'auz_build';
  function el(tag, props, kids) {
    var n = document.createElement(tag);
    Object.keys(props || {}).forEach(function (k) { if (k === 'text') n.textContent = props[k]; else if (k === 'style') n.style.cssText = props[k]; else if (k.slice(0, 2) === 'on') n[k] = props[k]; else n.setAttribute(k, props[k]); });
    (kids || []).forEach(function (c) { if (c != null) n.append(c); });
    return n;
  }
  function getSel() { try { return JSON.parse(localStorage.getItem(SEL) || '[]'); } catch (e) { return []; } }
  function setSel(a) { try { localStorage.setItem(SEL, JSON.stringify(a)); } catch (e) {} }
  function b64(o) { return btoa(unescape(encodeURIComponent(JSON.stringify(o)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
  function show(id) { ['build', 'work', 'lock'].forEach(function (k) { $(k).hidden = k !== id; }); }
  function own(d, k) { return d.features && d.features[k] === true && (d.enabled_features || {})[k] !== false; }

  /* ---------- builder: areas of a business, not a feature list ---------- */
  var CATS = [
    { id: 'sell', name: 'Sell', line: 'Counter, tables, ordering', keys: ['pos', 'self_order', 'scan'], g: 'bars' },
    { id: 'phone', name: 'Phone shop', line: 'Stock, repairs, sales', keys: ['mobile'], g: 'ring' },
    { id: 'style', name: 'Clothing and footwear', line: 'Sizes, colours, store', keys: ['style'], g: 'tri' },
    { id: 'people', name: 'People', line: 'Attendance and pay', keys: ['payroll'], g: 'dots' },
    { id: 'money', name: 'Money', line: 'Books and cash', keys: ['accounting', 'finance'], g: 'sq' },
    { id: 'online', name: 'Online', line: 'Your own website', keys: ['website_builder'], g: 'orbit' }
  ];
  var DK = 'auz_build_design';
  var DESIGN = (function () { try { return Object.assign({ nav: 'bottom', card: 'soft', theme: 'dark', accent: '#800020' }, JSON.parse(localStorage.getItem(DK) || '{}')); } catch (e) { return { nav: 'bottom', card: 'soft', theme: 'dark', accent: '#800020' }; } })();
  function saveDesign() { try { localStorage.setItem(DK, JSON.stringify(DESIGN)); } catch (e) {} }
  var BLOCKS = [], HAS_SESSION = false;
  function cats() {
    var have = BLOCKS.map(function (b) { return b.key; }), used = [], out = [];
    CATS.forEach(function (c) { var k = c.keys.filter(function (x) { return have.indexOf(x) >= 0; }); if (k.length) { used = used.concat(k); out.push(Object.assign({}, c, { keys: k })); } });
    BLOCKS.forEach(function (b) { if (used.indexOf(b.key) < 0) out.push({ id: b.key, name: b.label, line: b.blurb, keys: [b.key], g: 'sq' }); });
    return out;
  }
  function catOn(c, sel) { return c.keys.every(function (k) { return sel.indexOf(k) >= 0; }); }
  function glyph(g) {
    var d = el('span', { class: 'gl gl-' + g, 'aria-hidden': 'true' });
    for (var i = 0; i < 4; i++) d.append(el('i'));
    return d;
  }
  function paintBuilder() {
    var sel = getSel(), t = $('tiles'); t.textContent = '';
    var list = cats(), chosen = [];
    list.forEach(function (c, i) {
      var on = catOn(c, sel); if (on) chosen.push(c);
      t.append(el('button', { type: 'button', class: 'tile' + (on ? ' on' : ''), 'aria-pressed': on ? 'true' : 'false', onclick: function () {
        var s = getSel(); if (on) s = s.filter(function (k) { return c.keys.indexOf(k) < 0; }); else c.keys.forEach(function (k) { if (s.indexOf(k) < 0) s.push(k); }); setSel(s); paintBuilder(); } },
        [glyph(c.g), el('span', { class: 'plus', text: '+' }), el('b', { text: c.name }), el('small', { text: c.line })]));
    });
    paintDesign(); paintPhone(chosen); paintGo(chosen.length);
  }
  function opt(label, key, vals) {
    var row = el('div', { class: 'opt' }, [el('span', { class: 'mono', text: label })]), seg = el('div', { class: 'seg' });
    vals.forEach(function (v) { seg.append(el('button', { type: 'button', class: DESIGN[key] === v[0] ? 'on' : '', text: v[1], onclick: function () { DESIGN[key] = v[0]; saveDesign(); paintDesign(); paintPhone(); } })); });
    row.append(seg); return row;
  }
  function paintDesign() {
    var d = $('design'); d.textContent = '';
    d.append(opt('MENU', 'nav', [['bottom', 'Bottom bar'], ['side', 'Side rail'], ['top', 'Top tabs']]),
      opt('CARDS', 'card', [['soft', 'Soft'], ['line', 'Outlined'], ['solid', 'Solid']]),
      opt('LOOK', 'theme', [['dark', 'Dark'], ['light', 'Light']]));
    var sw = el('div', { class: 'sw' });
    ['#800020', '#0f5a56', '#2a3f9a', '#a24a14', '#7a2e5a', '#3a3a3a'].forEach(function (c) { var b = el('button', { type: 'button', 'aria-label': c, class: DESIGN.accent === c ? 'on' : '' }); b.style.background = c; b.onclick = function () { DESIGN.accent = c; saveDesign(); paintDesign(); paintPhone(); }; sw.append(b); });
    d.append(el('div', { class: 'opt' }, [el('span', { class: 'mono', text: 'COLOUR' }), sw]));
  }
  function paintPhone(chosen) {
    if (!chosen) { var sel = getSel(); chosen = cats().filter(function (c) { return catOn(c, sel); }); }
    var ph = $('phone'); ph.dataset.nav = DESIGN.nav; ph.dataset.card = DESIGN.card; ph.dataset.theme = DESIGN.theme; ph.style.setProperty('--my', DESIGN.accent);
    var nav = $('pnav'), cards = $('pcards'); nav.textContent = ''; cards.textContent = '';
    if (!chosen.length) cards.append(el('p', { class: 'empty mono' }, ['Pick what you do.', el('br'), 'Your app appears here.']));
    chosen.forEach(function (c, i) {
      nav.append(el('span', { class: 'pn' + (i === 0 ? ' on' : ''), text: c.name.split(' ')[0] }));
      var bars = el('div', { class: 'pbars' }); [40, 70, 55, 90, 62].forEach(function (h) { var b = el('i'); b.style.height = h + '%'; bars.append(b); });
      cards.append(el('div', { class: 'pc', style: 'animation-delay:' + (i * 50) + 'ms' }, [el('b', { text: c.name }), el('small', { text: c.line }), bars]));
    });
    $('count').textContent = chosen.length + (chosen.length === 1 ? ' AREA' : ' AREAS');
    $('devname').textContent = chosen.length ? 'YOUR APP' : 'YOUR APP';
  }
  function paintGo(n) {
    var g = $('go'); g.textContent = '';
    if (HAS_SESSION) {
      var name = el('input', { placeholder: 'Your name', autocomplete: 'name' }), phone = el('input', { placeholder: 'Mobile / WhatsApp', type: 'tel', inputmode: 'tel', autocomplete: 'tel' }), biz = el('input', { placeholder: 'Business name', autocomplete: 'organization' });
      var err = el('div', { class: 'err' }), btn = el('button', { class: 'btn', type: 'button', text: 'Build my app, 3 days free' });
      btn.disabled = !n;
      btn.onclick = async function () {
        err.textContent = ''; if (!getSel().length) { err.textContent = 'Pick at least one area.'; return; }
        btn.disabled = true;
        var r = await sb.rpc('start_self_trial', { p: { business_name: biz.value, contact_name: name.value, phone: phone.value, blocks: getSel() } });
        if (r.error) { btn.disabled = false; err.textContent = r.error.message; return; }
        setSel([]); location.reload();
      };
      sb.rpc('my_profile').then(function (p) { if (p && p.data) { name.value = name.value || p.data.name || ''; phone.value = phone.value || p.data.phone || ''; biz.value = biz.value || p.data.business_name || ''; } }).catch(function () {});
      g.append(name, phone, biz, btn, err, el('p', { class: 'note', text: 'No payment now. Nothing is charged during the trial.' }));
      return;
    }
    var go = el('a', { class: 'btn', href: '/start.html', text: 'Sign in to build my app' });
    go.onclick = function () { if (!getSel().length) { var e = $('go').querySelector('.err'); if (e) e.textContent = 'Pick what you do first.'; return false; } };
    var demo = el('button', { class: 'btn ghost', type: 'button', text: 'Testing? Use the demo login' }), err2 = el('div', { class: 'err' });
    demo.onclick = async function () {
      demo.disabled = true; err2.textContent = '';
      var r = await sb.auth.signInWithPassword({ email: 'demo@auzslab.in', password: 'Auzslab@Demo' });
      try { if (window.auz2fa) r = await auz2fa.resolve(sb, r); } catch (e) {}
      demo.disabled = false;
      if (r.error || !(r.data && r.data.session)) { err2.textContent = (r.error && r.error.message) || 'Could not sign in.'; return; }
      location.reload();
    };
    g.append(go, demo, err2, el('p', { class: 'note', text: 'Demo login: demo@auzslab.in / Auzslab@Demo' }));
  }

  /* ---------- workspace ---------- */
  var APPS = [
    ['pos', 'POS', '/index.html', function (d) { return own(d, 'pos'); }],
    ['mob', 'Phone shop', '/mob.html', function (d) { return own(d, 'mobile'); }],
    ['sty', 'Clothing', '/style.html', function (d) { return own(d, 'style'); }],
    ['fin', 'Money', '/finance.html', function (d) { return own(d, 'finance'); }],
    ['payroll', 'Staff and pay', '/payroll.html', function (d) { return own(d, 'payroll'); }],
    ['accounts', 'Accounts', '/accounts.html', function (d) { return own(d, 'accounting'); }],
    ['scan', 'Scan to bill', '/scan.html', function (d) { return own(d, 'accounting') || own(d, 'scan'); }],
    ['console', 'Reports and settings', '/dashboard.html', function (d) { return own(d, 'pos') && (d.my_role === 'owner' || d.my_role === 'manager'); }],
    ['builder', 'Website', '/builder.html', function (d) { return own(d, 'website_builder') && d.my_role === 'owner'; }]
  ];
  var COLOURS = ['#800020', '#0f5a56', '#2a3f9a', '#a24a14', '#7a2e5a', '#3a3a3a'];
  var D, list = [], cfg, cfgKey, current = null, frames = {};
  function load() { try { return JSON.parse(localStorage.getItem(cfgKey) || '{}'); } catch (e) { return {}; } }
  function save() { try { localStorage.setItem(cfgKey, JSON.stringify(cfg)); } catch (e) {} }
  function look() { document.body.style.setProperty('--my', cfg.accent || '#800020'); $('work').dataset.nav = cfg.nav || 'top'; $('work').dataset.theme = cfg.theme || 'dark'; $('work').dataset.card = cfg.card || 'soft'; }
  function visible() {
    var order = cfg.order || [];
    var l = list.filter(function (a) { return (cfg.hidden || []).indexOf(a[0]) < 0; });
    l.sort(function (a, b) { var x = order.indexOf(a[0]), y = order.indexOf(b[0]); return (x < 0 ? 99 : x) - (y < 0 ? 99 : y); });
    return l;
  }
  function chips() {
    var box = $('chips'); box.textContent = '';
    visible().forEach(function (a) { box.append(el('button', { class: 'chip' + (current === a[0] ? ' on' : ''), type: 'button', text: a[1], onclick: function () { open(a[0]); } })); });
  }
  function open(id) {
    var a = list.filter(function (x) { return x[0] === id; })[0]; if (!a) return;
    current = id; cfg.last = id; save();
    Object.keys(frames).forEach(function (k) { frames[k].hidden = k !== id; });
    if (!frames[id]) { var f = el('iframe', { src: a[2], title: a[1], allow: 'camera; geolocation; clipboard-write' }); frames[id] = f; $('stage').append(f); }
    chips();
  }
  function panel() {
    var p = $('panel'); p.textContent = '';
    p.append(el('h2', { text: 'Customise' }), el('p', { text: 'Make it yours. These choices stay on this device.' }));
    [['Menu', 'nav', [['top', 'Top'], ['side', 'Side'], ['bottom', 'Bottom']]], ['Look', 'theme', [['dark', 'Dark'], ['light', 'Light']]]].forEach(function (o) {
      p.append(el('h3', { text: o[0] })); var sg = el('div', { class: 'seg' });
      o[2].forEach(function (v) { sg.append(el('button', { type: 'button', class: (cfg[o[1]] || (o[1] === 'nav' ? 'top' : 'dark')) === v[0] ? 'on' : '', text: v[1], onclick: function () { cfg[o[1]] = v[0]; save(); look(); panel(); } })); });
      p.append(sg);
    });
    p.append(el('h3', { text: 'Colour' }));
    var sw = el('div', { class: 'sw' });
    COLOURS.forEach(function (c) { var b = el('button', { type: 'button', 'aria-label': c, class: (cfg.accent || '#800020') === c ? 'on' : '' }); b.style.background = c; b.onclick = function () { cfg.accent = c; save(); look(); panel(); }; sw.append(b); });
    p.append(sw, el('h3', { text: 'Your blocks' }));
    var l = list.slice().sort(function (a, b) { var o = cfg.order || [], x = o.indexOf(a[0]), y = o.indexOf(b[0]); return (x < 0 ? 99 : x) - (y < 0 ? 99 : y); });
    l.forEach(function (a, i) {
      var hid = (cfg.hidden || []).indexOf(a[0]) >= 0;
      function move(d) { var ids = l.map(function (x) { return x[0]; }); var j = i + d; if (j < 0 || j >= ids.length) return; var t = ids[i]; ids[i] = ids[j]; ids[j] = t; cfg.order = ids; save(); chips(); panel(); }
      p.append(el('div', { class: 'row' }, [el('span', { text: a[1] }),
        el('button', { type: 'button', 'aria-label': 'Move up', text: '↑', onclick: function () { move(-1); } }), el('button', { type: 'button', 'aria-label': 'Move down', text: '↓', onclick: function () { move(1); } }),
        el('button', { type: 'button', text: hid ? 'Show' : 'Hide', onclick: function () {
          var h = cfg.hidden || []; if (hid) h = h.filter(function (x) { return x !== a[0]; }); else if (visible().length > 1) h = h.concat([a[0]]);
          cfg.hidden = h; save(); if (current === a[0] && h.indexOf(a[0]) >= 0) open(visible()[0][0]); chips(); panel(); } })]));
    });
    p.append(el('p', {}, [el('a', { href: '/start.html?switch=1', style: 'color:#fff', text: 'Account, requests and all apps' })]),
      el('button', { class: 'btn ghost', type: 'button', text: 'Sign out', onclick: async function () { await sb.auth.signOut(); location.reload(); } }),
      el('button', { class: 'btn done', type: 'button', text: 'Done', onclick: function () { $('panel').hidden = true; $('scrim').hidden = true; } }));
  }
  async function subscribe(tr) {
    var o = tr.order;
    if (!o) { var r = await sb.rpc('trial_subscribe'); if (r.error) { alert(r.error.message); return; } o = r.data; }
    if (o.status === 'link_sent') { var s = (await sb.auth.getSession()).data.session; location.href = 'https://auzslab.in/pay.html?t=' + o.token + (s ? '#auz_gt=' + b64({ t: s.access_token, u: s.user }) : ''); return; }
    alert('We are preparing your quote. You will get it on WhatsApp shortly.');
  }
  async function workspace(d, tr) {
    D = d;
    list = APPS.filter(function (a) { return a[3](D); });
    if (!list.length) { location.replace('/start.html?switch=1'); return; }
    cfgKey = 'my.cfg.' + (D.tenant ? D.tenant.slug : 'x'); cfg = load();
    try { var bd = JSON.parse(localStorage.getItem('auz_build_design') || 'null'); if (bd && !cfg.designed) { cfg.nav = bd.nav; cfg.card = bd.card; cfg.theme = bd.theme; cfg.accent = bd.accent; cfg.designed = 1; save(); localStorage.removeItem('auz_build_design'); } } catch (e) {}
    look();
    $('brand').textContent = D.tenant ? D.tenant.name : 'AUZslab'; document.title = $('brand').textContent;
    if (tr && tr.state === 'active') {
      var days = Math.max(0, Math.ceil(tr.seconds_left / 86400)), t = $('trial'); t.hidden = false;
      t.append(el('span', { text: 'Free trial: ' + (days <= 1 ? 'ends within a day' : days + ' days left') }), el('button', { type: 'button', text: 'Subscribe', onclick: function () { subscribe(tr); } }));
    }
    var v = visible(), start = v.filter(function (a) { return a[0] === cfg.last; })[0] || v[0];
    if (!start) { cfg.hidden = []; save(); v = visible(); start = v[0]; }
    show('work'); chips(); open(start[0]);
    $('gear').onclick = function () { panel(); $('panel').hidden = false; $('scrim').hidden = false; };
    $('scrim').onclick = function () { $('panel').hidden = true; $('scrim').hidden = true; };
  }

  async function boot() {
    var bl = await sb.rpc('public_trial_blocks');
    BLOCKS = (bl && bl.data) || [];
    var sess = (await sb.auth.getSession()).data.session;
    if (sess) {
      var hm = await sb.rpc('hub_me');
      if (hm && hm.error && (hm.error.status || 0) === 401) { await sb.auth.signOut(); sess = null; }
      else if (hm && hm.data && hm.data.business) {
        var r = await sb.rpc('my_dashboard');
        if (r.error || !r.data) { location.replace('/start.html'); return; }
        var ts = await sb.rpc('trial_status'), tr = ts && ts.data;
        if (tr && tr.state === 'locked') { show('lock'); $('lockGo').onclick = function () { subscribe(tr); }; return; }
        return workspace(r.data, tr);
      }
    }
    HAS_SESSION = !!sess; show('build'); paintBuilder();
  }
  boot().catch(function (e) { show('build'); $('tiles').textContent = (e && e.message) || 'Could not load. Check your connection and try again.'; });
})();
