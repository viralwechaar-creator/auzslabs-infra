// The dashboard is a fixed-size app: no pinch, double-tap or keyboard/wheel zoom.
(function () {
  var stop = function (e) { e.preventDefault(); };
  ['gesturestart', 'gesturechange', 'gestureend'].forEach(function (n) { document.addEventListener(n, stop, { passive: false }); });
  document.addEventListener('wheel', function (e) { if (e.ctrlKey) e.preventDefault(); }, { passive: false });
  document.addEventListener('keydown', function (e) { if ((e.ctrlKey || e.metaKey) && ['+', '=', '-', '_', '0'].indexOf(e.key) > -1) e.preventDefault(); });
  document.addEventListener('touchmove', function (e) { if (e.touches && e.touches.length > 1 && !(e.target.closest && e.target.closest('canvas'))) e.preventDefault(); }, { passive: false });
  var last = 0;
  document.addEventListener('touchend', function (e) { var n = Date.now(); if (n - last < 350 && !(e.target.closest && e.target.closest('input,textarea,select,canvas'))) e.preventDefault(); last = n; }, { passive: false });
  var st = document.createElement('style'); st.textContent = 'html,body{touch-action:manipulation;-webkit-text-size-adjust:100%}.gl-canvas{touch-action:none}';
  document.head.appendChild(st);
})();
