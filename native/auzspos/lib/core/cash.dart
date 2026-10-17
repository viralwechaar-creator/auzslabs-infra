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

/// The physical notes/coins counted when closing a REGISTER -- same list as CASH_DENOMS in the
/// website's pos/pay.js (reused by register.js's own closeRegister()). No ₹2000 note: that
/// denomination only appears in the separate Day Close count below.
const List<int> cashDenoms = [500, 200, 100, 50, 20, 10, 5, 2, 1];

/// The physical notes/coins counted when closing a DAY -- same list as NOTES in the website's
/// app/public/console/p-finance.js denomForm(), which does include ₹2000.
const List<int> dayCloseDenoms = [2000, 500, 200, 100, 50, 20, 10, 5, 2, 1];

/// Total value of a denomination count {note/coin value: quantity} -- the same running arithmetic
/// recalc()/upd() keep live on the website as each count field changes. A missing or non-positive
/// count for a denomination contributes nothing, never throws.
num denomTotal(Map<int, int> counts) => _round2(counts.entries.fold<num>(0, (a, e) => a + e.key * (e.value > 0 ? e.value : 0)));
