// Company details used by the legal pages. Fill these in once the company is registered: every
// <span data-co="key"> on terms.html, privacy.html, refund.html and delete-account.html shows the value below.
// An empty value leaves the plain fallback sentence that is already written in the page.
(function () {
  var CO = {
    legalName: '',          // e.g. "AUZslab Technologies Private Limited"
    address: '',            // registered office address
    gstin: '',              // GST number, if registered
    cin: '',                // company registration number (CIN / LLPIN), if any
    grievanceName: 'Ashish Kumar Meena',
    grievanceEmail: 'helloauzslab@gmail.com',
    phone: '',              // support phone / WhatsApp
    court: ''               // city whose courts decide disputes, e.g. "Jodhpur, Rajasthan"
  };
  var nodes = document.querySelectorAll('[data-co]');
  for (var i = 0; i < nodes.length; i++) {
    var v = CO[nodes[i].getAttribute('data-co')];
    if (v) nodes[i].textContent = v;
  }
})();
