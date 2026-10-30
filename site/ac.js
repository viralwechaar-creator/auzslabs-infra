/* Client account page, new look (see ac.css). Nothing here changes what the page does: tiles press the page's own
   buttons, and cards are only wrapped so they can fold. Safe to remove: the page then works as before. */
(function () {
  'use strict';
  var body = document.body; body.classList.add('ac2');
  var TABS = { account: 'Account', services: 'Services', staff: 'Staff', roles: 'Roles', notifications: 'Notifications', profile: 'Profile', privacy: 'Privacy' };
  var HINT = { account: 'Login and plan', services: 'What is on', staff: 'Who can sign in', roles: 'What they can do', notifications: 'Latest', profile: 'About you', privacy: 'Your data', cart: 'Your request' };
  var userOpened = false, shown = false;
  var arrow = '<span class="ac-ar"><svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg></span>';
  var hashTab = { '#notifications': 'notifications', '#staff': 'staff', '#roles': 'roles', '#profile': 'profile', '#privacy': 'privacy' }[location.hash];
  if (hashTab) userOpened = true;

  function $(s, r) { return (r || document).querySelector(s); }
  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }

  function visible(b) { return b && b.style.display !== 'none' && b.offsetParent !== null || (b && b.style.display === '' && getComputedStyle(b).display !== 'none'); }

  function buildHome() {
    var nav = $('#acctNav'); if (!nav || nav.style.display === 'none') return;
    var host = $('#acHome'), apps = $('#acApps');
    if (!host) {
      host = el('div', 'ac-home'); host.id = 'acHome';
      var bar = el('div', 'ac-bar'); bar.id = 'acBar';
      bar.innerHTML = '<button type="button" class="ac-back" id="acBack"><svg viewBox="0 0 24 24"><path d="M19 12H5M11 6l-6 6 6 6"/></svg>Overview</button><span class="ac-cur" id="acCur"></span>';
      apps = el('div', 'ac-apps'); apps.id = 'acApps';
      nav.parentNode.insertBefore(bar, nav); nav.parentNode.insertBefore(host, nav); nav.parentNode.insertBefore(apps, nav);
      $('#acBack').onclick = function () { userOpened = false; body.classList.remove('ac-in'); window.scrollTo({ top: 0 }); };
    }
    host.innerHTML = ''; apps.innerHTML = '';
    var i = 0;
    nav.querySelectorAll('.acct-nav-btn').forEach(function (b) {
      var cs = getComputedStyle(b); if (b.style.display === 'none' || cs.display === 'none') return;
      var tab = b.dataset.tab; var t = el('button', 'ac-t'); t.type = 'button'; t.style.setProperty('--i', i++);
      var badge = b.querySelector('[id=notifBadge]');
      t.innerHTML = '<b>' + (TABS[tab] || b.textContent.trim()) + '</b><i>' + (HINT[tab] || '') + '</i>' + arrow + '<span class="ac-n">' + (badge && badge.textContent.trim() ? badge.textContent.trim().replace(/[()]/g, '') : '') + '</span>';
      t.onclick = function () { userOpened = true; b.click(); acShow(tab); };
      host.appendChild(t);
    });
    var cart = $('#cartNavLink');
    if (cart) { var c = el('a', 'ac-t'); c.href = cart.getAttribute('href'); c.style.setProperty('--i', i++); var cn = $('#cartNavCount'); c.innerHTML = '<b>Cart</b><i>' + HINT.cart + '</i>' + arrow + '<span class="ac-n">' + (cn && cn.textContent.replace(/[() ]/g, '')) + '</span>'; host.appendChild(c); }
    if (!nav.querySelector('[data-tab=privacy]')) { var p = el('button', 'ac-t'); p.type = 'button'; p.style.setProperty('--i', i++); p.innerHTML = '<b>Privacy</b><i>' + HINT.privacy + '</i>' + arrow + '<span class="ac-n"></span>'; p.onclick = function () { userOpened = true; if (window.showTab) window.showTab('privacy'); acShow('privacy'); }; host.appendChild(p); }
    var j = 0;
    nav.querySelectorAll('a[id^=open]').forEach(function (a) {
      if (a.style.display === 'none') return;
      var s = el('a', 'ac-t soft'); s.href = a.href; s.target = a.target || '_blank'; s.rel = 'noopener'; s.style.setProperty('--i', j++);
      s.innerHTML = '<b>' + a.textContent.trim().replace(/^Open /, '') + '</b>' + arrow; apps.appendChild(s);
    });
    var help = $('#helpLink'); if (help) { var h = el('button', 'ac-t soft'); h.type = 'button'; h.style.setProperty('--i', j++); h.innerHTML = '<b>Help</b>' + arrow; h.onclick = function () { help.click(); }; apps.appendChild(h); }
    shown = true;
    if (!userOpened && !nav.querySelector('.tenant-only:not([style*="display: none"])') && !nav.querySelector('.tenant-only[style=""]')) { userOpened = true; hashTab = hashTab || 'profile'; if (window.showTab) window.showTab('profile'); }
    if (userOpened) acShow(currentTab());
  }

  function currentTab() { var b = $('.acct-nav-btn.active'); return b ? b.dataset.tab : (hashTab || 'account'); }
  function acShow(tab) {
    body.classList.add('ac-in'); var c = $('#acCur'); if (c) c.textContent = TABS[tab] || tab;
    window.scrollTo({ top: 0 }); fold();
  }

  /* fold every card that has a heading: the heading stays, everything else opens on tap */
  function fold() {
    document.querySelectorAll('#tabsSection .section-pane .card:not(.fc)').forEach(function (card) {
      var head = null;
      for (var k = 0; k < card.children.length; k++) { var c = card.children[k]; if (/^(H2|H3|H4)$/.test(c.tagName) || c.classList.contains('h-2') || c.classList.contains('label')) { head = c; break; } if (c.tagName !== 'SPAN') break; }
      if (!head || head !== card.firstElementChild && !/^(SPAN|DIV)$/.test(card.firstElementChild.tagName)) return;
      var wrap = el('div', 'fc-h'); wrap.setAttribute('role', 'button'); wrap.tabIndex = 0; wrap.setAttribute('aria-expanded', 'false');
      var before = []; for (var n = card.firstChild; n && n !== head; n = n.nextSibling) before.push(n);
      card.insertBefore(wrap, head); before.forEach(function (n) { wrap.appendChild(n); }); wrap.appendChild(head);
      var b = el('div', 'fc-b'), inner = el('div', 'fc-in'); b.appendChild(inner);
      while (wrap.nextSibling) inner.appendChild(wrap.nextSibling);
      card.appendChild(b); card.classList.add('fc');
      function toggle() { var o = card.classList.toggle('open'); wrap.setAttribute('aria-expanded', o ? 'true' : 'false'); }
      wrap.onclick = toggle; wrap.onkeydown = function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } };
      wrap.addEventListener('click', function () { card.dataset.touched = '1'; });
    });
    /* a short section (up to 4 cards) opens its cards for you; a long one stays folded so you choose */
    document.querySelectorAll('#tabsSection .section-pane').forEach(function (pane) {
      var cards = pane.querySelectorAll('.card.fc'); if (!cards.length || cards.length > 4) return;
      cards.forEach(function (c) { if (c.dataset.touched || c.dataset.auto) return; c.dataset.auto = '1'; c.classList.add('open'); var h = c.querySelector('.fc-h'); if (h) h.setAttribute('aria-expanded', 'true'); });
    });
  }

  var mo, t1;
  function schedule() { clearTimeout(t1); t1 = setTimeout(function () { fold(); }, 30); }
  function start() {
    var wrapT = window.showTab;
    if (typeof wrapT === 'function' && !wrapT.__ac) {
      var f = function (tab) { wrapT(tab); if (userOpened && shown) acShow(tab); schedule(); };
      f.__ac = true; window.showTab = f;
    }
    var sec = $('#tabsSection'); var nav = $('#acctNav');
    mo = new MutationObserver(schedule); if (sec) mo.observe(sec, { childList: true, subtree: true });
    var mo2 = new MutationObserver(function () { clearTimeout(window.__acb); window.__acb = setTimeout(buildHome, 40); });
    if (nav) mo2.observe(nav, { attributes: true, childList: true, subtree: true, attributeFilter: ['style'] });
    var nb = $('#notifBadge'); if (nb) new MutationObserver(function () { buildHome(); }).observe(nb, { childList: true, characterData: true, subtree: true });
    buildHome();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
