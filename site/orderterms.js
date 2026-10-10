// Shared by the payment page (pay.html) and the A4 bill (inv.html): the wording of the terms, the payment details and the SAC code.
// Change a sentence here and both pages follow. Company name/address/GSTIN/phone come from company.js (window.AUZ_CO).
window.AUZ_ORDER = {
  version: '2026-10',
  sac: '9983',                                   // SAC printed on every service line (group 9983, IT and other professional services); confirm with your accountant
  upi: { id: '8005673683-2@ybl', name: 'Mahendra' },      // the UPI id the payment QR pays to
  bank: { holder: '', bank: '', account: '', ifsc: '', branch: '' },   // fill these in and they print on the payment page and the bill
  terms: [
    ['Refunds', 'Before setup is complete: full refund minus a 1% transaction fee. Monthly plans, after setup: no refund of fees already paid; billing simply stops when you cancel. Yearly plans, after setup: 20% refund if cancelled within 6 months of starting, none after that. The setup fee is not refundable once setup work has begun. If a problem on our side stops you using the service and we cannot fix it, we refund the period we could not provide. Full policy: auzslab.in/refund.html.'],
    ['Changes after setup', 'A small change (a label, a field, a setting) is a flat Rs 500 per request, no GST. Anything bigger (a new report, screen or workflow) is custom development, quoted and agreed with you first.'],
    ['Bug fixes', 'A bug in the software is always fixed free of charge, whenever it is found.'],
    ['Your data and backups', 'We take backups of your data regularly. We do not give a complete guarantee against failure of our server or its provider, including loss of service or data, so please keep your own exports of anything critical (every app has export and backup tools).'],
    ['Support and calls', 'Support by WhatsApp and email in business hours is free. Extra phone or video calls, training sessions and on-site visits are charged, and the charge is agreed with you before we start.'],
    ['GST', 'GST is charged on the services at the rate shown. The GSTIN of both parties is printed on the bill. If you need input tax credit, give us your GSTIN before you pay: a bill cannot be changed after it is issued.'],
    ['Renewal', 'Each product renews on the date shown on the bill, monthly or yearly as bought. Pay the renewal on or before that date to keep the product running.'],
    ['Agreement', 'By paying you accept our Terms and Conditions, Privacy Policy and Refund Policy (auzslab.in/terms.html, privacy.html and refund.html).'],
  ],
  labels: { pos: 'AUZsPOS', self_order: 'AUZsPOS QR', payroll: 'AUZsPay', accounting: 'AUZsLedger', mobile: 'AUZsMob', scan: 'AUZsScan', salon: 'AUZslab Salon', website_builder: 'Website Builder', crm: 'CRM', billing: 'Billing & Invoicing', inventory: 'Inventory' },
  states: { '01': 'Jammu and Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh', '05': 'Uttarakhand', '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh', '10': 'Bihar', '11': 'Sikkim', '12': 'Arunachal Pradesh', '13': 'Nagaland', '14': 'Manipur', '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya', '18': 'Assam', '19': 'West Bengal', '20': 'Jharkhand', '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh', '24': 'Gujarat', '26': 'Dadra and Nagar Haveli and Daman and Diu', '27': 'Maharashtra', '29': 'Karnataka', '30': 'Goa', '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry', '35': 'Andaman and Nicobar Islands', '36': 'Telangana', '37': 'Andhra Pradesh', '38': 'Ladakh' },
};
