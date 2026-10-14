import 'package:shared_preferences/shared_preferences.dart';

/// Same wording and lists as site/orderterms.js (keep in step by hand).
const productLabels = <String, String>{
  'pos': 'AUZsPOS',
  'self_order': 'AUZsPOS QR',
  'payroll': 'AUZsPay',
  'accounting': 'AUZsLedger',
  'mobile': 'AUZsMob',
  'scan': 'AUZsScan',
  'salon': 'AUZslab Salon',
  'website_builder': 'Website Builder',
};

const nicheOptions = <(String, String)>[
  ('cafe', 'Cafe / restaurant / bar / bakery / hotel'),
  ('retail', 'Retail / general shop (books, clothing, general store)'),
  ('salon', 'Salon / spa'),
  ('mobile', 'Mobile phone shop / repair'),
  ('general', 'Something else'),
];

const stateNames = <String, String>{
  '01': 'Jammu and Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh', '05': 'Uttarakhand', '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh',
  '10': 'Bihar', '11': 'Sikkim', '12': 'Arunachal Pradesh', '13': 'Nagaland', '14': 'Manipur', '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya', '18': 'Assam', '19': 'West Bengal',
  '20': 'Jharkhand', '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh', '24': 'Gujarat', '26': 'Dadra and Nagar Haveli and Daman and Diu', '27': 'Maharashtra', '29': 'Karnataka',
  '30': 'Goa', '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry', '35': 'Andaman and Nicobar Islands', '36': 'Telangana', '37': 'Andhra Pradesh', '38': 'Ladakh',
};

/// Payment details, same as site/orderterms.js (the UPI id there is a placeholder until the owner confirms it).
const upiId = '8005673683-2@ybl';
const upiName = 'Mahendra';

const orderTerms = <(String, String)>[
  ('Refunds', 'Before setup: full refund minus a 1% transaction fee. Monthly, after setup: no refund of fees paid; billing stops when you cancel. Yearly, after setup: 20% refund within 6 months, none after. Onboarding/setup fees are non-refundable once begun. If our side fails you and we cannot fix it, we refund the period not provided. Full policy: auzslab.in/refund.html.'),
  ('Setup, changes and extras', 'A flat Rs 1,460 onboarding fee applies to every new client; a setup fee applies only for AUZsPOS/AUZsPOS QR. Salon setup/website, integrations and hardware are quoted separately. A small change after setup is a flat Rs 500, no GST; anything bigger is custom development, quoted first.'),
  ('Bug fixes', 'A bug in the software is always fixed free of charge, whenever it is found.'),
  ('Your data and backups', 'We take backups regularly but do not guarantee against server failure or data loss, so keep your own exports of anything critical (every app has export/backup tools).'),
  ('Support and calls', 'Support by WhatsApp and email in business hours is free. Extra phone or video calls, training sessions and on-site visits are charged, and the charge is agreed with you before we start.'),
  ('GST', 'GST is charged on the services at the rate shown. The GSTIN of both parties is printed on the bill. If you need input tax credit, give us your GSTIN before you pay: a bill cannot be changed after it is issued.'),
  ('Renewal', 'Each product renews on the date shown on the bill, monthly or yearly as bought. Pay the renewal on or before that date to keep the product running.'),
  ('Agreement', 'By paying you accept our Terms and Conditions, Privacy Policy and Refund Policy (auzslab.in/terms.html, privacy.html and refund.html).'),
];

/// The products picked for the next request, kept on the phone until it is sent.
class Cart {
  static const _k = 'hub.cart';
  static Future<List<String>> get() async => ((await SharedPreferences.getInstance()).getStringList(_k) ?? const <String>[]).where(productLabels.containsKey).toList();
  static Future<void> set(List<String> v) async => (await SharedPreferences.getInstance()).setStringList(_k, v);
  static Future<void> clear() => set(const []);
}

/// Mobile number check used by the request form (10 digits at least).
bool phoneOk(String s) => s.replaceAll(RegExp(r'\D'), '').length >= 10;
