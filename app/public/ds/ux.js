/* Shared UX layer for every staff app (look only, no business logic):
   - skeleton loaders: a lone "Loading..." line becomes shimmering placeholder bars until the app replaces it
   - empty states: a lone "No ... yet" / "Nothing ..." line becomes a soft card
   - inline form hints: required / email / phone fields show a small message after the person leaves the field (never blocks saving)
   - auzDebounce(fn, ms) and auzThrottle(fn, ms) helpers for search boxes and scroll handlers */
(function () {
  if (window.auzUx) return;
  var LOAD = /^(loading|please wait|fetching|checking|working)(\s*\.{0,3}|\s*…)?$/i;
  var EMPTY = /^(no (\w+ ){0,3}(yet|found|here|available|results?|entries|records|items|data)|nothing( \w+){0,5}|no .{2,40} (yet|found)|nobody .{0,30}|empty)[.!]?$/i;

  window.auzDebounce = function (fn, ms) { var t; return function () { var a = arguments, c = this; clearTimeout(t); t = setTimeout(function () { fn.apply(c, a); }, ms == null ? 250 : ms); }; };
  window.auzThrottle = function (fn, ms) { var last = 0, t; return function () { var a = arguments, c = this, now = Date.now(), wait = (ms == null ? 200 : ms) - (now - last); clearTimeout(t); if (wait <= 0) { last = now; fn.apply(c, a); } else t = setTimeout(function () { last = Date.now(); fn.apply(c, a); }, wait); }; };

  function ownText(e) { var s = ''; for (var n = e.firstChild; n; n = n.nextSibling) { if (n.nodeType === 3) s += n.nodeValue; else if (n.nodeType === 1 && !/^(svg|span|i)$/i.test(n.tagName)) return null; else if (n.nodeType === 1) s += n.textContent; } return s.replace(/\s+/g, ' ').trim(); }
  function candidate(e) {
    if (!e || e.nodeType !== 1 || e.children.length > 2) return null;
    if (/^(button|a|input|textarea|select|option|label|script|style|h1|h2|h3|h4|th|td|li|summary|title)$/i.test(e.tagName)) return null;
    if (e.closest('button,a,input,select,textarea,[contenteditable],.ux-no,nav,.tabbar,.side,header')) return null;
    var t = ownText(e); if (!t || t.length > 60) return null;
    return t;
  }
  function mark(e) {
    var t = candidate(e); if (t == null) { unmark(e); return; }
    if (LOAD.test(t)) { if (!e.classList.contains('ux-sk')) { e.classList.add('ux-sk'); e.classList.remove('ux-empty'); e.setAttribute('aria-busy', 'true'); } }
    else if (EMPTY.test(t) && e.offsetParent !== null && e.getBoundingClientRect().width > 140) { if (!e.classList.contains('ux-empty')) { e.classList.add('ux-empty'); e.classList.remove('ux-sk'); e.removeAttribute('aria-busy'); } }
    else unmark(e);
  }
  function unmark(e) { if (e.classList && (e.classList.contains('ux-sk') || e.classList.contains('ux-empty'))) { e.classList.remove('ux-sk', 'ux-empty'); e.removeAttribute('aria-busy'); } }
  function scan(root) {
    if (!root || root.nodeType !== 1) return;
    mark(root);
    var els = root.querySelectorAll('div,p,span'), n = Math.min(els.length, 400);
    for (var i = 0; i < n; i++) mark(els[i]);
  }
  var q = [], pending = false;
  function flush() { pending = false; var l = q; q = []; for (var i = 0; i < l.length; i++) { var n = l[i]; if (n && n.isConnected) { if (n.nodeType === 3) n = n.parentNode; scan(n); if (n && n.parentNode && n.parentNode.nodeType === 1) mark(n.parentNode); } } }
  function later(n) { q.push(n); if (!pending) { pending = true; (window.requestAnimationFrame || setTimeout)(flush); } }
  function start() {
    scan(document.body);
    new MutationObserver(function (ms) {
      for (var i = 0; i < ms.length; i++) { var m = ms[i]; if (m.type === 'characterData') later(m.target); else for (var j = 0; j < m.addedNodes.length; j++) later(m.addedNodes[j]); if (m.type === 'childList' && m.target.nodeType === 1) later(m.target); }
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  // inline form hints
  function msgFor(f) {
    var v = (f.value || '').trim(), t = (f.type || '').toLowerCase();
    if (f.disabled || f.readOnly || t === 'hidden' || t === 'checkbox' || t === 'radio' || t === 'file' || t === 'button' || t === 'submit') return '';
    if (f.required && !v) return 'This is needed.';
    if (!v) return '';
    if (t === 'email' && !/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(v)) return 'Check the email address.';
    if (t === 'tel' && v.replace(/\D/g, '').length < 10) return 'A phone number has 10 digits.';
    if (t === 'number') { var n = parseFloat(v); if (isNaN(n)) return 'Enter a number.'; if (f.min !== '' && n < parseFloat(f.min)) return 'Cannot be below ' + f.min + '.'; if (f.max !== '' && n > parseFloat(f.max)) return 'Cannot be above ' + f.max + '.'; }
    return '';
  }
  function hint(f) {
    var m = msgFor(f), nx = f.nextElementSibling, has = nx && nx.classList && nx.classList.contains('ux-err');
    if (!m) { f.removeAttribute('aria-invalid'); f.classList.remove('ux-bad'); if (has) nx.remove(); return; }
    f.setAttribute('aria-invalid', 'true'); f.classList.add('ux-bad');
    if (!has) { nx = document.createElement('div'); nx.className = 'ux-err'; nx.setAttribute('role', 'alert'); f.parentNode.insertBefore(nx, f.nextSibling); }
    nx.textContent = m;
  }
  document.addEventListener('focusout', function (e) { var f = e.target; if (f && f.tagName && /^(INPUT|TEXTAREA)$/.test(f.tagName) && f.closest('.sheet,.modal,form,dialog')) { f.dataset.uxTouched = '1'; hint(f); } }, true);
  document.addEventListener('input', function (e) { var f = e.target; if (f && f.dataset && f.dataset.uxTouched) hint(f); }, true);

  window.auzUx = { scan: scan, hint: hint };
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
})();
