/* AUZslab FX canvases: the pencil-particle field (flows like wind, then snaps into words, drawings and live
   geometry) and the pencil cursor trail. Needs fx.js first.

   <canvas class="fx-field" data-shapes="0:flow; .15:cube; .4:text:POS|CRM; .8:ring" data-kick="8"></canvas>
   A canvas inside a [data-scene] follows that scene's progress (the last shape whose p <= progress wins).
   Shape spec:  kind[:arg][@cx,cy,w,h]   (box in fractions of the canvas)
     flow | scatter | ring | cube | spiral | wave | grid | text:WORD (use | for line breaks) | art:pos */
(function () {
  'use strict';
  var FX = window.FX; if (!FX || !FX.live || FX.flow) return;
  var TAU = Math.PI * 2, rnd = Math.random;
  var FONT = '-apple-system,BlinkMacSystemFont,"SF Pro Display",Inter,system-ui,sans-serif';

  /* ---------- shape generators ---------- */
  var textCache = {}, artCache = {};
  function textPoints(text, bw, bh, N) {
    var key = text + '|' + (bw | 0) + 'x' + (bh | 0) + '|' + N; if (textCache[key]) return textCache[key];
    var W = Math.max(40, bw | 0), H = Math.max(40, bh | 0), c = document.createElement('canvas'); c.width = W; c.height = H;
    var x = c.getContext('2d'), lines = text.split('|'), fs = H / lines.length * .92, i, wmax;
    x.font = '900 ' + fs + 'px ' + FONT;
    wmax = 0; lines.forEach(function (l) { wmax = Math.max(wmax, x.measureText(l).width); });
    if (wmax > W * .97) fs *= W * .97 / wmax;
    x.font = '900 ' + fs + 'px ' + FONT; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillStyle = '#000';
    lines.forEach(function (l, li) { x.fillText(l, W / 2, H / 2 + (li - (lines.length - 1) / 2) * fs * .98 + fs * .04); });
    var d = x.getImageData(0, 0, W, H).data, st = 2, edge = [], inner = [], px, py;
    function on(a, b) { return a >= 0 && b >= 0 && a < W && b < H && d[(b * W + a) * 4 + 3] > 128; }
    for (py = 0; py < H; py += st) for (px = 0; px < W; px += st) {
      if (!on(px, py)) continue;
      if (!on(px - 3, py) || !on(px + 3, py) || !on(px, py - 3) || !on(px, py + 3)) edge.push([px, py]); else inner.push([px, py]);
    }
    function pick(arr, n) { if (arr.length <= n) return arr; var out = [], k = arr.length / n; for (var j = 0; j < n; j++) out.push(arr[Math.floor(j * k + rnd() * k)]); return out; }
    var pts = pick(edge, Math.floor(N * .72)).concat(pick(inner, Math.floor(N * .28)));
    return (textCache[key] = pts);
  }
  function artPoints(key, N) {
    if (artCache[key]) return artCache[key];
    var NS = 'http://www.w3.org/2000/svg', svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('width', '240'); svg.setAttribute('height', '200'); svg.setAttribute('viewBox', '0 0 240 200');
    svg.style.cssText = 'position:absolute;left:-9999px;top:0;visibility:hidden';
    svg.innerHTML = '<g>' + FX.artMarkup(key) + '</g>'; document.body.appendChild(svg);
    var shapes = [].slice.call(svg.querySelectorAll('path,circle,rect,ellipse,line')), total = 0, lens = [];
    shapes.forEach(function (s) { var l = 0; try { l = s.getTotalLength(); } catch (e) { } lens.push(l); total += l; });
    var pts = [];
    shapes.forEach(function (s, i) {
      if (!lens[i]) return; var n = Math.max(2, Math.round(lens[i] / total * N)), m = s.getCTM(), k;
      for (k = 0; k < n; k++) { var q = s.getPointAtLength(lens[i] * k / n); if (m) { var px = m.a * q.x + m.c * q.y + m.e, py = m.b * q.x + m.d * q.y + m.f; pts.push([px, py]); } else pts.push([q.x, q.y]); }
    });
    document.body.removeChild(svg);
    return (artCache[key] = pts);
  }
  var CUBE_V = [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]];
  var CUBE_E = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];

  /* ---------- the field ---------- */
  function Field(cv, opt) {
    opt = opt || {};
    this.cv = cv; this.ctx = cv.getContext('2d');
    this.N = opt.count || (FX.mobile ? 650 : 1500);
    this.ink = opt.ink || '#171717'; this.accent = opt.accent || '#800020';
    this.dpr = Math.min(window.devicePixelRatio || 1, FX.mobile ? 1.25 : 1.5);
    this.kick = opt.kick == null ? 6 : opt.kick;
    this.P = []; this.order = []; this.kind = 'flow'; this.box = [.5, .5, .8, .7]; this.pts = null; this.M = 0; this.proj = null;
    this.resize();
    for (var i = 0; i < this.N; i++) {
      this.P.push({ x: rnd() * this.w, y: rnd() * this.h, vx: 0, vy: 0, a0: -.75 + (rnd() - .5) * .7, len: 3 + rnd() * 4.5, col: rnd() < .2 ? 1 : 0, has: false, ti: 0, tx: 0, ty: 0 });
      this.order.push(i);
    }
    for (i = this.N - 1; i > 0; i--) { var j = Math.floor(rnd() * (i + 1)), t = this.order[i]; this.order[i] = this.order[j]; this.order[j] = t; }
    this.spec = '';
  }
  Field.prototype.resize = function () {
    this.w = this.cv.clientWidth || FX.vw; this.h = this.cv.clientHeight || FX.vh;
    this.cv.width = Math.round(this.w * this.dpr); this.cv.height = Math.round(this.h * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.lw = Math.max(.8, 1.05 - (this.dpr - 1) * .2);
    if (this.spec) { var s = this.spec; this.spec = ''; this.to(s, 0); }
  };
  Field.prototype.to = function (spec, kick) {
    if (spec === this.spec) return; this.spec = spec;
    var at = spec.indexOf('@'), box = this.box;
    if (at > -1) { box = spec.slice(at + 1).split(',').map(parseFloat); spec = spec.slice(0, at); } else box = [.5, .5, .8, .7];
    var c = spec.indexOf(':'), kind = c > -1 ? spec.slice(0, c) : spec, arg = c > -1 ? spec.slice(c + 1) : '';
    var w = this.w, h = this.h, bw = box[2] * w, bh = box[3] * h, cx = box[0] * w, cy = box[1] * h, pts = null, M = 0;
    this.kind = kind; this.cx = cx; this.cy = cy; this.bw = bw; this.bh = bh; this.fn = null;
    if (kind === 'text') {
      pts = textPoints(arg, bw, bh, this.N).map(function (p) { return [p[0] + cx - Math.max(40, bw | 0) / 2, p[1] + cy - Math.max(40, bh | 0) / 2]; });
    } else if (kind === 'art') {
      var raw = artPoints(arg, this.N), sc = Math.min(bw / 240, bh / 200);
      pts = raw.map(function (p) { return [cx + (p[0] - 120) * sc, cy + (p[1] - 100) * sc]; });
    } else if (kind === 'grid') {
      var cols = Math.ceil(Math.sqrt(this.N * bw / bh)), rows = Math.ceil(this.N / cols);
      pts = []; for (var gi = 0; gi < this.N; gi++) pts.push([cx - bw / 2 + (gi % cols) / Math.max(1, cols - 1) * bw, cy - bh / 2 + Math.floor(gi / cols) / Math.max(1, rows - 1) * bh]);
    }
    if (pts) { this.pts = pts; M = Math.min(pts.length, this.N); }
    else if (kind === 'ring' || kind === 'cube' || kind === 'spiral' || kind === 'wave') { this.pts = null; M = this.N; }
    else { this.pts = null; M = 0; }   // flow / scatter: nobody has a target
    this.M = M;
    for (var i = 0; i < this.N; i++) { var p = this.P[this.order[i]]; p.has = i < M; p.ti = i; }
    var k = kick == null ? this.kick : kick;
    if (k) for (i = 0; i < this.N; i++) { var q = this.P[i], ang = Math.atan2(q.y - cy, q.x - cx) + (rnd() - .5) * .8, sp = k * (.4 + rnd()); q.vx += Math.cos(ang) * sp; q.vy += Math.sin(ang) * sp; }
  };
  Field.prototype.live = function (t, i) { // live (time-varying) shapes
    var kind = this.kind, n = this.M, cx = this.cx, cy = this.cy, R = Math.min(this.bw, this.bh) * .5;
    if (kind === 'ring') { var a = i / n * TAU + t * .35; return [cx + Math.cos(a) * R * (1 + Math.sin(i * .37 + t * 2) * .012), cy + Math.sin(a) * R * .96]; }
    if (kind === 'spiral') { var u = i / n, a2 = u * TAU * 4.5 + t * .4; return [cx + Math.cos(a2) * R * u, cy + Math.sin(a2) * R * u]; }
    if (kind === 'wave') { var u2 = i / n; return [cx - this.bw / 2 + u2 * this.bw, cy + Math.sin(u2 * TAU * 2.4 + t * 1.3) * this.bh * .35 + Math.sin(u2 * TAU * 7 - t) * this.bh * .05]; }
    if (kind === 'cube') {
      var pr = this.proj, e = CUBE_E[i % 12], K = Math.ceil(n / 12), u3 = (Math.floor(i / 12) % K) / K, A = pr[e[0]], B = pr[e[1]];
      return [A[0] + (B[0] - A[0]) * u3, A[1] + (B[1] - A[1]) * u3];
    }
    return [cx, cy];
  };
  Field.prototype.project = function (t) {
    var ax = .55 + t * .23, ay = t * .5, cax = Math.cos(ax), sax = Math.sin(ax), cay = Math.cos(ay), say = Math.sin(ay), R = Math.min(this.bw, this.bh) * .36, out = [];
    for (var i = 0; i < 8; i++) {
      var v = CUBE_V[i], x = v[0], y = v[1] * cax - v[2] * sax, z = v[1] * sax + v[2] * cax, x2 = x * cay + z * say, z2 = -x * say + z * cay, s = 1 / (1 + z2 * .16);
      out.push([this.cx + x2 * R * s * 1.25, this.cy + y * R * s * 1.25]);
    }
    this.proj = out;
  };
  Field.prototype.step = function (t, dt) {
    var r = this.cv.getBoundingClientRect(); if (r.bottom < 0 || r.top > FX.vh || !this.ctx) return;
    var f = Math.min(dt, 40) / 16.7, P = this.P, N = this.N, w = this.w, h = this.h, ctx = this.ctx, i, p, pt;
    var mx = FX.mx - r.left, my = FX.my - r.top, PR = Math.min(w, h) * .13, turb = Math.min(2.2, Math.abs(FX.v) * .06);
    if (this.kind === 'cube') this.project(t);
    var K = .02 * f, D = Math.pow(.83, f), damp = Math.pow(.962, f), flow = .085 * f, pts = this.pts;
    ctx.clearRect(0, 0, w, h);
    ctx.lineCap = 'round'; ctx.lineWidth = this.lw;
    var seg = [[], []];
    for (i = 0; i < N; i++) {
      p = P[i];
      if (p.has) {
        pt = pts ? pts[p.ti] : this.live(t, p.ti); p.tx = pt[0]; p.ty = pt[1];
        p.vx += (p.tx - p.x) * K; p.vy += (p.ty - p.y) * K; p.vx *= D; p.vy *= D;
      } else {
        var s = .0016, ang = (Math.sin(p.x * s * 1.3 + t * .35) + Math.cos(p.y * s * 1.7 - t * .28) + Math.sin((p.x + p.y) * s * .8 + t * .2)) * 1.4;
        p.vx += Math.cos(ang) * flow; p.vy += Math.sin(ang) * flow; p.vx *= damp; p.vy *= damp;
      }
      var dx = p.x - mx, dy = p.y - my, d2 = dx * dx + dy * dy;
      if (d2 < PR * PR && d2 > 1) { var d = Math.sqrt(d2), push = (1 - d / PR); push *= push * 2.6 * f; p.vx += dx / d * push; p.vy += dy / d * push; }
      if (turb > .05) { p.vx += (rnd() - .5) * turb; p.vy += (rnd() - .5) * turb; }
      p.x += p.vx * f; p.y += p.vy * f;
      if (!p.has) { if (p.x < -20) p.x = w + 20; else if (p.x > w + 20) p.x = -20; if (p.y < -20) p.y = h + 20; else if (p.y > h + 20) p.y = -20; }
      var x0, y0, x1, y1;
      if (p.has && Math.abs(p.vx) + Math.abs(p.vy) < 1.2) { var hl = p.len * .5; x0 = p.x - Math.cos(p.a0) * hl; y0 = p.y - Math.sin(p.a0) * hl; x1 = p.x + Math.cos(p.a0) * hl; y1 = p.y + Math.sin(p.a0) * hl; }
      else { x0 = p.x - p.vx * 4.6; y0 = p.y - p.vy * 4.6; x1 = p.x; y1 = p.y; }
      seg[p.col].push(x0, y0, x1, y1);
    }
    for (var c = 0; c < 2; c++) {
      var a = seg[c]; if (!a.length) continue;
      ctx.beginPath();
      for (i = 0; i < a.length; i += 4) { ctx.moveTo(a[i], a[i + 1]); ctx.lineTo(a[i + 2], a[i + 3]); }
      ctx.strokeStyle = c ? this.accent : this.ink; ctx.globalAlpha = c ? .8 : .5; ctx.stroke();
    }
    ctx.globalAlpha = 1;
  };
  FX.Field = Field;

  /* bind every <canvas class="fx-field">; inside a scene, its data-shapes follow the scene's progress */
  function bind(cv) {
    var f = new Field(cv, { ink: cv.getAttribute('data-ink') || undefined, accent: cv.getAttribute('data-accent') || undefined, count: parseInt(cv.getAttribute('data-n') || '0', 10) || undefined, kick: cv.hasAttribute('data-kick') ? parseFloat(cv.getAttribute('data-kick')) : undefined });
    var raw = cv.getAttribute('data-shapes') || 'flow', list = [];
    raw.split(';').forEach(function (s) { s = s.trim(); if (!s) return; var m = s.match(/^(-?[\d.]+):(.*)$/); if (m && /^[\d.]/.test(s)) list.push([parseFloat(m[1]), m[2].trim()]); else list.push([0, s]); });
    list.sort(function (a, b) { return a[0] - b[0]; });
    var scene = FX.scene(cv.closest('[data-scene]') || '');
    function pick(p) { var s = list[0][1]; for (var i = 0; i < list.length; i++) if (p >= list[i][0]) s = list[i][1]; return s; }
    if (scene) scene.on(function (p) { f.to(pick(p)); }); else f.to(list[0][1], 0);
    FX.tick(function (t, dt) { f.step(t, dt); });
    window.addEventListener('resize', (function () { var h; return function () { clearTimeout(h); h = setTimeout(function () { f.resize(); }, 160); }; })());
    cv.__field = f;
  }

  /* ---------- pencil cursor trail (desktop only) ---------- */
  FX.cursor = function () {
    if (!FX.fine) return;
    var cv = document.createElement('canvas'); cv.className = 'fx-trail'; cv.setAttribute('aria-hidden', 'true'); document.body.appendChild(cv);
    var ctx = cv.getContext('2d'), dpr = Math.min(window.devicePixelRatio || 1, 1.5), px = -1, py = -1, pulses = [];
    function size() { cv.width = FX.vw * dpr; cv.height = FX.vh * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); }
    size(); window.addEventListener('resize', size);
    window.addEventListener('pointerdown', function (e) { pulses.push({ x: e.clientX, y: e.clientY, t: 0 }); }, { passive: true });
    FX.tick(function (t, dt) {
      ctx.globalCompositeOperation = 'destination-out'; ctx.fillStyle = 'rgba(0,0,0,' + Math.min(.4, dt / 16.7 * .07) + ')'; ctx.fillRect(0, 0, FX.vw, FX.vh);
      ctx.globalCompositeOperation = 'source-over';
      var x = FX.mx, y = FX.my;
      if (px >= 0) {
        var dx = x - px, dy = y - py, sp = Math.hypot(dx, dy);
        if (sp > .5 && sp < 300) {
          ctx.lineCap = 'round'; ctx.strokeStyle = 'rgba(128,0,32,.62)'; ctx.lineWidth = 1 + Math.min(2.2, sp * .06);
          ctx.beginPath(); ctx.moveTo(px + (rnd() - .5) * .9, py + (rnd() - .5) * .9); ctx.lineTo(x, y); ctx.stroke();
          if (sp > 14) { ctx.strokeStyle = 'rgba(23,23,23,.35)'; ctx.lineWidth = .8; ctx.beginPath(); ctx.moveTo(px + (rnd() - .5) * 5, py + (rnd() - .5) * 5); ctx.lineTo(x + (rnd() - .5) * 5, y + (rnd() - .5) * 5); ctx.stroke(); }
        }
      }
      px = x; py = y;
      for (var i = pulses.length - 1; i >= 0; i--) {
        var q = pulses[i]; q.t += dt / 520; if (q.t >= 1) { pulses.splice(i, 1); continue; }
        ctx.strokeStyle = 'rgba(128,0,32,' + (1 - q.t) * .7 + ')'; ctx.lineWidth = 1.6; ctx.setLineDash([5, 6]);
        ctx.beginPath(); ctx.arc(q.x, q.y, 6 + q.t * 70, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
      }
    });
  };

  function boot() {
    [].forEach.call(document.querySelectorAll('canvas.fx-field'), bind);
    if (document.body.classList.contains('fx')) FX.cursor();
  }
  // scenes are created on DOMContentLoaded by fx.js, which runs first (script order), so bind afterwards
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 0); }); else setTimeout(boot, 0);
})();
