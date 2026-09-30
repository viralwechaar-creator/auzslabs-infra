/* AUZslab sketch layer: 3D loader, scroll progress, reveal stagger, parallax, pointer tilt, margin notes.
   Loaded synchronously in <head> (the loader must exist before first paint); everything else waits for the DOM. */
(function () {
  'use strict';
  var root = document.documentElement;
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var fine = window.matchMedia && matchMedia('(hover: hover) and (pointer: fine)').matches;

  /* ---------- loader: once per browser session, never on repeat page views ---------- */
  var seen = false;
  try { seen = !!sessionStorage.getItem('sk_loaded'); } catch (e) {}
  if (!seen && !reduce) {
    root.classList.add('sk-loading');
    var L = document.createElement('div');
    L.className = 'sk-loader'; L.setAttribute('role', 'status'); L.setAttribute('aria-label', 'Loading');
    var faces = function (labels) { return labels.map(function (t) { return '<div class="sk-f">' + t + '</div>'; }).join(''); };
    L.innerHTML =
      '<div class="sk-scene"><div class="sk-cube">' + faces(['POS', 'CRM', 'BOOK', 'PAY', 'WEB', 'QR']) + '</div>' +
      '<div class="sk-cube in">' + faces(['', '', '', '', '', '']) + '</div><div class="sk-shadow"></div></div>' +
      '<div><div class="sk-brand">AUZslab</div><div class="sk-line">sketching your workspace...</div><div class="sk-bar"><i></i></div></div>';
    root.appendChild(L);
    var bar = L.querySelector('.sk-bar i'), t0 = Date.now(), done = false, p = .05;
    var tick = setInterval(function () { p = Math.min(.9, p + (1 - p) * .12); L.style.setProperty('--lp', p); bar.style.setProperty('--lp', p); bar.style.transform = 'scaleX(' + p + ')'; }, 140);
    var finish = function () {
      if (done) return; done = true; clearInterval(tick);
      bar.style.transform = 'scaleX(1)';
      setTimeout(function () {
        L.classList.add('out');
        setTimeout(function () { root.classList.remove('sk-loading'); if (L.parentNode) L.parentNode.removeChild(L); }, 1050);
      }, 250);
    };
    var ready = function () { var wait = Math.max(0, 1500 - (Date.now() - t0)); setTimeout(finish, wait); };
    if (document.readyState === 'complete') ready(); else window.addEventListener('load', ready);
    setTimeout(finish, 4500); // never hold the visitor hostage
    try { sessionStorage.setItem('sk_loaded', '1'); } catch (e) {}
  }

  /* ---------- everything else ---------- */
  function onReady(fn) { if (document.readyState !== 'loading') fn(); else document.addEventListener('DOMContentLoaded', fn); }
  onReady(function () {
    // SVG filter that roughens pencil borders
    var NS = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('width', '0'); svg.setAttribute('height', '0'); svg.setAttribute('aria-hidden', 'true');
    svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
    svg.innerHTML = '<filter id="sk-rough" x="-8%" y="-30%" width="116%" height="160%"><feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="4" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="2.6" xChannelSelector="R" yChannelSelector="G"/></filter>';
    document.body.appendChild(svg);

    // margin notes: <el data-sk-note="start here"> gets a handwritten note + pencil arrow after it
    [].forEach.call(document.querySelectorAll('[data-sk-note]'), function (el) {
      var n = document.createElement('span'); n.className = 'sk-note';
      n.innerHTML = '<svg viewBox="0 0 44 26" aria-hidden="true"><path d="M42 14 C 30 2, 14 4, 4 18 M4 18 L 6 8 M4 18 L 14 20"/></svg>';
      n.appendChild(document.createTextNode(el.getAttribute('data-sk-note')));
      el.insertAdjacentElement('afterend', n);
      if (!el.closest('.reveal')) setTimeout(function () { n.classList.add('on'); }, 1800);
    });

    if (reduce) return;

    // stagger index for grids so cards pop one after another
    [].forEach.call(document.querySelectorAll('.grid-3,.grid-2,.zigzag'), function (g) {
      [].forEach.call(g.children, function (c, i) { c.style.setProperty('--i', i); });
    });

    // progress line + parallax, one rAF loop, smoothed (lerp) so motion trails scroll instead of snapping
    var prog = document.createElement('div'); prog.className = 'sk-progress'; document.body.appendChild(prog);
    var art = document.querySelector('.hero-art');
    var cur = window.scrollY, tgt = cur, pv = 0, running = false;
    function frame() {
      tgt = window.scrollY; cur += (tgt - cur) * .1;
      var max = Math.max(1, document.documentElement.scrollHeight - innerHeight);
      var pr = Math.min(1, Math.max(0, tgt / max));
      if (Math.abs(pr - pv) > .0005) { prog.style.setProperty('--p', pr.toFixed(4)); pv = pr; }
      if (art) art.style.setProperty('--py', (cur * -.08).toFixed(1) + 'px');
      if (Math.abs(tgt - cur) > .3) requestAnimationFrame(frame); else running = false;
    }
    function kick() { if (!running) { running = true; requestAnimationFrame(frame); } }
    addEventListener('scroll', kick, { passive: true }); addEventListener('resize', kick); kick();

    // pointer tilt on cards + hero logo (desktop only)
    if (fine) {
      document.addEventListener('pointermove', function (e) {
        var c = e.target.closest && e.target.closest('.card');
        if (c) {
          var r = c.getBoundingClientRect(), x = (e.clientX - r.left) / r.width - .5, y = (e.clientY - r.top) / r.height - .5;
          c.style.setProperty('--ry', (x * 7).toFixed(2) + 'deg'); c.style.setProperty('--rx', (-y * 7).toFixed(2) + 'deg');
        }
        var logo = document.querySelector('.hero-art-logo');
        if (logo) { logo.style.setProperty('--hy', ((e.clientX / innerWidth - .5) * 18).toFixed(1) + 'deg'); logo.style.setProperty('--hx', ((.5 - e.clientY / innerHeight) * 14).toFixed(1) + 'deg'); }
      }, { passive: true });
      document.addEventListener('pointerout', function (e) {
        var c = e.target.closest && e.target.closest('.card');
        if (c && !c.contains(e.relatedTarget)) { c.style.setProperty('--rx', '0deg'); c.style.setProperty('--ry', '0deg'); }
      });
    }
  });
})();
