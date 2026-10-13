/* AUZslab marketing-site opening (same motion as the hub's app/public/ds/launch-hub.js, kept as a separate copy).
   Plays once per browser session on the first marketing page, never inside the store/desktop apps (the hub already
   opened them), and not for automated browsers unless the address has ?intro=1. Hides when the page has loaded
   (min about 2.6 s, max 4 s); calm under reduced motion. */
(function () {
  var q = location.search.indexOf('intro=1') > -1;
  if (document.getElementById('auz-launch')) return;
  if (!q) {
    if (/AUZslab(App|Desktop)/.test(navigator.userAgent) || navigator.webdriver) return;
    try { if (sessionStorage.getItem('auz.intro')) return; sessionStorage.setItem('auz.intro', '1'); } catch (e) { /* private mode: play anyway */ }
  }
  var still = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var root = document.documentElement; root.classList.add('auz-wait');
  var css = document.createElement('style');
  css.textContent = '#auz-launch{position:fixed;inset:0;z-index:2147483000;background:#171717;display:flex;align-items:center;justify-content:center;flex-direction:column;overflow:hidden;clip-path:circle(150% at 50% 50%);transition:clip-path .75s cubic-bezier(.65,0,.2,1)}'
    + '#auz-launch.out{clip-path:circle(0% at 50% 56%);pointer-events:none}'
    + '#auz-launch .dots{position:absolute;inset:-10%;background-image:radial-gradient(rgba(255,255,255,.07) 1.2px,transparent 1.4px);background-size:26px 26px;opacity:0;animation:ah-fade 1.2s ease .1s forwards,ah-drift 14s linear infinite}'
    + '#auz-launch .glow{position:absolute;width:640px;height:640px;max-width:150vw;border-radius:50%;background:radial-gradient(closest-side,rgba(194,24,63,.42),rgba(194,24,63,0));opacity:0;animation:ah-glow 2.4s ease-out .2s forwards}'
    + '#auz-launch .orbit{position:absolute;width:0;height:0;animation:ah-spin 1.25s cubic-bezier(.55,.05,.35,1) .15s both}'
    + '#auz-launch .orbit i{position:absolute;left:-9px;top:-9px;width:18px;height:18px;border-radius:5px;background:var(--c);transform:rotate(var(--a)) translateX(var(--r));animation:ah-pull 1.25s cubic-bezier(.55,.05,.35,1) .15s both}'
    + '#auz-launch .ring{position:absolute;width:40px;height:40px;border-radius:50%;border:2px solid rgba(232,54,93,.9);opacity:0;animation:ah-ring 1.1s cubic-bezier(.2,.7,.2,1) 1.3s forwards}'
    + '#auz-launch .ring.two{border-color:rgba(255,255,255,.35);animation-delay:1.45s}'
    + '#auz-launch .logo{position:relative;width:min(64vw,300px);height:auto;filter:invert(1);clip-path:inset(0 100% 0 0);opacity:0;animation:ah-scan .9s steps(16,end) 1.35s forwards}'
    + '#auz-launch .scan{position:absolute;width:3px;height:92px;background:#e8365d;box-shadow:0 0 18px 4px rgba(232,54,93,.55);opacity:0;left:calc(50% - min(32vw,150px));animation:ah-bar .9s steps(16,end) 1.35s forwards}'
    + '#auz-launch .tag{position:relative;margin-top:22px;color:rgba(246,244,241,.78);font:500 14px/1 -apple-system,BlinkMacSystemFont,"SF Pro Display","Helvetica Neue",Arial,sans-serif;letter-spacing:.14em;text-transform:uppercase;opacity:0;transform:translateY(8px);animation:ah-up .6s ease 2.15s forwards}'
    + '#auz-launch .tag b{color:#e8365d;font-weight:600}'
    + '@keyframes ah-fade{to{opacity:1}}@keyframes ah-drift{to{transform:translate(26px,26px)}}'
    + '@keyframes ah-glow{0%{opacity:0;transform:scale(.5)}45%{opacity:1}100%{opacity:.6;transform:scale(1)}}'
    + '@keyframes ah-spin{from{transform:rotate(-200deg)}to{transform:rotate(0)}}'
    + '@keyframes ah-pull{0%{opacity:0;--r:150px;transform:rotate(var(--a)) translateX(150px) scale(.4)}25%{opacity:1}100%{opacity:0;transform:rotate(var(--a)) translateX(0) scale(.2)}}'
    + '@keyframes ah-ring{0%{opacity:.95;transform:scale(.3)}100%{opacity:0;transform:scale(11)}}'
    + '@keyframes ah-scan{0%{opacity:1;clip-path:inset(0 100% 0 0)}100%{opacity:1;clip-path:inset(0 0 0 0)}}'
    + '@keyframes ah-bar{0%{opacity:1;transform:translateX(0)}92%{opacity:1}100%{opacity:0;transform:translateX(min(64vw,300px))}}'
    + '@keyframes ah-up{to{opacity:1;transform:none}}'
    + '@media (prefers-reduced-motion:reduce){#auz-launch *{animation:none!important}#auz-launch .logo{clip-path:none;opacity:1}#auz-launch .tag{opacity:1;transform:none}#auz-launch .orbit,#auz-launch .ring,#auz-launch .scan{display:none}#auz-launch{transition:opacity .3s}#auz-launch.out{clip-path:none;opacity:0}}';
  document.head.appendChild(css);
  var el = document.createElement('div'); el.id = 'auz-launch'; el.setAttribute('aria-hidden', 'true');
  var cols = ['#c2183f', '#8c2840', '#e8365d', '#f6f4f1', '#5c3340'], orbit = '';
  for (var i = 0; i < 5; i++) orbit += '<i style="--a:' + (i * 72) + 'deg;--r:150px;--c:' + cols[i] + '"></i>';
  el.innerHTML = '<div class="dots"></div><div class="glow"></div><div class="orbit">' + orbit + '</div><div class="ring"></div><div class="ring two"></div>'
    + '<img class="logo" src="/logo.png" alt=""><div class="scan"></div><div class="tag">All your apps<b>.</b> One place<b>.</b></div>';
  root.appendChild(el);
  var minDone = false, appDone = false, gone = false;
  function reveal() { root.classList.remove('auz-wait'); }
  function hide() { if (gone) return; gone = true; el.classList.add('out'); setTimeout(reveal, still ? 0 : 260); setTimeout(function () { el.remove(); css.remove(); reveal(); }, still ? 400 : 900); }
  function tryHide() { if (minDone && appDone) hide(); }
  setTimeout(function () { minDone = true; tryHide(); }, still ? 400 : 2600);
  setTimeout(hide, 4000);
  function watch() { if (document.readyState === 'complete') { appDone = true; tryHide(); } else window.addEventListener('load', function () { appDone = true; tryHide(); }); }
  if (document.body) watch(); else document.addEventListener('DOMContentLoaded', watch);
})();
