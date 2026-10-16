import 'billing.dart' show r2;
import 'repo.dart';

// Reorder suggestions and expiry tracking, ported from the website's invReport('reorder'/'expiry')
// (app/public/console/p-inventory.js). Kept as pure, free functions over a Repo (not a widget/HomeState
// method) so the business rules are directly unit-testable, same split as stock.dart/cash.dart/reorder.dart.
//
// No new record fields or kinds: everything here reads fields the website's own `ing` record already
// carries (qty, low, cost, unit, expiry, usage[]). `usage` is already appended to by stock.dart's
// deduRecipe() on every sale, so a tenant that has been selling through the native app already has real
// velocity data to compute from -- nothing here is invented.

String dayKeyOf(DateTime d) => '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

/// qty <= low (low defaults to 0 when absent, same as the website's lowIng() -- an ingredient with no
/// threshold set is only flagged once it actually hits zero or below, never "always flagged").
bool isLowStock(Map<String, dynamic> g) => ((g['qty'] ?? 0) as num) <= ((g['low'] ?? 0) as num);

/// expiry set, due within 7 days, AND there is still stock to use up (an ingredient already at zero has
/// nothing left to lose, so it is not "expiring soon" -- same as the website's expSoon()).
bool isExpiringSoon(Map<String, dynamic> g, {DateTime? now}) {
  final exp = '${g['expiry'] ?? ''}';
  if (exp.isEmpty) return false;
  final cutoff = dayKeyOf((now ?? DateTime.now()).add(const Duration(days: 7)));
  return exp.compareTo(cutoff) <= 0 && ((g['qty'] ?? 0) as num) > 0;
}

bool isExpired(Map<String, dynamic> g, {DateTime? now}) {
  final exp = '${g['expiry'] ?? ''}';
  if (exp.isEmpty) return false;
  return exp.compareTo(dayKeyOf(now ?? DateTime.now())) < 0;
}

num stockValue(Map<String, dynamic> g) => r2(((g['qty'] ?? 0) as num) * ((g['cost'] ?? 0) as num));

/// One raw material's reorder figures: daily usage (14-day rolling average, same window as the website),
/// days of stock left at that rate, and the suggested order quantity (one week's worth at the measured
/// rate, or -- with no sales history yet -- enough to top back up to twice the low-stock threshold).
class ReorderRow {
  ReorderRow(this.ing, this.dailyUse, this.daysLeft, this.suggestedQty);
  final Map<String, dynamic> ing;
  final num dailyUse;
  final int? daysLeft;
  final num suggestedQty;
}

/// Same formula as the website's invReport('reorder'): a 14-day usage window, a 1-14 day span (so one
/// stray usage entry right at the edge of the window never divides by a span less than a day or more than
/// the window itself), filtered to materials that are already low OR will run out within a week.
List<ReorderRow> reorderRows(Repo repo, {DateTime? now}) {
  final n = now ?? DateTime.now();
  final cutoff = dayKeyOf(n.subtract(const Duration(days: 14)));
  final out = <ReorderRow>[];
  for (final g in repo.of('ing')) {
    final usage = ((g['usage'] as List?) ?? const []).cast<Map>();
    final rc = usage.where((u) => '${u['d'] ?? ''}'.compareTo(cutoff) >= 0).toList();
    num vel = 0;
    if (rc.isNotEmpty) {
      final first = DateTime.tryParse('${rc.first['d']}');
      final span = first == null ? 1 : n.difference(first).inDays + 1;
      final clamped = span < 1 ? 1 : (span > 14 ? 14 : span);
      final used = rc.fold<num>(0, (a, u) => a + ((u['q'] ?? 0) as num));
      vel = r2(used / clamped);
    }
    final dl = vel > 0 ? (((g['qty'] ?? 0) as num) / vel).floor() : null;
    final sug = vel > 0 ? (vel * 7).ceil() : (((g['low'] ?? 0) as num) * 2 - ((g['qty'] ?? 0) as num)).clamp(0, double.infinity);
    if (isLowStock(g) || (dl != null && dl <= 7)) out.add(ReorderRow(g, vel, dl, sug));
  }
  return out;
}

/// Materials with an expiry date set, soonest first. Never fabricates a date for a material that has none
/// -- the website's own expiry tab only ever shows materials where `g.expiry` is already set, and so does
/// this.
List<Map<String, dynamic>> expiryRows(Repo repo) {
  final rows = repo.of('ing').where((g) => '${g['expiry'] ?? ''}'.isNotEmpty).toList();
  rows.sort((a, b) => '${a['expiry']}'.compareTo('${b['expiry']}'));
  return rows;
}
