/* Account dashboard tabs in the approved design, wired to the page's real data and saves.
   Loaded after ac5.js. Profile, Services, Roles and Notifications live here. */
(function () {
  'use strict';
  var A = window.AC5; if (!A) return;
  var esc = A.esc, ic = A.ic, F = A.F, inp = A.inp, sel = A.sel, head = A.head, g = A.g, V = A.VIEWS, $ = A.$, $$ = A.$$, S = A.S;
  var msg = function (id, t, cls) { var e = $(id); if (e) { e.textContent = t; e.className = 'msg ' + (cls || ''); } };
  var pct = function () { var P = g('PROFILE') || {}; return Math.round(((P.name ? 1 : 0) + (P.phone ? 1 : 0) + (P.business_name ? 1 : 0) + (P.business_type ? 1 : 0) + (P.city ? 1 : 0) + ((P.products || []).length ? 1 : 0)) / 6 * 100); };
  var FIELDS = { pfName: 'name', pfPhone: 'phone', pfEmail: 'contact_email', pfBiz: 'business_name', pfSlug: 'biz_slug', pfCity: 'city', pfNiche: 'niche', pfAddr: 'address', pfOut: 'outlets', pfStaff: 'staff_count', pfCur: 'current_software', pfNotes: 'notes', pfType: 'business_type', pfWhen: 'start_when' };
  function grab() {
    var P = Object.assign({}, g('PROFILE') || {});
    Object.keys(FIELDS).forEach(function (id) { var e = $('#' + id); if (e) P[FIELDS[id]] = e.value; });
    var pr = $$('#pfProducts input'); if (pr.length) P.products = pr.filter(function (i) { return i.checked; }).map(function (i) { return i.value; });
    A.set('PROFILE', P); return P;
  }

  ['profile', 'services', 'roles', 'notifications'].forEach(function (k) { A.OWN[k] = true; });
  A.ENTER.roles = function () { (0, eval)('loadRoles()').then(function () { if (S.view === 'roles') A.render(); }); };
  A.ENTER.notifications = function () { (0, eval)('loadNotifications()').then(function () { if (S.view === 'notifications') A.render(); }); };
  /* ----- Profile ----- */
  V.profile = function () {
    var P = g('PROFILE') || {}, D = g('DASH'), st = S.pstep || 0, p = pct(), prods = P.products || [];
    var names = ['About you', 'Your business', 'What you need'];
    var steps = '<div class="steps" role="tablist">' + names.map(function (t, i) { return '<button type="button" class="stp' + (i === st ? ' on' : '') + (i < st ? ' done' : '') + '" data-act="pstep" data-i="' + i + '" role="tab"><i>' + (i < st ? ic('check') : (i + 1)) + '</i><span>' + t + '</span></button>'; }).join('<u></u>') + '</div>';
    var login = g('LOGIN_EMAIL') || (D && D.my_email) || '';
    var types = [['', 'Choose']].concat((g('BIZ_TYPES') || []).map(function (x) { return [x, x]; }));
    var p0 = F('Full name *', inp('pfName', P.name, { ac: 'name' })) + F('Phone number *', inp('pfPhone', P.phone, { type: 'tel', ac: 'tel', ph: '9876543210' })) + '<div class="row2">' + F('Login email', inp('pfLogin', login, { dis: 1 })) + F('Contact email', inp('pfEmail', P.contact_email, { type: 'email', ph: 'optional' })) + '</div>';
    var p1 = F('Business name', inp('pfBiz', P.business_name || (D && D.tenant && D.tenant.name) || '')) + F('Desired subdomain', inp('pfSlug', P.biz_slug, { ph: 'yourshop' })) + '<div class="row2">' + F('Business type', sel('pfType', types, P.business_type)) + F('City', inp('pfCity', P.city)) + '</div>' + F('What exactly do you do or sell?', inp('pfNiche', P.niche, { ph: 'e.g. unisex salon, bakery, mobile repair' })) + F('Address (optional)', '<textarea id="pfAddr" rows="2">' + esc(P.address) + '</textarea>');
    var ch = g('PRODUCT_CHOICES') || [];
    var p2 = '<div class="row2">' + F('Outlets', inp('pfOut', P.outlets == null ? '' : P.outlets, { type: 'number' })) + F('Staff', inp('pfStaff', P.staff_count == null ? '' : P.staff_count, { type: 'number' })) + '</div><span class="f" style="display:block"><span>Tap what you need</span></span><div class="pcs" id="pfProducts">' + ch.map(function (x) { return '<label class="pc"><input type="checkbox" value="' + esc(x[0]) + '"' + (prods.indexOf(x[0]) > -1 ? ' checked' : '') + '>' + ic('grid') + '<span>' + esc(x[1].replace(/\s*\(.*$/, '')) + '</span></label>'; }).join('') + '</div><div class="row2">' + F('Software you use today', inp('pfCur', P.current_software, { ph: 'e.g. Tally, a notebook' })) + F('When do you want to start?', sel('pfWhen', g('START_WHEN') || [], P.start_when)) + '</div>' + F('Anything else we should know', '<textarea id="pfNotes" rows="2">' + esc(P.notes) + '</textarea>');
    var body = [p0, p1, p2][st];
    var nav = '<div class="pnav">' + (st > 0 ? '<button class="btn" data-act="pstep" data-i="' + (st - 1) + '">Back</button>' : '<span></span>') + (st < 2 ? '<button class="btn pri" data-act="pstep" data-i="' + (st + 1) + '">Next: ' + names[st + 1] + '</button>' : '<button class="btn pri" data-act="saveProfile">Save profile</button>') + '</div><div class="msg" id="pfMsg"></div>';
    var side = '<aside class="pcard"><div class="pav">' + esc((P.name || '?').charAt(0)) + '</div><b>' + esc(P.name || 'Your name') + '</b><small>' + esc(P.business_name || 'Your business') + '</small><div class="pring">' + A.ringSVG(p, 96) + '<span><b>' + p + '%</b><small>complete</small></span></div><ul class="chk2">' + [['Name and phone', P.name && P.phone], ['Business details', P.business_name && P.business_type], ['City', P.city], ['Products picked', prods.length]].map(function (x) { return '<li class="' + (x[1] ? 'ok' : '') + '">' + ic('check') + '<span>' + x[0] + '</span></li>'; }).join('') + '</ul></aside>';
    return head('Your profile', A.hasBiz() ? 'How we reach you, and what your business does.' : 'Tell us about you and your business. We use it to suggest the right setup and send a quote.') + '<div class="pgrid"><div class="pcol">' + steps + '<div class="pbody">' + body + '</div>' + nav + '</div>' + side + '</div>';
  };
  A.ACT.pstep = function (el) { grab(); S.pstep = +el.dataset.i; A.render(); window.scrollTo({ top: 0 }); };
  A.ACT.saveProfile = async function () {
    var P = grab(); if (!P.name || !P.phone) { S.pstep = 0; A.render(); msg('#pfMsg', 'Add your name and phone number first.', 'bad'); return; }
    var body = { name: P.name, phone: P.phone, contact_email: P.contact_email || '', business_name: P.business_name || '', biz_slug: P.biz_slug || '', business_type: P.business_type || '', niche: P.niche || '', city: P.city || '', address: P.address || '', outlets: P.outlets == null ? '' : String(P.outlets), staff_count: P.staff_count == null ? '' : String(P.staff_count), current_software: P.current_software || '', start_when: P.start_when || '', notes: P.notes || '', products: P.products || [] };
    var r = await g('sb').rpc('save_my_profile', { p: body });
    if (r.error) { msg('#pfMsg', r.error.message, 'bad'); return; }
    A.set('PROFILE', Object.assign({}, body, { outlets: body.outlets === '' ? null : Number(body.outlets), staff_count: body.staff_count === '' ? null : Number(body.staff_count) }));
    msg('#pfMsg', 'Saved. Thank you.', 'ok'); A.toast('Profile saved');
  };
  A.AFTER.profile = function () {
    var biz = $('#pfBiz'), slug = $('#pfSlug');
    if (biz && slug) { slug.oninput = function () { slug.dataset.t = 1; }; biz.oninput = function () { if (!slug.dataset.t) slug.value = biz.value.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 40); }; }
  };

  /* ----- Services ----- */
  V.services = function () {
    var D = g('DASH'); if (!D) return head('Services', 'Sign in with a business to see its services.');
    var ent = D.features || {}, en = D.enabled_features || {}, owner = D.my_role === 'owner';
    var groups = (D.tenant && D.tenant.niche === 'salon' ? g('SALON_SERVICE_GROUPS') : g('SERVICE_GROUPS')) || [];
    var cards = groups.map(function (gr, i) {
      var rows = gr[1].filter(function (k) { return ent[k] === true; }); if (!rows.length) return '';
      var on = rows.every(function (k) { return en[k] !== false; });
      return '<div class="svc' + (on ? ' on' : '') + '" style="--i:' + i + '"><div class="svt"><span class="svi">' + ic('grid') + '</span><label class="sw"><input type="checkbox" data-feat-group="' + esc(rows.join(',')) + '"' + (on ? ' checked' : '') + (owner ? '' : ' disabled') + ' aria-label="' + esc(gr[0]) + '"><i></i></label></div><b>' + esc(gr[0]) + '</b><small>' + (on ? 'On' : 'Switched off') + '</small></div>';
    }).join('');
    return head('Services', owner ? 'Switch any service off for now. Turning it back on works straight away.' : 'Only the business owner can change these.') + '<div class="svg">' + (cards || '<div class="empty"><b>No services yet</b>Contact AUZslab.</div>') + (owner ? '<a class="svc add" href="products.html"><span class="svi">' + ic('plus') + '</span><b>Add a service</b><small>Pick it and send a request. Price is in your quote.</small></a>' : '') + '</div><div class="msg" id="svcMsg" style="margin-top:10px"></div>';
  };
  A.AFTER.services = function () {
    $$('[data-feat-group]').forEach(function (cb) {
      cb.onchange = async function () {
        var map = {}; $$('[data-feat-group]').forEach(function (x) { x.dataset.featGroup.split(',').forEach(function (k) { map[k] = x.checked; }); });
        var r = await g('sb').rpc('update_my_features', { p_enabled: map });
        if (r.error) { msg('#svcMsg', r.error.message, 'bad'); return; }
        var D = g('DASH'); D.enabled_features = map; msg('#svcMsg', 'Saved.', 'ok'); A.render();
      };
    });
  };

  /* ----- Roles ----- */
  V.roles = function () {
    var R = g('ROLES') || [], PK = (g('visiblePermKeys') ? visiblePermKeysSafe() : (g('PERM_KEYS') || []));
    var mx = '<div class="mxw"><table class="mx"><thead><tr><th></th>' + R.map(function (r) { return '<th><span>' + esc(r.name) + '</span></th>'; }).join('') + '</tr></thead><tbody>' + PK.map(function (pm) { return '<tr><td>' + esc(pm[1]) + '</td>' + R.map(function (r) { var on = !!(r.permissions && r.permissions[pm[0]]); return '<td><span class="dot' + (on ? ' on' : '') + '" aria-label="' + esc(r.name + ': ' + pm[1]) + '">' + (on ? ic('check') : '') + '</span></td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div>';
    var make = '<div class="rmk"><b>New role</b>' + F('Role name', inp('roleName', '', { ph: 'e.g. Chef, Cashier' })) + '<div class="chips">' + PK.map(function (pm) { return '<label class="chip"><input type="checkbox" data-perm="' + esc(pm[0]) + '">' + esc(pm[1]) + '</label>'; }).join('') + '</div><div class="savebar"><button class="btn pri" data-act="roleAdd">Create role</button></div><div class="msg" id="roleMsg"></div></div>';
    var list = R.length ? '<div class="savebar" style="flex-wrap:wrap">' + R.map(function (r) { return '<button class="btn sm" data-act="roleDel" data-id="' + esc(r.id) + '">Delete ' + esc(r.name) + '</button>'; }).join('') + '</div>' : '';
    return head('Roles and access', 'Create a role, then pick what it can open. Each column is a role.') + '<div class="rwrap"><div class="rmat"><div class="rtl"><span class="bl">Access matrix</span>' + (R.length ? '' : '<em>No custom roles yet</em>') + '</div>' + (R.length ? mx + list : '<div class="empty"><b>No custom roles yet</b>Create one to start.</div>') + '</div>' + make + '</div>';
  };
  function visiblePermKeysSafe() { try { return (0, eval)('visiblePermKeys()'); } catch (e) { return g('PERM_KEYS') || []; } }
  A.ACT.roleAdd = async function () {
    var name = ($('#roleName') || {}).value; name = (name || '').trim(); if (!name) { msg('#roleMsg', 'Role name is required.', 'bad'); return; }
    var perms = {}; $$('[data-perm]').forEach(function (cb) { if (cb.checked) perms[cb.dataset.perm] = true; });
    var r = await g('sb').from('roles').insert({ name: name, permissions: perms });
    if (r.error) { msg('#roleMsg', r.error.message, 'bad'); return; }
    await (0, eval)('loadRoles()'); A.render(); A.toast('Role created');
  };
  A.ACT.roleDel = async function (el) {
    var r = await g('sb').rpc('delete_role', { p_role_id: el.dataset.id });
    if (r.error) { A.toast(r.error.message); return; }
    await (0, eval)('loadRoles()'); A.render(); A.toast('Role deleted');
  };

  /* ----- Notifications ----- */
  V.notifications = function () {
    var N = g('NOTIFS') || [], f = S.nf || 'all', un = N.filter(function (n) { return !n.read; }).length;
    var list = N.filter(function (n) { return f === 'all' || !n.read; }), grp = {}, now = new Date().toDateString(), yd = new Date(Date.now() - 864e5).toDateString();
    list.forEach(function (n) { var d = new Date(n.created_at).toDateString(), k = d === now ? 'Today' : d === yd ? 'Yesterday' : 'Earlier'; (grp[k] = grp[k] || []).push(n); });
    S.tgOpen = S.tgOpen || { Today: true }; S.nOpen = S.nOpen || {}; S.nMore = S.nMore || {};
    var tl = ['Today', 'Yesterday', 'Earlier'].filter(function (k) { return grp[k]; }).map(function (k) {
      var open = !!S.tgOpen[k], items = grp[k], lim = S.nMore[k] ? items.length : 5;
      var rows = items.slice(0, lim).map(function (n, i) { var o = !!S.nOpen[n.id]; return '<div class="nxr' + (n.read ? '' : ' un') + (o ? ' o' : '') + '"><i class="nxt"></i><button class="nxb" data-act="nOpen" data-id="' + esc(n.id) + '"><b>' + esc(n.title) + '</b><em>' + esc(new Date(n.created_at).toLocaleDateString()) + '</em></button>' + (o ? '<div class="nxd">' + (n.body ? '<small>' + esc(n.body) + '</small>' : '') + '<button class="btn sm" data-notif="' + esc(n.id) + '">' + (n.read ? 'Read' : 'Mark as read') + '</button></div>' : '') + '</div>'; }).join('');
      var more = items.length > lim ? '<button class="btn sm" data-act="nMore" data-k="' + k + '">Show ' + (items.length - lim) + ' more</button>' : '';
      var unk = items.filter(function (n) { return !n.read; }).length;
      return '<div class="tg nxg"><button class="nxh" data-act="tgFold" data-k="' + k + '" aria-expanded="' + open + '"><span class="bl">' + k + '</span><span>' + items.length + (unk ? ' &middot; ' + unk + ' new' : '') + '</span><i>' + (open ? '&minus;' : '+') + '</i></button>' + (open ? rows + more : '') + '</div>';
    }).join('');
    return head('Notifications', 'Messages from AUZslab about your account.') + '<div class="nfbar"><div class="seg"><button class="' + (f === 'all' ? 'on' : '') + '" data-act="nf" data-f="all">All</button><button class="' + (f === 'unread' ? 'on' : '') + '" data-act="nf" data-f="unread">Unread ' + (un ? '<i>' + un + '</i>' : '') + '</button></div><button class="btn sm" data-act="readAll">Mark all as read</button></div><div class="tline">' + (tl || '<div class="empty"><b>All caught up</b>Nothing unread.</div>') + '</div>';
  };
  A.ACT.tgFold = function (el) { S.tgOpen[el.dataset.k] = !S.tgOpen[el.dataset.k]; A.render(); };
  A.ACT.nOpen = function (el) { S.nOpen[el.dataset.id] = !S.nOpen[el.dataset.id]; A.render(); };
  A.ACT.nMore = function (el) { S.nMore[el.dataset.k] = true; A.render(); };
  A.ACT.nf = function (el) { S.nf = el.dataset.f; A.render(); };
  A.ACT.readAll = async function () {
    var N = g('NOTIFS') || [], sb = g('sb'); await Promise.all(N.filter(function (n) { return !n.read; }).map(function (n) { n.read = true; return sb.from('notifications').update({ read: true }).eq('id', n.id); }));
    try { (0, eval)('loadNotifications()'); } catch (e) {} A.render();
  };
  A.AFTER.notifications = function () {
    $$('[data-notif]').forEach(function (b) {
      b.onclick = async function () { var N = g('NOTIFS') || [], n = N.filter(function (x) { return String(x.id) === b.dataset.notif; })[0]; if (!n || n.read) return; n.read = true; await g('sb').from('notifications').update({ read: true }).eq('id', n.id); try { (0, eval)('loadNotifications()'); } catch (e) {} A.render(); };
    });
  };
})();
