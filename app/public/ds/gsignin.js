/* "Continue with Google" for the staff apps. Google only allows fixed web addresses, so the real sign-in runs on one central page
   (https://auzslab.in/signin.html) and sends the user back here with the session. auzGoogleLink(hostElement, 'pos'|'payroll'|'accounts'|'mob'). */
(function () {
  window.auzGoogleLink = function (host, app) {
    if (!host) return;
    var back = location.origin + location.pathname + location.search;
    var a = document.createElement('a');
    a.href = 'https://auzslab.in/signin.html?app=' + encodeURIComponent(app || '') + '&return=' + encodeURIComponent(back);
    a.setAttribute('aria-label', 'Continue with Google');
    a.style.cssText = 'display:flex;align-items:center;justify-content:center;gap:10px;box-sizing:border-box;width:100%;min-height:44px;padding:0 14px;border:1px solid var(--sep,#ddd);border-radius:12px;background:var(--bg,#fff);color:var(--label,#171717);font:600 15px var(--font,system-ui);text-decoration:none';
    a.innerHTML = '<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.6 5.9c4.4-4.1 7-10.1 7-17.6z"/><path fill="#FBBC05" d="M10.5 28.7c-.5-1.5-.8-3.1-.8-4.7s.3-3.2.8-4.7l-7.9-6.1C.9 16.4 0 20.1 0 24s.9 7.6 2.6 10.8l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.6-5.9c-2.1 1.4-4.9 2.3-8.3 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z"/></svg><span>Continue with Google</span>';
    host.textContent = ''; host.appendChild(a);
  };
})();
