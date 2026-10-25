/* The "build your own software" builder, shown on the Why AUZslab page. Same steps and the same database lists as the app
   builder (public_business_types, public_module_catalogue, public_module_tiers). When the person starts, the trial is made
   here and the session is handed to app.auzslab.in/my.html, where the combined app opens. Plain DOM, textContent only. */
(function () {
  var root = document.getElementById('bd'); if (!root) return;
  var sb = supabase.createClient(CFG.url, CFG.key), APP = 'https://app.auzslab.in/my.html';
  var $ = function (id) { return document.getElementById(id); };
  function el(tag, props, kids) {
    var n = document.createElement(tag);
    Object.keys(props || {}).forEach(function (k) { if (k === 'text') n.textContent = props[k]; else if (k.slice(0, 2) === 'on') n[k] = props[k]; else n.setAttribute(k, props[k]); });
    (kids || []).forEach(function (c) { if (c != null) n.append(c); });
    return n;
  }
  function b64(o) { return btoa(unescape(encodeURIComponent(JSON.stringify(o)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
  function ls(k, v) { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} return null; }
  var CAT = [], FEATS = [], BT = [], TIERS = {}, BUSY = {}, TYPE = ls('auz_build_type') || '', FEAT = [], STATE = { session: null, staff: false, business: false };
  try { FEAT = JSON.parse(ls('auz_feat') || '[]'); } catch (e) {}
  var DESIGN = { nav: 'bottom', card: 'soft', theme: 'dark', accent: '#800020' };
  try { Object.assign(DESIGN, JSON.parse(ls('auz_build_design') || '{}')); } catch (e) {}
  function saveFeat() { ls('auz_feat', JSON.stringify(FEAT)); }
  function saveDesign() { ls('auz_build_design', JSON.stringify(DESIGN)); }
  function blocksOf() { var out = []; FEATS.forEach(function (f) { if (FEAT.indexOf(f.id) >= 0 && out.indexOf(f.mod) < 0) out.push(f.mod); }); return out; }
  function typeOf(k) { return BT.filter(function (t) { return t.key === k; })[0] || null; }
  function tier(mod) { var t = TIERS[TYPE]; var m = t && t.modules.filter(function (x) { return x.key === mod; })[0]; return m || { tier: 'unavailable', reason: 'Checking...' }; }
  function list() {
    var t = typeOf(TYPE); if (!t || t.status !== 'active' || !TIERS[TYPE]) return [];
    return FEATS.map(function (f) { var ti = tier(f.mod); return Object.assign({ tier: ti.tier, reason: ti.reason }, f); }).sort(function (a, b) { var r = { recommended: 0, compatible: 1, unavailable: 2 }; return r[a.tier] - r[b.tier]; });
  }
  function paintTypes() {
    var box = $('bdTypes'), note = $('bdNote'); box.textContent = ''; note.textContent = '';
    BT.forEach(function (t) {
      var soon = t.status !== 'active', on = TYPE === t.key;
      box.append(el('button', { type: 'button', class: 'bd-t' + (on ? ' on' : '') + (soon ? ' soon' : ''), 'aria-pressed': on ? 'true' : 'false', onclick: function () {
        if (soon) { note.textContent = t.label + ' is coming soon here. Our team sets these businesses up for you. Tell us at contact.html.'; return; }
        if (TYPE !== t.key) { TYPE = t.key; ls('auz_build_type', TYPE); FEAT = []; saveFeat(); } paintTypes(); paintNeeds(); } },
        [el('b', { text: t.label }), el('small', { text: t.description }), soon ? el('em', { text: 'Coming soon' }) : null]));
    });
  }
  function loadTiers(k) {
    if (TIERS[k] || BUSY[k]) return; BUSY[k] = true;
    sb.rpc('public_module_tiers', { p: { business_type: k } }).then(function (r) { BUSY[k] = false; if (r && r.data) TIERS[k] = r.data; if (TYPE === k) paintNeeds(); }).catch(function () { BUSY[k] = false; });
  }
  function paintNeeds() {
    var t = $('bdNeeds'); t.textContent = '';
    var typ = typeOf(TYPE);
    if (!typ || typ.status !== 'active') { t.append(el('p', { class: 'bd-hint', text: 'Choose your business type first.' })); paintPhone([]); paintGo(0); return; }
    if (!TIERS[TYPE]) { t.append(el('p', { class: 'bd-hint', text: 'Loading...' })); loadTiers(TYPE); return; }
    var items = list(), usable = items.filter(function (c) { return c.tier !== 'unavailable'; }).map(function (c) { return c.id; });
    if (FEAT.some(function (f) { return usable.indexOf(f) < 0; })) { FEAT = FEAT.filter(function (f) { return usable.indexOf(f) >= 0; }); saveFeat(); }
    var chosen = [];
    items.forEach(function (c) {
      var off = c.tier === 'unavailable', on = !off && FEAT.indexOf(c.id) >= 0; if (on) chosen.push(c);
      t.append(el('button', { type: 'button', class: 'bd-n' + (on ? ' on' : '') + (off ? ' off' : ''), 'aria-pressed': on ? 'true' : 'false', title: off ? (c.reason || '') : c.desc, onclick: function () {
        if (off) return; if (on) FEAT = FEAT.filter(function (k) { return k !== c.id; }); else FEAT.push(c.id); saveFeat(); paintNeeds(); } },
        [el('i', { 'aria-hidden': 'true' }), el('span', {}, [el('b', { text: c.name }), el('small', { text: off ? (c.reason || 'Not available for this business type') : c.line })]), c.tier === 'recommended' ? el('em', { text: 'Recommended' }) : null]));
    });
    $('bdTally').textContent = chosen.length ? chosen.length + ' chosen' : 'none chosen yet';
    paintPhone(chosen); paintGo(chosen.length);
  }
  function opt(label, key, vals) {
    var seg = el('div', { class: 'bd-seg' });
    vals.forEach(function (v) { seg.append(el('button', { type: 'button', class: DESIGN[key] === v[0] ? 'on' : '', text: v[1], onclick: function () { DESIGN[key] = v[0]; saveDesign(); paintDesign(); paintNeeds(); } })); });
    return el('div', { class: 'bd-o' }, [el('span', { text: label }), seg]);
  }
  function paintDesign() {
    var d = $('bdDesign'); d.textContent = '';
    d.append(opt('Menu', 'nav', [['bottom', 'Bottom bar'], ['side', 'Side rail'], ['top', 'Top tabs']]), opt('Cards', 'card', [['soft', 'Soft'], ['line', 'Outlined'], ['solid', 'Solid']]), opt('Look', 'theme', [['dark', 'Dark'], ['light', 'Light']]));
    var sw = el('div', { class: 'bd-sw' });
    ['#800020', '#0f5a56', '#2a3f9a', '#a24a14', '#7a2e5a', '#3a3a3a'].forEach(function (c) { var b = el('button', { type: 'button', 'aria-label': c, class: DESIGN.accent === c ? 'on' : '' }); b.style.background = c; b.onclick = function () { DESIGN.accent = c; saveDesign(); paintDesign(); paintNeeds(); }; sw.append(b); });
    d.append(el('div', { class: 'bd-o' }, [el('span', { text: 'Colour' }), sw]));
  }
  function paintPhone(chosen) {
    var ph = $('bdPhone'); ph.dataset.nav = DESIGN.nav; ph.dataset.card = DESIGN.card; ph.dataset.theme = DESIGN.theme; ph.style.setProperty('--my', DESIGN.accent);
    var nav = $('bdNav'), cards = $('bdCards'); nav.textContent = ''; cards.textContent = '';
    if (!chosen.length) cards.append(el('p', { class: 'bd-empty', text: 'Tick what you need. Your app appears here.' }));
    chosen.forEach(function (c, i) {
      nav.append(el('span', { class: i === 0 ? 'on' : '', text: c.name.split(' ')[0] }));
      var bars = el('div', { class: 'bd-bars' }); [40, 70, 55, 90, 62].forEach(function (h) { var b = el('i'); b.style.height = h + '%'; bars.append(b); });
      cards.append(el('div', { class: 'bd-c' }, [el('b', { text: c.name }), bars]));
    });
    $('bdCount').textContent = chosen.length + (chosen.length === 1 ? ' feature' : ' features');
  }
  function handoff(token, user) { location.href = APP + '#auz_gt=' + b64({ t: token, u: user }); }
  function paintGo(n) {
    var g = $('bdGo'); g.textContent = '';
    if (STATE.staff) { g.append(el('p', { class: 'bd-note', text: 'You are signed in as AUZslab staff. Staff logins cannot start a trial. Use a customer login to try the builder.' })); return; }
    var err = el('div', { class: 'bd-err' });
    function need() { if (!TYPE) { err.textContent = 'Choose your business type first.'; return true; } if (!blocksOf().length) { err.textContent = 'Tick at least one feature.'; return true; } return false; }
    var name = el('input', { placeholder: 'Your name', autocomplete: 'name' }), phone = el('input', { placeholder: 'Mobile / WhatsApp', type: 'tel', inputmode: 'tel', autocomplete: 'tel' }), biz = el('input', { placeholder: 'Business name', autocomplete: 'organization' });
    var payload = function (x) { return Object.assign({ business_name: biz.value, contact_name: name.value, phone: phone.value, business_type: TYPE, blocks: blocksOf(), features: FEAT }, x || {}); };
    function done() { ls('auz_build_type', null); ls('auz_feat_done', JSON.stringify(FEAT)); ls('auz_feat', null); }
    if (STATE.business) {
      g.append(el('p', { class: 'bd-note', text: 'You already have a business with AUZslab.' }), el('a', { class: 'bd-btn', href: '#', text: 'Open my app', onclick: async function (e) { e.preventDefault(); var s = STATE.session; handoff(s.access_token, s.user); } }));
      return;
    }
    if (STATE.session) {
      var b = el('button', { class: 'bd-btn', type: 'button', text: 'Build my app, 3 days free' });
      b.onclick = async function () {
        err.textContent = ''; if (need()) return; b.disabled = true;
        var r = await sb.rpc('start_self_trial', { p: payload() });
        if (r.error) { b.disabled = false; err.textContent = r.error.message; return; }
        done(); handoff(STATE.session.access_token, STATE.session.user);
      };
      g.append(name, phone, biz, b, err, el('p', { class: 'bd-note', text: 'No payment now. Nothing is charged during the trial.' }));
      return;
    }
    var user = el('input', { placeholder: 'Make a username', autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false' }), pass = el('input', { placeholder: 'Make a password (8+ characters)', type: 'password', autocomplete: 'new-password' });
    var go = el('button', { class: 'bd-btn', type: 'button', text: 'Build my app, 3 days free' });
    go.onclick = async function () {
      err.textContent = ''; if (need()) return; go.disabled = true;
      try {
        var res = await fetch(CFG.url + '/auth/trial-account', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload({ username: user.value, password: pass.value })) });
        var j = await res.json().catch(function () { return {}; });
        if (!res.ok || !j.access_token) { err.textContent = j.error || j.message || 'Could not continue.'; go.disabled = false; return; }
        done(); handoff(j.access_token, j.user);
      } catch (e) { err.textContent = 'Could not reach AUZslab. Check your connection.'; go.disabled = false; }
    };
    g.append(name, phone, biz, user, pass, go, err, el('a', { class: 'bd-alt', href: APP, text: 'I already made one: sign in' }), el('p', { class: 'bd-note', text: 'No email, no payment. Keep your username and password safe: they open this app again.' }));
  }
  async function boot() {
    var cl = await sb.rpc('public_module_catalogue'), tl = await sb.rpc('public_business_types');
    if (!(cl && Array.isArray(cl.data) && cl.data.length) || !(tl && Array.isArray(tl.data) && tl.data.length)) {
      $('bdTypes').textContent = ''; $('bdTypes').append(el('p', { class: 'bd-err', text: 'We could not load the builder. Check your connection and reload.' })); return;
    }
    CAT = cl.data; BT = tl.data;
    CAT.forEach(function (m) { (m.screens || []).forEach(function (sc) { FEATS.push({ id: sc.id, name: sc.label, line: m.label, mod: m.key, desc: m.description || '' }); }); });
    var s = (await sb.auth.getSession()).data.session; STATE.session = s;
    if (s) { var hm = await sb.rpc('hub_me'); if (hm && hm.data) { STATE.staff = !!((hm.data.admin || hm.data.team) && !hm.data.business); STATE.business = !!hm.data.business; } else if (hm && hm.error && hm.error.status === 401) { await sb.auth.signOut(); STATE.session = null; } }
    paintTypes(); paintDesign(); paintNeeds();
    if (location.hash === '#build') root.scrollIntoView();
  }
  boot().catch(function () { $('bdTypes').textContent = 'Could not load. Reload the page.'; });
})();
