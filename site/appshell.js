/* AUZslab in-app shell (store apps and desktop apps). Does nothing in an ordinary browser.
   Recognises the AUZslab apps by their user agent (AUZslabApp = Android/iOS wrapper, AUZslabDesktop = Windows/Mac wrapper) and then:
   1. adds html.in-app: no rubber-band bounce, no pull-to-refresh, no tap flash, no text-selection on chrome, so it feels like an app;
   2. shows a small "back to AUZslab" button on every page except the hub, so the marketing site, the account page and the admin panel
      (which live on another address) always have a way home;
   3. on iPhone/iPad (html.ios-app): no buying inside the app (Apple's rules): add-to-cart buttons are hidden and the cart/pay pages tell the
      person to finish on the website instead. Everything else (sign in, products, pricing, account, product apps, team, admin) is unchanged.
   Plain DOM, textContent only. A copy of this file lives in site/appshell.js (the marketing site is a different address): keep both identical. */
(function () {
  if (window.__auzShell) return; window.__auzShell = 1;
  var ua = navigator.userAgent || '';
  var app = /AUZslabApp/.test(ua), desktop = /AUZslabDesktop/.test(ua);
  var test = /[?&]inapp=(1|ios)\b/.test(location.search);
  if (!app && !desktop && !test) return;
  var ios = (app && /iPhone|iPad|iPod|Macintosh/.test(ua)) || /[?&]inapp=ios\b/.test(location.search);
  var root = document.documentElement;
  root.classList.add('in-app'); if (ios) root.classList.add('ios-app'); if (desktop) root.classList.add('desktop-app');

  var css = document.createElement('style');
  css.textContent =
    'html.in-app,html.in-app body{overscroll-behavior:none}' +
    'html.in-app *{-webkit-tap-highlight-color:transparent}' +
    'html.in-app body{-webkit-touch-callout:none}' +
    'html.in-app :not(input):not(textarea):not([contenteditable]):not(pre):not(code){-webkit-user-select:none;user-select:none}' +
    'html.in-app input,html.in-app textarea,html.in-app [contenteditable]{-webkit-user-select:text;user-select:text}' +
    'html.in-app img{-webkit-user-drag:none}' +
    '.auz-hub-pill{position:fixed;left:12px;bottom:calc(86px + env(safe-area-inset-bottom));z-index:60;width:44px;height:44px;border-radius:50%;border:0;padding:0;' +
    'background:#2e2c2a;color:#f5efe6;display:flex;align-items:center;justify-content:center;box-shadow:0 8px 18px -10px rgba(46,44,42,.6);cursor:pointer}' +
    '.auz-hub-pill:active{transform:scale(.94)}.auz-hub-pill svg{width:22px;height:22px}' +
    'html.desktop-app .auz-hub-pill{bottom:24px}' +
    'html.ios-app [data-add],html.ios-app [data-product],html.ios-app a[href$="cart.html"],html.ios-app a[href*="cart.html?"]{display:none!important}' +
    '.auz-ios-buy{position:fixed;inset:0;z-index:2147483000;background:#f5f4f2;color:#171717;display:flex;align-items:center;justify-content:center;padding:24px;font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}' +
    '.auz-ios-buy div{max-width:380px;text-align:center}.auz-ios-buy h1{font-size:22px;margin:0 0 8px}.auz-ios-buy p{margin:0 0 16px;color:#6a625b}' +
    '.auz-ios-buy a,.auz-ios-buy button{display:inline-flex;align-items:center;justify-content:center;min-height:46px;padding:0 20px;border-radius:12px;border:0;background:#800020;color:#fff;font:600 16px inherit;text-decoration:none;cursor:pointer;margin:4px}';
  (document.head || root).appendChild(css);

  function b64(o) { return btoa(unescape(encodeURIComponent(JSON.stringify(o)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
  function hubUrl() {
    var u = 'https://app.auzslab.in/start.html';
    try {
      var s = JSON.parse(localStorage.getItem('auz_session') || 'null');
      if (s && s.access_token && s.user) u += '#auz_gt=' + b64({ t: s.access_token, u: s.user });
    } catch (e) { /* no session */ }
    return u;
  }


  // Google sign-in runs in the system browser and comes back as auzslab://signin#auz_gt=...: hand it to the hub, which stores it.
  function takeLink(u) {
    var m = /[#&]auz_gt=([^&\s]+)/.exec(u || ''); if (!m) return;
    try { var C = window.Capacitor; if (C && C.Plugins && C.Plugins.Browser && C.Plugins.Browser.close) C.Plugins.Browser.close(); } catch (e) { /* ignore */ }
    location.href = 'https://app.auzslab.in/start.html#auz_gt=' + m[1];
  }
  try { var Cap = window.Capacitor; if (Cap && Cap.Plugins && Cap.Plugins.App && Cap.Plugins.App.addListener) Cap.Plugins.App.addListener('appUrlOpen', function (e) { takeLink(e && e.url); }); } catch (e) { /* no plugin */ }

  function ready(fn) { if (document.body) fn(); else document.addEventListener('DOMContentLoaded', fn); }
  ready(function () {
    // 1. the way home (not on the hub itself)
    if (!/\/start\.html$/.test(location.pathname)) {
      var b = document.createElement('button'); b.type = 'button'; b.className = 'auz-hub-pill'; b.setAttribute('aria-label', 'Back to AUZslab');
      b.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 11.2 12 4l8.5 7.2"/><path d="M5.5 9.6V19a1.5 1.5 0 0 0 1.5 1.5h10a1.5 1.5 0 0 0 1.5-1.5V9.6"/></svg>';
      b.onclick = function () { location.href = hubUrl(); };
      document.body.appendChild(b);
    }
    // 2. iPhone/iPad: no buying in the app
    if (ios && /\/(cart|pay|checkout)\.html$/.test(location.pathname)) {
      var o = document.createElement('div'); o.className = 'auz-ios-buy';
      var inner = document.createElement('div');
      var h = document.createElement('h1'); h.textContent = 'Finish on our website';
      var p = document.createElement('p'); p.textContent = 'To ask for products, get a quote or pay, open auzslab.in in your browser. Your account and everything you already have stay right here in the app.';
      var home = document.createElement('button'); home.type = 'button'; home.textContent = 'Back to AUZslab'; home.onclick = function () { location.href = hubUrl(); };
      inner.append(h, p, home); o.appendChild(inner); document.body.appendChild(o);
    }
  });
})();
