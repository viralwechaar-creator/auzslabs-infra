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
// A platform alert with no specific page just opens the admin panel directly.
self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  var u = (e.notification.data && e.notification.data.url) || '';
  if (!u || u === '/start.html') u = 'https://auzslab.in/admin.html';
  e.waitUntil(clients.openWindow(u));
});
