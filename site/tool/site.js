(function () {
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel) { return document.querySelectorAll(sel); }

  var CART_KEY = 'auz_cart';
  // CRM, Billing & Invoicing and Inventory come inside AUZsPOS (and the other apps): shown on the site, never sold or carted separately.
  var INCLUDED = ['crm', 'billing', 'inventory'];
  // AUZsPOS QR is an add-on to AUZsPOS, never a standalone product: adding it pulls AUZsPOS in
  // automatically, and removing AUZsPOS while QR is in the cart removes QR too.
  var REQUIRES = { self_order: 'pos' };
  function readCart() {
    try { return JSON.parse(localStorage.getItem(CART_KEY) || '[]').filter(function (k) { return INCLUDED.indexOf(k) === -1; }); } catch (e) { return []; }
  }
  function writeCart(items) {
    try { localStorage.setItem(CART_KEY, JSON.stringify(items)); } catch (e) {}
  }
  window.AUZcart = {
    get: readCart,
    has: function (key) { return readCart().indexOf(key) !== -1; },
    isIncluded: function (key) { return INCLUDED.indexOf(key) !== -1; },
    add: function (key) {
      if (INCLUDED.indexOf(key) !== -1) return;
      var items = readCart();
      if (items.indexOf(key) === -1) items.push(key);
      var req = REQUIRES[key];
      if (req && items.indexOf(req) === -1) items.push(req);
      writeCart(items);
    },
    remove: function (key) {
      var items = readCart().filter(function (k) { return k !== key; });
      for (var dep in REQUIRES) { if (REQUIRES[dep] === key) items = items.filter(function (k) { return k !== dep; }); }
      writeCart(items);
    },
    toggle: function (key) {
      if (window.AUZcart.has(key)) window.AUZcart.remove(key); else window.AUZcart.add(key);
    },
    clear: function () { writeCart([]); },
  };

  var dashPromise = null;
  window.AUZaccount = {
    fetch: function (sb) {
      if (dashPromise) return dashPromise;
      dashPromise = (async function () {
        try {
          var s = await sb.auth.getSession();
          if (!s.data.session) return null;
          var r = await sb.rpc('my_dashboard');
          if (r.error || !r.data) return null;
          return r.data; // { tenant, features, enabled_features, my_role, my_email }
        } catch (e) { return null; }
      })();
      return dashPromise;
    },
  };

  (function () {
    var pageTransition = document.getElementById('pageTransition');
    if (!pageTransition) return;
    var TKEY = 'auz_transition';
    var cssDurationMs = parseFloat(getComputedStyle(pageTransition).transitionDuration) * 1000;
    var NAV_DELAY_MS = (isNaN(cssDurationMs) ? 320 : cssDurationMs) * 0.7;

    function setOrigin(x, y) {
      pageTransition.style.setProperty('--ox', x + '%');
      pageTransition.style.setProperty('--oy', y + '%');
    }

    function snapHidden() {
      pageTransition.style.transition = 'none';
      pageTransition.classList.remove('is-active');
      pageTransition.getBoundingClientRect(); // force layout before re-enabling transition
      requestAnimationFrame(function () { pageTransition.style.transition = ''; });
    }

    (function revealIncoming() {
      var raw;
      try { raw = sessionStorage.getItem(TKEY); } catch (e) { raw = null; }
      if (!raw) return;
      try { sessionStorage.removeItem(TKEY); } catch (e) {}
      var origin;
      try { origin = JSON.parse(raw); } catch (e) { origin = null; }
      if (origin) setOrigin(origin.x, origin.y);
      pageTransition.style.transition = 'none';
      pageTransition.classList.add('is-active');
      pageTransition.getBoundingClientRect();
      requestAnimationFrame(function () {
        pageTransition.style.transition = '';
        requestAnimationFrame(function () { pageTransition.classList.remove('is-active'); });
      });
    })();

    window.addEventListener('pageshow', function (e) {
      if (e.persisted) snapHidden();
    });

    document.addEventListener('click', function (e) {
      if (e.defaultPrevented || e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      var a = e.target.closest('a[href]');
      if (!a) return;
      var href = a.getAttribute('href');
      if (!href || href.charAt(0) === '#') return;
      if (a.target === '_blank' || a.hasAttribute('download')) return;
      if (/^(mailto:|tel:|https?:|blob:|data:)/i.test(href)) return;

      e.preventDefault();
      var rect = a.getBoundingClientRect();
      var x = (rect.left + rect.width / 2) / window.innerWidth * 100;
      var y = (rect.top + rect.height / 2) / window.innerHeight * 100;
      setOrigin(x.toFixed(2), y.toFixed(2));
      pageTransition.classList.add('is-active');

      try { sessionStorage.setItem(TKEY, JSON.stringify({ x: x.toFixed(2), y: y.toFixed(2) })); } catch (err) {}
      setTimeout(function () { window.location.href = href; }, NAV_DELAY_MS);
    });
  })();

  // iOS-only: navigator.standalone is true when launched from a saved
  // Home Screen icon, false in a regular Safari tab, undefined
  // everywhere else (Android, desktop). A regular tab always shows
  // Safari's own chrome (its own top bar AND bottom toolbar) around
  // the page -- no meta tag or CSS can remove that, it's not this
  // site's chrome. Real support ticket this answers: "the header/
  // footer is blocking the app" turned out to be someone re-opening a
  // page from an old Safari tab/history entry instead of the Home
  // Screen icon they'd saved, and not being able to tell the two apart
  // from the screenshot alone.
  function showStandaloneHint() {
    if (window.navigator.standalone !== false) return;
    var topbar = $('.topbar');
    if (!topbar) return;
    if (sessionStorage.getItem('auz_standalone_hint_dismissed')) return;
    var bar = document.createElement('div');
    bar.style.cssText = 'background:var(--ink);color:#fff;font-size:12.5px;padding:10px 16px;display:flex;align-items:center;gap:10px;justify-content:space-between';
    bar.innerHTML = '<span>You\'re viewing this in Safari, not your saved app icon &mdash; for the full-screen app, open it from the icon on your Home Screen instead.</span>';
    var dismiss = document.createElement('button');
    dismiss.textContent = '×';
    dismiss.setAttribute('aria-label', 'Dismiss');
    dismiss.style.cssText = 'background:none;border:none;color:#fff;font-size:20px;line-height:1;flex-shrink:0;cursor:pointer;padding:0 4px';
    dismiss.onclick = function () {
      bar.remove();
      try { sessionStorage.setItem('auz_standalone_hint_dismissed', '1'); } catch (e) {}
    };
    bar.appendChild(dismiss);
    topbar.insertAdjacentElement('afterend', bar);
  }

  document.addEventListener('DOMContentLoaded', function () {
    showStandaloneHint();
    var cartCountEls = $all('.cart-count');
    if (cartCountEls.length) {
      var n = AUZcart.get().length;
      cartCountEls.forEach(function (el) { el.textContent = n ? '(' + n + ')' : ''; });
    }

    var signinLinks = $all('[data-signin-link]');
    if (signinLinks.length && window.supabase && window.CFG) {
      try {
        var navSb = window.supabase.createClient(window.CFG.url, window.CFG.key);
        navSb.auth.getSession().then(function (res) {
          var session = res && res.data && res.data.session;
          var tenantId = session && session.user && session.user.app_metadata && session.user.app_metadata.tenant_id;
          if (session && !tenantId) {
            // Signed in but no business of their own: AUZslab's own team (platform admins) go
            // straight to the admin dashboard from here. Checked once per sign-in, then remembered.
            var key = 'auz_admin_' + session.user.id, cached = null;
            try { cached = sessionStorage.getItem(key); } catch (e) {}
            var apply = function (isAdmin) {
              if (!isAdmin) return;
              signinLinks.forEach(function (el) {
                el.href = 'https://auzslab.in/admin.html';
                el.setAttribute('aria-label', 'Admin dashboard');
                el.textContent = 'Admin';
              });
            };
            if (cached !== null) { apply(cached === '1'); return; }
            navSb.rpc('list_clients', {}).then(function (r) {
              var ok = !r.error;
              try { sessionStorage.setItem(key, ok ? '1' : '0'); } catch (e) {}
              apply(ok);
            });
            return;
          }
          if (!tenantId) return;
          signinLinks.forEach(function (el) {
            el.href = 'https://auzslab.in/account.html';
            el.setAttribute('aria-label', 'My account');
            el.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg> Account';
          });
        });
      } catch (e) {}
    }

    var overlay = $('#modalOverlay');
    var modal = $('#modal');
    var formView = $('#formView');
    var successView = $('#successView');
    var successContact = $('#successContact');

    function openContact() {
      if (!overlay) return;
      overlay.classList.add('open');
      if (formView) formView.style.display = 'block';
      if (successView) successView.classList.remove('show');
    }
    function closeContact() {
      if (overlay) overlay.classList.remove('open');
    }

    $all('[data-open-contact]').forEach(function (btn) {
      btn.addEventListener('click', openContact);
    });
    var closeBtn = $('#modalClose');
    if (closeBtn) closeBtn.addEventListener('click', closeContact);
    if (overlay) {
      overlay.addEventListener('click', function (e) {
        if (e.target === overlay) closeContact();
      });
    }
    if (modal) modal.addEventListener('click', function (e) { e.stopPropagation(); });

    $all('form[data-contact-form]').forEach(function (form) {
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var contactField = form.querySelector('[name="contact"]');
        var contact = contactField ? contactField.value : '';
        var thisSuccess = form.parentElement.querySelector('.success-view');
        var showSuccess = function () {
          form.style.display = 'none';
          if (thisSuccess) {
            thisSuccess.classList.add('show');
            var span = thisSuccess.querySelector('.success-contact');
            if (span) span.textContent = contact || 'you';
          }
          form.reset();
        };
        var nameField = form.querySelector('[name="name"]');
        var businessField = form.querySelector('[name="business"]');
        var messageField = form.querySelector('[name="message"]');
        var nicheField = form.querySelector('[name="niche"]');
        fetch('https://api.auzslab.in/rpc/submit_lead', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            p_name: nameField ? nameField.value : '',
            p_contact: contact,
            p_business: businessField ? businessField.value : '',
            p_message: messageField ? messageField.value : '',
            p_niche: nicheField ? nicheField.value : '',
            p_hp: (form.querySelector('[name="hp"]') || {}).value || '',
          }),
        }).then(showSuccess).catch(showSuccess); // still show success even if offline -- don't block on network errors, the person already typed it
      });
    });

    if (document.body.dataset.autoKnock === 'true') {
      try {
        if (!localStorage.getItem('auz_seen')) {
          setTimeout(openContact, 4000);
          localStorage.setItem('auz_seen', '1');
        }
      } catch (e) {}
    }

    var menuToggle = $('#menuToggle');
    var sidebarDrawer = $('#sidebarDrawer');
    var drawerOverlay = $('#drawerOverlay');
    var menuToggleLabel = menuToggle ? menuToggle.querySelector('.menu-btn-label') : null;
    if (menuToggle && sidebarDrawer && drawerOverlay) {
      function openDrawer() {
        sidebarDrawer.classList.add('open');
        drawerOverlay.classList.add('open');
        menuToggle.classList.add('is-open');
        menuToggle.setAttribute('aria-expanded', 'true');
        if (menuToggleLabel) menuToggleLabel.textContent = 'Close';
        document.body.classList.add('menu-open');
      }
      function closeDrawer() {
        sidebarDrawer.classList.remove('open');
        drawerOverlay.classList.remove('open');
        menuToggle.classList.remove('is-open');
        menuToggle.setAttribute('aria-expanded', 'false');
        if (menuToggleLabel) menuToggleLabel.textContent = 'Menu';
        document.body.classList.remove('menu-open');
        $all('.nav-group-toggle[aria-expanded="true"]').forEach(function (t) {
          t.setAttribute('aria-expanded', 'false');
        });
      }
      menuToggle.addEventListener('click', function () {
        if (sidebarDrawer.classList.contains('open')) closeDrawer(); else openDrawer();
      });
      drawerOverlay.addEventListener('click', closeDrawer);
      var drawerClose = $('#drawerClose');
      if (drawerClose) drawerClose.addEventListener('click', closeDrawer);
    }

    $all('[data-scroll-top]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    });
    $all('[data-newsletter-form]').forEach(function (form) {
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var input = form.querySelector('input');
        var btn = form.querySelector('button');
        if (btn) btn.innerHTML = '&check;';
        if (input) input.value = '';
      });
    });

    function closeOtherNavGroups(except) {
      $all('.nav-group-toggle[aria-expanded="true"]').forEach(function (t) {
        if (t !== except) t.setAttribute('aria-expanded', 'false');
      });
    }
    $all('.nav-group-toggle').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var expanded = btn.getAttribute('aria-expanded') === 'true';
        closeOtherNavGroups(btn);
        btn.setAttribute('aria-expanded', String(!expanded));
      });
    });
    $all('.nav-back').forEach(function (back) {
      back.addEventListener('click', function () {
        var toggle = back.closest('.nav-group').querySelector('.nav-group-toggle');
        if (toggle) toggle.setAttribute('aria-expanded', 'false');
      });
    });
    // Desktop flyouts (:hover/:focus-within in CSS) stay pinned open via aria-expanded once
    // clicked, with no way to dismiss one left open except clicking its own toggle again -- which
    // a second, now-overlapping flyout can cover up entirely. Clicking anywhere outside every
    // .nav-group, or pressing Escape, always closes all of them.
    document.addEventListener('click', function (e) {
      if (!e.target.closest('.nav-group')) closeOtherNavGroups(null);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeOtherNavGroups(null);
    });

    $all('.section:not(.reveal)').forEach(function (el) {
      if (!el.closest('.stack-panel')) el.classList.add('reveal');
    });

    var revealEls = $all('.reveal:not(.in)');
    if (revealEls.length && 'IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add('in');
            io.unobserve(entry.target);
          }
        });
      }, { threshold: 0, rootMargin: '0px 0px -6% 0px' }); // any visible part counts: a 15% threshold never fires on very tall sections (e.g. the product list on a phone)
      revealEls.forEach(function (el) { io.observe(el); });
    }

  });
})();
