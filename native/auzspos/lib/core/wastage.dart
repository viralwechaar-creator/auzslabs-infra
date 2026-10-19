// Wastage tracking, ported from the website's wasteForm()/invReport('waste')
// (app/public/console/p-inventory.js). Same `waste` record kind and fields the website already
// uses -- no new contract, migration or RPC. `waste` sits in the server's universal allow-list
// (db/172_pos_offers.sql line 25: 'order','exp','shift','ing','waste','voidlog',... are allowed for
// ANY authenticated role, not just owner/manager -- unlike `po`, which pos_kind_ok() gates to
// owner/manager only). So wastage recording is open to any signed-in staff member, same as the
// website.
//
// The website's wasteForm() does two things in order: (1) clone the `ing` record and subtract the
// wasted quantity from `qty`, saving it; (2) save a SEPARATE `waste` record logging the event
// ({ing: name, q, d: today, reason, at, by}). Confirmed by reading the source directly: unlike a
// sale (deduRecipe()) or the auto-cancel-after-KOT wastage path (pos/core.js), the MANUAL wasteForm()
// never appends to `ing.usage` -- so a manually recorded wastage entry does NOT feed the reorder
// velocity calculation in inventory_reports.dart's reorderRows(). Replicated here exactly: this file
// never touches `usage`.
//
// Wastage cost is NOT stored on the `waste` record itself. The website's own report
// (invReport('waste')) computes cost at render time from the material's CURRENT cost
// (`w.q*((ingByName(w.ing)||{}).cost||0)`), not a cost captured at the moment of waste -- so a
// historical wastage entry's reported cost shifts if the material's cost per unit later changes.
// Replicated as-is: this file has no `cost` field on the waste record and computes cost from the
// ingredient's live `cost` field, exactly like the website.
import 'billing.dart' show r2;
import 'repo.dart';

/// Same reason list, same default, as the website's wasteForm().
const wastageReasons = ['Spoiled', 'Spilled', 'Over-prepared', 'Returned', 'Staff meal', 'Other'];
const defaultWastageReason = 'Spoiled';

/// Writes a wastage entry exactly like the website's wasteForm(): subtracts [qty] from the
/// material's stock on hand, then logs a separate `waste` record. [qty] must already be a positive
/// number -- callers (the review-before-confirm UI) are responsible for validating user input before
/// this runs; this function additionally refuses a non-positive quantity as a defensive floor so a
/// caller can never silently move stock the wrong way.
///
/// Unlike the website's own Save button (which has no re-entrancy guard at all -- confirmed by
/// reading formModal()'s save2() directly), this is a pure, idempotency-free write: duplicate-
/// submission protection for a UI action with no natural document id to dedupe against (unlike a PO,
/// which has a stable record to check `status` against) belongs in the UI layer, which must disable
/// the confirm action for the duration of this call. See wasteForm() in ui/wastage.dart for that
/// guard.
Future<void> recordWastage(Repo repo, Map<String, dynamic> ing, {required num qty, required String reason, String? by}) async {
  if (qty <= 0) return;
  final updated = {...ing, 'qty': r2((((ing['qty'] ?? 0) as num)) - qty)};
  await repo.save('ing', updated, id: '${ing['id']}');
  await repo.save('waste', {
    'ing': ing['name'],
    'q': qty,
    'd': dayKeyOf(DateTime.now()),
    'reason': reason,
    'at': nowIso(),
    'by': ?by,
  });
}

String dayKeyOf(DateTime d) => '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

/// The cost of one wastage entry, read from the material's CURRENT cost (see file header: the
/// website does not freeze cost at the time of waste).
num wastageCost(Repo repo, Map<String, dynamic> w) {
  final name = '${w['ing'] ?? ''}'.trim().toLowerCase();
  final g = repo.of('ing').where((x) => '${x['name'] ?? ''}'.trim().toLowerCase() == name).firstOrNull;
  return r2(((w['q'] ?? 0) as num) * (((g?['cost']) ?? 0) as num));
}

/// Wastage entries within [from, to] (inclusive, 'YYYY-MM-DD'), newest first -- mirrors
/// invReport('waste')'s own filter and sort exactly.
List<Map<String, dynamic>> wastageRows(Repo repo, {required String from, required String to}) {
  final rows = repo.of('waste').where((w) => '${w['d'] ?? ''}'.compareTo(from) >= 0 && '${w['d'] ?? ''}'.compareTo(to) <= 0).toList();
  rows.sort((a, b) => '${b['d'] ?? ''}'.compareTo('${a['d'] ?? ''}'));
  return rows;
}

/// Total cost of wastage recorded in the current calendar month (same window as the website's
/// "Wastage this month" KPI on inv/stock and inv/raw).
num wastageCostThisMonth(Repo repo) {
  final ym = dayKeyOf(DateTime.now()).substring(0, 7);
  return r2(repo.of('waste').where((w) => '${w['d'] ?? ''}'.startsWith(ym)).fold<num>(0, (a, w) => a + wastageCost(repo, w)));
}
