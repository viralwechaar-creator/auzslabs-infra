/* When an app page is opened inside the combined app with ?embed=1, hide the app's own menu so only the chosen screen shows. */
(function () {
  try { if (!/[?&]embed=1/.test(location.search)) return; } catch (e) { return; }
  document.documentElement.classList.add('embed');
  var s = document.createElement('style');
  s.textContent = 'html.embed .side,html.embed .tabbar,html.embed .topbar,html.embed .navbar,html.embed #app>aside,html.embed #app>nav,html.embed .sidebar{display:none!important}' +
    'html.embed .shell,html.embed .app,html.embed .main{padding-left:0!important;margin-left:0!important;grid-template-columns:1fr!important}' +
    'html.embed .shell{grid-template-areas:none!important}html.embed body{padding-bottom:0!important}';
  document.head.appendChild(s);
})();
