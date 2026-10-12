import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:auzsledger/core/api.dart';
import 'package:auzsledger/core/session.dart';
import 'package:auzsledger/core/store.dart';
import 'package:auzsledger/ui/p_scan.dart';

class FakeApi extends ApiClient {
  final calls = <String>[];
  final applied = <Map<String, dynamic>>[];
  ApiError? fail;
  final seen = <String>{};
  @override
  Future<dynamic> rpc(String fn, [Map<String, dynamic> args = const {}]) async {
    calls.add(fn);
    switch (fn) {
      case 'my_dashboard':
        return {'my_role': 'owner', 'my_email': 'o@x.in', 'tenant': {'slug': 'nbw', 'name': 'New Book World'}, 'features': {'accounting': true}, 'enabled_features': {}};
      case 'acc_bootstrap':
        return {
          'org': {'state_code': '08', 'reg_type': 'regular', 'trade_name': 'New Book World'},
          'perms': {'acc_view': true, 'acc_sales': true, 'acc_inventory': true},
          'accounts': [{'id': 'cash1', 'is_cash': true, 'active': true, 'name': 'Cash'}],
          'taxcodes': [{'kind': 'taxable', 'rate': 0, 'active': true}, {'kind': 'taxable', 'rate': 18, 'active': true}],
          'branches': [], 'warehouses': [{'id': 'wh', 'is_default': true}],
        };
      case 'acc_list_products':
        return {'rows': [{'id': 'p1', 'name': 'Notebook', 'sku': 'NB1', 'barcode': '8901234567890', 'unit': 'Nos', 'sale_price': 45, 'mrp': 60, 'tax_rate': 0, 'stock': 10, 'track_stock': true, 'is_service': false, 'active': true, 'avg_cost': 30}]};
      case 'acc_offline_apply':
        final p = args['p'] as Map;
        if (fail != null) throw fail!;
        if (!seen.add('${p['op']}')) return {'duplicate': true, 'id': 'doc1', 'number': '1/2026-27'};
        applied.add(Map<String, dynamic>.from(p));
        return {'id': p['kind'] == 'product' ? 'real-p2' : 'doc1', 'number': '1/2026-27', 'total': 90};
    }
    return null;
  }
}

class _S extends LedgerSession {
  _S(this._a);
  final FakeApi _a;
  @override
  ApiClient get api => _a;
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  SharedPreferences.setMockInitialValues({});

  Future<(_S, FakeApi)> boot() async {
    final api = FakeApi();
    final s = _S(api);
    await s.openWith({'id': 'u1', 'email': 'o@x.in'}, MemoryStore());
    await Future<void>.delayed(const Duration(milliseconds: 50));
    return (s, api);
  }

  test('the books load once and the catalogue is kept on the phone', () async {
    final (s, _) = await boot();
    expect(s.allowed, isTrue);
    expect(s.products.single['name'], 'Notebook');
    expect(await s.store!.meta('products'), contains('Notebook'));
    expect(s.orgName, 'New Book World');
    expect(s.taxRates, [0, 18]);
  });

  test('both barcode spellings find the product', () async {
    final (s, _) = await boot();
    expect(lookupCode(s, '8901234567890'), hasLength(1));
    expect(lookupCode(s, '08901234567890'.substring(1)), hasLength(1));
    expect(lookupCode(s, 'NB1'), hasLength(1));
    expect(lookupCode(s, '123'), isEmpty);
  });

  test('a sale kept offline lowers the stock shown, then goes once, with the final number', () async {
    final (s, api) = await boot();
    s.offline = true;
    final sale = {'doc_type': 'invoice', 'lines': [{'product_id': 'p1', 'qty': '3'}], 'post': true};
    await s.enqueue('sale', sale, meta: {'ref': 'OFF-ABC-001', 'name': 'Ravi', 'phone': '9876543210', 'total': 135});
    expect(s.products.single['stock'], 7);
    final r = await s.flush();
    expect(r.sent, 1);
    expect(api.applied.single['kind'], 'sale');
    expect(s.queue, isEmpty);
    final due = await s.syncedToSend();
    expect(due.single['number'], '1/2026-27');
    await s.markSent('OFF-ABC-001');
    expect(await s.syncedToSend(), isEmpty);
  });

  test('a new product made offline gets its real id in the sale that used it', () async {
    final (s, api) = await boot();
    final temp = {'id': s.tempId(), 'name': 'Pen', 'sku': 'NP-1', 'sale_price': 10, 'tax_rate': 18, 'track_stock': true};
    await s.enqueue('product', {'name': 'Pen'}, meta: {'temp': temp});
    await s.enqueue('sale', {'lines': [{'product_id': temp['id'], 'qty': '2'}], 'post': true}, meta: {'ref': 'OFF-1', 'total': 23.6});
    expect(s.products.any((p) => p['name'] == 'Pen'), isTrue);
    await s.flush();
    expect(api.applied, hasLength(2));
    expect((api.applied[1]['payload'] as Map)['lines'][0]['product_id'], 'real-p2');
  });

  test('no connection keeps everything; a real refusal stays visible with Retry', () async {
    final (s, api) = await boot();
    await s.enqueue('sale', {'lines': [], 'post': true}, meta: {'ref': 'OFF-2'});
    api.fail = ApiError('down', networkError: true);
    var r = await s.flush();
    expect(r.sent, 0);
    expect(s.queue, hasLength(1));
    expect(s.offline, isTrue);
    expect(s.queue.first['state'], 'waiting');
    api.fail = ApiError('The period is locked.', status: 400);
    r = await s.flush();
    expect(r.refused, 1);
    expect(s.queue.first['state'], 'refused');
    expect(s.queue.first['error'], 'The period is locked.');
    api.fail = null;
    await s.retry(s.queue.first['op'] as String);
    expect(s.queue, isEmpty);
  });

  test('sending the same operation twice never makes a second bill (the books answer duplicate)', () async {
    final (s, api) = await boot();
    final row = await s.enqueue('sale', {'lines': [], 'post': true}, meta: {'ref': 'OFF-3'}, op: 'fixed-op');
    await s.flush();
    await s.enqueue('sale', {'lines': [], 'post': true}, meta: {'ref': 'OFF-3'}, op: 'fixed-op');
    await s.flush();
    expect(api.applied.where((a) => a['op'] == 'fixed-op'), hasLength(1));
    expect(row['op'], 'fixed-op');
  });

  test('offline bill numbers count up on this phone', () async {
    final (s, _) = await boot();
    final a = await s.nextRef(), b = await s.nextRef();
    expect(a, startsWith('OFF-'));
    expect(a.substring(0, a.length - 3), b.substring(0, b.length - 3));
    expect(a, isNot(b));
  });
}
