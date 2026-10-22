/* Makes content sections foldable: heading stays, the rest opens on tap. Skips forms, plan tables and anything marked data-nofold. */
(function () {
  var root = document.querySelector('main.content'); if (!root || root.querySelector('.ed-hero, .folds')) return;
  var skip = '#salon-plans,#salon-compare,#salon-addons,#pricing,[data-nofold],form,.sp-grid,table,input,textarea,.stack-panel';
  var secs = root.querySelectorAll('section.section, section.section.tight');
  secs.forEach(function (sec, i) {
    if (i === 0 || sec.querySelector(skip) || sec.matches(skip) || sec.closest('details')) return;
    var h = sec.querySelector('h1,h2,h3,.h-2,.h-1,.label'); if (!h) return;
    var title = h.textContent.replace(/\s+/g, ' ').trim(); if (!title || title.length > 90) return;
    var d = document.createElement('details'); d.className = 'gfold';
    var sm = document.createElement('summary'); sm.textContent = title;
    var body = document.createElement('div'); body.className = 'gb';
    while (sec.firstChild) body.appendChild(sec.firstChild);
    var hh = body.querySelector('h1,h2,h3,.h-2,.h-1'); if (hh && hh.textContent.replace(/\s+/g, ' ').trim() === title) hh.remove();
    d.appendChild(sm); d.appendChild(body); sec.appendChild(d);
  });
})();
