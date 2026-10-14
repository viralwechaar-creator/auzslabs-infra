import 'package:flutter/services.dart';
import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:auzshub/core/orderdata.dart';
import 'package:auzshub/core/session.dart';
import 'package:auzshub/core/site.dart';
import 'package:auzshub/ui/home.dart';
import 'package:auzshub/ui/launch.dart';
import 'package:auzshub/ui/mkt.dart';
import 'package:auzshub/ui/sticky.dart';
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
  setUpAll(() async {
    SiteData.use(jsonDecode(File('assets/site/pages.json').readAsStringSync()) as Map<String, dynamic>);
    // the app's own fonts, so line lengths in the test match a real phone
    for (final f in [['Inter', 'assets/fonts/Inter-Variable.ttf'], ['SpaceMono', 'assets/fonts/SpaceMono-Regular.ttf']]) {
      final l = FontLoader(f[0])..addFont(Future.value(ByteData.sublistView(File(f[1]).readAsBytesSync())));
      await l.load();
    }
    final b = FontLoader('SpaceMono')..addFont(Future.value(ByteData.sublistView(File('assets/fonts/SpaceMono-Bold.ttf').readAsBytesSync())));
    await b.load();
  });

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
      expect(find.byType(MktHeader), findsOneWidget, reason: 'header of $name');
      expect(find.byType(SiteFooter), findsOneWidget, reason: 'footer of $name');
    }
  });

  testWidgets('pages scale to phones, folding phones and tablets with no overflow', (t) async {
    final s = await session(customer);
    for (final w in [320.0, 360.0, 412.0, 600.0, 768.0, 1024.0]) {
      await t.binding.setSurfaceSize(Size(w, 4000));
      await t.pumpWidget(MaterialApp(theme: Tk.theme(), home: SitePage(s, 'pos', key: ValueKey('pos$w'))));
      await t.pump(const Duration(milliseconds: 100));
      expect(tester(t), isNull, reason: 'width $w');
      expect(ResponsivePage.scaleFor(w) >= 0.85 && ResponsivePage.scaleFor(w) <= 1.45, true);
    }
    expect(ResponsivePage.scaleFor(780) > ResponsivePage.scaleFor(390), true);
  });

  testWidgets('the AUZsPOS page shows the website text and adds to the cart', (t) async {
    final s = await session(customer);
    await pumpPage(t, s, 'pos');
    expect(find.byWidgetPredicate((w) => w is RichText && w.text.toPlainText().toLowerCase().contains('built around')), findsWidgets);
    await t.tap(find.text('ADD TO CART').first);
    await t.pump();
    expect(await Cart.get(), ['pos']);
    expect(find.text('ADDED. VIEW CART'), findsWidgets);
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
    await t.tap(find.text('SEND').last);
    await t.pump();
    await t.pump();
    final api = s.api as FakeApi;
    expect(api.calls, contains('submit_lead'));
    expect(api.args['submit_lead']!['p_name'], 'Asha');
    expect(api.args['submit_lead']!['p_contact'], '9876543210');
    expect(find.text('Got it.'), findsOneWidget);
  });

  testWidgets('the app opens on the website for a customer and on My apps for a business, with no bottom bar', (t) async {
    await t.binding.setSurfaceSize(const Size(420, 4000));
    var s = await session(customer);
    await t.pumpWidget(MaterialApp(theme: Tk.theme(), home: HubShell(s)));
    await t.pump(const Duration(milliseconds: 200));
    expect(find.byType(NavigationBar), findsNothing);
    // the website's top bar: switch, account pill, menu
    expect(find.byType(MktSwitch), findsOneWidget);
    for (final x in ['ACCOUNT', 'MENU']) {
      expect(find.text(x), findsWidgets, reason: x);
    }
    expect(find.textContaining('Software built', findRichText: true), findsWidgets);
    await t.tap(find.text('MENU'));
    await t.pump(const Duration(milliseconds: 100));
    await t.pump(const Duration(milliseconds: 100));
    expect(find.textContaining('Business types', findRichText: true), findsOneWidget);
    await t.tap(find.textContaining('Business types', findRichText: true));
    await t.pump(const Duration(milliseconds: 100));
    expect(find.text('Cafes and restaurants'), findsOneWidget);
    s = await session(cafe);
    await t.pumpWidget(MaterialApp(theme: Tk.theme(), home: HubShell(s, key: UniqueKey())));
    await t.pump(const Duration(milliseconds: 200));
    expect(find.text('Acme Cafe'), findsWidgets);
    expect(find.byType(NavigationBar), findsNothing);
  });

  testWidgets('a visitor who is not signed in explores first and is only asked to sign in when they choose to', (t) async {
    await t.binding.setSurfaceSize(const Size(420, 4000));
    SharedPreferences.setMockInitialValues({});
    final s = HubSession(api: FakeApi(customer)); // no sign-in
    expect(s.signedIn, false);
    await t.pumpWidget(MaterialApp(theme: Tk.theme(), home: HubShell(s)));
    await t.pump(const Duration(milliseconds: 200));
    // the website home is the first screen; GET STARTED is in its own top bar
    expect(find.textContaining('Software built', findRichText: true), findsWidgets);
    expect(find.text('GET STARTED'), findsOneWidget);
    expect(find.text('Continue with Google'), findsNothing);
    await t.tap(find.text('GET STARTED'));
    await t.pumpAndSettle();
    expect(find.text('Continue with Google'), findsOneWidget);
    expect(find.byType(BackButton), findsOneWidget);
    // the back arrow returns to the website
    await t.tap(find.byType(BackButton));
    await t.pumpAndSettle();
    expect(find.text('Continue with Google'), findsNothing);
    expect(find.text('GET STARTED'), findsOneWidget);
  });

  testWidgets('the opening animation plays in full before the app is built', (t) async {
    await t.pumpWidget(MaterialApp(home: Launch(child: const Text('THE APP'))));
    await t.pump(const Duration(milliseconds: 300));
    expect(find.text('THE APP'), findsNothing);
    await t.pump(const Duration(milliseconds: 1500));
    expect(find.text('THE APP'), findsNothing);
    expect(find.text('All your apps. One place.'), findsOneWidget);
    await t.pump(const Duration(milliseconds: 3000));
    await t.pump();
    expect(find.text('THE APP'), findsOneWidget);
  });

  testWidgets('the sheets stack: each pins near the top and the next one slides over it', (t) async {
    await t.binding.setSurfaceSize(const Size(420, 800));
    final s = await session(customer);
    await t.pumpWidget(MaterialApp(theme: Tk.theme(), home: SitePage(s, 'index', top: true, key: const ValueKey('index'))));
    await t.pump(const Duration(milliseconds: 100));
    final box = t.renderObject<RenderStickySheets>(find.byType(StickySheets));
    List<StickyParentData> kids() {
      final out = <StickyParentData>[];
      for (var c = box.firstChild; c != null; c = (c.parentData! as StickyParentData).nextSibling) {
        out.add(c.parentData! as StickyParentData);
      }
      return out;
    }

    expect(kids().length, greaterThanOrEqualTo(5));
    // at the top nothing is moved
    for (final k in kids()) {
      expect(k.dy, k.offset.dy);
    }
    final heights = <double>[];
    for (var c = box.firstChild; c != null; c = (c.parentData! as StickyParentData).nextSibling) {
      heights.add(c.size.height);
    }
    // scroll to the middle of the page: the first sheet has been left behind but stays pinned (moved down from its place)
    await t.drag(find.byType(ListView), const Offset(0, -2600));
    await t.pump();
    await t.pump();
    final k = kids();
    expect(k[0].dy, greaterThan(k[0].offset.dy));
    // several sheets are held back at once, each inside the page (never past the end of the stack)
    final pinned = [for (var i = 0; i < k.length; i++) if (k[i].sticky && k[i].dy > k[i].offset.dy) i];
    expect(pinned.length, greaterThanOrEqualTo(2));
    final end = box.size.height;
    for (final i in pinned) {
      expect(k[i].dy + heights[i], lessThanOrEqualTo(end + .5));
    }
    // a sheet that has not been reached yet is still in its own place
    expect(k.last.dy, k.last.offset.dy);
  });

  testWidgets('the sheets lie on the website grid paper, the switch makes the pages dark, and the Knock button opens the contact form', (t) async {
    await t.binding.setSurfaceSize(const Size(420, 3000));
    final s = await session(customer);
    await t.pumpWidget(MaterialApp(theme: Tk.theme(), home: SitePage(s, 'index', top: true, key: const ValueKey('index2'))));
    await t.pump(const Duration(milliseconds: 100));
    // grid under the sheets
    expect(find.byWidgetPredicate((w) => w is CustomPaint && w.painter is PaperGrid).evaluate().length, greaterThanOrEqualTo(5));
    expect(find.text("KNOCK, WE'LL ANSWER"), findsOneWidget);
    // dark
    MktDark.on.value = false;
    await t.tap(find.byType(MktSwitch));
    await t.pump(const Duration(milliseconds: 300));
    expect(MktDark.on.value, true);
    expect(M.bg, const Color(0xFF232120));
    await t.tap(find.byType(MktSwitch));
    await t.pump(const Duration(milliseconds: 300));
    expect(MktDark.on.value, false);
    // knock
    await t.tap(find.text("KNOCK, WE'LL ANSWER"));
    await t.pumpAndSettle();
    expect(find.text('TELL US HOW YOUR BUSINESS WORKS'), findsOneWidget);
  });

  testWidgets('the hub tiles Explore AUZslab and Products and pricing open the native website pages', (t) async {
    await t.binding.setSurfaceSize(const Size(420, 3000));
    final s = await session(customer);
    await t.pumpWidget(MaterialApp(theme: Tk.theme(), home: HubHome(s)));
    await t.pump(const Duration(milliseconds: 100));
    await t.tap(find.text('Explore AUZslab'));
    await t.pumpAndSettle();
    expect(find.textContaining('Software built', findRichText: true), findsWidgets);
    Navigator.of(t.element(find.textContaining('Software built', findRichText: true).first)).pop();
    await t.pumpAndSettle();
    await t.tap(find.text('Products and pricing'));
    await t.pumpAndSettle();
    expect(find.textContaining('Plans that fit', findRichText: true), findsWidgets);
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
