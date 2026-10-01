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
  function run() { try { trim(); soft(); } catch (e) {} }
  function boot() { run(); setTimeout(run, 1200); window.addEventListener('load', function () { setTimeout(run, 300); }); }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot); else boot();
})();
