// Client-side error tracking (Sentry Browser SDK). Dormant until
// window.CFG.sentryDsn is set -- same discipline as every other optional
// integration (googleClientId/appleClientId above it in config.js): with
// no DSN, this file does nothing at all, not even load the CDN script.
(function () {
  var dsn = (window.CFG || {}).sentryDsn;
  if (!dsn) return;
  var s = document.createElement('script');
  s.src = 'https://browser.sentry-cdn.com/8.47.0/bundle.min.js';
  s.crossOrigin = 'anonymous';
  s.onload = function () {
    if (!window.Sentry) return;
    window.Sentry.init({
      dsn: dsn,
      environment: location.hostname,
      // Error-only, same as the server side (server/src/errors.js) -- no
      // session replay or performance tracing, which would cost quota
      // on Sentry's free tier for little benefit on a small product.
      tracesSampleRate: 0,
    });
  };
  document.head.appendChild(s);
})();
