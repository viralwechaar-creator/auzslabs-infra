import 'dart:async';
import 'package:flutter/foundation.dart';
import 'api.dart';
import 'calc.dart';
import 'store.dart';

/// The shop's copy on this phone plus the outbox of unsent writes. Same rules as the website's sync.js:
///  - a write is shown at once ("saved on phone"), queued, and only counts as synced after the server accepted it;
///  - a temporary failure (no answer, 5xx, timeout, slow-down) NEVER drops a queued write: it waits and retries later;
///  - only a real refusal (a 4xx business rule: not enough stock, day closed...) is rolled back off the phone and shown.
class MobRepo extends ChangeNotifier {
  MobRepo(this.api, this.store);
  final ApiClient api;
  final MobStore store;
  final Map<String, List<Map<String, dynamic>>> _d = {for (final s in kStores) s: <Map<String, dynamic>>[]};

  /// Tests switch this off so a queued write does not start syncing by itself.
  bool autoSync = true;
  int outboxCount = 0;
  bool syncFailing = false, syncing = false, offline = false;
  String? lastError;
  /// Called with a short message when the server refused a queued write (the screen shows it).
  void Function(String message)? onRefused;
  /// Called after each successful pull so the session can refresh settings now and then.
  Future<void> Function()? afterPull;

  List<Map<String, dynamic>> rows(String store) => _d[store]!;

  Future<void> load() async {
    for (final s in kStores) {
      _d[s] = await store.all(s);
    }
    outboxCount = (await store.outAll()).length;
  }

  Map<String, dynamic>? byId(String s, String? id) {
    if (id == null) return null;
    for (final r in _d[s]!) {
      if (r['id'] == id) return r;
    }
    return null;
  }

  Future<void> put(String s, Map<String, dynamic> row) async {
    final l = _d[s]!;
    final i = l.indexWhere((r) => r['id'] == row['id']);
    if (i >= 0) {
      l[i] = row;
    } else {
      l.add(row);
    }
    await store.put(s, row);
  }

  Future<void> _del(String s, String id) async {
    _d[s]!.removeWhere((r) => r['id'] == id);
    await store.del(s, id);
  }

  Future<void> outboxAdd(String fn, Map<String, dynamic> args) async {
    await store.outAdd(fn, args);
    outboxCount = (await store.outAll()).length;
    notifyListeners();
    if (autoSync) unawaited(trySync());
  }

  /// Tell the screens something changed on the phone.
  void refresh() => notifyListeners();

  /// Local-first write: show it now, queue it, let [trySync] take it from there.
  Future<void> localPush(String s, Map<String, dynamic> row, String fn, Map<String, dynamic> args) async {
    await put(s, {...row, '_pending': true});
    await outboxAdd(fn, args);
  }

  /// Undoes the optimistic local write a refused outbox item made, so a refused sale or purchase does not keep sitting on the
  /// phone looking saved.
  Future<void> rejectLocal(String fn, Map<String, dynamic> args) async {
    final p = args['p'] is Map ? Map<String, dynamic>.from(args['p'] as Map) : null;
    if (fn == 'mob_push_sale') {
      await _del('sales', '${args['p_id']}');
      for (final it in (p?['items'] as List? ?? const [])) {
        final uid = (it as Map)['unitId'];
        if (uid == null) continue;
        final u = byId('units', '$uid');
        if (u != null && u['status'] == 'sold') await put('units', {...u, 'status': 'in_stock', 'updated_at': DateTime.now().toUtc().toIso8601String()});
      }
    } else if (fn == 'mob_push_purchase') {
      await _del('purchases', '${args['p_id']}');
      if (p?['unitId'] != null) await _del('units', '${p!['unitId']}');
      for (final m in List.of(_d['stockMovements']!)) {
        if (m['ref_id'] == args['p_id']) await _del('stockMovements', '${m['id']}');
      }
    } else if (fn == 'mob_push_repair_event') {
      await _del('repairEvents', '${args['p_id']}');
    }
    notifyListeners();
  }

  Timer? _retry;
  int _delayMs = 5000;
  void _scheduleRetry() {
    _retry?.cancel();
    _retry = Timer(Duration(milliseconds: _delayMs), () => unawaited(trySync()));
    _delayMs = _delayMs * 2 > 300000 ? 300000 : _delayMs * 2;
  }

  /// "Tap to retry": forget the back-off and try right now.
  Future<void> retryNow() {
    _delayMs = 5000;
    return trySync();
  }

  static bool transient(int? status, bool network) => network || status == null || status >= 500 || status == 408 || status == 429;

  Future<void> trySync() async {
    if (syncing) return;
    syncing = true;
    notifyListeners();
    try {
      var stop = false;
      while (!stop) {
        final items = await store.outAll();
        if (items.isEmpty) break;
        Map<int, Map<String, dynamic>>? batch;
        if (items.length >= 2) {
          try {
            final res = await api.syncBatch([for (final it in items.take(50)) {'id': '${it.oid}', 'fn': it.fn, 'args': it.args}]);
            batch = {for (final r in res) int.tryParse('${r['id']}') ?? -1: r};
          } catch (_) {
            batch = null; // older server, no answer: send one by one below
          }
        }
        var progressed = false;
        for (final it in items) {
          int? status;
          bool network = false;
          String? error;
          var ok = false, skipped = false;
          final br = batch?[it.oid];
          if (br != null) {
            ok = br['ok'] == true;
            skipped = br['skipped'] == true;
            status = (br['status'] as num?)?.toInt();
            error = br['error'] == null ? null : '${br['error']}';
            if (!ok && !skipped && status == null) network = true;
          } else if (batch != null) {
            continue; // beyond the 50 sent in this round: next loop
          } else {
            try {
              await api.rpc(it.fn, it.args);
              ok = true;
            } on ApiError catch (e) {
              status = e.status;
              network = e.networkError;
              error = e.message;
            }
          }
          if (ok) {
            syncFailing = false;
            _delayMs = 5000;
            offline = false;
            await store.outDel(it.oid);
            progressed = true;
            continue;
          }
          if (skipped || status == 401) {
            // an earlier write hit a temporary failure / the session is dead: keep this and everything behind it
            if (status != 401) {
              syncFailing = true;
              _scheduleRetry();
            }
            stop = true;
            break;
          }
          if (transient(status, network)) {
            syncFailing = true;
            offline = network;
            lastError = error;
            _scheduleRetry();
            stop = true;
            break;
          }
          // a real business-rule refusal: it will never succeed by retrying, so drop it, roll the phone's copy back, tell the staffer
          await rejectLocal(it.fn, it.args);
          await store.outDel(it.oid);
          onRefused?.call(error ?? 'The server refused this entry.');
          progressed = true;
        }
        if (!progressed && !stop) break;
        outboxCount = (await store.outAll()).length;
        notifyListeners();
      }
      outboxCount = (await store.outAll()).length;
      if (!syncFailing) await pull();
    } finally {
      syncing = false;
      notifyListeners();
    }
  }

  Future<void> pull() async {
    final since = await store.meta('cursor');
    Map<String, dynamic> r;
    try {
      final d = await api.rpc('mob_sync_pull', {'p_since': since});
      r = Map<String, dynamic>.from(d as Map);
      offline = false;
    } on ApiError catch (e) {
      if (e.networkError) offline = true;
      return;
    }
    if (r['full'] == true) {
      // A first sync is a window (last 90 days, everything open, one opening stock row per older item): drop the stock rows
      // this phone held, or they would be counted twice. Rows for entries still waiting in the outbox stay.
      final waiting = <String>{for (final o in await store.outAll()) if (o.args['p_id'] != null) '${o.args['p_id']}'};
      for (final m in List.of(_d['stockMovements']!)) {
        if (!waiting.contains('${m['ref_id']}')) await _del('stockMovements', '${m['id']}');
      }
    }
    const keys = {'items': 'items', 'units': 'units', 'vendors': 'vendors', 'customers': 'customers', 'purchases': 'purchases', 'sales': 'sales', 'repairs': 'repairs', 'repairEvents': 'repair_events', 'payments': 'payments', 'stockMovements': 'stock_movements'};
    for (final e in keys.entries) {
      final list = ((r[e.value] as List?) ?? const []).map((x) => Map<String, dynamic>.from(x as Map)).toList();
      for (final row in list) {
        final l = _d[e.key]!;
        final i = l.indexWhere((x) => x['id'] == row['id']);
        if (i >= 0) {
          l[i] = row;
        } else {
          l.add(row);
        }
      }
      await store.putMany(e.key, list);
    }
    await store.setMeta('cursor', '${r['server_time']}');
    try {
      await afterPull?.call();
    } catch (_) {}
    notifyListeners();
  }

  /// Empties this phone's offline copy (after the owner cleared all data).
  Future<void> wipeLocal() async {
    await store.wipe();
    for (final s in kStores) {
      _d[s] = [];
    }
    outboxCount = 0;
    notifyListeners();
  }

  // ---- small derived views used by several screens ----
  double stock(String itemId) => stockOf(_d['stockMovements']!, itemId);
}
