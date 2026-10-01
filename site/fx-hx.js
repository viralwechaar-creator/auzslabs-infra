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
  // Phones and tablets: pinned folder-cut sheets (CSS sticky) with plain swipe rows. NO scroll-linked card animation here: moving cards over pinned
  // sheets made iPhone scrolling shake. Each sheet's top is min(pin, viewport - sheet height); only sizes are measured, on load / fonts / width change.
  function stkMeasure() {
    var sheets = [].slice.call(doc.querySelectorAll('.hw,.hx,.vw,.tk'));
    if (window.innerWidth >= 900) { root.classList.remove('fx-stk'); sheets.forEach(function (e) { e.style.removeProperty('--h'); }); return; }
    root.classList.add('fx-stk');
    root.style.setProperty('--pin', Math.round(Math.max(112, Math.min(190, window.innerHeight * .2))) + 'px');
    sheets.forEach(function (e) { e.style.removeProperty('--h'); });
    sheets.forEach(function (e) { e.style.setProperty('--h', e.offsetHeight + 'px'); });
  }
  if (window.innerWidth < 900) {
    stkMeasure();
    var sw = window.innerWidth;
    window.addEventListener('resize', function () { if (window.innerWidth === sw) return; sw = window.innerWidth; stkMeasure(); });
    window.addEventListener('load', function () { setTimeout(stkMeasure, 200); });
    if (doc.fonts && doc.fonts.ready) doc.fonts.ready.then(stkMeasure);
    return;
  }
  if (reduce || !ok) return;   // wide screens (>= 900px) skip the pinned deck: they get the plain stacked layout (see fx-hx.css)

  var items = [].slice.call(track.children), vwEl = doc.querySelector('.vw'), vwItems = vwEl ? [].slice.call(vwEl.querySelectorAll('.vw-card')) : [];
  var sheets = [].slice.call(doc.querySelectorAll('.hw,.vw,.tk'));
  var kf = doc.createElement('style'); doc.head.appendChild(kf);
  var spacer = doc.createElement('div'); spacer.className = 'vw-pin'; spacer.setAttribute('aria-hidden', 'true');
  if (vwEl) vwEl.parentNode.insertBefore(spacer, vwEl.nextSibling);

  // One card at a time travels across the screen: it enters from one side, crosses the centre, leaves on the other side; the last one stays centred.
  // dir = +1: enters from the right (page 2), -1: from the left (four doors). Keyframes are written once; the scroll position drives them (compositor).
  function deckCss(sel, name, n, dir, A, B, exitAll, centreFirst) {
    var D = 2.2, w = .94 / (n - 1 + (exitAll ? 2 * D : D)), css = '';
    function X(x, r) { return 'translate3d(' + (x * dir).toFixed(2) + 'vw,0,0) rotate(' + (r * dir).toFixed(2) + 'deg)'; }
    for (var i = 0; i < n; i++) {
      var s = i * w, c = s + D * w, e = s + 2 * D * w, k;
      if (centreFirst && i === 0) k = '0%{transform:' + X(0, 0) + '}';   // the first door is already on screen when the sheet pins: no blank page
      else { k = '0%{transform:' + X(125, 7) + '}'; k += (s * 100).toFixed(3) + '%{transform:' + X(125, 7) + '}' + (c * 100).toFixed(3) + '%{transform:' + X(0, 0) + '}'; }
      if (i < n - 1 || exitAll) {
        if (e <= 1) k += (e * 100).toFixed(3) + '%{transform:' + X(-125, -7) + '}100%{transform:' + X(-125, -7) + '}';
        else { var f = (1 - c) / (e - c); k += '100%{transform:' + X(-125 * f, -7 * f) + '}'; }
      } else k += '100%{transform:' + X(0, 0) + '}';
      css += '@keyframes ' + name + i + '{' + k + '}html.fx-hx ' + sel + ':nth-child(' + (i + 1) + '){z-index:' + (i + 1) + ';animation:' + name + i + ' linear both;animation-timeline:scroll(root block);animation-range:' + Math.round(A) + 'px ' + Math.round(B) + 'px}';
    }
    return css;
  }
  function perCard(sh, n) { return Math.round(sh * .5 * (n - 1 + 2.2) / .94); }   // total scroll length: about half a screen per card

  function measure() {
    if (window.innerWidth >= 900) { root.classList.remove('fx-hx'); hx.style.height = ''; spacer.style.height = '0px'; kf.textContent = ''; return; }
    var sh = stage.offsetHeight, pin = Math.round(Math.max(120, Math.min(200, window.innerHeight * .2)));   // stage is 100svh: stable when the phone toolbar hides
    root.classList.remove('fx-hx'); hx.style.height = ''; spacer.style.height = '0px'; root.style.setProperty('--pin', pin + 'px');
    var dist = perCard(sh, items.length), css = '';
    hx.style.height = (sh + dist) + 'px';
    root.classList.add('fx-hx');                                            // layout (margins, sticky) now final
    var A = hx.getBoundingClientRect().top + window.pageYOffset;
    css += deckCss('.hx-track>*', 'hxd', items.length, 1, A, A + dist, true);   // every card leaves: nothing is left on the stage when it unpins
    if (vwEl && vwItems.length) {
      var dv = perCard(sh, vwItems.length); spacer.style.height = dv + 'px';
      var flowTop = spacer.getBoundingClientRect().top + window.pageYOffset - vwEl.offsetHeight, Av = flowTop - pin;
      css += deckCss('.vw-grid>*', 'vwd', vwItems.length, -1, Av, Av + dv, false, true);
    }
    kf.textContent = css;
  }
  measure();
  var lastW = window.innerWidth, rt;
  window.addEventListener('resize', function () { if (window.innerWidth === lastW) return; lastW = window.innerWidth; clearTimeout(rt); rt = setTimeout(measure, 150); });
  window.addEventListener('load', function () { setTimeout(measure, 200); });
  if (doc.fonts && doc.fonts.ready) doc.fonts.ready.then(measure);
})();
