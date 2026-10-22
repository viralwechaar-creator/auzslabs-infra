/* Editable marketing content: text [data-ed="key"] and pictures [data-ed-img="key"] come from
   Admin -> Website (table site_content). The page's own words are the fallback. */
(function () {
  var API = (window.CFG && CFG.url) || 'https://api.auzslab.in';
  function img(v) { return /^\/uploads\//.test(v) ? API + v : v; }
  function apply(c) {
    document.querySelectorAll('[data-ed]').forEach(function (el) { var v = c[el.getAttribute('data-ed')]; if (v) el.textContent = v; });
    document.querySelectorAll('[data-ed-img]').forEach(function (el) {
      var v = c[el.getAttribute('data-ed-img')]; if (!v) return;
      var i = el.querySelector('img'); if (!i) { i = document.createElement('img'); i.alt = ''; i.loading = 'lazy'; el.appendChild(i); }
      i.src = img(v); el.classList.add('has');
    });
  }
  try {
    var cached = JSON.parse(sessionStorage.getItem('auz.ed') || 'null'); if (cached) apply(cached);
  } catch (e) {}
  fetch(API + '/rpc/public_site_content', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    .then(function (r) { return r.json(); })
    .then(function (j) { var c = (j && j.result !== undefined) ? j.result : j; if (c && typeof c === 'object') { apply(c); try { sessionStorage.setItem('auz.ed', JSON.stringify(c)); } catch (e) {} } })
    .catch(function () {});
})();
