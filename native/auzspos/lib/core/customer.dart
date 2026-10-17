/// Customer CRM + loyalty helpers -- exact ports of digits()/custHistory()/netOf()/refundedOf()/
/// loyaltyOf() in the website's pos/core.js, used by actions.dart's customerSheet().
library;

import 'billing.dart' show r2;

String digitsOnly(String s) => s.replaceAll(RegExp(r'[^0-9]'), '');

/// 15-character GSTIN: a 2-digit state code then 13 letters/digits, same regex as sell.js's `customerSheet`.
bool isValidGstin(String gst) => RegExp(r'^[0-9]{2}[A-Z0-9]{13}$').hasMatch(gst);

num refundedOf(Map<String, dynamic> o) => r2(((o['refunds'] as List?) ?? const []).fold<num>(0, (a, r) => a + (((r as Map)['amt'] as num?) ?? 0)));

num netOf(Map<String, dynamic> o) => r2((((o['t'] as Map?)?['total'] as num?) ?? 0) - refundedOf(o));

/// Every paid/due order for this phone, excluding [exceptId] (the order currently open, which has not
/// actually happened yet) -- same filter as custHistory() in the website's pos/core.js.
List<Map<String, dynamic>> custHistory(Iterable<Map<String, dynamic>> orders, String phone, String? exceptId) {
  final p = digitsOnly(phone);
  if (p.length < 10) return const [];
  return orders.where((o) => '${o['id']}' != exceptId && (o['status'] == 'paid' || o['status'] == 'due') && digitsOnly('${(o['cust'] as Map?)?['phone'] ?? ''}') == p).toList();
}

class LoyaltySummary {
  LoyaltySummary(this.visits, this.lifetime, this.points);
  final int visits;
  final num lifetime;
  final int points;
}

/// Port of loyaltyOf(): visits, lifetime net spend and loyalty points for a phone's order history
/// (always excluding the order currently open). [earnPerRs] is the business's `loyaltyEarnRs` setting
/// (every ₹N spent = 1 point; defaults to 100, same as the website).
LoyaltySummary loyaltySummary(Iterable<Map<String, dynamic>> orders, String phone, String? exceptId, {num earnPerRs = 100}) {
  final hist = custHistory(orders, phone, exceptId);
  final lifetime = r2(hist.fold<num>(0, (a, o) => a + netOf(o)));
  final redeemed = hist.fold<num>(0, (a, o) => a + ((o['loyaltyRedeemed'] as num?) ?? 0));
  final earn = earnPerRs > 0 ? earnPerRs : 100;
  final points = ((lifetime / earn).floor() - redeemed) < 0 ? 0 : ((lifetime / earn).floor() - redeemed).toInt();
  return LoyaltySummary(hist.length, lifetime, points);
}
