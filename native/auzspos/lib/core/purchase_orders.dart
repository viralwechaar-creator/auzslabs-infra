// Purchase Order draft/receive workflow, ported from the website's poForm()/receivePO()
// (app/public/console/p-inventory.js). Same `po` record kind, fields and permission tier the website
// already uses (pos_kind_ok() in db/172_pos_offers.sql gates `po` to owner/manager only -- no new
// contract, migration or RPC). Kept as free functions over a Repo, same split as stock.dart/cash.dart/
// reorder.dart/inventory_reports.dart, so the receiving math is directly unit-testable.
//
// The website's own PO model has exactly two statuses, 'draft' and 'received' -- there is no 'partial' or
// 'cancelled' status anywhere in its code. receivePO() lets the receiver type a received quantity LESS
// than what was ordered per line (a true partial receive at the line level), but the PO document itself
// always flips wholesale to 'received' the moment Confirm is pressed, with no further tracking of a
// remaining backorder quantity. "Cancel" on the website is simply deleting a still-draft PO (the Delete
// button is hidden once a PO is received). This file replicates that exact, limited model -- it does not
// invent a richer partial/cancelled state the website doesn't have.
import 'repo.dart';

/// Client-side best-effort numbering, exactly matching the website's own `'PO-'+String(L('po').length+1)`.
/// This is NOT a gapless, server-issued sequence (same category of limitation as the offline invoice
/// numbering already documented elsewhere) -- two devices creating a PO at the same moment could land on
/// the same number. Replicated as-is, not silently improved into a different contract than the website's.
String nextPoNo(Repo repo) => 'PO-${(repo.of('po').length + 1).toString().padLeft(4, '0')}';

/// True for a `po` record that has not yet been received -- the website's own `status!='received'`
/// check (a PO with no status at all is still a draft, matching its `status||'draft'` fallback).
/// Audit finding (Native POS Operational Features audit): this exact condition used to be written
/// inline, separately, in two different UI files (the Alerts Center's 'po' alert in console.dart,
/// and Purchases' own default-tab decision in console_pages.dart) -- harmless while both copies
/// agreed, but a real risk of the two silently drifting apart if either was ever edited alone.
/// Pulled out once, here, so both now call the same function.
bool isPoOpen(Map<String, dynamic> p) => '${p['status'] ?? 'draft'}' != 'received';

/// Every `po` record not yet received. Pure and read-only.
List<Map<String, dynamic>> openPurchaseOrders(Repo repo) => repo.of('po').where(isPoOpen).toList();

/// Apply a PO receipt exactly like receivePO() on the website: for each line with a received quantity > 0,
/// add that quantity to the ingredient's stock (and its cost, if a price was given), append a usage entry
/// matching the shape _Purchases.add() already writes (so it shows up the same way in reports); create one
/// linked `purchase` record for the whole receipt (vendorId, items, amount, date, a note referencing the PO
/// number, poId); then mark the PO itself received.
///
/// [received] is one entry per PO line: {ing: material name, qty: received quantity (may be less than
/// ordered), price: price per unit (optional, falls back to the ingredient's existing cost)}.
///
/// Guarded against being applied twice for the SAME po id: if it is already `status=='received'` (checked
/// against the repo's own current copy, so this survives an app restart or a stale retry, same pattern as
/// pay()'s already-paid guard in home.dart), this returns false and does nothing -- no double stock count,
/// no duplicate purchase record. This is a LOCAL, client-side safety net, not a server-side idempotency
/// key: the website itself has no such guard at all (confirmed by reading receivePO() -- there is no
/// equivalent check), so two different devices racing to receive the same PO at the same moment is a real,
/// unresolved risk on both platforms, not something this file claims to fully solve.
Future<bool> receivePurchaseOrder(Repo repo, Map<String, dynamic> po, List<Map<String, dynamic>> received, {String? vendorId, String? vendorName}) async {
  final id = '${po['id']}';
  final current = repo.rec(id);
  if (current != null && current['status'] == 'received') return false;

  final purchaseItems = <Map<String, dynamic>>[];
  num amount = 0;
  final today = nowIso().substring(0, 10);
  for (final line in received) {
    final qty = (line['qty'] as num?) ?? 0;
    if (qty <= 0) continue;
    final price = (line['price'] as num?) ?? 0;
    final name = '${line['ing']}';
    final g = repo.of('ing').where((x) => '${x['name']}' == name).firstOrNull ?? {'name': name, 'unit': '', 'qty': 0, 'low': 0};
    final usage = ((g['purchases'] as List?) ?? []).toList()..add({'vendor': vendorName ?? '', 'qty': qty, 'price': price, 'tax': 0, 'amt': qty * price, 'd': today, 'at': nowIso()});
    await repo.save('ing', {...g, 'qty': (((g['qty'] ?? 0) as num) + qty), if (price > 0) 'cost': price, 'purchases': usage.length > 200 ? usage.sublist(usage.length - 200) : usage}, id: g['id'] as String?);
    purchaseItems.add({'desc': name, 'qty': qty, 'unit': g['unit'] ?? '', 'unitPrice': price});
    amount += qty * price;
  }

  await repo.save('purchase', {
    'vendorId': vendorId,
    'vendorName': vendorName ?? po['supplier'] ?? 'Unknown',
    'items': purchaseItems,
    'amount': amount,
    'date': today,
    'notes': 'Received ${po['no'] ?? 'PO'}',
    'poId': id,
  });

  await repo.save('po', {...po, 'status': 'received', 'receivedAt': nowIso()}, id: id);
  return true;
}
