import 'package:auzspos/core/inventory_reports.dart' show isLowStock;
import 'package:auzspos/ui/console.dart' show computeConsoleAlerts;
import 'package:flutter_test/flutter_test.dart';
import 'sync_test.dart' show FakeServer, mk;

/// Native POS Operational Features audit, Phase 5: regression guard for the low-stock inconsistency
/// found between isLowStock() (core/inventory_reports.dart, qty<=low, no guard -- confirmed to match
/// the website's own `lowIng=g=>(g.qty||0)<=(g.low||0)` directly) and six places that instead used a
/// DIFFERENT inline formula with an extra `low>0 &&` guard (the Alerts Center's 'lowstock' alert and
/// its own Smart Daily Operations zero-stock refinement in console.dart, the raw-materials row label
/// and StockAdmin's KPI in console_pages.dart, and the admin dashboard count plus a local isLow()
/// helper in admin.dart). All six now call isLowStock() directly -- these tests exercise the one
/// call site that is unit-testable without a widget harness (computeConsoleAlerts()'s 'lowstock'
/// alert) across the exact boundary matrix the audit asked for, and prove it stays byte-for-byte
/// consistent with isLowStock() itself (the same function every other call site now also calls, so
/// this is the testable proxy for "the alert and its destination screens can never disagree again").
void main() {
  group('boundary matrix: isLowStock() and the Alerts Center agree at every boundary', () {
    test('zero stock with a zero threshold is low stock', () {
      final g = {'name': 'A', 'qty': 0, 'low': 0};
      expect(isLowStock(g), isTrue);
    });

    test('zero stock with no threshold configured at all is low stock (never "always exempt")', () {
      final g = {'name': 'B', 'qty': 0};
      expect(isLowStock(g), isTrue);
    });

    test('positive stock below its threshold is low stock', () {
      final g = {'name': 'C', 'qty': 3, 'low': 10};
      expect(isLowStock(g), isTrue);
    });

    test('stock exactly at the threshold is low stock (the boundary itself counts, not just strictly below)', () {
      final g = {'name': 'D', 'qty': 10, 'low': 10};
      expect(isLowStock(g), isTrue);
    });

    test('normal stock above the threshold is not low stock', () {
      final g = {'name': 'E', 'qty': 50, 'low': 10};
      expect(isLowStock(g), isFalse);
    });

    test('normal stock with no threshold configured is not low stock', () {
      final g = {'name': 'F', 'qty': 500};
      expect(isLowStock(g), isFalse);
    });
  });

  group('the Alerts Center\'s \'lowstock\' alert now agrees with isLowStock() at every one of those boundaries, for real saved records', () {
    test('a material at zero stock with a zero threshold is flagged by the Alerts Center', () async {
      final repo = mk(FakeServer());
      await repo.save('ing', {'name': 'Yeast', 'qty': 0, 'low': 0});
      final alerts = computeConsoleAlerts(repo);
      expect(alerts.singleWhere((a) => a.kind == 'lowstock').count, 1);
    });

    test('a material at zero stock with NO threshold field at all is flagged by the Alerts Center -- '
        'the exact gap this audit found: before the fix, this material was silently invisible here '
        'even though it had literally nothing left to sell', () async {
      final repo = mk(FakeServer());
      await repo.save('ing', {'name': 'Saffron', 'qty': 0});
      final alerts = computeConsoleAlerts(repo);
      expect(alerts.singleWhere((a) => a.kind == 'lowstock').count, 1);
    });

    test('a material exactly at its threshold is flagged by the Alerts Center', () async {
      final repo = mk(FakeServer());
      await repo.save('ing', {'name': 'Oil', 'qty': 10, 'low': 10});
      final alerts = computeConsoleAlerts(repo);
      expect(alerts.singleWhere((a) => a.kind == 'lowstock').count, 1);
    });

    test('a material comfortably above its threshold is never flagged', () async {
      final repo = mk(FakeServer());
      await repo.save('ing', {'name': 'Rice', 'qty': 500, 'low': 10});
      expect(computeConsoleAlerts(repo).where((a) => a.kind == 'lowstock'), isEmpty);
    });
  });

  group('alert counts match isLowStock() exactly -- the testable proxy for "the alert and the '
      'screens it sends you to can never disagree again" (every screen now calls the same function)', () {
    test('the lowstock alert\'s count always equals repo.of(\'ing\').where(isLowStock).length, across '
        'a mix of every boundary case at once', () async {
      final repo = mk(FakeServer());
      await repo.save('ing', {'name': 'ZeroZero', 'qty': 0, 'low': 0}); // low
      await repo.save('ing', {'name': 'ZeroNoThreshold', 'qty': 0}); // low
      await repo.save('ing', {'name': 'BelowThreshold', 'qty': 3, 'low': 10}); // low
      await repo.save('ing', {'name': 'AtThreshold', 'qty': 10, 'low': 10}); // low
      await repo.save('ing', {'name': 'AboveThreshold', 'qty': 50, 'low': 10}); // not low
      await repo.save('ing', {'name': 'NoThresholdStocked', 'qty': 500}); // not low

      final expectedCount = repo.of('ing').where(isLowStock).length;
      expect(expectedCount, 4, reason: 'sanity check on the fixture itself');

      final lowstock = computeConsoleAlerts(repo).singleWhere((a) => a.kind == 'lowstock');
      expect(lowstock.count, expectedCount);
    });
  });

  group('no duplicate or missing low-stock alerts', () {
    test('several low materials across different boundary cases still produce exactly ONE lowstock alert, never one per material', () async {
      final repo = mk(FakeServer());
      await repo.save('ing', {'name': 'A', 'qty': 0, 'low': 0});
      await repo.save('ing', {'name': 'B', 'qty': 0});
      await repo.save('ing', {'name': 'C', 'qty': 10, 'low': 10});

      final alerts = computeConsoleAlerts(repo);
      expect(alerts.where((a) => a.kind == 'lowstock').length, 1, reason: 'one alert for the whole condition');
      expect(alerts.singleWhere((a) => a.kind == 'lowstock').count, 3);
    });

    test('an empty catalog produces no lowstock alert at all, not a false positive', () async {
      final repo = mk(FakeServer());
      expect(computeConsoleAlerts(repo).where((a) => a.kind == 'lowstock'), isEmpty);
    });

    test('restocking a zero-threshold, zero-stock material above its (zero) threshold removes the alert on the very next read', () async {
      final repo = mk(FakeServer());
      final g = (await repo.save('ing', {'name': 'Yeast', 'qty': 0, 'low': 0})).data;
      expect(computeConsoleAlerts(repo).where((a) => a.kind == 'lowstock'), isNotEmpty);

      await repo.save('ing', {...g, 'qty': 5}, id: '${g['id']}');
      expect(computeConsoleAlerts(repo).where((a) => a.kind == 'lowstock'), isEmpty);
    });
  });
}
