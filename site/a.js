/* Art layer: counters and small helpers. Motion is mostly CSS (scroll-driven), no scroll listeners. */
(function () {
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches && 'IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (!e.isIntersecting) return; io.unobserve(e.target);
        var el = e.target, to = parseFloat(el.getAttribute('data-count')), t0 = null, suf = el.getAttribute('data-suf') || '';
        function step(t) { if (!t0) t0 = t; var p = Math.min(1, (t - t0) / 1100); el.textContent = Math.round(to * (1 - Math.pow(1 - p, 3))) + suf; if (p < 1) requestAnimationFrame(step); }
        requestAnimationFrame(step);
      });
    });
    $$('[data-count]').forEach(function (el) { io.observe(el); });
  }
})();
/* studio step cycler */
(function () {
  var f = document.querySelector('[data-cyc]'); if (!f) return;
  var S; try { S = JSON.parse(f.getAttribute('data-cyc')); } catch (e) { return; }
  var q = function (s) { return f.querySelector(s); }, at = 0, body = q('.as-body'), t;
  function show(i) {
    at = (i + S.length) % S.length; body.classList.add('sw');
    setTimeout(function () {
      q('[data-cyc-n]').textContent = S[at][0]; q('[data-cyc-k]').textContent = S[at][1].toLowerCase().split(' ').slice(0, 2).join(' ');
      q('[data-cyc-t]').textContent = S[at][1]; q('[data-cyc-d]').textContent = S[at][2]; body.classList.remove('sw');
    }, 180);
  }
  q('[data-cyc-prev]').addEventListener('click', function () { clearInterval(t); show(at - 1); });
  q('[data-cyc-next]').addEventListener('click', function () { clearInterval(t); show(at + 1); });
  show(0); if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) t = setInterval(function () { if (!document.hidden) show(at + 1); }, 4200);
})();
/* why: rigid vs flexible duel */
(function () {
  var rg = document.getElementById('ayRigid'), fx = document.getElementById('ayFlex'); if (!rg || !fx) return;
  var no = document.getElementById('ayNo'), toast = document.getElementById('ayToast'), tries = 0;
  var M = ['Locked by the vendor.', 'Custom field? That is a paid upgrade.', 'Feature request #4821: planned for 2028.', 'Rename it? Please raise a ticket.', 'Moving a button needs a developer.', 'Not possible. Use it as it comes.'];
  rg.addEventListener('pointerdown', function (e) {
    tries++; toast.textContent = M[(tries - 1) % M.length] + ' (tries: ' + tries + ', changes: 0)';
    rg.classList.remove('shake'); void rg.offsetWidth; rg.classList.add('shake');
  });
  var box = document.getElementById('ayFields'), n = 0, hint = document.getElementById('ayHint'), yes = document.getElementById('ayYes'), touched = false;
  function count() { n++; yes.textContent = n; }
  function field(label, val, wide) {
    var d = document.createElement('div'); d.className = 'ay-f' + (wide ? ' wide' : '');
    d.innerHTML = '<small contenteditable="true" spellcheck="false"></small><span contenteditable="true" spellcheck="false"></span><b class="u" title="Move up">↑</b><b class="x" title="Remove">×</b>';
    d.children[0].textContent = label; d.children[1].textContent = val;
    d.querySelector('.x').addEventListener('click', function () { touched = true; d.remove(); count(); hint.textContent = 'Removed. Nobody asked a vendor.'; });
    d.querySelector('.u').addEventListener('click', function () { touched = true; if (d.previousElementSibling) box.insertBefore(d, d.previousElementSibling); count(); hint.textContent = 'Moved. Instantly.'; });
    d.addEventListener('input', function () { touched = true; count(); hint.textContent = 'Renamed. Your word, your screen.'; });
    box.appendChild(d); return d;
  }
  [['Guest name', 'Your own word'], ['Service', 'Your menu']].forEach(function (a) { field(a[0], a[1]); });
  var extra = [['Stylist', 'Added by you'], ['Size', 'Added by you'], ['WhatsApp', 'Bill link'], ['GST no.', 'Auto-filled'], ['Table', 'T4'], ['Discount', '10%']], k = 0;
  document.getElementById('ayAdd').addEventListener('click', function () { touched = true; var e = extra[k++ % extra.length]; field(e[0], e[1], k % 3 === 0); count(); hint.textContent = 'Added. No ticket, no wait.'; });
  Array.prototype.forEach.call(document.querySelectorAll('#aySw i'), function (i) { i.style.setProperty('--c', i.getAttribute('data-c')); i.addEventListener('click', function () { touched = true; fx.style.setProperty('--ac', i.getAttribute('data-c')); count(); hint.textContent = 'Recoloured to your brand.'; }); });
  /* the page shows it alive until the visitor touches it */
  if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    var steps = [function () { field('Stylist', 'Added by you'); count(); hint.textContent = 'Added. No ticket, no wait.'; }, function () { fx.style.setProperty('--ac', '#1f6f5c'); count(); hint.textContent = 'Recoloured to your brand.'; }, function () { var f = box.firstChild; if (f) { f.children[0].textContent = 'Client'; count(); hint.textContent = 'Renamed. Your word, your screen.'; } }], i = 0;
    var t = setInterval(function () { if (touched || i >= steps.length) { clearInterval(t); return; } steps[i++](); }, 2200);
  }
})();
