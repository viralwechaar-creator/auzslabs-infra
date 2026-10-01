/* AUZslab FX stack: arranges a page's blocks into the site's original stacked-panel scroll (each panel slides up over the previous
   one, leaving its big tab word peeking at the top). Runs after fx.js. Plain DOM, no dependencies.
   - every direct child of <main class="content"> becomes (part of) a .stack-panel; short blocks are merged until a panel is about a
     screen tall; marquee bands ride along with the panel before them; closing CTAs get the dark panel.
   - panels are layered (each slides up over the previous one's rounded edge) but NOT sticky: pinned stacks shook on phones. */
(function () {
  'use strict';
  var doc = document;
  function boot() {
    var main = doc.querySelector('body.fx:not([data-no-stack]) main.content'); if (!main || main.querySelector('.fx-stack')) return;
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
    panels.forEach(function (p, i) { p.style.zIndex = i + 1; });   // layered, not pinned: nothing sticky, so nothing can shake while scrolling
    doc.documentElement.classList.add('fx-stacked');
  }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot); else boot();
})();
