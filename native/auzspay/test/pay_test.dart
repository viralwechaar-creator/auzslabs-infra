import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:auzspay/core/api.dart';
import 'package:auzspay/core/calc.dart';
import 'package:auzspay/core/session.dart';
import 'package:auzspay/core/store.dart';
import 'package:auzspay/ui/shell.dart';
import 'package:auzspay/ui/theme.dart';

class FakeApi extends ApiClient {
  final calls = <String>[];
  final punched = <Map<String, dynamic>>[];
  final offlineSent = <Map<String, dynamic>>[];
  bool down = false;
  ApiError? refuse;
  bool hr = true;
  final seen = <String>{};

  @override
  Future<dynamic> rpc(String fn, [Map<String, dynamic> args = const {}]) async {
    calls.add(fn);
    if (down && fn.startsWith('pay_')) throw ApiError('Could not reach the server', networkError: true);
    switch (fn) {
      case 'my_dashboard':
        return {'my_role': 'owner', 'my_email': 'o@x.in', 'tenant': {'slug': 'acme', 'name': 'Acme'}, 'features': {'payroll': true}, 'enabled_features': {}};
      case 'pay_bootstrap':
        return {'hr': hr, 'perms': {'pay_view': true, 'pay_salary': true, 'pay_run': true}, 'org': {'name': 'Acme'}, 'masters': []};
      case 'pay_me':
        return {
          'date': '2026-10-12',
          'employee': {'id': 'e1', 'name': 'Priya Shah', 'designation': 'Cashier', 'status': 'active', 'mode': 'punch'},
          'punch': {'open': false, 'last': null},
          'today': {}, 'punches': [], 'is_manager': true, 'team_pending': 1, 'team': [{'name': 'Ravi', 'status': 'present', 'in': '2026-10-12T04:00:00Z'}],
          'leave': [{'id': 'l1', 'name': 'Casual', 'paid': true, 'balance': 6, 'used': 2}],
          'leave_types': [{'id': 'l1', 'name': 'Casual', 'paid': true}],
          'requests': [{'type': 'leave', 'id': 'r1', 'title': 'Casual leave', 'status': 'pending', 'from': '2026-10-20', 'to': '2026-10-21', 'days': 2}],
          'payslip': {'id': 's1', 'net': 18000, 'month': '2026-09'},
          'announcements': [{'title': 'Diwali holiday', 'body': 'Shop closed 20 Oct', 'at': '2026-10-10T00:00:00Z'}],
          'holidays': [{'name': 'Diwali', 'date': '2026-10-20'}],
          'org': {'name': 'Acme', 'has_site': false, 'geofence': 'off'},
        };
      case 'pay_me_punch':
        punched.add(Map<String, dynamic>.from(args['p'] as Map));
        return {'open': true};
      case 'pay_me_punch_offline':
        final p = Map<String, dynamic>.from(args['p'] as Map);
        if (refuse != null) throw refuse!;
        if (!seen.add('${p['op']}')) return {'duplicate': true};
        offlineSent.add(p);
        return {'open': true};
      case 'pay_me_attendance':
        return {'days': [
          {'date': '2026-10-10', 'status': 'present', 'first_in': '2026-10-10T04:00:00Z', 'last_out': '2026-10-10T12:30:00Z', 'worked_mins': 510},
          {'date': '2026-10-11', 'status': 'absent'},
        ], 'punches': [], 'requests': []};
      case 'pay_me_payslips':
        return [{'id': 's1', 'title': 'September 2026', 'gross': 20000, 'deductions': 2000, 'net': 18000, 'paid': true}];
      case 'pay_get_item':
        return {'item': {'net': 18000, 'gross': 20000, 'deductions': 2000, 'att': {'paid_days': 30, 'divisor': 30}}, 'run': {'title': 'September 2026'}, 'org': {'name': 'Acme'},
          'lines': [{'kind': 'earning', 'name': 'Basic', 'amount': 20000}, {'kind': 'deduction', 'name': 'PF', 'amount': 2000}]};
      case 'pay_list_requests':
        return [{'type': 'leave', 'id': 'r9', 'name': 'Ravi', 'title': 'Casual leave', 'from': '2026-10-20', 'to': '2026-10-20', 'balance': 4, 'reason': 'wedding'}];
      case 'pay_leave_decide':
        return {'ok': true};
      case 'pay_list_employees':
        return [{'id': 'e2', 'name': 'Ravi Kumar', 'designation': 'Packer', 'status': 'active', 'today': 'present', 'gross': 15000}];
      case 'pay_list_runs':
        return [{'id': 'run1', 'title': 'September 2026', 'month': '2026-09', 'employees': 4, 'net': 80000, 'status': 'paid'}];
      case 'pay_dashboard':
        return {'today': '2026-10-12', 'attendance': {'present': 3, 'late': 1}, 'pending': {'leave': 1}, 'headcount': {'active': 4}};
      case 'pay_me_leave_apply':
        return {'days': 2};
      case 'pay_me_cancel':
        return {'ok': true};
    }
    return null;
  }
}

class _S extends PaySession {
  _S(this._a);
  final FakeApi _a;
  @override
  ApiClient get api => _a;
}

Future<(_S, FakeApi)> boot(WidgetTester t, {bool hr = true}) async {
  final api = FakeApi()..hr = hr;
  final s = _S(api);
  await t.runAsync(() => s.openWith({'id': 'u1', 'email': 'o@x.in'}, MemoryStore()));
  await t.pumpWidget(MaterialApp(theme: Tk.theme(), home: PayShell(s)));
  await t.pump(const Duration(milliseconds: 300));
  return (s, api);
}

Future<void> settle(WidgetTester t) async {
  await t.pump();
  await t.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 30)));
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

  test('helpers', () {
    expect(inr(1234567), '₹12,34,567');
    expect(monthAdd('2026-12', 1), '2027-01');
    expect(monthAdd('2026-01', -1), '2025-12');
    expect(monthName('2026-09'), 'September 2026');
    expect(mins(125), '2h 5m');
    expect(fmtD('2026-10-05'), '5 Oct 2026');
  });

  testWidgets('every tab opens without a layout error', (t) async {
    phone(t);
    await boot(t);
    expect(find.text('Hi, Priya'), findsWidgets);
    expect(find.byKey(const Key('punch')), findsOneWidget);
    for (final tab in ['Time', 'Leave', 'Pay', 'More', 'Today']) {
      await t.tap(find.descendant(of: find.byType(NavigationBar), matching: find.text(tab)));
      await settle(t);
      expect(t.takeException(), isNull, reason: tab);
    }
  });

  testWidgets('clock in online, then offline keeps it and sends it once on reconnect', (t) async {
    phone(t);
    final (s, api) = await boot(t);
    await t.tap(find.byKey(const Key('punch')));
    await settle(t);
    expect(api.punched.length, 1);
    api.down = true;
    final r = await t.runAsync(() => s.punchNow());
    expect(r, 'offline');
    expect(s.punchq.length, 1);
    // still offline: stays queued
    await t.runAsync(() => s.flushPunches());
    expect(s.punchq.length, 1);
    api.down = false;
    await t.runAsync(() => s.flushPunches());
    expect(s.punchq, isEmpty);
    expect(api.offlineSent.length, 1);
    // replay of the same op is a no-op on the server
    s.punchq.add({...api.offlineSent.first});
    await t.runAsync(() => s.flushPunches());
    expect(api.offlineSent.length, 1);
  });

  testWidgets('a refused offline clock-in is dropped and shown', (t) async {
    phone(t);
    final (s, api) = await boot(t);
    api.down = true;
    await t.runAsync(() => s.punchNow());
    api.down = false;
    api.refuse = ApiError('Too old', status: 400);
    await t.runAsync(() => s.flushPunches());
    await t.pump();
    expect(s.punchq, isEmpty);
    expect(find.textContaining('Too old'), findsOneWidget);
  });

  testWidgets('HR side: approvals, people, payroll open', (t) async {
    phone(t);
    final (s, api) = await boot(t);
    await t.tap(find.descendant(of: find.byType(NavigationBar), matching: find.text('More')));
    await settle(t);
    for (final label in ['HR today', 'Approvals', 'People', 'Payroll']) {
      await t.tap(find.text(label));
      await settle(t);
      expect(t.takeException(), isNull, reason: label);
      await t.pageBack();
      await settle(t);
    }
    await t.tap(find.text('Approvals'));
    await settle(t);
    expect(find.text('Ravi'), findsOneWidget);
    await t.tap(find.text('Approve'));
    await settle(t);
    expect(api.calls, contains('pay_leave_decide'));
    expect(s.hr, isTrue);
  });

  testWidgets('staff login without HR sees no HR section', (t) async {
    phone(t);
    await boot(t, hr: false);
    await t.tap(find.descendant(of: find.byType(NavigationBar), matching: find.text('More')));
    await settle(t);
    expect(find.text('HR today'), findsNothing);
    expect(find.text('Profile'), findsOneWidget);
  });
}
