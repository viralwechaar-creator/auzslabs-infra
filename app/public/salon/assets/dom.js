/* Shared helpers. Elements are built with textContent only, so user-entered text can never inject HTML. */
window.$ = (s, el = document) => el.querySelector(s);
window.$$ = (s, el = document) => [...el.querySelectorAll(s)];

window.h = function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'value') el.value = v;
    else if (k === 'checked') el.checked = !!v;
    else if (k === 'disabled') el.disabled = !!v;
    else if (k === 'selected') el.selected = !!v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
};

window.icon = function icon(id, cls) {
  const NS = 'http://www.w3.org/2000/svg';
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('class', cls || 'ico');
  s.setAttribute('aria-hidden', 'true');
  s.setAttribute('focusable', 'false');
  const u = document.createElementNS(NS, 'use');
  u.setAttribute('href', '/salon/assets/doodles.svg#' + id);
  s.append(u);
  return s;
};

window.doodle = (id, cls) => icon(id, 'doodle ' + (cls || ''));

window.inr = n => { const v = Number(n || 0); return (v < 0 ? '-\u20B9' : '\u20B9') + Math.abs(v).toLocaleString('en-IN', { maximumFractionDigits: 2 }); };

window.fmt12 = t => {
  const [H, M] = t.split(':').map(Number);
  return ((H % 12) || 12) + ':' + String(M).padStart(2, '0') + ' ' + (H < 12 ? 'am' : 'pm');
};

window.fmtDate = (d, opts) => new Date(d + 'T00:00:00').toLocaleDateString('en-IN', opts || { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

window.DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

window.waLink = (phone, text) => {
  let d = String(phone || '').replace(/\D/g, '');
  if (d.length === 10) d = '91' + d;
  return 'https://wa.me/' + d + '?text=' + encodeURIComponent(text);
};

/* Resize an image file in the browser before upload (keeps uploads small and the
   site fast to load — everything here is shown at a few hundred px, never full-res). */
window.readImage = (file, max = 1100, png = false) => new Promise((resolve, reject) => {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return reject(new Error('Choose a JPG, PNG or WebP image.'));
  const url = URL.createObjectURL(file), img = new Image();
  img.onload = () => {
    const k = Math.min(1, max / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    URL.revokeObjectURL(url);
    resolve(png ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.8)); /* logos stay PNG so transparency survives */
  };
  img.onerror = () => reject(new Error('That image could not be read.'));
  img.src = url;
});

/* replaceChildren would print the word "null" for null/false children; skip them instead. */
(function () {
  const rc = Element.prototype.replaceChildren;
  Element.prototype.replaceChildren = function (...kids) {
    return rc.apply(this, kids.flat(Infinity).filter(k => k != null && k !== false));
  };
})();

/* Per-salon branding. Every page calls this once it has the salon's settings:
   `theme` recolours the shared CSS tokens, `logo` / `logoLight` replace the
   bundled Showoff Salon marks (dark-on-light / light-on-dark). Nothing set =
   the original look, unchanged. Values come from the owner's admin console, so
   they are validated before touching CSS or an img src. */
window.applyBrand = function applyBrand(S) {
  S = S || {};
  const root = document.documentElement.style, t = S.theme || {};
  const colour = v => /^#[0-9a-fA-F]{6}$/.test(v || '') ? v : null;
  const map = { plum: '--plum', cream: '--cream', gold: '--gold', goldD: '--gold-d', taupe: '--taupe', tint: '--tint' };
  for (const [k, cssVar] of Object.entries(map)) { const c = colour(t[k]); if (c) root.setProperty(cssVar, c); }
  if (colour(t.plum)) { const m = document.querySelector('meta[name="theme-color"]'); if (m) m.setAttribute('content', t.plum); }
  const safeSrc = v => typeof v === 'string' && /^(\/uploads\/|\/salon\/assets\/)[\w./-]+$/.test(v) ? v : null;
  const dark = safeSrc(S.logo), light = safeSrc(S.logoLight);
  if (dark) document.querySelectorAll('img[src$="logo-plum.png"]').forEach(i => { i.src = dark; });
  if (light || dark) document.querySelectorAll('img[src$="logo-cream.png"]').forEach(i => {
    i.src = light || dark;
    if (!light) i.style.filter = 'brightness(0) invert(1)'; /* a single-colour dark logo, turned light for the dark footer */
  });
  if (S.salonName) document.querySelectorAll('img[src$="logo-cream.png"], img[data-brand-alt]').forEach(i => { i.alt = S.salonName; });
};
