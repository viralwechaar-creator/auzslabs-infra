import 'package:auzspos/ui/console_more.dart' show dayCash;
import 'package:flutter_test/flutter_test.dart';
import 'sync_test.dart' show FakeServer, mk;

/// dayCash() (fin/cash, Cash Management) previously summed cash payments with no subtraction for change
/// given, overstating "Expected cash in the drawer" -- the website's own dayCash() in
/// app/public/console/p-finance.js subtracts `o.change` from cash sales. Also verifies the dayclose record
/// field-name fix (expectedCash/countedCash/variance/varianceReason, sales, bills -- previously native wrote
/// expected/counted/diff/reason, which the website's own Cash Management/Reconciliation pages could never
/// read back for a day closed from the phone).
void main() {
  test('a cash sale with change given reduces expected cash by the change, not the full tendered amount', () async {
    final repo = mk(FakeServer());
    await repo.save('order', {
      'status': 'paid',
      'paidAt': '2026-10-01T10:00:00Z',
      'pays': [{'m': 'cash', 'amt': 500}],
      'change': 120,
      't': {'total': 380},
      'lines': [],
    });
    final s = dayCash(repo, '2026-10-01');
    expect(s.cash, 380, reason: '500 tendered minus 120 change = 380 actually stays in the drawer');
    expect(s.expected, 380);
    expect(s.sales, 380, reason: 'sales tracks the bill total, independent of cash handling');
    expect(s.bills, 1);
  });

  test('card and online payments are not reduced by change (change only applies to cash)', () async {
    final repo = mk(FakeServer());
    await repo.save('order', {
      'status': 'paid',
      'paidAt': '2026-10-01T10:00:00Z',
      'pays': [{'m': 'card', 'amt': 200}],
      'change': 50, // should never happen for a card sale, but must not be subtracted from card either
      't': {'total': 200},
      'lines': [],
    });
    final s = dayCash(repo, '2026-10-01');
    expect(s.card, 200);
    expect(s.cash, 0);
  });

  test('expected cash = cash sales + top-ups - cash expenses - withdrawals, matching the website formula', () async {
    final repo = mk(FakeServer());
    await repo.save('order', {'status': 'paid', 'paidAt': '2026-10-01T10:00:00Z', 'pays': [{'m': 'cash', 'amt': 1000}], 't': {'total': 1000}, 'lines': []});
    await repo.save('cashmove', {'type': 'in', 'amt': 200, 'd': '2026-10-01'});
    await repo.save('cashmove', {'type': 'out', 'amt': 150, 'd': '2026-10-01'});
    await repo.save('exp', {'amt': 100, 'mode': 'cash', 'd': '2026-10-01'});
    await repo.save('exp', {'amt': 9999, 'mode': 'bank', 'd': '2026-10-01'}); // must not reduce cash
    final s = dayCash(repo, '2026-10-01');
    expect(s.expected, 1000 + 200 - 150 - 100);
  });

  test('a day closed through the phone saves the same field names the website reads back (dayclose shape parity)', () async {
    final repo = mk(FakeServer());
    await repo.save('dayclose', {'d': '2026-10-01', 'sales': 1000, 'bills': 3, 'expectedCash': 950, 'countedCash': 940, 'variance': -10, 'varianceReason': 'Counting error'});
    final s = dayCash(repo, '2026-10-01');
    expect(s.close, isNotNull);
    expect(s.close!['expectedCash'], 950);
    expect(s.close!['countedCash'], 940);
    expect(s.close!['variance'], -10);
    expect(s.close!['varianceReason'], 'Counting error');
  });
}
