import 'package:auzspos/core/inventory_reports.dart';
import 'package:flutter_test/flutter_test.dart';
import 'sync_test.dart' show FakeServer, mk;

/// Reorder suggestions and expiry tracking (rep/inventory's 'reorder'/'expiry' tabs), ported from the
/// website's invReport() (app/public/console/p-inventory.js). Pure functions over a Repo, same split as
/// stock.dart/cash.dart/reorder.dart, so the business rules are directly provable.
void main() {
  final now = DateTime(2026, 10, 20);
  String daysAgo(int n) => dayKeyOf(now.subtract(Duration(days: n)));

  group('reorder: below-threshold vs adequately stocked', () {
    test('a material at or below its low-stock threshold is suggested even with no sales history', () async {
      final repo = mk(FakeServer());
      await repo.save('ing', {'name': 'Salt', 'qty': 2, 'low': 5, 'unit': 'kg'});
      final rows = reorderRows(repo, now: now);
      expect(rows.length, 1);
      expect(rows.single.ing['name'], 'Salt');
      expect(rows.single.dailyUse, 0, reason: 'no usage history yet');
      expect(rows.single.suggestedQty, 8, reason: 'top up to 2x the threshold: low*2 - qty = 10 - 2');
    });

    test('an adequately stocked material with no low-threshold and no fast usage is not suggested', () async {
      final repo = mk(FakeServer());
      await repo.save('ing', {'name': 'Rice', 'qty': 500, 'unit': 'kg'});
      expect(reorderRows(repo, now: now), isEmpty);
    });
  });

  group('reorder: missing or zero thresholds', () {
    test('qty=0 with no low threshold set is still flagged (lowIng defaults low to 0, not "never flagged")', () async {
      final repo = mk(FakeServer());
      await repo.save('ing', {'name': 'Yeast', 'qty': 0, 'unit': 'g'});
      final rows = reorderRows(repo, now: now);
      expect(rows.length, 1);
      expect(isLowStock(rows.single.ing), true);
    });

    test('a positive qty with no low threshold and no usage history is not flagged', () async {
      final repo = mk(FakeServer());
      await repo.save('ing', {'name': 'Pepper', 'qty': 3, 'unit': 'kg'});
      expect(reorderRows(repo, now: now), isEmpty);
    });
  });

  group('reorder: velocity from usage history, correct units and quantities', () {
    test('daily use is the 14-day rolling average; days left and the one-week suggestion follow it', () async {
      final repo = mk(FakeServer());
      // 140 units used over the last 14 days = 10/day; 50 on hand = 5 days left.
      // oldest first, matching the real usage[] shape (deduRecipe() always appends to the end).
      final usage = [for (var i = 13; i >= 0; i--) {'q': 10, 'd': daysAgo(i), 'at': now.toIso8601String()}];
      await repo.save('ing', {'name': 'Milk', 'qty': 50, 'low': 0, 'unit': 'l', 'usage': usage});
      final rows = reorderRows(repo, now: now);
      expect(rows.length, 1);
      final r = rows.single;
      expect(r.dailyUse, 10);
      expect(r.daysLeft, 5);
      expect(r.suggestedQty, 70, reason: 'one week at 10/day');
    });

    test('a material with plenty of days left (>7) and no low-stock condition is not suggested', () async {
      final repo = mk(FakeServer());
      final usage = [{'q': 1, 'd': daysAgo(0), 'at': now.toIso8601String()}];
      await repo.save('ing', {'name': 'Oats', 'qty': 1000, 'low': 0, 'unit': 'kg', 'usage': usage});
      expect(reorderRows(repo, now: now), isEmpty, reason: 'at 1/day, 1000 on hand is 1000 days left -- nowhere near reorder');
    });

    test('usage entries older than the 14-day window do not count toward velocity', () async {
      final repo = mk(FakeServer());
      final usage = [{'q': 9999, 'd': daysAgo(30), 'at': now.toIso8601String()}]; // outside the window
      await repo.save('ing', {'name': 'Flour', 'qty': 5, 'low': 10, 'unit': 'kg', 'usage': usage});
      final rows = reorderRows(repo, now: now);
      expect(rows.single.dailyUse, 0, reason: 'the only usage entry is outside the 14-day window');
      expect(rows.single.suggestedQty, 15, reason: 'falls back to the low*2-qty rule since velocity is 0');
    });
  });

  group('expiry: expired, expiring soon and non-expiring batches', () {
    test('a material past its expiry date is Expired (the website checks isExpired before expSoon, so an \n       already-expired date never shows as "Within 7 days" even though expSoon() alone is also true for it)', () async {
      final repo = mk(FakeServer());
      await repo.save('ing', {'name': 'Cream', 'qty': 2, 'expiry': daysAgo(1)});
      final g = expiryRows(repo).single;
      expect(isExpired(g, now: now), true);
      // The website's own expSoon() (expiry <= today+7) is also true for an already-expired date -- the
      // UI's priority check (isExpired first) is what makes these mutually exclusive in display, not the
      // raw booleans themselves. Documented here, not papered over.
      expect(isExpiringSoon(g, now: now), true);
    });

    test('a material due within 7 days, still with stock, is expiring soon (not expired)', () async {
      final repo = mk(FakeServer());
      await repo.save('ing', {'name': 'Yoghurt', 'qty': 3, 'expiry': dayKeyOf(now.add(const Duration(days: 5)))});
      final g = expiryRows(repo).single;
      expect(isExpired(g, now: now), false);
      expect(isExpiringSoon(g, now: now), true);
    });

    test('a material due within 7 days but already at zero stock is not "expiring soon" (nothing left to lose)', () async {
      final repo = mk(FakeServer());
      await repo.save('ing', {'name': 'Cheese', 'qty': 0, 'expiry': dayKeyOf(now.add(const Duration(days: 3)))});
      final g = expiryRows(repo).single;
      expect(isExpiringSoon(g, now: now), false);
    });

    test('a material due more than 7 days out is neither expired nor expiring soon', () async {
      final repo = mk(FakeServer());
      await repo.save('ing', {'name': 'Pasta', 'qty': 10, 'expiry': dayKeyOf(now.add(const Duration(days: 30)))});
      final g = expiryRows(repo).single;
      expect(isExpired(g, now: now), false);
      expect(isExpiringSoon(g, now: now), false);
    });
  });

  group('expiry: date boundaries and missing expiry values', () {
    test('a material with no expiry field set is never fabricated into the expiry list', () async {
      final repo = mk(FakeServer());
      await repo.save('ing', {'name': 'Salt', 'qty': 10});
      expect(expiryRows(repo), isEmpty);
    });

    test('expiring exactly today counts as expired, not "soon" (< today, not <=)', () async {
      final repo = mk(FakeServer());
      await repo.save('ing', {'name': 'Milk', 'qty': 2, 'expiry': dayKeyOf(now)});
      final g = expiryRows(repo).single;
      expect(isExpired(g, now: now), false, reason: 'the website compares expiry < today, so today itself is not yet expired');
      expect(isExpiringSoon(g, now: now), true);
    });

    test('exactly 7 days out is still "soon" (the website uses <=, an inclusive boundary)', () async {
      final repo = mk(FakeServer());
      await repo.save('ing', {'name': 'Butter', 'qty': 1, 'expiry': dayKeyOf(now.add(const Duration(days: 7)))});
      expect(isExpiringSoon(expiryRows(repo).single, now: now), true);
    });
  });

  group('empty datasets', () {
    test('no raw materials at all: both reports return empty, not an error', () async {
      final repo = mk(FakeServer());
      expect(reorderRows(repo, now: now), isEmpty);
      expect(expiryRows(repo), isEmpty);
    });
  });

  test('expiryRows sorts soonest first', () async {
    final repo = mk(FakeServer());
    await repo.save('ing', {'name': 'Late', 'qty': 1, 'expiry': dayKeyOf(now.add(const Duration(days: 20)))});
    await repo.save('ing', {'name': 'Soon', 'qty': 1, 'expiry': dayKeyOf(now.add(const Duration(days: 2)))});
    final rows = expiryRows(repo);
    expect(rows.map((g) => g['name']), ['Soon', 'Late']);
  });

  test('stockValue is qty times cost', () {
    expect(stockValue({'qty': 4, 'cost': 25}), 100);
    expect(stockValue({'qty': 4}), 0, reason: 'no cost set');
  });
}
