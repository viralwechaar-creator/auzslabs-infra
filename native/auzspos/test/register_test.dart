import 'package:auzspos/core/session.dart';
import 'package:auzspos/ui/more.dart' show currentRegister, registerSummary;
import 'package:flutter_test/flutter_test.dart';
import 'sync_test.dart' show FakeServer, mk;

/// Operational audit finding: `currentRegister()`/`registerSummary()` (lib/ui/more.dart, ported from the
/// website's register.js) had zero dedicated test coverage -- only reachable indirectly, if at all, via a
/// widget smoke test. These are plain functions of a Session's already-synced Repo data (no network, no
/// SharedPreferences, no widget harness needed), so they are tested directly here the same way dayCash()
/// already is in daycash_test.dart.
void main() {
  group('currentRegister', () {
    test('picks the most recently opened register that is still open, ignoring closed ones', () async {
      final s = Session()..repo = mk(FakeServer());
      await s.repo!.save('register', {'openedAt': '2026-10-01T08:00:00Z', 'closedAt': '2026-10-01T18:00:00Z', 'float': 1000});
      await s.repo!.save('register', {'openedAt': '2026-10-02T08:00:00Z', 'closedAt': null, 'float': 500});
      await s.repo!.save('register', {'openedAt': '2026-10-01T09:00:00Z', 'closedAt': '2026-10-01T17:00:00Z', 'float': 2000});

      final r = currentRegister(s);
      expect(r, isNotNull);
      expect(r!['float'], 500, reason: 'the only still-open register, not an earlier closed one with a later openedAt');
    });

    test('returns null when every register is closed, or none exist', () async {
      final s = Session()..repo = mk(FakeServer());
      expect(currentRegister(s), isNull);
      await s.repo!.save('register', {'openedAt': '2026-10-01T08:00:00Z', 'closedAt': '2026-10-01T18:00:00Z', 'float': 1000});
      expect(currentRegister(s), isNull);
    });
  });

  group('registerSummary', () {
    test('expected cash = float + cash sales + cash tips - cash refunds + cash-in - cash-out, within the register window', () async {
      final s = Session()..repo = mk(FakeServer());
      final reg = {'id': 'r1', 'openedAt': '2026-10-05T08:00:00Z', 'closedAt': null, 'float': 1000};
      await s.repo!.save('order', {
        'status': 'paid', 'pays': [{'m': 'cash', 'amt': 300, 'at': '2026-10-05T10:00:00Z'}],
        't': {'total': 300}, 'lines': [],
      });
      await s.repo!.save('order', {
        'status': 'paid', 'pays': [{'m': 'upi', 'amt': 200, 'at': '2026-10-05T10:30:00Z'}],
        't': {'total': 200}, 'lines': [],
      });
      await s.repo!.save('cashmove', {'register': 'r1', 'type': 'in', 'amt': 50, 'at': '2026-10-05T11:00:00Z'});
      await s.repo!.save('cashmove', {'register': 'r1', 'type': 'out', 'amt': 20, 'at': '2026-10-05T11:30:00Z'});

      final sm = registerSummary(s, reg);
      expect(sm.methods['cash'], 300);
      expect(sm.methods['upi'], 200);
      expect(sm.bills, 2);
      expect(sm.sales, 500);
      expect(sm.cashIn, 50);
      expect(sm.cashOut, 20);
      // float(1000) + cash(300) + tips(0) - refunds(0) + cashIn(50) - cashOut(20) = 1330
      expect(sm.expected, 1330);
    });

    test('a cash refund reduces expected cash; a non-cash refund does not', () async {
      final s = Session()..repo = mk(FakeServer());
      final reg = {'id': 'r1', 'openedAt': '2026-10-05T08:00:00Z', 'closedAt': null, 'float': 0};
      await s.repo!.save('order', {
        'status': 'paid',
        'pays': [{'m': 'cash', 'amt': 500, 'at': '2026-10-05T10:00:00Z'}],
        'refunds': [
          {'amt': 100, 'm': 'cash', 'at': '2026-10-05T12:00:00Z'},
          {'amt': 50, 'm': 'upi', 'at': '2026-10-05T12:30:00Z'},
        ],
        't': {'total': 500}, 'lines': [],
      });

      final sm = registerSummary(s, reg);
      expect(sm.refundsCash, 100, reason: 'only the cash refund is tracked as a cash-drawer outflow');
      // float(0) + cash(500) - refundsCash(100) = 400 -- the UPI refund never touches the cash drawer
      expect(sm.expected, 400);
    });

    test('payments outside the register window (before openedAt, or after closedAt) are excluded', () async {
      final s = Session()..repo = mk(FakeServer());
      final reg = {'id': 'r1', 'openedAt': '2026-10-05T08:00:00Z', 'closedAt': '2026-10-05T20:00:00Z', 'float': 0};
      await s.repo!.save('order', {
        'status': 'paid', 'pays': [{'m': 'cash', 'amt': 999, 'at': '2026-10-04T23:00:00Z'}],
        't': {'total': 999}, 'lines': [],
      });
      await s.repo!.save('order', {
        'status': 'paid', 'pays': [{'m': 'cash', 'amt': 777, 'at': '2026-10-06T01:00:00Z'}],
        't': {'total': 777}, 'lines': [],
      });
      await s.repo!.save('order', {
        'status': 'paid', 'pays': [{'m': 'cash', 'amt': 100, 'at': '2026-10-05T12:00:00Z'}],
        't': {'total': 100}, 'lines': [],
      });

      final sm = registerSummary(s, reg);
      expect(sm.bills, 1, reason: 'only the payment inside the register window counts');
      expect(sm.methods['cash'], 100);
      expect(sm.expected, 100);
    });

    test('an unrecognised payment method bucket falls into "other", never silently dropped', () async {
      final s = Session()..repo = mk(FakeServer());
      final reg = {'id': 'r1', 'openedAt': '2026-10-05T08:00:00Z', 'closedAt': null, 'float': 0};
      await s.repo!.save('order', {
        'status': 'paid', 'pays': [{'m': 'wallet', 'amt': 250, 'at': '2026-10-05T10:00:00Z'}],
        't': {'total': 250}, 'lines': [],
      });

      final sm = registerSummary(s, reg);
      expect(sm.methods['other'], 250);
      expect(sm.bills, 1);
      expect(sm.sales, 250);
    });
  });
}
