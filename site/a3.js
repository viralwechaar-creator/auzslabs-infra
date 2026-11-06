/* Services page: pick cards, request tray */
(function () {
  function q(s, r) { return (r || document).querySelector(s); }
  function qa(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  var tray = q('#bpTray'); if (!tray) return;
  var trayN = q('#bpTrayN'), sel = {};
  function paint() {
    var n = 0;
    qa('.bc').forEach(function (c) {
      var on = !!sel[c.dataset.k]; if (on) n++; c.classList.toggle('on', on);
      var b = q('.bc-add', c); b.setAttribute('aria-pressed', on ? 'true' : 'false'); q('span', b).textContent = on ? 'Added' : 'Add';
    });
    tray.hidden = !n; trayN.textContent = n + (n === 1 ? ' service' : ' services');
  }
  qa('.bc-add').forEach(function (b) { b.addEventListener('click', function (e) { e.stopPropagation(); sel[b.dataset.k] = !sel[b.dataset.k]; paint(); }); });
  qa('.bc').forEach(function (c) { c.addEventListener('click', function (e) { if (e.target.closest('a,button,summary,details')) return; var o = c.classList.contains('open'); qa('.bc').forEach(function (x) { x.classList.remove('open'); }); if (!o) c.classList.add('open'); }); });
  q('#bpGo').addEventListener('click', function () {
    var keys = [];
    qa('.bc').forEach(function (c) { var k = c.dataset.c; if (sel[c.dataset.k] && k && keys.indexOf(k) < 0) keys.push(k); });
    if (!keys.length) { location.href = 'contact.html'; return; }
    try { var cur = JSON.parse(localStorage.getItem('auz_cart') || '[]'); keys.forEach(function (k) { if (cur.indexOf(k) < 0) cur.push(k); }); localStorage.setItem('auz_cart', JSON.stringify(cur)); } catch (e) {}
    location.href = 'cart.html';
  });
  if (/^#slab-\w+$/.test(location.hash)) { var t = q(location.hash); if (t) { t.classList.add('open'); var d = q('details', t); if (d) d.open = true; } }
  paint();
})();
