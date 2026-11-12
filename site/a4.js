/* Live demo: app dock icons + a device that previews the chosen app */
(function () {
  var wrap = document.querySelector('.dm-wrap'); if (!wrap) return;
  var list = wrap.querySelector('.dm-list'), card = wrap.querySelector('.dm-card');
  var btns = Array.prototype.slice.call(list.querySelectorAll('button'));
  var META = {
    pos: ['auzspos.auzslab.in', '#800020', ['Table 4', 'Cappuccino', 'Club sandwich', 'Bill ready']],
    pay: ['auzspay.auzslab.in', '#1f6f5c', ['This week', 'Mon 8h', 'Tue 9h', 'Run payroll']],
    ledger: ['auzsledger.auzslab.in', '#2b4cc7', ['Trial balance', 'Debit', 'Credit', 'Books balance']],
    mob: ['auzsmob.auzslab.in', '#c26a00', ['New sale', 'IMEI 3521', 'Repair #14', 'Profit today']],
    scan: ['auzsscan.auzslab.in', '#6a3fb5', ['Scan to bill', 'Item added', 'GST 18%', 'Invoice sent']],
    style: ['auzsstyle.auzslab.in', '#111111', ['Sizes', 'M  L  XL', 'Blue / Black', 'Tag printed']],
    finance: ['auzsfinance.auzslab.in', '#0f5a56', ['Money in', 'Money out', 'Owner loan', 'Balance']],
    salon: ['showoffsalon.auzslab.in', '#7a2e5a', ['Bookings', '11:30 Priya', '13:00 Rohan', 'Bill sent']]
  };
  btns.forEach(function (b) {
    var name = (b.querySelector('b') || b).textContent.replace(/^AUZs(lab\s)?/i, '');
    var ic = document.createElement('i'); ic.className = 'dk-ic'; ic.textContent = name.charAt(0).toUpperCase();
    b.insertBefore(ic, b.firstChild);
  });
  var dv = document.createElement('div'); dv.className = 'dv';
  dv.innerHTML = '<div class="dv-bar"><i></i><i></i><i></i><span class="dv-url"></span></div><div class="dv-scr"><aside><u></u><u></u><u></u><u></u></aside><main><h4></h4><div class="dv-r"><span></span><i></i></div><div class="dv-r"><span></span><i></i></div><div class="dv-r"><span></span><i></i></div><div class="dv-tot"><span></span><em></em></div></main></div>';
  wrap.insertBefore(dv, card);
  function sync() {
    var on = list.querySelector('button.on'); if (!on) return;
    var id = on.getAttribute('data-id'), m = META[id] || META.pos;
    wrap.style.setProperty('--ac', m[1]);
    dv.querySelector('.dv-url').textContent = m[0];
    dv.querySelector('h4').textContent = m[2][0];
    var sp = dv.querySelectorAll('.dv-r span'); for (var i = 0; i < 3; i++) sp[i].textContent = m[2][i + 1] || '';
    dv.querySelector('.dv-tot span').textContent = m[2][3];
    dv.classList.remove('flip'); void dv.offsetWidth; dv.classList.add('flip');
  }
  var mo = new MutationObserver(sync);
  btns.forEach(function (b) { mo.observe(b, { attributes: true, attributeFilter: ['class'] }); });
  sync();
})();
