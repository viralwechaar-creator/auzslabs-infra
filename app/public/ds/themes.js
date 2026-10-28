/* AUZslab colour themes: Calm (default), Focus, Warm, Elegant, Minimal. Loaded in <head> before first paint (like ds/theme.js).
   Opt-in per page: pages that load this file get the theme; everything else is untouched. The choice is remembered per device
   (localStorage 'auz.ctheme', same convention as ds/theme.js and ds/brand.js), so it survives refresh, sign-out and sign-in.
   Light/dark is separate (ds/theme.js): dark mode keeps its own colours. The tokens live in ds/themes.css. */
'use strict';
(function () {
  const KEY = 'auz.ctheme', DEF = 'calm';
  const THEMES = {
 "calm": {
  "name": "Calm",
  "sub": "Sage Green",
  "desc": "Natural, calm and balanced",
  "primary": "#A3BFA8",
  "soft": "#E5EDE5",
  "bg": "#F7F8F5",
  "surface": "#FFFFFF"
 },
 "focus": {
  "name": "Focus",
  "sub": "Misty Blue",
  "desc": "Peaceful, clean and focused",
  "primary": "#A8C4DC",
  "soft": "#DCE8F2",
  "bg": "#F5F8FC",
  "surface": "#FFFFFF"
 },
 "warm": {
  "name": "Warm",
  "sub": "Warm Sand",
  "desc": "Warm, welcoming and elegant",
  "primary": "#D8BFA0",
  "soft": "#F1E6D6",
  "bg": "#FAF6F0",
  "surface": "#FFFFFF"
 },
 "elegant": {
  "name": "Elegant",
  "sub": "Soft Lavender",
  "desc": "Gentle, modern and sophisticated",
  "primary": "#B9A5C9",
  "soft": "#E8E0F0",
  "bg": "#F8F5FA",
  "surface": "#FFFFFF"
 },
 "minimal": {
  "name": "Minimal",
  "sub": "Dusty Grey",
  "desc": "Clean, neutral and distraction-free",
  "primary": "#AAB2B9",
  "soft": "#E6E9EC",
  "bg": "#F6F7F8",
  "surface": "#FFFFFF"
 }
};
  const ids = Object.keys(THEMES);
  function get() { try { const v = localStorage[KEY]; return THEMES[v] ? v : DEF; } catch { return DEF; } }
  function apply(id) { document.documentElement.setAttribute('data-ctheme', THEMES[id] ? id : DEF); }
  function set(id) { if (!THEMES[id]) id = DEF; try { localStorage[KEY] = id; } catch {} apply(id); document.dispatchEvent(new CustomEvent('auz:ctheme', { detail: id })); return id; }
  // theme cards for a Settings / More screen (plain DOM, text only)
  function cards() {
    const wrap = document.createElement('div'); wrap.className = 'ctheme-grid'; wrap.setAttribute('role', 'group'); wrap.setAttribute('aria-label', 'Colour theme');
    const paint = () => { const cur = get(); wrap.querySelectorAll('.ctheme').forEach((b) => { const on = b.dataset.id === cur; b.setAttribute('aria-pressed', String(on)); b.querySelector('.on').textContent = on ? 'Selected' : ''; }); };
    ids.forEach((id) => {
      const t = THEMES[id], b = document.createElement('button'); b.type = 'button'; b.className = 'ctheme'; b.dataset.id = id;
      const sw = document.createElement('div'); sw.className = 'sw';
      [t.bg, t.surface, t.primary].forEach((c) => { const i = document.createElement('i'); i.style.background = c; sw.append(i); });
      const n = document.createElement('b'); n.textContent = t.name + ' · ' + t.sub;
      const d = document.createElement('span'); d.className = 'd'; d.textContent = t.desc;
      const on = document.createElement('span'); on.className = 'on';
      b.append(sw, n, d, on); b.onclick = () => { set(id); paint(); }; wrap.append(b);
    });
    paint(); return wrap;
  }
  // AUZsScan shares the Ledger files but is not part of this rollout yet
  if (!window.AUZ_SCAN && !/\/scan\.html$/.test(location.pathname)) apply(get());
  Object.assign(window, { auzCTheme: { get, set, cards, THEMES } });
})();
