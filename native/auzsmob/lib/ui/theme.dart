import 'package:flutter/material.dart' hide Text;
import 'package:shared_preferences/shared_preferences.dart';

/// Same tokens as the website POS (ds/auz.css): warm off-white page, white cards, charcoal text, hairlines, the business colour as the one accent.
class Tk {
  static bool dark = false;
  /// 'system' | 'light' | 'dark', saved per phone. [rev] changes whenever the look changes so the app rebuilds.
  static String mode = 'system';
  static final ValueNotifier<int> rev = ValueNotifier(0);
  static Future<void> loadMode() async => mode = (await SharedPreferences.getInstance()).getString('theme') ?? 'system';
  static Future<void> setMode(String m) async {
    mode = m;
    await (await SharedPreferences.getInstance()).setString('theme', m);
    rev.value++;
  }

  static bool resolve(Brightness system) => mode == 'dark' || (mode == 'system' && system == Brightness.dark);
  static Color _p(Color l, Color d) => dark ? d : l;
  static Color get bg => _p(const Color(0xFFF5F4F2), const Color(0xFF111111));
  static Color get card => _p(Colors.white, const Color(0xFF1C1C1E));
  static Color get card2 => _p(const Color(0xFFFAF9F7), const Color(0xFF232325));
  static Color get label => _p(const Color(0xFF2E2C2A), const Color(0xFFF2F0EE));
  static Color get label2 => _p(const Color(0xA83C3834), const Color(0xB3EBE6E0));
  static Color get label3 => _p(const Color(0x6B3C3834), const Color(0x73EBE6E0));
  static Color get fill => _p(const Color(0x1F767068), const Color(0x3D8E8982));
  static Color get fill2 => _p(const Color(0x14767068), const Color(0x2E8E8982));
  static Color get fill3 => _p(const Color(0x0B767068), const Color(0x1F8E8982));
  static Color get line => _p(const Color(0x243C342C), const Color(0x38FFFFFF));
  static Color get line2 => _p(const Color(0x3D3C342C), const Color(0x52FFFFFF));
  static Color get green => _p(const Color(0xFF1F8A3D), const Color(0xFF4CC26A));
  static Color get orange => _p(const Color(0xFFA85A00), const Color(0xFFFF9F0A));
  static Color get red => _p(const Color(0xFFD70015), const Color(0xFFFF6961));
  static Color get blue => _p(const Color(0xFF0A64CF), const Color(0xFF64A8FF));
  static Color get purple => _p(const Color(0xFF7B3BBF), const Color(0xFFBF8CF2));
  static Color get teal => _p(const Color(0xFF0B7A80), const Color(0xFF4DC3CB));
  static Color get greenBg => const Color(0x2634C759);
  static Color get orangeBg => const Color(0x2BFF9500);
  static Color get redBg => const Color(0x1FFF3B30);
  static Color get blueBg => const Color(0x1F007AFF);
  static Color get bar => _p(const Color(0xF5FAF9F7), const Color(0xF51C1C1E));
  static Color accent = const Color(0xFF800020);
  static Color get accentText => dark ? Color.lerp(accent, Colors.white, .35)! : accent;
  static Color get accentSoft => accent.withValues(alpha: .10);

  static Color parse(String? hex) {
    if (hex == null) return const Color(0xFF800020);
    final h = hex.replaceAll('#', '');
    if (h.length != 6) return const Color(0xFF800020);
    final v = int.tryParse(h, radix: 16);
    return v == null ? const Color(0xFF800020) : Color(0xFF000000 | v);
  }

  static List<BoxShadow> get sh1 => const [BoxShadow(color: Color(0x0A281E14), blurRadius: 2, offset: Offset(0, 1))];

  static ThemeData theme() {
    final br = dark ? Brightness.dark : Brightness.light;
    final cs = ColorScheme.fromSeed(seedColor: accent, brightness: br).copyWith(primary: accent, onPrimary: Colors.white, surface: bg, surfaceContainerHighest: fill2);
    OutlineInputBorder none(Color c) => OutlineInputBorder(borderRadius: BorderRadius.circular(14), borderSide: BorderSide(color: c, width: 0));
    return ThemeData(
      useMaterial3: true,
      brightness: br,
      colorScheme: cs,
      scaffoldBackgroundColor: bg,
      dividerColor: line,
      dividerTheme: DividerThemeData(color: line, thickness: .5, space: .5),
      splashFactory: InkRipple.splashFactory,
      appBarTheme: AppBarTheme(backgroundColor: Color(0xF5FAF9F7), foregroundColor: label, elevation: 0, scrolledUnderElevation: 0, centerTitle: false, titleTextStyle: TextStyle(color: label, fontSize: 22, fontWeight: FontWeight.w800, letterSpacing: -.3)),
      cardTheme: CardThemeData(color: card, elevation: 0, margin: const EdgeInsets.symmetric(vertical: 4), shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18), side: BorderSide(color: line, width: .5))),
      listTileTheme: const ListTileThemeData(minVerticalPadding: 10, contentPadding: EdgeInsets.symmetric(horizontal: 16)),
      inputDecorationTheme: InputDecorationTheme(filled: true, fillColor: fill2, contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14), border: none(Colors.transparent), enabledBorder: none(Colors.transparent), focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(14), borderSide: BorderSide(color: accent, width: 2)), hintStyle: TextStyle(color: label3), labelStyle: TextStyle(color: label2)),
      filledButtonTheme: FilledButtonThemeData(style: FilledButton.styleFrom(minimumSize: const Size(0, 54), elevation: 0, shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)), textStyle: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700))),
      outlinedButtonTheme: OutlinedButtonThemeData(style: OutlinedButton.styleFrom(minimumSize: const Size(0, 50), foregroundColor: label, backgroundColor: fill, side: BorderSide.none, shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)), textStyle: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700))),
      textButtonTheme: TextButtonThemeData(style: TextButton.styleFrom(foregroundColor: accent, textStyle: const TextStyle(fontWeight: FontWeight.w700))),
      navigationBarTheme: NavigationBarThemeData(backgroundColor: bar, indicatorColor: Colors.transparent, height: 64, elevation: 0, surfaceTintColor: Colors.transparent, labelTextStyle: WidgetStateProperty.resolveWith((s) => TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: s.contains(WidgetState.selected) ? accent : label2)), iconTheme: WidgetStateProperty.resolveWith((s) => IconThemeData(size: 26, color: s.contains(WidgetState.selected) ? accent : label2))),
      chipTheme: ChipThemeData(shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(22)), side: BorderSide.none, backgroundColor: fill, selectedColor: accent, labelStyle: TextStyle(fontWeight: FontWeight.w600, color: label), secondaryLabelStyle: const TextStyle(fontWeight: FontWeight.w600, color: Colors.white), showCheckmark: false),
      bottomSheetTheme: BottomSheetThemeData(backgroundColor: bg, surfaceTintColor: Colors.transparent, showDragHandle: true, shape: RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(22)))),
      dialogTheme: DialogThemeData(backgroundColor: card, surfaceTintColor: Colors.transparent, shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(22))),
      snackBarTheme: SnackBarThemeData(behavior: SnackBarBehavior.floating, backgroundColor: label, shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14))),
      switchTheme: SwitchThemeData(trackColor: WidgetStateProperty.resolveWith((s) => s.contains(WidgetState.selected) ? accent : fill)),
    );
  }
}
