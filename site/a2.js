/* Second art layer: small, no scroll listeners. Section spy for legal pages (IntersectionObserver). */
(function () {
  var secs = [].slice.call(document.querySelectorAll('.al-sec'));
  if (secs.length && 'IntersectionObserver' in window) {
    var links = {}; [].forEach.call(document.querySelectorAll('.al-rail a'), function (a) { links[a.getAttribute('href').slice(1)] = a; });
    var cur = null;
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) cur = e.target; });
      if (!cur) return;
      secs.forEach(function (s) { s.classList.toggle('on', s === cur); });
      Object.keys(links).forEach(function (k) { links[k].classList.toggle('on', k === cur.id); });
      var a = links[cur.id]; if (a && a.scrollIntoView && window.innerWidth < 900) { var r = a.parentNode.parentNode.parentNode; if (r) r.scrollLeft = a.offsetLeft - 20; }
    }, { rootMargin: '-25% 0px -60% 0px' });
    secs.forEach(function (s) { io.observe(s); });
    if (secs[0]) { secs[0].classList.add('on'); var f = links[secs[0].id]; if (f) f.classList.add('on'); }
  }
})();

/* Websites & online stores: the browser window switches screens, and cycles until someone taps a tab. */
(function () {
  var tabs = document.querySelectorAll('.aw3-tabs button'); if (!tabs.length) return;
  var scr = document.querySelectorAll('.wb-scr'), addr = document.getElementById('awAddr');
  var A = ['yourbrand.in', 'shop.yourbrand.in', 'orders.yourbrand.in'], cur = 0, timer = null;
  function go(i) { cur = i; [].forEach.call(tabs, function (t, k) { t.classList.toggle('on', k === i); }); [].forEach.call(scr, function (s, k) { s.classList.toggle('on', k === i); }); if (addr) addr.textContent = A[i]; }
  [].forEach.call(tabs, function (t, k) { t.addEventListener('click', function () { clearInterval(timer); timer = null; go(k); }); });
  if (!window.matchMedia('(prefers-reduced-motion:reduce)').matches) timer = setInterval(function () { go((cur + 1) % tabs.length); }, 4400);
})();
