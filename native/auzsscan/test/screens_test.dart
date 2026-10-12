import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:auzsscan/core/api.dart';
import 'package:auzsscan/core/session.dart';
import 'package:auzsscan/core/store.dart';
import 'package:auzsscan/ui/shell.dart';
import 'package:auzsscan/ui/theme.dart';

class _Api extends ApiClient {
  final applied = <Map<String, dynamic>>[];
  @override
  Future<dynamic> rpc(String fn, [Map<String, dynamic> args = const {}]) async {
    switch (fn) {
      case 'my_dashboard':
        return {'my_role': 'owner', 'my_email': 'o@x.in', 'tenant': {'slug': 'nbw', 'name': 'New Book World'}, 'features': {'scan': true}, 'enabled_features': {}};
      case 'acc_bootstrap':
        return {
          'org': {'state_code': '08', 'reg_type': 'regular', 'trade_name': 'New Book World'},
          'perms': {'acc_view': true, 'acc_sales': true, 'acc_inventory': true},
          'accounts': [{'id': 'cash1', 'is_cash': true, 'active': true, 'name': 'Cash'}],
          'taxcodes': [{'kind': 'taxable', 'rate': 0, 'active': true}, {'kind': 'taxable', 'rate': 18, 'active': true}],
          'branches': [], 'warehouses': [{'id': 'wh', 'is_default': true}],
        };
      case 'acc_list_products':
        return {'rows': [
          {'id': 'p1', 'name': 'Notebook', 'sku': 'NB1', 'barcode': '8901234567890', 'unit': 'Nos', 'sale_price': 45, 'mrp': 60, 'tax_rate': 0, 'stock': 10, 'track_stock': true, 'is_service': false, 'active': true, 'avg_cost': 30, 'reorder_level': 2},
          {'id': 'p2', 'name': 'Gel pen', 'sku': 'GP', 'barcode': '', 'unit': 'Nos', 'sale_price': 20, 'mrp': 0, 'tax_rate': 18, 'stock': 0, 'track_stock': true, 'is_service': false, 'active': true, 'avg_cost': 8, 'reorder_level': 5},
        ]};
      case 'acc_offline_apply':
        applied.add(Map<String, dynamic>.from(args['p'] as Map));
        return {'id': 'doc1', 'number': '1/2026-27', 'total': 45};
      case 'acc_get_document':
        return {'doc': {'id': 'doc1', 'number': '1/2026-27', 'total': 45}};
      case 'acc_list_documents':
        return {'rows': [{'id': 'doc1', 'number': '1/2026-27', 'doc_date': '2026-10-12', 'party_name': 'Ravi', 'total': 45, 'outstanding': 0}], 'count': 1};
    }
    return null;
  }
}

class _S extends ScanSession {
  _S(this._a);
  final _Api _a;
  @override
  ApiClient get api => _a;
}

Future<(_S, _Api)> boot(WidgetTester t) async {
  final api = _Api();
  final s = _S(api);
  await t.runAsync(() => s.openWith({'id': 'u1', 'email': 'o@x.in'}, MemoryStore()));
  await t.pumpWidget(MaterialApp(theme: Tk.theme(), home: ScanShell(s)));
  await t.pump(const Duration(milliseconds: 300));
  return (s, api);
}

Future<void> settle(WidgetTester t) async {
  await t.pump();
  await t.pump(const Duration(milliseconds: 500));
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  SharedPreferences.setMockInitialValues({});
  void phone(WidgetTester t) {
    t.view.physicalSize = const Size(1080, 2200);
    t.view.devicePixelRatio = 2.75;
    addTearDown(t.view.reset);
  }

  testWidgets('every tab opens without a layout error', (t) async {
    phone(t);
    final (s, _) = await boot(t);
    expect(find.text('Scan to sell'), findsWidgets);
    for (final tab in ['Products', 'Sales']) {
      await t.tap(find.descendant(of: find.byType(NavigationBar), matching: find.text(tab)));
      await settle(t);
      await t.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 30)));
      await t.pump(const Duration(milliseconds: 300));
      expect(t.takeException(), isNull, reason: tab);
    }
    expect(find.text('1/2026-27'), findsOneWidget);
    await t.tap(find.descendant(of: find.byType(NavigationBar), matching: find.text('More')));
    await settle(t);
    expect(t.takeException(), isNull);
    await s.signOut();
  });

  testWidgets('type a name, add it, charge online: the books get one sale with the GST maths', (t) async {
    phone(t);
    final (s, api) = await boot(t);
    await t.enterText(find.byType(TextField).first, 'note');
    await t.pump(const Duration(milliseconds: 300));
    await t.tap(find.text('Notebook').last);
    await t.pump(const Duration(milliseconds: 300));
    expect(find.textContaining('Charge'), findsWidgets);
    await t.ensureVisible(find.textContaining('Charge ₹45').last);
    await t.pump(const Duration(milliseconds: 200));
    await t.tap(find.textContaining('Charge ₹45').last);
    await settle(t);
    await t.tap(find.text('Charge').last);
    for (var i = 0; i < 8; i++) {
      await t.pump(const Duration(milliseconds: 200));
    }
    expect(api.applied, hasLength(1));
    final sale = api.applied.single['payload'] as Map;
    expect(api.applied.single['kind'], 'sale');
    expect(sale['post'], true);
    expect((sale['lines'] as List).single['product_id'], 'p1');
    expect((sale['payments'] as List).single['amount'], 45);
    expect(t.takeException(), isNull);
    await s.signOut();
  });

  testWidgets('offline: the sale is kept on the phone with a provisional number', (t) async {
    phone(t);
    final (s, api) = await boot(t);
    s.offline = true;
    await t.enterText(find.byType(TextField).first, 'note');
    await t.pump(const Duration(milliseconds: 300));
    await t.tap(find.text('Notebook').last);
    await t.pump(const Duration(milliseconds: 300));
    await t.ensureVisible(find.textContaining('Charge ₹45').last);
    await t.pump(const Duration(milliseconds: 200));
    await t.tap(find.textContaining('Charge ₹45').last);
    await settle(t);
    await t.tap(find.text('Charge').last);
    for (var i = 0; i < 8; i++) {
      await t.pump(const Duration(milliseconds: 200));
    }
    expect(api.applied, isEmpty);
    expect(s.queue, hasLength(1));
    expect(s.queue.first['kind'], 'sale');
    expect('${(s.queue.first['meta'] as Map)['ref']}', startsWith('OFF-'));
    expect(s.products.firstWhere((p) => p['id'] == 'p1')['stock'], 9);
    expect(t.takeException(), isNull);
    await s.signOut();
  });
}
