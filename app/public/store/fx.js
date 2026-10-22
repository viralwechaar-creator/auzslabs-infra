/* Micro-interactions for the store. Nothing here changes what the store does; it only adds small motion. */
(function () {
  const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (RM) return;
  const FINE = matchMedia('(hover: hover) and (pointer: fine)').matches;
  const root = document.documentElement; root.classList.add('fxon');
  const last = { x: innerWidth / 2, y: innerHeight - 80 };
  addEventListener('pointerdown', (e) => { last.x = e.clientX; last.y = e.clientY; }, true);

  // 1. page change: the view fades up
  addEventListener('hashchange', () => { const v = document.getElementById('view'); if (!v) return; v.classList.remove('fxpg'); void v.offsetWidth; v.classList.add('fxpg'); setTimeout(() => v.classList.remove('fxpg'), 400); });

  // 2. scroll reveal for cards, bands and cards on pages + image fade-in
  const io = 'IntersectionObserver' in window ? new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { rootMargin: '0px 0px -5% 0px', threshold: 0.04 }) : null;
  function tag(host) {
    if (io) host.querySelectorAll('.pc,.band,.bigcol,.dk,.sec>.hd,.pg>.card,.empty').forEach((el, i) => { if (el.dataset.fx) return; el.dataset.fx = '1'; el.classList.add('rv'); el.style.setProperty('--d', (i % 6) * 55 + 'ms'); io.observe(el); });
    host.querySelectorAll('img').forEach((im) => { if (!im.dataset.fx && !im.complete) { im.dataset.fx = '1'; im.addEventListener('load', () => im.classList.add('fxld'), { once: true }); } });
  }
  // safety: never leave anything hidden
  setInterval(() => document.querySelectorAll('.rv:not(.in)').forEach((el) => { const r = el.getBoundingClientRect(); if (r.top < innerHeight && r.bottom > 0) el.classList.add('in'); }), 1500);

  // 3. add to bag: a small dot flies to the bag icon, the icon bumps
  function fly() {
    const b = document.querySelector('a.ic[aria-label="Bag"]'); if (!b) return; const r = b.getBoundingClientRect(); if (!r.width) return;
    const d = document.createElement('i'); d.className = 'fxdot'; d.style.left = last.x + 'px'; d.style.top = last.y + 'px'; document.body.append(d);
    const dx = r.left + r.width / 2 - last.x, dy = r.top + r.height / 2 - last.y;
    const a = d.animate([{ transform: 'translate(-50%,-50%) scale(1)', opacity: 1 }, { transform: 'translate(calc(-50% + ' + dx * 0.5 + 'px),calc(-50% + ' + (dy * 0.5 - 70) + 'px)) scale(.9)', offset: 0.5 }, { transform: 'translate(calc(-50% + ' + dx + 'px),calc(-50% + ' + dy + 'px)) scale(.3)', opacity: 0.85 }], { duration: 640, easing: 'cubic-bezier(.5,0,.25,1)' });
    a.onfinish = () => { d.remove(); r && (b.classList.remove('fxbump'), void b.offsetWidth, b.classList.add('fxbump')); };
  }
  // 4. a tiny burst of paper bits when an order is placed
  function burst(x, y) {
    const cols = ['#000', '#800020', '#b8942f', '#9a9794'];
    for (let i = 0; i < 14; i++) {
      const c = document.createElement('i'); c.className = 'fxc'; c.style.left = x + 'px'; c.style.top = y + 'px'; c.style.background = cols[i % cols.length]; document.body.append(c);
      const ang = Math.PI * (1 + Math.random()), dist = 40 + Math.random() * 90, rot = (Math.random() - 0.5) * 540;
      c.animate([{ transform: 'translate(0,0) rotate(0)', opacity: 1 }, { transform: 'translate(' + Math.cos(ang) * dist + 'px,' + (Math.sin(ang) * dist + 70) + 'px) rotate(' + rot + 'deg)', opacity: 0 }], { duration: 750 + Math.random() * 450, easing: 'cubic-bezier(.2,.7,.3,1)' }).onfinish = () => c.remove();
    }
  }
  let thanked = '', tq = 0;
  new MutationObserver((ms) => {
    for (const m of ms) for (const n of m.addedNodes) {
      if (n.nodeType !== 1) continue;
      if (n.classList.contains('toast') && /added to your bag/i.test(n.textContent)) fly();
      const host = document.getElementById('view');
      if (host && (host === n || host.contains(n))) {
        if (!tq) tq = requestAnimationFrame(() => { tq = 0; tag(host); });
        const h = (n.matches && n.matches('h1') ? n : n.querySelector && n.querySelector('h1'));
        if (h && /^Thank you,/.test(h.textContent) && thanked !== location.hash) { thanked = location.hash; const r = h.getBoundingClientRect(); burst(r.left + Math.min(r.width, 200) / 2, r.top + 10); }
      }
    }
  }).observe(document.body, { childList: true, subtree: true });
  tag(document.body);

  // 5. reading line at the top
  const bar = document.createElement('div'); bar.id = 'fxp'; document.body.append(bar);
  let raf = 0; const upd = () => { raf = 0; const h = document.documentElement.scrollHeight - innerHeight; bar.style.transform = 'scaleX(' + (h > 0 ? Math.min(1, scrollY / h) : 0) + ')'; };
  addEventListener('scroll', () => { if (!raf) raf = requestAnimationFrame(upd); }, { passive: true });

  // 6. big buttons lean a little toward the pointer (desktop only)
  if (FINE) {
    let mag = null;
    const release = (b) => { b.style.transition = 'translate .25s ease'; b.style.translate = ''; setTimeout(() => { b.style.transition = ''; }, 260); };
    addEventListener('pointermove', (e) => {
      const b = e.target.closest && e.target.closest('.btn:not(.sm):not(.soft),.btn.wide');
      if (mag && mag !== b) { release(mag); mag = null; }
      if (!b) return; const r = b.getBoundingClientRect();
      b.style.transition = ''; b.style.translate = ((e.clientX - r.left - r.width / 2) / r.width * 7).toFixed(1) + 'px ' + ((e.clientY - r.top - r.height / 2) / r.height * 4).toFixed(1) + 'px'; mag = b;
    }, { passive: true });
  }
})();
