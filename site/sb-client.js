/* Drop-in replacement for the supabase-js CDN script this app used to
 * load. Implements only the subset of its API this app actually calls
 * (checked against every .from()/.rpc()/.auth./.channel()/.storage.
 * call site in index.html, site.html, i.html, admin/onboard.html) --
 * talking to this project's own API server (server/) instead of a
 * Supabase project. Same global shape (`window.supabase.createClient`),
 * so every page needs only its <script src> swapped, nothing else.
 */
(function () {
  const LS_KEY = 'auz_session';

  function loadSession() {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch { return null; }
  }
  function saveSession(s) {
    try { s ? localStorage.setItem(LS_KEY, JSON.stringify(s)) : localStorage.removeItem(LS_KEY); } catch {}
  }

  // Google sign-in happens on https://auzslab.in/signin.html (Google cannot allow every shop subdomain). It sends the user back
  // here with the session in the URL fragment (#auz_gt=...), which never reaches any server or log. Take it once, then remove it.
  // A sign-out from an app lands here with ?signout=1 so this address forgets the session too (sessions are per address).
  (function takeSignout() {
    try {
      const u = new URL(location.href);
      if (u.searchParams.get('signout') !== '1') return;
      saveSession(null); u.searchParams.delete('signout');
      history.replaceState(null, '', u.pathname + (u.search || '') + u.hash);
    } catch {}
  })();
  (function takeHandoff() {
    try {
      const m = /[#&]auz_gt=([^&]+)/.exec(location.hash || ''); if (!m) return;
      const p = JSON.parse(decodeURIComponent(escape(atob(m[1].replace(/-/g, '+').replace(/_/g, '/')))));
      if (p && p.t && p.u) { saveSession({ access_token: p.t, user: p.u }); try { sessionStorage.setItem('auz.justSignedIn', '1'); } catch (e) {} }
      const rest = (location.hash || '').replace(/^#auz_gt=[^&]*&?/, '#').replace(/&auz_gt=[^&]*/, '');
      history.replaceState(null, '', location.pathname + location.search + (rest === '#' ? '' : rest));
    } catch {}
  })();


  // One address per app (auzspos, auzsstyle, auzsmob, auzspay, auzsledger, auzsscan, auzsfinance; app = the hub). A link to a page of ANOTHER
  // app goes to that app's own address and takes the sign-in along: the session lives in this address's own browser storage, so it is handed
  // over in the URL fragment (#auz_gt=...), which no server ever sees. Off auzslab.in (tests, localhost) addresses are left alone.
  const APP_ADDR = [
    ['auzspos', /^\/(index|dashboard|backoffice)\.html$|^\/(pos|console)\//],
    ['auzsstyle', /^\/style\.html$|^\/style\//], ['auzsmob', /^\/mob\.html$|^\/mob\//], ['auzspay', /^\/payroll\.html$|^\/payroll\//],
    ['auzsledger', /^\/accounts\.html$/], ['auzsscan', /^\/scan\.html$/], ['auzsfinance', /^\/finance\.html$|^\/finance\//], ['auzsshop', /^\/storefront\.html$|^\/storefront\//],
    ['app', /^\/(start|my)\.html$/],
  ];
  function appUrlFor(hostname, protocol, page, sess) {
    const parts = String(hostname).split('.'); const root = parts.slice(-2).join('.');
    // the main site (auzslab.in itself) has its own /index.html etc.: its links are never rewritten
    if (root !== 'auzslab.in' || parts.length < 3 || !/^\/[^/]/.test(page)) return page;
    const path = page.split(/[?#]/)[0]; let app = null;
    for (const [a, re] of APP_ADDR) if (re.test(path)) { app = a; break; }
    if (!app || (parts.length > 2 && parts[0] === app)) return page;
    const hi = page.indexOf('#'); const frag = hi >= 0 ? page.slice(hi + 1) : ''; const main = hi >= 0 ? page.slice(0, hi) : page;
    // the storefront lives on the main address itself (auzslab.in/storefront.html), so reaching it never changes the address of an installed web app
    let url = app === 'auzsshop' ? protocol + '//' + root + main : protocol + '//' + app + '.' + root + main;
    if (sess && sess.access_token) {
      const tok = btoa(unescape(encodeURIComponent(JSON.stringify({ t: sess.access_token, u: sess.user })))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      url += '#auz_gt=' + tok + (frag ? '&' + frag : '');
    } else if (frag) url += '#' + frag;
    return url;
  }
  // A customer's bill link. On auzslab.in it is the short main-site link auzslab.in/b/<code> (the server finds the bill and forwards to the
  // page that shows it); anywhere else (tests, local) it is the page on this same address. noShort: a code that is not a share token
  // (an old order number) goes straight to the page on the hub address.
  window.auzBillLink = (kind, token, noShort) => {
    const t = encodeURIComponent(token); const root = location.hostname.split('.').slice(-2).join('.');
    const pg = { style: '/b/' + t, ledger: '/bill.html?t=' + t, mob: '/mobbill.html?t=' + t, pos: '/i.html?o=' + t }[kind];
    if (root !== 'auzslab.in') return location.origin + pg;
    return noShort ? 'https://app.auzslab.in' + (kind === 'style' ? '/stybill.html?t=' + t : pg) : 'https://auzslab.in/b/' + t;
  };
  window.auzAppUrlFor = appUrlFor;
  window.auzAppUrl = (page) => appUrlFor(location.hostname, location.protocol, page, loadSession());
  window.auzGo = (page) => { location.href = window.auzAppUrl(page); };
  // Any absolute address plus the signed-in session in the fragment (never sent to a server): used to send a person straight into their app.
  // Owners and managers go straight into the app they bought (their account features live in the app's Admin tab). Returns true when it redirected.
  window.auzRouteOwner = (d) => {
    try {
      if (!/(^|\.)auzslab\.in$/.test(location.hostname) || !d || !d.tenant || !d.tenant.slug) return false;
      const f = d.features || {}, en = d.enabled_features || {}, on = (k) => f[k] === true && en[k] !== false, slug = d.tenant.slug;
      const to = (u) => { location.href = window.auzHandoffUrl ? window.auzHandoffUrl(u) : u; return true; };
      const apps = [];
      if (on('style')) apps.push(['AUZsStyle', 'Billing, stock and shop analytics', 'https://auzsstyle.auzslab.in/style.html']);
      if (on('accounting')) apps.push(['AUZsLedger', 'Accounting and GST books', 'https://auzsledger.auzslab.in/accounts.html']);
      if (on('salon')) apps.push(['Salon console', 'Bookings, billing and your salon website', 'https://' + slug + '.auzslab.in/salon/admin/']);
      if (on('storefront')) apps.push(['Online store', 'Products, orders, themes and domains', 'https://auzslab.in/storefront.html']);
      if (apps.length === 1) return to(apps[0][2]);
      if (apps.length > 1) {
        if (document.getElementById('auzAppPick')) return true;
        // Chooser sheet: a bottom sheet on phones, a centred card on larger screens; one tile per app with its own icon, a one-line
        // description and the app you used last on top. Plain DOM + one style tag (no innerHTML), light and dark, reduced-motion safe.
        const ICON = {
          AUZsStyle: '<path d="M8 4l-4 3 2 4 2-1v10h8V10l2 1 2-4-4-3a4 4 0 0 1-8 0z"/>',
          AUZsLedger: '<path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z"/><path d="M9 9h6M9 13h6M9 17h3"/>',
          'Salon console': '<circle cx="7" cy="7" r="3"/><circle cx="7" cy="17" r="3"/><path d="M9 9l11 9M9 15l11-9"/>',
          'Online store': '<path d="M4 9l1.5-5h13L20 9"/><path d="M4 9h16v2a3 3 0 0 1-5.3 1.9 3 3 0 0 1-4.7 0A3 3 0 0 1 4 11z"/><path d="M6 14v6h12v-6"/>',
        };
        const TAG = { AUZsStyle: 'Shop till', AUZsLedger: 'Books', 'Salon console': 'Salon', 'Online store': 'Website' };
        const last = (() => { try { return localStorage.getItem('auz.lastApp'); } catch (e) { return null; } })();
        apps.sort((x, y) => (y[0] === last) - (x[0] === last));
        if (!document.getElementById('auzAppPickCss')) {
          const st = document.createElement('style'); st.id = 'auzAppPickCss';
          st.textContent = '#auzAppPick{--bg:#eeeeee;--card:#fff;--ink:#0c0c0c;--mut:#8a8a8a;--dim:#5f5f5f;--line:#e0e0e0;--sh:0 1px 2px rgba(0,0,0,.04),0 8px 24px rgba(0,0,0,.05);position:fixed;inset:0;z-index:2147483000;background:rgba(12,12,12,.55);display:flex;align-items:flex-end;justify-content:center;font:400 13px/1.5 ui-sans-serif,-apple-system,"SF Pro Text",Inter,"Segoe UI",system-ui,sans-serif;letter-spacing:.005em;-webkit-font-smoothing:antialiased;animation:apf .2s ease-out}' +
            '@media (prefers-color-scheme:dark){:root:not([data-theme=light]) #auzAppPick{--bg:#141414;--card:#202020;--ink:#f2f2f0;--mut:#8e8e8e;--dim:#b3b3b3;--line:#333;--sh:0 1px 2px rgba(0,0,0,.4)}}' +
            ':root[data-theme=dark] #auzAppPick{--bg:#141414;--card:#202020;--ink:#f2f2f0;--mut:#8e8e8e;--dim:#b3b3b3;--line:#333;--sh:0 1px 2px rgba(0,0,0,.4)}' +
            '#auzAppPick .sh{background:var(--bg);color:var(--ink);width:100%;max-width:440px;border-radius:26px 26px 0 0;padding:10px 12px calc(14px + env(safe-area-inset-bottom,0px));animation:apu .28s cubic-bezier(.2,.9,.25,1)}' +
            '#auzAppPick .gr{width:38px;height:4px;border-radius:4px;background:var(--line);margin:2px auto 14px}' +
            '#auzAppPick .hd{padding:0 8px}#auzAppPick .ey{font:500 8.5px/1 "Space Mono",ui-monospace,Menlo,monospace;letter-spacing:.16em;text-transform:uppercase;color:var(--mut)}' +
            '#auzAppPick h2{color:var(--ink);margin:8px 0 0;font-size:22px;line-height:1.14;font-weight:700;letter-spacing:-.015em}#auzAppPick .sub{margin:6px 0 14px;color:var(--dim);font-size:12px}' +
            '#auzAppPick .ls{display:grid;gap:8px}' +
            '#auzAppPick button.ap{all:unset;box-sizing:border-box;cursor:pointer;display:grid;grid-template-columns:44px 1fr 30px;gap:12px;align-items:center;padding:10px 12px 10px 10px;border-radius:18px;background:var(--card);border:1px solid var(--line);box-shadow:var(--sh);transition:transform .15s,border-color .15s;animation:apu .35s both}' +
            '#auzAppPick button.ap:hover,#auzAppPick button.ap:focus-visible{border-color:var(--ink);outline:none;transform:translateY(-1px)}#auzAppPick button.ap:active{transform:scale(.985)}' +
            '#auzAppPick .ic{width:44px;height:44px;border-radius:14px;background:var(--ink);color:var(--card);display:grid;place-items:center}' +
            '#auzAppPick .ic svg{width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}' +
            '#auzAppPick .t{color:var(--ink);font-weight:650;font-size:13.5px;display:flex;gap:7px;align-items:center;flex-wrap:wrap}#auzAppPick .d{font-size:11.5px;color:var(--dim);margin-top:1px;line-height:1.4}' +
            '#auzAppPick .chip{font:500 8px/1 "Space Mono",ui-monospace,Menlo,monospace;letter-spacing:.12em;text-transform:uppercase;padding:4px 7px;border-radius:99px;border:1px solid var(--line);color:var(--mut)}#auzAppPick .chip.l{background:var(--ink);border-color:var(--ink);color:var(--card)}' +
            '#auzAppPick .go{width:30px;height:30px;border-radius:50%;background:var(--bg);color:var(--ink);display:grid;place-items:center}#auzAppPick .go svg{width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}' +
            '@media (min-width:600px){#auzAppPick{align-items:center}#auzAppPick .sh{border-radius:26px;padding-bottom:14px}}' +
            '@media (prefers-reduced-motion:reduce){#auzAppPick,#auzAppPick *{animation:none!important;transition:none!important}}' +
            '@keyframes apf{from{opacity:0}}@keyframes apu{from{opacity:0;transform:translateY(16px)}}';
          document.head.append(st);
        }
        const ns = 'http://www.w3.org/2000/svg';
        const svg = (inner, cls) => { const e = document.createElementNS(ns, 'svg'); e.setAttribute('viewBox', '0 0 24 24'); e.setAttribute('aria-hidden', 'true'); if (cls) e.setAttribute('class', cls); const g = document.createElementNS(ns, 'g'); const tmp = new DOMParser().parseFromString('<svg xmlns="' + ns + '">' + inner + '</svg>', 'image/svg+xml').documentElement; [...tmp.childNodes].forEach((n) => g.append(document.importNode(n, true))); e.append(g); return e; };
        const box = document.createElement('div'); box.id = 'auzAppPick'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-label', 'Choose where to go');
        const sh = document.createElement('div'); sh.className = 'sh';
        const gr = document.createElement('div'); gr.className = 'gr';
        const hd = document.createElement('div'); hd.className = 'hd'; const ey = document.createElement('div'); ey.className = 'ey'; ey.textContent = 'AUZslab \u00b7 choose an app'; const h = document.createElement('h2'); h.textContent = 'Where do you want to go?';
        const sub = document.createElement('p'); sub.className = 'sub'; sub.textContent = (d.tenant.name ? d.tenant.name + ' · ' : '') + 'pick an app to open';
        const ls = document.createElement('div'); ls.className = 'ls';
        apps.forEach((a, k) => {
          const b = document.createElement('button'); b.type = 'button'; b.className = 'ap'; b.style.animationDelay = (60 + k * 60) + 'ms';
          const ic = document.createElement('span'); ic.className = 'ic'; ic.append(svg(ICON[a[0]] || ICON['Online store']));
          const tx = document.createElement('span'); const t = document.createElement('span'); t.className = 't'; t.append(document.createTextNode(a[0]));
          const chip = document.createElement('span'); chip.className = 'chip' + (a[0] === last ? ' l' : ''); chip.textContent = a[0] === last ? 'Last used' : (TAG[a[0]] || 'App'); t.append(chip);
          const dd = document.createElement('div'); dd.className = 'd'; dd.textContent = a[1]; tx.append(t, dd);
          const go = document.createElement('span'); go.className = 'go'; go.append(svg('<path d="M9 5l7 7-7 7"/>'));
          b.append(ic, tx, go);
          b.onclick = () => { try { localStorage.setItem('auz.lastApp', a[0]); } catch (e) {} to(a[2]); };
          ls.append(b);
        });
        hd.append(ey, h, sub); sh.append(gr, hd, ls); box.append(sh);
        box.addEventListener('click', (e) => { if (e.target === box) box.remove(); });
        document.body.append(box); const f = ls.querySelector('button'); if (f) f.focus(); return true;
      }
    } catch (e) {}
    return false;
  };
  window.auzHandoffUrl = (url) => {
    const sess = loadSession(); if (!sess || !sess.access_token) return url;
    const tok = btoa(unescape(encodeURIComponent(JSON.stringify({ t: sess.access_token, u: sess.user })))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    return url + '#auz_gt=' + tok;
  };
  // an ordinary link to another app's page is rewritten at the moment it is used (the token never sits in the page)
  document.addEventListener('click', (e) => {
    const a = e.target && e.target.closest ? e.target.closest('a[href^="/"]') : null; if (!a) return;
    const old = a.getAttribute('href'); const url = window.auzAppUrl(old); if (url === old) return;
    a.setAttribute('href', url); setTimeout(() => a.setAttribute('href', old), 0);
  }, true);


  // Auto-compress an image blob before it leaves the device -- payment
  // screenshots, logos, gallery/hero photos, product images, etc. all
  // go through storage.from().upload() below, so this one place covers
  // nearly every image upload in every app. PNG stays PNG (logos,
  // signatures, stamps rely on transparency); everything else becomes
  // a smaller JPEG. Never blocks an upload: any failure just falls
  // back to the original file. Also exposed as window.auzCompressImage
  // for the handful of upload paths that post raw bytes directly
  // (pay.html's payment screenshot)
  // instead of going through storage.from().upload().
  async function compressUploadBlob(blob, opts) {
    try {
      if (!blob || typeof blob.type !== 'string' || !blob.type.startsWith('image/') || blob.type === 'image/svg+xml') return blob;
      if (blob.size <= 180000) return blob;
      const maxW = (opts && opts.maxW) || 1600;
      const quality = (opts && opts.quality) || 0.82;
      const keepPng = blob.type === 'image/png';
      const url = URL.createObjectURL(blob);
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('bad image')); i.src = url; });
      const sc = Math.min(1, maxW / img.width);
      const w = Math.max(1, Math.round(img.width * sc)), h = Math.max(1, Math.round(img.height * sc));
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      const out = await new Promise((res) => c.toBlob((b) => res(b), keepPng ? 'image/png' : 'image/jpeg', keepPng ? undefined : quality));
      return (out && out.size < blob.size) ? out : blob;
    } catch { return blob; }
  }
  try { window.auzCompressImage = compressUploadBlob; } catch {}

  function createClient(url, _key) {
    const base = url.replace(/\/$/, '');
    let session = loadSession();

    async function request(path, { method = 'GET', body, auth = true, raw } = {}) {
      const headers = {};
      if (auth && session?.access_token) headers['Authorization'] = 'Bearer ' + session.access_token;
      if (!raw) headers['Content-Type'] = 'application/json';
      const res = await fetch(base + path, { method, headers, body: raw ? body : (body !== undefined ? JSON.stringify(body) : undefined) });
      let json = null;
      try { json = await res.json(); } catch {}
      if (!res.ok) {
        // A 401 on an authed request means the stored token itself is
        // dead (expired, or its account was deleted server-side) --
        // drop it immediately so it's never resent, instead of leaving
        // the page stuck showing "signed in" against a token every
        // future request will also fail.
        if (res.status === 401 && auth && session) { session = null; saveSession(null); }
        return { data: null, error: { message: json?.error || res.statusText, status: res.status } };
      }
      return { data: json?.data !== undefined ? json.data : json, error: null };
    }

    // ---- query builder: enough of .from(table).select().eq().gte().order().limit()/.single()/.insert()/.update()/.upsert() to cover this app's actual usage ----
    function from(table) {
      const state = { filters: [], select: '*', order: null, limit: null, single: false, onConflict: null };
      const qs = () => {
        const p = new URLSearchParams();
        p.set('select', state.select);
        for (const f of state.filters) p.set(`${f.op}.${f.col}`, f.val);
        if (state.order) p.set('order', state.order);
        if (state.limit) p.set('limit', state.limit);
        if (state.single) p.set('single', '1');
        return p.toString();
      };
      const builder = {
        select(cols) { state.select = cols || '*'; return builder; },
        eq(col, val) { state.filters.push({ op: 'eq', col, val }); return builder; },
        gte(col, val) { state.filters.push({ op: 'gte', col, val }); return builder; },
        lte(col, val) { state.filters.push({ op: 'lte', col, val }); return builder; },
        order(col) { state.order = col; return builder; },
        limit(n) { state.limit = n; return builder; },
        single() { state.single = true; return then(); },
        insert(values) { return request(`/db/${table}`, { method: 'POST', body: values }); },
        upsert(values, opts) { return request(`/db/${table}?onConflict=${encodeURIComponent(opts?.onConflict || 'id')}`, { method: 'POST', body: values }); },
        update(values) {
          return {
            eq(col, val) {
              const p = new URLSearchParams(); p.set(`eq.${col}`, val);
              return request(`/db/${table}?${p.toString()}`, { method: 'PATCH', body: values });
            },
          };
        },
        then(resolve, reject) { return then().then(resolve, reject); },
      };
      function then() { return request(`/db/${table}?${qs()}`); }
      return builder;
    }

    async function rpc(fn, args) {
      return request(`/rpc/${fn}`, { method: 'POST', body: args || {}, auth: true });
    }

    // Two-factor authentication (db/117): every sign-in method below can
    // come back with {requires2fa:true, challenge} instead of a real
    // session -- this one place decides which, so a page that already
    // checks `.data.session` for "signed in" doesn't need to change at
    // all; it just also gets `.data.requires2fa` to show a code box when
    // the account has 2FA turned on.
    function applySignInResult(data, error) {
      if (error) return { data: { session: null }, error };
      if (data.requires2fa) return { data: { session: null, requires2fa: true, challenge: data.challenge }, error: null };
      session = { access_token: data.access_token, user: data.user };
      saveSession(session);
      return { data: { session, user: data.user }, error: null };
    }

    const auth = {
      async getSession() {
        return { data: { session } };
      },
      async signInWithPassword({ email, password }) {
        const { data, error } = await request('/auth/login', { method: 'POST', body: { email, password }, auth: false });
        return applySignInResult(data, error);
      },
      // Step 2 of a 2FA sign-in: the challenge + code from any method above that returned requires2fa.
      async confirm2fa(challenge, code) {
        const { data, error } = await request('/auth/2fa/challenge', { method: 'POST', body: { challenge, code }, auth: false });
        return applySignInResult(data, error);
      },
      async get2faStatus() {
        return request('/auth/2fa/status', { method: 'GET' });
      },
      async setup2fa() {
        return request('/auth/2fa/setup', { method: 'POST', body: {} });
      },
      async confirm2faSetup(code) {
        return request('/auth/2fa/confirm', { method: 'POST', body: { code } });
      },
      async disable2fa(password, code) {
        return request('/auth/2fa/disable', { method: 'POST', body: { password, code } });
      },
      // Public self-serve account creation (POST /auth/signup) -- distinct
      // from admin-provisioned tenant-staff logins, which never call this.
      async signUp({ email, password, captchaToken }) {
        const { data, error } = await request('/auth/signup', { method: 'POST', body: { email, password, captcha_token: captchaToken || undefined }, auth: false });
        if (error) return { data: { session: null }, error };
        session = { access_token: data.access_token, user: data.user };
        saveSession(session);
        return { data: { session, user: data.user, emailVerification: data.email_verification || null }, error: null };
      },
      // Email verification: the link in the signup email opens verify-email.html, which calls verifyEmail(token).
      async verifyEmail(token) {
        return request('/auth/verify-email', { method: 'POST', body: { token }, auth: false });
      },
      async resendVerification() {
        return request('/auth/resend-verification', { method: 'POST', body: {} });
      },
      // Login-email change + recovery email (db/121). requestEmailChange/
      // requestRecoveryEmail mail a confirm link (confirmEmailChange/
      // confirmRecoveryEmail) -- nothing actually changes until that link is
      // opened. If no mail sender is configured yet, `link` is returned
      // directly so the page can show it to copy/paste, same fallback as
      // invite_staff already uses.
      async requestEmailChange(newEmail, password) {
        return request('/auth/change-email/request', { method: 'POST', body: { new_email: newEmail, password } });
      },
      async confirmEmailChange(token) {
        return request('/auth/change-email/confirm', { method: 'POST', body: { token }, auth: false });
      },
      async requestRecoveryEmail(email) {
        return request('/auth/recovery-email/request', { method: 'POST', body: { email } });
      },
      async confirmRecoveryEmail(token) {
        return request('/auth/recovery-email/confirm', { method: 'POST', body: { token }, auth: false });
      },
      async removeRecoveryEmail() {
        return request('/auth/recovery-email/remove', { method: 'POST', body: {} });
      },
      async signOut() {
        session = null;
        saveSession(null);
        return { error: null };
      },
      // ---- real identity providers (db/069) -- same {session,user}/
      // {data,error} shape as signInWithPassword/signUp above, so a page
      // treats every sign-in method identically from here on. ----
      // staff: username + PIN (db/096), no email involved
      async signInWithStaffPin(username, pin) {
        const { data, error } = await request('/auth/staff-login', { method: 'POST', body: { username, pin }, auth: false });
        if (error) return { data: { session: null }, error };
        session = { access_token: data.access_token, user: data.user };
        saveSession(session);
        return { data: { session, user: data.user }, error: null };
      },
      async signInWithGoogle(idToken) {
        const { data, error } = await request('/auth/google', { method: 'POST', body: { id_token: idToken }, auth: false });
        return applySignInResult(data, error);
      },
      async signInWithApple(code) {
        const { data, error } = await request('/auth/apple', { method: 'POST', body: { code }, auth: false });
        return applySignInResult(data, error);
      },
      async sendPhoneOtp(phone) {
        return request('/auth/phone/send', { method: 'POST', body: { phone }, auth: false });
      },
      async verifyPhoneOtp(phone, code) {
        const { data, error } = await request('/auth/phone/verify', { method: 'POST', body: { phone, code }, auth: false });
        return applySignInResult(data, error);
      },
      // resetLinkBase: the page the reset link should open (this page's
      // own URL, typically) -- the server appends ?token=... to it.
      async forgotPassword(email, resetLinkBase) {
        return request('/auth/forgot', { method: 'POST', body: { email, reset_link_base: resetLinkBase }, auth: false });
      },
      async resetPassword(token, password) {
        return request('/auth/reset', { method: 'POST', body: { token, password }, auth: false });
      },
      // Apple App Store Guideline 5.1.1(v): self-service account deletion.
      // password is only checked server-side for an account that has one.
      async deleteAccount(password) {
        const { data, error } = await request('/auth/delete-account', { method: 'POST', body: { password } });
        if (!error) { session = null; saveSession(null); }
        return { data, error };
      },
      // Single-device session revocation (db/071) -- "sign out just this
      // device" without touching any other device's session or the password.
      async listSessions() {
        const { data, error } = await request('/auth/sessions', { method: 'GET' });
        return { data: data?.sessions || null, error };
      },
      async revokeSession(jti) {
        return request(`/auth/sessions/${encodeURIComponent(jti)}/revoke`, { method: 'POST' });
      },
    };

    // Silent session renewal (owner report: clients using the POS were getting logged out
    // "again and again" mid-shift) -- nothing ever refreshed a token before this, so it
    // expired exactly 7 days after the last LOGIN no matter how actively someone kept using
    // the app since. An active session now renews itself in the background every few hours,
    // so the 7-day cliff is only ever hit by a session that's genuinely gone unused -- a
    // truly expired/revoked token still gets a real 401 here and has to sign in again.
    async function silentRefresh() {
      if (!session) return;
      try {
        const { data, error } = await request('/auth/refresh', { method: 'POST', body: {} });
        if (!error && data && data.access_token) { session = { access_token: data.access_token, user: data.user || session.user }; saveSession(session); }
      } catch {}
    }
    setInterval(silentRefresh, 6 * 60 * 60 * 1000);
    if (session) silentRefresh();

    // ---- Razorpay payments (db/070) -- dormant until the owner sets
    // RAZORPAY_KEY_ID/SECRET; config().enabled tells the cart page
    // whether to offer online checkout at all. ----
    const payments = {
      async config() {
        return request('/payments/config', { method: 'GET', auth: false });
      },
    };

    // The server picks the actual stored filename (never a client-
    // supplied one, to keep paths unpredictable/uncollidable) -- so
    // getPublicUrl(path) can't derive a URL from the path it's given
    // the way real Supabase Storage could. Every call site in this app
    // calls upload() then getPublicUrl() back to back on the same
    // bucket handle, so caching the just-uploaded path here and having
    // getPublicUrl() return that (ignoring its argument) matches actual
    // usage exactly.
    let lastUploadedPath = null;
    const storage = {
      from(bucket) {
        return {
          async upload(clientPath, blob) {
            const prefix = (clientPath.split('/')[0] || 'file').replace(/[^a-zA-Z0-9_-]/g, '') || 'file';
            const { data, error } = await request(`/storage/${bucket}/${prefix}`, {
              method: 'POST', body: await compressUploadBlob(blob), raw: true,
            });
            if (data?.path) lastUploadedPath = data.path;
            return { data, error };
          },
          getPublicUrl(_path) {
            // /uploads/* is served from this same api.$DOMAIN origin --
            // see the Caddyfile.
            return { data: { publicUrl: lastUploadedPath ? base + lastUploadedPath : '' } };
          },
        };
      },
    };

    // ---- realtime: postgres_changes -> WebSocket "changed" relay.
    // Every call site here just wants "something changed, go refetch"
    // (`() => sync()`), not the row itself, so that's all this sends. ----
    function channel(_name) {
      let ws = null;
      let handler = null;
      let wantedTable = null;
      return {
        on(_event, filter, cb) { handler = cb; wantedTable = filter?.table || null; return this; },
        subscribe() {
          if (!session?.access_token) return this;
          const wsUrl = base.replace(/^http/, 'ws') + '/ws?token=' + encodeURIComponent(session.access_token);
          ws = new WebSocket(wsUrl);
          ws.onmessage = (ev) => {
            try {
              const msg = JSON.parse(ev.data);
              if (msg.type === 'changed' && handler && (!wantedTable || msg.table === wantedTable)) handler(msg);
            } catch {}
          };
          ws.onclose = () => setTimeout(() => { if (session?.access_token) this.subscribe(); }, 5000);
          return this;
        },
      };
    }

    // WhatsApp automation: connecting the shop's own number goes through the server (the token is stored encrypted, never returned).
    const whatsapp = { async connect(body) { return request('/whatsapp/connect', { method: 'POST', body, auth: true }); } };
    return { auth, from, rpc, storage, channel, payments, whatsapp };
  }

  window.supabase = { createClient };
})();

// Notification bell (site/bell.js): added for everyone who is signed in, on every page that loads this file.
(function () {
  try {
    if (!localStorage.getItem('auz_session') || window.__auzBell || document.querySelector('script[data-bell]')) return;
    var go = function () { var s = document.createElement('script'); s.src = '/bell.js?v=7'; s.defer = true; s.setAttribute('data-bell', '1'); document.head.appendChild(s); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go); else go();
  } catch (e) {}
})();
