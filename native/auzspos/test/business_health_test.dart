import 'package:auzspos/ui/console.dart' show BusinessHealth, computeBusinessHealth, computeConsoleAlerts;
import 'package:flutter_test/flutter_test.dart';
import 'sync_test.dart' show FakeServer, mk;

/// POS Business Health Monitor: computeBusinessHealth() in console.dart, built entirely on the
/// existing Alerts Center (computeConsoleAlerts()) plus one new fact -- whether the local data
/// itself can currently be trusted (Repo.lastError/lastOk). No second alert computation exists
/// here: these tests focus on (1) the one genuinely new condition added to the Alerts Center
/// (pending sync, a parity fix matching the website's own alerts()), and (2) the health verdict's
/// own rule that it can never claim "healthy" while the underlying data is known to be unreliable.
void main() {
  group('pending sync is now a real Alerts Center condition (website parity fix)', () {
    test('local changes not yet sent to the server become a "sync" alert pointing at mgmt/data', () async {
      final repo = mk(FakeServer());
      repo.pending = 3;
      final alerts = computeConsoleAlerts(repo);
      final sync = alerts.singleWhere((a) => a.kind == 'sync');
      expect(sync.count, 3);
      expect(sync.navTo, 'mgmt/data');
      expect(sync.title, contains('3'));
    });

    test('nothing pending means no "sync" alert at all', () async {
      final repo = mk(FakeServer());
      repo.pending = 0;
      expect(computeConsoleAlerts(repo).where((a) => a.kind == 'sync'), isEmpty);
    });

    test('resolution: once the outbox drains to zero, the alert disappears on the very next read -- not a cached flag', () async {
      final repo = mk(FakeServer());
      repo.pending = 5;
      expect(computeConsoleAlerts(repo).where((a) => a.kind == 'sync'), isNotEmpty);
      repo.pending = 0;
      expect(computeConsoleAlerts(repo).where((a) => a.kind == 'sync'), isEmpty, reason: 'a pure read must reflect the CURRENT pending count, never a stale snapshot');
    });
  });

  group('calculation accuracy -- the health verdict matches what each underlying signal actually says', () {
    test('a brand-new, genuinely empty install (no records, never synced) is "ok" -- nothing to be unsure about yet', () async {
      final repo = mk(FakeServer());
      final h = computeBusinessHealth(repo);
      expect(h.dataConfidence, 'ok');
      expect(h.status, 'healthy');
      expect(h.alerts, isEmpty);
    });

    test('a healthy device with real data and no alerts and a successful sync reports "healthy"', () async {
      final repo = mk(FakeServer());
      await repo.save('ing', {'name': 'Flour', 'qty': 100, 'low': 10}); // not low
      repo.lastOk = DateTime.now();
      repo.pending = 0; // the save() above queued an outbox item; simulate it having already synced
      final h = computeBusinessHealth(repo);
      expect(h.dataConfidence, 'ok');
      expect(h.status, 'healthy');
    });

    test('real alerts with otherwise-trustworthy data report "attention", never "unknown"', () async {
      final repo = mk(FakeServer());
      await repo.save('ing', {'name': 'Milk', 'qty': 1, 'low': 10});
      repo.lastOk = DateTime.now();
      final h = computeBusinessHealth(repo);
      expect(h.dataConfidence, 'ok');
      expect(h.status, 'attention');
      expect(h.alerts, isNotEmpty);
    });
  });

  group('never report healthy when the underlying data cannot be trusted', () {
    test('a failed sync (Repo.lastError set) forces "unknown", even with zero alerts in the list', () async {
      final repo = mk(FakeServer());
      repo.lastError = 'No connection';
      final h = computeBusinessHealth(repo);
      expect(h.dataConfidence, 'syncFailed');
      expect(h.status, 'unknown', reason: 'the alert list itself may be stale, so it can never be read as "all clear"');
      expect(h.alerts, isEmpty, reason: 'the alerts themselves are unaffected -- only the overall verdict changes');
    });

    test('a device with real local records that has never completed a successful sync is "unknown", not "healthy"', () async {
      final repo = mk(FakeServer());
      await repo.save('ing', {'name': 'Rice', 'qty': 100, 'low': 10}); // not low, no alerts
      // repo.lastOk is left null -- never synced.
      final h = computeBusinessHealth(repo);
      expect(h.dataConfidence, 'neverSynced');
      expect(h.status, 'unknown');
    });

    test('a sync failure takes priority over "never synced" when both are technically true', () async {
      final repo = mk(FakeServer());
      await repo.save('ing', {'name': 'Rice', 'qty': 100, 'low': 10});
      repo.lastError = 'Server unreachable'; // lastOk also still null
      final h = computeBusinessHealth(repo);
      expect(h.dataConfidence, 'syncFailed');
    });

    test('resolution: a sync that later succeeds clears the unknown status on the very next read', () async {
      final repo = mk(FakeServer());
      repo.lastError = 'No connection';
      expect(computeBusinessHealth(repo).dataConfidence, 'syncFailed');
      repo.lastError = null;
      repo.lastOk = DateTime.now();
      expect(computeBusinessHealth(repo).status, 'healthy');
    });

    test('real alerts PLUS a sync failure still report "unknown", never "attention" -- unknown is the stronger, more honest claim', () async {
      final repo = mk(FakeServer());
      await repo.save('ing', {'name': 'Milk', 'qty': 0, 'low': 10}); // a real, confirmed low-stock alert
      repo.lastError = 'Timed out';
      final h = computeBusinessHealth(repo);
      expect(h.status, 'unknown');
      expect(h.alerts, isNotEmpty, reason: 'the confirmed alert is still shown -- only the headline verdict is downgraded');
    });
  });

  group('duplicate suppression -- one condition is always one alert, never multiplied by an unrelated read', () {
    test('calling computeBusinessHealth many times in a row with nothing changed returns an identical result', () async {
      final repo = mk(FakeServer());
      await repo.save('ing', {'name': 'Milk', 'qty': 1, 'low': 10});
      repo.pending = 2;
      BusinessHealth? last;
      for (var i = 0; i < 15; i++) {
        final h = computeBusinessHealth(repo);
        if (last != null) {
          expect(h.status, last.status);
          expect(h.dataConfidence, last.dataConfidence);
          expect(h.alerts.length, last.alerts.length);
        }
        last = h;
      }
    });

    test('a repeated sync-failure read still shows exactly one sync problem, never one per call', () async {
      final repo = mk(FakeServer());
      repo.lastError = 'No connection';
      for (var i = 0; i < 10; i++) {
        computeBusinessHealth(repo);
      }
      expect(computeBusinessHealth(repo).dataConfidence, 'syncFailed');
    });
  });

  group('this is a pure, read-only monitor -- it must never write to stock, purchases, payments or closing records', () {
    test('computing health many times never creates, changes or deletes any record of any kind', () async {
      final repo = mk(FakeServer());
      await repo.save('ing', {'name': 'Milk', 'qty': 1, 'low': 10});
      await repo.save('po', {'status': 'draft', 'items': []});
      await repo.save('order', {'status': 'due', 't': {'total': 100}, 'lines': []});
      repo.pending = 4;
      repo.lastError = 'No connection';

      final before = {'ing': repo.of('ing').length, 'po': repo.of('po').length, 'order': repo.of('order').length, 'dayclose': repo.of('dayclose').length, 'purchase': repo.of('purchase').length, 'waste': repo.of('waste').length};
      for (var i = 0; i < 20; i++) {
        computeBusinessHealth(repo);
      }
      expect(repo.of('ing').length, before['ing']);
      expect(repo.of('po').length, before['po']);
      expect(repo.of('order').length, before['order']);
      expect(repo.of('dayclose').length, before['dayclose']);
      expect(repo.of('purchase').length, before['purchase']);
      expect(repo.of('waste').length, before['waste']);
      // Reading health must never itself touch the very fields it reads.
      expect(repo.pending, 4);
      expect(repo.lastError, 'No connection');
    });
  });
}
