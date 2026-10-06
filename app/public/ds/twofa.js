/* Two-factor authentication prompt for every AUZslab app (db/117): auz2fa.resolve(sb, result)
   result is whatever a sign-in call returned ({data,error}). If the account doesn't have 2FA
   on, result passes straight through unchanged. If it does, this shows a small "Enter the code
   from your authenticator app" sheet, verifies it against sb.auth.confirm2fa(challenge, code),
   and resolves to the same {data,error} shape a normal sign-in returns -- so every call site
   only needs one extra line:
     let r = await sb.auth.signInWithPassword({email, password});
     r = await auz2fa.resolve(sb, r);
     if (r.error) ... else boot();
   A cancelled prompt resolves to {data:{session:null}, error:{message:'Sign-in cancelled'}}.
   Keep site/tool/twofa.js identical to this file. */
(function () {
  function el(tag, props) {
    var n = document.createElement(tag), kids = Array.prototype.slice.call(arguments, 2);
    for (var k in props || {}) { if (k === 'style') n.style.cssText = props[k]; else if (k.slice(0, 2) === 'on') n[k] = props[k]; else n.setAttribute(k, props[k]); }
    kids.forEach(function (c) { if (c != null && c !== false) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }
  var btnCss = 'display:block;width:100%;box-sizing:border-box;text-align:center;min-height:48px;line-height:48px;margin:10px 0 0;border-radius:14px;border:0;background:var(--accent,#800020);color:#fff;font:600 16px var(--font,system-ui);cursor:pointer';
  var linkCss = 'display:block;width:100%;box-sizing:border-box;text-align:center;margin:10px 0 0;background:none;border:0;color:inherit;opacity:.7;font:500 14px var(--font,system-ui);cursor:pointer;text-decoration:underline';

  function resolve(sb, result) {
    if (!result || result.error || !result.data || !result.data.requires2fa) return Promise.resolve(result);
    var challenge = result.data.challenge;
    return new Promise(function (done) {
      var usingBackup = false;
      var box = el('div', { style: 'background:var(--bg,#fff);color:var(--label,#171717);border-radius:20px;max-width:360px;width:100%;padding:22px;box-shadow:0 20px 60px rgba(0,0,0,.35);font:16px/1.4 var(--font,-apple-system,system-ui,sans-serif)' });
      var ov = el('div', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Verification code', style: 'position:fixed;inset:0;z-index:2147483000;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;padding:16px' }, box);
      document.body.appendChild(ov);
      function finish(res) { ov.remove(); done(res); }
      function paint() {
        box.textContent = '';
        var input = el('input', {
          type: usingBackup ? 'text' : 'tel', inputmode: usingBackup ? 'text' : 'numeric', autocomplete: 'one-time-code',
          placeholder: usingBackup ? 'XXXX-XXXX' : '6-digit code', maxlength: usingBackup ? 9 : 6,
          style: 'display:block;width:100%;box-sizing:border-box;margin:14px 0 0;padding:12px 14px;border-radius:12px;border:1px solid var(--sep,#ddd);background:var(--bg2,var(--fill,#f7f7f7));color:inherit;font:600 20px/1 var(--font,system-ui);text-align:center;letter-spacing:2px'
        });
        var err = el('p', { style: 'margin:10px 0 0;color:var(--red,#c00);font-size:13px;min-height:16px' });
        var submitBtn = el('button', { type: 'button', style: btnCss }, 'Verify');
        var busy = false;
        function submit() {
          if (busy) return;
          var code = input.value.trim();
          if (!code) return;
          busy = true; submitBtn.textContent = 'Checking…';
          sb.auth.confirm2fa(challenge, code).then(function (r) {
            busy = false; submitBtn.textContent = 'Verify';
            if (r.error) { err.textContent = r.error.message || 'That code is wrong or has expired.'; input.value = ''; input.focus(); return; }
            finish(r);
          }).catch(function () { busy = false; submitBtn.textContent = 'Verify'; err.textContent = 'Something went wrong -- try again.'; });
        }
        submitBtn.onclick = submit;
        input.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') submit(); });
        box.append(
          el('h2', { style: 'margin:0 0 4px;font:700 20px var(--font,system-ui)' }, 'Enter your code'),
          el('p', { style: 'margin:0;opacity:.75;font-size:14px' },
            usingBackup ? 'Enter one of your unused backup codes.' : 'Open your authenticator app and enter the 6-digit code for this account.'),
          input, err, submitBtn,
          el('button', { type: 'button', style: linkCss, onclick: function () { usingBackup = !usingBackup; paint(); } },
            usingBackup ? 'Use your authenticator app instead' : "Can't access your authenticator? Use a backup code"),
          el('button', { type: 'button', style: linkCss.replace('opacity:.7', 'opacity:.5'), onclick: function () { finish({ data: { session: null }, error: { message: 'Sign-in cancelled' } }); } }, 'Cancel'));
        setTimeout(function () { input.focus(); }, 50);
      }
      paint();
    });
  }
  window.auz2fa = { resolve: resolve };
})();
