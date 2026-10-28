/* Notification centre and settings (db/295). The page itself is shared: ds/alerts-ui.js. */
'use strict';
page('alerts', { title: 'Notifications', async render(v) {
  v.header({ title: 'Notifications', back: 'home' });
  if (!window.auzAlerts) { v.root.append(h('div', { class: 'muted' }, 'Notifications are not available.')); return; }
  auzAlerts.render(v.root);
} });
