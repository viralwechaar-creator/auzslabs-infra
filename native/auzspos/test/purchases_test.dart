import 'package:auzspos/core/purchase_orders.dart';
import 'package:auzspos/core/purchases.dart';
import 'package:flutter_test/flutter_test.dart';
import 'sync_test.dart' show FakeServer, mk;

/// The canonical `purchase` record shape, traced directly from the website's purchaseDirect()/
/// receivePO() (app/public/console/p-inventory.js), and a single shared reader/writer so the
/// "Direct purchase" form, the Reorder tab's "Buy" button and Purchase Order receiving can never
/// disagree about what a purchase record means again. Pure functions over a Repo, same split as
/// stock_test.dart/wastage_test.dart/costing_test.dart/purchase_orders_test.dart.
void main() {
  group('recordDirectPurchase: writes the canonical website shape', () {
    test('a normal purchase has items/amount/date/vendorName/notes, never the old field names', () async {
      final repo = mk(FakeServer());
      await recordDirectPurchase(repo, material: 'Milk', qty: 10, unitPrice: 42, unit: 'l', vendor: 'Dairy Co', date: '2026-10-15');

      final raw = repo.of('purchase').single;
      expect(raw['vendorId'], null);
      expect(raw['vendorName'], 'Dairy Co');
      expect(raw['date'], '2026-10-15');
      expect(raw['notes'], 'Stock purchase');
      expect(raw['amount'], 420, reason: '10 * 42, a total, never the unit price alone');
      final items = raw['items'] as List;
      expect(items.single, {'desc': 'Milk', 'qty': 10, 'unit': 'l', 'unitPrice': 42});
      // The old, pre-fix shape must never appear on a freshly written record.
      expect(raw.containsKey('name'), false);
      expect(raw.containsKey('price'), false);
      expect(raw.containsKey('vendor'), false);
      expect(raw.containsKey('d'), false);
      expect(raw.containsKey('at'), false);
    });

    test('an empty/unset vendor name defaults to "Cash purchase", matching purchaseDirect() exactly', () async {
      final repo = mk(FakeServer());
      await recordDirectPurchase(repo, material: 'Sugar', qty: 5, unitPrice: 50, unit: 'kg', vendor: null, date: '2026-10-15');
      expect(repo.of('purchase').single['vendorName'], 'Cash purchase');

      final repo2 = mk(FakeServer());
      await recordDirectPurchase(repo2, material: 'Sugar', qty: 5, unitPrice: 50, unit: 'kg', vendor: '', date: '2026-10-15');
      expect(repo2.of('purchase').single['vendorName'], 'Cash purchase');
    });
  });

  group('normalizePurchase: tolerates the old native-only shape, never misreads a unit price as a total', () {
    test('the canonical shape passes through unchanged', () {
      final v = normalizePurchase({
        'vendorId': 'v1',
        'vendorName': 'Dairy Co',
        'items': [
          {'desc': 'Milk', 'qty': 10, 'unit': 'l', 'unitPrice': 42},
        ],
        'amount': 420,
        'date': '2026-10-15',
        'notes': 'Stock purchase',
      });
      expect(v.legacy, false);
      expect(v.vendorId, 'v1');
      expect(v.vendorName, 'Dairy Co');
      expect(v.amount, 420);
      expect(v.date, '2026-10-15');
      expect(v.items.single.desc, 'Milk');
      expect(v.items.single.unitPrice, 42, reason: 'unitPrice must stay a per-unit price, never collapsed into the total');
    });

    test('the OLD native shape {name,qty,price,vendor,d,unit,at} is read correctly, computing the \n       total from qty*price rather than treating `price` (a per-unit figure) as the total', () {
      final v = normalizePurchase({'name': 'Milk', 'qty': 10, 'price': 42, 'vendor': 'Dairy Co', 'd': '2026-10-15', 'unit': 'l', 'at': '2026-10-15T09:00:00Z'});
      expect(v.legacy, true);
      expect(v.vendorName, 'Dairy Co');
      expect(v.date, '2026-10-15');
      expect(v.amount, 420, reason: '10 * 42, NOT 42 -- the unit price must never be read as the total');
      expect(v.items.single.desc, 'Milk');
      expect(v.items.single.qty, 10);
      expect(v.items.single.unitPrice, 42);
      expect(v.items.single.unit, 'l');
    });

    test('the old shape with no vendor typed falls back to "Cash purchase", same as a direct write', () {
      final v = normalizePurchase({'name': 'Milk', 'qty': 10, 'price': 42, 'd': '2026-10-15', 'unit': 'l'});
      expect(v.vendorName, 'Cash purchase');
    });

    test('a Purchase-Order-received record (already canonical, written by receivePurchaseOrder()) \n       is read the same way, poId preserved, never shown as a legacy record', () {
      final v = normalizePurchase({
        'vendorId': null,
        'vendorName': 'Spice Co',
        'items': [
          {'desc': 'Pepper', 'qty': 3, 'unit': 'kg', 'unitPrice': 500},
        ],
        'amount': 1500,
        'date': '2026-10-15',
        'notes': 'Received PO-0004',
        'poId': 'po-123',
      });
      expect(v.legacy, false);
      expect(v.poId, 'po-123');
      expect(v.amount, 1500);
    });
  });

  group('normalizePurchase: invalid or missing fields never throw', () {
    test('a completely empty record normalizes to a zero-amount legacy view, not an error', () {
      final v = normalizePurchase({});
      expect(v.amount, 0);
      expect(v.date, '');
      expect(v.vendorName, 'Cash purchase');
      expect(v.items.single.desc, '');
    });

    test('a canonical-shaped record with a missing amount/date/vendorName fills in safe defaults', () {
      final v = normalizePurchase({'items': []});
      expect(v.amount, 0);
      expect(v.date, '');
      expect(v.vendorName, 'Unknown');
      expect(v.items, isEmpty);
    });

    test('an `items` entry that is not itself a map is skipped rather than throwing', () {
      final v = normalizePurchase({'items': ['not a map', 42, null], 'amount': 10, 'date': '2026-10-15'});
      expect(v.items, isEmpty);
    });
  });

  group('purchaseRows: direct purchases and Purchase-Order receipts display consistently together', () {
    test('both purchase types appear with correct items/vendor/amount, sorted newest-first by date', () async {
      final repo = mk(FakeServer());
      await repo.save('ing', {'name': 'Pepper', 'qty': 0, 'unit': 'kg'});
      await recordDirectPurchase(repo, material: 'Milk', qty: 10, unitPrice: 42, unit: 'l', vendor: 'Dairy Co', date: '2026-10-10');
      final po = (await repo.save('po', {
        'supplier': 'Spice Co',
        'items': [
          {'ing': 'Pepper', 'qty': 3, 'price': 500},
        ],
        'status': 'draft',
        'no': 'PO-0001',
      })).data;
      await receivePurchaseOrder(repo, po, [
        {'ing': 'Pepper', 'qty': 3, 'price': 500},
      ], vendorName: 'Spice Co');
      // Force the PO-received purchase's date later than the direct one, using the actual server
      // response's own 'at'/date (receivePurchaseOrder stamps `today()`, which is the real device
      // date -- rewrite it to a known value so this test does not depend on the day it happens to run).
      final poPurchase = repo.of('purchase').firstWhere((p) => p['poId'] == po['id']);
      await repo.save('purchase', {...poPurchase, 'date': '2026-10-20'}, id: '${poPurchase['id']}');

      final rows = purchaseRows(repo);
      expect(rows.length, 2);
      expect(rows.first.date, '2026-10-20', reason: 'newest first');
      expect(rows.first.itemsSummary, '3 kg Pepper');
      expect(rows.first.vendorName, 'Spice Co');
      expect(rows.first.amount, 1500);
      expect(rows.last.itemsSummary, '10 l Milk');
      expect(rows.last.amount, 420);
    });

    test('a mix of legacy-shape and canonical-shape records on the SAME device all display \n       correctly together -- a historical record is never dropped', () async {
      final repo = mk(FakeServer());
      await repo.save('purchase', {'name': 'Flour', 'qty': 20, 'price': 30, 'vendor': 'Mill', 'd': '2026-09-01', 'unit': 'kg', 'at': '2026-09-01T10:00:00Z'});
      await recordDirectPurchase(repo, material: 'Oil', qty: 5, unitPrice: 120, unit: 'l', vendor: 'Mart', date: '2026-09-15');

      final rows = purchaseRows(repo);
      expect(rows.length, 2);
      final flour = rows.firstWhere((r) => r.items.single.desc == 'Flour');
      final oil = rows.firstWhere((r) => r.items.single.desc == 'Oil');
      expect(flour.amount, 600, reason: '20*30, legacy shape, correctly computed');
      expect(oil.amount, 600, reason: '5*120, canonical shape');
      expect(flour.legacy, true);
      expect(oil.legacy, false);
    });
  });

  group('purchaseSpendInMonth: the figure the Direct purchase list and Purchase Orders KPI now share', () {
    test('sums every purchase in the month regardless of which writer created it', () async {
      final repo = mk(FakeServer());
      await repo.save('ing', {'name': 'Pepper', 'qty': 0, 'unit': 'kg'});
      await recordDirectPurchase(repo, material: 'Milk', qty: 10, unitPrice: 42, unit: 'l', vendor: 'Dairy Co', date: '2026-10-10'); // 420
      await repo.save('purchase', {'name': 'Flour', 'qty': 20, 'price': 30, 'vendor': 'Mill', 'd': '2026-10-02', 'unit': 'kg'}); // legacy shape, 600
      final po = (await repo.save('po', {
        'supplier': 'Spice Co',
        'items': [
          {'ing': 'Pepper', 'qty': 3, 'price': 500},
        ],
        'status': 'draft',
      })).data;
      await receivePurchaseOrder(repo, po, [
        {'ing': 'Pepper', 'qty': 3, 'price': 500},
      ]); // 1500, dated today -- move it into the same test month explicitly
      final poPurchase = repo.of('purchase').firstWhere((p) => p['poId'] == po['id']);
      await repo.save('purchase', {...poPurchase, 'date': '2026-10-20'}, id: '${poPurchase['id']}');
      // Out of range on purpose.
      await recordDirectPurchase(repo, material: 'Rice', qty: 1, unitPrice: 999, unit: 'kg', vendor: 'X', date: '2026-11-01');

      expect(purchaseSpendInMonth(repo, '2026-10'), 420 + 600 + 1500, reason: 'every October purchase counts exactly once, regardless of its shape or which screen created it');
    });

    test('an empty catalog has zero spend, not an error', () async {
      final repo = mk(FakeServer());
      expect(purchaseSpendInMonth(repo, '2026-10'), 0);
    });

    test('recording the same purchase twice (two genuinely separate taps of "Save") counts twice -- \n       each is a real, distinct event, same as the website\'s own behavior; this is not a\n       duplicate-detection bug, it documents that two real purchases are two real purchases', () async {
      final repo = mk(FakeServer());
      await recordDirectPurchase(repo, material: 'Milk', qty: 10, unitPrice: 42, unit: 'l', vendor: 'Dairy Co', date: '2026-10-10');
      await recordDirectPurchase(repo, material: 'Milk', qty: 10, unitPrice: 42, unit: 'l', vendor: 'Dairy Co', date: '2026-10-10');
      expect(repo.of('purchase').length, 2);
      expect(purchaseSpendInMonth(repo, '2026-10'), 840);
    });
  });

  group('serialization and sync compatibility', () {
    test('a direct purchase survives push to the server and a fresh pull on a SECOND device, and is \n       still read correctly afterward -- proves the canonical shape is plain JSON (nested list and \n       all) that the real push_record/sync path carries without loss', () async {
      final server = FakeServer();
      final deviceA = mk(server);
      await recordDirectPurchase(deviceA, material: 'Milk', qty: 10, unitPrice: 42, unit: 'l', vendor: 'Dairy Co', date: '2026-10-15');
      final pushResult = await deviceA.sync();
      expect(pushResult.error, isNull);
      expect(pushResult.rejected, isEmpty);

      // A second device, starting with nothing, pulls from the same server and must see the
      // identical, correctly normalized purchase -- the real cross-device path a purchase
      // recorded on one phone takes before it shows up on another.
      final deviceB = mk(server);
      final pullResult = await deviceB.sync();
      expect(pullResult.error, isNull);

      final raw = deviceB.of('purchase').single;
      final v = normalizePurchase(raw);
      expect(v.legacy, false);
      expect(v.amount, 420);
      expect(v.vendorName, 'Dairy Co');
      expect(v.date, '2026-10-15');
      expect(v.items.single.desc, 'Milk');
      expect(v.items.single.unitPrice, 42, reason: 'the nested items list survived the JSON round trip with its per-unit price intact');
    });
  });
}
