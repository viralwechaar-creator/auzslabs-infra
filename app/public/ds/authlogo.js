/* Sign-in screens of every app show the same AUZslab logo (big PNG) with the app's own name under it.
   Watches for the app's login screen and swaps the small per-app logo for it. Nothing else on the screen changes. */
(function () {
  'use strict';
  var me = document.currentScript, NAME = (me && me.getAttribute('data-app')) || '';
  var css = document.createElement('style');
  css.textContent = '.alg{display:flex;flex-direction:column;align-items:flex-start;gap:6px;margin:0 0 6px}.alg img{height:56px;width:auto;display:block}'
    + '.login-photo .alg{position:relative;z-index:1}.login-photo .alg img{filter:invert(1);height:64px}'
    + '@media(min-width:900px){.alg img{height:64px}.login-photo .alg img{height:78px}}';
  css.textContent += '.alg-site{position:absolute;top:max(14px,env(safe-area-inset-top,0px));right:max(16px,env(safe-area-inset-right,0px));z-index:3;color:#fff;text-decoration:none;font:600 12px/1 Inter,system-ui,sans-serif;padding:10px 14px;border-radius:999px;background:rgba(0,0,0,.42);border:1px solid rgba(255,255,255,.35);backdrop-filter:none}'
    + '@media(max-width:759px){.login-photo .alg img{height:76px}.login-photo-foot{position:fixed!important;left:0;right:0;bottom:calc(92px + env(safe-area-inset-bottom,0px));z-index:46;padding:0 24px}.login-headline{color:#fff!important;font-size:14px!important;max-width:30ch!important}}';
  document.head.appendChild(css);
  var node = function () { var d = document.createElement('div'); d.className = 'alg'; d.setAttribute('data-alg', '1'); var i = document.createElement('img'); i.src = '/logo.png'; i.alt = 'AUZslab'; d.appendChild(i); return d; };
  function apply() {
    var login = document.querySelector('.login'); if (!login) return;
    var photo = login.querySelector('.login-photo');
    if (photo && !photo.querySelector('[data-alg]')) {
      var old = photo.querySelector('.login-photo-logo'); var n = node();
      if (old) old.replaceWith(n); else photo.insertBefore(n, photo.firstChild);
      var a = document.createElement('a'); a.className = 'alg-site'; a.href = 'https://auzslab.in'; a.textContent = 'auzslab.in \u2197'; a.setAttribute('data-alg', '1'); photo.appendChild(a);
    }
    login.querySelectorAll('.card').forEach(function (card) {
      if (card.querySelector('[data-alg]')) return;
      var first = card.firstElementChild;
      if (first && first.tagName === 'IMG') first.replaceWith(node());
      else if (first && !/^(H1|H2|FORM|DIV)$/.test(first.tagName)) card.insertBefore(node(), first);
      else if (first && first.tagName === 'DIV' && /AUZs/.test(first.textContent) && first.textContent.length < 20) first.replaceWith(node());
      else card.insertBefore(node(), card.firstChild);
    });
  }
  new MutationObserver(function () { apply(); }).observe(document.documentElement, { childList: true, subtree: true });
  apply();
})();
