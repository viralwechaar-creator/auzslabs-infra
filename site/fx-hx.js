/* Homepage motion: page 2 pins and the track slides sideways with the vertical scroll; cards float up/down as they pass;
   page 3 cards drift on their own offsets. Transforms only, one rAF per scroll tick, no sticky stacks, no layout reads in the loop. */
(function () {
  'use strict';
  var doc = document, root = doc.documentElement;
  var hx = doc.querySelector('.hx'); if (!hx) return;
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var stage = hx.querySelector('.hx-stage'), track = hx.querySelector('.hx-track'), bar = hx.querySelector('.hx-bar i');
  var cards = [].slice.call(hx.querySelectorAll('.hx-card')), floats = [].slice.call(doc.querySelectorAll('[data-float]'));
  var vw = 0, sh = 0, dist = 0, top = 0, centers = [], fgeo = [], ticking = false, active = false;

  // text/blocks fade in once when they first appear
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }); }, { threshold: .2 });
    [].forEach.call(doc.querySelectorAll('.hx-card,.vw-card,.hx-row'), function (el) { io.observe(el); });
  } else [].forEach.call(doc.querySelectorAll('.hx-card,.vw-card,.hx-row'), function (el) { el.classList.add('in'); });

  function measure() {
    vw = window.innerWidth; sh = stage.offsetHeight;                       // stage height is 100svh: it does not change when the phone toolbar hides
    track.style.transform = 'none';
    dist = Math.max(0, track.scrollWidth - vw);
    hx.style.height = (sh + dist) + 'px';
    top = hx.getBoundingClientRect().top + window.pageYOffset;
    centers = cards.map(function (c) { return c.offsetLeft + c.offsetWidth / 2; });
    fgeo = floats.map(function (f) { f.style.transform = 'none'; var r = f.getBoundingClientRect(); return { mid: r.top + window.pageYOffset + r.height / 2, h: r.height }; });
    tick();
  }
  function frame() {
    ticking = false;
    var y = window.pageYOffset, vh = window.innerHeight;
    if (active) {
      var p = dist ? Math.min(1, Math.max(0, (y - top) / dist)) : 0;
      track.style.transform = 'translate3d(' + (-p * dist).toFixed(1) + 'px,0,0)';
      if (bar) bar.style.setProperty('--p', p.toFixed(4));
      for (var i = 0; i < cards.length; i++) {
        var d = (centers[i] - p * dist - vw / 2) / vw;                      // -1 .. 1 across the screen
        var dir = i % 2 ? -1 : 1;
        cards[i].style.transform = 'translate3d(0,' + (d * 46 * dir).toFixed(1) + 'px,0) rotate(' + (d * 3.2 * dir).toFixed(2) + 'deg)';
      }
    }
    for (var j = 0; j < floats.length; j++) {
      var g = fgeo[j]; if (!g) continue; var cy = g.mid - y - vh / 2; if (cy < -vh || cy > vh) continue;
      var k = parseFloat(floats[j].getAttribute('data-float')) || 0;
      floats[j].style.transform = 'translate3d(0,' + (cy / vh * k * -vh * .5).toFixed(1) + 'px,0)';
    }
  }
  function tick() { if (!ticking) { ticking = true; requestAnimationFrame(frame); } }

  if (!reduce) {
    active = true; root.classList.add('fx-hx');
    measure();
    window.addEventListener('scroll', tick, { passive: true });
    var lastW = window.innerWidth, rt;
    window.addEventListener('resize', function () { if (window.innerWidth === lastW) return; lastW = window.innerWidth; clearTimeout(rt); rt = setTimeout(measure, 150); });
    window.addEventListener('load', function () { setTimeout(measure, 200); });
    if (doc.fonts && doc.fonts.ready) doc.fonts.ready.then(measure);
  } else window.addEventListener('scroll', tick, { passive: true });
})();
