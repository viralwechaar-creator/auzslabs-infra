/* Services page: tap-to-build ring, linked cards, request tray */
(function () {
  function q(s, r) { return (r || document).querySelector(s); }
  function qa(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  var stage = q('#bpStage'); if (!stage) return;
  var nodes = qa('.bp-n', stage), svg = q('.bp-lines', stage), hub = q('.bp-hub', stage), cnt = q('#bpCount');
  var tray = q('#bpTray'), trayN = q('#bpTrayN'), sel = {};
  var wide = window.matchMedia('(min-width:700px)');
  function place() {
    nodes.forEach(function (n, i) {
      var a = -Math.PI / 2 + i * 2 * Math.PI / nodes.length, r = 38;
      n._p = [50 + r * Math.cos(a), 50 + r * Math.sin(a)];
      n.style.setProperty('--x', n._p[0] + '%'); n.style.setProperty('--y', n._p[1] + '%');
    });
    lines();
  }
  function lines() {
    svg.innerHTML = '';
    if (!wide.matches) return;
    nodes.forEach(function (n) {
      if (!sel[n.dataset.k]) return;
      var l = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      l.setAttribute('x1', 50); l.setAttribute('y1', 50); l.setAttribute('x2', n._p[0]); l.setAttribute('y2', n._p[1]);
      svg.appendChild(l);
    });
  }
  function paint() {
    var keys = Object.keys(sel).filter(function (k) { return sel[k]; });
    nodes.forEach(function (n) { n.setAttribute('aria-pressed', sel[n.dataset.k] ? 'true' : 'false'); });
    qa('.bc').forEach(function (c) {
      var on = !!sel[c.dataset.k]; c.classList.toggle('on', on);
      var b = q('.bc-add', c); b.setAttribute('aria-pressed', on ? 'true' : 'false'); q('span', b).textContent = on ? 'Added' : 'Add';
    });
    cnt.textContent = keys.length; hub.classList.add('pop'); setTimeout(function () { hub.classList.remove('pop'); }, 220);
    tray.hidden = !keys.length; trayN.textContent = keys.length + (keys.length === 1 ? ' service' : ' services');
    lines();
  }
  function toggle(k) { sel[k] = !sel[k]; paint(); }
  nodes.forEach(function (n) { n.addEventListener('click', function () { toggle(n.dataset.k); }); });
  qa('.bc-add').forEach(function (b) { b.addEventListener('click', function () { toggle(b.dataset.k); }); });
  q('#bpGo').addEventListener('click', function () {
    var keys = [];
    nodes.forEach(function (n) { if (sel[n.dataset.k] && n.dataset.c && keys.indexOf(n.dataset.c) < 0) keys.push(n.dataset.c); });
    if (!keys.length) { location.href = 'contact.html'; return; }
    try { var cur = JSON.parse(localStorage.getItem('auz_cart') || '[]'); keys.forEach(function (k) { if (cur.indexOf(k) < 0) cur.push(k); }); localStorage.setItem('auz_cart', JSON.stringify(cur)); } catch (e) {}
    location.href = 'cart.html';
  });
  if (/^#slab-\w+$/.test(location.hash)) { var t = q(location.hash); if (t) { var d = q('details', t); if (d) d.open = true; } }
  if (wide.addEventListener) wide.addEventListener('change', lines);
  place(); paint();
})();
