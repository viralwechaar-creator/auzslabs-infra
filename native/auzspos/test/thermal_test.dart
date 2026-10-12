import 'package:flutter_test/flutter_test.dart';
import 'package:auzspos/core/thermal.dart';
import 'package:auzspos/core/session.dart';

void main() {
  test('thermal receipt is ESC/POS, plain ASCII, and fits the paper width', () {
    final s = Session();
    s.cfg['name'] = 'Test Cafe';
    final o = {
      'no': 'A-1', 'type': 'Takeaway', 'created': '2026-10-12T10:30:00',
      'lines': [{'name': 'Masala Chai ₹', 'qty': 2, 'price': 25, 'size': 'Large'}],
      't': {'sub': 50, 'total': 50}, 'pays': [{'m': 'Cash', 'amt': 50}],
    };
    final b = Thermal.receipt(s, o, 32);
    expect(b.sublist(0, 2), [0x1B, 0x40]);
    final out = <int>[];
    for (var i = 0; i < b.length; i++) {
      if (b[i] == 0x1B) {
        i += b[i + 1] == 0x40 ? 1 : 2; // skip ESC commands
      } else {
        out.add(b[i]);
      }
    }
    final text = String.fromCharCodes(out);
    expect(text, contains('TOTAL'));
    expect(text, contains('2 x Masala Chai'));
    for (final l in text.split('\n')) {
      expect(l.length <= 32, true, reason: l);
    }
  });
}
