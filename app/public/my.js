/* One combined app: a single shell for every block the business has. Each block keeps its own full app, shown inside this
   page (same address, same login) so switching is instant and nothing reloads. Order, hidden blocks, accent colour and
   light/dark are the owner's own and are kept on this device. Plain DOM, textContent only. */
(function () {
  var sb = supabase.createClient(CFG.url, CFG.key);
  var $ = function (id) { return document.getElementById(id); };
  function own(d, k) { return d.features && d.features[k] === true && (d.enabled_features || {})[k] !== false; }
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
  var COLOURS = ['#800020', '#0f5a56', '#2a3f9a', '#a24a14', '#7a2e5a', '#171717'];
  var D, list = [], cfg, cfgKey, current = null, frames = {};
  function load() { try { return JSON.parse(localStorage.getItem(cfgKey) || '{}'); } catch (e) { return {}; } }
  function save() { try { localStorage.setItem(cfgKey, JSON.stringify(cfg)); } catch (e) {} }
  function el(tag, props, kids) {
    var n = document.createElement(tag);
    Object.keys(props || {}).forEach(function (k) { if (k === 'text') n.textContent = props[k]; else if (k.slice(0, 2) === 'on') n[k] = props[k]; else n.setAttribute(k, props[k]); });
    (kids || []).forEach(function (c) { if (c != null) n.append(c); });
    return n;
  }
  function look() {
    document.body.style.setProperty('--my', cfg.accent || '#800020');
    var dark = cfg.theme === 'dark' || (cfg.theme !== 'light' && window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
    document.body.classList.toggle('dark', !!dark);
  }
  function visible() {
    var order = cfg.order || [];
    var l = list.filter(function (a) { return (cfg.hidden || []).indexOf(a[0]) < 0; });
    l.sort(function (a, b) { var x = order.indexOf(a[0]), y = order.indexOf(b[0]); return (x < 0 ? 99 : x) - (y < 0 ? 99 : y); });
    return l;
  }
  function chips() {
    var box = $('chips'); box.textContent = '';
    visible().forEach(function (a) { box.append(el('button', { class: 'chip' + (current === a[0] ? ' on' : ''), type: 'button', text: a[1], onclick: function () { show(a[0]); } })); });
  }
  function show(id) {
    var a = list.filter(function (x) { return x[0] === id; })[0]; if (!a) return;
    current = id; cfg.last = id; save();
    Object.keys(frames).forEach(function (k) { frames[k].hidden = k !== id; });
    if (!frames[id]) {
      var f = el('iframe', { src: a[2], title: a[1], allow: 'camera; geolocation; clipboard-write' });
      frames[id] = f; $('stage').append(f);
    }
    $('stage').querySelectorAll('.msg').forEach(function (m) { m.remove(); });
    chips();
  }
  function panel() {
    var p = $('panel'); p.textContent = '';
    p.append(el('h2', { text: 'Customise' }), el('p', { text: 'Make it yours. These choices stay on this device.' }));
    p.append(el('h3', { text: 'Look' }));
    var seg = el('div', { class: 'seg' });
    [['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark']].forEach(function (t) { seg.append(el('button', { class: 'pb' + ((cfg.theme || 'auto') === t[0] ? ' on' : ''), type: 'button', text: t[1], onclick: function () { cfg.theme = t[0]; save(); look(); panel(); } })); });
    p.append(seg, el('h3', { text: 'Colour' }));
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
          cfg.hidden = h; save(); if (current === a[0] && h.indexOf(a[0]) >= 0) show(visible()[0][0]); chips(); panel(); } })]));
    });
    p.append(el('button', { class: 'pb close', type: 'button', text: 'Done', onclick: function () { $('panel').hidden = true; $('scrim').hidden = true; } }));
    p.append(el('p', {}, [el('a', { href: '/start.html?switch=1', text: 'Account, requests and all apps' })]));
    p.append(el('p', { text: 'Need something that is not here? Tell us on the contact page and we build it for you.' }));
  }
  function b64(o) { return btoa(unescape(encodeURIComponent(JSON.stringify(o)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
  async function subscribe(tr) {
    var o = tr.order;
    if (!o) { var r = await sb.rpc('trial_subscribe'); if (r.error) { alert(r.error.message); return; } o = r.data; }
    if (o.status === 'link_sent') { var s = (await sb.auth.getSession()).data.session; location.href = 'https://auzslab.in/pay.html?t=' + o.token + (s ? '#auz_gt=' + b64({ t: s.access_token, u: s.user }) : ''); return; }
    alert('We are preparing your quote. You will get it on WhatsApp shortly.');
  }
  async function boot() {
    var sess = (await sb.auth.getSession()).data.session;
    if (!sess) { location.replace('/start.html'); return; }
    var r = await sb.rpc('my_dashboard');
    if (r.error || !r.data) { location.replace('/start.html'); return; }
    D = r.data;
    var ts = await sb.rpc('trial_status'), tr = ts && ts.data;
    if (tr && tr.state === 'locked') { location.replace('/start.html'); return; }
    list = APPS.filter(function (a) { return a[3](D); });
    if (!list.length) { location.replace('/start.html'); return; }
    cfgKey = 'my.cfg.' + (D.tenant ? D.tenant.slug : 'x'); cfg = load(); look();
    $('brand').textContent = D.tenant ? D.tenant.name : 'AUZslab';
    document.title = $('brand').textContent;
    if (tr && tr.state === 'active') {
      var days = Math.max(0, Math.ceil(tr.seconds_left / 86400)), t = $('trial'); t.hidden = false;
      t.append(el('span', { text: 'Free trial: ' + (days <= 1 ? 'ends within a day' : days + ' days left') }), el('button', { type: 'button', text: 'Subscribe', onclick: function () { subscribe(tr); } }));
    }
    var v = visible(), start = v.filter(function (a) { return a[0] === cfg.last; })[0] || v[0];
    if (!start) { cfg.hidden = []; save(); v = visible(); start = v[0]; }
    chips(); show(start[0]);
    $('gear').onclick = function () { panel(); $('panel').hidden = false; $('scrim').hidden = false; };
    $('scrim').onclick = function () { $('panel').hidden = true; $('scrim').hidden = true; };
  }
  boot().catch(function (e) { $('stage').textContent = (e && e.message) || 'Could not load.'; });
})();
