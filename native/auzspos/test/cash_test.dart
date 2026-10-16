import 'package:auzspos/core/cash.dart';
import 'package:flutter_test/flutter_test.dart';

/// Pure cash-tendered/change arithmetic, ported from the website's cashSheet() (app/public/pos/pay.js).
/// Kept free of Session/HomeState/widget so the rules (and this doc comment's scenario numbers, matching
/// the mission's own Stage 3 list) are directly provable:
///   1. exact-amount cash payment: zero change
///   2. tender greater than total: correct change
///   3. tender less than total: blocked
///   4. invalid or negative tender: blocked
/// Scenarios 5-8 (UPI/card skip change, cancelled payment, repeated submission, day-close formula) are
/// covered in stock_test.dart / daycash_test.dart, since they need the Repo-level integration, not pure math.
void main() {
  group('1. exact-amount cash payment', () {
    test('tendering exactly the amount due gives zero change and is accepted', () {
      expect(cashChange(250, 250), 0);
      expect(cashTenderOk(250, 250), true);
    });
  });

  group('2. tender greater than total', () {
    test('change is the difference, rounded to paise', () {
      expect(cashChange(300, 250), 50);
      expect(cashChange(500, 123.40), closeTo(376.60, 0.001));
      expect(cashTenderOk(500, 123.40), true);
    });
  });

  group('3. tender less than total: blocked', () {
    test('a short tender is never acceptable from this screen (native takes one tender per bill)', () {
      expect(cashTenderOk(200, 250), false);
      expect(cashChange(200, 250), -50, reason: 'the arithmetic itself still reports the shortfall for display ("Short by ...")');
    });
  });

  group('4. invalid or negative tender: blocked', () {
    test('null, zero and negative amounts are all refused', () {
      expect(cashTenderOk(null, 100), false);
      expect(cashTenderOk(0, 100), false);
      expect(cashTenderOk(-50, 100), false);
    });
  });

  group('quick round-amount buttons', () {
    test('always includes the exact amount, never suggests less than due, at most 5, ascending', () {
      final q = quickCashAmounts(237);
      expect(q.first, 237);
      expect(q.every((v) => v >= 237), true);
      expect(q.length <= 5, true);
      expect(q, List.of(q)..sort());
    });

    test('an already-round amount does not produce duplicate suggestions', () {
      final q = quickCashAmounts(100);
      expect(q.toSet().length, q.length, reason: 'no duplicate values (100 rounds to itself at several denominations)');
    });
  });
}
