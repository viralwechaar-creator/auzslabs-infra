/* Subpages: Apple-style calm pass. Runs after fx-stack.js. Marks hard-shadow / thick-border cards as soft, removes text outlines,
   and keeps copy minimal (long plain paragraphs are cut to their first sentence; the full text stays in the title attribute). */
(function () {
  'use strict';
  var doc = document;
  var SKIP = '.faq,details,footer,.modal,.demo,.legal,.keep,form,[data-keep],.cred,table';
  function soft() {
    [].forEach.call(doc.querySelectorAll('main *'), function (e) {
      if (e.classList.contains('hig-soft') || e.classList.contains('hig-nostroke')) return;
      var s = getComputedStyle(e), r = e.getBoundingClientRect();
      if (parseFloat(s.webkitTextStrokeWidth) > 0) { e.classList.add('hig-nostroke'); return; }
      if (r.height < 40 || r.width < 90 || e.tagName === 'I' || e.closest('.k')) return;   // illustrations (.k actors) keep their own look
      if (/\d+px \d+px 0px/.test(s.boxShadow) || (parseFloat(s.borderTopWidth) >= 2 && !/^(SECTION|MAIN|TEXTAREA|INPUT|BUTTON|A)$/.test(e.tagName) && !e.matches('.stack-panel,.fx-panel,.fx-stage,.fx-scene'))) { e.classList.add('hig-soft'); if (/rgba\(0, 0, 0, 0\)|transparent/.test(s.backgroundColor)) e.style.background = '#fff'; }
    });
  }
  function trim() {
    [].forEach.call(doc.querySelectorAll('main p'), function (p) {
      if (p.closest(SKIP) || p.children.length || p.dataset.trim) return;
      var t = p.textContent.replace(/\s+/g, ' ').trim();
      if (t.length < 130) return;
      var m = t.match(/^(.{35,}?[.!?])(\s|$)/);
      if (!m || m[1].length > t.length - 12) return;
      p.dataset.trim = '1'; p.title = t; p.textContent = m[1];
    });
  }
  var CARD = '.featsec.orbit .o,.mcols .mr,.stp,.st,.plan,.hs-i,.pcard,.hig-soft';
  function cards() {
    [].forEach.call(doc.querySelectorAll('.fx-panel'), function (panel) {
      var seen = new Map();
      [].forEach.call(panel.querySelectorAll(CARD), function (c) {
        if (c.closest('.k,.demo,.faq,footer,form,table') || c.classList.contains('sw-card')) return;
        var r = c.getBoundingClientRect(); if (r.height < 60 || r.width < 120) return;
        var n = seen.get(c.parentNode) || 0; seen.set(c.parentNode, n + 1);
        c.classList.add('sw-card'); c.style.setProperty('--sw', n % 2 ? -1 : 1);
      });
      // 3+ cards in one container: wrap them in a sideways swipe row (cards stay in order; other children stay where they are)
      seen.forEach(function (n, parent) {
        if (n < 3 || parent.classList.contains('sw-row')) return;
        var cs = [].filter.call(parent.children, function (k) { return k.classList.contains('sw-card'); });
        if (cs.length < 3) return;
        if (cs.length === parent.children.length) { parent.classList.add('sw-row'); return; }
        var row = doc.createElement('div'); row.className = 'sw-row'; parent.insertBefore(row, cs[0]);
        cs.forEach(function (k) { row.appendChild(k); });
      });
    });
  }
  // sticky sheets: each sheet's top is min(pin, viewport - its height), so a tall sheet scrolls until its bottom shows, then pauses
  function pins() {
    [].forEach.call(doc.querySelectorAll('.fx-panel'), function (p) { p.style.removeProperty('--h'); });
    if (window.innerWidth >= 900) return;
    [].forEach.call(doc.querySelectorAll('.fx-panel'), function (p) { p.style.setProperty('--h', p.offsetHeight + 'px'); });
  }
  function run() { try { trim(); soft(); cards(); pins(); } catch (e) {} }
  function boot() { run(); setTimeout(run, 1200); window.addEventListener('load', function () { setTimeout(run, 300); }); var w = window.innerWidth; window.addEventListener('resize', function () { if (window.innerWidth !== w) { w = window.innerWidth; pins(); } }); if (doc.fonts && doc.fonts.ready) doc.fonts.ready.then(pins); }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot); else boot();
})();
