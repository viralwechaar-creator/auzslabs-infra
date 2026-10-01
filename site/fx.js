/* AUZslab FX engine: scroll-driven scenes for the marketing site. No dependencies, no build step.

   HOW A PAGE USES IT (all declarative, in the page's own HTML):

   <div class="fx-scene" data-scene style="--len:6">         a tall block (6 screens of scrolling)
     <div class="fx-stage">                                   the sticky 100vh window onto the scene
       <h2 class="k" data-k="0:x-30,o0; .2:x0,o1; .8:o1; 1:x40,o0">...</h2>
     </div>
   </div>

   data-k="p:prop value,prop value; p:..."   keyframes against the scene's progress p (0..1). Between two
       keyframes every prop is eased (smoothstep; data-ease="lin" for linear). A prop missing from a keyframe
       holds its previous value. Props: x (vw) y (vh) z (px) r rx ry sk (deg) s sx sy (scale) o (opacity),
       anything else becomes a CSS variable --name, so CSS can do the rest (d = svg draw 0..1, t = text reveal).
   data-km="..."      same, used instead of data-k on phones (< 700px wide).
   data-fly           a 3D world: children with data-xyz="x,y,z" are flown through as p advances
   data-art="pos"     inline pencil drawing from fx-art.js; data-draw scrubs it by the --d variable
   data-split="rise"  splits text into words/letters for type animation (chars by default, data-by="words")
   data-count="1200"  number that counts up when it scrolls into view
   data-marquee       an endless ticker whose speed follows scroll velocity
   data-magnet        the element leans toward the pointer
   data-tilt          3D tilt toward the pointer
   data-par="0.2"     parallax drift (fraction of scroll)
   data-reveal        adds .in when scrolled into view (CSS does the animation)
   data-hscroll       vertical scroll drives a horizontal track (.fx-track) inside the stage

   Without JS, or with prefers-reduced-motion, none of this runs and the page is a normal readable document
   (html.fx-live is what switches the scene layout on; sketch.js adds it in <head>). */
(function () {
  'use strict';
  var doc = document, root = doc.documentElement;
  function mq(q) { try { return window.matchMedia(q).matches; } catch (e) { return false; } }
  var FX = window.FX = window.FX || {};
  FX.reduce = mq('(prefers-reduced-motion: reduce)');
  FX.fine = mq('(hover: hover) and (pointer: fine)');
  FX.live = !FX.reduce;
  FX.vw = window.innerWidth; FX.vh = window.innerHeight; FX.mobile = FX.vw < 700;
  FX.y = window.pageYOffset; FX.ty = FX.y; FX.v = 0; FX.t = 0; FX.dt = 16;
  FX.mx = -9999; FX.my = -9999; FX.nx = 0; FX.ny = 0; FX.tnx = 0; FX.tny = 0; FX.down = false;

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function smooth(t) { return t * t * (3 - 2 * t); }
  function rng(seed) { var s = seed >>> 0; return function () { s = (s + 0x6D2B79F5) >>> 0; var t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  FX.clamp = clamp; FX.lerp = lerp; FX.smooth = smooth; FX.rng = rng;
  function $$(sel, ctx) { return [].slice.call((ctx || doc).querySelectorAll(sel)); }
  FX.$$ = $$;

  if (!FX.live) { root.classList.add('fx-static'); root.classList.remove('fx-live'); }

  /* ---------- the one animation loop ---------- */
  var tasks = [], last = 0;
  FX.tick = function (fn) { tasks.push(fn); return function () { var i = tasks.indexOf(fn); if (i > -1) tasks.splice(i, 1); }; };
  function frame(now) {
    window.requestAnimationFrame(frame);
    var dt = last ? Math.min(64, now - last) : 16; last = now;
    FX.dt = dt; FX.t = now / 1000;
    var ty = window.pageYOffset, k = 1 - Math.exp(-dt / 85), prev = FX.y;
    FX.y += (ty - FX.y) * k; if (Math.abs(ty - FX.y) < .08) FX.y = ty;
    FX.ty = ty; FX.v = (FX.y - prev) * 16.7 / dt;
    FX.nx += (FX.tnx - FX.nx) * k * 1.4; FX.ny += (FX.tny - FX.ny) * k * 1.4;
    for (var i = 0; i < tasks.length; i++) tasks[i](FX.t, dt);
  }

  /* ---------- pointer ---------- */
  function onPointer(e) {
    FX.mx = e.clientX; FX.my = e.clientY;
    FX.tnx = e.clientX / FX.vw * 2 - 1; FX.tny = e.clientY / FX.vh * 2 - 1;
  }
  window.addEventListener('pointermove', onPointer, { passive: true });
  window.addEventListener('pointerdown', function (e) { FX.down = true; onPointer(e); }, { passive: true });
  window.addEventListener('pointerup', function () { FX.down = false; }, { passive: true });

  /* ---------- drawings: <svg data-art="pos"> ---------- */
  function wob(d, amp, seed) { // hand-drawn jitter baked into the path data (no SVG filter, so it stays cheap when scaled)
    var r = rng(seed);
    return d.replace(/([MLCSQTmlcsqt])([^MLCSQTHVAZmlcsqthvaz]*)/g, function (m, c, args) {
      return c + args.replace(/-?\d*\.?\d+/g, function (n) { return (parseFloat(n) + (r() - .5) * 2 * amp).toFixed(1); });
    });
  }
  FX.artMarkup = function (key, opt) {
    opt = opt || {};
    var lib = window.FXART; if (!lib) return '';
    var src = lib.ART[key] || lib.ART['default'];
    if (opt.wob) { var n = 0; src = src.replace(/ d="([^"]+)"/g, function (m, d) { return ' d="' + wob(d, opt.wob, 11 + (n++)) + '"'; }); }
    return src;
  };
  function hydrateArt(el) {
    var key = el.getAttribute('data-art'), wobAmt = parseFloat(el.getAttribute('data-wob'));
    el.setAttribute('viewBox', '0 0 240 200'); el.setAttribute('aria-hidden', 'true');
    el.setAttribute('class', ((el.getAttribute('class') || '') + ' fx-art fx-draw').trim());
    el.innerHTML = '<g>' + FX.artMarkup(key, { wob: isNaN(wobAmt) ? 0 : wobAmt }) + '</g>';
    var shapes = $$('path,circle,rect,ellipse,line,polyline', el);
    shapes.forEach(function (s, i) { s.setAttribute('pathLength', '1'); s.style.setProperty('--i', i); });
    el.style.setProperty('--n', shapes.length);
    // a drawing inside a keyframed actor is scrubbed through that actor's --d; a lone [data-draw-in] draws itself when it scrolls into view
    if (el.hasAttribute('data-draw-in')) el.style.setProperty('--d', 0);
  }
  function drawIn(el) {
    var t0 = performance.now(), dur = parseFloat(el.getAttribute('data-draw-in')) || 1600;
    (function step(now) { var t = clamp((now - t0) / dur, 0, 1); el.style.setProperty('--d', (t * t * (3 - 2 * t)).toFixed(4)); if (t < 1) requestAnimationFrame(step); })(t0);
  }
  FX.hydrate = function (ctx) { $$('[data-art]', ctx).forEach(function (el) { if (!el.__art) { el.__art = 1; hydrateArt(el); } }); };

  /* ---------- text splitting ---------- */
  function splitEl(el) {
    if (el.__split) return; el.__split = 1;
    var by = el.getAttribute('data-by') || 'chars';
    var label = el.textContent.replace(/\s+/g, ' ').trim(), idx = 0, r = rng(label.length * 131 + 7);
    function rv(s) { s.style.setProperty('--rx', (r() * 2 - 1).toFixed(2)); s.style.setProperty('--ry', (r() * 2 - 1).toFixed(2)); s.style.setProperty('--rr', (r() * 2 - 1).toFixed(2)); }
    (function walk(node) {
      [].slice.call(node.childNodes).forEach(function (n) {
        if (n.nodeType === 3) {
          var frag = doc.createDocumentFragment();
          n.nodeValue.split(/(\s+)/).forEach(function (w) {
            if (!w) return;
            if (/^\s+$/.test(w)) { frag.appendChild(doc.createTextNode(' ')); return; }
            var ws = doc.createElement('span'); ws.className = 'fx-w'; ws.setAttribute('aria-hidden', 'true');
            if (by === 'words') { ws.classList.add('fx-c'); ws.style.setProperty('--i', idx++); rv(ws); ws.textContent = w; }
            else { Array.from(w).forEach(function (ch) { var cs = doc.createElement('span'); cs.className = 'fx-c'; cs.style.setProperty('--i', idx++); rv(cs); cs.textContent = ch; ws.appendChild(cs); }); }
            frag.appendChild(ws);
          });
          n.parentNode.replaceChild(frag, n);
        } else if (n.nodeType === 1 && !/^(BR|SVG|IMG|CANVAS)$/i.test(n.tagName)) walk(n);
      });
    })(el);
    var sr = doc.createElement('span'); sr.className = 'fx-sr'; sr.textContent = label; el.insertBefore(sr, el.firstChild);
    el.style.setProperty('--n', idx); el.classList.add('fx-split');
  }
  FX.split = splitEl;

  /* ---------- keyframes ---------- */
  function parseK(str) {
    var keys = [], all = {};
    String(str).split(';').forEach(function (seg) {
      seg = seg.trim(); if (!seg) return;
      var c = seg.indexOf(':'); if (c < 0) return;
      var k = { p: parseFloat(seg.slice(0, c)), v: {} };
      seg.slice(c + 1).replace(/([a-z]+)(-?\d*\.?\d+)/g, function (m, n, num) { k.v[n] = parseFloat(num); all[n] = 1; return m; });
      keys.push(k);
    });
    keys.sort(function (a, b) { return a.p - b.p; });
    var props = Object.keys(all), i;
    props.forEach(function (n) {
      // a prop that has not been mentioned yet sits at its default (0, or 1 for opacity/scale); after that a missing value holds
      var prev = (n === 'o' || n === 's' || n === 'sx' || n === 'sy') ? 1 : 0;
      for (i = 0; i < keys.length; i++) { if (keys[i].v[n] == null) keys[i].v[n] = prev; else prev = keys[i].v[n]; }
    });
    var has = {}; props.forEach(function (n) { has[n] = 1; });
    return { keys: keys, props: props, has: has };
  }
  var scratch = {};
  function sample(pk, p, lin) {
    var ks = pk.keys, n = ks.length, pr = pk.props, i, j, a, b, t, nm;
    if (!n) return scratch;
    if (n === 1 || p <= ks[0].p) { for (j = 0; j < pr.length; j++) scratch[pr[j]] = ks[0].v[pr[j]]; return scratch; }
    if (p >= ks[n - 1].p) { for (j = 0; j < pr.length; j++) scratch[pr[j]] = ks[n - 1].v[pr[j]]; return scratch; }
    for (i = 0; i < n - 1; i++) if (p < ks[i + 1].p) break;
    a = ks[i].v; b = ks[i + 1].v; t = (p - ks[i].p) / ((ks[i + 1].p - ks[i].p) || 1);
    if (!lin) t = t * t * (3 - 2 * t);
    for (j = 0; j < pr.length; j++) { nm = pr[j]; scratch[nm] = a[nm] + (b[nm] - a[nm]) * t; }
    return scratch;
  }
  var CORE = { x: 1, y: 1, z: 1, rx: 1, ry: 1, r: 1, sk: 1, s: 1, sx: 1, sy: 1, o: 1 };
  function applyActor(a, p) {
    var pk = (FX.mobile && a.mob) ? a.mob : a.desk, v = sample(pk, p, a.lin), h = pk.has, el = a.el, t = '', j, nm;
    if (h.x || h.y || h.z) t += 'translate3d(' + (h.x ? v.x : 0).toFixed(2) + 'vw,' + (h.y ? v.y : 0).toFixed(2) + 'vh,' + (h.z ? v.z : 0).toFixed(1) + 'px)';
    if (h.rx) t += ' rotateX(' + v.rx.toFixed(2) + 'deg)';
    if (h.ry) t += ' rotateY(' + v.ry.toFixed(2) + 'deg)';
    if (h.r) t += ' rotate(' + v.r.toFixed(2) + 'deg)';
    if (h.sk) t += ' skewX(' + v.sk.toFixed(2) + 'deg)';
    if (h.s) t += ' scale(' + v.s.toFixed(3) + ')';
    if (h.sx || h.sy) t += ' scale(' + (h.sx ? v.sx : 1).toFixed(3) + ',' + (h.sy ? v.sy : 1).toFixed(3) + ')';
    if (t !== a.lastT) { el.style.transform = t; a.lastT = t; }
    if (h.o) {
      var o = clamp(v.o, 0, 1), os = o.toFixed(3);
      if (os !== a.lastO) { el.style.opacity = os; el.style.visibility = o < .01 ? 'hidden' : 'visible'; a.lastO = os; }
    }
    for (j = 0; j < pk.props.length; j++) { nm = pk.props[j]; if (!CORE[nm]) { var s = v[nm].toFixed(4); if (a.vars[nm] !== s) { el.style.setProperty('--' + nm, s); a.vars[nm] = s; } } }
  }

  /* ---------- fly-through worlds ---------- */
  function World(el) {
    var me = this; this.el = el; this.cam = el.querySelector('.fx-cam') || el;
    this.depth = parseFloat(el.getAttribute('data-depth')) || 6000;
    var rg = (el.getAttribute('data-range') || '0,1').split(','); this.r0 = parseFloat(rg[0]); this.r1 = parseFloat(rg[1]);
    this.path = el.getAttribute('data-path') || 'sway';
    this.items = $$('[data-xyz]', el).map(function (f) {
      var xyz = (f.getAttribute('data-xyz') || '0,0,0').split(',').map(parseFloat);
      return { el: f, x: xyz[0] || 0, y: xyz[1] || 0, z: xyz[2] || 0, r: parseFloat(f.getAttribute('data-r')) || 0, spin: parseFloat(f.getAttribute('data-spin')) || 0, lastT: '', lastV: '' };
    });
    this.lastCam = '';
    // data-step="1050" data-stop="560": the camera pauses at every item (items spaced `step` apart), `stop` px in front of it
    this.step = parseFloat(el.getAttribute('data-step')) || 0; this.stop = parseFloat(el.getAttribute('data-stop')) || 560;
    this.z0 = this.items.length ? this.items[0].z : 0;
  }
  World.prototype.apply = function (sp) {
    var wp = clamp((sp - this.r0) / ((this.r1 - this.r0) || 1), 0, 1), cam = wp * this.depth, i, it, d, o, tf, vis;
    if (this.step && this.items.length > 1) {
      var N = this.items.length, u = wp * (N - 1), i0 = Math.min(N - 2, Math.floor(u)), fr = u - i0;
      cam = this.z0 - this.stop + this.step * (i0 + smooth(clamp((fr - .2) / .6, 0, 1)));
      cam -= 2600 * (1 - smooth(clamp((sp - (this.r0 - .07)) / .07, 0, 1)));   // the first item flies in from far away
    }
    var far = this.far || (this.far = parseFloat(this.el.getAttribute('data-far')) || 3600);
    // the whole world fades in just before its range starts and out just after it ends
    var wv = smooth(clamp((sp - this.r0 + .065) / .05, 0, 1)) * smooth(clamp((this.r1 + .05 - sp) / .05, 0, 1));
    for (i = 0; i < this.items.length; i++) {
      it = this.items[i]; d = it.z - cam;
      o = wv * smooth(clamp((far - d) / (far * .3), 0, 1)) * smooth(clamp((d + 420) / 520, 0, 1));
      vis = o < .01 ? 'hidden' : 'visible';
      if (vis !== it.lastV) { it.el.style.visibility = vis; it.lastV = vis; }
      if (vis === 'hidden') continue;
      tf = 'translate3d(' + it.x + 'vw,' + it.y + 'vh,' + (-d).toFixed(1) + 'px) rotate(' + (it.r + it.spin * wp).toFixed(2) + 'deg)';
      it.el.style.transform = tf; it.el.style.opacity = o.toFixed(3);
    }
    var a = wp * Math.PI * 2, rx = 0, ry = 0, rz = 0, tx = 0;
    if (this.path === 'sway') { ry = Math.sin(a * 1.5) * 5; rx = Math.sin(a * 1.1 + 1) * 3; tx = Math.sin(a * 1.5) * 2; }
    else if (this.path === 'spiral') { rz = wp * 160; ry = Math.sin(a) * 7; rx = Math.cos(a) * 4; }
    else if (this.path === 'dive') { rx = -8 + wp * 16; rz = Math.sin(a * .8) * 6; }
    ry += FX.nx * 4; rx -= FX.ny * 3;
    var cs = 'translate3d(' + tx.toFixed(2) + 'vw,0,0) rotateX(' + rx.toFixed(2) + 'deg) rotateY(' + ry.toFixed(2) + 'deg) rotateZ(' + rz.toFixed(2) + 'deg)';
    if (cs !== this.lastCam) { this.cam.style.transform = cs; this.lastCam = cs; }
  };

  /* ---------- scenes ---------- */
  var scenes = [];
  function Scene(el) {
    var me = this; this.el = el; this.stage = el.querySelector('.fx-stage');
    this.mode = (el.getAttribute('data-scene') === 'view' || !this.stage) ? 'view' : 'pin';
    this.p = -1; this.off = false; this.top = 0; this.h = 1; this.len = 1; this.hooks = [];
    this.actors = $$('[data-k],[data-km]', el).map(function (n) {
      return { el: n, desk: parseK(n.getAttribute('data-k') || n.getAttribute('data-km')), mob: n.hasAttribute('data-km') ? parseK(n.getAttribute('data-km')) : null, lin: n.getAttribute('data-ease') === 'lin', lastT: '', lastO: '', vars: {} };
    });
    this.worlds = $$('[data-fly]', el).map(function (n) { return new World(n); });
    var hs = el.querySelector('[data-hscroll]');
    this.hs = hs ? { el: hs, track: hs.querySelector('.fx-track'), factor: parseFloat(hs.getAttribute('data-hscroll')) || 1, items: $$('.hs-i', hs), dist: 0 } : null;
    this.pointer = el.hasAttribute('data-pointer');
  }
  Scene.prototype.measure = function () {
    if (this.hs && this.hs.track) {
      var sw = this.stage.offsetWidth, sh = this.stage.offsetHeight || FX.vh;
      this.hs.dist = Math.max(0, this.hs.track.scrollWidth - sw);
      this.el.style.height = (this.hs.dist * this.hs.factor + sh) + 'px';
    }
    var r = this.el.getBoundingClientRect();
    this.top = r.top + window.pageYOffset; this.h = this.el.offsetHeight || 1;
    this.vh = this.stage ? (this.stage.offsetHeight || FX.vh) : FX.vh;
    this.len = Math.max(1, this.h - this.vh);
    this.p = -1; this.off = false;
  };
  Scene.prototype.on = function (fn) { this.hooks.push(fn); fn(this.p < 0 ? 0 : this.p, this); return this; };
  Scene.prototype.update = function () {
    var y = FX.y, p, live;
    if (this.mode === 'pin') { p = clamp((y - this.top) / this.len, 0, 1); live = y > this.top - FX.vh * 1.05 && y < this.top + this.h + FX.vh * .05; }
    else { var q = (y + FX.vh - this.top) / (this.h + FX.vh); p = clamp(q, 0, 1); live = q > -.05 && q < 1.05; }
    this.live = live;
    if (!live) { if (this.off) return; this.off = true; } else this.off = false;
    var moved = Math.abs(p - this.p) > 1e-4;
    var i;
    if (live && this.worlds.length) for (i = 0; i < this.worlds.length; i++) this.worlds[i].apply(p);
    if (live && this.pointer) { this.el.style.setProperty('--nx', FX.nx.toFixed(3)); this.el.style.setProperty('--ny', FX.ny.toFixed(3)); }
    if (!moved) return;
    this.p = p; this.el.style.setProperty('--p', p.toFixed(4)); this.el.setAttribute('data-on', live ? '1' : '');
    for (i = 0; i < this.actors.length; i++) applyActor(this.actors[i], p);
    if (!live && this.worlds.length) for (i = 0; i < this.worlds.length; i++) this.worlds[i].apply(p);
    if (this.hs && this.hs.track) {
      var x = -p * this.hs.dist; this.hs.track.style.transform = 'translate3d(' + x.toFixed(1) + 'px,0,0)';
      var sw = this.stage.offsetWidth;
      for (i = 0; i < this.hs.items.length; i++) { var ir = this.hs.items[i]; ir.style.setProperty('--ip', (((ir.offsetLeft + ir.offsetWidth / 2 + x) - sw / 2) / sw).toFixed(3)); }
    }
    for (i = 0; i < this.hooks.length; i++) this.hooks[i](p, this);
    if (!this.ready) { this.ready = true; this.el.setAttribute('data-ready', '1'); }
  };
  FX.scenes = scenes;
  FX.scene = function (sel) { if (!sel) return null; var el = typeof sel === 'string' ? doc.querySelector(sel) : sel; for (var i = 0; i < scenes.length; i++) if (scenes[i].el === el) return scenes[i]; return null; };
  FX.measure = function () {
    FX.vw = window.innerWidth; FX.vh = window.innerHeight; FX.mobile = FX.vw < 700;
    scenes.forEach(function (s) { s.measure(); });
    FX.y = FX.ty = window.pageYOffset;
    marquees.forEach(function (m) { m.measure(); });
  };

  /* ---------- marquee: a ticker that speeds up with scroll ---------- */
  var marquees = [];
  function Marquee(el) {
    this.el = el; this.dir = el.getAttribute('data-dir') === 'r' ? 1 : -1; this.speed = parseFloat(el.getAttribute('data-speed')) || 50; this.x = 0;
    var kids = [].slice.call(el.childNodes);
    this.track = doc.createElement('div'); this.track.className = 'fx-mq-track';
    this.set = doc.createElement('div'); this.set.className = 'fx-mq-set';
    kids.forEach(function (k) { this.set.appendChild(k); }, this);
    this.track.appendChild(this.set); el.appendChild(this.track);
    this.measure();
  }
  Marquee.prototype.measure = function () {
    while (this.track.children.length > 1) this.track.removeChild(this.track.lastChild);
    this.w = this.set.offsetWidth || 1;
    var need = Math.ceil((FX.vw * 2.2) / this.w) + 1;
    for (var i = 0; i < need; i++) this.track.appendChild(this.set.cloneNode(true));
    [].forEach.call(this.track.children, function (c, i) { if (i) c.setAttribute('aria-hidden', 'true'); });
  };
  Marquee.prototype.step = function (dt) {
    var r = this.el.getBoundingClientRect(); if (r.bottom < -50 || r.top > FX.vh + 50) return;
    this.x += this.dir * (this.speed * dt / 1000 + Math.abs(FX.v) * .9);
    if (this.x <= -this.w) this.x += this.w; else if (this.x > 0) this.x -= this.w;
    this.track.style.transform = 'translate3d(' + this.x.toFixed(1) + 'px,0,0) skewX(' + clamp(-FX.v * this.dir * -.35, -12, 12).toFixed(2) + 'deg)';
  };

  /* ---------- misc behaviours ---------- */
  var counters = [], magnets = [], tilts = [], pars = [];
  function initCounters() {
    if (!('IntersectionObserver' in window)) { $$('[data-count]').forEach(function (el) { el.textContent = (el.getAttribute('data-prefix') || '') + el.getAttribute('data-count') + (el.getAttribute('data-suffix') || ''); }); return; }
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (!e.isIntersecting) return; io.unobserve(e.target);
        var el = e.target, to = parseFloat(el.getAttribute('data-count')) || 0, dur = 1800, dec = parseInt(el.getAttribute('data-dec') || '0', 10), t0 = performance.now();
        var pre = el.getAttribute('data-prefix') || '', suf = el.getAttribute('data-suffix') || '';
        (function step(now) { var t = clamp((now - t0) / dur, 0, 1), v = to * (1 - Math.pow(1 - t, 4)); el.textContent = pre + v.toLocaleString('en-IN', { minimumFractionDigits: dec, maximumFractionDigits: dec }) + suf; if (t < 1) requestAnimationFrame(step); })(t0);
      });
    }, { threshold: .4 });
    $$('[data-count]').forEach(function (el) { el.textContent = (el.getAttribute('data-prefix') || '') + '0' + (el.getAttribute('data-suffix') || ''); io.observe(el); });
  }
  function initReveal() {
    var els = $$('[data-reveal]'); if (!els.length) return;
    if (!('IntersectionObserver' in window)) { els.forEach(function (e) { e.classList.add('in'); }); return; }
    var io = new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }); }, { threshold: .18, rootMargin: '0px 0px -6% 0px' });
    els.forEach(function (e) { io.observe(e); });
  }
  function initMagnets() {
    if (!FX.fine) return;
    $$('[data-magnet]').forEach(function (el) { magnets.push({ el: el, s: parseFloat(el.getAttribute('data-magnet')) || .35, x: 0, y: 0 }); });
  }
  function stepMagnets() {
    for (var i = 0; i < magnets.length; i++) {
      var m = magnets[i], r = m.el.getBoundingClientRect(); if (r.bottom < 0 || r.top > FX.vh) continue;
      var cx = r.left + r.width / 2 - m.x, cy = r.top + r.height / 2 - m.y, dx = FX.mx - cx, dy = FX.my - cy, d = Math.hypot(dx, dy), R = Math.max(r.width, r.height) * .9 + 40;
      var tx = d < R ? dx * m.s : 0, ty = d < R ? dy * m.s : 0;
      m.x += (tx - m.x) * .16; m.y += (ty - m.y) * .16;
      if (Math.abs(m.x) > .05 || Math.abs(m.y) > .05 || tx || ty) m.el.style.translate = m.x.toFixed(1) + 'px ' + m.y.toFixed(1) + 'px';
    }
  }
  function initTilt() {
    if (!FX.fine) return;
    $$('[data-tilt]').forEach(function (el) {
      var max = parseFloat(el.getAttribute('data-tilt')) || 10;
      el.addEventListener('pointermove', function (e) { var r = el.getBoundingClientRect(), x = (e.clientX - r.left) / r.width - .5, y = (e.clientY - r.top) / r.height - .5; el.style.setProperty('--tx', (-y * max).toFixed(2) + 'deg'); el.style.setProperty('--ty', (x * max).toFixed(2) + 'deg'); });
      el.addEventListener('pointerleave', function () { el.style.setProperty('--tx', '0deg'); el.style.setProperty('--ty', '0deg'); });
    });
  }
  function initParallax() {
    $$('[data-par]').forEach(function (el) { pars.push({ el: el, f: parseFloat(el.getAttribute('data-par')) || 0, fr: parseFloat(el.getAttribute('data-par-r')) || 0 }); });
  }
  function stepParallax() {
    for (var i = 0; i < pars.length; i++) {
      var o = pars[i], r = o.el.parentNode.getBoundingClientRect(); if (r.bottom < -200 || r.top > FX.vh + 200) continue;
      var c = (r.top + r.height / 2 - FX.vh / 2) / FX.vh;
      o.el.style.translate = '0 ' + (c * o.f * FX.vh).toFixed(1) + 'px'; if (o.fr) o.el.style.rotate = (c * o.fr).toFixed(2) + 'deg';
    }
  }

  /* ---------- boot ---------- */
  function boot() {
    FX.hydrate();
    if (!FX.live) return;
    $$('[data-split]').forEach(splitEl);
    $$('[data-scene]').forEach(function (el) { scenes.push(new Scene(el)); });
    $$('[data-marquee]').forEach(function (el) { marquees.push(new Marquee(el)); });
    initCounters(); initReveal(); initMagnets(); initTilt(); initParallax();
    if ('IntersectionObserver' in window) {
      var dio = new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting) { dio.unobserve(e.target); drawIn(e.target); } }); }, { threshold: .35 });
      $$('[data-draw-in]').forEach(function (el) { dio.observe(el); });
    } else $$('[data-draw-in]').forEach(function (el) { el.style.setProperty('--d', 1); });
    FX.measure();
    FX.tick(function (t, dt) {
      for (var i = 0; i < scenes.length; i++) scenes[i].update();
      for (i = 0; i < marquees.length; i++) marquees[i].step(dt);
      stepMagnets(); stepParallax();
    });
    // split text with data-split but no scene: reveal when in view (scene-driven ones are scrubbed by --t instead)
    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }); }, { threshold: .3 });
      $$('[data-split]').forEach(function (el) { if (!el.closest('[data-scene]')) io.observe(el); else if (!el.hasAttribute('data-k')) io.observe(el); });
    } else $$('[data-split]').forEach(function (el) { el.classList.add('in'); });
    window.addEventListener('resize', (function () { var h; return function () { clearTimeout(h); h = setTimeout(FX.measure, 120); }; })());
    window.addEventListener('load', function () { FX.measure(); });
    if (doc.fonts && doc.fonts.ready) doc.fonts.ready.then(function () { FX.measure(); });
    if ('ResizeObserver' in window) { var ro = new ResizeObserver(function () { clearTimeout(ro.h); ro.h = setTimeout(FX.measure, 80); }); var c = doc.querySelector('.content'); if (c) ro.observe(c); }
    root.classList.add('fx-ready');
    requestAnimationFrame(frame);
  }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot); else boot();
})();
