/* AUZsLedger / AUZsScan look: the AUZsStyle look is the default; 'Classic' (localStorage acc.look = 'classic') keeps the earlier one.
   Loaded in <head> before paint. The CSS is /accounts/accounts.fine.css, every rule under html.ui-fine. */
(function () {
  var KEY = 'acc.look', root = document.documentElement;
  function on() { try { return localStorage[KEY] !== 'classic'; } catch (e) { return true; } }
  function set(v) { try { localStorage[KEY] = v ? 'style' : 'classic'; } catch (e) {} root.classList.toggle('ui-fine', !!v); }
  if (on()) root.classList.add('ui-fine');
  window.accLook = { on: on, set: set };
  window.accLookSeg = function (seg) { return seg([['style', 'New'], ['classic', 'Classic']], on() ? 'style' : 'classic', function (v) { set(v === 'style'); }); };
})();
