import 'package:auzspos/core/purchase_orders.dart';
import 'package:flutter_test/flutter_test.dart';
import 'sync_test.dart' show FakeServer, mk;

/// Purchase Order draft/receive workflow, ported from the website's poForm()/receivePO()
/// (app/public/console/p-inventory.js). Pure functions over a Repo, same split as
/// stock_test.dart/inventory_reports_test.dart, so the receiving math is directly provable.
void main() {
  group('nextPoNo', () {
    test('numbers from 0001 with no existing POs', () async {
      final repo = mk(FakeServer());
      expect(nextPoNo(repo), 'PO-0001');
    });

    test('numbers after the current count of po records (client-side best-effort, not gapless)', () async {
      final repo = mk(FakeServer());
      await repo.save('po', {'supplier': 'A', 'items': [], 'status': 'draft', 'no': 'PO-0001'});
      await repo.save('po', {'supplier': 'B', 'items': [], 'status': 'draft', 'no': 'PO-0002'});
      expect(nextPoNo(repo), 'PO-0003');
    });
  });

  group('receivePurchaseOrder: full receive', () {
    test('a single-line draft PO fully received adds the full qty to stock, logs a purchase, and marks received', () async {
      final repo = mk(FakeServer());
      await repo.save('ing', {'name': 'Milk', 'qty': 10, 'unit': 'l', 'cost': 40});
      final po = (await repo.save('po', {
        'supplier': 'Dairy Co',
        'items': [{'ing': 'Milk', 'qty': 20, 'price': 42}],
        'status': 'draft',
        'no': 'PO-0001',
      })).data;

      final ok = await receivePurchaseOrder(repo, po, [{'ing': 'Milk', 'qty': 20, 'price': 42}], vendorId: 'v1', vendorName: 'Dairy Co');
      expect(ok, true);

      final milk = repo.of('ing').firstWhere((g) => g['name'] == 'Milk');
      expect(milk['qty'], 30, reason: '10 on hand + 20 received');
      expect(milk['cost'], 42, reason: 'cost updated to the received price');
      expect((milk['purchases'] as List).length, 1);

      final purchases = repo.of('purchase');
      expect(purchases.length, 1);
      expect(purchases.single['amount'], 840, reason: '20 * 42');
      expect(purchases.single['poId'], po['id']);
      expect(purchases.single['vendorName'], 'Dairy Co');

      final updatedPo = repo.of('po').firstWhere((p) => p['id'] == po['id']);
      expect(updatedPo['status'], 'received');
      expect(updatedPo['receivedAt'], isNotNull);
    });
  });

  group('receivePurchaseOrder: partial receive', () {
    test('receiving less than ordered on a line only adds the received qty, not the ordered qty', () async {
      final repo = mk(FakeServer());
      await repo.save('ing', {'name': 'Flour', 'qty': 5, 'unit': 'kg'});
      final po = (await repo.save('po', {
        'supplier': 'Mill',
        'items': [{'ing': 'Flour', 'qty': 50, 'price': 30}],
        'status': 'draft',
        'no': 'PO-0002',
      })).data;

      // Ordered 50, only 35 actually arrived.
      final ok = await receivePurchaseOrder(repo, po, [{'ing': 'Flour', 'qty': 35, 'price': 30}]);
      expect(ok, true);

      final flour = repo.of('ing').firstWhere((g) => g['name'] == 'Flour');
      expect(flour['qty'], 40, reason: '5 on hand + 35 received, never the full 50 ordered');

      // The PO document itself still flips wholesale to received -- the website has no backorder
      // tracking of the remaining 15, and this native port replicates that limited model exactly.
      final updatedPo = repo.of('po').firstWhere((p) => p['id'] == po['id']);
      expect(updatedPo['status'], 'received');
    });
  });

  group('receivePurchaseOrder: mixed lines', () {
    test('a multi-line PO with full, partial and zero-qty lines only moves stock for the non-zero lines', () async {
      final repo = mk(FakeServer());
      await repo.save('ing', {'name': 'Sugar', 'qty': 0, 'unit': 'kg'});
      await repo.save('ing', {'name': 'Salt', 'qty': 0, 'unit': 'kg'});
      await repo.save('ing', {'name': 'Pepper', 'qty': 0, 'unit': 'kg'});
      final po = (await repo.save('po', {
        'supplier': 'Spice Co',
        'items': [
          {'ing': 'Sugar', 'qty': 10, 'price': 20},
          {'ing': 'Salt', 'qty': 10, 'price': 5},
          {'ing': 'Pepper', 'qty': 10, 'price': 50},
        ],
        'status': 'draft',
        'no': 'PO-0003',
      })).data;

      final ok = await receivePurchaseOrder(repo, po, [
        {'ing': 'Sugar', 'qty': 10, 'price': 20}, // full
        {'ing': 'Salt', 'qty': 4, 'price': 5}, // partial
        {'ing': 'Pepper', 'qty': 0, 'price': 50}, // nothing arrived yet
      ]);
      expect(ok, true);

      expect(repo.of('ing').firstWhere((g) => g['name'] == 'Sugar')['qty'], 10);
      expect(repo.of('ing').firstWhere((g) => g['name'] == 'Salt')['qty'], 4);
      expect(repo.of('ing').firstWhere((g) => g['name'] == 'Pepper')['qty'], 0, reason: 'a zero-qty line never touches stock');

      final purchase = repo.of('purchase').single;
      expect((purchase['items'] as List).length, 2, reason: 'only the two non-zero lines are logged');
      expect(purchase['amount'], 220, reason: '(10*20) + (4*5) = 200 + 20');
    });
  });

  group('receivePurchaseOrder: duplicate receiving guard', () {
    test('receiving an already-received PO a second time is a no-op: returns false, no double stock count', () async {
      final repo = mk(FakeServer());
      await repo.save('ing', {'name': 'Milk', 'qty': 0, 'unit': 'l'});
      final po = (await repo.save('po', {
        'supplier': 'Dairy Co',
        'items': [{'ing': 'Milk', 'qty': 20, 'price': 42}],
        'status': 'draft',
        'no': 'PO-0004',
      })).data;

      final first = await receivePurchaseOrder(repo, po, [{'ing': 'Milk', 'qty': 20, 'price': 42}]);
      expect(first, true);
      expect(repo.of('ing').firstWhere((g) => g['name'] == 'Milk')['qty'], 20);
      expect(repo.of('purchase').length, 1);

      // Simulate a retry/duplicate tap passing the SAME (now stale) po map -- the guard checks the
      // repo's own current copy by id, not the caller's possibly-stale argument, so this must still
      // be caught even though the `po` variable here still says status: 'draft'.
      final second = await receivePurchaseOrder(repo, po, [{'ing': 'Milk', 'qty': 20, 'price': 42}]);
      expect(second, false, reason: 'already received -- must refuse, not double-count');

      expect(repo.of('ing').firstWhere((g) => g['name'] == 'Milk')['qty'], 20, reason: 'stock must not have moved a second time');
      expect(repo.of('purchase').length, 1, reason: 'no second purchase record created');
    });

    test('receiving the freshest copy of an already-received PO (not a stale one) is still refused', () async {
      final repo = mk(FakeServer());
      await repo.save('ing', {'name': 'Milk', 'qty': 0, 'unit': 'l'});
      final po = (await repo.save('po', {
        'supplier': 'Dairy Co',
        'items': [{'ing': 'Milk', 'qty': 20, 'price': 42}],
        'status': 'draft',
        'no': 'PO-0005',
      })).data;
      await receivePurchaseOrder(repo, po, [{'ing': 'Milk', 'qty': 20, 'price': 42}]);

      final fresh = repo.of('po').firstWhere((p) => p['id'] == po['id']);
      expect(fresh['status'], 'received');
      final retry = await receivePurchaseOrder(repo, fresh, [{'ing': 'Milk', 'qty': 20, 'price': 42}]);
      expect(retry, false);
      expect(repo.of('purchase').length, 1);
    });
  });

  group('cancel (delete) a draft PO', () {
    test('deleting a still-draft PO never touches stock -- matches the website\'s delete-based cancel model', () async {
      final repo = mk(FakeServer());
      await repo.save('ing', {'name': 'Milk', 'qty': 7, 'unit': 'l'});
      final po = (await repo.save('po', {
        'supplier': 'Dairy Co',
        'items': [{'ing': 'Milk', 'qty': 20, 'price': 42}],
        'status': 'draft',
        'no': 'PO-0006',
      })).data;

      await repo.save('po', po, id: '${po['id']}', deleted: true);

      expect(repo.of('ing').firstWhere((g) => g['name'] == 'Milk')['qty'], 7, reason: 'cancelling a draft must never move stock');
      expect(repo.of('purchase'), isEmpty);
      expect(repo.of('po').where((p) => p['id'] == po['id']), isEmpty, reason: 'deleted records are excluded from of()');
    });
  });

  group('new ingredient created by receiving (not previously in the catalog)', () {
    test('receiving a PO line for a material that does not exist yet creates it with the received stock', () async {
      final repo = mk(FakeServer());
      final po = (await repo.save('po', {
        'supplier': 'New Supplier',
        'items': [{'ing': 'Saffron', 'qty': 2, 'price': 500}],
        'status': 'draft',
        'no': 'PO-0007',
      })).data;

      final ok = await receivePurchaseOrder(repo, po, [{'ing': 'Saffron', 'qty': 2, 'price': 500}]);
      expect(ok, true);

      final g = repo.of('ing').firstWhere((x) => x['name'] == 'Saffron');
      expect(g['qty'], 2);
      expect(g['cost'], 500);
    });
  });

  group('isPoOpen/openPurchaseOrders -- the one shared condition the Alerts Center and the '
      'Purchases screen\'s own default-tab decision both now read (Native POS Operational '
      'Features audit: these used to be two separate, independently-written copies of the same '
      'filter)', () {
    test('a draft PO is open', () {
      expect(isPoOpen({'status': 'draft'}), isTrue);
    });

    test('a received PO is not open', () {
      expect(isPoOpen({'status': 'received'}), isFalse);
    });

    test('a PO with no status field at all defaults to open, matching the website\'s own '
        '`status||\'draft\'` fallback -- never a false negative that hides it', () {
      expect(isPoOpen({}), isTrue);
    });

    test('openPurchaseOrders returns only the open ones, newest or oldest order unspecified but every open one present', () async {
      final repo = mk(FakeServer());
      await repo.save('po', {'supplier': 'A', 'items': [], 'status': 'draft'});
      await repo.save('po', {'supplier': 'B', 'items': [], 'status': 'received'});
      await repo.save('po', {'supplier': 'C', 'items': []}); // no status at all -- still open

      final open = openPurchaseOrders(repo);
      expect(open.length, 2);
      expect(open.map((p) => p['supplier']).toSet(), {'A', 'C'});
    });

    test('an empty catalog has no open purchase orders, not an error', () async {
      final repo = mk(FakeServer());
      expect(openPurchaseOrders(repo), isEmpty);
    });
  });
}
