// Canonical `purchase` record shape + a single, shared reader/writer for every native screen that
// touches it (the "Direct purchase" form, the Reorder tab's "Buy" button, and Purchase Orders'
// receiving flow, which already wrote the correct shape -- see core/purchase_orders.dart).
//
// Traced directly from the website, not assumed: purchaseDirect() and receivePO() (both in
// app/public/console/p-inventory.js) are the ONLY two places the website ever writes a `purchase`
// record, and they both write the exact same shape:
//   { vendorId: string|null, vendorName: string, items: [{desc, qty, unit, unitPrice}],
//     amount: number, date: 'YYYY-MM-DD', notes: string, poId?: string }
// -- `items[].desc` is the material's NAME (not an id, matching the name-based lookups used
// throughout this codebase), `items[].unitPrice` is the price for ONE unit (never a total), and
// `amount` is the purchase's total value (website applies tax to it on the direct-purchase path;
// native's own purchase form has no tax field, so this file never introduces one). There is no
// creation-timestamp field anywhere in the website's own shape -- only `date`, the purchase date
// itself, which is also the only key invReport('purchases') and the Purchase Orders "Spend this
// month" KPI ever sort or filter by.
//
// Before this fix, two of this app's own three purchase writers (the "Direct purchase" form's
// add(), and the Reorder tab's recordPurchase()) instead wrote {name, qty, price, vendor, d, unit,
// at} -- a different shape with different field names, confirmed by reading both call sites
// directly. This made the "Spend this month" KPI (which only ever read `amount`/`date`) silently
// miss every purchase recorded through either of those two screens, and made the "Direct purchase"
// list (which only ever read `name`/`qty`/`price`/`vendor`/`d`/`at`) show a Purchase-Order-received
// purchase with blank fields and a garbled sort key.
//
// Fix, in two parts:
//   1. Writers: recordDirectPurchase() is now the ONE function both screens call -- it always
//      writes the canonical shape above, so every new purchase from this point on is unambiguous
//      and already agrees with what Purchase Orders writes.
//   2. Readers: normalizePurchase() tolerates BOTH shapes a real record on a real device or already
//      synced to the server might be in -- the canonical one above, and the old native-only one --
//      so a purchase recorded before this fix is never silently dropped from the list or from a
//      spend total; it is just displayed and totalled correctly, derived honestly from its own
//      per-unit price and quantity rather than having a unit price misread as an already-total
//      amount. purchaseRows()/purchaseSpendThisMonth() are the two shared reader entry points every
//      screen now uses, so the two screens this task's own audit found disagreeing can never
//      disagree again.
import 'repo.dart';

num _r2(num n) => (n.toDouble() * 100).roundToDouble() / 100;

/// One line of a purchase: a material's description, quantity, unit and price for ONE unit --
/// never a total. Matches the website's own `items[]` entry shape exactly.
class PurchaseLine {
  PurchaseLine({required this.desc, required this.qty, required this.unit, required this.unitPrice});
  final String desc;
  final num qty;
  final String unit;
  final num unitPrice;
  num get lineAmount => _r2(qty * unitPrice);
}

/// A `purchase` record normalized to one consistent view, regardless of which shape the underlying
/// record was actually written in. [legacy] is true only when this view was synthesized from the
/// old, pre-fix native shape -- kept for callers that want to say so, never used to change the
/// figures themselves.
class PurchaseView {
  PurchaseView({
    required this.vendorName,
    required this.items,
    required this.amount,
    required this.date,
    required this.notes,
    this.poId,
    this.vendorId,
    this.legacy = false,
  });
  final String? vendorId;
  final String vendorName;
  final List<PurchaseLine> items;
  final num amount;
  final String date;
  final String notes;
  final String? poId;
  final bool legacy;

  /// "2 kg Milk, 1 ltr Oil" -- the same join style as the website's own
  /// `p.items.map(i=>i.qty+(i.unit?' '+i.unit:'')+' '+i.desc).join(', ')`.
  String get itemsSummary => items.map((i) => '${_num(i.qty)}${i.unit.isEmpty ? '' : ' ${i.unit}'} ${i.desc}').join(', ');
}

String _num(num n) => n == n.roundToDouble() ? n.toInt().toString() : n.toStringAsFixed(2);

/// Reads one `purchase` record's raw `data` map and returns a single, consistent [PurchaseView],
/// tolerating both the canonical website shape (`items` is a list) and the old native-only shape
/// this file's own writer used to produce (`name`/`qty`/`price`/`vendor`/`d`/`unit`, no `items` at
/// all). The legacy shape's `price` field was always labelled "Price per unit" on its own form, so
/// it is read as a per-unit price here too -- the synthesized `amount` is computed as qty*price,
/// never copied from `price` directly, so a unit price is never misinterpreted as an already-total
/// amount.
PurchaseView normalizePurchase(Map<String, dynamic> p) {
  final rawItems = p['items'];
  if (rawItems is List) {
    final items = rawItems.whereType<Map>().map((i) => PurchaseLine(
          desc: '${i['desc'] ?? ''}',
          qty: (i['qty'] ?? 0) as num,
          unit: '${i['unit'] ?? ''}',
          unitPrice: (i['unitPrice'] ?? 0) as num,
        )).toList();
    return PurchaseView(
      vendorId: p['vendorId'] as String?,
      vendorName: '${p['vendorName'] ?? 'Unknown'}',
      items: items,
      amount: (p['amount'] ?? 0) as num,
      date: '${p['date'] ?? ''}',
      notes: '${p['notes'] ?? ''}',
      poId: p['poId'] as String?,
    );
  }
  // Legacy native-only shape, tolerated so a record written before this fix (already on a device,
  // or already synced to the server) is never dropped from view or from a spend total.
  final qty = (p['qty'] ?? 0) as num;
  final unitPrice = (p['price'] ?? 0) as num;
  final vendor = '${p['vendor'] ?? ''}';
  return PurchaseView(
    vendorName: vendor.isEmpty ? 'Cash purchase' : vendor,
    items: [PurchaseLine(desc: '${p['name'] ?? ''}', qty: qty, unit: '${p['unit'] ?? ''}', unitPrice: unitPrice)],
    amount: _r2(qty * unitPrice),
    date: '${p['d'] ?? ''}',
    notes: 'Stock purchase',
    legacy: true,
  );
}

/// Every `purchase` record, normalized, newest-first by date -- matches invReport('purchases')'s own
/// sort exactly (date only, no secondary key: the website has none either).
List<PurchaseView> purchaseRows(Repo repo) {
  final rows = repo.of('purchase').map(normalizePurchase).toList();
  rows.sort((a, b) => b.date.compareTo(a.date));
  return rows;
}

/// Total spend in the calendar month named by [monthKey] ('YYYY-MM'), read through the SAME
/// normalizer every other purchase reader in this file uses. [monthKey] is taken from the caller
/// rather than computed here so this always agrees with whatever "this month" boundary the screen
/// showing it is already using for its neighbouring KPIs (Purchase Orders' own "Received this
/// month" tile derives its month key from `nowIso()`, not the device's local calendar -- a
/// pre-existing, separate quirk this fix does not touch, so both figures on that one screen keep
/// using the same convention as each other).
num purchaseSpendInMonth(Repo repo, String monthKey) => _r2(purchaseRows(repo).where((p) => p.date.startsWith(monthKey)).fold<num>(0, (a, p) => a + p.amount));

/// Writes a single-material direct purchase in the canonical website shape. The one writer both
/// the "Direct purchase" form and the Reorder tab's "Buy" button call -- see this file's own header
/// for why there used to be two different, disagreeing writers instead of one.
Future<void> recordDirectPurchase(
  Repo repo, {
  required String material,
  required num qty,
  required num unitPrice,
  required String unit,
  String? vendor,
  required String date,
}) async {
  final vendorName = (vendor == null || vendor.isEmpty) ? 'Cash purchase' : vendor;
  await repo.save('purchase', {
    'vendorId': null,
    'vendorName': vendorName,
    'items': [
      {'desc': material, 'qty': qty, 'unit': unit, 'unitPrice': unitPrice},
    ],
    'amount': _r2(qty * unitPrice),
    'date': date,
    'notes': 'Stock purchase',
  });
}
