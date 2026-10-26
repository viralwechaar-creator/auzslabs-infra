// Browser alerts for people on auzslab.in (admin panel, clients, team). The shop apps have their own /sw.js on their own addresses.
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });
self.addEventListener('push', function (e) {
  var d = {};
  try { d = e.data.json(); } catch (x) {}
  e.waitUntil(self.registration.showNotification(d.title || 'AUZslab', {
    body: d.body || '', icon: '/apple-touch-icon.png', badge: '/favicon-192.png', tag: d.tag || 'auz', renotify: true,
    data: { url: d.url || '' }
  }));
});
// The hub on app.auzslab.in sends each person to their own place (admin, team workspace, client requests).
self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  var u = (e.notification.data && e.notification.data.url) || '';
  if (!u || u === '/start.html') u = 'https://app.auzslab.in/start.html';
  e.waitUntil(clients.openWindow(u));
});
