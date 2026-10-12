import 'package:flutter/material.dart';

/// Same tokens as the website POS (ds/auz.css): warm off-white page, white cards, charcoal text, hairlines, the business colour as the one accent.
class Tk {
  static const bg = Color(0xFFF5F4F2), card = Colors.white, card2 = Color(0xFFFAF9F7), label = Color(0xFF2E2C2A);
  static const label2 = Color(0xA83C3834), label3 = Color(0x6B3C3834);
  static const fill = Color(0x1F767068), fill2 = Color(0x14767068), fill3 = Color(0x0B767068);
  static const line = Color(0x243C342C), line2 = Color(0x3D3C342C);
  static const green = Color(0xFF1F8A3D), orange = Color(0xFFA85A00), red = Color(0xFFD70015), blue = Color(0xFF0A64CF), purple = Color(0xFF7B3BBF), teal = Color(0xFF0B7A80);
  static const greenBg = Color(0x2634C759), orangeBg = Color(0x2BFF9500), redBg = Color(0x1FFF3B30), blueBg = Color(0x1F007AFF);
  static Color accent = const Color(0xFF800020);
  static Color get accentText => accent;
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
    final cs = ColorScheme.fromSeed(seedColor: accent, brightness: Brightness.light).copyWith(primary: accent, onPrimary: Colors.white, surface: bg, surfaceContainerHighest: fill2);
    OutlineInputBorder none(Color c) => OutlineInputBorder(borderRadius: BorderRadius.circular(14), borderSide: BorderSide(color: c, width: 0));
    return ThemeData(
      useMaterial3: true,
      brightness: Brightness.light,
      colorScheme: cs,
      scaffoldBackgroundColor: bg,
      dividerColor: line,
      dividerTheme: const DividerThemeData(color: line, thickness: .5, space: .5),
      splashFactory: InkRipple.splashFactory,
      appBarTheme: const AppBarTheme(backgroundColor: Color(0xF5FAF9F7), foregroundColor: label, elevation: 0, scrolledUnderElevation: 0, centerTitle: false, titleTextStyle: TextStyle(color: label, fontSize: 22, fontWeight: FontWeight.w800, letterSpacing: -.3)),
      cardTheme: CardThemeData(color: card, elevation: 0, margin: const EdgeInsets.symmetric(vertical: 4), shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18), side: const BorderSide(color: line, width: .5))),
      listTileTheme: const ListTileThemeData(minVerticalPadding: 10, contentPadding: EdgeInsets.symmetric(horizontal: 16)),
      inputDecorationTheme: InputDecorationTheme(filled: true, fillColor: fill2, contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14), border: none(Colors.transparent), enabledBorder: none(Colors.transparent), focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(14), borderSide: BorderSide(color: accent, width: 2)), hintStyle: const TextStyle(color: label3), labelStyle: const TextStyle(color: label2)),
      filledButtonTheme: FilledButtonThemeData(style: FilledButton.styleFrom(minimumSize: const Size(0, 54), elevation: 0, shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)), textStyle: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700))),
      outlinedButtonTheme: OutlinedButtonThemeData(style: OutlinedButton.styleFrom(minimumSize: const Size(0, 50), foregroundColor: label, backgroundColor: fill, side: BorderSide.none, shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)), textStyle: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700))),
      textButtonTheme: TextButtonThemeData(style: TextButton.styleFrom(foregroundColor: accent, textStyle: const TextStyle(fontWeight: FontWeight.w700))),
      navigationBarTheme: NavigationBarThemeData(backgroundColor: const Color(0xF5FAF9F7), indicatorColor: Colors.transparent, height: 64, elevation: 0, surfaceTintColor: Colors.transparent, labelTextStyle: WidgetStateProperty.resolveWith((s) => TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: s.contains(WidgetState.selected) ? accent : label2)), iconTheme: WidgetStateProperty.resolveWith((s) => IconThemeData(size: 26, color: s.contains(WidgetState.selected) ? accent : label2))),
      chipTheme: ChipThemeData(shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(22)), side: BorderSide.none, backgroundColor: fill, selectedColor: accent, labelStyle: const TextStyle(fontWeight: FontWeight.w600, color: label), secondaryLabelStyle: const TextStyle(fontWeight: FontWeight.w600, color: Colors.white), showCheckmark: false),
      bottomSheetTheme: const BottomSheetThemeData(backgroundColor: bg, surfaceTintColor: Colors.transparent, showDragHandle: true, shape: RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(22)))),
      dialogTheme: DialogThemeData(backgroundColor: card, surfaceTintColor: Colors.transparent, shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(22))),
      snackBarTheme: SnackBarThemeData(behavior: SnackBarBehavior.floating, backgroundColor: label, shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14))),
      switchTheme: SwitchThemeData(trackColor: WidgetStateProperty.resolveWith((s) => s.contains(WidgetState.selected) ? accent : fill)),
    );
  }
}
