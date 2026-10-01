/* Homepage motion. The sideways slide, the floating cards and the progress line are CSS scroll-linked animations (animation-timeline), which the browser
   runs on its compositor: no scroll listener, no per-frame JavaScript, so nothing can lag behind the scroll and shake (the old JS version did on iPhones).
   This file only measures once (track length, each card's window) and hands the numbers to CSS as variables. Browsers without animation-timeline
   (or reduced motion) get a plain swipeable row instead. */
(function () {
  'use strict';
  var doc = document, root = doc.documentElement;
  var hx = doc.querySelector('.hx'); if (!hx) return;
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var ok = window.CSS && CSS.supports && CSS.supports('animation-timeline: view()');
  var stage = hx.querySelector('.hx-stage'), track = hx.querySelector('.hx-track');
  var cards = [].slice.call(hx.querySelectorAll('.hx-card'));

  if ('IntersectionObserver' in window) {   // blocks fade in once when they first appear
    var io = new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }); }, { threshold: .2 });
    [].forEach.call(doc.querySelectorAll('.hx-card,.vw-card,.hx-row'), function (el) { io.observe(el); });
  } else [].forEach.call(doc.querySelectorAll('.hx-card,.vw-card,.hx-row'), function (el) { el.classList.add('in'); });
  if (reduce || !ok) return;

  var items = [].slice.call(track.children), N = items.length, kf = doc.createElement('style');
  doc.head.appendChild(kf);
  function T(d) { return 'translate3d(' + (d * 34 - 44).toFixed(1) + 'px,' + (d * -22 + 26).toFixed(1) + 'px,0) scale(' + (1 - d * .055).toFixed(3) + ')'; }
  var sheets = [].slice.call(doc.querySelectorAll('.hw,.vw'));
  function pins() { sheets.forEach(function (el) { el.style.setProperty('--pin', Math.min(0, window.innerHeight - el.offsetHeight) + 'px'); }); }
  function measure() {
    var vw = window.innerWidth, sh = stage.offsetHeight;                    // stage is 100svh: does not change when the phone toolbar hides
    root.classList.remove('fx-hx'); hx.style.height = '';
    var step = Math.round(sh * .5), dist = (N - 1) * step + Math.round(sh * .35);   // scroll length of the pinned part
    hx.style.height = (sh + dist) + 'px';
    var H0 = .05, w = (1 - H0 - .06) / (N - 1), css = '';                   // share of the timeline each card takes to leave
    items.forEach(function (el, i) {
      var P = function (x) { return (Math.max(0, Math.min(1, x)) * 100).toFixed(3) + '%'; }, a = H0 + i * w, b = a + w, k = '';
      el.style.zIndex = N - i;
      if (i > 0) {
        k += '0%{transform:' + T(Math.min(i, 4)) + ';opacity:' + (i > 3 ? 0 : 1) + '}';
        if (i > 4) k += P(a - 4 * w) + '{transform:' + T(4) + ';opacity:0}';
        if (i > 3) k += P(a - 3 * w) + '{transform:' + T(3) + ';opacity:1}';
        k += P(a) + '{transform:' + T(0) + ';opacity:1}';
      } else k += '0%{transform:' + T(0) + ';opacity:1}' + P(a) + '{transform:' + T(0) + ';opacity:1}';
      if (i < N - 1) k += P(b) + '{transform:translate3d(-125vw,0,0) rotate(-9deg);opacity:1}100%{transform:translate3d(-125vw,0,0) rotate(-9deg);opacity:1}';
      else k += '100%{transform:' + T(0) + ';opacity:1}';
      css += '@keyframes hxd' + i + '{' + k + '}.hx-track>:nth-child(' + (i + 1) + '){animation-name:hxd' + i + '}';
    });
    kf.textContent = css;
    pins(); root.classList.add('fx-hx');
  }
  measure();
  var lastW = window.innerWidth, rt;
  window.addEventListener('resize', function () { if (window.innerWidth === lastW) return; lastW = window.innerWidth; clearTimeout(rt); rt = setTimeout(measure, 150); });
  window.addEventListener('load', function () { setTimeout(measure, 200); });
  if (doc.fonts && doc.fonts.ready) doc.fonts.ready.then(measure);
})();
