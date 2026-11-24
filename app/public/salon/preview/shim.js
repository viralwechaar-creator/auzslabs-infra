/* Theme preview for the Salon website. On auzslab.in (never on a business address) the salon pages read their data from
   a fixed sample file instead of a salon's own API, so the preview is a template, not any client's live website. */
(function () {
  if (!/^(www\.)?auzslab\.in$/.test(location.hostname) && !/[?&]preview=1/.test(location.search)) return;
  var real = window.fetch.bind(window);
  var json = function (body, status) { return Promise.resolve(new Response(JSON.stringify(body), { status: status || 200, headers: { 'Content-Type': 'application/json' } })); };
  window.fetch = function (u, o) {
    var s = String(u);
    if (s.indexOf('/api/site') === 0) {
      return real('/salon/preview/site.json').then(function (r) { return r.json(); }).then(function (d) { d.today = new Date().toISOString().slice(0, 10); return json(d); });
    }
    if (s.indexOf('/api/slots') === 0) {
      var slots = []; for (var m = 10 * 60; m < 20 * 60; m += 30) { var t = String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); slots.push({ time: t, free: (m / 30) % 5 !== 0 }); }
      return json({ closed: false, slots: slots });
    }
    if (s.indexOf('/api/bookings') === 0) return json({ error: 'This is a preview template. Booking is switched off here.' }, 400);
    return real(u, o);
  };
})();
