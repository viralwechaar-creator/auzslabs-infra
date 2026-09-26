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

    // ---- synthesized scroll sound (no audio file — generated live) ----
    var soundToggle = $('#soundToggle');
    if (soundToggle) {
      var soundOn = false;
      try { soundOn = localStorage.getItem('auz_sound') === '1'; } catch (e) {}
      soundToggle.setAttribute('aria-pressed', String(soundOn));
      soundToggle.style.color = soundOn ? 'var(--ink)' : '';

      var audioCtx = null;
      function getAudioCtx() {
        if (!audioCtx) {
          var AC = window.AudioContext || window.webkitAudioContext;
          if (!AC) return null;
          audioCtx = new AC();
        }
        if (audioCtx.state === 'suspended') audioCtx.resume();
        return audioCtx;
      }
      function tick() {
        var c = getAudioCtx();
        if (!c) return;
        var osc = c.createOscillator();
        var gain = c.createGain();
        osc.type = 'sine';
        osc.frequency.value = 900 + Math.random() * 220;
        gain.gain.setValueAtTime(0.05, c.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.05);
        osc.connect(gain).connect(c.destination);
        osc.start();
        osc.stop(c.currentTime + 0.06);
      }

      soundToggle.addEventListener('click', function () {
        soundOn = !soundOn;
        soundToggle.setAttribute('aria-pressed', String(soundOn));
        soundToggle.style.color = soundOn ? 'var(--ink)' : '';
        try { localStorage.setItem('auz_sound', soundOn ? '1' : '0'); } catch (e) {}
        if (soundOn) { getAudioCtx(); tick(); }
      });

      var lastTick = 0;
      window.addEventListener('scroll', function () {
        if (!soundOn) return;
        var now = Date.now();
        if (now - lastTick < 220) return;
        lastTick = now;
        tick();
      }, { passive: true });
    }
  });
})();
