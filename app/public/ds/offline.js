/* Installed (offline Windows) copy of AUZsPOS / AUZsLedger: the licence screen and the first-start "set up your shop" screen.
   AUZsStyle has its own copy of the same two screens inside style/shell.js. On the cloud site this file does nothing: it only runs
   on the computer's own address (127.0.0.1) and only when the local server says it is an installed copy. Plain DOM, textContent only. */
(function () {
  if (!/^(127\.0\.0\.1|localhost)$/.test(location.hostname)) return;
  var box, card;
  function el(tag, props, kids) {
    var n = document.createElement(tag), k;
    for (k in (props || {})) { if (k === 'style') n.style.cssText = props[k]; else if (k === 'text') n.textContent = props[k]; else if (k.slice(0, 2) === 'on') n[k] = props[k]; else n.setAttribute(k, props[k]); }
    (kids || []).forEach(function (c) { if (c) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }
  var INK = 'var(--label,#1a1a1a)', MUTED = 'var(--label2,#666)', ACC = 'var(--accent,#800020)';
  var FIELD = 'width:100%;box-sizing:border-box;padding:12px 14px;border-radius:12px;border:1px solid var(--sep,#d6d3cf);background:var(--card,#fff);color:' + INK + ';font:16px system-ui,sans-serif';
  var BTN = 'width:100%;padding:13px;border:0;border-radius:999px;background:' + ACC + ';color:#fff;font:600 16px system-ui,sans-serif;cursor:pointer';
  function open(name) {
    if (box) box.remove();
    card = el('div', { style: 'width:min(440px,92vw);max-height:92vh;overflow:auto;background:var(--card,#fff);color:' + INK + ';border-radius:24px;padding:28px;box-shadow:0 12px 40px rgba(0,0,0,.18);display:grid;gap:12px;font-family:system-ui,sans-serif' });
    card.appendChild(el('div', { style: 'font:800 20px system-ui,sans-serif', text: name }));
    box = el('div', { id: 'auzOffline', style: 'position:fixed;inset:0;z-index:2147483000;background:var(--bg,#efece8);display:grid;place-items:center' }, [card]);
    document.body.appendChild(box);
    return card;
  }
  function msgNode() { return el('div', { role: 'alert', style: 'color:#b42318;min-height:18px;font-size:13px' }); }
  function post(path, body) {
    return fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, j: j }; }); });
  }

  function licenceScreen(s, optional) {
    var name = s.appName || 'this app';
    var c = open(name);
    var code = el('textarea', { rows: 4, placeholder: 'AUZ-XXXXX-XXXXX-...', 'aria-label': 'Licence code', style: FIELD + ';font-family:monospace;text-transform:uppercase' });
    var m = msgNode(), b = el('button', { type: 'button', style: BTN, text: 'Activate' });
    b.onclick = function () {
      m.textContent = ''; b.disabled = true;
      post('/licence/activate', { code: code.value }).then(function (r) {
        if (!r.ok) { m.textContent = r.j.error || 'Could not activate'; b.disabled = false; return; }
        location.reload();
      }).catch(function () { m.textContent = 'Could not reach the app on this computer.'; b.disabled = false; });
    };
    c.appendChild(el('h1', { style: 'margin:4px 0;font-size:22px', text: s.state === 'expired' ? 'Your plan has ended' : 'Activate ' + name }));
    c.appendChild(el('p', { style: 'margin:0;color:' + MUTED, text: s.state === 'expired' ? 'Your data is safe on this computer. Enter the new code AUZslab sent you to continue.' + (s.shop ? ' (' + s.shop + ', ' + s.end + ')' : '') : 'Type the licence code AUZslab gave you. No internet is needed.' }));
    [code, m, b].forEach(function (n) { c.appendChild(n); });
    c.appendChild(el('p', { style: 'margin:0;font-size:12px;color:' + MUTED, text: 'Need a code? Call or WhatsApp AUZslab: +91 92512 50829' }));
  }

  function setupScreen(s, info) {
    var name = s.appName || 'this app';
    var c = open(name);
    var f = function (ph, type, ac) { return el('input', { type: type || 'text', placeholder: ph, 'aria-label': ph, autocomplete: ac || 'off', style: FIELD }); };
    var shop = f('Shop name'), who = f('Your name', 'text', 'name'), email = f('Email (you will sign in with this)', 'email', 'username'), pw = f('Password (at least 8 characters)', 'password', 'new-password'), pw2 = f('Type the password again', 'password', 'new-password');
    var biz = null;
    if (info.product === 'pos') {
      biz = el('select', { 'aria-label': 'Type of business', style: FIELD }, [el('option', { value: 'restaurant', text: 'Cafe or restaurant (tables, kitchen)' }), el('option', { value: 'retail', text: 'Shop (counter billing)' })]);
    }
    var m = msgNode(), b = el('button', { type: 'submit', style: BTN, text: 'Create my shop' });
    var form = el('form', { style: 'display:grid;gap:10px' }, [shop, who, email, pw, pw2, biz, m, b]);
    form.onsubmit = function (e) {
      e.preventDefault(); m.textContent = '';
      if (pw.value !== pw2.value) { m.textContent = 'The two passwords are different.'; return; }
      b.disabled = true;
      post('/setup/first-run', { shop: shop.value, name: who.value, email: email.value, password: pw.value, biz: biz ? biz.value : '' }).then(function (r) {
        if (!r.ok) { m.textContent = r.j.error || 'Could not set up'; b.disabled = false; return null; }
        return post('/auth/login', { email: email.value.trim().toLowerCase(), password: pw.value });
      }).then(function (r) {
        if (!r) return;
        if (r.ok && r.j.access_token) { try { localStorage.setItem('auz_session', JSON.stringify({ access_token: r.j.access_token, user: r.j.user })); } catch (x) {} }
        location.reload();
      }).catch(function () { m.textContent = 'Could not reach the app on this computer.'; b.disabled = false; });
    };
    c.appendChild(el('h1', { style: 'margin:4px 0;font-size:22px', text: 'Set up your shop' }));
    c.appendChild(el('p', { style: 'margin:0;color:' + MUTED, text: 'This is the first time ' + name + ' is opened on this computer. Your data is kept on this computer.' }));
    c.appendChild(form);
  }

  function start() {
    fetch('/licence/status').then(function (r) { return r.json(); }).then(function (s) {
      if (!s || !s.offline) return;
      window.AUZ_LIC = s;
      if (s.state === 'none' || s.state === 'expired') return licenceScreen(s);
      return fetch('/setup/state').then(function (r) { return r.json(); }).then(function (info) { if (info && info.needed) setupScreen(s, info); });
    }).catch(function () {});
  }
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
})();
