/* AUZslab public site: footer fold and tabs. The menu sheet, contact sheet and theme toggle are handled by site.js and theme.js. */
(function () {
  function init() {
    var w = document.getElementById('ftwrap'); if (!w) return;
    var t = w.querySelector('.ftt');
    t.addEventListener('click', function () { var o = w.classList.toggle('open'); t.setAttribute('aria-expanded', String(o)); t.querySelector('.pl').textContent = o ? '–' : '+'; });
    var f = document.getElementById('ftfold'), m = document.getElementById('ftmore');
    if (m) m.addEventListener('click', function () { var o = f.classList.toggle('open'); m.textContent = o ? 'Read less' : 'Read more...'; });
    var pn = document.getElementById('ftpanel'), tabs = []; try { tabs = JSON.parse(pn.getAttribute('data-tabs')); } catch (e) {}
    var btns = w.querySelectorAll('.ftab');
    btns.forEach(function (b, i) { b.addEventListener('click', function () { var on = b.classList.contains('on'); btns.forEach(function (x) { x.classList.remove('on'); }); pn.innerHTML = ''; if (on) return; b.classList.add('on'); tabs[i].forEach(function (l) { var a = document.createElement('a'); a.href = l[0]; a.textContent = l[1]; pn.appendChild(a); }); }); });
  }
  if (document.readyState !== 'loading') init(); else document.addEventListener('DOMContentLoaded', init);
})();
