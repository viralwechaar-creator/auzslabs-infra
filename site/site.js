(function () {
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel) { return document.querySelectorAll(sel); }

  // ---- cart: which product keys a visitor picked, kept in
  // localStorage (survives across pages, no login required to build
  // one -- only submitting it at cart.html needs an account) ----
  var CART_KEY = 'auz_cart';
  function readCart() {
    try { return JSON.parse(localStorage.getItem(CART_KEY) || '[]'); } catch (e) { return []; }
  }
  function writeCart(items) {
    try { localStorage.setItem(CART_KEY, JSON.stringify(items)); } catch (e) {}
  }
  window.AUZcart = {
    get: readCart,
    has: function (key) { return readCart().indexOf(key) !== -1; },
    add: function (key) {
      var items = readCart();
      if (items.indexOf(key) === -1) items.push(key);
      writeCart(items);
    },
    remove: function (key) {
      writeCart(readCart().filter(function (k) { return k !== key; }));
    },
    toggle: function (key) {
      if (window.AUZcart.has(key)) window.AUZcart.remove(key); else window.AUZcart.add(key);
    },
    clear: function () { writeCart([]); },
  };

  // ---- page transition: a circle expands out from whatever link was
  // tapped, then the destination page starts fully covered and shrinks
  // the same circle away -- sessionStorage carries the origin point
  // across the real page load. Runs immediately (not on DOMContentLoaded)
  // since this script tag is at the end of body, after the overlay div,
  // so the element already exists and an early "cover on arrival" cuts
  // down the flash of uncovered content before the shrink kicks in. ----
  (function () {
    var pageTransition = document.getElementById('pageTransition');
    if (!pageTransition) return;
    var TKEY = 'auz_transition';

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

    // back/forward out of bfcache can restore the overlay mid-state
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
      if (a.target === '_blank') return;
      if (/^(mailto:|tel:|https?:)/i.test(href)) return;

      e.preventDefault();
      var rect = a.getBoundingClientRect();
      var x = (rect.left + rect.width / 2) / window.innerWidth * 100;
      var y = (rect.top + rect.height / 2) / window.innerHeight * 100;
      setOrigin(x.toFixed(2), y.toFixed(2));
      pageTransition.classList.add('is-active');

      var navigated = false;
      function go() {
        if (navigated) return;
        navigated = true;
        try { sessionStorage.setItem(TKEY, JSON.stringify({ x: x.toFixed(2), y: y.toFixed(2) })); } catch (err) {}
        window.location.href = href;
      }
      pageTransition.addEventListener('transitionend', go, { once: true });
      setTimeout(go, 700); // safety net if transitionend never fires
    });
  })();

  document.addEventListener('DOMContentLoaded', function () {
    // ---- cart count badge: every page's nav "Cart" link + any other
    // .cart-count element updates itself here, so individual pages don't
    // each need their own inline refresh script ----
    var cartCountEls = $all('.cart-count');
    if (cartCountEls.length) {
      var n = AUZcart.get().length;
      cartCountEls.forEach(function (el) { el.textContent = n ? '(' + n + ')' : ''; });
    }

    // ---- sign-in -> account icon: any [data-signin-link] element (the
    // topbar pill + the mobile drawer's copy of it) swaps to an account
    // icon linking to the client dashboard once a LIVE tenant session
    // is detected -- app_metadata.tenant_id is only present once a
    // signup has actually been approved into a real tenant, so a
    // pending self-signup still sees the normal "Sign in" pill and the
    // cart/signup flow, not a dashboard that doesn't apply to them yet. ----
    var signinLinks = $all('[data-signin-link]');
    if (signinLinks.length && window.supabase && window.CFG) {
      try {
        var navSb = window.supabase.createClient(window.CFG.url, window.CFG.key);
        navSb.auth.getSession().then(function (res) {
          var session = res && res.data && res.data.session;
          var tenantId = session && session.user && session.user.app_metadata && session.user.app_metadata.tenant_id;
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

    // works for both the modal form (index/products/platform) and the
    // inline form (contact.html) — whichever is present on the page
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
          }),
        }).then(showSuccess).catch(showSuccess); // still show success even if offline -- don't block on network errors, the person already typed it
      });
    });

    // first-time visitor: knock once, wherever they land, never again
    if (document.body.dataset.autoKnock === 'true') {
      try {
        if (!localStorage.getItem('auz_seen')) {
          setTimeout(openContact, 4000);
          localStorage.setItem('auz_seen', '1');
        }
      } catch (e) {}
    }

    // ---- menu button drawer (full-screen slide-in nav) ----
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
        // the floating knock button sits in the same corner as the
        // drawer's close/back controls and blocks them while open
        document.body.classList.add('menu-open');
      }
      function closeDrawer() {
        sidebarDrawer.classList.remove('open');
        drawerOverlay.classList.remove('open');
        menuToggle.classList.remove('is-open');
        menuToggle.setAttribute('aria-expanded', 'false');
        if (menuToggleLabel) menuToggleLabel.textContent = 'Menu';
        document.body.classList.remove('menu-open');
        // always reopen on the main list, never mid-drill-down
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

    // ---- footer: back-to-top + newsletter (visual only, no backend yet) ----
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

    // ---- expandable nav groups (Products / Business types / Resources) ----
    // desktop: hover flyout. mobile: full-screen drill-down with a back
    // button, so the same toggle/aria-expanded drives both.
    $all('.nav-group-toggle').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var expanded = btn.getAttribute('aria-expanded') === 'true';
        btn.setAttribute('aria-expanded', String(!expanded));
      });
    });
    $all('.nav-back').forEach(function (back) {
      back.addEventListener('click', function () {
        var toggle = back.closest('.nav-group').querySelector('.nav-group-toggle');
        if (toggle) toggle.setAttribute('aria-expanded', 'false');
      });
    });

    // ---- scroll-fade everywhere: auto-mark every top-level content
    // section as .reveal instead of requiring each page to hand-annotate
    // its own markup -- .stack-panel content is skipped since it already
    // animates via the sticky-scroll folder effect, not this fade ----
    $all('.section:not(.reveal)').forEach(function (el) {
      if (!el.closest('.stack-panel')) el.classList.add('reveal');
    });

    // ---- reveal-on-scroll for the homepage's stacked panels ----
    var revealEls = $all('.reveal:not(.in)');
    if (revealEls.length && 'IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add('in');
            io.unobserve(entry.target);
          }
        });
      }, { threshold: 0.15 });
      revealEls.forEach(function (el) { io.observe(el); });
    }

  });
})();
