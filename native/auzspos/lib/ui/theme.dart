import 'package:flutter/material.dart';

/// Same palette as the website apps (ds/auz.css): warm off-white page, white cards, charcoal text, business colour as accent.
class Tk {
  static const bg = Color(0xFFF5F4F2), card = Colors.white, label = Color(0xFF2E2C2A), label2 = Color(0xA83C3834), line = Color(0x243C342C);
  static const green = Color(0xFF1F8A3D), orange = Color(0xFFA85A00), red = Color(0xFFD70015);
  static Color accent = const Color(0xFF800020);
  static Color get accentText => accent;

  static Color parse(String? hex) {
    if (hex == null) return const Color(0xFF800020);
    final h = hex.replaceAll('#', '');
    if (h.length != 6) return const Color(0xFF800020);
    final v = int.tryParse(h, radix: 16);
    return v == null ? const Color(0xFF800020) : Color(0xFF000000 | v);
  }

  static ThemeData theme() {
    final cs = ColorScheme.fromSeed(seedColor: accent, brightness: Brightness.light).copyWith(primary: accent, onPrimary: Colors.white, surface: bg);
    return ThemeData(
      useMaterial3: true,
      colorScheme: cs,
      scaffoldBackgroundColor: bg,
      appBarTheme: const AppBarTheme(backgroundColor: bg, foregroundColor: label, elevation: 0, scrolledUnderElevation: 0, titleTextStyle: TextStyle(color: label, fontSize: 20, fontWeight: FontWeight.w700)),
      cardTheme: CardThemeData(color: card, elevation: 0, shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16), side: const BorderSide(color: line, width: .5))),
      inputDecorationTheme: InputDecorationTheme(filled: true, fillColor: card, border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: const BorderSide(color: line)), enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: const BorderSide(color: line)), focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide(color: accent, width: 1.5))),
      filledButtonTheme: FilledButtonThemeData(style: FilledButton.styleFrom(minimumSize: const Size(0, 48), shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)), textStyle: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600))),
      outlinedButtonTheme: OutlinedButtonThemeData(style: OutlinedButton.styleFrom(minimumSize: const Size(0, 48), shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)), side: const BorderSide(color: line))),
      navigationBarTheme: NavigationBarThemeData(backgroundColor: const Color(0xEBFAF9F7), indicatorColor: accent.withValues(alpha: .12), labelTextStyle: const WidgetStatePropertyAll(TextStyle(fontSize: 12, fontWeight: FontWeight.w600))),
      chipTheme: ChipThemeData(shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)), side: const BorderSide(color: line), selectedColor: accent.withValues(alpha: .12)),
    );
  }
}
