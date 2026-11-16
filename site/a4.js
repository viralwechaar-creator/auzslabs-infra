/* Live demo: editorial cards -- one big featured app (fading line-art image + credentials) and a grid of
   smaller cards below (fading image, category pill, title, one line). Click a small card to feature it.
   "Explore more" reveals the four apps not shown by default. Mirrors the owner's blog-card reference. */
(function () {
  var root = document.getElementById('dm2'); if (!root) return;
  var feat = document.getElementById('dm2Feat'), grid = document.getElementById('dm2Grid'), more = document.getElementById('dm2More');
  var D = JSON.parse(document.getElementById('dm-data').textContent);
  var ORDER = ['salon', 'pay', 'ledger', 'style', 'pos', 'mob', 'scan', 'finance'];
  var expanded = false;

  // single-stroke line icons, 24x24 viewBox, scaled up by the caller -- matches the site's no-emoji icon convention
  var ICONS = {
    calendar: 'M4 5h16a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z M3 10h18 M8 2.5v5 M16 2.5v5 M8.5 14.5l1.8 1.8 3.2-3.6',
    clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z M12 7v5l3.2 2.4',
    book: 'M3 5.2C6 3.7 9 3.7 12 5.2v14.6c-3-1.5-6-1.5-9 0Z M21 5.2c-3-1.5-6-1.5-9 0v14.6c3-1.5 6-1.5 9 0Z',
    shirt: 'M9 3 5 6.2l2.2 3 1.8-.9V21h6V8.3l1.8.9 2.2-3L15 3l-2 2h-2Z',
    receipt: 'M6 2.2h12v19.6l-2-1.1-2 1.1-2-1.1-2 1.1-2-1.1-2 1.1Z M8.5 7.5h7 M8.5 11.5h7 M8.5 15.5h4.5',
    phone: 'M7.2 2.2h9.6a1 1 0 0 1 1 1v17.6a1 1 0 0 1-1 1H7.2a1 1 0 0 1-1-1V3.2a1 1 0 0 1 1-1Z M11 19h2',
    barcode: 'M4 4v16 M7.5 4v16 M9.5 4v16 M13 4v16 M15.5 4v16 M17 4v16 M20 4v16',
    wallet: 'M3.5 7.2a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v1.6H14a3.2 3.2 0 0 0 0 6.4h5.5v1.6a2 2 0 0 1-2 2h-12a2 2 0 0 1-2-2Z M16 12a1 1 0 1 0 0 .01'
  };
  function icon(name, size) {
    var d = ICONS[name] || ICONS.receipt;
    return '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size + '" fill="none" stroke="currentColor" stroke-width="1.15" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + d + '"/></svg>';
  }
  function img(d, size) { return '<div class="dm2-img" style="--ac:' + d.color + '"><div class="dm2-img-fade">' + icon(d.icon, size) + '</div></div>'; }
  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }

  function paintFeat(id) {
    var d = D[id];
    feat.classList.add('sw');
    setTimeout(function () {
      feat.innerHTML = img(d, 116) +
        '<div class="dm2-feat-body"><span class="mk-eye">' + d.tag + '</span><h2>' + d.name + '</h2><p>' + d.text + '</p>' +
        '<div class="dm-cred">' + d.rows.map(function (r) {
          return '<div><span>' + r[0] + '</span><b>' + r[1] + '</b><button type="button" data-copy="' + encodeURIComponent(r[2] || r[1]) + '">Copy</button></div>';
        }).join('') + '</div>' +
        '<div class="mk-row">' + d.links.map(function (l, i) {
          return '<a class="mk-btn' + (i ? '' : ' solid') + '" href="' + l[1] + '" target="_blank" rel="noopener">' + l[0] + '</a>';
        }).join('') + '</div>' +
        (d.note ? '<div class="dm-note">' + d.note + '</div>' : '');
      feat.querySelectorAll('button[data-copy]').forEach(function (c) {
        c.addEventListener('click', function () {
          var v = decodeURIComponent(c.getAttribute('data-copy'));
          (navigator.clipboard ? navigator.clipboard.writeText(v) : Promise.reject()).then(function () {
            c.textContent = 'Copied'; c.classList.add('ok'); setTimeout(function () { c.textContent = 'Copy'; c.classList.remove('ok'); }, 1400);
          }, function () { });
        });
      });
      feat.classList.remove('sw');
    }, 160);
    try { history.replaceState(null, '', '#' + id); } catch (e) { }
  }

  function paintGrid(featId) {
    grid.innerHTML = '';
    var shown = expanded ? ORDER : ORDER.filter(function (id) { return D[id].primary; });
    shown.filter(function (id) { return id !== featId; }).forEach(function (id) {
      var d = D[id];
      var b = el('button', 'dm2-card', img(d, 56) + '<span class="dm2-pill">' + d.tag + '</span><b>' + d.name + '</b><p>' + d.text + '</p>');
      b.type = 'button'; b.setAttribute('data-id', id);
      b.addEventListener('click', function () { select(id); });
      grid.appendChild(b);
    });
    more.hidden = expanded;
  }

  function select(id) { paintFeat(id); paintGrid(id); }

  more.addEventListener('click', function () { expanded = true; paintGrid((location.hash || '#salon').slice(1)); });

  var start = location.hash.slice(1);
  if (!D[start]) start = 'salon';
  if (!D[start].primary) expanded = true;
  select(start);
})();
