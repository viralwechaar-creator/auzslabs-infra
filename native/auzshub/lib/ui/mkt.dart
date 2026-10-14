import 'package:flutter/material.dart';

/// The marketing website's own look (site/theme.css): off-white paper, warm ink, wine accent, Inter for text and Space Mono for labels.
/// These do not follow the business colour or dark mode on purpose: the website itself does not.
class M {
  static const bg = Color(0xFFFAF9F7);
  /// The page itself behind the sheets (the website's grey paper with a faint grid).
  static const page = Color(0xFFF6F4F1);
  static const raised = Color(0xFFEFECE8);
  static const ink = Color(0xFF2E2C2A);
  static const dim = Color(0xFF625D58);
  static const faint = Color(0xFF8F8A84);
  static const wine = Color(0xFF800020);
  static const line = Color(0x292E2C2A);
  static const lineSoft = Color(0x0F2E2C2A);
  static const onInk = Color(0xFFFFFFFF);
  static const onInkDim = Color(0xB3FFFFFF);
  static const onInkFaint = Color(0x73FFFFFF);
  static const wineOnInk = Color(0xFFFF8FA3);
  static const shadow = BoxShadow(color: Color(0x4D2E2C2A), blurRadius: 28, spreadRadius: -12, offset: Offset(0, 10));
}

FontWeight _fw(int w) => FontWeight.values[(w ~/ 100).clamp(1, 9) - 1];

/// Inter at a given weight (the font file is variable, so the weight axis is set explicitly).
TextStyle inter(double size, {int w = 400, Color color = M.ink, double ls = 0, double h = 1.4}) =>
    TextStyle(fontFamily: 'Inter', fontSize: size, fontWeight: _fw(w), fontVariations: [FontVariation('wght', w.toDouble())], color: color, letterSpacing: ls, height: h, decoration: TextDecoration.none);

/// Space Mono (the small capital labels and buttons).
TextStyle mono(double size, {bool bold = false, Color color = M.ink, double ls = .5, double h = 1.3}) =>
    TextStyle(fontFamily: 'SpaceMono', fontSize: size, fontWeight: bold ? FontWeight.w700 : FontWeight.w400, color: color, letterSpacing: ls, height: h, decoration: TextDecoration.none);

/// Faint paper grid behind the page (like the website's background).
class PaperGrid extends CustomPainter {
  const PaperGrid();
  @override
  void paint(Canvas c, Size s) {
    final p = Paint()
      ..color = const Color(0x0E2E2C2A)
      ..strokeWidth = 1;
    for (double x = 0; x < s.width; x += 24) {
      c.drawLine(Offset(x, 0), Offset(x, s.height), p);
    }
    for (double y = 0; y < s.height; y += 24) {
      c.drawLine(Offset(0, y), Offset(s.width, y), p);
    }
  }

  @override
  bool shouldRepaint(covariant CustomPainter old) => false;
}
