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

    // ---- hamburger drawer (half-width slide-in nav) ----
    var menuToggle = $('#menuToggle');
    var sidebarDrawer = $('#sidebarDrawer');
    var drawerOverlay = $('#drawerOverlay');
    if (menuToggle && sidebarDrawer && drawerOverlay) {
      function openDrawer() {
        sidebarDrawer.classList.add('open');
        drawerOverlay.classList.add('open');
        menuToggle.setAttribute('aria-expanded', 'true');
      }
      function closeDrawer() {
        sidebarDrawer.classList.remove('open');
        drawerOverlay.classList.remove('open');
        menuToggle.setAttribute('aria-expanded', 'false');
      }
      menuToggle.addEventListener('click', function () {
        if (sidebarDrawer.classList.contains('open')) closeDrawer(); else openDrawer();
      });
      drawerOverlay.addEventListener('click', closeDrawer);
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
      var noiseBuffer = null;
      function getAudioCtx() {
        if (!audioCtx) {
          var AC = window.AudioContext || window.webkitAudioContext;
          if (!AC) return null;
          audioCtx = new AC();
        }
        if (audioCtx.state === 'suspended') audioCtx.resume();
        return audioCtx;
      }
      function getNoiseBuffer(c) {
        if (!noiseBuffer) {
          var len = Math.floor(c.sampleRate * 0.08);
          noiseBuffer = c.createBuffer(1, len, c.sampleRate);
          var data = noiseBuffer.getChannelData(0);
          for (var i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
        }
        return noiseBuffer;
      }
      // a small mechanical "gear tooth" click: a filtered noise burst
      // (the metallic scrape) layered with a short descending square
      // wave (the tooth catching) — no audio file, synthesized live.
      function tick() {
        var c = getAudioCtx();
        if (!c) return;
        var now = c.currentTime;

        var noise = c.createBufferSource();
        noise.buffer = getNoiseBuffer(c);
        var bandpass = c.createBiquadFilter();
        bandpass.type = 'bandpass';
        bandpass.frequency.value = 1800 + Math.random() * 1400;
        bandpass.Q.value = 7;
        var noiseGain = c.createGain();
        noiseGain.gain.setValueAtTime(0.09, now);
        noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.035);
        noise.connect(bandpass).connect(noiseGain).connect(c.destination);
        noise.start(now);
        noise.stop(now + 0.04);

        var osc = c.createOscillator();
        osc.type = 'square';
        osc.frequency.setValueAtTime(190 + Math.random() * 60, now);
        osc.frequency.exponentialRampToValueAtTime(85, now + 0.05);
        var oscGain = c.createGain();
        oscGain.gain.setValueAtTime(0.045, now);
        oscGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.06);
        osc.connect(oscGain).connect(c.destination);
        osc.start(now);
        osc.stop(now + 0.07);
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
