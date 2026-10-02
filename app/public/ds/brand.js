/* AUZslab design system: the business colour. Every staff app calls auzBrand(colour) once it knows the business's
   settings colour; the last colour is remembered per business (this host), so apps that do not read settings yet
   (and every app before sign-in) open in the same accent. Dark mode gets the same hue lifted (--brand-dark,
   --brand-dark-text), the way Apple's dark system colours are lighter versions, so deep colours stay readable. */
'use strict';
(function () {
  const KEY = 'auz.brand', DEF = '#800020';
  function hexHsl(hex) {
    const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(String(hex || '').trim()); if (!m) return null;
    const x = m[1].length === 3 ? m[1].replace(/./g, '$&$&') : m[1], [r, g, b] = [0, 2, 4].map((i) => parseInt(x.slice(i, i + 2), 16) / 255);
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
    if (!d) return [0, 0, Math.round(l * 100)];
    const s = d / (1 - Math.abs(2 * l - 1)), hh = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [Math.round((hh * 60 + 360) % 360), Math.round(s * 100), Math.round(l * 100)];
  }
  function auzBrand(c) {
    c = hexHsl(c) ? String(c).trim() : DEF;
    const st = document.documentElement.style, [hu, sa, li] = hexHsl(c), s2 = sa < 8 ? sa : Math.max(sa, 30);
    st.setProperty('--brand', c);
    st.setProperty('--brand-dark', 'hsl(' + hu + ' ' + s2 + '% ' + Math.min(Math.max(li, 36), 52) + '%)');
    st.setProperty('--brand-dark-text', 'hsl(' + hu + ' ' + (sa < 8 ? sa : Math.max(sa, 45)) + '% 74%)');
    try { localStorage[KEY] = c; } catch {}
    const m = document.querySelector('meta[name=theme-color]'); if (m && !matchMedia('(prefers-color-scheme:dark)').matches) m.content = '#f5f4f2';
    return c;
  }
  // from a business settings record: its own colour, else the niche default, else AUZslab wine
  const NICHE = { restaurant: '#800020', cafe: '#800020', salon: '#7a3b6e', retail: '#1f3d6b' };
  const auzBrandFrom = (st) => auzBrand((st && st.col) || NICHE[(st && st.bizType) || 'restaurant'] || DEF);
  // apps that do not sync records (Accounting) read the one settings record they need
  async function auzBrandLoad(sb) {
    try { const { data } = await sb.from('records').select('data').eq('kind', 'settings').eq('id', 'settings').limit(1); if (data && data[0]) auzBrandFrom(data[0].data); } catch {}
  }
  window.hexHsl = window.hexHsl || hexHsl;
  Object.assign(window, { auzBrand, auzBrandFrom, auzBrandLoad });
  let saved = null; try { saved = localStorage[KEY]; } catch {}
  auzBrand(saved || DEF);
})();
