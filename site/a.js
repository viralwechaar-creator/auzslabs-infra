/* Art layer: counters and small helpers. Motion is mostly CSS (scroll-driven), no scroll listeners. */
(function () {
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches && 'IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (!e.isIntersecting) return; io.unobserve(e.target);
        var el = e.target, to = parseFloat(el.getAttribute('data-count')), t0 = null, suf = el.getAttribute('data-suf') || '';
        function step(t) { if (!t0) t0 = t; var p = Math.min(1, (t - t0) / 1100); el.textContent = Math.round(to * (1 - Math.pow(1 - p, 3))) + suf; if (p < 1) requestAnimationFrame(step); }
        requestAnimationFrame(step);
      });
    });
    $$('[data-count]').forEach(function (el) { io.observe(el); });
  }
})();
/* studio step cycler */
(function () {
  var f = document.querySelector('[data-cyc]'); if (!f) return;
  var S; try { S = JSON.parse(f.getAttribute('data-cyc')); } catch (e) { return; }
  var q = function (s) { return f.querySelector(s); }, at = 0, body = q('.as-body'), t;
  function show(i) {
    at = (i + S.length) % S.length; body.classList.add('sw');
    setTimeout(function () {
      q('[data-cyc-n]').textContent = S[at][0]; q('[data-cyc-k]').textContent = S[at][1].toLowerCase().split(' ').slice(0, 2).join(' ');
      q('[data-cyc-t]').textContent = S[at][1]; q('[data-cyc-d]').textContent = S[at][2]; body.classList.remove('sw');
    }, 180);
  }
  q('[data-cyc-prev]').addEventListener('click', function () { clearInterval(t); show(at - 1); });
  q('[data-cyc-next]').addEventListener('click', function () { clearInterval(t); show(at + 1); });
  show(0); if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) t = setInterval(function () { if (!document.hidden) show(at + 1); }, 4200);
})();
