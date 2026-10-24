/* "Modern" look switch, shared by every staff app. One choice per device (localStorage 'ui.modern' = '1').
   Loaded in <head> before paint so there is no flash. CSS lives in /ds/modern.css (every rule under html.ui-modern). */
(function () {
  var KEY = 'ui.modern', root = document.documentElement;
  function on() { try { return localStorage[KEY] === '1' || localStorage['pos.ui'] === 'modern'; } catch (e) { return false; } }
  function set(v) {
    try { localStorage[KEY] = v ? '1' : '0'; if (!v) localStorage['pos.ui'] = 'classic'; } catch (e) {}
    root.classList.toggle('ui-modern', !!v);
  }
  if (on()) root.classList.add('ui-modern');
  window.auzModern = { on: on, set: set };
  // a ready-made Classic / Modern segmented control built with the calling app's own seg() helper
  window.auzModernSeg = function (seg) { return seg([['classic', 'Classic'], ['modern', 'Modern']], on() ? 'modern' : 'classic', function (v) { set(v === 'modern'); }); };
})();
