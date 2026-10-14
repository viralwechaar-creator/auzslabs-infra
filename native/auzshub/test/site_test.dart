import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:auzshub/core/orderdata.dart';
import 'package:auzshub/core/session.dart';
import 'package:auzshub/core/site.dart';
import 'package:auzshub/ui/home.dart';
import 'package:auzshub/ui/shell.dart';
import 'package:auzshub/ui/site.dart';
import 'package:auzshub/ui/theme.dart';
import 'hub_test.dart' show FakeApi, session, customer, cafe;

Future<void> pumpPage(WidgetTester t, HubSession s, String name, {bool top = false}) async {
  await t.binding.setSurfaceSize(const Size(420, 14000));
  await t.pumpWidget(MaterialApp(theme: Tk.theme(), home: SitePage(s, name, top: top, key: ValueKey(name))));
  await t.pump();
  await t.pump(const Duration(milliseconds: 100));
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(() => SiteData.use(jsonDecode(File('assets/site/pages.json').readAsStringSync()) as Map<String, dynamic>));

  test('the page data covers every marketing page and no link is left dangling', () {
    final d = jsonDecode(File('assets/site/pages.json').readAsStringSync()) as Map<String, dynamic>;
    expect(d.length, greaterThanOrEqualTo(35));
    final known = d.keys.toSet();
    final web = <String>{};
    void walk(dynamic x) {
      if (x is Map) {
        final h = x['h'];
        if (h is String && h.isNotEmpty) {
          final l = resolveHref(h, known: known);
          if (l.kind == 'web') web.add(h);
        }
        x.values.forEach(walk);
      } else if (x is List) {
        x.forEach(walk);
      }
    }
    walk(d);
    // Only tool pages (payment, invoice, sign-in) may open on the website instead of the app.
    for (final h in web) {
      expect(RegExp(r'^(pay|inv|signup|signin|admin|open|verify-email|confirm-email|checkout|404)').hasMatch(h.replaceAll(RegExp(r'^https://auzslab.in/'), '')), true, reason: h);
    }
  });

  test('links are understood', () {
    final k = {'pos', 'products', 'index', 'contact'};
    expect(resolveHref('pos.html', known: k).kind, 'page');
    expect(resolveHref('products.html#slab-mobile', known: k).anchor, 'slab-mobile');
    expect(resolveHref('cart.html').kind, 'cart');
    expect(resolveHref('signup.html').kind, 'account');
    expect(resolveHref('tel:+919251250829').kind, 'external');
    expect(resolveHref('https://demo.auzslab.in/?tab=pos').kind, 'external');
    expect(resolveHref('https://auzslab.in/pos.html', known: k).page, 'pos');
    expect(resolveHref('#quick-look').kind, 'anchor');
    expect(resolveHref('pay.html?t=abc').kind, 'web');
  });

  test('rupees and bundle matching', () {
    expect(inr(1090), '₹1,090');
    expect(inr(125000), '₹1,25,000');
    final p = PricingData.from([
      {'key': 'pos', 'monthly_price': 1090},
      {'key': 'payroll', 'monthly_price': 590},
      {'key': 'scan', 'monthly_price': 0},
    ], [
      {'feature_keys': ['payroll', 'pos'], 'monthly_price': 1490},
    ], []);
    expect(p.monthly(['pos', 'payroll']), 1490);
    expect(p.monthly(['pos']), 1090);
    expect(p.monthly(['scan']), isNull);
  });

  testWidgets('every page of the website opens and shows its heading', (t) async {
    final d = jsonDecode(File('assets/site/pages.json').readAsStringSync()) as Map<String, dynamic>;
    final s = await session(customer);
    for (final name in d.keys) {
      await pumpPage(t, s, name);
      expect(tester(t), isNull, reason: name);
      final title = (d[name] as Map)['title'] as String;
      expect(find.text(title), findsWidgets, reason: 'app bar of $name');
    }
  });

  testWidgets('the AUZsPOS page shows the website text and adds to the cart', (t) async {
    final s = await session(customer);
    await pumpPage(t, s, 'pos');
    expect(find.text('Built around the way you sell.'), findsOneWidget);
    await t.tap(find.text('Add to cart').first);
    await t.pump();
    expect(await Cart.get(), ['pos']);
    expect(find.text('Added. View cart'), findsWidgets);
  });

  testWidgets('the pricing page shows live prices and the bundles from the database', (t) async {
    final s = await session(customer);
    await pumpPage(t, s, 'pricing');
    await t.pump(const Duration(milliseconds: 200));
    expect(find.text('₹999'), findsWidgets);
    await t.drag(find.byType(ListView).first, const Offset(0, -1400));
    await t.pump();
    await t.drag(find.byType(ListView).first, const Offset(0, -1400));
    await t.pump();
    expect(find.textContaining('Starter business'), findsWidgets);
  });

  testWidgets('the contact page sends the same lead the website sends', (t) async {
    final s = await session(customer);
    await pumpPage(t, s, 'contact');
    await t.drag(find.byType(ListView).first, const Offset(0, -900));
    await t.pump();
    final fields = find.byType(TextField);
    await t.enterText(fields.at(0), 'Asha');
    await t.enterText(fields.at(2), '9876543210');
    await t.tap(find.text('Send').last);
    await t.pump();
    await t.pump();
    final api = s.api as FakeApi;
    expect(api.calls, contains('submit_lead'));
    expect(api.args['submit_lead']!['p_name'], 'Asha');
    expect(api.args['submit_lead']!['p_contact'], '9876543210');
    expect(find.text('Got it.'), findsOneWidget);
  });

  testWidgets('the app opens on the website for a customer and on My apps for a business', (t) async {
    await t.binding.setSurfaceSize(const Size(420, 4000));
    var s = await session(customer);
    await t.pumpWidget(MaterialApp(theme: Tk.theme(), home: HubShell(s)));
    await t.pump(const Duration(milliseconds: 200));
    for (final x in ['Home', 'Products', 'Pricing', 'Menu', 'Account']) {
      expect(find.text(x), findsWidgets, reason: x);
    }
    expect(find.text('Software built around the way you work.'), findsWidgets);
    await t.tap(find.text('Menu').last);
    await t.pump(const Duration(milliseconds: 100));
    expect(find.text('Cafes and restaurants'), findsOneWidget);
    s = await session(cafe);
    await t.pumpWidget(MaterialApp(theme: Tk.theme(), home: HubShell(s, key: UniqueKey())));
    await t.pump(const Duration(milliseconds: 200));
    expect(find.text('Acme Cafe'), findsWidgets);
    expect(find.text('My apps'), findsWidgets);
  });

  testWidgets('the hub tiles Explore AUZslab and Products and pricing open the native website pages', (t) async {
    await t.binding.setSurfaceSize(const Size(420, 3000));
    final s = await session(customer);
    await t.pumpWidget(MaterialApp(theme: Tk.theme(), home: HubHome(s)));
    await t.pump(const Duration(milliseconds: 100));
    await t.tap(find.text('Explore AUZslab'));
    await t.pumpAndSettle();
    expect(find.text('Software built around the way you work.'), findsOneWidget);
    Navigator.of(t.element(find.text('Software built around the way you work.'))).pop();
    await t.pumpAndSettle();
    await t.tap(find.text('Products and pricing'));
    await t.pumpAndSettle();
    expect(find.text('Plans that fit the way you work.'), findsOneWidget);
  });

  test('the menu lists a page that exists for every link', () async {
    final d = jsonDecode(File('assets/site/pages.json').readAsStringSync()) as Map<String, dynamic>;
    for (final g in siteMenu) {
      for (final l in g.links) {
        expect(d.containsKey(l.page), true, reason: l.label);
      }
    }
    expect(productLabels.containsKey('pos'), true);
  });
}

Object? tester(WidgetTester t) => t.takeException();
