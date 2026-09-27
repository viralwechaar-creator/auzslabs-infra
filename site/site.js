(function () {
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel) { return document.querySelectorAll(sel); }

  document.addEventListener('DOMContentLoaded', function () {
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
        form.style.display = 'none';
        if (thisSuccess) {
          thisSuccess.classList.add('show');
          var span = thisSuccess.querySelector('.success-contact');
          if (span) span.textContent = contact || 'you';
        }
        form.reset();
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
      }
      function closeDrawer() {
        sidebarDrawer.classList.remove('open');
        drawerOverlay.classList.remove('open');
        menuToggle.classList.remove('is-open');
        menuToggle.setAttribute('aria-expanded', 'false');
        if (menuToggleLabel) menuToggleLabel.textContent = 'Menu';
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
    $all('.nav-group-toggle').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var expanded = btn.getAttribute('aria-expanded') === 'true';
        btn.setAttribute('aria-expanded', String(!expanded));
      });
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
