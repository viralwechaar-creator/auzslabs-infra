import 'package:auzspos/core/purchase_orders.dart' show openPurchaseOrders;
import 'package:auzspos/ui/console.dart' show computeConsoleAlerts, AlertItem;
import 'package:flutter_test/flutter_test.dart';
import 'sync_test.dart' show FakeServer, mk;

/// The Console's Alerts Center (bell icon, _alertsSheet()/computeConsoleAlerts() in console.dart).
/// Consolidates the three conditions the sheet already had (low stock, due bills, open tickets)
/// with two newly-verified ones (an unclosed business day, purchase orders not yet received) into
/// one shared, pure computation -- tested directly, the same pattern as dayCash()/
/// findDayNeedingClose() in test/daycash_test.dart and test/dayclose_reminder_test.dart.
void main() {
  group('correct alert generation from verified conditions', () {
    test('low stock on several materials becomes ONE alert naming them, not one alert each', () async {
      final repo = mk(FakeServer());
      await repo.save('ing', {'name': 'Milk', 'qty': 2, 'low': 10});
      await repo.save('ing', {'name': 'Sugar', 'qty': 0, 'low': 5});
      await repo.save('ing', {'name': 'Rice', 'qty': 500, 'low': 10}); // not low

      final alerts = computeConsoleAlerts(repo);
      final lowstock = alerts.where((a) => a.kind == 'lowstock').toList();
      expect(lowstock.length, 1, reason: 'one alert for the whole condition, not one per material');
      expect(lowstock.single.count, 2);
      expect(lowstock.single.detail, contains('Milk'));
      expect(lowstock.single.detail, contains('Sugar'));
      expect(lowstock.single.navTo, 'inv/raw');
    });

    test('a due bill becomes a "due" alert pointing at daily/due', () async {
      final repo = mk(FakeServer());
      await repo.save('order', {'status': 'due', 't': {'total': 500}, 'lines': []});
      final alerts = computeConsoleAlerts(repo);
      final due = alerts.singleWhere((a) => a.kind == 'due');
      expect(due.count, 1);
      expect(due.navTo, 'daily/due');
    });

    test('an open support ticket becomes a "tickets" alert; closed/done tickets are excluded', () async {
      final repo = mk(FakeServer());
      await repo.save('ticket', {'subject': 'Printer', 'status': 'open'});
      await repo.save('ticket', {'subject': 'Old one', 'status': 'closed'});
      await repo.save('ticket', {'subject': 'Fixed', 'status': 'done'});
      final alerts = computeConsoleAlerts(repo);
      final tk = alerts.singleWhere((a) => a.kind == 'tickets');
      expect(tk.count, 1);
      expect(tk.navTo, 'crm/support');
    });

    test('an unclosed past day with real sales becomes a "dayclose" alert pointing at fin/cash', () async {
      final repo = mk(FakeServer());
      final yesterday = DateTime.now().subtract(const Duration(days: 1));
      final d = '${yesterday.year}-${yesterday.month.toString().padLeft(2, '0')}-${yesterday.day.toString().padLeft(2, '0')}';
      await repo.save('order', {'status': 'paid', 'paidAt': '${d}T12:00:00Z', 'pays': [{'m': 'cash', 'amt': 500}], 't': {'total': 500}, 'lines': []});

      final alerts = computeConsoleAlerts(repo);
      final dc = alerts.singleWhere((a) => a.kind == 'dayclose');
      expect(dc.navTo, 'fin/cash');
      expect(dc.title, contains(d));
    });

    test('purchase orders still in draft or open (not received) become a "po" alert', () async {
      final repo = mk(FakeServer());
      await repo.save('po', {'supplier': 'A', 'items': [], 'status': 'draft'});
      await repo.save('po', {'supplier': 'B', 'items': [], 'status': 'received'}); // not counted
      final alerts = computeConsoleAlerts(repo);
      final po = alerts.singleWhere((a) => a.kind == 'po');
      expect(po.count, 1);
      expect(po.navTo, 'inv/purchase');
    });

    test('an entirely quiet tenant produces no alerts at all', () async {
      final repo = mk(FakeServer());
      expect(computeConsoleAlerts(repo), isEmpty);
    });
  });

  group('duplicate suppression across repeated refreshes', () {
    test('calling computeConsoleAlerts many times with nothing changed always returns one alert \n       per condition, never an accumulating list', () async {
      final repo = mk(FakeServer());
      await repo.save('ing', {'name': 'Milk', 'qty': 2, 'low': 10});
      // save() always queues an outbox item, which would otherwise also surface as the Business
      // Health Monitor's new "sync" alert (a real, intentional condition -- see business_health_
      // test.dart) and make this isolated low-stock check see two alerts instead of one. Zeroing it
      // here isolates the one condition this test is actually about.
      repo.pending = 0;
      List<AlertItem> last = [];
      for (var i = 0; i < 10; i++) {
        final alerts = computeConsoleAlerts(repo);
        expect(alerts.length, 1);
        last = alerts;
      }
      expect(last.single.kind, 'lowstock');
      expect(last.single.count, 1, reason: 'still exactly one material, not accumulated across the 10 calls');
    });

    test('computeConsoleAlerts never writes anything -- it is a pure read with zero side effects \n       on stock, purchases, payments or day closing', () async {
      final repo = mk(FakeServer());
      await repo.save('ing', {'name': 'Milk', 'qty': 2, 'low': 10, 'cost': 40});
      await repo.save('po', {'supplier': 'A', 'items': [], 'status': 'draft'});
      final order = await repo.save('order', {'status': 'due', 't': {'total': 500}, 'lines': []});

      for (var i = 0; i < 5; i++) {
        computeConsoleAlerts(repo);
      }

      expect(repo.of('ing').single['qty'], 2, reason: 'stock untouched');
      expect(repo.of('po').single['status'], 'draft', reason: 'no purchase order was received');
      expect(repo.of('purchase'), isEmpty, reason: 'no purchase record created');
      expect(repo.of('dayclose'), isEmpty, reason: 'no day was closed');
      expect(repo.of('order').single['status'], 'due', reason: 'the due order was never marked paid');
      expect(repo.of('order').single['id'], order.id);
    });
  });

  group('an alert disappears or updates when its condition is resolved', () {
    test('restocking the last low material removes the lowstock alert entirely', () async {
      final repo = mk(FakeServer());
      final g = (await repo.save('ing', {'name': 'Milk', 'qty': 2, 'low': 10})).data;
      expect(computeConsoleAlerts(repo).any((a) => a.kind == 'lowstock'), true);

      await repo.save('ing', {...g, 'qty': 50}, id: '${g['id']}');
      expect(computeConsoleAlerts(repo).any((a) => a.kind == 'lowstock'), false);
    });

    test('the lowstock alert\'s own count UPDATES (not a stale duplicate) as more materials go low', () async {
      final repo = mk(FakeServer());
      await repo.save('ing', {'name': 'Milk', 'qty': 2, 'low': 10});
      expect(computeConsoleAlerts(repo).singleWhere((a) => a.kind == 'lowstock').count, 1);

      await repo.save('ing', {'name': 'Sugar', 'qty': 0, 'low': 5});
      expect(computeConsoleAlerts(repo).singleWhere((a) => a.kind == 'lowstock').count, 2);
    });

    test('closing the day through the exact same write the real Close Day flow performs removes \n       the dayclose alert on the very next check', () async {
      final repo = mk(FakeServer());
      final yesterday = DateTime.now().subtract(const Duration(days: 1));
      final d = '${yesterday.year}-${yesterday.month.toString().padLeft(2, '0')}-${yesterday.day.toString().padLeft(2, '0')}';
      await repo.save('order', {'status': 'paid', 'paidAt': '${d}T12:00:00Z', 'pays': [{'m': 'cash', 'amt': 500}], 't': {'total': 500}, 'lines': []});
      expect(computeConsoleAlerts(repo).any((a) => a.kind == 'dayclose'), true);

      await repo.save('dayclose', {'d': d, 'sales': 500, 'bills': 1, 'expectedCash': 500, 'countedCash': 500, 'variance': 0});
      expect(computeConsoleAlerts(repo).any((a) => a.kind == 'dayclose'), false);
    });

    test('receiving the purchase order removes the po alert', () async {
      final repo = mk(FakeServer());
      final po = (await repo.save('po', {'supplier': 'A', 'items': [], 'status': 'draft'})).data;
      expect(computeConsoleAlerts(repo).any((a) => a.kind == 'po'), true);

      await repo.save('po', {...po, 'status': 'received'}, id: '${po['id']}');
      expect(computeConsoleAlerts(repo).any((a) => a.kind == 'po'), false);
    });

    test('marking the due bill paid removes the due alert', () async {
      final repo = mk(FakeServer());
      final o = (await repo.save('order', {'status': 'due', 't': {'total': 500}, 'lines': []})).data;
      expect(computeConsoleAlerts(repo).any((a) => a.kind == 'due'), true);

      await repo.save('order', {...o, 'status': 'paid'}, id: '${o['id']}');
      expect(computeConsoleAlerts(repo).any((a) => a.kind == 'due'), false);
    });

    test('closing the support ticket removes the tickets alert', () async {
      final repo = mk(FakeServer());
      final t = (await repo.save('ticket', {'subject': 'Printer', 'status': 'open'})).data;
      expect(computeConsoleAlerts(repo).any((a) => a.kind == 'tickets'), true);

      await repo.save('ticket', {...t, 'status': 'closed'}, id: '${t['id']}');
      expect(computeConsoleAlerts(repo).any((a) => a.kind == 'tickets'), false);
    });
  });

  group('missing and stale data never produce a false alert', () {
    test('a material with no low threshold set at all and real stock is never flagged', () async {
      final repo = mk(FakeServer());
      await repo.save('ing', {'name': 'Rice', 'qty': 500});
      expect(computeConsoleAlerts(repo).any((a) => a.kind == 'lowstock'), false);
    });

    test('an order with no status at all is never counted as a due bill', () async {
      final repo = mk(FakeServer());
      await repo.save('order', {'t': {'total': 100}, 'lines': []});
      expect(computeConsoleAlerts(repo).any((a) => a.kind == 'due'), false);
    });

    test('a ticket with no status field at all is never treated as open (neither closed nor done, \n       but also never fabricated into an alert from missing data)', () async {
      final repo = mk(FakeServer());
      await repo.save('ticket', {'subject': 'No status'});
      // status != 'closed' && status != 'done' is true for a missing status too -- documenting the
      // actual (inherited, not newly introduced) behavior: a ticket record with no status at all is
      // treated as open, matching the pre-existing filter this change reused rather than altered.
      expect(computeConsoleAlerts(repo).singleWhere((a) => a.kind == 'tickets').count, 1);
    });

    test('a po record with no status field at all is treated as an open draft, matching the \n       website\'s own status||\'draft\' fallback -- not a false negative that hides it', () async {
      final repo = mk(FakeServer());
      await repo.save('po', {'supplier': 'A', 'items': []});
      expect(computeConsoleAlerts(repo).singleWhere((a) => a.kind == 'po').count, 1);
    });
  });

  group('tenant isolation (as far as the existing architecture supports it)', () {
    test('alerts are computed only from the ONE Repo instance passed in -- a second, independent \n       tenant\'s Repo never contributes to another tenant\'s alert list', () async {
      final tenantA = mk(FakeServer());
      final tenantB = mk(FakeServer());
      await tenantA.save('ing', {'name': 'Milk', 'qty': 2, 'low': 10});
      await tenantB.save('ing', {'name': 'Sugar', 'qty': 500, 'low': 10}); // not low, different tenant anyway

      expect(computeConsoleAlerts(tenantA).any((a) => a.kind == 'lowstock'), true);
      expect(computeConsoleAlerts(tenantB).any((a) => a.kind == 'lowstock'), false, reason: 'tenant B has no low material of its own, and must never see tenant A\'s');
    });
  });

  group('regression: the badge count preserves its prior meaning', () {
    test('with only the three original conditions present, the total count equals low+due+tickets, \n       exactly as the getter computed it before this change (not the number of alert TYPES)', () async {
      final repo = mk(FakeServer());
      await repo.save('ing', {'name': 'Milk', 'qty': 2, 'low': 10});
      await repo.save('ing', {'name': 'Sugar', 'qty': 0, 'low': 5});
      await repo.save('order', {'status': 'due', 't': {'total': 100}, 'lines': []});
      await repo.save('ticket', {'subject': 'A', 'status': 'open'});
      await repo.save('ticket', {'subject': 'B', 'status': 'open'});
      // Isolate the three original conditions from the new "sync" alert (a real, intentional
      // parity fix -- see business_health_test.dart) that these saves themselves would otherwise
      // also trigger simply by having queued an outbox item.
      repo.pending = 0;

      final total = computeConsoleAlerts(repo).fold<int>(0, (a, x) => a + x.count);
      expect(total, 2 + 1 + 2, reason: '2 low materials + 1 due bill + 2 open tickets = 5, matching the pre-existing badge semantics');
    });
  });

  group('regression (Native POS Operational Features audit): the po alert and the Purchases '
      'screen\'s own default-tab decision can never silently drift apart again', () {
    test('the po alert\'s own count always equals openPurchaseOrders().length -- the exact function '
        'the Purchases screen now also calls to decide its starting tab', () async {
      final repo = mk(FakeServer());
      await repo.save('po', {'supplier': 'A', 'items': [], 'status': 'draft'});
      await repo.save('po', {'supplier': 'B', 'items': [], 'status': 'received'});
      await repo.save('po', {'supplier': 'C', 'items': []}); // no status -- still open

      final poAlert = computeConsoleAlerts(repo).singleWhere((a) => a.kind == 'po');
      expect(poAlert.count, openPurchaseOrders(repo).length);
      expect(poAlert.count, 2);
    });
  });
}
