/* AUZslab FX physics: floating, draggable bubbles (circle physics, no library). Needs fx.js first.
   <div data-bubbles> <a class="bub" href="#x"> ... </a> ... </div>
   Drag/fling any bubble; a tap (no drag) follows its link. Without JS they are ordinary inline links. */
(function () {
  'use strict';
  var FX = window.FX; if (!FX || !FX.live) return;
  function Bubbles(box) {
    var me = this; this.box = box; this.W = 0; this.H = 0;
    this.B = [].slice.call(box.querySelectorAll('.bub')).map(function (el, i) {
      return { el: el, r: 40, x: 0, y: 0, vx: (Math.random() - .5) * 1.4, vy: (Math.random() - .5) * 1.4, drag: false, i: i };
    });
    this.measure();
    var n = this.B.length, cols = Math.ceil(Math.sqrt(n * this.W / Math.max(1, this.H)));
    this.B.forEach(function (b, i) { b.x = (.12 + .76 * ((i % cols) + .5) / cols) * me.W + (Math.random() - .5) * 30; b.y = (.15 + .7 * (Math.floor(i / cols) + .5) / Math.ceil(n / cols)) * me.H + (Math.random() - .5) * 30; });
    this.B.forEach(function (b) { me.bind(b); });
    window.addEventListener('resize', function () { me.measure(); });
    FX.tick(function (t, dt) { me.step(t, dt); });
  }
  Bubbles.prototype.measure = function () {
    var r = this.box.getBoundingClientRect(); this.W = r.width; this.H = r.height; this.left = r.left; this.top = r.top;
    this.B.forEach(function (b) { b.r = b.el.offsetWidth / 2; });
  };
  Bubbles.prototype.bind = function (b) {
    var me = this, sx = 0, sy = 0, st = 0, ox = 0, oy = 0, moved = 0, last = { x: 0, y: 0, t: 0 };
    b.el.style.touchAction = 'none';
    b.el.addEventListener('pointerdown', function (e) {
      b.drag = true; moved = 0; st = performance.now(); sx = e.clientX; sy = e.clientY;
      var r = me.box.getBoundingClientRect(); ox = e.clientX - r.left - b.x; oy = e.clientY - r.top - b.y;
      last = { x: e.clientX, y: e.clientY, t: st }; try { b.el.setPointerCapture(e.pointerId); } catch (x) { }
      b.el.classList.add('grab'); b.vx = b.vy = 0;
    });
    b.el.addEventListener('pointermove', function (e) {
      if (!b.drag) return;
      var r = me.box.getBoundingClientRect(), nx = e.clientX - r.left - ox, ny = e.clientY - r.top - oy, now = performance.now();
      moved = Math.max(moved, Math.hypot(e.clientX - sx, e.clientY - sy));
      var dtt = Math.max(8, now - last.t); b.vx = (e.clientX - last.x) / dtt * 16; b.vy = (e.clientY - last.y) / dtt * 16; last = { x: e.clientX, y: e.clientY, t: now };
      b.x = Math.max(b.r, Math.min(me.W - b.r, nx)); b.y = Math.max(b.r, Math.min(me.H - b.r, ny));
    });
    function up() { if (!b.drag) return; b.drag = false; b.el.classList.remove('grab'); b.vx = Math.max(-16, Math.min(16, b.vx)); b.vy = Math.max(-16, Math.min(16, b.vy)); }
    b.el.addEventListener('pointerup', up); b.el.addEventListener('pointercancel', up);
    b.el.addEventListener('click', function (e) { if (moved > 6) e.preventDefault(); });
  };
  Bubbles.prototype.step = function (t, dt) {
    var r = this.box.getBoundingClientRect(); if (r.bottom < -100 || r.top > FX.vh + 100) return;
    if (Math.abs(r.width - this.W) > 2 || Math.abs(r.height - this.H) > 2) this.measure();
    var f = Math.min(dt, 40) / 16.7, B = this.B, i, j, a, b, mx = FX.mx - r.left, my = FX.my - r.top;
    for (i = 0; i < B.length; i++) {
      a = B[i]; if (a.drag) continue;
      a.vx += (Math.sin(t * .5 + i * 1.7) * .012) * f; a.vy += (Math.cos(t * .43 + i * 2.3) * .012) * f - 0.002 * f;
      var dx = a.x - mx, dy = a.y - my, d = Math.hypot(dx, dy);
      if (d < a.r + 70 && d > 1) { var k = (1 - d / (a.r + 70)) * .5 * f; a.vx += dx / d * k; a.vy += dy / d * k; }
      a.vx *= Math.pow(.992, f); a.vy *= Math.pow(.992, f);
      a.x += a.vx * f; a.y += a.vy * f;
      if (a.x < a.r) { a.x = a.r; a.vx = Math.abs(a.vx) * .9; } else if (a.x > this.W - a.r) { a.x = this.W - a.r; a.vx = -Math.abs(a.vx) * .9; }
      if (a.y < a.r) { a.y = a.r; a.vy = Math.abs(a.vy) * .9; } else if (a.y > this.H - a.r) { a.y = this.H - a.r; a.vy = -Math.abs(a.vy) * .9; }
    }
    for (i = 0; i < B.length; i++) for (j = i + 1; j < B.length; j++) {
      a = B[i]; b = B[j]; var ddx = b.x - a.x, ddy = b.y - a.y, dd = Math.hypot(ddx, ddy), min = a.r + b.r;
      if (dd < min && dd > .01) {
        var nx = ddx / dd, ny = ddy / dd, ov = (min - dd) / 2;
        if (!a.drag) { a.x -= nx * ov; a.y -= ny * ov; } if (!b.drag) { b.x += nx * ov; b.y += ny * ov; }
        var rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
        if (rel < 0) { var imp = -rel * .95; if (!a.drag) { a.vx -= nx * imp; a.vy -= ny * imp; } if (!b.drag) { b.vx += nx * imp; b.vy += ny * imp; } }
      }
    }
    for (i = 0; i < B.length; i++) { a = B[i]; a.el.style.transform = 'translate3d(' + (a.x - a.r).toFixed(1) + 'px,' + (a.y - a.r).toFixed(1) + 'px,0) rotate(' + (a.vx * 2.4).toFixed(1) + 'deg)'; }
  };
  FX.bubbles = function (box) { return new Bubbles(box); };
  function boot() { [].forEach.call(document.querySelectorAll('[data-bubbles]'), function (b) { FX.bubbles(b); }); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 0); }); else setTimeout(boot, 0);
})();
