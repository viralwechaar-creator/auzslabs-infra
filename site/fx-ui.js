/* AUZslab FX UI bits: the pricing "stack builder" (tap modules, they light up and count). */
(function () {
  'use strict';
  var FX = window.FX;
  function boot() {
    [].forEach.call(document.querySelectorAll('[data-builder]'), function (box) {
      var cnt = box.parentNode.querySelector('[data-n]'), n = 0;
      [].forEach.call(box.querySelectorAll('.blk2'), function (b) {
        b.setAttribute('aria-pressed', 'false'); b.type = 'button';
        b.addEventListener('click', function () { var on = b.classList.toggle('on'); b.setAttribute('aria-pressed', on ? 'true' : 'false'); n += on ? 1 : -1; if (cnt) cnt.textContent = n; });
      });
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
