import 'package:flutter_test/flutter_test.dart';
import 'package:auzsmob/core/api.dart';
import 'package:auzsmob/core/repo.dart';
import 'package:auzsmob/core/store.dart';

/// An API that answers from a script instead of the network.
class FakeApi extends ApiClient {
  final calls = <String>[];
  Object? Function(String fn, Map<String, dynamic> args)? onRpc;
  List<Map<String, dynamic>> Function(List<Map<String, dynamic>> ops)? onBatch;
  @override
  Future<dynamic> rpc(String fn, [Map<String, dynamic> args = const {}]) async {
    calls.add(fn);
    final r = onRpc?.call(fn, args);
    if (r is ApiError) throw r;
    return r;
  }

  @override
  Future<List<Map<String, dynamic>>> syncBatch(List<Map<String, dynamic>> ops) async {
    calls.add('batch:${ops.length}');
    if (onBatch == null) throw ApiError('no batch', status: 404);
    return onBatch!(ops);
  }
}

Map<String, dynamic> pullReply({bool full = false}) => {'full': full, 'server_time': '2026-10-12T10:00:00.000000+00:00', 'items': [], 'units': [], 'vendors': [], 'customers': [], 'purchases': [], 'sales': [], 'repairs': [], 'repair_events': [], 'payments': [], 'stock_movements': []};

Future<MobRepo> repoWith(FakeApi api) async {
  final r = MobRepo(api, MemoryStore())..autoSync = false;
  await r.load();
  return r;
}

void main() {
  test('a temporary failure keeps the sale and everything behind it queued', () async {
    final api = FakeApi()..onRpc = (fn, a) => fn == 'mob_push_sale' ? ApiError('down', status: 503) : pullReply();
    final r = await repoWith(api);
    await r.put('units', {'id': 'u1', 'status': 'sold'});
    await r.localPush('sales', {'id': 's1'}, 'mob_push_sale', {'p_id': 's1', 'p': {'items': [{'unitId': 'u1'}]}});
    await r.trySync();
    expect((await r.store.outAll()).length, 1);
    expect(r.byId('sales', 's1'), isNotNull);
    expect(r.syncFailing, isTrue);
  });

  test('no connection at all is also temporary', () async {
    final api = FakeApi()..onRpc = (fn, a) => ApiError('Could not reach the server.', networkError: true);
    final r = await repoWith(api);
    await r.localPush('sales', {'id': 's1'}, 'mob_push_sale', {'p_id': 's1', 'p': {'items': []}});
    await r.trySync();
    expect((await r.store.outAll()).length, 1);
    expect(r.offline, isTrue);
  });

  test('a real refusal rolls the sale back and puts the phone back in stock', () async {
    final api = FakeApi()..onRpc = (fn, a) => fn == 'mob_push_sale' ? ApiError('Not enough stock.', status: 400) : pullReply();
    final r = await repoWith(api);
    String? shown;
    r.onRefused = (m) => shown = m;
    await r.put('units', {'id': 'u1', 'status': 'sold'});
    await r.localPush('sales', {'id': 's1'}, 'mob_push_sale', {'p_id': 's1', 'p': {'items': [{'unitId': 'u1'}]}});
    await r.trySync();
    expect((await r.store.outAll()), isEmpty);
    expect(r.byId('sales', 's1'), isNull);
    expect(r.byId('units', 'u1')!['status'], 'in_stock');
    expect(shown, 'Not enough stock.');
  });

  test('a refused purchase removes the unit and its stock rows', () async {
    final api = FakeApi()..onRpc = (fn, a) => fn == 'mob_push_purchase' ? ApiError('Duplicate IMEI', status: 400) : pullReply();
    final r = await repoWith(api);
    await r.put('units', {'id': 'u9', 'status': 'in_stock'});
    await r.put('stockMovements', {'id': 'm1', 'ref_id': 'p1', 'item_id': 'i', 'qty': 1});
    await r.put('stockMovements', {'id': 'm2', 'ref_id': 'other', 'item_id': 'i', 'qty': 4});
    await r.localPush('purchases', {'id': 'p1'}, 'mob_push_purchase', {'p_id': 'p1', 'p': {'unitId': 'u9'}});
    await r.trySync();
    expect(r.byId('purchases', 'p1'), isNull);
    expect(r.byId('units', 'u9'), isNull);
    expect(r.byId('stockMovements', 'm1'), isNull);
    expect(r.byId('stockMovements', 'm2'), isNotNull);
  });

  test('several queued writes go in ONE batch and are cleared when accepted', () async {
    final api = FakeApi();
    api.onRpc = (fn, a) => pullReply();
    api.onBatch = (ops) => [for (final o in ops) {'id': o['id'], 'ok': true}];
    final r = await repoWith(api);
    for (var i = 0; i < 3; i++) {
      await r.localPush('vendors', {'id': 'v$i'}, 'mob_save_vendor', {'p_id': 'v$i', 'p': {'name': 'V$i'}, 'p_base': null});
    }
    api.calls.clear();
    await r.trySync();
    expect((await r.store.outAll()), isEmpty);
    expect(api.calls.where((c) => c.startsWith('batch:')), ['batch:3']);
    expect(r.syncFailing, isFalse);
  });

  test('in a batch, a temporary failure keeps that write and the rest are skipped', () async {
    final api = FakeApi();
    api.onRpc = (fn, a) => pullReply();
    api.onBatch = (ops) => [
          {'id': ops[0]['id'], 'ok': true},
          {'id': ops[1]['id'], 'ok': false, 'status': 503, 'error': 'down'},
          {'id': ops[2]['id'], 'ok': false, 'skipped': true},
        ];
    final r = await repoWith(api);
    for (var i = 0; i < 3; i++) {
      await r.localPush('vendors', {'id': 'v$i'}, 'mob_save_vendor', {'p_id': 'v$i', 'p': {}, 'p_base': null});
    }
    await r.trySync();
    expect((await r.store.outAll()).length, 2);
    expect(r.syncFailing, isTrue);
  });

  test('pull folds in the shop rows, remembers the cursor, and drops stale stock rows on a first sync', () async {
    final api = FakeApi();
    final r = await repoWith(api);
    await r.put('stockMovements', {'id': 'old', 'ref_id': 'zzz', 'item_id': 'i', 'qty': 7});
    api.onRpc = (fn, a) => {
          ...pullReply(full: true),
          'items': [{'id': 'i1', 'name': 'Case'}],
          'stock_movements': [{'id': 'm9', 'item_id': 'i1', 'qty': 3, 'ref_id': 'r'}],
        };
    await r.pull();
    expect(r.byId('items', 'i1')!['name'], 'Case');
    expect(r.byId('stockMovements', 'old'), isNull);
    expect(r.stock('i1'), 3);
    expect(await r.store.meta('cursor'), '2026-10-12T10:00:00.000000+00:00');
  });
}
