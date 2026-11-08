/* Command palette (Ctrl/Cmd+K) for apps that have none: lists the app's own menu items and opens them by clicking the real menu button,
   so permissions, plan switches and custom menus are respected exactly as in the sidebar. Adds no actions of its own. */
(function () {
  if (window.auzPalette) return;
  var ov = null, items = [], idx = 0;
  function labelOf(e) {
    var l = e.querySelector('.lbl-t'); var t = (l && l.textContent) || e.getAttribute('title') || e.getAttribute('aria-label') || e.textContent || '';
    return t.replace(/\s+/g, ' ').trim();
  }
  function collect() {
    var seen = {}, out = [];
    var els = document.querySelectorAll('.side nav button, .side nav a, .side a.nav-i, .side button.nav-i, .side [data-nav], .tabbar button, .tabbar a');
    for (var i = 0; i < els.length; i++) {
      var e = els[i]; if (e.closest('.brand,.foot') || e.classList.contains('side-tg')) continue;
      var l = labelOf(e); if (!l || l.length > 40 || seen[l.toLowerCase()]) continue; seen[l.toLowerCase()] = 1;
      out.push({ label: l, el: e });
    }
    return out;
  }
  function close() { if (ov) { ov.remove(); ov = null; document.documentElement.classList.remove('ux-pal-open'); } }
  function render(list) {
    var ul = ov.querySelector('ul'); ul.textContent = '';
    if (!list.length) { var n = document.createElement('li'); n.className = 'none'; n.textContent = 'Nothing matches.'; ul.appendChild(n); return; }
    list.forEach(function (it, i) {
      var li = document.createElement('li'); li.textContent = it.label; if (i === idx) li.className = 'on';
      li.addEventListener('click', function () { run(it); }); li.addEventListener('mousemove', function () { idx = i; mark(); });
      ul.appendChild(li);
    });
  }
  function mark() { var lis = ov.querySelectorAll('li'); for (var i = 0; i < lis.length; i++) lis[i].className = i === idx ? 'on' : ''; var cur = lis[idx]; if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: 'nearest' }); }
  function run(it) { close(); setTimeout(function () { it.el.click(); }, 0); }
  function filter(q) { q = q.trim().toLowerCase(); return items.filter(function (it) { return !q || it.label.toLowerCase().indexOf(q) >= 0; }); }
  function open() {
    if (ov) return; items = collect(); idx = 0;
    ov = document.createElement('div'); ov.className = 'ux-pal'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-label', 'Go to');
    ov.innerHTML = '<div class="ux-pal-box"><input type="search" placeholder="Go to..." aria-label="Go to" autocomplete="off"><ul></ul><div class="ux-pal-h">Up and down to choose, Enter to open, Esc to close</div></div>';
    document.body.appendChild(ov); document.documentElement.classList.add('ux-pal-open');
    var inp = ov.querySelector('input'), cur = items; render(cur); inp.focus();
    ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
    inp.addEventListener('input', function () { idx = 0; cur = filter(inp.value); render(cur); });
    inp.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); if (cur.length) idx = (idx + 1) % cur.length; mark(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); if (cur.length) idx = (idx - 1 + cur.length) % cur.length; mark(); }
      else if (e.key === 'Enter') { e.preventDefault(); if (cur[idx]) run(cur[idx]); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    });
  }
  document.addEventListener('keydown', function (e) {
    if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && (e.key || '').toLowerCase() === 'k') { if (!document.querySelector('.side,.tabbar')) return; e.preventDefault(); ov ? close() : open(); }
  }, true);
  window.auzPalette = { open: open, close: close };
})();
