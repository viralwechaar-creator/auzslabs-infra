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

/// Which existing `customer` profile a customerSheet() Save should merge the typed field values onto:
/// the profile for the phone actually being saved under (looked up fresh), unless it is unchanged
/// from the phone the sheet opened with, in which case the already-loaded profile is reused (avoids
/// a redundant lookup in the common case where the cashier never touched the phone field).
///
/// Getting this wrong -- spreading the ORIGINAL phone's profile onto a record saved under a
/// DIFFERENT phone, because the cashier corrected/changed the number before saving -- silently
/// carries one customer's stored fields (tags, DOB, email, favourite/opt-out...) onto a different
/// phone's record, corrupting whichever customer already exists there (or inventing a confusing
/// mix if none did). Found tracing the real save path in actions.dart's customerSheet() during the
/// integration-verification pass; fixed by calling this instead of spreading a captured variable.
Map<String, dynamic>? profileToMergeOnSave({
  required String openedPhoneDigits,
  required String savingPhoneDigits,
  required Map<String, dynamic>? openedProfile,
  required Map<String, dynamic>? Function(String) lookup,
}) =>
    savingPhoneDigits == openedPhoneDigits ? openedProfile : lookup(savingPhoneDigits);

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
