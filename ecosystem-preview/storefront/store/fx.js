/* Add to bag: a small dot flies from the button to the bag icon, the icon bumps. Nothing else. */
(function () {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const last = { x: innerWidth / 2, y: innerHeight - 80 };
  addEventListener('pointerdown', (e) => { last.x = e.clientX; last.y = e.clientY; }, true);
  function fly() {
    const b = document.querySelector('a.ic[aria-label="Bag"]'); if (!b) return; const r = b.getBoundingClientRect(); if (!r.width) return;
    const d = document.createElement('i'); d.className = 'fxdot'; d.style.left = last.x + 'px'; d.style.top = last.y + 'px'; document.body.append(d);
    const dx = r.left + r.width / 2 - last.x, dy = r.top + r.height / 2 - last.y;
    d.animate([{ transform: 'translate(-50%,-50%) scale(1)', opacity: 1 }, { transform: 'translate(calc(-50% + ' + dx * 0.5 + 'px),calc(-50% + ' + (dy * 0.5 - 70) + 'px)) scale(.9)', offset: 0.5 }, { transform: 'translate(calc(-50% + ' + dx + 'px),calc(-50% + ' + dy + 'px)) scale(.3)', opacity: 0.85 }], { duration: 640, easing: 'cubic-bezier(.5,0,.25,1)' }).onfinish = () => { d.remove(); b.classList.remove('fxbump'); void b.offsetWidth; b.classList.add('fxbump'); };
  }
  new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) if (n.nodeType === 1 && n.classList.contains('toast') && /added to your bag/i.test(n.textContent)) fly(); }).observe(document.body, { childList: true });
})();
