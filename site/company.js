// Company details used by the legal pages. Fill these in once the company is registered: every
// <span data-co="key"> on terms.html, privacy.html, refund.html and delete-account.html shows the value below.
// An empty value leaves the plain fallback sentence that is already written in the page.
(function () {
  var CO = {
    legalName: 'Mahendra, trading as AUZslab (sole proprietorship)',
    address: '3/21 DDP Nagar, Madhuban, Jodhpur 342005, Rajasthan',
    gstin: '08KALPM2374C1ZH',
    cin: '',                // company registration number (CIN / LLPIN) — not applicable, sole proprietorship
    grievanceName: 'Mahendra',
    grievanceEmail: 'helloauzslab@gmail.com',
    phone: '+91 8302723179',
    court: 'Jodhpur, Rajasthan'
  };
  var nodes = document.querySelectorAll('[data-co]');
  for (var i = 0; i < nodes.length; i++) {
    var v = CO[nodes[i].getAttribute('data-co')];
    if (v) nodes[i].textContent = v;
  }
  // <a data-wa> links ("Talk to us on WhatsApp") stay hidden until a support number is filled in above.
  var digits = String(CO.phone || '').replace(/\D/g, '');
  var was = document.querySelectorAll('[data-wa]');
  for (var j = 0; j < was.length; j++) {
    if (digits.length >= 10) was[j].href = 'https://wa.me/' + (digits.length === 10 ? '91' + digits : digits) + '?text=' + encodeURIComponent(was[j].getAttribute('data-wa') || 'Hi AUZslab');
    else was[j].hidden = true;
  }
})();
