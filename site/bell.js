/* Notification bell: one inbox for the admin, the team and clients. Shows only when someone is signed in.
   Reads inbox_list / inbox_mark_read (db/273) with the saved session. Copy of this file: app/public/ds/bell.js (keep identical). */
(function () {
  if (window.__auzBell) return; window.__auzBell = true;
  var API = window.AUZ_API || (window.CFG && window.CFG.url) || 'https://api.auzslab.in';
  var VAPID = 'BFQTtl3U3YPPl7qBOO00GjCNsW4N-T5jyq4UGs2Mk9s3lHoichGl0_B4yYrPCmCfscnw63XbHtpOp2Iy1nWMmZA';
  var onSite = /^(www\.)?auzslab\.in$/.test(location.hostname);
  var SW = onSite ? '/push-sw.js' : '/sw.js';
  var ADMIN_TYPES = /^(lead|signup_request|addon_request|client_order|client_order_paid|health|daily_summary|system_wa|renewal|team_work)$/;
  var items = [], unread = 0, open = false, btn, badge, panel, list, timer, tabs, filt = 'all';

  function session() { try { return JSON.parse(localStorage.getItem('auz_session') || 'null'); } catch (e) { return null; } }
  function rpc(fn, body) {
    var s = session(); if (!s || !s.access_token) return Promise.resolve(null);
    return fetch(API + '/rpc/' + fn, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + s.access_token }, body: JSON.stringify(body || {}) })
      .then(function (r) { return r.ok ? r.json() : null; }).then(function (j) { return j && j.data !== undefined ? j.data : j; }).catch(function () { return null; });
  }
  function ago(t) {
    var m = Math.max(0, Math.round((Date.now() - new Date(t).getTime()) / 60000));
    if (m < 1) return 'now'; if (m < 60) return m + ' min'; if (m < 1440) return Math.round(m / 60) + ' h'; return Math.round(m / 1440) + ' d';
  }
  function css() {
    var s = document.createElement('style');
    s.textContent = '.auzb{position:relative;display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:50%;border:1px solid var(--line,rgba(0,0,0,.14));background:transparent;color:inherit;cursor:pointer;padding:0;flex:none}'
      + '.auzb svg{width:16px;height:16px}.auzb i{position:absolute;top:-4px;right:-4px;min-width:18px;height:18px;border-radius:9px;background:#800020;color:#fff;font:700 12px/16px system-ui,sans-serif;text-align:center;padding:0 4px;font-style:normal}'
      + '.auzb-float{position:fixed;top:calc(env(safe-area-inset-top,0px) + 10px);right:12px;z-index:9998;background:var(--bg,#fff)}'
      + '.auzp{position:fixed;top:calc(env(safe-area-inset-top,0px) + 52px);right:12px;width:min(380px,calc(100vw - 24px));max-height:72vh;display:none;flex-direction:column;background:#fff;color:#111;border:1px solid rgba(0,0,0,.12);border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,.18);z-index:99999;font:13px/1.4 system-ui,sans-serif;overflow:hidden}'
      + '.auzp.on{display:flex}.auzp-h{display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-bottom:1px solid rgba(0,0,0,.08);font-weight:700}'
      + '.auzp-h button,.auzp-f button{background:none;border:0;color:#800020;font:600 12px system-ui,sans-serif;cursor:pointer;padding:4px}'
      + '.auzp-l{overflow:auto;flex:1}.auzp-i{display:block;width:100%;text-align:left;background:none;border:0;border-bottom:1px solid rgba(0,0,0,.06);padding:10px 14px;cursor:pointer;color:inherit;font:inherit}'
      + '.auzp-i b{display:block;font-weight:600}.auzp-i span{display:block;color:#555;margin-top:2px;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}.auzp-i small{color:#888}'
      + '.auzp-i.u{background:rgba(128,0,32,.05)}.auzp-i.u b:before{content:"";display:inline-block;width:7px;height:7px;border-radius:50%;background:#800020;margin-right:6px}'
      + '.auzp-e{padding:26px 14px;text-align:center;color:#777}.auzp-f{padding:8px 14px;border-top:1px solid rgba(0,0,0,.08);display:flex;justify-content:space-between;align-items:center;gap:8px;color:#666;font-size:12px}'
      + '@media (prefers-color-scheme:dark){html[data-theme=dark] .auzp{background:#1c1c1e;color:#f2f2f2;border-color:rgba(255,255,255,.14)}html[data-theme=dark] .auzp-i span{color:#aaa}}'
      + 'html[data-theme=dark] .auzp{background:#1c1c1e;color:#f2f2f2;border-color:rgba(255,255,255,.14)}html[data-theme=dark] .auzp-i span{color:#aaa}html[data-theme=dark] .auzp-h,html[data-theme=dark] .auzp-i,html[data-theme=dark] .auzp-f{border-color:rgba(255,255,255,.1)}';
    s.textContent += '.auzb-app{width:44px;height:44px}.auzb-app svg{width:20px;height:20px}.auzp-t{display:none;gap:6px;padding:8px 14px 0;flex-wrap:wrap}.auzp-t.on{display:flex}.auzp-t button{border:1px solid rgba(0,0,0,.14);background:none;border-radius:999px;padding:3px 10px;font:600 11px system-ui,sans-serif;color:inherit;cursor:pointer}.auzp-t button.on{background:#111;color:#fff;border-color:#111}'
      + '.auzp-i.s-critical{border-left:3px solid #c62828}.auzp-i.s-warning{border-left:3px solid #e08a00}.auzp-i.s-success{border-left:3px solid #2e7d32}.auzp-i.s-info{border-left:3px solid transparent}'
      + '.auzp-i em{display:inline-block;margin-top:6px;font:600 11px system-ui,sans-serif;font-style:normal;color:#800020;border:1px solid currentColor;border-radius:999px;padding:2px 9px}'
      + 'html[data-theme=dark] .auzp-t button.on{background:#f2f2f2;color:#111}html[data-theme=dark] .auzp-t button{border-color:rgba(255,255,255,.2)}';
    document.head.appendChild(s);
  }
  function build() {
    css();
    btn = document.createElement('button'); btn.type = 'button'; btn.className = 'auzb' + (window.AUZ_ALERT_PAGE ? ' auzb-app' : ''); btn.setAttribute('aria-label', 'Notifications');
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9a6 6 0 1 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9z"/><path d="M10 20a2 2 0 0 0 4 0"/></svg><i hidden></i>';
    badge = btn.querySelector('i');
    var host = document.querySelector('.u-r') || document.querySelector('.a-topbar-actions') || document.querySelector('.top-in') || document.querySelector('#tb-r');
    if (host) { if (host.classList.contains('top-in')) btn.style.marginLeft = 'auto'; host.insertBefore(btn, host.firstChild); }
    else { btn.classList.add('auzb-float'); document.body.appendChild(btn); }
    panel = document.createElement('div'); panel.className = 'auzp'; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Notifications');
    panel.innerHTML = '<div class="auzp-h"><span>Notifications</span><button type="button" data-all>Mark all read</button></div><div class="auzp-t"></div><div class="auzp-l"></div><div class="auzp-f"><span data-st></span><button type="button" data-al>Turn on alerts</button></div>';
    document.body.appendChild(panel); list = panel.querySelector('.auzp-l'); tabs = panel.querySelector('.auzp-t');
    btn.onclick = function (e) { e.stopPropagation(); toggle(); };
    panel.onclick = function (e) { e.stopPropagation(); };
    document.addEventListener('click', function () { if (open) toggle(false); });
    panel.querySelector('[data-all]').onclick = function () { rpc('inbox_mark_read', { p_ids: null }).then(refresh); };
    panel.querySelector('[data-al]').onclick = enableAlerts;
    if (window.AUZ_ALERT_PAGE) { var more = document.createElement('button'); more.type = 'button'; more.textContent = 'All notifications and settings'; more.onclick = function () { toggle(false); location.hash = window.AUZ_ALERT_PAGE; }; panel.querySelector('.auzp-h').insertBefore(more, panel.querySelector('[data-all]')); }
    alertState();
  }
  var KINDS = [['all', 'All'], ['critical', 'Critical'], ['warning', 'Warnings'], ['info', 'Updates']];
  function kindOf(n) { return n.severity === 'critical' ? 'critical' : n.severity === 'warning' ? 'warning' : 'info'; }
  function paint() {
    if (unread > 0) { badge.hidden = false; badge.textContent = unread > 99 ? '99+' : unread; } else badge.hidden = true;
    var graded = items.some(function (n) { return n.severity; });
    tabs.classList.toggle('on', graded); tabs.textContent = '';
    if (graded) KINDS.forEach(function (k) {
      var c = items.filter(function (n) { return k[0] === 'all' || kindOf(n) === k[0]; }).length;
      var b = document.createElement('button'); b.type = 'button'; b.className = filt === k[0] ? 'on' : ''; b.textContent = k[1] + ' ' + c;
      b.onclick = function () { filt = k[0]; paint(); }; tabs.appendChild(b);
    });
    list.textContent = '';
    var shown = items.filter(function (n) { return !graded || filt === 'all' || kindOf(n) === filt; });
    if (!shown.length) { var e = document.createElement('div'); e.className = 'auzp-e'; e.textContent = 'Nothing new yet.'; list.appendChild(e); return; }
    shown.forEach(function (n) {
      var b = document.createElement('button'); b.type = 'button'; b.className = 'auzp-i' + (n.read ? '' : ' u') + (n.severity ? ' s-' + n.severity : '');
      var t = document.createElement('b'); t.textContent = n.title || '';
      var d = document.createElement('span'); d.textContent = n.body || '';
      var a = document.createElement('small'); a.textContent = ago(n.created_at);
      b.appendChild(t); if (n.body) b.appendChild(d); b.appendChild(a);
      if (n.action) { var x = document.createElement('em'); x.textContent = n.action; b.appendChild(x); }
      b.onclick = function () { go(n); };
      list.appendChild(b);
    });
  }
  function go(n) {
    if (!n.read) rpc('inbox_mark_read', { p_ids: [n.id] }).then(refresh);
    var u = n.link;
    if (!u && ADMIN_TYPES.test(n.type || '') && !/admin\.html$/.test(location.pathname)) u = onSite ? '/admin.html' : '';
    if (!u && /^(team_|task)/.test(n.type || '') && !/salesman\.html$/.test(location.pathname)) u = onSite ? '' : '/salesman.html';
    if (u) location.href = u;
    else toggle(false);
  }
  function refresh() {
    return rpc('inbox_list', { p_limit: 30 }).then(function (r) {
      if (!r || !r.items) return; items = r.items; unread = r.unread || 0; paint();
    });
  }
  function toggle(v) {
    open = v === undefined ? !open : v; panel.classList.toggle('on', open);
    if (open) { refresh(); alertState(); }
  }
  /* ---- browser alerts on this device ---- */
  function keyBytes(b64) { var p = '='.repeat((4 - b64.length % 4) % 4), s = atob((b64 + p).replace(/-/g, '+').replace(/_/g, '/')), a = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); return a; }
  function alertState() {
    var st = panel.querySelector('[data-st]'), bt = panel.querySelector('[data-al]');
    var ios = /iphone|ipad|ipod/i.test(navigator.userAgent), standalone = navigator.standalone === true || (window.matchMedia && matchMedia('(display-mode: standalone)').matches);
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) { st.textContent = ios && !standalone ? 'On iPhone: Share, Add to Home Screen, then open from there for alerts.' : 'This browser cannot show alerts.'; bt.hidden = true; return; }
    if (Notification.permission === 'denied') { st.textContent = 'Alerts are blocked in the browser settings.'; bt.hidden = true; return; }
    if (Notification.permission === 'granted') { st.textContent = 'Alerts are on for this device.'; bt.hidden = true; return; }
    st.textContent = 'Get alerts even when this page is closed.'; bt.hidden = false;
  }
  function register(reg) {
    return reg.pushManager.getSubscription().then(function (sub) { return sub || reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID) }); })
      .then(function (sub) { var j = sub.toJSON(); return rpc('register_platform_web_push', { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth }); });
  }
  function enableAlerts() {
    Notification.requestPermission().then(function (p) {
      if (p !== 'granted') { alertState(); return; }
      return navigator.serviceWorker.register(SW).then(function () { return navigator.serviceWorker.ready; }).then(register).then(alertState);
    }).catch(alertState);
  }
  function quietResubscribe() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window) || Notification.permission !== 'granted') return;
    navigator.serviceWorker.register(SW).then(function () { return navigator.serviceWorker.ready; }).then(register).catch(function () {});
  }
  var tries = 0;
  function start() {
    if (!session()) { if (tries++ < 160 && window.AUZ_ALERT_PAGE) setTimeout(start, 2500); return; }
    if (btn) return;
    build(); refresh(); quietResubscribe();
    timer = setInterval(function () { if (btn) btn.hidden = !session(); if (!document.hidden && session()) refresh(); }, 45000);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) refresh(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
