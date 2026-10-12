import 'dart:async';
import 'package:flutter/material.dart' hide Text;
import 'package:flutter/material.dart' as m;
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:auzsmob/core/api.dart';
import 'package:auzsmob/core/session.dart';
import 'package:auzsmob/core/store.dart';
import 'package:auzsmob/ui/shell.dart';
import 'package:auzsmob/ui/theme.dart';
import 'package:auzsmob/ui/i18n.dart';
import 'package:auzsmob/ui/p_more.dart';
import 'package:auzsmob/ui/p_purchase.dart';
import 'package:auzsmob/ui/p_repairs.dart';

class _Api extends ApiClient {
  final calls = <String>[];
  final sent = <Map<String, dynamic>>[];
  @override
  Future<dynamic> rpc(String fn, [Map<String, dynamic> args = const {}]) async {
    calls.add(fn);
    switch (fn) {
      case 'my_dashboard':
        return {'my_role': 'owner', 'my_email': 'o@x.in', 'tenant': {'slug': 'arpit', 'name': 'Arpit Traders'}, 'features': {'mobile': true}, 'enabled_features': {}};
      case 'mob_context':
        return {
          'perms': {'mob_view': true, 'mob_sell': true, 'mob_purchase': true, 'mob_repair': true, 'mob_manage': true, 'mob_reports': true},
          'can_see_rates': true, 'settings': {'shopName': 'Arpit Traders', 'features': {}}, 'my_language': 'en', 'my_language_set': true,
        };
      case 'mob_data_epoch':
        return {'epoch': 'E1'};
      case 'mob_sync_pull':
        return {'full': false, 'server_time': '2026-10-12T10:00:00.000000+00:00', 'items': [], 'units': [], 'vendors': [], 'customers': [], 'purchases': [], 'sales': [], 'repairs': [], 'repair_events': [], 'payments': [], 'stock_movements': []};
      case 'mob_report_dashboard':
        return {'sales_total': 1500, 'sales_count': 2, 'profit_total': 400, 'repairs_pending': 1, 'customer_dues': 300, 'low_stock': [{'name': 'Tempered glass', 'qty': 1}], 'by_staff': [{'staff_id': 's1', 'sales': 2, 'revenue': 1500, 'profit': 400}]};
      case 'mob_report_activity':
        return [{'kind': 'sale', 'staff_id': 's1', 'at': '2026-10-12T09:00:00Z', 'amount': 800}];
      case 'mob_staff_list':
        return [{'id': 's1', 'name': 'Asha', 'role': 'cashier'}];
      case 'mob_report_ledger':
        return {'rows': [{'item_name': 'Case', 'qty': 2, 'cost_total': 100, 'sale_total': 180, 'profit': 80, 'sold_by': 'Asha', 'sold_by_id': 's1', 'sold_at': '2026-10-12T09:00:00Z', 'customer_name': 'Walk-in'}], 'total_sale': 180, 'total_cost': 100, 'total_profit': 80};
      case 'mob_integrity_check':
        return {'ok': true, 'checks': [{'name': 'Stock matches', 'ok': true}]};
      case 'mob_push_sale':
        sent.add(args);
        return {'ok': true};
    }
    return null;
  }

  @override
  Future<List<Map<String, dynamic>>> syncBatch(List<Map<String, dynamic>> ops) async => throw ApiError('no', status: 404);
}

class _S extends MobSession {
  _S(this._a);
  final _Api _a;
  @override
  ApiClient get api => _a;
}

Future<_S> boot(WidgetTester t) async {
  final api = _Api();
  final s = _S(api);
  final store = MemoryStore();
  await store.put('items', {'id': 'i1', 'name': 'Phone case', 'category': 'accessory', 'serialized': false, 'selling_price': 199, 'cost_price': 90, 'low_stock_at': 2, 'active': true});
  await store.put('stockMovements', {'id': 'm1', 'item_id': 'i1', 'qty': 5, 'type': 'purchase', 'ref_id': 'p0'});
  await store.put('vendors', {'id': 'v1', 'name': 'Sharma Traders', 'phone': '9999'});
  await t.runAsync(() => s.openWith({'id': 'u1', 'email': 'o@x.in'}, store));
  s.repo!.autoSync = false;
  await t.pumpWidget(MaterialApp(theme: Tk.theme(), home: MobShell(s)));
  await t.pump(const Duration(milliseconds: 300));
  return s;
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  SharedPreferences.setMockInitialValues({});

  testWidgets('every tab opens without a layout error on a phone', (t) async {
    t.view.physicalSize = const Size(1080, 2200);
    t.view.devicePixelRatio = 2.75;
    addTearDown(t.view.reset);
    final prev = FlutterError.onError;
    FlutterError.onError = (d) {
      debugPrint('DETAIL ${d.toDiagnosticsNode().toStringDeep()}');
      prev?.call(d);
    };
    addTearDown(() => FlutterError.onError = prev);
    final s = await boot(t);
    expect(find.text('Home'), findsWidgets);
    for (final tab in ['New sale', 'Repairs', 'Stock']) {
      await t.tap(find.descendant(of: find.byType(NavigationBar), matching: find.text(tab)));
      await t.pump(const Duration(milliseconds: 300));
      expect(t.takeException(), isNull, reason: tab);
    }
    await t.tap(find.descendant(of: find.byType(NavigationBar), matching: find.text('Stock')));
    await t.pump(const Duration(milliseconds: 300));
    expect(find.text('Phone case'), findsOneWidget);
    // More sheet, then Reports, Dues, Settings through it
    for (final tab in ['Reports', 'Dues', 'Settings']) {
      await t.tap(find.descendant(of: find.byType(NavigationBar), matching: find.text('More')));
      await t.pump();
      await t.pump(const Duration(milliseconds: 500));
      await t.tap(find.text(tab).last);
      await t.pump();
      await t.pump(const Duration(milliseconds: 600));
      await t.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 50)));
      await t.pump(const Duration(milliseconds: 400));
      final ex = t.takeException();
      if (ex != null) fail('$tab: ${ex is FlutterError ? ex.toStringDeep() : ex}');
    }
    expect(find.text('Shop details'), findsOneWidget);
    await s.signOut();
  });

  testWidgets('sell a phone case: search, set the price, check out, and it is queued for the server', (t) async {
    t.view.physicalSize = const Size(1080, 2200);
    t.view.devicePixelRatio = 2.75;
    addTearDown(t.view.reset);
    final s = await boot(t);
    await t.tap(find.descendant(of: find.byType(NavigationBar), matching: find.text('New sale')));
    await t.pump(const Duration(milliseconds: 300));
    await t.enterText(find.byType(TextField).first, 'case');
    await t.pump(const Duration(milliseconds: 300));
    await t.tap(find.text('Phone case').last);
    await t.pump();
    await t.pump(const Duration(milliseconds: 500));
    expect(find.text('Selling price (this bill)'), findsOneWidget);
    await t.tap(find.text('Add to cart'));
    await t.pump();
    await t.pump(const Duration(milliseconds: 500));
    expect(find.text('Checkout'), findsOneWidget);
    await t.ensureVisible(find.text('Checkout'));
    await t.pump(const Duration(milliseconds: 300));
    await t.tap(find.text('Checkout'));
    for (var i = 0; i < 6; i++) {
      await t.pump(const Duration(milliseconds: 200));
    }
    expect(find.text('Sale complete'), findsOneWidget);
    final queued = await s.repo!.store.outAll();
    expect(queued.length, 1);
    expect(queued.first.fn, 'mob_push_sale');
    final items = (queued.first.args['p'] as Map)['items'] as List;
    expect((items.first as Map)['price'], 199);
    expect(s.repo!.rows('sales').length, 1);
    await t.tap(find.text('Done'));
    await t.pump(const Duration(milliseconds: 300));
    await s.signOut();
  });
  testWidgets('Hindi: every tab and the More sheet fit the screen', (t) async {
    t.view.physicalSize = const Size(1080, 2200);
    t.view.devicePixelRatio = 2.75;
    addTearDown(t.view.reset);
    Lang.code = 'hi';
    addTearDown(() => Lang.code = 'en');
    final s = await boot(t);
    final bar = find.byType(NavigationBar);
    final labels = [for (final w in t.widgetList<NavigationDestination>(find.descendant(of: bar, matching: find.byType(NavigationDestination)))) w.label];
    expect(labels.length, 5);
    for (var i = 0; i < 4; i++) {
      await t.tap(find.text(labels[i]).last);
      await t.pump();
      await t.pump(const Duration(milliseconds: 400));
      final ex = t.takeException();
      if (ex != null) fail('${labels[i]}: $ex');
    }
    await t.tap(find.text(labels[4]).last);
    await t.pump();
    await t.pump(const Duration(milliseconds: 500));
    expect(t.takeException(), isNull);
    await s.signOut();
  });

  testWidgets('a repair ticket is saved on the phone and queued', (t) async {
    t.view.physicalSize = const Size(1080, 2200);
    t.view.devicePixelRatio = 2.75;
    addTearDown(t.view.reset);
    final s = await boot(t);
    await t.tap(find.descendant(of: find.byType(NavigationBar), matching: find.text('Repairs')));
    await t.pump(const Duration(milliseconds: 300));
    openRepairSheet(t.element(find.byType(MobShell)), s);
    await t.pump();
    await t.pump(const Duration(milliseconds: 500));
    await t.enterText(find.byType(TextField).at(0), 'Ramesh');
    await t.enterText(find.byType(TextField).at(2), 'Redmi 12');
    await t.enterText(find.byType(TextField).at(4), 'Screen cracked');
    await t.tap(find.text('Save').last);
    for (var i = 0; i < 5; i++) {
      await t.pump(const Duration(milliseconds: 200));
    }
    final q = await s.repo!.store.outAll();
    expect(q.single.fn, 'mob_create_repair');
    expect((q.single.args['p'] as Map)['deviceModel'], 'Redmi 12');
    expect(s.repo!.rows('repairs').single['problem'], 'Screen cracked');
    expect(t.takeException(), isNull);
    await s.signOut();
  });

  testWidgets('a purchase with a brand-new item saves the item, then the purchase, in that order', (t) async {
    t.view.physicalSize = const Size(1080, 2200);
    t.view.devicePixelRatio = 2.75;
    addTearDown(t.view.reset);
    final s = await boot(t);
    await t.pumpWidget(MaterialApp(theme: Tk.theme(), home: PurchasePage(s)));
    await t.pump(const Duration(milliseconds: 300));
    await t.enterText(find.byType(TextField).first, 'USB cable');
    await t.pump(const Duration(milliseconds: 300));
    await t.tap(find.textContaining('USB cable').last);
    await t.pump(const Duration(milliseconds: 300));
    // rate, selling price and qty fields appear after picking
    await t.enterText(find.widgetWithText(TextField, 'Purchase rate'), '20');
    await t.enterText(find.widgetWithText(TextField, 'Selling price'), '60');
    await t.ensureVisible(find.text('Add to this purchase'));
    await t.tap(find.text('Add to this purchase'));
    await t.pump(const Duration(milliseconds: 300));
    expect(find.text('Save purchase'), findsOneWidget);
    await t.tap(find.text('Save purchase'));
    for (var i = 0; i < 5; i++) {
      await t.pump(const Duration(milliseconds: 200));
    }
    final q = await s.repo!.store.outAll();
    expect([for (final o in q) o.fn], ['mob_save_item', 'mob_push_purchase']);
    expect((q[1].args['p'] as Map)['rate'], 20);
    expect(s.repo!.stock('${q[0].args['p_id']}'), 1);
    await s.signOut();
  });

  test('placeholder so the m alias is used', () => expect(m.Text('x').data, 'x'));

  testWidgets('Customers lists who bought and who owes; Day close shows the drawer and closes the day', (t) async {
    t.view.physicalSize = const Size(1080, 2200);
    t.view.devicePixelRatio = 2.75;
    addTearDown(t.view.reset);
    final s = await boot(t);
    final now = DateTime.now().toIso8601String();
    await s.repo!.put('sales', {'id': 'sa1', 'total': 500, 'paid': 300, 'balance': 200, 'payment_mode': 'cash', 'customer_name': 'Ravi', 'customer_phone': '9812345678', 'created_at': now, 'voided': false, 'staff_id': 'u1'});
    await t.pump(const Duration(milliseconds: 300));
    expect(find.text('Customers'), findsOneWidget, reason: 'Home offers Customers');
    expect(find.text('Day close'), findsOneWidget, reason: 'and Day close');
    final nav = t.state<NavigatorState>(find.byType(Navigator).first);
    unawaited(nav.push(MaterialPageRoute<void>(builder: (_) => CustomersPage(s))));
    await t.pump();
    await t.pump(const Duration(milliseconds: 500));

    final ex0 = t.takeException();
    if (ex0 != null) fail('page threw: $ex0');
    expect(find.text('Ravi'), findsOneWidget);
    expect(find.textContaining('Due'), findsWidgets);
    expect(t.takeException(), isNull);
    await t.pageBack();
    await t.pump(const Duration(milliseconds: 400));
    unawaited(t.state<NavigatorState>(find.byType(Navigator).first).push(MaterialPageRoute<void>(builder: (_) => DayClosePage(s))));
    await t.pump();
    await t.pump(const Duration(milliseconds: 500));
    expect(find.text('Expected in the drawer'), findsOneWidget);
    await t.enterText(find.byType(TextField).first, '250');
    await t.pump(const Duration(milliseconds: 300));
    await t.drag(find.byType(ListView).last, const Offset(0, -500));
    await t.pump(const Duration(milliseconds: 300));
    expect(find.textContaining('Short by'), findsOneWidget, reason: '300 expected, 250 counted');
    await t.ensureVisible(find.text('Close the day'));
    await t.tap(find.text('Close the day'));
    await t.pump();
    await t.pump(const Duration(milliseconds: 500));
    expect((s.api as _Api).calls, contains('mob_save_settings'));
    expect(t.takeException(), isNull);
  });
}
