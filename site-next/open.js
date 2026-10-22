// "Open your shop": the front door of the store apps. The apps live on each business's own address
// (<shop>.auzslab.in), so a phone app first needs to know which shop to open. The answer is remembered
// on the device; ?app=<name> then goes straight to that app, ?app=hub shows every app for the shop.
(function () {
  var KEY = 'auz.shop';
  var APPS = {
    pos:      { path: '/',              name: 'POS',        note: 'Billing, tables and kitchen' },
    mob:      { path: '/mob.html',      name: 'AUZsMob',    note: 'Phone stock, sales and repairs' },
    payroll:  { path: '/payroll.html',  name: 'Payroll',    note: 'Attendance, salary and leave' },
    accounts: { path: '/accounts.html', name: 'Accounting', note: 'Invoices, GST and reports' },
    console:  { path: '/dashboard.html', name: 'Admin console', note: 'Reports and settings' },
    salon:    { path: '/salon/admin/',  name: 'Salon',      note: 'Bookings, billing and clients' },
    builder:  { path: '/builder.html',  name: 'Website builder', note: 'Edit your shop website' }
  };
  var qs = new URLSearchParams(location.search);
  var app = qs.get('app') || 'hub';
  var $ = function (id) { return document.getElementById(id); };
  function saved() { try { return localStorage.getItem(KEY) || ''; } catch (e) { return ''; } }
  function save(s) { try { localStorage.setItem(KEY, s); } catch (e) {} }
  function forget() { try { localStorage.removeItem(KEY); } catch (e) {} }
  function clean(v) {
    v = String(v || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\.auzslab\.in.*$/, '').replace(/[^a-z0-9-]/g, '');
    return /^[a-z0-9][a-z0-9-]{1,40}$/.test(v) ? v : '';
  }
  function target(slug, a) { return 'https://' + slug + '.auzslab.in' + (APPS[a] ? APPS[a].path : '/'); }

  function showHub(slug) {
    $('pick').classList.add('hide'); $('hub').classList.remove('hide'); $('change').classList.remove('hide');
    $('newShop').classList.add('hide');
    $('hubSub').textContent = slug + '.auzslab.in';
    var t = $('tiles'); t.textContent = '';
    Object.keys(APPS).forEach(function (k) {
      var a = document.createElement('a'); a.className = 'tile'; a.href = target(slug, k);
      var n = document.createElement('span'); n.textContent = APPS[k].name;
      var s = document.createElement('small'); s.textContent = APPS[k].note;
      a.appendChild(n); a.appendChild(s); t.appendChild(a);
    });
  }
  function showPick() { $('hub').classList.add('hide'); $('pick').classList.remove('hide'); $('change').classList.add('hide'); $('newShop').classList.remove('hide'); setTimeout(function () { $('slug').focus(); }, 50); }

  var slug = saved();
  if (qs.get('change') === '1') { forget(); slug = ''; }
  if (slug) {
    if (APPS[app]) { location.replace(target(slug, app)); return; }
    showHub(slug);
  } else showPick();

  $('change').onclick = function (e) { e.preventDefault(); forget(); showPick(); };

  $('form').onsubmit = async function (e) {
    e.preventDefault();
    var err = $('err'); err.textContent = '';
    var s = clean($('slug').value);
    if (!s) { err.textContent = 'Type the shop name, using letters, numbers or a dash.'; return; }
    var btn = $('go'); btn.disabled = true; btn.textContent = 'Checking...';
    try {
      var sb = supabase.createClient(CFG.url, CFG.key);
      var r = await sb.rpc('public_menu', { tenant_slug: s });
      if (r.error || !r.data || !r.data.cfg || !Object.keys(r.data.cfg).length) throw new Error('nf');
      save(s);
      if (APPS[app]) location.replace(target(s, app)); else showHub(s);
    } catch (x) {
      err.textContent = 'We could not find a shop called "' + s + '". Check the spelling, or ask the owner for the exact name.';
    } finally { btn.disabled = false; btn.textContent = 'Open'; }
  };
})();
