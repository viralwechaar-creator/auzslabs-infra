/* AUZslab FX stack: arranges a page's blocks into the site's original stacked-panel scroll (each panel slides up over the previous
   one, leaving its big tab word peeking at the top). Runs after fx.js. Plain DOM, no dependencies.
   - every direct child of <main class="content"> becomes (part of) a .stack-panel; short blocks are merged until a panel is about a
     screen tall; marquee bands ride along with the panel before them; closing CTAs get the dark panel.
   - a panel taller than the screen can't simply stick at top:0 (its bottom would be unreachable), so each panel's sticky `top` is
     min(normal offset, viewport height - panel height); it scrolls through its own content, then the next panel covers it. */
(function () {
  'use strict';
  var doc = document;
  function boot() {
    var main = doc.querySelector('body.fx main.content'); if (!main || main.querySelector('.fx-stack')) return;
    var kids = [].filter.call(main.children, function (c) { return c.nodeType === 1 && !c.classList.contains('stack') && !/^(SCRIPT|STYLE)$/.test(c.tagName); });
    if (!kids.length) return;
    var vh = window.innerHeight, groups = [], cur = null, acc = 0;
    function open(dark) { cur = { items: [], dark: !!dark }; groups.push(cur); acc = 0; }
    kids.forEach(function (k, i) {
      var h = k.offsetHeight || 0;
      if (k.classList.contains('band') || k.classList.contains('mega-logo')) { if (!cur) open(); cur.items.push(k); return; }
      var dark = k.classList.contains('closer');
      if (i === 0) { open(); cur.items.push(k); cur = null; return; }   // the hero is a panel of its own
      if (dark) { if (cur && !cur.dark) cur = null; if (!cur) open(true); cur.items.push(k); return; }
      if (cur && cur.dark) cur = null;
      if (!cur) open();
      cur.items.push(k); acc += h;
      if (acc >= vh * .45) cur = null;
    });
    var TAB = [[/included|inside|what we build|everything a|what a /i, 'INSIDE'], [/pairs/i, 'PAIRS'], [/ready|get started|next|your cart/i, 'START'], [/try|hands-on|demo|live client/i, 'TRY'],
      [/before you write|answered|faq/i, 'ASK'], [/how it works|step|how we work/i, 'STEPS'], [/why|struggle|gap|paper|counting|wrong|pain/i, 'WHY'], [/get found|marketing|creator/i, 'REACH'], [/independent|infrastructure/i, 'OWN']];
    var spare = ['MORE', 'NEXT', 'THEN', 'ALSO'], sp = 0;
    var stack = doc.createElement('div'); stack.className = 'stack fx-stack';
    var panels = groups.map(function (g, idx) {
      var p = doc.createElement('section'); p.className = 'stack-panel fx-panel' + (g.dark ? ' stack-panel-dark' : '') + (idx % 2 ? ' alt' : '');
      var first = g.items.filter(function (e) { return !e.classList.contains('band'); })[0] || g.items[0];
      var eye = (first.querySelector && first.querySelector('.eye, .label')); var txt = (eye ? eye.textContent : '') + ' ' + (first.querySelector && first.querySelector('h2,h3') ? first.querySelector('h2,h3').textContent : '');
      var tab = '';
      for (var t = 0; t < TAB.length; t++) if (TAB[t][0].test(txt)) { tab = TAB[t][1]; break; }
      if (!tab) tab = g.dark ? 'TALK' : spare[sp++ % spare.length];
      if (first.dataset && first.dataset.tab) tab = first.dataset.tab;
      if (idx > 0) p.setAttribute('data-tab', tab);
      g.items.forEach(function (e) { p.appendChild(e); }); stack.appendChild(p); return p;
    });
    main.insertBefore(stack, main.firstChild);
    var vw0 = 0;
    function layout() {
      var vw = window.innerWidth; if (vw === vw0) return; vw0 = vw;   // width only: the phone toolbar growing/shrinking must never move a sticky panel
      var base = vw >= 861 ? 150 : 112, step = Math.min(55, Math.max(24, vw * .068));
      panels.forEach(function (p, i) {
        var top = (i === 0 ? 0 : base + Math.min(i - 1, 2) * step); p.style.top = top + 'px'; p.style.zIndex = i + 1;
        var mh = p.style.minHeight; p.style.minHeight = '0'; var nat = p.offsetHeight; p.style.minHeight = mh;
        p.style.position = nat > window.innerHeight - top + 170 ? 'relative' : '';   // too tall to pin: let it scroll through, the next panel still covers it
      });
    }
    /* a panel taller than a screen would never "pause": split it into several panels, each about a screen, so every one stops and gets covered */
    function split(p) {
      var vhh = window.innerHeight, out = [p]; if (p.offsetHeight <= vhh * 1.04 || p.classList.contains('stack-panel-dark')) return out;
      var path = [p], container = p, kids;
      function vis(node) { return [].filter.call(node.children, function (c) { var cs = getComputedStyle(c); return cs.position !== 'absolute' && cs.display !== 'none' && c.offsetHeight > 0 && !/^(SCRIPT|STYLE)$/.test(c.tagName); }); }
      for (;;) { kids = vis(container); if (kids.length !== 1) break; container = kids[0]; path.push(container); }
      if (kids.length < 2) return out;
      var vwn = window.innerWidth, budget = Math.max(260, vhh - (vwn >= 861 ? 150 + 2 * Math.min(55, vwn * .068) : 112 + 2 * Math.min(55, vwn * .068)) - (vwn >= 861 ? 92 : 76) - 36);
      for (var pass = 0; pass < 3; pass++) {   // a child that alone is taller than a screen is replaced by its own children
        var next = [], grew = false;
        kids.forEach(function (k) { var ch = k.offsetHeight > budget ? vis(k) : []; if (ch.length > 1) { next = next.concat(ch); grew = true; } else next.push(k); });
        kids = next; if (!grew) break;
      }
      var chunks = [[]], startTop = null, prevBottom = null;
      kids.forEach(function (k) {
        var r = k.getBoundingClientRect(), top = r.top + window.scrollY, bottom = r.bottom + window.scrollY;
        if (startTop === null) startTop = top;
        if (bottom - startTop > budget && chunks[chunks.length - 1].length && top >= prevBottom - 8) { chunks.push([]); startTop = top; }
        chunks[chunks.length - 1].push(k); prevBottom = Math.max(prevBottom === null ? 0 : prevBottom, bottom);
      });
      if (chunks.length < 2) return out;
      var c0 = chunks[0], c0h = c0.length ? (c0[c0.length - 1].getBoundingClientRect().bottom - c0[0].getBoundingClientRect().top) : 0;
      if (c0h < budget * .45) p.classList.add('fx-compact');
      var parent = p.parentNode, ref = p.nextSibling;
      chunks.slice(1).forEach(function (chunk) {
        var clone = null, cur = null, cache = new Map();
        path.forEach(function (n, i) { var c = n.cloneNode(false); c.removeAttribute('id'); if (i === 0) clone = c; else cur.appendChild(c); cur = c; });
        function target(par) { if (par === container) return cur; var c = cache.get(par); if (!c) { c = par.cloneNode(false); c.removeAttribute('id'); target(par.parentNode).appendChild(c); cache.set(par, c); } return c; }
        clone.classList.add('fx-cont'); chunk.forEach(function (k) { target(k.parentNode).appendChild(k); });
        parent.insertBefore(clone, ref); out.push(clone);
      });
      return out;
    }
    function resplit() {
      for (var it = 0; it < 4; it++) {
        var all = []; panels.forEach(function (p, i) { all = all.concat(i === 0 ? [p] : split(p)); });
        var grew = all.length !== panels.length; panels = all; if (!grew) break;
      }
      panels.forEach(function (p, i) { p.classList.toggle('alt', i % 2 === 1 && !p.classList.contains('stack-panel-dark')); });
      vw0 = 0; layout();
    }
    layout();
    var did = false; function once() { if (did) return; did = true; setTimeout(resplit, 120); }
    if (doc.readyState === 'complete') once(); else window.addEventListener('load', once);
    window.addEventListener('load', function () { setTimeout(function () { vw0 = 0; layout(); }, 900); });
    if (doc.fonts && doc.fonts.ready) doc.fonts.ready.then(function () { if (did) return; });
    var rt; window.addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(layout, 150); });
    doc.documentElement.classList.add('fx-stacked');
  }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot); else boot();
})();
