import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:auzshub/core/api.dart';
import 'package:auzshub/core/launcher.dart';
import 'package:auzshub/core/session.dart';
import 'package:auzshub/core/util.dart';
import 'package:auzshub/core/orderdata.dart';
import 'package:auzshub/ui/account.dart';
import 'package:auzshub/ui/admin.dart';
import 'package:auzshub/ui/admin_money.dart';
import 'package:auzshub/ui/cart.dart';
import 'package:auzshub/ui/home.dart';
import 'package:auzshub/ui/pay.dart';
import 'package:auzshub/ui/team.dart';
import 'package:auzshub/ui/requests.dart';
import 'package:auzshub/ui/theme.dart';

class FakeApi extends ApiClient {
  FakeApi(this.who, {this.orders = const []});
  /// hub_me and my_dashboard answers for the person being tested.
  final Map<String, dynamic> who;
  final List<Map<String, dynamic>> orders;
  final calls = <String>[];
  final args = <String, Map<String, dynamic>>{};
  Map<String, dynamic>? quote;
  String teamRole = 'salesman';

  @override
  Future<dynamic> rpc(String fn, [Map<String, dynamic> a = const {}]) async {
    calls.add(fn);
    args[fn] = a;
    switch (fn) {
      case 'hub_me':
        return who['hub'];
      case 'my_dashboard':
        return who['dash'];
      case 'my_client_orders':
        return orders;
      case 'admin_open_counts':
        return {'team': 2, 'privacy': 0};
      case 'admin_list_client_orders':
        return [
          {'id': 'o1', 'business_name': 'Beta Foods', 'status': 'payment_submitted', 'kind': 'new', 'created_at': '2026-10-12T04:00:00Z', 'products': ['pos', 'payroll'], 'total': 3000, 'has_proof': true},
        ];
      case 'list_clients':
        return [
          {'id': 'c1', 'name': 'Acme Cafe', 'slug': 'acme', 'niche': 'cafe', 'status': 'active', 'monthly_fee': 1090, 'renewal_date': '2099-01-01', 'features': {'pos': true}},
        ];
      case 'team_me':
        return {'id': 't1', 'role': teamRole, 'name': 'Ravi Kumar', 'email': 't@x.in'};
      case 'team_my_work':
        return {'summary': {'leads_open': 2, 'leads_converted': 1, 'leads_overdue': 1, 'updates': 5}, 'recent': []};
      case 'team_my_leads':
      case 'team_all_leads':
        return [
          {'id': 'l1', 'name': 'Asha', 'business': 'Asha Cafe', 'contact': '98765', 'status': 'new', 'next_followup': '2020-01-01'},
          {'id': 'l2', 'name': 'Bhav', 'business': '', 'contact': '99', 'status': 'converted'},
        ];
      case 'team_list_notices':
        return [];
      case 'salesman_my_trials':
        return [];
      case 'public_client_order':
        return quote;
      case 'my_profile':
        return {'login_email': 'c@x.in', 'profile': {'name': 'Asha', 'phone': '9876543210', 'business_name': 'Asha Cafe', 'niche': 'cafe'}};
      case 'submit_client_order':
        return {'token': 'a' * 32};
      case 'public_product_prices':
        return [
          {'key': 'pos', 'monthly_price': 1090, 'yearly_price': 10900},
          {'key': 'self_order', 'monthly_price': 400},
          {'key': 'payroll', 'monthly_price': 590},
          {'key': 'accounting', 'monthly_price': 1490},
          {'key': 'mobile', 'monthly_price': 249, 'yearly_price': 2490, 'renewal_yearly_price': 1990, 'gst_exempt': true, 'setup_fee_exempt': true},
        ];
      case 'public_bundles':
        return [
          {'label': 'Hospitality Essentials', 'badge': 'Popular', 'feature_keys': ['pos', 'payroll'], 'monthly_price': 1490, 'list_price': 1680, 'yearly_price': 14900, 'blurb': 'For cafes.'},
        ];
      case 'public_addon_price_overrides':
        return [];
      case 'submit_lead':
      case 'submit_team_application':
        return {'ok': true};
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

  testWidgets('the cart sends the same request the website sends', (t) async {
    SharedPreferences.setMockInitialValues({});
    final api = FakeApi(customer);
    final s = HubSession(api: api);
    api.token = 'tok';
    s.user = {'id': 'u1', 'email': 'c@x.in'};
    await s.load();
    await t.binding.setSurfaceSize(const Size(420, 1800));
    await t.pumpWidget(MaterialApp(theme: Tk.theme(), home: CartPage(s)));
    await t.pump(const Duration(milliseconds: 100));
    await t.tap(find.text('AUZsPOS'));
    await t.pump();
    await t.enterText(find.byType(TextField).at(2), 'Asha Cafe');
    await t.tap(find.text('Send request'));
    await t.pump();
    expect(find.text('Please tell us what you need.'), findsOneWidget);
    expect(api.calls.contains('submit_client_order'), false);
    await t.enterText(find.byType(TextField).at(6), 'Billing for one cafe');
    await t.tap(find.text('Send request'));
    await t.pump(const Duration(milliseconds: 100));
    final p = api.args['submit_client_order']!['p'] as Map;
    expect(p['products'], ['pos']);
    expect(p['contact_name'], 'Asha');
    expect(p['business_name'], 'Asha Cafe');
    expect(p['requirement'], 'Billing for one cafe');
  });

  testWidgets('the payment page shows the quote and wants the terms ticked before sending', (t) async {
    SharedPreferences.setMockInitialValues({});
    final api = FakeApi(customer);
    api.quote = {
      'status': 'link_sent', 'contact_name': 'Asha', 'phone': '9876543210', 'business_name': 'Asha Cafe',
      'payment': {},
      'totals': {'taxable': 1090, 'intra': true, 'cgst': 98.1, 'sgst': 98.1, 'total': 1286, 'lines': [{'type': 'product', 'label': 'AUZsPOS', 'rate': 1090, 'discount': 0, 'gst': 18, 'plan': 'month'}]},
    };
    final s = HubSession(api: api);
    api.token = 'tok';
    s.user = {'id': 'u1', 'email': 'c@x.in'};
    await t.binding.setSurfaceSize(const Size(420, 4200));
    await t.pumpWidget(MaterialApp(theme: Tk.theme(), home: PayPage(s, 'f' * 32)));
    await t.pump(const Duration(milliseconds: 100));
    expect(find.text('Total to pay'), findsOneWidget);
    expect(find.text('₹1,286'), findsWidgets);
    await t.tap(find.text('I have paid: send screenshot'));
    await t.pump();
    expect(find.text('Please tick the box to accept the terms, privacy policy and refund policy.'), findsOneWidget);
    expect(api.calls.contains('public_order_submit_payment'), false);
  });

  testWidgets('the account page shows the profile and the products the business owns', (t) async {
    final s = await session(cafe);
    await t.binding.setSurfaceSize(const Size(420, 1800));
    await t.pumpWidget(MaterialApp(theme: Tk.theme(), home: AccountPage(s)));
    await t.pump(const Duration(milliseconds: 100));
    expect(find.text('Acme Cafe'), findsWidgets);
    expect(find.text('AUZsPOS'), findsOneWidget);
    expect(find.text('Save details'), findsOneWidget);
  });

  test('every product the website cart offers has a label', () {
    expect(productLabels.keys, containsAll(['pos', 'payroll', 'accounting', 'mobile', 'scan', 'salon']));
    expect(stateNames['08'], 'Rajasthan');
  });

  testWidgets('the team workspace shows the right tabs and the due lead for a salesman', (t) async {
    final s = await session(teamOnly);
    await t.binding.setSurfaceSize(const Size(420, 1200));
    await t.pumpWidget(MaterialApp(theme: Tk.theme(), home: TeamWorkspace(s)));
    await t.pump(const Duration(milliseconds: 100));
    await t.pump(const Duration(milliseconds: 100));
    for (final x in ['Home', 'Leads', 'Trials', 'Me']) {
      expect(find.text(x), findsWidgets, reason: x);
    }
    expect(find.text('Team'), findsNothing);
    expect(find.text('Asha Cafe'), findsOneWidget);
    await t.tap(find.text('Leads').last);
    await t.pump(const Duration(milliseconds: 100));
    await t.pump(const Duration(milliseconds: 100));
    expect(find.text('Closed · 1'), findsOneWidget);
  });

  test('lead helpers', () {
    expect(stageName('quoted'), 'Quote sent');
    expect(leadOverdue({'status': 'new', 'next_followup': '2020-01-01'}), true);
    expect(leadOverdue({'status': 'converted', 'next_followup': '2020-01-01'}), false);
    expect(plusDays(0), todayYmd());
  });

  testWidgets('the admin panel lists requests and clients', (t) async {
    final s = await session(admin);
    await t.binding.setSurfaceSize(const Size(420, 1200));
    await t.pumpWidget(MaterialApp(theme: Tk.theme(), home: AdminWorkspace(s)));
    await t.pump(const Duration(milliseconds: 100));
    await t.pump(const Duration(milliseconds: 100));
    for (final x in ['Requests', 'Clients', 'Leads', 'Money', 'More']) {
      expect(find.text(x), findsWidgets, reason: x);
    }
    expect(find.text('Beta Foods'), findsOneWidget);
    expect(find.text('Payment submitted'), findsOneWidget);
    await t.tap(find.text('Clients').last);
    await t.pump(const Duration(milliseconds: 100));
    expect(find.text('Acme Cafe'), findsOneWidget);
  });

  test('the quote maths match the database', () {
    final q = {
      'items': [{'key': 'pos', 'plan': 'month', 'rate': 1090, 'discount': 0, 'gst': 18}],
      'onboarding': {'on': true, 'amount': 1460, 'gst': 0},
      'setup': {'on': false, 'amount': 2190, 'gst': 18},
      'custom': [],
    };
    final r = calcQuote(q, '08');
    expect(r['taxable'], 2550);
    expect(r['intra'], true);
    expect(r['gst'], 196.2);
    expect(r['cgst'], 98.1);
    expect(r['total'], 2746);
    expect(r['round'], -0.2);
    expect(calcQuote(q, '27')['igst'], 196.2);
  });
}
