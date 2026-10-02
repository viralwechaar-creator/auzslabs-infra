/* AUZslab design system: while a sheet, dialog, menu or scrim is open the page behind it must not scroll. Pure CSS
   (overscroll-behavior) is not enough on iOS, so the body is pinned in place and its scroll position restored on close. */
'use strict';
(function () {
  const OPEN = '.ov:not(#ov), #ov.show, .scrim, .sheet, .alert, .mwrap, .drawer-ov.show';
  let y = 0, on = false;
  function sync() {
    const open = !!document.querySelector(OPEN);
    if (open === on || !document.body) return; on = open;
    const de = document.documentElement, b = document.body;
    if (open) { y = window.scrollY || de.scrollTop || 0; b.style.top = -y + 'px'; de.classList.add('auz-lock'); }
    else { de.classList.remove('auz-lock'); b.style.top = ''; window.scrollTo(0, y); }
  }
  let t = 0;
  const kick = () => { if (!t) t = requestAnimationFrame(() => { t = 0; sync(); }); };
  new MutationObserver(kick).observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('DOMContentLoaded', kick);
})();
