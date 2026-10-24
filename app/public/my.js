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
  /* The modules, their single screens and their dependencies come from the database (public_module_catalogue). Nothing is
     hardcoded here, so if the list cannot be loaded the builder shows an error instead of guessing. A feature is one screen
     of a module; ticking it turns on the module behind it, and the server adds anything that module needs. */
  var CAT = [], FEATS = [], SCREEN = {};
  function useCatalogue(list) {
    CAT = list || []; FEATS = []; SCREEN = {};
    CAT.forEach(function (m) { (m.screens || []).forEach(function (sc) { FEATS.push([sc.id, sc.label, m.family, m.key, sc.g || 'sq']); SCREEN[sc.id] = sc.url; }); });
  }
  /* Offline label and evidence qualifier come from the database metadata only. Anything missing, malformed or contradictory
     (an unknown level, a flag that is not true/false, "full" that is not verified, "verified" without a browser test) is
     shown as "Not yet checked". Nothing here lists which module can do what. */
  var OFFLINE_LABEL = { full: 'Works offline', partial: 'Partly offline', online_only: 'Needs internet', unknown: 'Not yet checked' };
  var BASES = ['browser_tested', 'code_inspected', 'documentation_only', 'none'];
  var BASIS_TEXT = {
    browser_tested: 'Tested in a test browser. Not yet tested on real phones or computers.',
    code_inspected: 'Based on reading the code. Not tested.',
    documentation_only: 'Based on documentation only. Not tested.',
    none: 'Not checked yet.'
  };
  function offlineOf(m) {
    var o = m && m.offline, unknown = { level: 'unknown', note: '', basis: 'none', qualifier: BASIS_TEXT.none };
    if (!o || typeof o !== 'object' || Array.isArray(o)) return unknown;
    var lv = o.level, bs = o.basis;
    if (typeof lv !== 'string' || !OFFLINE_LABEL.hasOwnProperty(lv) || typeof o.verified !== 'boolean' || typeof bs !== 'string' || BASES.indexOf(bs) < 0) return unknown;
    if ((lv === 'full' && o.verified !== true) || (o.verified === true && bs !== 'browser_tested') || (lv === 'unknown' && o.verified === true)) return unknown;
    if (lv === 'unknown') return unknown;
    return { level: lv, basis: bs, qualifier: BASIS_TEXT[bs], note: lv === 'partial' && typeof o.summary === 'string' ? o.summary : '' };
  }
  function offlineBadge(m) { var d = offlineOf(m); return el('span', { class: 'ob ob-' + d.level, title: d.qualifier, text: OFFLINE_LABEL[d.level] }); }
  function modLabel(k) { var m = CAT.filter(function (x) { return x.key === k; })[0]; return m ? m.label : k; }
  function embedUrl(u) { var h = u.indexOf('#'), base = h < 0 ? u : u.slice(0, h), hash = h < 0 ? '' : u.slice(h); return base + (base.indexOf('?') < 0 ? '?' : '&') + 'embed=1' + hash; }
  var FK = 'auz_feat';
  function getFeat() { try { return JSON.parse(localStorage.getItem(FK) || '[]'); } catch (e) { return []; } }
  function setFeat(a) { try { localStorage.setItem(FK, JSON.stringify(a)); } catch (e) {} setSel(blocksOf(a)); }
  function blocksOf(a) { var out = []; FEATS.forEach(function (f) { if (a.indexOf(f[0]) >= 0 && out.indexOf(f[3]) < 0) out.push(f[3]); }); return out; }
  var DK = 'auz_build_design';
  var DESIGN = (function () { try { return Object.assign({ nav: 'bottom', card: 'soft', theme: 'dark', accent: '#800020' }, JSON.parse(localStorage.getItem(DK) || '{}')); } catch (e) { return { nav: 'bottom', card: 'soft', theme: 'dark', accent: '#800020' }; } })();
  function saveDesign() { try { localStorage.setItem(DK, JSON.stringify(DESIGN)); } catch (e) {} }
  var HAS_SESSION = false;
  function cats() {
    return FEATS.filter(function (f) { return CAT.some(function (m) { return m.key === f[3] && m.status === 'available'; }); }).map(function (f) { return { id: f[0], name: f[1], line: f[2], keys: [f[3]], g: f[4], mod: f[3] }; });
  }
  function glyph(g) {
    var d = el('span', { class: 'gl gl-' + g, 'aria-hidden': 'true' });
    for (var i = 0; i < 4; i++) d.append(el('i'));
    return d;
  }
  function paintBuilder() {
    var feats = getFeat(), t = $('tiles'); t.textContent = '';
    var list = cats(), chosen = [], area = '';
    list.forEach(function (c) {
      if (c.line !== area) { area = c.line; t.append(el('h3', { class: 'area mono', text: area.toUpperCase() })); }
      var on = feats.indexOf(c.id) >= 0; if (on) chosen.push(c);
      t.append(el('button', { type: 'button', class: 'tile' + (on ? ' on' : ''), 'aria-pressed': on ? 'true' : 'false', onclick: function () {
        var s = getFeat(); if (on) s = s.filter(function (k) { return k !== c.id; }); else s.push(c.id); setFeat(s); paintBuilder(); } },
        [glyph(c.g), el('span', { class: 'plus', text: '+' }), el('b', { text: c.name }), offlineBadge(CAT.filter(function (m) { return m.key === c.mod; })[0])]));
    });
    paintDesign(); paintPhone(chosen); paintGo(chosen.length); paintDeps();
  }
  var depSeq = 0;
  async function paintDeps() {
    var box = $('deps'); if (!box) return;
    var sel = getSel(), my = ++depSeq; box.textContent = '';
    if (!sel.length) return;
    var r = await sb.rpc('public_module_resolve', { p: { blocks: sel } });
    if (my !== depSeq) return;
    box.textContent = '';
    if (r.error || !r.data) { box.append(el('p', { class: 'err', text: (r.error && r.error.message) || 'Could not check your choices.' })); return; }
    (r.data.keys || []).forEach(function (k) {
      var m = CAT.filter(function (x) { return x.key === k; })[0]; if (!m) return;
      var add = (r.data.added || []).filter(function (a) { return a.key === k; })[0];
      box.append(el('div', { class: 'dep' }, [el('b', { text: m.label }), el('small', { text: m.description }), offlineBadge(m), el('small', { class: 'ob-basis', text: offlineOf(m).qualifier }), offlineOf(m).note ? el('small', { class: 'ob-note', text: offlineOf(m).note }) : null,
        add ? el('small', { class: 'why', text: 'Added because ' + modLabel(add.because) + ' needs it.' }) : null]));
    });
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
    if (!chosen) { var fs = getFeat(); chosen = cats().filter(function (c) { return fs.indexOf(c.id) >= 0; }); }
    var ph = $('phone'); ph.dataset.nav = DESIGN.nav; ph.dataset.card = DESIGN.card; ph.dataset.theme = DESIGN.theme; ph.style.setProperty('--my', DESIGN.accent);
    var nav = $('pnav'), cards = $('pcards'); nav.textContent = ''; cards.textContent = '';
    if (!chosen.length) cards.append(el('p', { class: 'empty mono' }, ['Tick the features you need.', el('br'), 'Your app appears here.']));
    chosen.forEach(function (c, i) {
      nav.append(el('span', { class: 'pn' + (i === 0 ? ' on' : ''), text: c.name.split(' ')[0] }));
      var bars = el('div', { class: 'pbars' }); [40, 70, 55, 90, 62].forEach(function (h) { var b = el('i'); b.style.height = h + '%'; bars.append(b); });
      cards.append(el('div', { class: 'pc', style: 'animation-delay:' + (i * 50) + 'ms' }, [el('b', { text: c.name }), bars]));
    });
    $('count').textContent = chosen.length + (chosen.length === 1 ? ' FEATURE' : ' FEATURES');
    $('devname').textContent = chosen.length ? 'YOUR APP' : 'YOUR APP';
  }
  function paintGo(n) {
    var g = $('go'); g.textContent = '';
    if (HAS_SESSION) {
      var name = el('input', { placeholder: 'Your name', autocomplete: 'name' }), phone = el('input', { placeholder: 'Mobile / WhatsApp', type: 'tel', inputmode: 'tel', autocomplete: 'tel' }), biz = el('input', { placeholder: 'Business name', autocomplete: 'organization' });
      var err = el('div', { class: 'err' }), btn = el('button', { class: 'btn', type: 'button', text: 'Build my app, 3 days free' });
      btn.disabled = !n;
      btn.onclick = async function () {
        err.textContent = ''; if (!getSel().length) { err.textContent = 'Tick at least one feature.'; return; }
        btn.disabled = true;
        var r = await sb.rpc('start_self_trial', { p: { business_name: biz.value, contact_name: name.value, phone: phone.value, blocks: getSel(), features: getFeat() } });
        if (r.error) { btn.disabled = false; err.textContent = r.error.message; return; }
        setSel([]); try { localStorage.setItem('auz_feat_done', JSON.stringify(getFeat())); } catch (e) {} setFeat([]); location.reload();
      };
      sb.rpc('my_profile').then(function (p) { if (p && p.data) { name.value = name.value || p.data.name || ''; phone.value = phone.value || p.data.phone || ''; biz.value = biz.value || p.data.business_name || ''; } }).catch(function () {});
      g.append(name, phone, biz, btn, err, el('p', { class: 'note', text: 'No payment now. Nothing is charged during the trial.' }));
      return;
    }
    var go = el('a', { class: 'btn', href: '/start.html', text: 'Sign in to build my app' });
    go.onclick = function () { if (!getSel().length) { var e = $('go').querySelector('.err'); if (e) e.textContent = 'Tick the features you need first.'; return false; } };
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
    p.append(sw);
    if ((cfg.feat || []).length) p.append(el('h3', { text: 'Your features' }), el('p', { text: FEATS.filter(function (f) { return cfg.feat.indexOf(f[0]) >= 0; }).map(function (f) { return f[1]; }).join(', ') }));
    p.append(el('h3', { text: 'Your apps' }));
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
    try { var fd0 = JSON.parse(localStorage.getItem('auz_feat_done') || 'null'), k0 = 'my.cfg.' + (D.tenant ? D.tenant.slug : 'x'), c0 = JSON.parse(localStorage.getItem(k0) || '{}'); var fl = fd0 || c0.feat;
      if (fl && fl.length) { var fa = FEATS.filter(function (f) { return fl.indexOf(f[0]) >= 0 && SCREEN[f[0]] && own(D, f[3]); }).map(function (f) { return [f[0], f[1], embedUrl(SCREEN[f[0]]), function () { return true; }]; }); if (fa.length) list = fa; } } catch (e) {}
    if (!list.length) { location.replace('/start.html?switch=1'); return; }
    cfgKey = 'my.cfg.' + (D.tenant ? D.tenant.slug : 'x'); cfg = load();
    try { var bd = JSON.parse(localStorage.getItem('auz_build_design') || 'null'); if (bd && !cfg.designed) { cfg.nav = bd.nav; cfg.card = bd.card; cfg.theme = bd.theme; cfg.accent = bd.accent; cfg.designed = 1; save(); localStorage.removeItem('auz_build_design'); } } catch (e) {}
    try { var fd = JSON.parse(localStorage.getItem('auz_feat_done') || 'null'); if (fd && !cfg.feat) { cfg.feat = fd; save(); localStorage.removeItem('auz_feat_done'); } } catch (e) {}
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
    var cl = await sb.rpc('public_module_catalogue'), catOk = !!(cl && !cl.error && Array.isArray(cl.data) && cl.data.length);
    if (catOk) useCatalogue(cl.data);
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
    HAS_SESSION = !!sess; show('build');
    if (!catOk) { var t0 = $('tiles'); t0.textContent = ''; t0.append(el('p', { class: 'err', text: 'We could not load the list of features. Nothing was changed. Check your connection and try again.' }), el('button', { class: 'btn ghost', type: 'button', text: 'Try again', onclick: function () { location.reload(); } })); $('go').textContent = ''; return; }
    paintBuilder();
  }
  boot().catch(function (e) { show('build'); $('tiles').textContent = (e && e.message) || 'Could not load. Check your connection and try again.'; });
})();
