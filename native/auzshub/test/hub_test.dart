import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:auzshub/core/api.dart';
import 'package:auzshub/core/launcher.dart';
import 'package:auzshub/core/session.dart';
import 'package:auzshub/core/util.dart';
import 'package:auzshub/ui/home.dart';
import 'package:auzshub/ui/requests.dart';
import 'package:auzshub/ui/theme.dart';

class FakeApi extends ApiClient {
  FakeApi(this.who, {this.orders = const []});
  /// hub_me and my_dashboard answers for the person being tested.
  final Map<String, dynamic> who;
  final List<Map<String, dynamic>> orders;
  final calls = <String>[];

  @override
  Future<dynamic> rpc(String fn, [Map<String, dynamic> args = const {}]) async {
    calls.add(fn);
    switch (fn) {
      case 'hub_me':
        return who['hub'];
      case 'my_dashboard':
        return who['dash'];
      case 'my_client_orders':
        return orders;
    }
    return null;
  }
}

Future<HubSession> session(Map<String, dynamic> who, {List<Map<String, dynamic>> orders = const []}) async {
  SharedPreferences.setMockInitialValues({});
  final api = FakeApi(who, orders: orders);
  final s = HubSession(api: api);
  api.token = 'tok';
  s.user = {'id': 'u1', 'email': 'a@x.in'};
  await s.load();
  return s;
}

const customer = {'hub': {'email': 'c@x.in', 'admin': false, 'team': false, 'business': false}};
const admin = {'hub': {'email': 'a@x.in', 'admin': true, 'team': false, 'business': false}};
const teamOnly = {'hub': {'email': 't@x.in', 'admin': false, 'team': 'setup', 'business': false}};
final cafe = {
  'hub': {'email': 'o@x.in', 'admin': false, 'team': false, 'business': true},
  'dash': {
    'my_role': 'owner',
    'my_email': 'o@x.in',
    'tenant': {'slug': 'acme', 'name': 'Acme Cafe', 'niche': 'cafe'},
    'features': {'pos': true, 'self_order': true, 'website_builder': true},
    'enabled_features': {'website_builder': false},
  },
};

Future<void> show(WidgetTester t, HubSession s) async {
  await t.binding.setSurfaceSize(const Size(420, 900));
  await t.pumpWidget(MaterialApp(theme: Tk.theme(), home: HubHome(s)));
  await t.pump();
  await t.pump(const Duration(milliseconds: 50));
}

void main() {
  test('the kind of person comes from the server answer', () async {
    expect((await session(customer)).kind, Kind.customer);
    expect((await session(admin)).kind, Kind.admin);
    expect((await session(teamOnly)).kind, Kind.team);
    final b = await session(cafe);
    expect(b.kind, Kind.business);
    expect(b.businessName, 'Acme Cafe');
    expect(b.isOwner, true);
  });

  test('an app is on only when entitled and not switched off by the owner', () async {
    final b = await session(cafe);
    expect(b.own('pos'), true);
    expect(b.own('website_builder'), false);
    expect(b.own('payroll'), false);
    expect(productApps.where((a) => a.allowedFor(b)).map((a) => a.id).toList(), ['pos']);
  });

  test('AUZsScan opens for accounting or scan', () async {
    final scan = productApps.firstWhere((a) => a.id == 'scan');
    final a = await session({'hub': cafe['hub'], 'dash': {'features': {'accounting': true}, 'enabled_features': {}}});
    final b = await session({'hub': cafe['hub'], 'dash': {'features': {'scan': true}, 'enabled_features': {}}});
    final c = await session({'hub': cafe['hub'], 'dash': {'features': {'pos': true}, 'enabled_features': {}}});
    expect([scan.allowedFor(a), scan.allowedFor(b), scan.allowedFor(c)], [true, true, false]);
  });

  test('the hand-over is the same base64url JSON the website and the other apps read', () async {
    final s = await session(cafe);
    final h = s.handoff();
    expect(h.contains('='), false);
    var t = h.replaceAll('-', '+').replaceAll('_', '/');
    while (t.length % 4 != 0) {
      t += '=';
    }
    final m = jsonDecode(utf8.decode(base64.decode(t))) as Map;
    expect(m['t'], 'tok');
    expect((m['u'] as Map)['id'], 'u1');
    expect(siteUri(s, 'account.html').fragment, 'auz_gt=$h');
  });

  test('request steps match the website', () {
    expect(statusOf('link_sent').$3, 3);
    expect(statusOf('paid').$1, 'Active');
    expect(statusOf('rejected').$3, 0);
    expect(statusOf('weird').$1, 'weird');
  });

  test('rupees use lakh grouping', () {
    expect(inr(1090), '₹1,090');
    expect(inr(1234567), '₹12,34,567');
    expect(inr(2179.5), '₹2,179.50');
  });

  testWidgets('a customer sees requests, account, cart and explore, no apps', (t) async {
    await show(t, await session(customer));
    for (final x in ['Welcome', 'My requests', 'My account and purchases', 'My cart', 'Explore AUZslab', 'Products and pricing']) {
      expect(find.text(x), findsOneWidget, reason: x);
    }
    expect(find.text('AUZsPOS'), findsNothing);
  });

  testWidgets('the admin sees the admin panel', (t) async {
    await show(t, await session(admin));
    expect(find.text('AUZslab admin'), findsOneWidget);
    expect(find.text('Admin panel'), findsOneWidget);
  });

  testWidgets('a business owner sees only the apps the business owns', (t) async {
    await show(t, await session(cafe));
    expect(find.text('Acme Cafe'), findsOneWidget);
    expect(find.text('AUZsPOS'), findsOneWidget);
    expect(find.text('AUZsPay'), findsNothing);
    expect(find.text('Admin console'), findsOneWidget);
    expect(find.text('Website Builder'), findsNothing);
  });

  testWidgets('the My requests tile says how many are ready to pay, and the page shows each one', (t) async {
    final orders = [
      {'business_name': 'Acme', 'status': 'link_sent', 'token': 'abc', 'products': ['AUZsPOS'], 'created_at': '2026-10-12T04:00:00Z'},
      {'business_name': 'Beta', 'status': 'paid', 'token': 'def', 'invoice_no': 'AUZ/2026-27/0001', 'products': [], 'created_at': '2026-10-01T04:00:00Z'},
    ];
    final s = await session(customer, orders: orders);
    await show(t, s);
    expect(find.text('1 request is ready for payment'), findsOneWidget);
    await t.tap(find.text('My requests'));
    await t.pumpAndSettle();
    expect(find.text('Read quote and pay'), findsOneWidget);
    expect(find.text('View bill'), findsOneWidget);
    expect(find.text('Bill AUZ/2026-27/0001'), findsOneWidget);
  });
}
