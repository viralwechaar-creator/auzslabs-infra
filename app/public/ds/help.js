/* Help & report a problem for every AUZslab app: auzHelp.open(sb)
   A sheet where a client or their staff can call us, WhatsApp us or email us, describe what went wrong and add a
   screenshot. On phones "Send by email" opens the share sheet with the screenshot attached (Mail, Gmail, WhatsApp...);
   elsewhere it opens the mail app with the details filled in and downloads the screenshot to attach.
   The details we need (business, who, which app and page, device, the last few errors) are added automatically.
   `sb` is optional (apps without a session just skip the business details). Edit SUPPORT below to change where it goes.
   Keep site/tool/help.js identical to this file. */
(function () {
  var SUPPORT = {
    email: 'helloauzslab@gmail.com',
    phone: '+91 8005673683',
    whatsapp: '918005673683'
  };
  var recent = [];
  function note(s) { recent.push(String(s).slice(0, 200)); if (recent.length > 6) recent.shift(); }
  window.addEventListener('error', function (e) { note((e.message || 'error') + ' @' + String(e.filename || '').split('/').pop() + ':' + (e.lineno || 0)); });
  window.addEventListener('unhandledrejection', function (e) { note('promise: ' + (e.reason && e.reason.message || e.reason)); });

  var APPS = [['mob.html', 'AUZsMob'], ['payroll.html', 'AUZsPay (Payroll)'], ['accounts.html', 'AUZsLedger (Accounting)'], ['backoffice.html', 'Back Office'],
    ['dashboard.html', 'Admin console'], ['builder.html', 'Website Builder'], ['account.html', 'Client dashboard'], ['/salon/', 'AUZslab Salon'], ['index.html', 'AUZsPOS']];
  function appName() { var p = location.pathname; for (var i = 0; i < APPS.length; i++) if (p.indexOf(APPS[i][0]) >= 0) return APPS[i][1]; return 'AUZsPOS'; }

  function el(tag, css, text) { var n = document.createElement(tag); if (css) n.style.cssText = css; if (text != null) n.textContent = text; return n; }
  var BTN = 'display:block;width:100%;box-sizing:border-box;text-align:center;text-decoration:none;min-height:48px;line-height:48px;margin:10px 0 0;border-radius:14px;border:1px solid var(--sep,#d8d8d8);background:var(--fill,#f2f2f2);color:inherit;font:600 16px system-ui,sans-serif;cursor:pointer';
  var PRI = BTN.replace('background:var(--fill,#f2f2f2);color:inherit', 'background:var(--accent,#800020);color:#fff;border-color:transparent');

  // Shrinks a chosen screenshot (max 1600px, JPEG) so the email stays small.
  function shrink(file) {
    return new Promise(function (resolve) {
      var img = new Image(), url = URL.createObjectURL(file);
      img.onload = function () {
        var k = Math.min(1, 1600 / Math.max(img.width, img.height)), c = document.createElement('canvas');
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        c.toBlob(function (b) { URL.revokeObjectURL(url); resolve(b ? new File([b], 'screenshot.jpg', { type: 'image/jpeg' }) : file); }, 'image/jpeg', 0.85);
      };
      img.onerror = function () { URL.revokeObjectURL(url); resolve(file); };
      img.src = url;
    });
  }

  function open(sb) {
    var info = { app: appName(), shop: location.hostname, who: '', role: '' };
    if (sb && sb.rpc) {
      try { sb.rpc('my_dashboard').then(function (r) { var d = r && r.data; if (d) { info.shop = ((d.tenant && d.tenant.name) || '') + ' (' + ((d.tenant && d.tenant.slug) || location.hostname) + ')'; info.who = d.my_email || ''; info.role = d.my_role || ''; } }, function () {}); } catch (e) { /* ignore */ }
    }
    var shot = null;
    var box = el('div', 'background:var(--bg,#fff);color:var(--label,#171717);border-radius:20px;max-width:440px;width:100%;padding:22px;box-shadow:0 20px 60px rgba(0,0,0,.35);max-height:90vh;overflow:auto;font:16px/1.4 system-ui,sans-serif');
    var ov = el('div', 'position:fixed;inset:0;z-index:2147482000;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:16px');
    ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true'); ov.setAttribute('aria-label', 'Help and report a problem');
    function close() { ov.remove(); }
    ov.addEventListener('click', function (e) { if (e.target === ov) close(); });

    var what = el('textarea', 'width:100%;box-sizing:border-box;min-height:110px;margin-top:12px;padding:12px;border-radius:12px;border:1px solid var(--sep,#d8d8d8);background:var(--fill,#f7f7f7);color:inherit;font:16px system-ui,sans-serif;resize:vertical');
    what.setAttribute('placeholder', 'What went wrong? What did you tap, and what did you expect?'); what.setAttribute('aria-label', 'What went wrong');
    var file = el('input'); file.type = 'file'; file.accept = 'image/*'; file.style.display = 'none';
    var thumb = el('img', 'display:none;max-width:100%;max-height:160px;margin-top:10px;border-radius:10px;border:1px solid var(--sep,#d8d8d8)'); thumb.alt = 'Your screenshot';
    var pick = el('button', BTN, 'Add a screenshot'); pick.type = 'button';
    pick.onclick = function () { file.click(); };
    file.onchange = function () {
      if (!file.files || !file.files[0]) return;
      shrink(file.files[0]).then(function (f) { shot = f; thumb.src = URL.createObjectURL(f); thumb.style.display = 'block'; pick.textContent = 'Change screenshot'; });
    };
    var msg = el('p', 'margin:10px 0 0;font-size:14px;opacity:.75;min-height:1em');

    function context() {
      var lines = ['Business: ' + info.shop, 'User: ' + (info.who || '(not signed in)') + (info.role ? ' (' + info.role + ')' : ''), 'App: ' + info.app,
        'Page: ' + location.href.replace(/#auz_gt=.*/, ''), 'Time: ' + new Date().toString(), 'Screen: ' + innerWidth + 'x' + innerHeight, 'Device: ' + navigator.userAgent];
      if (recent.length) lines.push('Recent errors: ' + recent.join(' | '));
      return lines.join('\n');
    }
    function subject() { return '[AUZslab help] ' + info.app + ' - ' + info.shop; }
    function body() { return (what.value.trim() || '(describe the problem here)') + '\n\n---\n' + context() + (shot ? '' : '\n\n(Please attach a screenshot if you can.)'); }

    var email = el('button', PRI, 'Send by email'); email.type = 'button';
    email.onclick = function () {
      var text = body();
      if (shot && navigator.canShare && navigator.canShare({ files: [shot] })) {
        navigator.share({ files: [shot], title: subject(), text: SUPPORT.email + '\n\n' + text }).then(function () { msg.textContent = 'Choose Mail or Gmail and send it to ' + SUPPORT.email + '.'; }, function () { /* cancelled */ });
        return;
      }
      if (shot) { var a = el('a'); a.href = URL.createObjectURL(shot); a.download = 'screenshot.jpg'; document.body.appendChild(a); a.click(); a.remove(); msg.textContent = 'Your screenshot was saved. Attach it to the email that opens.'; }
      location.href = 'mailto:' + SUPPORT.email + '?subject=' + encodeURIComponent(subject()) + '&body=' + encodeURIComponent(text);
    };
    var copy = el('button', BTN, 'Copy the details'); copy.type = 'button';
    copy.onclick = function () { var t = body(); (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(function () { msg.textContent = 'Copied. Paste it in a message to ' + SUPPORT.email + '.'; }, function () { window.prompt('Copy this:', t); }); };

    box.appendChild(el('h2', 'margin:0 0 4px;font:700 20px system-ui,sans-serif', 'Help & report a problem'));
    box.appendChild(el('p', 'margin:0;font-size:14px;opacity:.75', 'Tell us what went wrong and we will fix it. Add a screenshot if you can.'));
    var guide = el('a', BTN, 'Beginner guide: how to use the apps'); guide.href = 'https://auzslab.in/learn.html'; guide.target = '_blank'; guide.rel = 'noopener'; box.appendChild(guide);
    if (SUPPORT.phone) { var call = el('a', PRI, 'Call us  ' + SUPPORT.phone); call.href = 'tel:' + SUPPORT.phone.replace(/[^+\d]/g, ''); box.appendChild(call); }
    if (SUPPORT.whatsapp) { var wa = el('a', BTN, 'WhatsApp us'); wa.target = '_blank'; wa.rel = 'noopener'; wa.href = 'https://wa.me/' + SUPPORT.whatsapp; wa.onclick = function () { wa.href = 'https://wa.me/' + SUPPORT.whatsapp + '?text=' + encodeURIComponent(subject() + '\n' + (what.value.trim() || '')); }; box.appendChild(wa); }
    [what, pick, file, thumb, email, copy, msg].forEach(function (n) { box.appendChild(n); });
    var done = el('button', BTN, 'Close'); done.type = 'button'; done.onclick = close; box.appendChild(done);
    ov.appendChild(box); document.body.appendChild(ov);
    what.focus();
  }
  window.auzHelp = { open: open, support: SUPPORT };
})();
