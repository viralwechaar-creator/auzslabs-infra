// Automation 1 of this mission's "business automations" batch: automatically draft Purchase Orders
// for raw materials that have fallen to or below their low-stock threshold, grouped by vendor, with
// a suggested order quantity -- ported from the website's own reorderPO() (app/public/console/
// p-extras.js), which already does exactly this and already ships live. This is NOT a new feature
// invented for native: it already exists on the website, already has an owner-facing confirm step,
// and already writes nothing but a `po` record in `status:'draft'` (the exact same kind, shape and
// permission tier core/purchase_orders.dart already ports for the manual PO workflow) -- no backend,
// database or contract change of any kind.
//
// What it automates: today, creating a reorder PO means an owner/manager must notice a material is
// low (by opening Stock or Reorder), work out how much to order, open "New purchase order", pick the
// vendor, and type each line by hand -- once per vendor, since one PO can only have one supplier.
// This function does all of that: it finds every low material, groups them by vendor, and computes
// each line's quantity, leaving only one human decision -- review the plan and tap Confirm (or not).
// It does NOT receive the goods, touch stock, or spend any money -- a draft PO is paperwork only; the
// existing, already-tested receivePurchaseOrder() flow (core/purchase_orders.dart) is still the one
// and only place stock or a `purchase` record is ever written, and that still needs its own separate,
// explicit confirm when the goods actually arrive.
//
// Exact formula, read directly from reorderPO() (not assumed): a material is "low" using the SAME
// condition as isLowStock() in inventory_reports.dart (qty <= low); each low material's suggested
// quantity is `max(1, low*2 - qty)` -- "brings it back to twice its reorder level" -- regardless of
// any sales-velocity history. This is a DIFFERENT formula from invReport('reorder')'s own suggestion
// (inventory_reports.dart's reorderRows(), which blends in a 14-day usage average when one exists):
// the two are separate website features with separate formulas, confirmed by reading both functions
// side by side, and this file does not conflate them. The auto-generated PO's own number
// ('PO-'+Date.now().toString().slice(-6)) is also a DIFFERENT scheme from the manual poForm()'s own
// nextPoNo() ('PO-0001', ...) -- both are replicated exactly as the website has them, not unified.
import 'inventory_reports.dart' show isLowStock;
import 'repo.dart';

num _r2(num n) => (n.toDouble() * 100).roundToDouble() / 100;

/// One vendor's share of the auto-reorder plan: the materials it supplies that are low, with the
/// quantity and price to put on the draft PO line. [vendor] is '' for materials with no vendor set
/// (grouped together as one PO with no supplier named, same as the website).
class AutoReorderGroup {
  AutoReorderGroup(this.vendor, this.items);
  final String vendor;
  final List<Map<String, dynamic>> items; // [{ing, qty, price}]
}

/// The exact plan reorderPO() would confirm before writing anything: every low material, grouped by
/// vendor, with reorderPO()'s own quantity formula. Pure and read-only -- computing this plan never
/// writes a single record, so it is safe to call as often as a screen likes (e.g. every time the
/// Reorder tab is built) without any risk of a side effect.
List<AutoReorderGroup> planAutoReorder(Repo repo) {
  final low = repo.of('ing').where(isLowStock).toList();
  final by = <String, List<Map<String, dynamic>>>{};
  for (final g in low) {
    final vendor = '${g['vendor'] ?? ''}';
    final lowAt = (g['low'] ?? 0) as num;
    final qty = lowAt * 2 - ((g['qty'] ?? 0) as num);
    (by[vendor] ??= []).add({'ing': g['name'], 'qty': qty < 1 ? 1 : _r2(qty), 'price': g['cost'] ?? 0});
  }
  return [for (final e in by.entries) AutoReorderGroup(e.key, e.value)];
}

/// Same numbering scheme as reorderPO()'s own auto-drafts ('PO-'+Date.now().toString().slice(-6)) --
/// deliberately NOT nextPoNo() from core/purchase_orders.dart, which is the manual poForm()'s own,
/// different scheme. Exposed so a test can pass a fixed [now] instead of depending on the real clock.
String autoPoNo({DateTime? now}) {
  final ms = (now ?? DateTime.now()).millisecondsSinceEpoch.toString();
  return 'PO-${ms.length <= 6 ? ms : ms.substring(ms.length - 6)}';
}

/// True when an open (not yet received) auto-generated draft already covers this vendor -- the
/// website's own reorderPO() has no such guard at all (confirmed by reading it directly: tapping its
/// button twice in a row, before receiving the first batch, creates a second, fully duplicate set of
/// draft POs for the same materials). This native-only check prevents exactly that pile-up: once a
/// vendor already has an open auto-drafted PO, re-running the plan skips that vendor until the
/// existing draft is received or deleted, matching this mission's established pattern of adding a
/// client-side safety net the website itself does not have (see receivePurchaseOrder()'s own
/// already-received guard for the precedent).
const autoReorderNote = 'Auto from low stock';

bool _hasOpenAutoDraft(Repo repo, String vendor) => repo.of('po').any((p) => '${p['status'] ?? 'draft'}' != 'received' && '${p['note'] ?? ''}' == autoReorderNote && '${p['supplier'] ?? ''}' == vendor);

/// The plan actually worth acting on right now: [planAutoReorder]'s groups, minus any vendor that
/// already has an open auto-drafted PO outstanding. A group with items but no PO yet still appears
/// here if that vendor's own prior auto-draft was already received or deleted -- only a genuinely
/// OPEN duplicate is suppressed.
List<AutoReorderGroup> pendingAutoReorder(Repo repo) => planAutoReorder(repo).where((g) => !_hasOpenAutoDraft(repo, g.vendor)).toList();

/// Writes one draft `po` record per group in [groups] -- the exact shape reorderPO() writes
/// (supplier, items, status:'draft', note:'Auto from low stock', createdAt, no). Callers are expected
/// to have already shown the plan to the owner/manager and gotten an explicit confirmation; this
/// function itself does not ask -- it only writes what it is given, same division of responsibility
/// as receivePurchaseOrder() (pure write) versus its own caller's confirm dialog.
///
/// Returns the created `po` data maps. Writing nothing (an empty [groups] list) is a safe no-op.
Future<List<Map<String, dynamic>>> createAutoReorderDrafts(Repo repo, List<AutoReorderGroup> groups) async {
  final created = <Map<String, dynamic>>[];
  for (final g in groups) {
    if (g.items.isEmpty) continue;
    final rec = await repo.save('po', {
      'supplier': g.vendor,
      'items': g.items,
      'status': 'draft',
      'note': autoReorderNote,
      'createdAt': nowIso(),
      'no': autoPoNo(),
    });
    created.add(rec.data);
  }
  return created;
}
