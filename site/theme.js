/* AUZslab marketing site: light/dark toggle. Loaded in <head>, before first paint, so there is never a
   flash of the wrong theme. 'system' (the default -- no data-theme attribute) means "follow the OS";
   'light'/'dark' force one explicitly via the [data-theme=light]/[data-theme=dark] token blocks in
   theme.css / kept/theme.css / tool/theme.*.css / design-system/ui-kit.css. Remembered per device in
   localStorage. Same API as app/public/ds/theme.js, kept separate since the marketing site and the
   product apps are served from different origins and never share a build step. */
'use strict';
(function () {
  const KEY = 'auz.theme';
  function apply(mode) {
    if (mode === 'light' || mode === 'dark') document.documentElement.setAttribute('data-theme', mode);
    else document.documentElement.removeAttribute('data-theme');
  }
  function auzThemeGet() {
    try { const v = localStorage[KEY]; return v === 'light' || v === 'dark' ? v : 'system'; } catch { return 'system'; }
  }
  function auzTheme(mode) {
    mode = mode === 'light' || mode === 'dark' ? mode : 'system';
    try { localStorage[KEY] = mode; } catch {}
    apply(mode);
    return mode;
  }
  function auzThemeToggle() {
    const cur = auzThemeGet();
    const curDark = cur === 'dark' || (cur === 'system' && matchMedia('(prefers-color-scheme:dark)').matches);
    return auzTheme(curDark ? 'light' : 'dark');
  }
  Object.assign(window, { auzTheme, auzThemeGet, auzThemeToggle });
  apply(auzThemeGet());

  // Wires any [data-theme-opt="system|light|dark"] buttons and any [data-theme-toggle] on/off
  // switches (the header control) -- no per-page script needed.
  function syncUI() {
    const cur = auzThemeGet();
    const dark = cur === 'dark' || (cur === 'system' && matchMedia('(prefers-color-scheme:dark)').matches);
    document.querySelectorAll('[data-theme-opt]').forEach((b) => b.setAttribute('aria-selected', String(b.getAttribute('data-theme-opt') === cur)));
    document.querySelectorAll('[data-theme-toggle]').forEach((b) => b.setAttribute('aria-checked', String(dark)));
  }
  document.addEventListener('click', (e) => {
    const opt = e.target.closest('[data-theme-opt]');
    if (opt) { auzTheme(opt.getAttribute('data-theme-opt')); syncUI(); return; }
    const toggle = e.target.closest('[data-theme-toggle]');
    if (toggle) { auzThemeToggle(); syncUI(); }
  });
  document.addEventListener('DOMContentLoaded', syncUI);
})();
