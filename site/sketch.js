/* AUZslab sketch layer: 3D loader, scroll progress, reveal stagger, parallax, pointer tilt, margin notes.
   Loaded synchronously in <head> (the loader must exist before first paint); everything else waits for the DOM. */
(function () {
  'use strict';
  var root = document.documentElement;
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var fine = window.matchMedia && matchMedia('(hover: hover) and (pointer: fine)').matches;
  // desktop: pinned scroll scenes (fx-live). phones/tablets: a lighter flowing layout with scroll-in animation (fx-flow, fx-flow.css).
  // Neither class (reduced motion / no JS) = plain readable pages.
  var FLOW_MAX = 900; // phones and portrait tablets
  var flow = !reduce && innerWidth < FLOW_MAX;
  if (!reduce) root.classList.add(flow ? 'fx-flow' : 'fx-live');
  if (!reduce) addEventListener('resize', (function () { var h; return function () { clearTimeout(h); h = setTimeout(function () { if ((innerWidth < FLOW_MAX) !== flow) location.reload(); }, 400); }; })());

  /* ---------- the blast: cube goes hot, bursts, particles fly to the real logo/text/buttons and the page opens ---------- */
  function pickTargets() {
    // pages built as scroll scenes mark the exact words the particles should land on with [data-blast]
    var marked = document.querySelectorAll('[data-blast]');
    var sel = marked.length ? '[data-blast], .topbar-logo' : '.topbar-logo, .content .h-hero, .content h1, .content .label, .content .lede, .content .btn-primary, .content .btn-ghost, .hero-art-logo, .hero-services, .topbar .btn';
    var vw = innerWidth, vh = innerHeight, out = [];
    [].forEach.call(document.querySelectorAll(sel), function (el) {
      var r = el.getBoundingClientRect();
      if (r.width < 8 || r.height < 8 || r.bottom < 0 || r.top > vh * .95 || r.right < 0 || r.left > vw) return;
      if (getComputedStyle(el).visibility === 'hidden') return;
      var rects = [];
      if (!/^(IMG|BUTTON|A|SVG)$/i.test(el.tagName) && el.textContent.trim()) { // follow the actual lines of text
        var rg = document.createRange(); rg.selectNodeContents(el);
        [].forEach.call(rg.getClientRects(), function (q) { if (q.width > 6 && q.height > 6) rects.push({ x: q.left, y: q.top + q.height * .15, w: q.width, h: q.height * .7 }); });
      }
      if (!rects.length) rects.push({ x: r.left, y: r.top, w: r.width, h: r.height });
      var wt = 0; rects.forEach(function (q) { q.a = Math.max(40, Math.min(q.w * q.h, 60000)); wt += q.a; });
      out.push({ el: el, rects: rects, wt: wt });
    });
    return out.slice(0, 14);
  }
  function boom(L, cleanup) {
    var W = innerWidth, H = innerHeight, dpr = Math.min(2, window.devicePixelRatio || 1), diag = Math.hypot(W, H);
    var cv = document.createElement('canvas'); cv.className = 'sk-fx'; cv.width = W * dpr; cv.height = H * dpr; root.appendChild(cv);
    var ctx = cv.getContext('2d'); if (!ctx) throw new Error('no canvas'); ctx.scale(dpr, dpr);
    var sc = L.querySelector('.sk-scene').getBoundingClientRect(), cx = sc.left + sc.width / 2, cy = sc.top + sc.height / 2;
    L.style.setProperty('--cx', cx + 'px'); L.style.setProperty('--cy', cy + 'px');
    var targets = pickTargets(), totalW = targets.reduce(function (a, t) { return a + t.wt; }, 0);
    targets.forEach(function (t) { t.el.setAttribute('data-sk-t', ''); });
    root.classList.add('sk-hold');
    L.classList.add('charge');
    function spot() {
      if (!targets.length) return { x: W / 2 + (Math.random() - .5) * W * .6, y: H * .35 + (Math.random() - .5) * 120 };
      var r = Math.random() * totalW, t = targets[0], i;
      for (i = 0; i < targets.length; i++) { r -= targets[i].wt; if (r <= 0) { t = targets[i]; break; } }
      var q = t.rects[0], rr = Math.random() * t.wt;
      for (i = 0; i < t.rects.length; i++) { rr -= t.rects[i].a; if (rr <= 0) { q = t.rects[i]; break; } }
      return { x: q.x + Math.random() * q.w, y: q.y + Math.random() * q.h };
    }
    var N = W < 500 ? 90 : 320, P = [];
    for (var i = 0; i < N; i++) {
      var ang = Math.random() * 6.2832, sp = 260 + Math.random() * 900, tg = spot();
      P.push({ x: cx + (Math.random() - .5) * 30, y: cy + (Math.random() - .5) * 30, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
        tx: tg.x, ty: tg.y, s: 2 + Math.random() * (i % 9 === 0 ? 7 : 3.5), a: Math.random() * 6.28, w: (Math.random() - .5) * 14,
        go: 520 + Math.random() * 300, hot: 1, land: 0, acc: Math.random() < .35, shard: i % 9 === 0 });
    }
    var BLAST_AT = 380, T0 = performance.now(), last = T0, finished = false, flashed = false;
    function ease(t) { return 1 - Math.pow(1 - t, 3); }
    function finish() {
      if (finished) return; finished = true;
      targets.forEach(function (t) { t.el.classList.add('sk-land'); });
      root.classList.remove('sk-hold');
      cv.style.opacity = '0';
      setTimeout(function () { targets.forEach(function (t) { t.el.removeAttribute('data-sk-t'); t.el.classList.remove('sk-land'); }); if (cv.parentNode) cv.parentNode.removeChild(cv); }, 900);
      cleanup();
    }
    function step(now) {
      var t = now - T0, dt = Math.min(.04, (now - last) / 1000); last = now;
      if (t >= BLAST_AT && !flashed) {
        flashed = true; L.classList.add('boom');
        ['sk-ring', 'sk-flash'].forEach(function (cls) { // on <html>, not inside the loader: the loader is being masked away
          var e = document.createElement('div'); e.className = cls; e.style.setProperty('--cx', cx + 'px'); e.style.setProperty('--cy', cy + 'px'); root.appendChild(e);
          setTimeout(function () { if (e.parentNode) e.parentNode.removeChild(e); }, 1100);
        });
      }
      ctx.clearRect(0, 0, W, H);
      if (t < BLAST_AT) { requestAnimationFrame(step); return; }
      var bt = t - BLAST_AT, r = ease(Math.min(1, bt / 1000)) * diag * .95;
      var m = 'radial-gradient(circle at ' + cx + 'px ' + cy + 'px, transparent ' + r + 'px, #000 ' + (r + 2) + 'px)';
      L.style.webkitMaskImage = m; L.style.maskImage = m;
      var landed = 0;
      for (var i = 0; i < P.length; i++) {
        var q = P[i];
        if (bt < q.go) { var d = Math.pow(.03, dt); q.vx *= d; q.vy *= d; q.x += q.vx * dt; q.y += q.vy * dt; }
        else if (!q.land) {
          var k = 55, c = 2 * Math.sqrt(k) * .88, ax = (q.tx - q.x) * k - q.vx * c, ay = (q.ty - q.y) * k - q.vy * c;
          if (q.acc) { ax += -(q.ty - q.y) * 9; ay += (q.tx - q.x) * 9; } // a little curl so they swirl in
          q.vx += ax * dt; q.vy += ay * dt; q.x += q.vx * dt; q.y += q.vy * dt;
          if (Math.hypot(q.tx - q.x, q.ty - q.y) < 2 && Math.hypot(q.vx, q.vy) < 60) q.land = now;
        }
        if (q.land) landed++;
        q.a += q.w * dt; q.hot = Math.max(0, q.hot - dt * (bt < q.go ? .9 : 1.6));
        var life = q.land ? Math.max(0, 1 - (now - q.land) / 260) : 1, sz = q.s * (q.land ? life : 1);
        if (sz < .3) continue;
        ctx.save(); ctx.translate(q.x, q.y); ctx.rotate(q.a);
        ctx.globalAlpha = Math.min(1, .35 + life);
        ctx.fillStyle = q.hot > .55 ? (q.hot > .85 ? '#fff6d6' : '#ff8a2e') : (q.acc ? '#800020' : '#171717');
        if (q.shard) { ctx.fillRect(-sz, -sz * .35, sz * 2, sz * .7); } else { ctx.fillRect(-sz / 2, -sz / 2, sz, sz); }
        ctx.restore();
      }
      if (landed > P.length * .96 || bt > 2100) { finish(); return; }
      requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

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
    var tick = setInterval(function () { p = Math.min(.9, p + (1 - p) * .12); bar.style.transform = 'scaleX(' + p + ')'; }, 140);
    var cleanup = function () { root.classList.remove('sk-loading', 'sk-hold'); if (L.parentNode) L.parentNode.removeChild(L); };
    var finish = function () {
      if (done) return; done = true; clearInterval(tick);
      bar.style.transform = 'scaleX(1)';
      setTimeout(function () {
        try { boom(L, cleanup); }
        catch (e) { L.classList.add('out'); setTimeout(cleanup, 1050); } // plain paper-lift fallback
      }, 250);
    };
    var ready = function () { var wait = Math.max(0, 1500 - (Date.now() - t0)); setTimeout(finish, wait); };
    if (document.readyState === 'complete') ready(); else window.addEventListener('load', ready);
    setTimeout(finish, 4500); // never hold the visitor hostage
    setTimeout(cleanup, 9000); // absolute safety net
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

    if (reduce || flow) return;

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
