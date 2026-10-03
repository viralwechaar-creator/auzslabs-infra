/* AUZslab design system: light/dark toggle. Loaded right after ds/auz.css, before first paint (same discipline
   as ds/brand.js), so there is never a flash of the wrong theme. 'system' (the default -- no data-theme attribute)
   means "follow the OS"; 'light'/'dark' force one explicitly via the [data-theme=light]/[data-theme=dark] token
   blocks in ds/auz.css. Remembered per device (this host) in localStorage, same key convention as ds/brand.js. */
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
})();
