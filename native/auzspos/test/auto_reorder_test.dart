import 'package:auzspos/core/auto_reorder.dart';
import 'package:flutter_test/flutter_test.dart';
import 'sync_test.dart' show FakeServer, mk;

/// Automatic draft Purchase Orders from low stock, ported from the website's reorderPO()
/// (app/public/console/p-extras.js). Pure functions over a Repo, same split as stock_test.dart/
/// wastage_test.dart/costing_test.dart/purchase_orders_test.dart/purchases_test.dart.
void main() {
  group('planAutoReorder: matches reorderPO()\'s own quantity formula exactly', () {
    test('a low material\'s suggested quantity brings it back to twice its reorder level', () async {
      final repo = mk(FakeServer());
      await repo.save('ing', {'name': 'Milk', 'qty': 2, 'low': 10, 'cost': 40, 'vendor': 'Dairy Co'});
      final groups = planAutoReorder(repo);
      expect(groups.length, 1);
      expect(groups.single.vendor, 'Dairy Co');
      expect(groups.single.items.single, {'ing': 'Milk', 'qty': 18, 'price': 40}, reason: '10*2 - 2 = 18');
    });

    test('a material exactly at its threshold still floors at 1 (max(1, low*2-qty))', () async {
      final repo = mk(FakeServer());
      await repo.save('ing', {'name': 'Pepper', 'qty': 1, 'low': 1, 'cost': 500, 'vendor': ''}); // 1*2-1=1
      final groups = planAutoReorder(repo);
      expect(groups.single.items.single['qty'], 1);
    });

    test('materials with no low threshold set (low defaults to 0) are only flagged once qty hits \n       zero or below -- same as isLowStock() elsewhere in this codebase', () async {
      final repo = mk(FakeServer());
      await repo.save('ing', {'name': 'Yeast', 'qty': 0, 'vendor': 'Bakers'});
      final groups = planAutoReorder(repo);
      expect(groups.single.items.single, {'ing': 'Yeast', 'qty': 1, 'price': 0}, reason: 'low*2-qty = 0*2-0 = 0, floored to 1');
    });

    test('materials with plenty of stock are never included', () async {
      final repo = mk(FakeServer());
      await repo.save('ing', {'name': 'Rice', 'qty': 500, 'low': 10, 'vendor': 'Mart'});
      expect(planAutoReorder(repo), isEmpty);
    });
  });

  group('planAutoReorder: grouping by vendor, matching one PO per supplier', () {
    test('two low materials from the SAME vendor land in one group', () async {
      final repo = mk(FakeServer());
      await repo.save('ing', {'name': 'Milk', 'qty': 2, 'low': 10, 'cost': 40, 'vendor': 'Dairy Co'});
      await repo.save('ing', {'name': 'Cream', 'qty': 1, 'low': 5, 'cost': 90, 'vendor': 'Dairy Co'});
      final groups = planAutoReorder(repo);
      expect(groups.length, 1);
      expect(groups.single.items.map((i) => i['ing']).toSet(), {'Milk', 'Cream'});
    });

    test('low materials from DIFFERENT vendors land in separate groups', () async {
      final repo = mk(FakeServer());
      await repo.save('ing', {'name': 'Milk', 'qty': 2, 'low': 10, 'vendor': 'Dairy Co'});
      await repo.save('ing', {'name': 'Pepper', 'qty': 0, 'low': 2, 'vendor': 'Spice Co'});
      final groups = planAutoReorder(repo);
      expect(groups.length, 2);
      expect(groups.map((g) => g.vendor).toSet(), {'Dairy Co', 'Spice Co'});
    });

    test('materials with no vendor set at all are grouped together under the empty vendor', () async {
      final repo = mk(FakeServer());
      await repo.save('ing', {'name': 'A', 'qty': 0, 'low': 1});
      await repo.save('ing', {'name': 'B', 'qty': 0, 'low': 1, 'vendor': ''});
      final groups = planAutoReorder(repo);
      expect(groups.length, 1);
      expect(groups.single.vendor, '');
      expect(groups.single.items.length, 2);
    });

    test('an empty catalog plans nothing, not an error', () async {
      final repo = mk(FakeServer());
      expect(planAutoReorder(repo), isEmpty);
    });
  });

  group('autoPoNo: the auto-draft\'s own numbering scheme (distinct from the manual PO form\'s)', () {
    test('is the last 6 digits of the millisecond clock, prefixed PO-', () {
      final no = autoPoNo(now: DateTime.fromMillisecondsSinceEpoch(1760000123456));
      expect(no, 'PO-123456');
    });

    test('a very early clock value (fewer than 6 digits) is used as-is, never crashes', () {
      final no = autoPoNo(now: DateTime.fromMillisecondsSinceEpoch(42));
      expect(no, 'PO-42');
    });
  });

  group('createAutoReorderDrafts: writes the same shape as reorderPO(), nothing more', () {
    test('writes one po record per group with the exact fields reorderPO() writes', () async {
      final repo = mk(FakeServer());
      await repo.save('ing', {'name': 'Milk', 'qty': 2, 'low': 10, 'cost': 40, 'vendor': 'Dairy Co'});
      final groups = planAutoReorder(repo);
      final created = await createAutoReorderDrafts(repo, groups);

      expect(created.length, 1);
      final po = repo.of('po').single;
      expect(po['supplier'], 'Dairy Co');
      expect(po['status'], 'draft');
      expect(po['note'], 'Auto from low stock');
      expect(po['items'], [{'ing': 'Milk', 'qty': 18, 'price': 40}]);
      expect(po['no'], isA<String>());
      expect('${po['no']}'.startsWith('PO-'), true);
      expect(po['createdAt'], isNotNull);
    });

    test('never touches ing.qty or ing.cost -- a draft PO is paperwork only, stock is untouched \n       until the existing, separately-confirmed receive flow runs', () async {
      final repo = mk(FakeServer());
      await repo.save('ing', {'name': 'Milk', 'qty': 2, 'low': 10, 'cost': 40, 'vendor': 'Dairy Co'});
      await createAutoReorderDrafts(repo, planAutoReorder(repo));
      final g = repo.of('ing').single;
      expect(g['qty'], 2, reason: 'drafting an order must never move stock by itself');
      expect(g['cost'], 40);
      expect(repo.of('purchase'), isEmpty, reason: 'no purchase record either -- that only exists after a real receipt');
    });

    test('writing an empty group list is a safe no-op', () async {
      final repo = mk(FakeServer());
      final created = await createAutoReorderDrafts(repo, []);
      expect(created, isEmpty);
      expect(repo.of('po'), isEmpty);
    });

    test('a group whose items list is empty is skipped, never writing a blank PO', () async {
      final repo = mk(FakeServer());
      final created = await createAutoReorderDrafts(repo, [AutoReorderGroup('Nobody', [])]);
      expect(created, isEmpty);
      expect(repo.of('po'), isEmpty);
    });
  });

  group('pendingAutoReorder: the native-only duplicate-prevention guard the website does not have', () {
    test('a vendor with an already-open auto-drafted PO is skipped on a second run', () async {
      final repo = mk(FakeServer());
      await repo.save('ing', {'name': 'Milk', 'qty': 2, 'low': 10, 'cost': 40, 'vendor': 'Dairy Co'});

      final first = pendingAutoReorder(repo);
      expect(first.length, 1, reason: 'nothing drafted yet, so the first run has a real vendor to act on');
      await createAutoReorderDrafts(repo, first);

      // Stock is still exactly as low as before (the draft did not fix anything), so a naive re-plan
      // would still see it -- but the guard must now suppress Dairy Co since an open draft already
      // covers it.
      final second = pendingAutoReorder(repo);
      expect(second, isEmpty, reason: 'Dairy Co already has an open auto-draft; re-running must not create a duplicate');

      // planAutoReorder() itself (no guard) still sees the real low-stock condition -- proving the
      // suppression lives in pendingAutoReorder(), not in the underlying stock data.
      expect(planAutoReorder(repo).length, 1);
    });

    test('once the open auto-draft is RECEIVED, a still-low vendor becomes eligible again', () async {
      final repo = mk(FakeServer());
      await repo.save('ing', {'name': 'Milk', 'qty': 2, 'low': 10, 'cost': 40, 'vendor': 'Dairy Co'});
      final created = (await createAutoReorderDrafts(repo, pendingAutoReorder(repo))).single;
      expect(pendingAutoReorder(repo), isEmpty);

      // Mark it received directly (not exercising receivePurchaseOrder() here -- that function's own
      // behavior is covered by purchase_orders_test.dart; this test only needs the PO's status to
      // change) without actually adding stock, so the material is still genuinely low afterward.
      await repo.save('po', {...created, 'status': 'received', 'receivedAt': '2026-10-16T00:00:00Z'}, id: '${created['id']}');

      final again = pendingAutoReorder(repo);
      expect(again.length, 1, reason: 'the old draft is no longer open, so a genuinely still-low vendor is eligible again');
    });

    test('once the open auto-draft is DELETED, a still-low vendor becomes eligible again', () async {
      final repo = mk(FakeServer());
      await repo.save('ing', {'name': 'Milk', 'qty': 2, 'low': 10, 'cost': 40, 'vendor': 'Dairy Co'});
      final created = (await createAutoReorderDrafts(repo, pendingAutoReorder(repo))).single;
      await repo.save('po', created, id: '${created['id']}', deleted: true);

      expect(pendingAutoReorder(repo).length, 1);
    });

    test('a MANUALLY created draft PO for the same vendor (no auto-reorder note) does NOT suppress \n       the automation -- only its own auto-generated drafts are recognised, never conflated with a \n       human-authored one that happens to share a supplier name', () async {
      final repo = mk(FakeServer());
      await repo.save('ing', {'name': 'Milk', 'qty': 2, 'low': 10, 'cost': 40, 'vendor': 'Dairy Co'});
      await repo.save('po', {'supplier': 'Dairy Co', 'items': [], 'status': 'draft', 'note': 'Manually created', 'no': 'PO-0001'});

      expect(pendingAutoReorder(repo).length, 1, reason: 'a human-authored draft for this vendor is not this automation\'s business to suppress');
    });

    test('a DIFFERENT vendor is unaffected by one vendor already having an open auto-draft', () async {
      final repo = mk(FakeServer());
      await repo.save('ing', {'name': 'Milk', 'qty': 2, 'low': 10, 'cost': 40, 'vendor': 'Dairy Co'});
      await repo.save('ing', {'name': 'Pepper', 'qty': 0, 'low': 2, 'vendor': 'Spice Co'});
      await createAutoReorderDrafts(repo, planAutoReorder(repo).where((g) => g.vendor == 'Dairy Co').toList());

      final pending = pendingAutoReorder(repo);
      expect(pending.length, 1);
      expect(pending.single.vendor, 'Spice Co');
    });
  });

  group('repeated triggers overall: calling the full plan-then-create flow twice in a row never \n       doubles up a vendor\'s draft, matching this task\'s own duplicate-prevention requirement', () {
    test('running the automation end to end twice in a row creates exactly one PO per vendor, not two', () async {
      final repo = mk(FakeServer());
      await repo.save('ing', {'name': 'Milk', 'qty': 2, 'low': 10, 'cost': 40, 'vendor': 'Dairy Co'});

      await createAutoReorderDrafts(repo, pendingAutoReorder(repo));
      await createAutoReorderDrafts(repo, pendingAutoReorder(repo)); // simulates a second tap of the same action

      expect(repo.of('po').where((p) => p['note'] == 'Auto from low stock' && p['supplier'] == 'Dairy Co').length, 1);
    });
  });
}
