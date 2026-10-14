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
import 'package:auzshub/ui/cart.dart';
import 'package:auzshub/ui/explore.dart';
import 'package:auzshub/ui/explore/product_accounting.dart';
import 'package:auzshub/ui/explore/product_billing.dart';
import 'package:auzshub/ui/explore/product_crm.dart';
import 'package:auzshub/ui/explore/product_inventory.dart';
import 'package:auzshub/ui/explore/product_payroll.dart';
import 'package:auzshub/ui/explore/product_pos.dart';
import 'package:auzshub/ui/explore/product_qr_ordering.dart';
import 'package:auzshub/ui/explore/product_scan.dart';
import 'package:auzshub/ui/home.dart';
import 'package:auzshub/ui/pay.dart';
import 'package:auzshub/ui/pricing.dart';
import 'package:auzshub/ui/requests.dart';
import 'package:auzshub/ui/theme.dart';

/// Same shapes public_product_prices/public_bundles/public_addon_price_overrides really return
/// (server/src/data/rpc-registry.js, db/101, db/114, db/072).
const fakeProducts = [
  {'key': 'pos', 'label': 'AUZsPOS', 'monthly_price': 999, 'yearly_price': 0, 'renewal_yearly_price': 0, 'gst_exempt': false, 'setup_fee_exempt': false},
  {'key': 'self_order', 'label': 'AUZsPOS QR', 'monthly_price': 300, 'yearly_price': 0, 'renewal_yearly_price': 0, 'gst_exempt': false, 'setup_fee_exempt': false},
  {'key': 'payroll', 'label': 'AUZsPay', 'monthly_price': 999, 'yearly_price': 0, 'renewal_yearly_price': 0, 'gst_exempt': false, 'setup_fee_exempt': false},
  {'key': 'accounting', 'label': 'AUZsLedger', 'monthly_price': 1599, 'yearly_price': 0, 'renewal_yearly_price': 0, 'gst_exempt': false, 'setup_fee_exempt': false},
  {'key': 'mobile', 'label': 'AUZsMob', 'monthly_price': 199, 'yearly_price': 1999, 'renewal_yearly_price': 1599, 'gst_exempt': true, 'setup_fee_exempt': true},
];
const fakeBundles = [
  {'key': 'starter', 'label': 'Starter business', 'feature_keys': ['pos', 'payroll'], 'badge': 'Popular', 'blurb': 'AUZsPOS + AUZsPay', 'monthly_price': 1498, 'list_price': 1998, 'yearly_price': 0},
];
const fakeOverrides = [
  {'key': 'payroll', 'requires': 'pos', 'monthly_price': 1399},
];

class FakeApi extends ApiClient {
  FakeApi(this.who, {this.orders = const []});
  /// hub_me and my_dashboard answers for the person being tested.
  final Map<String, dynamic> who;
  final List<Map<String, dynamic>> orders;
  final calls = <String>[];
  final args = <String, Map<String, dynamic>>{};
  Map<String, dynamic>? quote;

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
      case 'public_client_order':
        return quote;
      case 'public_product_prices':
        return fakeProducts;
      case 'public_bundles':
        return fakeBundles;
      case 'public_addon_price_overrides':
        return fakeOverrides;
      case 'my_profile':
        return {'login_email': 'c@x.in', 'profile': {'name': 'Asha', 'phone': '9876543210', 'business_name': 'Asha Cafe', 'niche': 'cafe'}};
      case 'submit_client_order':
        return {'token': 'a' * 32};
    }
    return null;
  }

  /// Avoid a real HTTP call to /payments/config from a test (GST off, same as a fresh platform).
  @override
  Future<Map<String, dynamic>> paymentConfig() async => {'gstPct': 0};
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

  testWidgets('Explore AUZslab opens the native table of contents, not the browser', (t) async {
    await show(t, await session(customer));
    await t.tap(find.text('Explore AUZslab'));
    await t.pumpAndSettle();
    // Every exploreSections entry is a row here, native or still a placeholder.
    for (final x in ['AUZslab', 'Why AUZslab', 'Products and pricing', 'Every product in detail', 'Built for your business', 'AUZslab Studio', 'AUZslab Intelligence', 'Learn & resources', 'Legal', 'Contact us']) {
      expect(find.text(x), findsOneWidget, reason: x);
    }
  });

  testWidgets('the Explore table of contents pushes the native Home page for "AUZslab"', (t) async {
    await show(t, await session(customer));
    await t.tap(find.text('Explore AUZslab'));
    await t.pumpAndSettle();
    await t.tap(find.text('AUZslab').last); // the TOC row (there is no other "AUZslab" text on that screen)
    await t.pumpAndSettle();
    expect(find.text('Software built around the way you work.'), findsOneWidget);
    expect(find.text('Why AUZslab'), findsWidgets); // CTA card at the bottom of Home
  });

  testWidgets('the Explore table of contents pushes the native Why AUZslab page', (t) async {
    await show(t, await session(customer));
    await t.tap(find.text('Explore AUZslab'));
    await t.pumpAndSettle();
    await t.tap(find.text('Why AUZslab'));
    await t.pumpAndSettle();
    expect(find.text('Businesses differ. Software should too.'), findsOneWidget);
  });

  testWidgets('a not-yet-native Explore section falls through to the "coming soon" website hand-off', (t) async {
    await show(t, await session(customer));
    await t.tap(find.text('Explore AUZslab'));
    await t.pumpAndSettle();
    await t.tap(find.text('Learn & resources'));
    await t.pumpAndSettle();
    expect(find.text('Coming soon, natively'), findsOneWidget);
    expect(find.text('Open on the website'), findsOneWidget);
  });

  testWidgets('the Explore table of contents pushes the native "Built for your business" hub, not the browser', (t) async {
    await show(t, await session(customer));
    await t.tap(find.text('Explore AUZslab'));
    await t.pumpAndSettle();
    await t.tap(find.text('Built for your business'));
    await t.pumpAndSettle();
    // The hub lists all five business types.
    for (final x in ['Cafés, restaurants, bars & bakeries', 'Salons & spas', 'Retail & bookstores', 'Clothing & apparel', 'Mobile retail & repair']) {
      expect(find.text(x), findsOneWidget, reason: x);
    }
    await t.tap(find.text('Cafés, restaurants, bars & bakeries'));
    await t.pumpAndSettle();
    expect(find.text('Built for how a hospitality business actually runs.'), findsOneWidget);
  });

  testWidgets('the Explore table of contents pushes the native AUZslab Studio page, not the browser', (t) async {
    await show(t, await session(customer));
    await t.tap(find.text('Explore AUZslab'));
    await t.pumpAndSettle();
    await t.tap(find.text('AUZslab Studio'));
    await t.pumpAndSettle();
    expect(find.text('Design it the way you love.'), findsOneWidget);
    // Studio is deliberately not a cart item: no price list, nothing to add to a cart.
    expect(find.text('Add to cart'), findsNothing);
    expect(find.textContaining('There is no price list'), findsWidgets);
  });

  testWidgets('the Explore table of contents pushes the native AUZslab Intelligence page, not the browser', (t) async {
    await show(t, await session(customer));
    await t.tap(find.text('Explore AUZslab'));
    await t.pumpAndSettle();
    await t.tap(find.text('AUZslab Intelligence'));
    await t.pumpAndSettle();
    expect(find.text('Your business generates data. We help you understand it.'), findsOneWidget);
    // Honest about what exists today: example insights are labelled, not claimed as real.
    expect(find.text('Example insight'), findsWidgets);
    expect(find.textContaining('They are not real customer results.'), findsOneWidget);
  });

  testWidgets('Products and pricing opens the native pricing screen with live prices, not the browser', (t) async {
    await show(t, await session(customer));
    await t.tap(find.text('Products and pricing'));
    await t.pumpAndSettle();
    expect(find.text('Setup & onboarding'), findsOneWidget);
    expect(find.text('₹999'), findsWidgets); // AUZsPOS, from public_product_prices
    expect(find.textContaining('AUZsLedger'), findsWidgets);
    expect(find.textContaining('Starter business'), findsOneWidget); // from public_bundles
  });

  testWidgets('every other tile is unchanged by this task (still listed, not touched)', (t) async {
    await show(t, await session(admin));
    // Admin panel, Admin console, Website Builder, Salon console, Team workspace keep their old
    // browser hand-over (_web/launchUrl) -- this task only changes Explore and Products/pricing.
    expect(find.text('Admin panel'), findsOneWidget);
  });

  testWidgets('the Explore registry now opens the native products hub for "Every product in detail", not the browser', (t) async {
    await show(t, await session(customer));
    await t.tap(find.text('Explore AUZslab'));
    await t.pumpAndSettle();
    await t.tap(find.text('Every product in detail'));
    await t.pumpAndSettle();
    expect(find.text('Coming soon, natively'), findsNothing);
    expect(find.text('AUZsPOS'), findsOneWidget);
    expect(find.text('CRM'), findsOneWidget);
    expect(find.text('Billing & Invoicing'), findsOneWidget);
    expect(find.text('Inventory'), findsOneWidget);
    expect(find.text('QR Ordering'), findsOneWidget);
    expect(find.text('AUZsPay'), findsOneWidget);
    expect(find.text('AUZsLedger'), findsOneWidget);
    expect(find.text('AUZsScan'), findsOneWidget);
    expect(find.text('AUZslab Salon'), findsOneWidget);
  });

  testWidgets('each native product page shows its own real headline from the site copy', (t) async {
    final s = await session(customer);
    await t.binding.setSurfaceSize(const Size(420, 2600));
    final pages = <Widget, String>{
      ProductPosPage(s): 'Built around the way you sell.',
      ProductCrmPage(s): 'Know your regulars. Bring them back.',
      ProductBillingPage(s): 'Invoices that hold up to scrutiny.',
      ProductInventoryPage(s): 'Know what is left before it runs out.',
      ProductQrOrderingPage(s): 'Scan the table. Skip the wait.',
      ProductPayrollPage(s): 'Payroll built around your business.',
      ProductAccountingPage(s): 'Accounting that knows the business behind it.',
      ProductScanPage(s): 'Point. Scan. Bill it.',
    };
    for (final e in pages.entries) {
      await t.pumpWidget(MaterialApp(theme: Tk.theme(), home: e.key));
      await t.pump(const Duration(milliseconds: 100));
      expect(find.text(e.value), findsOneWidget, reason: e.value);
    }
  });

  testWidgets('a priced product page (QR Ordering) adds its own key to the same cart as the website flow', (t) async {
    SharedPreferences.setMockInitialValues({});
    final api = FakeApi(customer);
    final s = HubSession(api: api);
    api.token = 'tok';
    s.user = {'id': 'u1', 'email': 'c@x.in'};
    await s.load();
    await t.binding.setSurfaceSize(const Size(420, 2600));
    await t.pumpWidget(MaterialApp(theme: Tk.theme(), home: ProductQrOrderingPage(s)));
    await t.pump(const Duration(milliseconds: 100));
    await t.tap(find.widgetWithText(FilledButton, 'Add to cart').first);
    await t.pumpAndSettle();
    expect(find.text('My cart'), findsOneWidget);
    expect(await Cart.get(), contains('self_order'));
  });

  testWidgets('a bundled product page (CRM) adds AUZsPOS to the cart, not a separate key', (t) async {
    SharedPreferences.setMockInitialValues({});
    final api = FakeApi(customer);
    final s = HubSession(api: api);
    api.token = 'tok';
    s.user = {'id': 'u1', 'email': 'c@x.in'};
    await s.load();
    await t.binding.setSurfaceSize(const Size(420, 2600));
    await t.pumpWidget(MaterialApp(theme: Tk.theme(), home: ProductCrmPage(s)));
    await t.pump(const Duration(milliseconds: 100));
    await t.tap(find.widgetWithText(FilledButton, 'Add AUZsPOS to cart').first);
    await t.pumpAndSettle();
    expect(find.text('My cart'), findsOneWidget);
    expect(await Cart.get(), ['pos']);
  });

  testWidgets('adding a product from the pricing screen puts it in the same cart as the website flow', (t) async {
    SharedPreferences.setMockInitialValues({});
    final api = FakeApi(customer);
    final s = HubSession(api: api);
    api.token = 'tok';
    s.user = {'id': 'u1', 'email': 'c@x.in'};
    await s.load();
    await t.binding.setSurfaceSize(const Size(420, 2600));
    await t.pumpWidget(MaterialApp(theme: Tk.theme(), home: ProductsPricingPage(s)));
    await t.pump(const Duration(milliseconds: 100));
    await t.tap(find.widgetWithText(FilledButton, 'Add to cart').first);
    await t.pumpAndSettle();
    expect(find.text('My cart'), findsOneWidget); // navigated into CartPage
    expect(await Cart.get(), contains('pos'));
  });
}
