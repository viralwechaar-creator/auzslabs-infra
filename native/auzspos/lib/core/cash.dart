// Cash-tendered/change arithmetic for the Pay screen, ported from the website's cashSheet() (pay.js).
// Kept as pure, free functions (no Session/HomeState/widget dependency) so the arithmetic and the "is this
// amount enough" rule are directly unit-testable, same split as core/stock.dart and core/reorder.dart.

/// Rounds to 2 decimal places, same rounding convention as r2() in core/billing.dart (kept separate here so
/// this file has no dependency beyond dart:core).
num _round2(num n) => (n * 100).round() / 100;

/// Change due for a cash tender against the amount owed. Negative means the tender is short.
num cashChange(num tendered, num due) => _round2(tendered - due);

/// A tendered amount is acceptable to confirm only when it is a real, positive number and covers the full
/// amount due -- native's Pay screen takes one tender per bill (no website-style partial/split tenders), so
/// unlike the website (which allows a short cash tender as a partial payment, left-to-pay shown for a second
/// tender), a short or invalid amount here must block Confirm outright: there is no way to leave the bill
/// half-paid from this screen.
bool cashTenderOk(num? tendered, num due) => tendered != null && tendered > 0 && tendered >= due;

/// Quick round-amount buttons: the exact amount due, plus rounding due up to the next 10/50/100/500, each
/// only shown if it is not less than due, deduplicated, capped at 5 -- same list shape as the website's
/// `quick` array in cashSheet().
List<num> quickCashAmounts(num due) {
  final set = <num>{due, for (final n in const [10, 50, 100, 500]) (due / n).ceil() * n};
  final list = set.where((v) => v >= due).toList()..sort();
  return list.take(5).toList();
}
