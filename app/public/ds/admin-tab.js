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
        list.append(el('div', { class: 'li', style: 'display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 12px' }, [
          el('div', { style: 'min-width:0' }, [el('div', { text: p.email || p.username || 'Staff', style: 'font-weight:600;overflow-wrap:anywhere' }), el('div', { class: 'muted small', text: p.role + (p.loginOff ? ' · login off' : '') })]), sw]));
      });
      host.replaceChildren(el('p', { class: 'muted small', text: 'Staff can open this Admin tab only if you switch it on for them. The owner always can.' }), list);
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

  function helpPane(host) {
    var a = function (t, href) { return el('a', { class: 'btn', href: href, text: t, target: '_blank', rel: 'noopener' }); };
    simple(host, [card([el('h3', { text: 'Help and support' }), el('p', { class: 'muted small', text: 'We are happy to help.' }),
      a('Call +91 92512 50829', 'tel:+919251250829'), a('WhatsApp us', 'https://wa.me/919251250829'), a('Email helloauzslab@gmail.com', 'mailto:helloauzslab@gmail.com')])]);
  }

  window.auzAdminTab = {
    status: function (rpc) { return rpc('admin_tab_status').catch(function () { return { owner: false, allowed: false }; }); },
    mount: function (host, o) {
      var body = el('div', { style: 'margin-top:12px' });
      var panes = [['Profile', profilePane], ['Staff access', staffPane], ['Billing', billingPane], ['Notifications', notificationsPane], ['WhatsApp', whatsappPane], ['Privacy', privacyPane], ['AI connectors', connectorsPane], ['Help', helpPane]];
      var bar = el('div', { class: 'seg', role: 'tablist', style: 'display:flex;gap:6px;flex-wrap:wrap' });
      function pick(i) { Array.prototype.forEach.call(bar.children, function (b, j) { b.className = 'btn small' + (i === j ? ' fill' : ''); b.setAttribute('aria-selected', i === j ? 'true' : 'false'); }); panes[i][1](body, o); }
      panes.forEach(function (p, i) { var b = el('button', { type: 'button', role: 'tab', text: p[0] }); b.onclick = function () { pick(i); }; bar.append(b); });
      host.replaceChildren(bar, body); pick(0);
    }
  };
})();
