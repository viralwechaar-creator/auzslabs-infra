import 'dart:async';
import 'dart:math';
import 'api.dart';
import 'store.dart';

String uid() {
  final r = Random.secure();
  String h(int n) => List.generate(n, (_) => r.nextInt(16).toRadixString(16)).join();
  return '${h(8)}-${h(4)}-4${h(3)}-${(8 + r.nextInt(4)).toRadixString(16)}${h(3)}-${h(12)}';
}

String nowIso() => DateTime.now().toUtc().toIso8601String();

class SyncResult {
  SyncResult({this.pushed = 0, this.pulled = 0, this.rejected = const [], this.error, this.authExpired = false});
  final int pushed, pulled;
  final List<String> rejected; // messages of changes the server refused
  final String? error;
  final bool authExpired;
}

/// All records in memory plus the offline outbox. Mirrors save()/doSync() of the website POS (app/public/pos/core.js):
/// every change is written to the phone first, then pushed with push_record (optimistic concurrency, conflicts re-pushed
/// with force), then the server's changes are pulled. A refused change (400/403/409) is dropped and the server's copy is
/// taken back; a change that could not be sent (no connection, 5xx) stays queued.
class Repo {
  Repo(this.api, this.store, {this.onChange});
  final ApiClient api;
  final LocalStore store;
  final void Function()? onChange;
  final Map<String, Rec> byId = {};
  bool _busy = false, _again = false;
  int pending = 0;
  String? lastError;
  DateTime? lastOk;

  Future<void> load() async {
    byId.clear();
    for (final r in await store.allRecs()) {
      byId[r.id] = r;
    }
    pending = (await store.outbox()).length;
  }

  Iterable<Map<String, dynamic>> of(String kind) => byId.values.where((r) => r.kind == kind && !r.deleted).map((r) => r.data);
  Map<String, dynamic>? rec(String? id) {
    final r = id == null ? null : byId[id];
    return r == null || r.deleted ? null : r.data;
  }

  /// Write [data] to the phone and queue it for the server. Returns immediately; call [sync] to send.
  Future<Rec> save(String kind, Map<String, dynamic> data, {String? id, bool deleted = false}) async {
    id ??= (data['id'] as String?) ?? uid();
    data['id'] = id;
    final prev = byId[id];
    final r = Rec(id: id, kind: kind, data: data, deleted: deleted, updatedAt: nowIso(), srv: prev?.srv);
    byId[id] = r;
    await store.putRec(r);
    await store.putOut(OutItem(id: id, kind: kind, data: data, deleted: deleted, updatedAt: r.updatedAt!, base: prev?.srv));
    pending = (await store.outbox()).length;
    onChange?.call();
    return r;
  }

  /// Send what is queued, then pull what changed. Safe to call any time; a call during a running sync is remembered and runs after it.
  Future<SyncResult> sync() async {
    if (_busy) {
      _again = true;
      return SyncResult();
    }
    _busy = true;
    int pushed = 0, pulled = 0;
    final rejected = <String>[];
    String? error;
    bool authExpired = false;
    try {
      for (final o in await store.outbox()) {
        try {
          final base = byId[o.id]?.srv ?? o.base;
          final args = {'rid': o.id, 'rkind': o.kind, 'rdata': o.data, 'rdeleted': o.deleted, 'base': base, 'force': false};
          var res = await api.rpc('push_record', args) as Map;
          if (res['conflict'] == true) res = await api.rpc('push_record', {...args, 'base': null, 'force': true}) as Map;
          final sv = '${res['server_updated_at']}';
          if (byId[o.id] != null) byId[o.id]!.srv = sv;
          final cur = await store.outItem(o.id);
          if (cur != null && cur.updatedAt == o.updatedAt) await store.delOut(o.id);
          final r = byId[o.id];
          if (r != null) await store.putRec(r);
          pushed++;
        } on ApiError catch (e) {
          if (e.isAuth) {
            authExpired = true;
            error = 'Your session ended. Please sign in again.';
            break;
          }
          if (e.isRule) {
            await _rejectLocal(o, e.message);
            rejected.add(e.message);
            continue;
          }
          error = e.message;
          break; // keep the order of changes: stop at the first one that could not be sent
        }
      }
      if (error == null) {
        final since = await store.meta('since') ?? '1970-01-01T00:00:00Z';
        final rows = await api.recordsSince(since);
        for (final row in rows) {
          if (row['data'] is! Map) continue; // a record that is not an object cannot be shown: skip it, never block the rest
          final id = '${row['id']}';
          if (await store.outItem(id) != null) continue; // our own unsent change wins until it is sent
          final ex = byId[id];
          if (ex != null && ex.srv == '${row['updated_at']}') continue;
          final r = Rec(id: id, kind: '${row['kind']}', data: Map<String, dynamic>.from(row['data'] as Map), deleted: row['deleted'] == true, updatedAt: '${row['updated_at']}', srv: '${row['updated_at']}');
          byId[id] = r;
          await store.putRec(r);
          pulled++;
        }
        if (rows.isNotEmpty) await store.setMeta('since', '${rows.last['updated_at']}');
        if (rows.length >= 1000) _again = true;
      }
    } on ApiError catch (e) {
      error = e.message;
      authExpired = e.isAuth;
    } catch (e) {
      error = 'Sync problem: $e'; // anything unexpected must not leave the sync stuck for ever
    }
    try {
      pending = (await store.outbox()).length;
    } catch (_) {}
    lastError = error;
    if (error == null) lastOk = DateTime.now();
    _busy = false;
    if (pushed > 0 || pulled > 0 || rejected.isNotEmpty) onChange?.call();
    if (_again && error == null) {
      _again = false;
      unawaited(sync());
    }
    return SyncResult(pushed: pushed, pulled: pulled, rejected: rejected, error: error, authExpired: authExpired);
  }

  Future<void> _rejectLocal(OutItem o, String why) async {
    await store.delOut(o.id);
    Map<String, dynamic>? row;
    try {
      row = await api.one('records', 'id', o.id, select: 'id,kind,data,deleted,updated_at');
    } catch (_) {}
    if (row != null) {
      final r = Rec(id: o.id, kind: '${row['kind']}', data: Map<String, dynamic>.from(row['data'] as Map), deleted: row['deleted'] == true, updatedAt: '${row['updated_at']}', srv: '${row['updated_at']}');
      byId[o.id] = r;
      await store.putRec(r);
    } else {
      byId.remove(o.id);
      await store.delRec(o.id);
    }
  }

  /// Forget everything on this phone (a different login, or the owner cleared the business).
  Future<void> wipe() async {
    byId.clear();
    await store.clearRecs();
    await store.clearOut();
    await store.setMeta('since', null);
    pending = 0;
  }
}
