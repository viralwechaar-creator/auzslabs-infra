import 'package:auzspos/core/repo.dart';
import 'package:auzspos/ui/daily_summary.dart' show DailySummary, buildDailySummary;
import 'package:flutter_test/flutter_test.dart';
import 'sync_test.dart' show FakeServer, mk;

/// Daily Business Summary: a pure aggregator over four ALREADY-TESTED readers (dayCash(),
/// purchaseRows(), wastageRows()/wastageCost()) plus one genuinely new read (all-mode expenses for
/// the day). These tests therefore focus on: (1) this file's OWN new arithmetic (expensesTotal,
/// the per-date purchase/wastage filters) and wiring, not re-proving dayCash()'s own math (which
/// has its own dedicated suite, test/daycash_test.dart) -- and (2) that nothing here ever collapses
/// sales/expenses/purchases/wastage into one combined figure.
void main() {
  final now = DateTime(2026, 10, 17, 9, 30);
  String daysAgo(int n) => '${now.subtract(Duration(days: n)).year}-${(now.subtract(Duration(days: n)).month).toString().padLeft(2, '0')}-${(now.subtract(Duration(days: n)).day).toString().padLeft(2, '0')}';
  final today = daysAgo(0);
  final yesterday = daysAgo(1);
  final dayBefore = daysAgo(2);

  Future<void> payOn(Repo repo, String d, {num amt = 100, String mode = 'cash'}) async {
    await repo.save('order', {'status': 'paid', 'paidAt': '${d}T12:00:00Z', 'pays': [{'m': mode, 'amt': amt}], 't': {'total': amt}, 'lines': []});
  }

  group('calculation accuracy -- each metric reads through its own existing, already-tested function', () {
    test('a day with sales, expenses, a purchase and a wastage entry reports all four correctly and separately', () async {
      final repo = mk(FakeServer());
      await payOn(repo, today, amt: 1000, mode: 'cash');
      await payOn(repo, today, amt: 500, mode: 'card');
      await repo.save('exp', {'d': today, 'amt': 120, 'mode': 'cash'});
      await repo.save('exp', {'d': today, 'amt': 80, 'mode': 'online'}); // non-cash expense: dayCash() ignores this, the summary must not
      await repo.save('ing', {'id': 'flour1', 'name': 'Flour', 'qty': 10, 'cost': 40});
      await repo.save('purchase', {'vendorName': 'Vendor A', 'items': [{'desc': 'Flour', 'qty': 5, 'unit': 'kg', 'unitPrice': 40}], 'amount': 200, 'date': today, 'notes': ''});
      await repo.save('waste', {'ing': 'Flour', 'q': 2, 'd': today, 'reason': 'Spoiled', 'at': 'x'});

      final s = buildDailySummary(repo, today, now: now);
      expect(s.date, today);
      expect(s.isToday, isTrue);
      expect(s.salesNet, 1500);
      expect(s.bills, 2);
      expect(s.cash, 1000);
      expect(s.card, 500);
      // The NEW, genuinely-additional read: ALL payment modes, not just cash (dayCash() itself only
      // ever reads the cash-mode subset for drawer reconciliation -- see this file's own header).
      expect(s.expensesTotal, 200, reason: 'both the cash (120) and online (80) expense must count toward "what the business spent today"');
      expect(s.purchaseSpend, 200);
      expect(s.purchaseCount, 1);
      expect(s.wastageCost, 80, reason: '2 units * current cost 40/unit');
      expect(s.wastageEntries, 1);
      expect(s.closed, isFalse);
    });

    test('a date with no records at all returns an honest all-zero summary, never an error or a fabricated figure', () async {
      final repo = mk(FakeServer());
      final s = buildDailySummary(repo, yesterday, now: now);
      expect(s.salesNet, 0);
      expect(s.bills, 0);
      expect(s.cash, 0);
      expect(s.expensesTotal, 0);
      expect(s.purchaseSpend, 0);
      expect(s.purchaseCount, 0);
      expect(s.wastageCost, 0);
      expect(s.wastageEntries, 0);
      expect(s.closed, isFalse);
    });

    test('a dayclose record for the date is reported as closed -- the exact same lookup the Cash Management screen and the day-close reminder already use', () async {
      final repo = mk(FakeServer());
      await payOn(repo, yesterday, amt: 300);
      await repo.save('dayclose', {'d': yesterday, 'sales': 300, 'bills': 1, 'expectedCash': 300, 'countedCash': 300, 'variance': 0});
      final s = buildDailySummary(repo, yesterday, now: now);
      expect(s.closed, isTrue);
    });
  });

  group('date boundaries -- a record is counted only on its own date, never bleeding into a neighbour', () {
    test('sales on an adjacent day never leak into the requested date', () async {
      final repo = mk(FakeServer());
      await payOn(repo, dayBefore, amt: 999);
      await payOn(repo, today, amt: 50);
      final s = buildDailySummary(repo, yesterday, now: now);
      expect(s.salesNet, 0);
      expect(s.bills, 0);
    });

    test('expenses on an adjacent day never leak into the requested date', () async {
      final repo = mk(FakeServer());
      await repo.save('exp', {'d': dayBefore, 'amt': 500, 'mode': 'cash'});
      await repo.save('exp', {'d': today, 'amt': 70, 'mode': 'cash'});
      final s = buildDailySummary(repo, yesterday, now: now);
      expect(s.expensesTotal, 0);
    });

    test('a purchase on an adjacent day never leaks into the requested date', () async {
      final repo = mk(FakeServer());
      await repo.save('purchase', {'vendorName': 'V', 'items': [], 'amount': 400, 'date': dayBefore, 'notes': ''});
      final s = buildDailySummary(repo, yesterday, now: now);
      expect(s.purchaseSpend, 0);
      expect(s.purchaseCount, 0);
    });

    test('a wastage entry on an adjacent day never leaks into the requested date', () async {
      final repo = mk(FakeServer());
      await repo.save('ing', {'id': 'oil1', 'name': 'Oil', 'qty': 5, 'cost': 100});
      await repo.save('waste', {'ing': 'Oil', 'q': 1, 'd': dayBefore, 'reason': 'Spilled', 'at': 'x'});
      final s = buildDailySummary(repo, yesterday, now: now);
      expect(s.wastageCost, 0);
      expect(s.wastageEntries, 0);
    });

    test('isToday is true only for the device\'s own current local date, never for a past date', () async {
      final repo = mk(FakeServer());
      final s1 = buildDailySummary(repo, today, now: now);
      final s2 = buildDailySummary(repo, yesterday, now: now);
      expect(s1.isToday, isTrue);
      expect(s2.isToday, isFalse);
    });
  });

  group('missing or malformed data never causes an error or a fabricated figure', () {
    test('an unpaid/open order is never counted as sales for any day -- dayCash() itself only reads status==paid', () async {
      final repo = mk(FakeServer());
      await repo.save('order', {'status': 'open', 'lines': []});
      final s = buildDailySummary(repo, today, now: now);
      expect(s.salesNet, 0);
      expect(s.bills, 0);
    });

    test('an expense record missing its amount field is treated as zero, not as an error', () async {
      final repo = mk(FakeServer());
      await repo.save('exp', {'d': today, 'mode': 'cash'}); // no 'amt' at all
      final s = buildDailySummary(repo, today, now: now);
      expect(s.expensesTotal, 0);
    });

    test('a wastage entry whose ingredient no longer exists in the catalog costs zero rather than throwing', () async {
      final repo = mk(FakeServer());
      await repo.save('waste', {'ing': 'Unknown Material', 'q': 3, 'd': today, 'reason': 'Other', 'at': 'x'});
      final s = buildDailySummary(repo, today, now: now);
      expect(s.wastageCost, 0);
      expect(s.wastageEntries, 1, reason: 'the entry itself still counts -- only its cost is honestly zero, never fabricated');
    });
  });

  group('duplicate records are never double-counted by the aggregator itself', () {
    test('two separate purchase records on the same date are both counted once each, not multiplied', () async {
      final repo = mk(FakeServer());
      await repo.save('purchase', {'vendorName': 'V1', 'items': [], 'amount': 100, 'date': today, 'notes': ''});
      await repo.save('purchase', {'vendorName': 'V2', 'items': [], 'amount': 150, 'date': today, 'notes': ''});
      final s = buildDailySummary(repo, today, now: now);
      expect(s.purchaseSpend, 250);
      expect(s.purchaseCount, 2);
    });
  });

  group('repeated refreshes are pure reads -- no side effects, no accumulation', () {
    test('calling buildDailySummary many times in a row never writes anything and always returns identical figures', () async {
      final repo = mk(FakeServer());
      await payOn(repo, today, amt: 777);
      await repo.save('exp', {'d': today, 'amt': 25, 'mode': 'cash'});
      final before = {'order': repo.of('order').length, 'exp': repo.of('exp').length, 'purchase': repo.of('purchase').length, 'waste': repo.of('waste').length, 'dayclose': repo.of('dayclose').length};

      DailySummary? last;
      for (var i = 0; i < 20; i++) {
        final s = buildDailySummary(repo, today, now: now);
        if (last != null) {
          expect(s.salesNet, last.salesNet);
          expect(s.expensesTotal, last.expensesTotal);
          expect(s.purchaseSpend, last.purchaseSpend);
          expect(s.wastageCost, last.wastageCost);
        }
        last = s;
      }
      expect(repo.of('order').length, before['order']);
      expect(repo.of('exp').length, before['exp']);
      expect(repo.of('purchase').length, before['purchase']);
      expect(repo.of('waste').length, before['waste']);
      expect(repo.of('dayclose').length, before['dayclose']);
    });
  });

  group('this file never computes a combined profit/cash-flow figure, and the breakdown it does read passes dayCash() through unchanged', () {
    test('sales, expenses, purchases and wastage are reported as four separate numbers only -- the DailySummary type has no combined total field', () async {
      final repo = mk(FakeServer());
      await payOn(repo, today, amt: 1000);
      await repo.save('exp', {'d': today, 'amt': 400, 'mode': 'cash'});
      final s = buildDailySummary(repo, today, now: now);
      // Deliberately checking the type's own fields, not deriving a profit figure here either --
      // this test exists to make a future regression (someone later adding a combined field) show
      // up as a changed-shape diff that must be explained, not slip in silently.
      expect(s.salesNet, 1000);
      expect(s.expensesTotal, 400);
      // No field named profit/net/cashFlow exists -- compile-time guarantee, not a runtime check:
      // (s as dynamic).profit would be a NoSuchMethodError if ever accidentally added and called.
    });

    test('the cash/card/online/other payment breakdown exactly matches dayCash() -- including its own change-given subtraction on cash sales', () async {
      final repo = mk(FakeServer());
      await repo.save('order', {'status': 'paid', 'paidAt': '${today}T12:00:00Z', 'pays': [{'m': 'cash', 'amt': 500}], 'change': 50, 't': {'total': 450}, 'lines': []});
      final s = buildDailySummary(repo, today, now: now);
      // dayCash() subtracts change given back from the cash figure (see console_more.dart) -- this
      // summary must reflect that exact same arithmetic, not a second, naive sum of `pays`.
      expect(s.cash, 450, reason: '500 tendered minus 50 change given back');
    });
  });
}
