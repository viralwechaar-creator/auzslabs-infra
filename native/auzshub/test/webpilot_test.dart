import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:auzshub/core/site.dart';
import 'package:auzshub/core/webflag.dart';
import 'package:auzshub/ui/shell.dart';
import 'package:auzshub/ui/theme.dart';
import 'package:auzshub/ui/webmarketing.dart';
import 'hub_test.dart' show session, customer;

/// Home-page WebView pilot: the flag defaults off, nothing else changes when it is off, and
/// turning it on shows the new widget -- with a graceful fallback (and a way straight back to
/// the native page) when the WebView cannot actually load, exactly as it cannot inside the
/// `flutter test` harness (there is no real platform WebView here). See
/// docs/HUB_WEBVIEW_PILOT.md for what a real device is expected to show instead.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(() async {
    SiteData.use(jsonDecode(File('assets/site/pages.json').readAsStringSync()) as Map<String, dynamic>);
    for (final f in [['Inter', 'assets/fonts/Inter-Variable.ttf'], ['SpaceMono', 'assets/fonts/SpaceMono-Regular.ttf']]) {
      final l = FontLoader(f[0])..addFont(Future.value(ByteData.sublistView(File(f[1]).readAsBytesSync())));
      await l.load();
    }
  });

  tearDown(() {
    // Static, process-wide switch: never let one test's "on" leak into the next.
    WebPilot.homeEnabled.value = false;
  });

  test('the pilot is off by default, and the choice is saved on this phone only', () async {
    SharedPreferences.setMockInitialValues({});
    await WebPilot.load();
    expect(WebPilot.homeEnabled.value, false, reason: 'must default to off with no saved preference');

    await WebPilot.set(true);
    expect(WebPilot.homeEnabled.value, true);

    // A fresh load (e.g. app restart) on the same phone keeps the choice...
    WebPilot.homeEnabled.value = false;
    await WebPilot.load();
    expect(WebPilot.homeEnabled.value, true);

    // ...but a different phone (no saved value) is unaffected -- the switch is per-device, never remote.
    SharedPreferences.setMockInitialValues({});
    await WebPilot.load();
    expect(WebPilot.homeEnabled.value, false);
  });

  testWidgets('with the pilot off (the shipped default), the Home tab is the existing native page, unchanged', (t) async {
    WebPilot.homeEnabled.value = false;
    await t.binding.setSurfaceSize(const Size(420, 4000));
    final s = await session(customer);
    await t.pumpWidget(MaterialApp(theme: Tk.theme(), home: HubShell(s)));
    await t.pump(const Duration(milliseconds: 200));
    expect(find.byType(WebMarketingHome), findsNothing);
    // the native Home renderer's own real website text, same assertion site_test.dart makes
    expect(find.textContaining('Software built', findRichText: true), findsWidgets);
    // every other tab is still reachable and unaffected
    for (final x in ['Products', 'Pricing', 'Menu']) {
      expect(find.text(x), findsWidgets, reason: x);
    }
  });

  testWidgets('turning the pilot on swaps only the Home tab, and a failed load falls back to the native page with one tap', (t) async {
    WebPilot.homeEnabled.value = true;
    await t.binding.setSurfaceSize(const Size(420, 4000));
    final s = await session(customer);
    await t.pumpWidget(MaterialApp(theme: Tk.theme(), home: HubShell(s)));
    await t.pump(const Duration(milliseconds: 50));
    // the WebView widget is now what the Home tab shows...
    expect(find.byType(WebMarketingHome), findsOneWidget);
    // ...and every other tab (Products, Pricing, Menu) is untouched by the flag
    for (final x in ['Products', 'Pricing', 'Menu']) {
      expect(find.text(x), findsWidgets, reason: x);
    }
    // There is no real platform WebView in this test harness, so the pilot's own safety net
    // (a load failure never leaves a blank/stuck screen) is exactly what fires here:
    await t.pump(const Duration(milliseconds: 300));
    expect(find.text('Could not load the live Home page'), findsOneWidget);
    expect(find.text('Try again'), findsOneWidget);
    final fallback = find.text('Use the app’s Home page instead');
    expect(fallback, findsOneWidget);

    await t.tap(fallback);
    await t.pump(const Duration(milliseconds: 50));
    expect(WebPilot.homeEnabled.value, false, reason: 'the fallback button must turn the pilot back off immediately');
    await t.pump(const Duration(milliseconds: 200));
    expect(find.byType(WebMarketingHome), findsNothing);
    expect(find.textContaining('Software built', findRichText: true), findsWidgets, reason: 'the native Home page must reappear with no further action');
  });
}
