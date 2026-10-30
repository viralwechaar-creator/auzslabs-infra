/* AUZsStyle: keyboard shortcuts for a PC with a keyboard (and a hardware scanner). Press ? to see them all.
   Plain letters only work when you are not typing in a box and no sheet is open; F-keys and Ctrl+Enter always work.
   Keys that arrive faster than a person can type (a barcode scanner) are ignored, so scanning never triggers a shortcut. */
'use strict';
(function () {
  const GO = { s: ['sell', 'Sell'], t: ['stock', 'Stock'], b: ['bills', 'Bills'], o: ['home', 'Overview'], a: ['analytics', 'Analytics'], u: ['buy', 'Buy'], p: ['people', 'People'], r: ['requests', 'Requests'], w: ['store', 'Online store'], i: ['intel', 'Buying intelligence'], e: ['settings', 'Settings'] };
  const typing = (e) => { const x = e.target; return !!x && (/^(INPUT|TEXTAREA|SELECT)$/.test(x.tagName) || x.isContentEditable); };
  const sheetOpen = () => !!document.querySelector('.sheet');
  const click = (el) => { if (el && !el.disabled) { el.click(); return true; } return false; };
  const byText = (re, root) => [...(root || document).querySelectorAll('button')].find((b) => re.test(b.textContent.trim()) && b.offsetParent !== null);
  const focusSearch = () => { const i = document.querySelector('.sell-l input[type=search], .page input[type=search], input[type=search]'); if (i) { i.focus(); i.select && i.select(); return true; } return false; };
  const onSell = () => /^#\/sell/.test(location.hash) || location.hash === '' || location.hash === '#/';
  let last = 0, gAt = 0;

  function help() {
    if (sheetOpen() && document.querySelector('.kb-help')) return;
    const row = (k, d) => h('div', { class: 'kv' }, h('span', null, d), h('b', { class: 'num' }, k));
    sheet({ title: t('Keyboard shortcuts'), closeLabel: t('Done'), body: h('div', { class: 'grid kb-help' },
      h('div', { class: 'cap' }, t('Anywhere')), row('?', t('Show this list')), row('/  or  F2', t('Search or scan box')),
      row('G then ' + Object.keys(GO).map((k) => k.toUpperCase()).join(' '), t('Go to a page') + ': ' + Object.values(GO).map((v) => t(v[1])).join(', ')),
      h('div', { class: 'cap' }, t('Sell')), row('F8  or  P', t('Pay')), row('F4  or  H', t('Hold the bill')), row('D', t('Discount')), row('C', t('Customer name')),
      h('div', { class: 'cap' }, t('Payment window')), row('Ctrl + Enter  or  F8', t('Complete the sale')), row('Esc', t('Close the window')),
      h('div', { class: 'cap' }, t('Stock')), row('N', t('New style')),
      h('div', { class: 'hint' }, t('Letter keys only work when you are not typing in a box.'))) });
  }
  window.styShortcuts = help;

  document.addEventListener('keydown', (e) => {
    const now = Date.now(), gap = now - last; last = now;
    if (e.ctrlKey && e.key === 'Enter') { const ok = document.querySelector('.sheet .sheet-f .btn.fill'); if (ok && /complete sale/i.test(ok.textContent)) { e.preventDefault(); click(ok); } return; }
    if (e.key === 'F2') { if (!sheetOpen() && focusSearch()) e.preventDefault(); return; }
    if (e.key === 'F8') {
      const ok = document.querySelector('.sheet .sheet-f .btn.fill');
      if (ok && /complete sale/i.test(ok.textContent)) { e.preventDefault(); click(ok); return; }
      if (!sheetOpen() && onSell()) { e.preventDefault(); click(document.querySelector('.payrow .btn.fill')); }
      return;
    }
    if (e.key === 'F4') { if (!sheetOpen() && onSell()) { e.preventDefault(); click(document.querySelector('.payrow .btn:not(.fill)')); } return; }
    if (e.ctrlKey || e.metaKey || e.altKey || typing(e) || sheetOpen()) return;
    if (gap < 45 && e.key.length === 1) return;       // a barcode scanner types much faster than a person
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (e.key === '?') { e.preventDefault(); help(); return; }
    if (now - gAt < 1500 && GO[k]) { e.preventDefault(); gAt = 0; go(GO[k][0]); return; }
    gAt = 0;
    if (k === 'g') { gAt = now; return; }
    if (k === '/') { if (focusSearch()) e.preventDefault(); return; }
    if (onSell()) {
      if (k === 'p') { e.preventDefault(); click(document.querySelector('.payrow .btn.fill')); }
      else if (k === 'h') { e.preventDefault(); click(document.querySelector('.payrow .btn:not(.fill)')); }
      else if (k === 'd') { e.preventDefault(); click(document.querySelector('.tots .btn.wide')); }
      else if (k === 'c') { const i = document.querySelector('.cin'); if (i) { e.preventDefault(); i.focus(); } }
    } else if (/^#\/stock/.test(location.hash) && k === 'n') { e.preventDefault(); click(byText(/^new style$/i)); }
  });

  // one gentle hint the first time on a PC
  try {
    if (matchMedia('(pointer:fine)').matches && !localStorage.getItem('sty.kbHint')) {
      setTimeout(() => { try { if (typeof toast === 'function') { toast(t('Tip: press ? to see keyboard shortcuts')); localStorage.setItem('sty.kbHint', '1'); } } catch (e) { /* ignore */ } }, 6000);
    }
  } catch (e) { /* ignore */ }
})();
