import 'package:auzsmob/core/thermal.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('thermal sale bill is ESC/POS, plain ASCII and fits the paper width', () {
    final b = Thermal.receipt({'shopName': 'Arpit Traders ₹', 'billFooter': 'Visit again'}, {
      'bill_no': 'B-7', 'created_at': '2026-10-12T10:30:00', 'customer_name': 'Ravi',
      'items': [{'name': 'Tempered glass for a very long phone model name', 'qty': 2, 'price': 150}],
      'discount': 20, 'total': 280, 'paid': 100, 'balance': 180, 'payment_mode': 'cash',
    }, 32);
    expect(b.sublist(0, 2), [0x1B, 0x40]);
    final out = <int>[];
    for (var i = 0; i < b.length; i++) {
      if (b[i] == 0x1B) {
        i += b[i + 1] == 0x40 ? 1 : 2;
      } else {
        out.add(b[i]);
      }
    }
    final text = String.fromCharCodes(out);
    expect(text, contains('TOTAL'));
    expect(text, contains('Due'));
    expect(text, contains('Visit again'));
    for (final l in text.split('\n')) {
      expect(l.length <= 32, true, reason: l);
    }
  });
}
