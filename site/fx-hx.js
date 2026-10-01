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

  function measure() {
    var vw = window.innerWidth, sh = stage.offsetHeight;                    // stage is 100svh: does not change when the phone toolbar hides
    root.classList.remove('fx-hx'); hx.style.height = '';
    var dist = Math.max(0, track.scrollWidth - vw);
    if (dist < 40) return;
    hx.style.setProperty('--hx-dist', dist + 'px'); hx.style.height = (sh + dist) + 'px';
    cards.forEach(function (c, i) {
      var centre = c.offsetLeft + c.offsetWidth / 2;                        // the card passes the screen centre at this track position
      var p0 = (centre - vw / 2 - vw) / dist, p1 = (centre - vw / 2 + vw) / dist;
      c.style.setProperty('--r0', (p0 * 100).toFixed(2) + '%'); c.style.setProperty('--r1', (p1 * 100).toFixed(2) + '%');
      c.style.setProperty('--dir', i % 2 ? -1 : 1);
    });
    root.classList.add('fx-hx');
  }
  measure();
  var lastW = window.innerWidth, rt;
  window.addEventListener('resize', function () { if (window.innerWidth === lastW) return; lastW = window.innerWidth; clearTimeout(rt); rt = setTimeout(measure, 150); });
  window.addEventListener('load', function () { setTimeout(measure, 200); });
  if (doc.fonts && doc.fonts.ready) doc.fonts.ready.then(measure);
})();
