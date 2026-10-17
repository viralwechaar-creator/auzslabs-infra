import 'package:auzspos/core/repo.dart';
import 'package:auzspos/ui/console_more.dart' show findDayNeedingClose;
import 'package:flutter_test/flutter_test.dart';
import 'sync_test.dart' show FakeServer, mk;

/// Day-close reminder, built on the existing dayCash()/dayclose logic (console_more.dart, itself a
/// port of the website's dayCash()/closeDay() in app/public/console/p-finance.js). Pure function
/// over a Repo, same split as stock_test.dart/auto_reorder_test.dart, directly provable against a
/// fixed "now" so these tests never depend on the real clock.
void main() {
  final now = DateTime(2026, 10, 17, 9, 30); // a Saturday, 9:30am
  String daysAgo(int n) => '${now.subtract(Duration(days: n)).year}-${(now.subtract(Duration(days: n)).month).toString().padLeft(2, '0')}-${(now.subtract(Duration(days: n)).day).toString().padLeft(2, '0')}';

  Future<void> payOn(Repo repo, String d, {num amt = 100}) async {
    await repo.save('order', {'status': 'paid', 'paidAt': '${d}T12:00:00Z', 'pays': [{'m': 'cash', 'amt': amt}], 't': {'total': amt}, 'lines': []});
  }

  group('an open day shows the reminder when appropriate', () {
    test('yesterday had paid bills and no dayclose record -- it is reported', () async {
      final repo = mk(FakeServer());
      await payOn(repo, daysAgo(1), amt: 450);
      await payOn(repo, daysAgo(1), amt: 220);

      final r = findDayNeedingClose(repo, now: now);
      expect(r, isNotNull);
      expect(r!.date, daysAgo(1));
      expect(r.bills, 2);
      expect(r.sales, 670);
    });

    test('a day further back (not just yesterday) is still found within the lookback window', () async {
      final repo = mk(FakeServer());
      await payOn(repo, daysAgo(5), amt: 300);

      final r = findDayNeedingClose(repo, now: now);
      expect(r, isNotNull);
      expect(r!.date, daysAgo(5));
    });
  });

  group('a successfully closed day no longer shows it', () {
    test('yesterday has bills but IS closed -- nothing is reported', () async {
      final repo = mk(FakeServer());
      await payOn(repo, daysAgo(1), amt: 450);
      await repo.save('dayclose', {'d': daysAgo(1), 'sales': 450, 'bills': 1, 'expectedCash': 450, 'countedCash': 450, 'variance': 0});

      expect(findDayNeedingClose(repo, now: now), isNull);
    });

    test('closing the day via the EXACT same write the real Close Day flow performs makes the \n       reminder disappear on the very next check -- no separate flag or cache to go stale', () async {
      final repo = mk(FakeServer());
      await payOn(repo, daysAgo(1), amt: 450);
      expect(findDayNeedingClose(repo, now: now), isNotNull, reason: 'open before closing');

      await repo.save('dayclose', {'d': daysAgo(1), 'sales': 450, 'bills': 1, 'expectedCash': 450, 'countedCash': 460, 'variance': 10, 'varianceReason': 'Tip paid out'});

      expect(findDayNeedingClose(repo, now: now), isNull, reason: 'closed immediately after the write -- the reminder is a pure read, never a cached flag');
    });

    test('the scan stops at the first closed day going backward -- an older open day BEHIND an \n       already-closed day is not surfaced (closing is expected to happen in order)', () async {
      final repo = mk(FakeServer());
      await payOn(repo, daysAgo(1), amt: 100); // open
      await payOn(repo, daysAgo(2), amt: 200); // closed
      await repo.save('dayclose', {'d': daysAgo(2), 'sales': 200, 'bills': 1, 'expectedCash': 200, 'countedCash': 200, 'variance': 0});
      await payOn(repo, daysAgo(3), amt: 300); // open, but behind a closed day

      final r = findDayNeedingClose(repo, now: now);
      expect(r!.date, daysAgo(1), reason: 'the scan reports the nearest open day and stops at the closed day right after it');
    });
  });

  group('missing or stale data never causes a false claim', () {
    test('today itself is never reported, even with paid bills and no dayclose record -- today is \n       still in progress, not overdue', () async {
      final repo = mk(FakeServer());
      await payOn(repo, daysAgo(0), amt: 999); // today
      expect(findDayNeedingClose(repo, now: now), isNull);
    });

    test('a past day with ZERO bills (the shop was simply closed that day) is never reported -- \n       there is nothing to close', () async {
      final repo = mk(FakeServer());
      // No orders at all anywhere -- an empty catalog must never be misread as "overdue".
      expect(findDayNeedingClose(repo, now: now), isNull);
    });

    test('a quiet day with zero bills does not hide a genuinely open day further back', () async {
      final repo = mk(FakeServer());
      // Yesterday: shop closed, no orders. Two days ago: real business, never closed.
      await payOn(repo, daysAgo(2), amt: 500);
      final r = findDayNeedingClose(repo, now: now);
      expect(r!.date, daysAgo(2));
    });

    test('nothing beyond the lookback window is ever reported, even if genuinely still open', () async {
      final repo = mk(FakeServer());
      await payOn(repo, daysAgo(20), amt: 500);
      expect(findDayNeedingClose(repo, now: now, lookbackDays: 14), isNull);
    });

    test('an order with no paidAt at all (a draft/open order, not a real paid bill) is never \n       counted as business on any day -- dayCash() itself only reads status==paid, so a stray \n       incomplete record can never manufacture a false "day needing close"', () async {
      final repo = mk(FakeServer());
      await repo.save('order', {'status': 'open', 'lines': []});
      expect(findDayNeedingClose(repo, now: now), isNull);
    });
  });

  group('repeated refreshes never duplicate a closing record or an alert', () {
    test('calling findDayNeedingClose many times in a row is a pure read -- it writes nothing at \n       all, so there is no record to ever duplicate', () async {
      final repo = mk(FakeServer());
      await payOn(repo, daysAgo(1), amt: 450);
      for (var i = 0; i < 20; i++) {
        findDayNeedingClose(repo, now: now);
      }
      expect(repo.of('dayclose'), isEmpty, reason: 'a read-only reminder must never itself create a closing record, no matter how many times it is called');
      expect(repo.of('order').length, 1, reason: 'and must never touch the orders it is only reading');
    });

    test('the same day is reported identically on every call until it is actually closed -- not a \n       one-shot flag that silently stops firing on its own', () async {
      final repo = mk(FakeServer());
      await payOn(repo, daysAgo(1), amt: 450);
      final first = findDayNeedingClose(repo, now: now);
      final second = findDayNeedingClose(repo, now: now);
      expect(first!.date, second!.date);
      expect(first.sales, second.sales);
    });
  });

  group('existing day-close calculations are read through unchanged, never recomputed differently', () {
    test('the reported sales/bills/expected figures are EXACTLY dayCash()\'s own numbers for that \n       day -- this file never derives a second, parallel total', () async {
      final repo = mk(FakeServer());
      await payOn(repo, daysAgo(1), amt: 1000);
      await repo.save('cashmove', {'d': daysAgo(1), 'type': 'in', 'amt': 50});
      await repo.save('exp', {'d': daysAgo(1), 'amt': 30, 'mode': 'cash'});

      final r = findDayNeedingClose(repo, now: now)!;
      // Same arithmetic dayCash() itself already has a dedicated, separately-tested suite for
      // (test/daycash_test.dart) -- cash 1000 + top-up 50 - expense 30 = 1020.
      expect(r.expected, 1020);
      expect(r.sales, 1000);
      expect(r.bills, 1);
    });
  });
}
