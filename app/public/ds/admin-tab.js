/* Admin tab (shared by the apps): the account features, owner only.
   auzAdminTab.mount(host, { rpc(fn, args) -> data (throws on error), toast(msg, isError), isOwner }).
   Panes: Profile, Staff access, Billing, Notifications, WhatsApp, Privacy, AI connectors, Help. Plain DOM, no innerHTML, uses the host app's own list/card/btn/input classes. */
(function () {
  function el(tag, attrs, kids) {
    var n = document.createElement(tag), k;
    for (k in (attrs || {})) { if (k === 'text') n.textContent = attrs[k]; else if (k === 'onclick' || k === 'onchange' || k === 'oninput') n[k] = attrs[k]; else n.setAttribute(k, attrs[k]); }
    (kids || []).forEach(function (c) { if (c) n.append(c); });
    return n;
  }

  // One stylesheet for the whole Admin tab, so it looks the same in every app. It only uses the page's own text colour and
  // mixes it with transparency, so it follows each app's light and dark theme (AUZsStyle, AUZsLedger, Salon console, store hub).
  function injectCss() {
    if (document.getElementById('at-css')) return;
    var st = document.createElement('style'); st.id = 'at-css';
    st.textContent = [
      '.at.at{--at-fg:var(--label,var(--ink,#1a1a1a));--at-bg:var(--bg,#fff);--at-ac:var(--accent,var(--plum,#800020));',
      '--at-line:color-mix(in srgb,var(--at-fg) 12%,transparent);--at-soft:color-mix(in srgb,var(--at-fg) 4.5%,transparent);--at-mut:color-mix(in srgb,var(--at-fg) 56%,transparent);',
      'display:grid;grid-template-columns:188px minmax(0,1fr);gap:18px;align-items:start;color:var(--at-fg);font-size:12.5px;line-height:1.4}',
      '.at.at.at-solo{grid-template-columns:minmax(0,1fr)}',
      /* left rail */
      '.at.at .at-rail{position:sticky;top:12px;display:grid;gap:10px}',
      '.at.at .at-me{display:none;gap:12px;align-items:center;padding:0;border:0;border-radius:0;background:none}',
      '.at.at .at-av{flex:none;width:30px;height:30px;border-radius:9px;background:var(--at-fg);color:var(--at-bg);display:grid;place-items:center;font-weight:800;font-size:12px;letter-spacing:.02em}',
      '.at.at .at-me b{display:block;font-size:12.5px;line-height:1.25;overflow-wrap:anywhere}',
      '.at.at .at-me span{display:block;font-size:11px;color:var(--at-mut);overflow-wrap:anywhere}',
      '.at.at .at-nav{display:grid;gap:1px;padding:5px;border:1px solid var(--at-line);border-radius:12px;background:transparent}',
      '.at.at .at-grp{padding:8px 8px 3px;font-size:9.5px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:var(--at-mut)}',
      '.at.at .at-nav button{all:unset;box-sizing:border-box;cursor:pointer;display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:8px;font-weight:550;font-size:12.5px;color:var(--at-fg)}',
      '.at.at .at-nav button svg{flex:none;width:14px;height:14px;opacity:.65}',
      '.at.at .at-nav button:hover{background:var(--at-soft)}',
      '.at.at .at-nav button[aria-selected=true]{background:var(--at-fg);color:var(--at-bg);box-shadow:none}',
      '.at.at .at-nav button[aria-selected=true] svg{opacity:1}',
      '.at.at .at-nav button:focus-visible{outline:2px solid var(--at-ac);outline-offset:2px}',
      /* main */
      '.at.at .at-main{min-width:0;display:grid;gap:12px}',
      '.at.at .at-head{display:grid;gap:3px;padding:0 2px 2px}',
      '.at.at .at-head h2{margin:0;font-size:17px;font-weight:700;letter-spacing:-.01em}',
      '.at.at .at-head p{margin:0;color:var(--at-mut);font-size:12px}',
      '.at.at .at-body{min-width:0;display:grid;gap:10px}',
      /* overview */
      '.at.at .at-hero{display:flex;gap:12px;align-items:center;flex-wrap:wrap;padding:14px;border-radius:14px;border:1px solid var(--at-line);background:var(--at-soft)}',
      '.at.at .at-hero .at-av{width:40px;height:40px;border-radius:12px;font-size:15px}',
      '.at.at .at-hero h3{margin:0;font-size:15px;font-weight:700}',
      '.at.at .at-hero p{margin:1px 0 0;color:var(--at-mut);font-size:12px}',
      '.at.at .at-chip{display:inline-flex;align-items:center;gap:6px;padding:2px 8px;border-radius:999px;border:1px solid var(--at-line);background:var(--at-bg);font-size:10.5px;font-weight:650}',
      '.at.at .at-chip i{width:7px;height:7px;border-radius:50%;background:#2e9e5b;display:inline-block}',
      '.at.at .at-chip.warn i{background:#d98a1c}',
      '.at.at .at-chip.off i{background:color-mix(in srgb,var(--at-fg) 35%,transparent)}',
      '.at.at .at-tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px}',
      '.at.at .at-tile{all:unset;box-sizing:border-box;cursor:pointer;display:grid;gap:4px;align-content:start;padding:11px 12px;border:1px solid var(--at-line);border-radius:12px;background:var(--at-soft);transition:background .15s}',
      '.at.at .at-tile:hover{background:color-mix(in srgb,var(--at-fg) 7%,transparent)}',
      '.at.at .at-tile:focus-visible{outline:2px solid var(--at-ac);outline-offset:2px}',
      '.at.at .at-ico{width:26px;height:26px;border-radius:8px;margin-bottom:2px;display:grid;place-items:center;background:color-mix(in srgb,var(--at-ac) 16%,transparent);color:var(--at-ac)}',
      '.at.at .at-ico svg{width:14px;height:14px}',
      '.at.at .at-tile b{font-size:12.5px;font-weight:650}',
      '.at.at .at-tile span.s{color:var(--at-mut);font-size:11px;line-height:1.35}',
      /* cards and forms */
      '.at.at .card{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px 12px;align-content:start;padding:14px;border:1px solid var(--at-line);border-radius:14px;background:var(--at-soft);box-shadow:none;margin:0}',
      '.at.at .card>*{grid-column:1/-1;margin:0;min-width:0}',
      '.at.at .card>label,.at.at .card>input,.at.at .card>select,.at.at .card>textarea{grid-column:auto}',
      '.at.at .card h3{margin:0;font-size:13px;font-weight:650}',
      '.at.at .muted,.at.at .small.muted{color:var(--at-mut);font-size:11.5px;margin:0}',
      '.at.at label.small{display:grid;gap:3px;margin:0!important;font-size:11px;font-weight:600;color:var(--at-mut)}',
      '.at.at .input,.at.at input:not([type=checkbox]):not([type=radio]),.at.at select,.at.at textarea{box-sizing:border-box;width:100%;min-height:34px;padding:6px 10px;border:1px solid var(--at-line);border-radius:9px;font-size:12.5px;background:var(--at-bg);color:var(--at-fg);font:inherit;box-shadow:none;margin:0}',
      '.at.at textarea{min-height:64px}',
      '.at.at input:focus,.at.at select:focus,.at.at textarea:focus{outline:2px solid var(--at-ac);outline-offset:1px}',
      '.at.at .btn,.at.at button.btn{all:unset;box-sizing:border-box;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;justify-self:start;min-height:32px;padding:0 14px;border:1px solid var(--at-line);border-radius:999px;background:var(--at-bg);color:var(--at-fg);font-weight:600;font-size:12px;text-decoration:none;width:auto}',
      '.at.at .btn:hover{background:var(--at-soft)}',
      '.at.at .btn.fill{background:var(--at-fg);border-color:var(--at-fg);color:var(--at-bg)}',
      '.at.at .btn.small{min-height:28px;padding:0 11px;font-size:11.5px}',
      '.at.at .btn[disabled]{opacity:.5;cursor:default}',
      '.at.at .list{display:grid;gap:6px}',
      '.at.at .li{border:1px solid var(--at-line);border-radius:10px;background:var(--at-bg);padding:8px 10px}',
      '.at.at pre,.at.at code{background:var(--at-bg);border:1px solid var(--at-line);border-radius:10px;padding:8px 10px;font-size:12.5px}',
      '.at.at a:not(.btn){color:var(--at-ac)}',
      '@media (max-width:899px){',
      '.at.at{grid-template-columns:minmax(0,1fr);gap:14px}',
      '.at.at .at-rail{position:static}',
      '.at.at .at-me{display:none}',
      '.at.at .at-nav{display:flex;gap:6px;overflow-x:auto;padding:6px;border-radius:999px;scrollbar-width:none}',
      '.at.at .at-grp{display:none}',
      '.at.at .at-nav button{white-space:nowrap;border-radius:999px;padding:8px 14px}',
      '.at.at .at-nav button svg{display:none}',
      '.at.at .at-head h2{font-size:20px}',
      '.at.at .card{grid-template-columns:minmax(0,1fr);padding:16px}',
      '.at.at .at-hero{padding:16px}',
      '}'
    ].join('');
    document.head.appendChild(st);
  }
  var NS = 'http://www.w3.org/2000/svg';
  var ICONS = {
    home: 'M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z', user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
    shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z M9 12l2 2 4-4', lock: 'M6 10V8a6 6 0 0 1 12 0v2M5 10h14v11H5z',
    users: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2 21a7 7 0 0 1 14 0M17 4.5a3.5 3.5 0 0 1 0 6.5M18 15a6 6 0 0 1 4 6',
    card: 'M3 6h18v12H3zM3 10h18', bell: 'M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 21h4', chat: 'M4 5h16v11H9l-5 4z',
    db: 'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6',
    plug: 'M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0zM12 17v4', help: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7M12 17h.01'
  };
  function icon(name) {
    var svg = document.createElementNS(NS, 'svg'); svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '1.8'); svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round'); svg.setAttribute('aria-hidden', 'true');
    var path = document.createElementNS(NS, 'path'); path.setAttribute('d', ICONS[name] || ICONS.home); svg.appendChild(path); return svg;
  }
  function initials(t) { var w = String(t || '?').replace(/@.*/, '').trim().split(/\s+/).slice(0, 2); return w.map(function (x) { return (x[0] || '').toUpperCase(); }).join('') || '?'; }

  function field(label, input) { return el('label', { class: 'small', style: 'display:grid;gap:4px;margin-bottom:10px' }, [el('span', { text: label }), input]); }


  function inp(type, ph, ac) { return el('input', { class: 'input', type: type, placeholder: ph, autocomplete: ac || 'off' }); }
  function act(btn, m, fn, okText) {
    btn.onclick = function () {
      btn.disabled = true; m.textContent = '';
      Promise.resolve().then(fn).then(function (r) {
        if (r && r.error) throw r.error;
        m.textContent = okText || 'Done.';
      }).catch(function (e) { m.textContent = (e && e.message) || 'Could not do that.'; }).then(function () { btn.disabled = false; });
    };
  }
  function signOutNow(o) {
    return Promise.resolve(o.sb && o.sb.auth ? o.sb.auth.signOut() : null).catch(function () {}).then(function () { if (!(o.sb && o.sb.auth && o.sb.auth.keepPage)) location.href = 'https://auzslab.in/signup.html?signout=1'; });
  }

  function accountPane(host, o) {
    var sb = o.sb;
    if (!sb || !sb.auth) { simple(host, [card([el('p', { class: 'muted small', text: 'Account security is not available in this app yet. Open auzslab.in/account.html?stay=1 to manage your password and sign-in.' })])]); return; }
    var out = el('button', { class: 'btn', type: 'button', text: 'Sign out' });
    out.onclick = function () { out.disabled = true; signOutNow(o); };

    var mp = msgBox(), op = inp('password', 'Current password', 'current-password'), np = inp('password', 'New password (8+ characters)', 'new-password'), pb = el('button', { class: 'btn fill', type: 'button', text: 'Update password' });
    act(pb, mp, function () {
      if (np.value.length < 8) throw new Error('New password must be at least 8 characters.');
      return sb.rpc('change_my_password', { p_old_password: op.value, p_new_password: np.value }).then(function (r) { if (!r.error) { op.value = ''; np.value = ''; } return r; });
    }, 'Password updated.');

    var me = msgBox(), ne = inp('email', 'New login email', 'email'), ep = inp('password', 'Current password', 'current-password'), eb = el('button', { class: 'btn fill', type: 'button', text: 'Send confirmation link' });
    act(eb, me, function () { if (!ne.value.trim()) throw new Error('Enter the new email address.'); return sb.auth.requestEmailChange(ne.value.trim(), ep.value); }, 'We sent a link to the new address. Your email changes when you open it.');

    var mr = msgBox(), re = inp('email', 'Recovery email', 'email'), rb = el('button', { class: 'btn', type: 'button', text: 'Add recovery email' }), rx = el('button', { class: 'btn', type: 'button', text: 'Remove recovery email' });
    act(rb, mr, function () { if (!re.value.trim()) throw new Error('Enter an email address.'); return sb.auth.requestRecoveryEmail(re.value.trim()); }, 'We sent a link to confirm it.');
    act(rx, mr, function () { return sb.auth.removeRecoveryEmail(); }, 'Removed.');

    var tf = el('div'); 
    function paintTwo() {
      var m = msgBox();
      Promise.resolve(sb.auth.get2faStatus()).then(function (r) {
        var on = r && r.data && r.data.enabled;
        if (on) {
          var pw = inp('password', 'Password', 'current-password'), cd = inp('text', 'Code from your app', 'one-time-code'), d = el('button', { class: 'btn', type: 'button', text: 'Turn off' });
          act(d, m, function () { return sb.auth.disable2fa(pw.value, cd.value.trim()).then(function (x) { if (!x.error) paintTwo(); return x; }); }, 'Turned off.');
          tf.replaceChildren(el('p', { class: 'small', text: 'Two-step sign-in is on.' }), pw, cd, d, m);
        } else {
          var st = el('button', { class: 'btn fill', type: 'button', text: 'Set up two-step sign-in' });
          act(st, m, function () {
            return sb.auth.setup2fa().then(function (x) {
              if (x.error) return x;
              var d = x.data || {}, cd = inp('text', '6-digit code', 'one-time-code'), c = el('button', { class: 'btn fill', type: 'button', text: 'Confirm and turn on' }), mm = msgBox();
              act(c, mm, function () {
                return sb.auth.confirm2faSetup(cd.value.trim()).then(function (y) {
                  if (y.error) return y;
                  var codes = (y.data && (y.data.backup_codes || y.data.backupCodes)) || [];
                  tf.replaceChildren(el('p', { class: 'small', text: 'Two-step sign-in is on. Save these backup codes now, each works once:' }), el('pre', { text: codes.join('\n'), style: 'user-select:all;white-space:pre-wrap' }));
                  return y;
                });
              });
              tf.replaceChildren(el('p', { class: 'small', text: 'Add this key in your authenticator app, then enter the code:' }),
                el('code', { text: d.secret || d.otpauth || '', style: 'user-select:all;word-break:break-all;display:block;margin:6px 0' }), cd, c, mm);
              return x;
            });
          });
          tf.replaceChildren(el('p', { class: 'muted small', text: 'Ask for a code from your phone each time you sign in.' }), st, m);
        }
      }).catch(function (e) { tf.replaceChildren(el('p', { class: 'muted small', text: (e && e.message) || 'Could not load.' })); });
    }
    paintTwo();

    var dv = el('div', { style: 'display:grid;gap:8px' });
    function paintDev() {
      Promise.resolve(sb.auth.listSessions()).then(function (r) {
        var rows = (r && r.data) || [];
        dv.replaceChildren.apply(dv, rows.length ? rows.map(function (s) {
          var b = el('button', { class: 'btn small', type: 'button', text: s.current ? 'This device' : 'Sign out' });
          if (s.current) b.disabled = true; else b.onclick = function () { b.disabled = true; Promise.resolve(sb.auth.revokeSession(s.jti)).then(paintDev); };
          return el('div', { class: 'li', style: 'display:flex;justify-content:space-between;gap:8px;align-items:center;padding:8px 0' }, [el('div', null, [el('div', { text: s.device_label || 'Device', style: 'font-weight:600' }), el('div', { class: 'muted small', text: s.last_seen_at ? 'Last used ' + new Date(s.last_seen_at).toLocaleString() : '' })]), b]);
        }) : [el('p', { class: 'muted small', text: 'No other devices.' })]);
      }).catch(function (e) { dv.replaceChildren(el('p', { class: 'muted small', text: (e && e.message) || 'Could not load.' })); });
    }
    paintDev();

    var md = msgBox(), dp = inp('password', 'Password to confirm', 'current-password'), ck = el('input', { type: 'checkbox' }), db = el('button', { class: 'btn', type: 'button', text: 'Delete my account', style: 'color:#b3261e' });
    act(db, md, function () {
      if (!ck.checked) throw new Error('Tick the box to confirm.');
      return sb.auth.deleteAccount(dp.value).then(function (r) { if (!r.error) location.href = 'https://auzslab.in/'; return r; });
    }, 'Account deleted.');

    simple(host, [
      card([el('h3', { text: 'Sign out' }), el('p', { class: 'muted small', text: 'Sign out of AUZslab on this device.' }), out]),
      card([el('h3', { text: 'Change password' }), op, np, pb, mp]),
      card([el('h3', { text: 'Login email' }), ne, ep, eb, me]),
      card([el('h3', { text: 'Recovery email' }), el('p', { class: 'muted small', text: 'A backup address we can reach you on. It cannot be used to sign in.' }), re, el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' }, [rb, rx]), mr]),
      card([el('h3', { text: 'Two-step sign-in' }), tf]),
      card([el('h3', { text: 'Where you are signed in' }), dv]),
      card([el('h3', { text: 'Delete account' }), el('p', { class: 'muted small', text: 'This signs you out and blocks the login. Your business data is kept until our team removes it on request.' }), dp,
        el('label', { class: 'small', style: 'display:flex;gap:8px;align-items:center' }, [ck, el('span', { text: 'I understand this cannot be undone' })]), db, md])
    ]);
  }

  function consentBlock(host, o) {
    var box = el('div', { style: 'display:grid;gap:8px' });
    Promise.all([o.rpc('my_consents').catch(function () { return null; }), o.rpc('my_data_requests').catch(function () { return []; })]).then(function (res) {
      var c = res[0] || {}, reqs = res[1] || [], upd = !!(c.purposes && c.purposes.updates), m = msgBox();
      var tg = el('button', { class: 'btn small', type: 'button', text: upd ? 'Stop product updates' : 'Send me product updates' });
      act(tg, m, function () { return o.rpc('record_my_consent', { p_purposes: { service: true, updates: !upd }, p_source: 'admin_tab' }).then(function () { host.replaceChildren(); consentBlock(host, o); }); }, 'Saved.');
      var lines = [el('h3', { text: 'Your consent' }), el('p', { class: 'muted small', text: c.accepted_at ? 'You agreed to the Privacy policy (version ' + (c.accepted_version || '') + ') on ' + new Date(c.accepted_at).toLocaleDateString() + '.' : 'No consent on record yet.' }), tg, m,
        el('a', { href: 'https://auzslab.in/privacy.html', target: '_blank', rel: 'noopener', class: 'small', text: 'Read the Privacy policy' })];
      lines.push(el('h3', { text: 'Your requests' }));
      lines.push.apply(lines, reqs.length ? reqs.map(function (r) { return el('div', { class: 'li', style: 'padding:6px 0' }, [el('div', { text: (r.kind || 'request') + ' · ' + (r.status || ''), style: 'font-weight:600' }), r.reply ? el('div', { class: 'muted small', text: r.reply }) : null]); }) : [el('p', { class: 'muted small', text: 'No requests yet.' })]);
      host.append(card(lines));
    });
  }

  function profilePane(host, o) {
    host.replaceChildren(el('p', { class: 'muted small', text: 'Loading…' }));
    o.rpc('my_profile').then(function (data) {
      var P = (data && data.profile) || {}, login = (data && data.login_email) || '';
      var name = el('input', { class: 'input', value: P.name || '', autocomplete: 'name', maxlength: 120 });
      var phone = el('input', { class: 'input', type: 'tel', value: P.phone || '', autocomplete: 'tel', maxlength: 28 });
      var contact = el('input', { class: 'input', type: 'email', value: P.contact_email || '', maxlength: 180, placeholder: 'optional' });
      var biz = el('input', { class: 'input', value: P.business_name || '', maxlength: 120 });
      var city = el('input', { class: 'input', value: P.city || '', maxlength: 80 });
      var save = el('button', { class: 'btn fill', type: 'button', text: 'Save' });
      save.onclick = function () {
        save.disabled = true;
        o.rpc('save_my_profile', { p: Object.assign({}, P, { name: name.value.trim(), phone: phone.value.trim(), contact_email: contact.value.trim(), business_name: biz.value.trim(), city: city.value.trim() }) })
          .then(function () { o.toast('Saved'); }).catch(function (e) { o.toast(e.message || 'Could not save', true); }).then(function () { save.disabled = false; });
      };
      host.replaceChildren(el('div', { class: 'card', style: 'padding:14px;display:grid' }, [
        el('h3', { text: 'Your details' }),
        field('Full name', name), field('Phone', phone),
        field('Login email', el('input', { class: 'input', value: login, disabled: '' })),
        field('Contact email', contact), field('Business name', biz), field('City', city), save]));
    }).catch(function (e) { host.replaceChildren(el('p', { class: 'muted small', text: e.message || 'Could not load.' })); });
  }

  function staffPane(host, o) {
    if (!o.isOwner) { host.replaceChildren(el('p', { class: 'muted small', text: 'Only the business owner can manage who can open Admin.' })); return; }
    host.replaceChildren(el('p', { class: 'muted small', text: 'Loading…' }));
    o.rpc('admin_tab_staff').then(function (rows) {
      var list = el('div', { class: 'list' });
      (rows || []).forEach(function (p) {
        var owner = p.role === 'owner';
        var sw = el('button', { class: 'btn small' + (p.adminAccess || owner ? ' fill' : ''), type: 'button', text: owner ? 'Owner' : (p.adminAccess ? 'Admin: on' : 'Admin: off') });
        if (owner) sw.disabled = true;
        sw.onclick = function () {
          sw.disabled = true;
          o.rpc('admin_tab_set', { p_user: p.id, p_on: !p.adminAccess }).then(function () { return staffPane(host, o); })
            .catch(function (e) { o.toast(e.message || 'Could not change', true); sw.disabled = false; });
        };
        var extra = [], pm = msgBox();
        if (!owner && p.username) {
          var rp = el('button', { class: 'btn small', type: 'button', text: 'Reset PIN' });
          rp.onclick = function () {
            var typed = window.prompt('New PIN for ' + p.username + ': type 4 digits (6 for managers), or leave blank for a random one.');
            if (typed === null) return;
            rp.disabled = true;
            o.rpc('staff_reset_pin', { p_staff_id: p.id, p_pin: typed.trim() || null }).then(function (d) { pm.textContent = 'New PIN for ' + d.username + ': ' + d.pin + '. Write it down now, it is shown once.'; })
              .catch(function (e) { pm.textContent = e.message || 'Could not reset.'; }).then(function () { rp.disabled = false; });
          };
          var lg = el('button', { class: 'btn small', type: 'button', text: p.loginOff ? 'Turn login on' : 'Turn login off' });
          lg.onclick = function () { lg.disabled = true; o.rpc('staff_set_active', { p_staff_id: p.id, p_active: !!p.loginOff }).then(function () { return staffPane(host, o); }).catch(function (e) { pm.textContent = e.message || 'Could not change.'; lg.disabled = false; }); };
          extra.push(rp, lg);
        }
        list.append(el('div', { class: 'li', style: 'padding:10px 12px;display:grid;gap:8px' }, [
          el('div', { style: 'display:flex;align-items:center;justify-content:space-between;gap:10px' }, [
            el('div', { style: 'min-width:0' }, [el('div', { text: p.email || p.username || 'Staff', style: 'font-weight:600;overflow-wrap:anywhere' }), el('div', { class: 'muted small', text: p.role + (p.loginOff ? ' · login off' : '') })]), sw]),
          extra.length ? el('div', { style: 'display:flex;gap:6px;flex-wrap:wrap' }, extra) : null, pm]));
      });
      var nm = el('input', { class: 'input', placeholder: 'Name', autocomplete: 'off' }), ph = el('input', { class: 'input', placeholder: 'Phone (optional)', autocomplete: 'off' }), mg = el('label', { class: 'small', style: 'display:flex;gap:8px;align-items:center' }, [el('input', { type: 'checkbox' }), el('span', { text: 'Manager (6-digit PIN)' })]);
      var ab = el('button', { class: 'btn fill', type: 'button', text: 'Add staff with a PIN' }), am = msgBox();
      ab.onclick = function () {
        if (!nm.value.trim()) { am.textContent = 'Enter their name.'; return; }
        ab.disabled = true;
        o.rpc('staff_create', { p_name: nm.value.trim(), p_phone: ph.value.trim(), p_role_id: null, p_builtin: mg.firstChild.checked ? 'manager' : null, p_outlet: null }).then(function (d) {
          am.textContent = 'Added. Username: ' + d.username + '  PIN: ' + d.pin + '. They sign in with the Staff option. Write the PIN down now, it is shown once.'; nm.value = ''; ph.value = '';
        }).catch(function (e) { am.textContent = e.message || 'Could not add.'; }).then(function () { ab.disabled = false; });
      };
      host.replaceChildren(el('p', { class: 'muted small', text: 'Staff can open this Admin tab only if you switch it on for them. The owner always can.' }), list, card([el('h3', { text: 'Add staff' }), nm, ph, mg, ab, am]));

    }).catch(function (e) { host.replaceChildren(el('p', { class: 'muted small', text: e.message || 'Could not load.' })); });
  }


  function simple(host, children) { host.replaceChildren.apply(host, children); }
  function card(children) { return el('div', { class: 'card', style: 'padding:14px;display:grid;gap:10px' }, children); }
  function msgBox() { return el('p', { class: 'muted small', role: 'status' }); }

  function billingPane(host, o) {
    var open = el('button', { class: 'btn fill', type: 'button', text: 'Open plan and billing' });
    open.onclick = function () { if (window.auzPlan && o.sb) window.auzPlan.open(o.sb); else o.toast('Billing is not available here yet.', true); };
    simple(host, [card([el('h3', { text: 'Plan and billing' }), el('p', { class: 'muted small', text: 'See your plan, renewal date and what is included. Renew or turn on auto-renewal from here.' }), open])]);
  }

  function notificationsPane(host, o) {
    host.replaceChildren(el('p', { class: 'muted small', text: 'Loading…' }));
    o.rpc('inbox_list', { p_limit: 30 }).then(function (d) {
      var rows = (d && (d.items || d)) || [];
      if (!rows.length) { host.replaceChildren(el('p', { class: 'muted small', text: 'No notifications yet.' })); return; }
      var list = el('div', { class: 'list' });
      rows.forEach(function (n) { list.append(el('div', { class: 'li', style: 'padding:10px 12px' }, [el('div', { text: n.title || '', style: 'font-weight:600' }), el('div', { class: 'muted small', text: (n.body || '') + (n.created_at ? ' · ' + new Date(n.created_at).toLocaleDateString() : '') })])); });
      host.replaceChildren(list);
    }).catch(function (e) { host.replaceChildren(el('p', { class: 'muted small', text: e.message || 'Could not load.' })); });
  }

  function whatsappPane(host, o) {
    host.replaceChildren(el('p', { class: 'muted small', text: 'Loading…' }));
    o.rpc('wa_my_status').then(function (st) {
      st = st || {};
      var m = msgBox(), on = !!(st.settings ? st.settings.enabled : st.enabled);
      var btn = el('button', { class: 'btn' + (on ? ' fill' : ''), type: 'button', text: on ? 'WhatsApp messages: on' : 'WhatsApp messages: off' });
      btn.disabled = !o.isOwner;
      btn.onclick = function () {
        btn.disabled = true;
        o.rpc('wa_save_settings', { p: { enabled: !on, events: (st.settings && st.settings.events) || {} } }).then(function () { return whatsappPane(host, o); })
          .catch(function (e) { m.textContent = e.message || 'Could not change. AUZslab may need to approve WhatsApp for your business first.'; btn.disabled = false; });
      };
      host.replaceChildren(card([el('h3', { text: 'WhatsApp automation' }), el('p', { class: 'muted small', text: 'Send bills, order updates and reminders on WhatsApp automatically, using approved message templates.' }), btn, m]));
    }).catch(function (e) { host.replaceChildren(el('p', { class: 'muted small', text: e.message || 'Could not load.' })); });
  }

  function connectorsPane(host, o) {
    if (!o.isOwner) { host.replaceChildren(el('p', { class: 'muted small', text: 'Only the business owner can manage AI connectors.' })); return; }
    host.replaceChildren(el('p', { class: 'muted small', text: 'Loading…' }));
    o.rpc('mcp_list_keys').then(function (keys) {
      keys = keys || [];
      var m = msgBox(), list = el('div', { class: 'list' });
      keys.forEach(function (k) {
        var rev = el('button', { class: 'btn small danger', type: 'button', text: 'Revoke' });
        rev.onclick = function () { rev.disabled = true; o.rpc('mcp_revoke_key', { p_id: k.id }).then(function () { return connectorsPane(host, o); }).catch(function (e) { m.textContent = e.message; rev.disabled = false; }); };
        list.append(el('div', { class: 'li', style: 'display:flex;justify-content:space-between;align-items:center;gap:10px;padding:10px 12px' }, [
          el('div', null, [el('div', { text: k.label || 'Key', style: 'font-weight:600' }), el('div', { class: 'muted small', text: (k.scope === 'read' ? 'read only' : 'can make changes') + (k.revoked ? ' · revoked' : '') })]), k.revoked ? null : rev]));
      });
      var add = el('button', { class: 'btn fill', type: 'button', text: 'Create a read-only key' });
      add.onclick = function () {
        add.disabled = true;
        o.rpc('mcp_create_key', { p_label: 'Connector key', p_scope: 'read' }).then(function (c) {
          m.textContent = 'Copy this key now, it is shown only once: ' + ((c && (c.key || c.token)) || ''); add.disabled = false;
        }).catch(function (e) { m.textContent = e.message; add.disabled = false; });
      };
      host.replaceChildren(card([el('h3', { text: 'AI connectors' }), el('p', { class: 'muted small', text: 'Let your own AI app read your business data. Connector URL: https://api.auzslab.in/mcp' }), add, m]), list);
    }).catch(function (e) { host.replaceChildren(el('p', { class: 'muted small', text: e.message || 'Could not load.' })); });
  }

  function privacyPane(host, o) {
    var m = msgBox();
    var dl = el('button', { class: 'btn', type: 'button', text: 'Download my data' });
    dl.onclick = function () {
      o.rpc('my_personal_data').then(function (d) {
        var a = el('a', { href: URL.createObjectURL(new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' })), download: 'my-auzslab-data.json' });
        document.body.append(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 3000);
      }).catch(function (e) { m.textContent = e.message || 'Could not prepare your data.'; });
    };
    var kind = el('select', { class: 'input' }); [['access', 'Access my data'], ['correction', 'Correct my data'], ['erasure', 'Erase my data'], ['other', 'Something else']].forEach(function (x) { kind.append(el('option', { value: x[0], text: x[1] })); });
    var note = el('textarea', { class: 'input', rows: 3, maxlength: 2000, placeholder: 'Tell us what you need' });
    var send = el('button', { class: 'btn fill', type: 'button', text: 'Send request' });
    send.onclick = function () {
      send.disabled = true;
      o.rpc('submit_data_request', { p_kind: kind.value, p_message: note.value.trim() }).then(function () { m.textContent = 'Request sent. We will reply within 30 days.'; note.value = ''; })
        .catch(function (e) { m.textContent = e.message || 'Could not send.'; }).then(function () { send.disabled = false; });
    };
    simple(host, [card([el('h3', { text: 'Privacy and my data' }), el('p', { class: 'muted small', text: 'Download everything we hold about you, or send a privacy request.' }), dl]), card([el('h3', { text: 'Send a request' }), field('Type', kind), field('Details', note), send, m])]);
  }

  var _priv = privacyPane;
  privacyPane = function (host, o) { _priv(host, o); consentBlock(host, o); };

  function backupPane(host, o) {
    var m = msgBox(), b = el('button', { class: 'btn fill', type: 'button', text: 'Backup, export or clear data' });
    b.onclick = function () { if (window.auzMyData && o.sb) window.auzMyData(o.sb); else m.textContent = 'Backup is not available here.'; };
    simple(host, [card([el('h3', { text: 'Backup and export' }), el('p', { class: 'muted small', text: 'Download a full backup (JSON) or an Excel-ready export of your business data. Only the owner can do this. Passwords, PINs and secrets are never included.' }), b, m])]);
  }

  function helpPane(host) {

    var a = function (t, href) { return el('a', { class: 'btn', href: href, text: t, target: '_blank', rel: 'noopener' }); };
    simple(host, [card([el('h3', { text: 'Help and support' }), el('p', { class: 'muted small', text: 'We are happy to help.' }),
      a('Call +91 92512 50829', 'tel:+919251250829'), a('WhatsApp us', 'https://wa.me/919251250829'), a('Email helloauzslab@gmail.com', 'mailto:helloauzslab@gmail.com')])]);
  }

  function overviewPane(host, o, go) {
    var hero = el('div', { class: 'at-hero' });
    var av = el('div', { class: 'at-av', text: '…' }), title = el('h3', { text: 'Your account' }), sub = el('p', { text: '' }), chips = el('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;margin-top:8px' });
    hero.append(av, el('div', { style: 'min-width:0;flex:1' }, [title, sub, chips]));
    var tiles = el('div', { class: 'at-tiles' });
    function chip(text, kind) { var c = el('span', { class: 'at-chip' + (kind ? ' ' + kind : '') }); c.append(el('i')); c.append(document.createTextNode(text)); chips.append(c); }
    function tile(ic, name, sum, target) { var t = el('button', { class: 'at-tile', type: 'button' }, [el('span', { class: 'at-ico' }, [icon(ic)]), el('b', { text: name }), el('span', { class: 's', text: sum })]); t.onclick = function () { go(target); }; tiles.append(t); return t; }
    chip(o.isOwner ? 'Owner' : 'Team member');
    var tSec = tile('shield', 'Sign-in and security', 'Password, two-step sign-in, devices', 'Account');
    var tTeam = tile('users', 'Team access', 'Who can open Admin', 'Staff access');
    tile('card', 'Billing and plan', 'Renewals, payments and plan', 'Billing');
    var tWa = tile('chat', 'WhatsApp messages', 'Automatic bills and reminders', 'WhatsApp');
    tile('db', 'Backup and data', 'Download or export your data', 'Backup');
    tile('plug', 'AI connectors', 'Let your AI app read your business', 'AI connectors');
    function setSum(t, text) { t.querySelector('.s').textContent = text; }
    Promise.resolve(o.rpc('my_profile')).then(function (d) {
      var P = (d && d.profile) || {}, login = (d && d.login_email) || '';
      var nm = P.business_name || P.name || login || 'Your business'; av.textContent = initials(nm); title.textContent = nm; sub.textContent = [P.name, login].filter(Boolean).join(' · ');
    }).catch(function () {});
    if (o.sb && o.sb.auth && o.sb.auth.get2faStatus) Promise.resolve(o.sb.auth.get2faStatus()).then(function (r) { var on = !!(r && r.data && r.data.enabled); setSum(tSec, on ? 'Two-step sign-in is on' : 'Two-step sign-in is off. Turn it on'); chip(on ? 'Two-step on' : 'Two-step off', on ? '' : 'warn'); }).catch(function () {});
    if (o.isOwner) Promise.resolve(o.rpc('admin_tab_staff')).then(function (rows) { var n = (rows || []).filter(function (p) { return p.role !== 'owner'; }).length; setSum(tTeam, n + (n === 1 ? ' team member' : ' team members') + ' · choose who can open Admin'); }).catch(function () {});
    Promise.resolve(o.rpc('wa_my_status')).then(function (st) { st = st || {}; var on = !!(st.settings ? st.settings.enabled : st.enabled); setSum(tWa, on ? 'On for your business' : 'Off. Tap to turn on'); }).catch(function () {});
    host.replaceChildren(hero, tiles);
  }

  window.auzAdminTab = {
    status: function (rpc) { return rpc('admin_tab_status').catch(function () { return { owner: false, allowed: false }; }); },
    mount: function (host, o) {
      injectCss();
      var body = el('div', { class: 'at-body' });
      // name, description, icon, group
      var panes = [
        ['Overview', overviewPane, 'Your account at a glance.', 'home', ''],
        ['Profile', profilePane, 'Your name, contact details and business information.', 'user', 'Account'],
        ['Account', accountPane, 'Password, login email, two-step sign-in and the devices you are signed in on.', 'shield', 'Account'],
        ['Privacy', privacyPane, 'Your consent, your data and privacy requests.', 'lock', 'Account'],
        ['Staff access', staffPane, 'Add staff, reset PINs and choose who can open Admin.', 'users', 'Business'],
        ['Billing', billingPane, 'Your plan, renewals and payments.', 'card', 'Business'],
        ['Notifications', notificationsPane, 'Your latest alerts.', 'bell', 'Business'],
        ['WhatsApp', whatsappPane, 'Automatic WhatsApp bills and reminders for your customers.', 'chat', 'Business'],
        ['Backup', backupPane, 'Download a full backup or an export of your business data.', 'db', 'Data'],
        ['AI connectors', connectorsPane, 'Connect an AI app such as Claude or ChatGPT to your business.', 'plug', 'Connect'],
        ['Help', helpPane, 'Talk to us.', 'help', 'Connect']
      ];
      var only = o.only && panes.filter(function (x) { return x[0] === o.only; })[0];
      var root = el('div', { class: 'at' + (only ? ' at-solo' : '') });
      if (only) { root.append(body); host.replaceChildren(root); only[1](body, o); return; }
      var rail = el('aside', { class: 'at-rail' }), nav = el('nav', { class: 'at-nav', role: 'tablist', 'aria-label': 'Admin sections' });
      var meName = el('b', { text: 'Admin' }), meSub = el('span', { text: o.isOwner ? 'Owner' : 'Team member' });
      rail.append(el('div', { class: 'at-me' }, [el('div', { class: 'at-av', text: 'A' }), el('div', { style: 'min-width:0' }, [meName, meSub])]), nav);
      var head = el('div', { class: 'at-head' }), main = el('div', { class: 'at-main' }, [head, body]);
      var btns = [], last = null;
      function pick(i) {
        btns.forEach(function (b, k) { b.setAttribute('aria-selected', i === k ? 'true' : 'false'); });
        head.replaceChildren(el('h2', { text: i === 0 ? 'Admin' : panes[i][0] }), el('p', { text: panes[i][2] }));
        body.replaceChildren(); panes[i][1](body, o, function (name) { var k = panes.findIndex(function (x) { return x[0] === name; }); if (k >= 0) pick(k); });
      }
      panes.forEach(function (p, i) {
        if (p[4] && p[4] !== last) { nav.append(el('div', { class: 'at-grp', text: p[4] })); last = p[4]; }
        var b = el('button', { type: 'button', role: 'tab' }); b.append(icon(p[3])); b.append(document.createTextNode(p[0])); b.onclick = function () { pick(i); }; nav.append(b); btns.push(b);
      });
      root.append(rail, main); host.replaceChildren(root); pick(0);
      Promise.resolve(o.rpc('my_profile')).then(function (d) { var P = (d && d.profile) || {}, nm = P.business_name || P.name || (d && d.login_email) || 'Admin'; meName.textContent = nm; rail.querySelector('.at-av').textContent = initials(nm); }).catch(function () {});
    }
  };
})();
