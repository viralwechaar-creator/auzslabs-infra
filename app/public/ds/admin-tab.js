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

  window.auzAdminTab = {
    status: function (rpc) { return rpc('admin_tab_status').catch(function () { return { owner: false, allowed: false }; }); },
    mount: function (host, o) {
      var body = el('div', { style: 'margin-top:12px' });
      var panes = [['Profile', profilePane], ['Account', accountPane], ['Staff access', staffPane], ['Billing', billingPane], ['Notifications', notificationsPane], ['WhatsApp', whatsappPane], ['Privacy', privacyPane], ['Backup', backupPane], ['AI connectors', connectorsPane], ['Help', helpPane]];
      var bar = el('div', { class: 'seg', role: 'tablist', style: 'display:flex;gap:6px;flex-wrap:wrap' });
      function pick(i) { Array.prototype.forEach.call(bar.children, function (b, j) { b.className = 'btn small' + (i === j ? ' fill' : ''); b.setAttribute('aria-selected', i === j ? 'true' : 'false'); }); panes[i][1](body, o); }
      panes.forEach(function (p, i) { var b = el('button', { type: 'button', role: 'tab', text: p[0] }); b.onclick = function () { pick(i); }; bar.append(b); });
      var only = o.only && panes.filter(function (x) { return x[0] === o.only; })[0];
      if (only) { host.replaceChildren(body); only[1](body, o); return; }
      host.replaceChildren(bar, body); pick(0);
    }
  };
})();
