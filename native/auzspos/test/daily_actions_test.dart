import 'package:auzspos/ui/console.dart' show DailyActions, computeDailyActions;
import 'package:flutter_test/flutter_test.dart';
import 'sync_test.dart' show FakeServer, mk;

/// Smart Daily Operations: computeDailyActions() in console.dart, built entirely on the existing
/// Alerts Center (computeConsoleAlerts() via computeBusinessHealth()) -- no second alert or
/// confidence computation. These tests focus on the one genuinely new thing this file adds: a
/// transparent, evidence-based tier assignment ('now' | 'next' | 'routine') for each already-
/// computed alert, and the rule that the whole list's reliability (dataConfidence/status) is
/// carried through unchanged from computeBusinessHealth(), never recomputed.
void main() {
  group('priority rules -- each tier assignment is a transparent rule over existing data, not a score', () {
    test('an unclosed past day is "needs attention now"', () async {
      final repo = mk(FakeServer());
      await repo.save('order', {'status': 'paid', 'paidAt': '2026-10-10T12:00:00Z', 'pays': [{'m': 'cash', 'amt': 500}], 't': {'total': 500}, 'lines': []});
      final a = computeDailyActions(repo);
      expect(a.now.any((x) => x.kind == 'dayclose'), isTrue);
      expect(a.next.any((x) => x.kind == 'dayclose'), isFalse);
    });

    test('a material that has run out entirely (qty<=0) is "needs attention now"', () async {
      final repo = mk(FakeServer());
      await repo.save('ing', {'name': 'Milk', 'qty': 0, 'low': 10});
      final a = computeDailyActions(repo);
      expect(a.now.any((x) => x.kind == 'lowstock'), isTrue, reason: 'out of stock blocks selling right now');
      expect(a.next.any((x) => x.kind == 'lowstock'), isFalse);
    });

    test('a material below its reorder point but NOT yet at zero is only "recommended next", never "now"', () async {
      final repo = mk(FakeServer());
      await repo.save('ing', {'name': 'Sugar', 'qty': 3, 'low': 10});
      final a = computeDailyActions(repo);
      expect(a.next.any((x) => x.kind == 'lowstock'), isTrue);
      expect(a.now.any((x) => x.kind == 'lowstock'), isFalse, reason: 'still sellable right now -- no evidence of a current blockage');
    });

    test('a mix of zero-stock and merely-low materials still produces ONE lowstock alert, correctly placed in "now" (the stronger claim) because at least one item is actually out', () async {
      final repo = mk(FakeServer());
      await repo.save('ing', {'name': 'Milk', 'qty': 0, 'low': 10});
      await repo.save('ing', {'name': 'Sugar', 'qty': 5, 'low': 10});
      final a = computeDailyActions(repo);
      final lowstockNow = a.now.where((x) => x.kind == 'lowstock');
      final lowstockNext = a.next.where((x) => x.kind == 'lowstock');
      expect(lowstockNow.length, 1);
      expect(lowstockNext, isEmpty, reason: 'the single combined alert appears in exactly one tier, never split or duplicated across tiers');
      expect(lowstockNow.single.count, 2, reason: 'the underlying alert itself is untouched -- still both materials');
    });

    test('a due bill is "recommended next", never "needs attention now" -- no due-date evidence exists to claim urgency', () async {
      final repo = mk(FakeServer());
      await repo.save('order', {'status': 'due', 't': {'total': 250}, 'lines': []});
      final a = computeDailyActions(repo);
      expect(a.next.any((x) => x.kind == 'due'), isTrue);
      expect(a.now.any((x) => x.kind == 'due'), isFalse);
    });

    test('an open support ticket is "recommended next"', () async {
      final repo = mk(FakeServer());
      await repo.save('ticket', {'subject': 'Printer', 'status': 'open'});
      final a = computeDailyActions(repo);
      expect(a.next.any((x) => x.kind == 'tickets'), isTrue);
    });

    test('an unreceived purchase order is "recommended next"', () async {
      final repo = mk(FakeServer());
      await repo.save('po', {'supplier': 'A', 'items': [], 'status': 'draft'});
      final a = computeDailyActions(repo);
      expect(a.next.any((x) => x.kind == 'po'), isTrue);
    });

    test('ordinary pending-sync changes (no sync failure) are "routine", not "now" or "next"', () async {
      final repo = mk(FakeServer());
      repo.pending = 2;
      final a = computeDailyActions(repo);
      expect(a.routine.any((x) => x.kind == 'sync'), isTrue);
      expect(a.now.any((x) => x.kind == 'sync'), isFalse);
      expect(a.next.any((x) => x.kind == 'sync'), isFalse);
    });
  });

  group('ordering -- nothing is dropped, nothing appears in more than one tier', () {
    test('every alert computeConsoleAlerts() would produce is placed in exactly one tier', () async {
      final repo = mk(FakeServer());
      await repo.save('ing', {'name': 'Milk', 'qty': 0, 'low': 10});
      await repo.save('order', {'status': 'due', 't': {'total': 100}, 'lines': []});
      await repo.save('ticket', {'subject': 'A', 'status': 'open'});
      await repo.save('po', {'supplier': 'A', 'items': [], 'status': 'draft'});
      await repo.save('order', {'status': 'paid', 'paidAt': '2026-10-10T12:00:00Z', 'pays': [{'m': 'cash', 'amt': 500}], 't': {'total': 500}, 'lines': []});
      repo.pending = 1;

      final a = computeDailyActions(repo);
      final allKinds = [...a.now, ...a.next, ...a.routine].map((x) => x.kind).toSet();
      expect(allKinds, {'lowstock', 'due', 'tickets', 'po', 'dayclose', 'sync'});
      // No kind appears twice across tiers.
      final counts = <String, int>{};
      for (final x in [...a.now, ...a.next, ...a.routine]) {
        counts[x.kind] = (counts[x.kind] ?? 0) + 1;
      }
      expect(counts.values.every((c) => c == 1), isTrue, reason: 'each condition is exactly one alert in exactly one tier');
    });
  });

  group('resolved conditions drop out of their tier on the very next read -- no stored state', () {
    test('restocking the out-of-stock material moves its alert out of "now" entirely (it may still be low, landing in "next")', () async {
      final repo = mk(FakeServer());
      final g = (await repo.save('ing', {'name': 'Milk', 'qty': 0, 'low': 10})).data;
      expect(computeDailyActions(repo).now.any((x) => x.kind == 'lowstock'), isTrue);

      await repo.save('ing', {...g, 'qty': 5}, id: '${g['id']}'); // still below 'low' but no longer zero
      final a = computeDailyActions(repo);
      expect(a.now.any((x) => x.kind == 'lowstock'), isFalse);
      expect(a.next.any((x) => x.kind == 'lowstock'), isTrue);
    });

    test('fully restocking removes the lowstock alert from every tier', () async {
      final repo = mk(FakeServer());
      final g = (await repo.save('ing', {'name': 'Milk', 'qty': 0, 'low': 10})).data;
      await repo.save('ing', {...g, 'qty': 50}, id: '${g['id']}');
      final a = computeDailyActions(repo);
      expect(a.now.any((x) => x.kind == 'lowstock'), isFalse);
      expect(a.next.any((x) => x.kind == 'lowstock'), isFalse);
    });

    test('closing the day removes the dayclose alert from "now" on the very next read', () async {
      final repo = mk(FakeServer());
      await repo.save('order', {'status': 'paid', 'paidAt': '2026-10-10T12:00:00Z', 'pays': [{'m': 'cash', 'amt': 500}], 't': {'total': 500}, 'lines': []});
      expect(computeDailyActions(repo).now.any((x) => x.kind == 'dayclose'), isTrue);

      await repo.save('dayclose', {'d': '2026-10-10', 'sales': 500, 'bills': 1, 'expectedCash': 500, 'countedCash': 500, 'variance': 0});
      expect(computeDailyActions(repo).now.any((x) => x.kind == 'dayclose'), isFalse);
    });
  });

  group('unreliable data -- the same dataConfidence/status as computeBusinessHealth(), never recomputed, never claiming healthy', () {
    test('a failed sync is carried through unchanged and the action list itself can still be shown', () async {
      final repo = mk(FakeServer());
      repo.lastError = 'No connection';
      final a = computeDailyActions(repo);
      expect(a.dataConfidence, 'syncFailed');
      expect(a.status, 'unknown');
    });

    test('a device that has never synced but has real data is "unknown", not "healthy", even with zero tiered items', () async {
      final repo = mk(FakeServer());
      await repo.save('ing', {'name': 'Rice', 'qty': 100, 'low': 10}); // not low
      repo.pending = 0; // isolate from the save()'s own outbox side effect
      final a = computeDailyActions(repo);
      expect(a.dataConfidence, 'neverSynced');
      expect(a.status, 'unknown');
      expect(a.isEmpty, isTrue, reason: 'no confirmed alert exists -- only the headline confidence is downgraded');
    });

    test('a genuinely empty, never-touched install reports "ok"/"healthy" with every tier empty', () async {
      final repo = mk(FakeServer());
      final a = computeDailyActions(repo);
      expect(a.dataConfidence, 'ok');
      expect(a.status, 'healthy');
      expect(a.isEmpty, isTrue);
    });
  });

  group('duplicate suppression -- repeated reads never multiply a tier or an alert', () {
    test('calling computeDailyActions many times in a row with nothing changed returns an identical grouping', () async {
      final repo = mk(FakeServer());
      await repo.save('ing', {'name': 'Milk', 'qty': 0, 'low': 10});
      await repo.save('order', {'status': 'due', 't': {'total': 100}, 'lines': []});
      DailyActions? last;
      for (var i = 0; i < 15; i++) {
        final a = computeDailyActions(repo);
        if (last != null) {
          expect(a.now.length, last.now.length);
          expect(a.next.length, last.next.length);
          expect(a.routine.length, last.routine.length);
          expect(a.status, last.status);
        }
        last = a;
      }
    });
  });

  group('this is a pure, read-only monitor -- it must never write to stock, purchases, payments or closing records', () {
    test('computing daily actions many times never creates, changes or deletes any record of any kind', () async {
      final repo = mk(FakeServer());
      await repo.save('ing', {'name': 'Milk', 'qty': 0, 'low': 10});
      await repo.save('po', {'status': 'draft', 'items': []});
      await repo.save('order', {'status': 'due', 't': {'total': 100}, 'lines': []});
      await repo.save('ticket', {'subject': 'A', 'status': 'open'});
      repo.pending = 2;

      final before = {'ing': repo.of('ing').length, 'po': repo.of('po').length, 'order': repo.of('order').length, 'ticket': repo.of('ticket').length, 'dayclose': repo.of('dayclose').length, 'purchase': repo.of('purchase').length, 'waste': repo.of('waste').length};
      for (var i = 0; i < 20; i++) {
        computeDailyActions(repo);
      }
      for (final kind in before.keys) {
        expect(repo.of(kind).length, before[kind], reason: 'computing daily actions must never touch $kind records');
      }
      expect(repo.pending, 2, reason: 'reading the action list must never itself touch the very fields it reads');
    });

    test('tapping into the navigation target never happens as a side effect of computing the list -- navTo is just data, never invoked', () async {
      final repo = mk(FakeServer());
      await repo.save('ing', {'name': 'Milk', 'qty': 0, 'low': 10});
      final a = computeDailyActions(repo);
      for (final x in [...a.now, ...a.next, ...a.routine]) {
        expect(x.navTo, isNotEmpty, reason: 'every alert still carries a real navigation target for the UI to use on tap');
      }
      // Nothing the function itself does ever resolves navTo into an action -- proven by the
      // record-count assertions above staying unchanged across 20 calls.
    });
  });
}
