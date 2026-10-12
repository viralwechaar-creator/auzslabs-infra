/* Shared KPI components: auzKpi.hero / auzKpi.tile / auzKpi.grid build the markup; the enhancer below also lays out every
   existing .kpis group in every app the same way (first KPI = hero when there are 3 or more, the rest = compact tiles,
   2 columns when a value is long and 3 when all are short, 7+ KPIs fold the extras into "More metrics"). Layout only. */
(function () {
  var MAX_TILES = 5;
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function card(o, hero) {
    var b = el(o.onclick ? 'button' : 'div', 'kpi' + (hero ? ' k-hero' : '')); if (o.onclick) { b.type = 'button'; b.onclick = o.onclick; }
    b.append(el('div', 'k-l', o.label), el('div', 'k-v' + (o.tone ? ' ' + o.tone : ''), o.value == null || o.value === '' ? '—' : o.value));
    if (o.sub) b.append(el('div', 'k-s', o.sub));
    return b;
  }
  var K = { hero: function (o) { return card(o, true); }, tile: function (o) { return card(o, false); } };
  K.grid = function (hero, tiles) { var g = el('div', 'kpis'); if (hero) g.append(K.hero(hero)); (tiles || []).forEach(function (t) { g.append(K.tile(t)); }); K.enhance(g); return g; };
  function valueText(k) { var v = k.querySelector(':scope > .v, :scope > .n, :scope > .k-v, :scope > b'); return v ? (v.textContent || '').trim() : ''; }
  // 6-column grid: every row is filled edge to edge (3 or 2 per row; a short last row stretches), so there are no empty cells
  function spans(list, long) {
    var n = list.length, per = long || n === 4 ? 2 : 3, i = 0;
    while (i < n) { var left = n - i, row = Math.min(per, left); for (var k = 0; k < row; k++) list[i + k].style.setProperty('--sp', String(6 / row)); i += row; }
  }
  K.enhance = function (g) {
    if (!g || g.dataset.kg) return;
    var items = Array.prototype.filter.call(g.children, function (c) { return c.classList && c.classList.contains('kpi'); });
    if (items.length < 2) return;
    g.dataset.kg = '1'; g.classList.add('kg'); g.classList.remove('strip');
    var root = g.closest('main,.content,#app') || document.body;
    var taken = !!root.querySelector('.kpi.k-hero');
    var hero = items.length >= 3 && !taken ? items[0] : null; if (hero) hero.classList.add('k-hero');
    var tiles = items.filter(function (k) { return k !== hero; });
    var long = tiles.some(function (k) { return valueText(k).length > 9; });
    spans(tiles.slice(0, MAX_TILES), long);
    items.forEach(function (k) { if (!valueText(k) && k.querySelector(':scope > .v, :scope > .n, :scope > .k-v, :scope > b')) k.querySelector(':scope > .v, :scope > .n, :scope > .k-v, :scope > b').textContent = '—'; });
    if (tiles.length > MAX_TILES) {
      var d = el('details', 'kmore'), s = el('summary', '', 'More metrics'), t = el('div', 'kt');
      var rest = tiles.slice(MAX_TILES); rest.forEach(function (k) { t.append(k); }); spans(rest, long); d.append(s, t); g.append(d);
    }
  };
  K.scan = function (root) { (root.matches && root.matches('.kpis') ? [root] : []).concat(Array.prototype.slice.call(root.querySelectorAll ? root.querySelectorAll('.kpis:not([data-kg])') : [])).forEach(K.enhance); };
  window.auzKpi = K;
  var queued = false, pending = [];
  function flush() { queued = false; var n = pending; pending = []; n.forEach(function (x) { if (x.isConnected !== false) K.scan(x); }); }
  function start() {
    K.scan(document.body);
    new MutationObserver(function (ms) { ms.forEach(function (m) { m.addedNodes.forEach(function (n) { if (n.nodeType === 1) pending.push(n); }); }); if (!queued && pending.length) { queued = true; requestAnimationFrame(flush); } }).observe(document.body, { childList: true, subtree: true });
  }
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
})();
