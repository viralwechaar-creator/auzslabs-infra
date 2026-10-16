import 'package:auzspos/ui/console.dart' show paidIn;
import 'package:flutter_test/flutter_test.dart';
import 'sync_test.dart' show FakeServer, mk;

/// CRITICAL finding from the Reports audit: GST Summary (rep/gst) and Customer Reports (rep/customers)
/// both read paidIn() with its default paid-only filter, while the website's own gstRows()/customerStats()
/// (app/public/console/p-extras.js, p-reports.js) deliberately include `due` (credit) bills too -- GST is
/// owed and a customer's visit/spend is real the moment a bill is raised, not only once it is actually
/// paid. Native's GST figure was understating tax liability for any business using credit sales. Fixed with
/// an opt-in `includeDue` parameter (default false, so every other existing caller -- sales/orders/staff/
/// analytics reports, all legitimately paid-only -- is unaffected).
void main() {
  final now = DateTime.now().toUtc();
  String iso(int daysAgo) => now.subtract(Duration(days: daysAgo)).toIso8601String();

  test('by default (includeDue=false) a due/credit order is excluded, matching every other existing report', () async {
    final repo = mk(FakeServer());
    await repo.save('order', {'status': 'paid', 'paidAt': iso(1), 'created': iso(1), 't': {'total': 100}});
    await repo.save('order', {'status': 'due', 'created': iso(1), 't': {'total': 200}});
    final rows = paidIn(repo, 7);
    expect(rows.length, 1);
    expect(rows.single['status'], 'paid');
  });

  test('includeDue=true brings in a due order too, dated by created when it has no paidAt yet', () async {
    final repo = mk(FakeServer());
    await repo.save('order', {'status': 'paid', 'paidAt': iso(1), 't': {'total': 100}});
    await repo.save('order', {'status': 'due', 'created': iso(0), 't': {'total': 200}}); // no paidAt
    final rows = paidIn(repo, 7, includeDue: true);
    expect(rows.length, 2);
    expect(rows.map((o) => o['status']).toSet(), {'paid', 'due'});
  });

  test('a due order dated outside the window (by its created date) is still correctly excluded', () async {
    final repo = mk(FakeServer());
    await repo.save('order', {'status': 'due', 'created': iso(40), 't': {'total': 200}});
    final rows = paidIn(repo, 7, includeDue: true);
    expect(rows, isEmpty, reason: 'created 40 days ago, outside a 7-day window');
  });

  test('a void or open order is never included, with or without includeDue', () async {
    final repo = mk(FakeServer());
    await repo.save('order', {'status': 'void', 'created': iso(0), 't': {'total': 50}});
    await repo.save('order', {'status': 'open', 'created': iso(0), 't': {'total': 50}});
    expect(paidIn(repo, 7), isEmpty);
    expect(paidIn(repo, 7, includeDue: true), isEmpty);
  });
}
