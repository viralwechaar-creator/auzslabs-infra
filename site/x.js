/* AUZslab marketing makeover: one small script, one signature interaction per page. Plain JS, no libraries. */
(function () {
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  document.documentElement.classList.add('mk-on');

  /* reveal on scroll */
  var rv = $$('.rv');
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }); }, { threshold: .12, rootMargin: '0px 0px -6% 0px' });
    rv.forEach(function (el, i) { el.style.setProperty('--d', (i % 4) * .06 + 's'); io.observe(el); });
  } else rv.forEach(function (el) { el.classList.add('in'); });

  /* segmented control helper: buttons with data-v, moves the black pill under the active one */
  function seg(box, on) {
    var btns = $$('button', box);
    function mark(b) { box.style.setProperty('--x', b.offsetLeft - 4 + 'px'); box.style.setProperty('--w', b.offsetWidth + 'px'); btns.forEach(function (x) { x.classList.toggle('on', x === b); }); }
    btns.forEach(function (b) { b.addEventListener('click', function () { mark(b); on(b.getAttribute('data-v')); }); });
    var first = btns.filter(function (b) { return b.classList.contains('on'); })[0] || btns[0];
    setTimeout(function () { mark(btns.filter(function (b) { return b.classList.contains('on'); })[0] || first); }, 30); window.addEventListener('resize', function () { var c = btns.filter(function (b) { return b.classList.contains('on'); })[0]; if (c) mark(c); });
    return { set: function (v) { var b = btns.filter(function (x) { return x.getAttribute('data-v') === v; })[0]; if (b) { mark(b); on(v); } } };
  }

  /* ---------- PRODUCTS: scroll-spy index ---------- */
  var idx = $('.pr-idx');
  if (idx && 'IntersectionObserver' in window) {
    var links = $$('a', idx), map = {};
    links.forEach(function (a) { map[a.getAttribute('href').slice(1)] = a; });
    var so = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { links.forEach(function (a) { a.classList.remove('on'); }); var a = map[e.target.id]; if (a) { a.classList.add('on'); if (window.innerWidth < 900) idx.scrollTo({ left: a.offsetLeft - 40, behavior: 'smooth' }); } } });
    }, { rootMargin: '-35% 0px -55% 0px' });
    $$('.pc').forEach(function (p) { so.observe(p); });
  }

  /* ---------- WHY: the bending screen ---------- */
  var wy = $('.wy-screen');
  if (wy) {
    var note = $('.wy-note'), swap = $$('[data-r]', wy);
    var texts = { r: note.getAttribute('data-r'), y: note.getAttribute('data-y') };
    seg($('.wy-seg'), function (m) {
      wy.classList.add('wy-fade'); note.classList.add('wy-fade');
      setTimeout(function () {
        wy.setAttribute('data-m', m);
        swap.forEach(function (el) { el.textContent = el.getAttribute('data-' + m); });
        note.textContent = texts[m];
        wy.classList.remove('wy-fade'); note.classList.remove('wy-fade');
      }, 220);
    });
  }
  /* ecosystem map */
  var eco = $('.eco-map');
  if (eco) {
    var nodes = $$('.eco-n', eco), lines = $$('line', eco), cap = $('.eco-cap');
    function show(n) {
      nodes.forEach(function (x, i) { var on = x === n; x.classList.toggle('on', on); if (lines[i]) lines[i].classList.toggle('on', on); });
      cap.innerHTML = ''; var b = document.createElement('b'), s = document.createElement('span');
      b.textContent = n.getAttribute('data-t'); s.textContent = n.getAttribute('data-d'); cap.appendChild(b); cap.appendChild(s);
    }
    nodes.forEach(function (n) { n.addEventListener('mouseenter', function () { show(n); }); n.addEventListener('focus', function () { show(n); }); n.addEventListener('click', function () { show(n); }); });
    var k = 0; var auto = setInterval(function () { if (document.hidden) return; show(nodes[k++ % nodes.length]); }, 2600);
    eco.addEventListener('pointerenter', function () { clearInterval(auto); });
    show(nodes[0]);
  }

  /* ---------- LIVE DEMO: picker is now built entirely by a4.js (editorial card layout) ---------- */

  /* ---------- DOWNLOAD: device switch ---------- */
  var dl = $('.dl-seg');
  if (dl) {
    var ua = navigator.userAgent, first = 'pc';
    var panels = $$('.dl-panel');
    var s = seg(dl, function (v) { panels.forEach(function (p) { p.classList.toggle('on', p.getAttribute('data-p') === v); }); });
    s.set(first);
    /* plan first: Base / Pro / Cloud decide which apps and steps are shown for each device */
    var flow = $('.adl-flow'), pb = $$('.dl-plans button');
    if (flow && pb.length) {
      var pick = function (v) { flow.setAttribute('data-plan', v); pb.forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-plan') === v); }); if (v) { try { history.replaceState(null, '', '#' + v); } catch (e) {} s.set(first); } };
      pb.forEach(function (b) { b.addEventListener('click', function () { pick(b.getAttribute('data-plan')); }); });
      var h0 = location.hash.slice(1); if (/^(base|pro|cloud)$/.test(h0)) pick(h0);
    }
  }

  /* ---------- CONTACT: one question at a time ---------- */
  var ct = $('.ct-form');
  if (ct) {
    var form = $('form', ct), qs = $$('.ct-q', form), at = 0, prog = $('.ct-prog', ct), done = $('.ct-done', ct);
    var niche = $('[name=niche]', form);
    function go(n) {
      at = Math.max(0, Math.min(qs.length - 1, n));
      qs.forEach(function (q, i) { q.classList.toggle('on', i === at); });
      prog.style.setProperty('--p', ((at + 1) / qs.length * 100) + '%');
      var back = $('.back', form), nx = $('.go', form);
      back.style.visibility = at ? 'visible' : 'hidden'; nx.textContent = at === qs.length - 1 ? 'Send' : 'Next';
      var f = $('input,textarea', qs[at]); if (f && window.innerWidth > 700) setTimeout(function () { f.focus(); }, 60);
    }
    function ok() { var f = $('[required]', qs[at]); return !f || f.value.trim().length > 0; }
    $('.go', form).addEventListener('click', function (e) {
      if (at === qs.length - 1) return; /* last step submits the form */
      e.preventDefault(); if (!ok()) { $('[required]', qs[at]).focus(); return; } go(at + 1);
    });
    $('.back', form).addEventListener('click', function (e) { e.preventDefault(); go(at - 1); });
    form.addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') { e.preventDefault(); $('.go', form).click(); } });
    $$('.ct-chips button', form).forEach(function (b) { b.addEventListener('click', function (e) { e.preventDefault(); $$('.ct-chips button', form).forEach(function (x) { x.classList.remove('on'); }); b.classList.add('on'); niche.value = b.getAttribute('data-v'); }); });
    new MutationObserver(function () { if (form.style.display === 'none') { $('.ct-prog', ct).style.display = 'none'; } }).observe(form, { attributes: true, attributeFilter: ['style'] });
    go(0);
  }

  /* ---------- STUDIO: sticky canvas follows the story ---------- */
  var cv = $('.st-canvas');
  if (cv && 'IntersectionObserver' in window) {
    var steps = $$('.st-step');
    var so2 = new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting) { steps.forEach(function (s) { s.classList.toggle('on', s === e.target); }); cv.setAttribute('data-s', e.target.getAttribute('data-s')); } }); }, { rootMargin: '-40% 0px -45% 0px' });
    steps.forEach(function (s) { so2.observe(s); });
  }
})();
