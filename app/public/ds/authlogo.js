/* Sign-in screens of every app show the same AUZslab logo (big PNG) with the app's own name under it.
   Watches for the app's login screen and swaps the small per-app logo for it. Nothing else on the screen changes. */
(function () {
  'use strict';
  var me = document.currentScript, NAME = (me && me.getAttribute('data-app')) || '';
  var css = document.createElement('style');
  css.textContent = '.alg{display:flex;flex-direction:column;align-items:flex-start;gap:6px;margin:0 0 6px}.alg img{height:56px;width:auto;display:block}.alg b{font:600 12px/1 Inter,system-ui,sans-serif;letter-spacing:.14em;text-transform:uppercase;opacity:.75}'
    + '.login-photo .alg{position:relative;z-index:1}.login-photo .alg img{filter:invert(1);height:64px}.login-photo .alg b{color:#fff;opacity:.9}'
    + '@media(min-width:900px){.alg img{height:64px}.login-photo .alg img{height:78px}}';
  document.head.appendChild(css);
  var node = function () { var d = document.createElement('div'); d.className = 'alg'; d.setAttribute('data-alg', '1'); var i = document.createElement('img'); i.src = '/logo.png'; i.alt = 'AUZslab'; var b = document.createElement('b'); b.textContent = NAME; d.appendChild(i); d.appendChild(b); return d; };
  function apply() {
    var login = document.querySelector('.login'); if (!login) return;
    var photo = login.querySelector('.login-photo');
    if (photo && !photo.querySelector('[data-alg]')) {
      var old = photo.querySelector('.login-photo-logo'); var n = node();
      if (old) old.replaceWith(n); else photo.insertBefore(n, photo.firstChild);
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
