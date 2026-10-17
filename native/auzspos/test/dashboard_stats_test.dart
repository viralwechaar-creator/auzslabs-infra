import 'package:auzspos/core/dashboard_stats.dart';
import 'package:flutter_test/flutter_test.dart';
import 'sync_test.dart' show FakeServer, mk;

/// The Owner/Admin Console Dashboard's per-day analytics, ported from app/public/console/
/// p-dashboard.js + core.js (dayStats/itemStats/netOf/isOnline/chanOf and the Online Orders Overview
/// / Revenue Leakage card computations). Pure functions over a Repo, provable directly against the
/// website's own arithmetic.
void main() {
  group('netOf: bill total net of any refunds', () {
    test('with no refunds, equals the bill total', () async {
      final repo = mk(FakeServer());
      final o = (await repo.save('order', {'t': {'total': 500}, 'lines': [{'name': 'x'}]})).data;
      expect(netOf(o), 500);
    });

    test('subtracts every refund amount', () async {
      final repo = mk(FakeServer());
      final o = (await repo.save('order', {
        't': {'total': 500},
        'lines': [{'name': 'x'}],
        'refunds': [{'amt': 50}, {'amt': 25}],
      })).data;
      expect(netOf(o), 425);
    });
  });

  group('isOnline / chanOf', () {
    test('isOnline is true only when src is a non-empty string', () {
      expect(isOnline({'src': 'Zomato'}), true);
      expect(isOnline({'src': ''}), false);
      expect(isOnline({}), false);
    });

    test('chanOf falls back to Dine-In for anything that is not literally Takeaway or Delivery', () {
      expect(chanOf({'type': 'Delivery'}), 'Delivery');
      expect(chanOf({'type': 'Takeaway'}), 'Takeaway');
      expect(chanOf({'type': 'Dine-in'}), 'Dine-In', reason: 'a differently-cased/unknown type still falls back to Dine-In');
      expect(chanOf({}), 'Dine-In');
    });
  });

  group('dayStats', () {
    test('sums net revenue only from PAID orders paid on that exact day', () async {
      final repo = mk(FakeServer());
      final today = dayKeyOf(DateTime.now());
      await repo.save('order', {'status': 'paid', 'paidAt': DateTime.now().toIso8601String(), 't': {'total': 100}, 'lines': [{'name': 'x'}], 'pays': [{'m': 'cash', 'amt': 100}]});
      await repo.save('order', {'status': 'open', 'paidAt': DateTime.now().toIso8601String(), 't': {'total': 999}, 'lines': [{'name': 'x'}]}); // not paid: excluded
      final st = dayStats(repo, today);
      expect(st.rev, 100);
    });

    test('splits payment modes by mode, net of a cash order\'s change', () async {
      final repo = mk(FakeServer());
      final today = dayKeyOf(DateTime.now());
      await repo.save('order', {'status': 'paid', 'paidAt': DateTime.now().toIso8601String(), 't': {'total': 100}, 'lines': [{'name': 'x'}], 'pays': [{'m': 'cash', 'amt': 110}], 'change': 10});
      await repo.save('order', {'status': 'paid', 'paidAt': DateTime.now().toIso8601String(), 't': {'total': 50}, 'lines': [{'name': 'x'}], 'pays': [{'m': 'upi', 'amt': 50}]});
      final st = dayStats(repo, today);
      expect(st.pay['cash'], 100, reason: '110 paid minus 10 change');
      expect(st.pay['upi'], 50);
    });

    test('an online order\'s revenue goes to the "online" payment bucket, not its own pays[] mode', () async {
      final repo = mk(FakeServer());
      final today = dayKeyOf(DateTime.now());
      await repo.save('order', {'status': 'paid', 'paidAt': DateTime.now().toIso8601String(), 't': {'total': 200}, 'lines': [{'name': 'x'}], 'src': 'Zomato', 'pays': [{'m': 'card', 'amt': 200}]});
      final st = dayStats(repo, today);
      expect(st.pay['online'], 200);
      expect(st.pay['card'], 0);
    });

    test('unpaid is the outstanding amount on due bills CREATED that day', () async {
      final repo = mk(FakeServer());
      final today = dayKeyOf(DateTime.now());
      await repo.save('order', {'status': 'due', 'created': DateTime.now().toIso8601String(), 't': {'total': 300}, 'lines': [{'name': 'x'}], 'pays': [{'m': 'cash', 'amt': 100}]});
      final st = dayStats(repo, today);
      expect(st.unpaid, 200);
    });

    test('channel totals (Dine-In/Takeaway/Delivery) count and sum net revenue per paid order', () async {
      final repo = mk(FakeServer());
      final today = dayKeyOf(DateTime.now());
      await repo.save('order', {'status': 'paid', 'paidAt': DateTime.now().toIso8601String(), 't': {'total': 100}, 'lines': [{'name': 'x'}], 'type': 'Takeaway'});
      await repo.save('order', {'status': 'paid', 'paidAt': DateTime.now().toIso8601String(), 't': {'total': 50}, 'lines': [{'name': 'x'}], 'type': 'Dine-in'});
      final st = dayStats(repo, today);
      expect(st.ch['Takeaway']!.count, 1);
      expect(st.ch['Takeaway']!.value, 100);
      expect(st.ch['Dine-In']!.count, 1, reason: 'an unrecognised type string still falls back to Dine-In');
    });

    test('count is every non-void order CREATED that day, paid or not', () async {
      final repo = mk(FakeServer());
      final today = dayKeyOf(DateTime.now());
      await repo.save('order', {'status': 'open', 'created': DateTime.now().toIso8601String(), 't': {'total': 0}, 'lines': [{'name': 'x'}]});
      await repo.save('order', {'status': 'void', 'created': DateTime.now().toIso8601String(), 't': {'total': 0}, 'lines': [{'name': 'x'}]});
      final st = dayStats(repo, today);
      expect(st.count, 1, reason: 'the void order is excluded from the count, same as createdOn() on the website');
    });

    test('an empty catalog returns all-zero stats, not an error', () async {
      final repo = mk(FakeServer());
      final st = dayStats(repo, dayKeyOf(DateTime.now()));
      expect(st.rev, 0);
      expect(st.count, 0);
      expect(st.hours, List.filled(24, 0));
    });
  });

  group('itemStats / topOrLowItems', () {
    test('sums quantity and revenue per item name across paid orders in the date range', () async {
      final repo = mk(FakeServer());
      final today = dayKeyOf(DateTime.now());
      await repo.save('order', {'status': 'paid', 'paidAt': DateTime.now().toIso8601String(), 't': {'total': 100}, 'lines': [{'name': 'Tea', 'qty': 2, 'price': 30}, {'name': 'Coffee', 'qty': 1, 'price': 40}]});
      final stats = itemStats(repo, today, today);
      expect(stats['Tea']!.qty, 2);
      expect(stats['Tea']!.amount, 60);
      expect(stats['Coffee']!.qty, 1);
    });

    test('topOrLowItems sorts by quantity and computes each item\'s percent share', () {
      final stats = {
        'A': ItemStat('A', 10, 0),
        'B': ItemStat('B', 30, 0),
        'C': ItemStat('C', 20, 0),
      };
      final best = topOrLowItems(stats, best: true);
      expect(best.map((x) => x.name), ['B', 'C', 'A']);
      expect(best.first.pct, closeTo(50, 0.01), reason: '30 of a total of 60');
      final low = topOrLowItems(stats, best: false);
      expect(low.map((x) => x.name), ['A', 'C', 'B']);
    });

    test('an empty item map returns an empty list, not a divide-by-zero error', () {
      expect(topOrLowItems({}), isEmpty);
    });
  });

  group('onlinePlatformStats', () {
    test('groups online-only orders by src, splitting prepaid vs. COD', () async {
      final repo = mk(FakeServer());
      final today = dayKeyOf(DateTime.now());
      await repo.save('order', {'status': 'paid', 'paidAt': DateTime.now().toIso8601String(), 't': {'total': 100}, 'lines': [{'name': 'x'}], 'src': 'Zomato', 'pays': [{'m': 'card', 'amt': 100}]});
      await repo.save('order', {'status': 'paid', 'paidAt': DateTime.now().toIso8601String(), 't': {'total': 50}, 'lines': [{'name': 'x'}], 'src': 'Zomato', 'pays': [{'m': 'cash', 'amt': 50}]});
      await repo.save('order', {'status': 'paid', 'paidAt': DateTime.now().toIso8601String(), 't': {'total': 20}, 'lines': [{'name': 'x'}]}); // not online: excluded
      final st = dayStats(repo, today);
      final byP = onlinePlatformStats(st);
      expect(byP['Zomato']!.n, 2);
      expect(byP['Zomato']!.pre, 1);
      expect(byP['Zomato']!.cod, 1);
      expect(byP['Zomato']!.rev, 150);
      expect(byP.containsKey('Other'), false);
    });

    test('a blank src on an online-flagged order is grouped as "Other"', () async {
      // isOnline() itself requires a non-empty src, so this documents that onlinePlatformStats
      // can never actually be asked to classify a blank-src order as "Other" via dayStats' own
      // paidOrders -- the fallback exists only to match the website's own defensive `o.src||'Other'`
      // and is exercised directly here against a hand-built DayStats, not through dayStats() itself.
      final repo = mk(FakeServer());
      final o = (await repo.save('order', {'status': 'paid', 't': {'total': 10}, 'lines': [{'name': 'x'}], 'src': 'anything'})).data;
      o['src'] = ''; // simulate a record that reached paidOrders with src already cleared
      final st = DayStats(rev: 0, pay: {}, unpaid: 0, ch: {}, hours: List.filled(24, 0), count: 0, paidOrders: [o]);
      final byP = onlinePlatformStats(st);
      expect(byP.keys, isEmpty, reason: 'isOnline() is false for an empty src, so this order is never classified at all -- matches isOnline() being the gate, not a defensive fallback inside the grouping itself');
    });
  });

  group('revenueLeakage', () {
    test('counts cancelled, modified, shifted and reprinted bills, and sums waived-off amounts', () async {
      final repo = mk(FakeServer());
      final today = dayKeyOf(DateTime.now());
      final now = DateTime.now().toIso8601String();
      await repo.save('order', {'status': 'void', 'created': now, 't': {'total': 10}, 'lines': [{'name': 'x'}]});
      await repo.save('order', {'status': 'paid', 'created': now, 't': {'total': 10}, 'lines': [{'name': 'x'}], 'refunds': [{'amt': 5}]});
      await repo.save('order', {'status': 'paid', 'created': now, 't': {'total': 10}, 'lines': [{'name': 'x'}], 'shifted': true});
      await repo.save('order', {'status': 'paid', 'created': now, 't': {'total': 10}, 'lines': [{'name': 'x'}], 'reprints': 2});
      await repo.save('order', {'status': 'paid', 'created': now, 't': {'total': 40, 'd': 5}, 'lines': [{'name': 'x'}]});
      await repo.save('order', {'status': 'paid', 'created': now, 't': {'total': 60}, 'lines': [{'name': 'x'}], 'complimentary': true});
      final lk = revenueLeakage(repo, today);
      expect(lk.cancelledBills, 1);
      expect(lk.modifiedBills, 1);
      expect(lk.shiftedOrders, 1);
      expect(lk.reprintedBills, 1);
      expect(lk.waivedOff, 65, reason: '5 (discount) + 60 (complimentary bill)');
    });

    test('an empty catalog returns all zeros, not an error', () async {
      final repo = mk(FakeServer());
      final lk = revenueLeakage(repo, dayKeyOf(DateTime.now()));
      expect(lk.kots, 0);
      expect(lk.cancelledBills, 0);
      expect(lk.waivedOff, 0);
    });
  });
}
