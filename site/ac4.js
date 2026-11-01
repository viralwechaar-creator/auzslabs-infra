/* Welcome screen for the account dashboard: shown once per browser session, nothing else changes. */
(function () {
  try { if (sessionStorage.getItem('ac4.w') || /#(privacy|cart|notifications)/.test(location.hash)) return; } catch (e) {}
  var w = document.createElement('div'); w.id = 'a4w'; 
  w.innerHTML = '<img src="/logo.png" alt="AUZslab"><div class="a4c"><p>Continue your journey and check your account.</p><div class="a4b"><button type="button" id="a4back">Back</button><button type="button" class="k" id="a4go">Explore your account</button></div></div>';
  document.body.appendChild(w);
  function close() { try { sessionStorage.setItem('ac4.w', '1'); } catch (e) {} w.classList.add('out'); setTimeout(function () { w.remove(); }, 450); }
  document.getElementById('a4go').onclick = close;
  document.getElementById('a4back').onclick = function () { if (history.length > 1) history.back(); else location.href = 'index.html'; };
})();

/* Creative tab widgets (read-only, built from data the page already loaded; the forms below them are untouched). */
(function () {
  'use strict';
  var g = function (n) { try { return (0, eval)(n); } catch (e) { return undefined; } };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var ring = function (pct, label) {
    return '<div class="a4r"><svg viewBox="0 0 36 36"><circle cx="18" cy="18" r="15.5" class="t"/><circle cx="18" cy="18" r="15.5" class="v" stroke-dasharray="' + Math.round(pct * .974) + ' 100" pathLength="100"/></svg><b>' + pct + '%</b><span>' + label + '</span></div>';
  };
  function widget(id) {
    var D = g('DASH'), P = g('PROFILE') || {}, S = g('STAFF') || [], N = g('NOTIFS') || [], SS = g('SESSIONS') || [], h = '';
    if (id === 'profile') {
      var keys = ['name', 'phone', 'contact_email', 'business_name', 'business_type', 'city', 'address'], done = keys.filter(function (k) { return P[k]; }).length, pct = Math.round(done / keys.length * 100);
      h = ring(pct, pct === 100 ? 'Profile complete' : (keys.length - done) + ' to fill in');
    } else if (id === 'account') {
      var cur = SS.filter(function (s) { return s.current; })[0], rest = SS.length;
      h = '<div class="a4s"><div class="a4h">Where you are signed in</div><div class="a4d">' + (SS.length ? SS.slice(0, 6).map(function (s) { return '<div class="a4dc' + (s.current ? ' cur' : '') + '"><b>' + esc(s.device_label || 'Unknown device') + '</b><span>' + (s.current ? 'This device' : esc(s.last_seen_at ? new Date(s.last_seen_at).toLocaleDateString() : '')) + '</span></div>'; }).join('') : '<div class="a4dc"><b>This device</b><span>Now</span></div>') + '</div></div>';
    } else if (id === 'services' && D) {
      var f = D.features || {}, en = D.enabled_features || {}, ch = g('PRODUCT_CHOICES') || [];
      h = '<div class="a4s"><div class="a4h">Your services</div><div class="a4g">' + ch.filter(function (p) { return f[p[0]] === true; }).map(function (p) { var on = en[p[0]] !== false; return '<div class="a4sv' + (on ? ' on' : '') + '"><b>' + esc(p[1].replace(/\s*\(.*$/, '')) + '</b><span>' + (on ? 'On' : 'Off') + '</span></div>'; }).join('') + '</div></div>';
    } else if (id === 'staff' && D) {
      h = '<div class="a4s"><div class="a4h">Your people</div><div class="a4av">' + S.slice(0, 12).map(function (p) { var n = p.name || p.email || '?'; return '<div class="a4p"><i>' + esc((n.match(/\b\w/g) || ['?']).slice(0, 2).join('').toUpperCase()) + '</i><b>' + esc(String(n).split(' ')[0].slice(0, 14)) + '</b><span>' + esc(p.role || '') + '</span></div>'; }).join('') + '</div></div>';
    } else if (id === 'notifications') {
      var un = N.filter(function (n) { return !n.read; }).length;
      h = ring(N.length ? Math.round((N.length - un) / N.length * 100) : 100, un ? un + ' unread' : 'All caught up');
    } else if (id === 'privacy') {
      h = '<div class="a4s"><div class="a4h">Your rights</div><div class="a4g"><div class="a4sv"><b>Download</b><span>Get a file of your data</span></div><div class="a4sv"><b>Correct</b><span>Ask us to fix a detail</span></div><div class="a4sv"><b>Delete</b><span>Ask us to remove it</span></div><div class="a4sv"><b>Complain</b><span>Tell us what went wrong</span></div></div></div>';
    } else if (id === 'cart') {
      var items = (window.AUZcart && AUZcart.get()) || [];
      h = '<div class="a4s"><div class="a4trk"><i class="on">Choose</i><i' + (items.length ? ' class="on"' : '') + '>Send request</i><i>We quote</i><i>Pay</i><i>Go live</i></div></div>';
    } else if (id === 'help') {
      h = '<div class="a4s"><div class="a4g"><div class="a4sv on"><b>+91 92512 50829</b><span>Call us</span></div><div class="a4sv"><b>helloauzslab@gmail.com</b><span>Email us</span></div><div class="a4sv"><b>We reply within 24h</b><span>Usually much faster</span></div></div></div>';
    }
    return h;
  }
  function paint() {
    ['profile', 'account', 'services', 'staff', 'notifications', 'privacy'].forEach(function (id) {
      var pane = document.getElementById('pane-' + id); if (!pane) return;
      var html = widget(id), w = pane.querySelector(':scope>.a4x');
      if (!html) { if (w) w.remove(); return; }
      if (!w) { w = document.createElement('div'); w.className = 'a4x'; pane.insertBefore(w, pane.firstChild); }
      if (w.dataset.h !== html) { w.dataset.h = html; w.innerHTML = html; }
    });
  }
  setInterval(paint, 1500); setTimeout(paint, 600);
})();
