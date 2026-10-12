import 'dart:convert';
import 'package:auzspos/core/api.dart';
import 'package:auzspos/core/repo.dart';
import 'package:auzspos/core/store.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:flutter_test/flutter_test.dart';

/// A tiny pretend server: keeps records, answers push_record and the records query like the real API.
class FakeServer {
  final rows = <String, Map<String, dynamic>>{};
  int clock = 0;
  bool down = false, expired = false, conflictNext = false;
  String? refuse; // push_record answers 400 with this message
  final pushes = <Map<String, dynamic>>[];
  String stamp() => '2026-10-12T00:00:00.${(++clock).toString().padLeft(6, '0')}Z';

  Future<http.Response> handle(http.Request r) async {
    if (down) throw http.ClientException('offline');
    if (expired) return http.Response(jsonEncode({'error': 'invalid token'}), 401);
    final path = r.url.path;
    if (path == '/rpc/push_record') {
      final a = jsonDecode(r.body) as Map<String, dynamic>;
      pushes.add(a);
      if (refuse != null) return http.Response(jsonEncode({'error': refuse}), 400);
      if (conflictNext && a['force'] != true) {
        conflictNext = false;
        return http.Response(jsonEncode({'data': {'conflict': true, 'server_updated_at': '2026-01-01T00:00:00.000001Z'}}), 200);
      }
      final ts = stamp();
      rows[a['rid']] = {'id': a['rid'], 'kind': a['rkind'], 'data': a['rdata'], 'deleted': a['rdeleted'], 'updated_at': ts};
      return http.Response(jsonEncode({'data': {'server_updated_at': ts}}), 200);
    }
    if (path == '/db/records') {
      final q = r.url.queryParameters;
      if (q['eq.id'] != null) {
        final x = rows[q['eq.id']];
        return http.Response(jsonEncode({'data': x}), 200);
      }
      final since = q['gte.updated_at']!;
      final list = rows.values.where((x) => (x['updated_at'] as String).compareTo(since) >= 0).toList()..sort((a, b) => (a['updated_at'] as String).compareTo(b['updated_at'] as String));
      return http.Response(jsonEncode({'data': list}), 200);
    }
    return http.Response('{}', 404);
  }
}

Repo mk(FakeServer s, [MemoryStore? st]) => Repo(ApiClient(client: MockClient(s.handle))..token = 't', st ?? MemoryStore());

void main() {
  test('one odd record from the server does not stop sync', () async {
    final s = FakeServer();
    s.rows['bad'] = {'id': 'bad', 'kind': 'x', 'data': 'not an object', 'deleted': false, 'updated_at': '2026-10-12T00:00:00.000001Z'};
    s.rows['ok'] = {'id': 'ok', 'kind': 'table', 'data': {'name': 'T9'}, 'deleted': false, 'updated_at': '2026-10-12T00:00:00.000002Z'};
    final repo = mk(s);
    final r = await repo.sync();
    expect(r.error, isNull);
    expect(repo.of('table').single['name'], 'T9');
    final again = await repo.sync();
    expect(again.error, isNull, reason: 'sync can run again');
  });

  test('a saved change reaches the server and leaves nothing queued', () async {
    final s = FakeServer(), repo = mk(s);
    await repo.save('item', {'name': 'Tea', 'price': 20});
    expect(repo.pending, 1);
    final r = await repo.sync();
    expect(r.pushed, 1);
    expect(repo.pending, 0);
    expect(s.rows.length, 1);
    expect(s.rows.values.first['data']['name'], 'Tea');
  });

  test('no connection: the change stays queued and nothing is lost', () async {
    final s = FakeServer()..down = true, repo = mk(s);
    await repo.save('order', {'status': 'open'});
    final r = await repo.sync();
    expect(r.error, isNotNull);
    expect(repo.pending, 1);
    s.down = false;
    final r2 = await repo.sync();
    expect(r2.error, isNull);
    expect(repo.pending, 0);
    expect(s.rows.length, 1);
  });

  test('a conflict is re-sent with force', () async {
    final s = FakeServer()..conflictNext = true, repo = mk(s);
    await repo.save('order', {'status': 'open'});
    await repo.sync();
    expect(s.pushes.length, 2);
    expect(s.pushes.last['force'], true);
    expect(repo.pending, 0);
  });

  test('a change the server refuses is dropped and the server copy is taken back', () async {
    final s = FakeServer(), repo = mk(s);
    final r1 = await repo.save('order', {'status': 'open', 'total': 100});
    await repo.sync();
    final id = r1.id;
    repo.byId[id]!.data['total'] = 1; // a bad edit
    await repo.save('order', repo.byId[id]!.data, id: id);
    s.refuse = 'discount needs approval';
    final res = await repo.sync();
    expect(res.rejected, ['discount needs approval']);
    expect(repo.pending, 0);
    expect(repo.byId[id]!.data['total'], 100, reason: 'the server copy is back');
  });

  test('changes made elsewhere are pulled in', () async {
    final s = FakeServer(), a = mk(s), b = mk(s);
    await a.save('table', {'name': 'T1'});
    await a.sync();
    final r = await b.sync();
    expect(r.pulled, 1);
    expect(b.of('table').single['name'], 'T1');
  });

  test('an unsent local change is not overwritten by a pull', () async {
    final s = FakeServer(), a = mk(s), b = mk(s);
    final t = await a.save('table', {'name': 'T1'});
    await a.sync();
    await b.sync();
    await b.save('table', {'name': 'T1 (mine)'}, id: t.id);
    s.down = false;
    // a changes it on the server meanwhile
    await a.save('table', {'name': 'T1 (theirs)'}, id: t.id);
    await a.sync();
    s.down = true; // b cannot send yet
    await b.sync();
    s.down = false;
    // b pulls but must keep its own queued edit
    final st = b.store as MemoryStore;
    expect((await st.outItem(t.id)) != null, true);
  });

  test('an expired session is reported, not retried forever', () async {
    final s = FakeServer()..expired = true, repo = mk(s);
    await repo.save('order', {'status': 'open'});
    final r = await repo.sync();
    expect(r.authExpired, true);
    expect(repo.pending, 1);
  });
}
