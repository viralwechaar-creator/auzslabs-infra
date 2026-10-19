import 'package:auzspos/core/wastage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'sync_test.dart' show FakeServer, mk;

/// Wastage tracking, ported from the website's wasteForm()/invReport('waste')
/// (app/public/console/p-inventory.js). Pure functions over a Repo, same split as
/// stock_test.dart/purchase_orders_test.dart, so the recording and reporting math is directly
/// provable.
void main() {
  group('recordWastage: valid entries reduce stock and log a waste record', () {
    test('a positive quantity subtracts from stock on hand and logs the reason', () async {
      final repo = mk(FakeServer());
      final milk = (await repo.save('ing', {'name': 'Milk', 'qty': 10, 'unit': 'l', 'cost': 40})).data;

      await recordWastage(repo, milk, qty: 2, reason: 'Spoiled', by: 'owner@shop.test');

      final g = repo.of('ing').firstWhere((x) => x['name'] == 'Milk');
      expect(g['qty'], 8);

      final waste = repo.of('waste').single;
      expect(waste['ing'], 'Milk');
      expect(waste['q'], 2);
      expect(waste['reason'], 'Spoiled');
      expect(waste['by'], 'owner@shop.test');
      expect(waste['at'], isNotNull);
      expect(waste['d'], isNotNull);
    });

    test('manual wastage never touches ing.usage -- the website\'s wasteForm() does not either, \n       unlike a sale or the auto-cancel-after-KOT path', () async {
      final repo = mk(FakeServer());
      final sugar = (await repo.save('ing', {'name': 'Sugar', 'qty': 20, 'unit': 'kg', 'usage': [{'q': 1, 'd': '2026-01-01'}]})).data;
      await recordWastage(repo, sugar, qty: 3, reason: 'Spilled');
      final g = repo.of('ing').firstWhere((x) => x['name'] == 'Sugar');
      expect(g['usage'], [{'q': 1, 'd': '2026-01-01'}], reason: 'usage history must be left exactly as it was');
    });

    test('each of the website\'s own reason options is accepted as-is', () async {
      final repo = mk(FakeServer());
      await repo.save('ing', {'name': 'Bread', 'qty': 100, 'unit': 'pcs'});
      for (final reason in wastageReasons) {
        await recordWastage(repo, repo.of('ing').firstWhere((x) => x['name'] == 'Bread'), qty: 1, reason: reason);
      }
      expect(repo.of('waste').map((w) => w['reason']).toSet(), wastageReasons.toSet());
      expect(repo.of('ing').firstWhere((x) => x['name'] == 'Bread')['qty'], 100 - wastageReasons.length);
    });
  });

  group('recordWastage: invalid quantities are refused defensively', () {
    test('a zero quantity makes no change at all', () async {
      final repo = mk(FakeServer());
      final g = (await repo.save('ing', {'name': 'Milk', 'qty': 10, 'unit': 'l'})).data;
      await recordWastage(repo, g, qty: 0, reason: 'Spoiled');
      expect(repo.of('ing').firstWhere((x) => x['name'] == 'Milk')['qty'], 10);
      expect(repo.of('waste'), isEmpty);
    });

    test('a negative quantity makes no change at all (never adds stock back via wastage)', () async {
      final repo = mk(FakeServer());
      final g = (await repo.save('ing', {'name': 'Milk', 'qty': 10, 'unit': 'l'})).data;
      await recordWastage(repo, g, qty: -5, reason: 'Spoiled');
      expect(repo.of('ing').firstWhere((x) => x['name'] == 'Milk')['qty'], 10);
      expect(repo.of('waste'), isEmpty);
    });
  });

  group('stock can go negative, same as the website (no floor-at-zero clamp in wasteForm)', () {
    test('wasting more than is on hand is not blocked by this function -- the UI\'s review step is \n       where a sanity check belongs, matching the website\'s own unclamped wasteForm()', () async {
      final repo = mk(FakeServer());
      final g = (await repo.save('ing', {'name': 'Cream', 'qty': 2, 'unit': 'l'})).data;
      await recordWastage(repo, g, qty: 5, reason: 'Spoiled');
      expect(repo.of('ing').firstWhere((x) => x['name'] == 'Cream')['qty'], -3);
    });
  });

  group('repeated submissions', () {
    test('calling recordWastage twice (simulating a duplicate tap not caught by the UI guard) \n       deducts stock twice -- this free function has no built-in idempotency key of its own, \n       exactly like dedu() for sales; duplicate-submission protection is the UI\'s job', () async {
      final repo = mk(FakeServer());
      final g = (await repo.save('ing', {'name': 'Milk', 'qty': 10, 'unit': 'l'})).data;
      await recordWastage(repo, g, qty: 2, reason: 'Spoiled');
      await recordWastage(repo, repo.of('ing').firstWhere((x) => x['name'] == 'Milk'), qty: 2, reason: 'Spoiled');
      expect(repo.of('ing').firstWhere((x) => x['name'] == 'Milk')['qty'], 6, reason: 'each call is a real, distinct wastage event -- this documents the behavior, it is not a bug');
      expect(repo.of('waste').length, 2);
    });
  });

  group('wastageCost: computed from the CURRENT cost, not frozen at the time of waste', () {
    test('cost follows the material\'s live cost field, matching invReport(\'waste\') exactly', () async {
      final repo = mk(FakeServer());
      final g = (await repo.save('ing', {'name': 'Paneer', 'qty': 10, 'cost': 200})).data;
      await recordWastage(repo, g, qty: 2, reason: 'Spoiled');
      final w = repo.of('waste').single;
      expect(wastageCost(repo, w), 400, reason: '2 * 200');

      // The cost of the material changes later -- the already-recorded entry's reported cost
      // follows it, exactly like the website's own render-time lookup.
      await repo.save('ing', {...repo.of('ing').firstWhere((x) => x['name'] == 'Paneer'), 'cost': 250}, id: '${g['id']}');
      expect(wastageCost(repo, w), 500, reason: '2 * 250 -- the historical entry is not frozen at the old cost');
    });

    test('a wastage entry for a material with no cost set (or no longer in the catalog) costs ₹0, \n       not an error', () async {
      final repo = mk(FakeServer());
      expect(wastageCost(repo, {'ing': 'Ghost Material', 'q': 5}), 0);
    });
  });

  group('wastageRows: date-range filter and sort, matching invReport(\'waste\')', () {
    test('only entries within [from, to] are returned, newest first', () async {
      final repo = mk(FakeServer());
      await repo.save('waste', {'ing': 'Milk', 'q': 1, 'd': '2026-10-01'});
      await repo.save('waste', {'ing': 'Milk', 'q': 2, 'd': '2026-10-15'});
      await repo.save('waste', {'ing': 'Milk', 'q': 3, 'd': '2026-11-01'}); // outside range

      final rows = wastageRows(repo, from: '2026-10-01', to: '2026-10-31');
      expect(rows.length, 2);
      expect(rows.map((r) => r['d']), ['2026-10-15', '2026-10-01'], reason: 'newest first');
    });

    test('an empty range returns an empty list, not an error', () async {
      final repo = mk(FakeServer());
      expect(wastageRows(repo, from: '2026-01-01', to: '2026-01-31'), isEmpty);
    });
  });

  group('wastageCostThisMonth: the same KPI figure shown on inv/stock and inv/raw', () {
    test('sums only this calendar month\'s entries at their current cost', () async {
      final repo = mk(FakeServer());
      final now = DateTime.now();
      final thisMonth = '${now.year}-${now.month.toString().padLeft(2, '0')}-05';
      await repo.save('ing', {'name': 'Milk', 'qty': 50, 'cost': 40});
      await repo.save('waste', {'ing': 'Milk', 'q': 2, 'd': thisMonth});
      // A year-old entry (same calendar month string collision is impossible unless this test runs
      // in that exact month of a different year, which the explicit year below rules out).
      await repo.save('waste', {'ing': 'Milk', 'q': 100, 'd': '2020-01-01'});

      expect(wastageCostThisMonth(repo), 80, reason: '2 * 40 -- the old entry from a different month must not count');
    });
  });
}
