import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// The website's light / dark switch (the round switch in its top bar). Starts from what was chosen last, else from the phone.
/// Only the marketing pages follow it, as on the website; the apps behind sign-in have their own Appearance setting.
class MktDark {
  static final ValueNotifier<bool> on = ValueNotifier(false);
  static Future<void> load() async {
    final saved = (await SharedPreferences.getInstance()).getString('mkt.theme');
    on.value = saved == null ? WidgetsBinding.instance.platformDispatcher.platformBrightness == Brightness.dark : saved == 'dark';
  }

  static Future<void> toggle() async {
    on.value = !on.value;
    await (await SharedPreferences.getInstance()).setString('mkt.theme', on.value ? 'dark' : 'light');
  }
}

/// The marketing website's own look (site/theme.css): off-white paper, warm ink, wine accent, Inter for text and Space Mono for labels.
/// Light and dark use the website's own two token sets; neither follows the business colour.
class M {
  static bool get d => MktDark.on.value;
  static Color get bg => d ? const Color(0xFF232120) : const Color(0xFFFAF9F7);
  /// The page itself behind the sheets (the website's paper with a faint grid).
  static Color get page => d ? const Color(0xFF232120) : const Color(0xFFF6F4F1);
  static Color get raised => d ? const Color(0xFF2D2B29) : const Color(0xFFEFECE8);
  /// White cards on the website; the raised tone in the dark theme.
  static Color get card => d ? const Color(0xFF2D2B29) : Colors.white;
  static Color get ink => d ? const Color(0xFFF2F2F0) : const Color(0xFF2E2C2A);
  /// The fixed dark colour (the website's --ink-solid): footer, menu and dark sheets stay dark in both themes.
  static const inkBg = Color(0xFF2E2C2A);
  static Color get dim => d ? const Color(0xFFB8B8B6) : const Color(0xFF625D58);
  static Color get faint => d ? const Color(0xFF7A7A78) : const Color(0xFF8F8A84);
  static Color get wine => d ? const Color(0xFFA3324F) : const Color(0xFF800020);
  static Color get line => d ? const Color(0x29FFFFFF) : const Color(0x292E2C2A);
  static Color get lineSoft => d ? const Color(0x12FFFFFF) : const Color(0x0F2E2C2A);
  static const onInk = Color(0xFFFFFFFF);
  static const onInkDim = Color(0xB3FFFFFF);
  static const onInkFaint = Color(0x73FFFFFF);
  static const wineOnInk = Color(0xFFFF8FA3);
  static const shadow = BoxShadow(color: Color(0x4D2E2C2A), blurRadius: 28, spreadRadius: -12, offset: Offset(0, 10));
  /// The header bar (translucent paper).
  static Color get bar => d ? const Color(0xF2232120) : const Color(0xF2F6F4F1);
}

/// The website's pages are light or dark by the switch, whatever the phone's own mode or the app's theme is: form fields, drop-downs,
/// buttons and selection handles inside a marketing page take their colours from here.
ThemeData marketingTheme() {
  final dark = M.d;
  final br = dark ? Brightness.dark : Brightness.light;
  final base = ThemeData(
    useMaterial3: true,
    brightness: br,
    fontFamily: 'Inter',
    colorScheme: ColorScheme.fromSeed(seedColor: M.wine, brightness: br).copyWith(primary: M.wine, onPrimary: Colors.white, surface: M.card, onSurface: M.ink),
    scaffoldBackgroundColor: M.page,
    canvasColor: M.card,
  );
  OutlineInputBorder border(Color c, [double w = 1]) => OutlineInputBorder(borderRadius: BorderRadius.circular(14), borderSide: BorderSide(color: c, width: w));
  return base.copyWith(
    textTheme: base.textTheme.apply(bodyColor: M.ink, displayColor: M.ink),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: dark ? const Color(0xFF2D2B29) : const Color(0xFFF7F5F2),
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      labelStyle: inter(15, color: M.dim),
      floatingLabelStyle: inter(14, color: M.wine, w: 600),
      hintStyle: inter(15, color: M.faint),
      helperStyle: inter(12, color: M.faint),
      border: border(M.line),
      enabledBorder: border(M.line),
      focusedBorder: border(M.wine, 1.6),
    ),
    textSelectionTheme: TextSelectionThemeData(cursorColor: M.wine),
  );
}

FontWeight _fw(int w) => FontWeight.values[(w ~/ 100).clamp(1, 9) - 1];

/// Inter at a given weight (the font file is variable, so the weight axis is set explicitly).
TextStyle inter(double size, {int w = 400, Color? color, double ls = 0, double h = 1.4}) =>
    TextStyle(fontFamily: 'Inter', fontSize: size, fontWeight: _fw(w), fontVariations: [FontVariation('wght', w.toDouble())], color: color ?? M.ink, letterSpacing: ls, height: h, decoration: TextDecoration.none);

/// Space Mono (the small capital labels and buttons).
TextStyle mono(double size, {bool bold = false, Color? color, double ls = .5, double h = 1.3}) =>
    TextStyle(fontFamily: 'SpaceMono', fontSize: size, fontWeight: bold ? FontWeight.w700 : FontWeight.w400, color: color ?? M.ink, letterSpacing: ls, height: h, decoration: TextDecoration.none);

/// Faint paper grid behind the page (like the website's background).
class PaperGrid extends CustomPainter {
  PaperGrid() : dark = M.d;
  final bool dark;
  @override
  void paint(Canvas c, Size s) {
    final p = Paint()
      ..color = dark ? const Color(0x12FFFFFF) : const Color(0x0F2E2C2A)
      ..strokeWidth = 1;
    for (double x = 0; x < s.width; x += 24) {
      c.drawLine(Offset(x, 0), Offset(x, s.height), p);
    }
    for (double y = 0; y < s.height; y += 24) {
      c.drawLine(Offset(0, y), Offset(s.width, y), p);
    }
  }

  @override
  bool shouldRepaint(covariant PaperGrid old) => old.dark != dark;
}
