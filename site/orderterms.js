// Shared by the payment page (pay.html) and the A4 bill (inv.html): the wording of the terms, the payment details and the SAC code.
// Change a sentence here and both pages follow. Company name/address/GSTIN/phone come from company.js (window.AUZ_CO).
window.AUZ_ORDER = {
  version: '2026-10',
  sac: '9983',                                   // SAC printed on every service line (group 9983, IT and other professional services); confirm with your accountant
  upi: { id: '8005673683-2@ybl', name: 'Mahendra' },      // the UPI id the payment QR pays to -- left unchanged when the contact number was updated: this is a live payment VPA, a different thing from the support/display number, and changing it needs the owner's explicit confirmation it's still valid
  bank: { holder: '', bank: '', account: '', ifsc: '', branch: '' },   // fill these in and they print on the payment page and the bill
  terms: [
    ['Refunds', 'Before setup: full refund minus a 1% transaction fee. Monthly, after setup: no refund of fees paid; billing stops when you cancel. Yearly, after setup: 20% refund within 6 months, none after. Onboarding/setup fees are non-refundable once begun. If our side fails you and we cannot fix it, we refund the period not provided. Full policy: auzslab.in/refund.html.'],
    ['Setup, changes and extras', 'A flat Rs 1,460 onboarding fee applies to every new client; a setup fee applies only for AUZsPOS/AUZsPOS QR. Salon setup/website, integrations and hardware are quoted separately. A small change after setup is a flat Rs 500, no GST; anything bigger is custom development, quoted first.'],
    ['Bug fixes', 'A bug in the software is always fixed free of charge, whenever it is found.'],
    ['Your data and backups', 'We take backups regularly but do not guarantee against server failure or data loss, so keep your own exports of anything critical (every app has export/backup tools).'],
    ['Support and calls', 'Support by WhatsApp and email in business hours is free. Extra phone or video calls, training sessions and on-site visits are charged, and the charge is agreed with you before we start.'],
    ['GST', 'GST is charged on the services at the rate shown. The GSTIN of both parties is printed on the bill. If you need input tax credit, give us your GSTIN before you pay: a bill cannot be changed after it is issued.'],
    ['Renewal', 'Each product renews on the date shown on the bill, monthly or yearly as bought. Pay the renewal on or before that date to keep the product running.'],
    ['Agreement', 'By paying you accept our Terms and Conditions, Privacy Policy and Refund Policy (auzslab.in/terms.html, privacy.html and refund.html).'],
  ],
  labels: { pos: 'AUZsPOS', self_order: 'AUZsPOS QR', payroll: 'AUZsPay', accounting: 'AUZsLedger', mobile: 'AUZsMob', scan: 'AUZsScan', salon: 'AUZslab Salon', website_builder: 'Website Builder', crm: 'CRM', billing: 'Billing & Invoicing', inventory: 'Inventory' },
  states: { '01': 'Jammu and Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh', '05': 'Uttarakhand', '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh', '10': 'Bihar', '11': 'Sikkim', '12': 'Arunachal Pradesh', '13': 'Nagaland', '14': 'Manipur', '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya', '18': 'Assam', '19': 'West Bengal', '20': 'Jharkhand', '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh', '24': 'Gujarat', '26': 'Dadra and Nagar Haveli and Daman and Diu', '27': 'Maharashtra', '29': 'Karnataka', '30': 'Goa', '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry', '35': 'Andaman and Nicobar Islands', '36': 'Telangana', '37': 'Andhra Pradesh', '38': 'Ladakh' },
};
