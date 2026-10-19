import 'package:auzspos/core/giftcard.dart';
import 'package:flutter_test/flutter_test.dart';

/// Pure client-side gift-card lookup/validation, ported from the website's giftSheet() in pay.js.
/// The server's redeem_giftcard() RPC (db/068_pos_rebuild.sql) is the real authority; these functions
/// only decide what the cashier sees before that call is made (code match, expiry, balance-for-the-
/// full-amount, since native pays one bill with one tender -- see home.dart's `_payOnce`).
void main() {
  group('findGiftCard', () {
    test('matches a code case-insensitively, ignoring surrounding whitespace', () {
      final cards = [
        {'code': 'ABCD1234', 'bal': 500},
        {'code': 'wxyz9999', 'bal': 100},
      ];
      expect(findGiftCard(cards, 'abcd1234')!['bal'], 500);
      expect(findGiftCard(cards, '  WXYZ9999  ')!['bal'], 100);
    });

    test('returns null for an empty or unmatched code', () {
      final cards = [{'code': 'ABCD1234', 'bal': 500}];
      expect(findGiftCard(cards, ''), isNull);
      expect(findGiftCard(cards, '   '), isNull);
      expect(findGiftCard(cards, 'NOPE'), isNull);
    });

    test('a card with no code field at all never matches anything', () {
      final cards = [{'bal': 500}];
      expect(findGiftCard(cards, ''), isNull);
    });
  });

  group('giftCardIssue', () {
    test('a card with enough balance and no expiry has no issue', () {
      final card = {'code': 'A', 'bal': 500};
      expect(giftCardIssue(card, 300), isNull);
      expect(giftCardIssue(card, 500), isNull, reason: 'exactly covering the amount due is fine');
    });

    test('a card with insufficient balance for the FULL amount due is refused, even if it has some value', () {
      // Native pays one bill with one tender -- unlike the website, a partial redemption combined
      // with another tender is not supported, so this must be a clear refusal, not a silent partial use.
      final card = {'code': 'A', 'bal': 100};
      final issue = giftCardIssue(card, 300);
      expect(issue, isNotNull);
      expect(issue, contains('Only'));
    });

    test('an expired card is refused even if the balance would otherwise cover it', () {
      final card = {'code': 'A', 'bal': 1000, 'exp': '2020-01-01'};
      final issue = giftCardIssue(card, 300);
      expect(issue, isNotNull);
      expect(issue, contains('expired'));
    });

    test('a card expiring today or in the future is still usable', () {
      final future = DateTime.now().add(const Duration(days: 1));
      final exp = '${future.year}-${future.month.toString().padLeft(2, '0')}-${future.day.toString().padLeft(2, '0')}';
      final card = {'code': 'A', 'bal': 1000, 'exp': exp};
      expect(giftCardIssue(card, 300), isNull);
    });

    test('a missing/blank balance is treated as zero, never as "no limit"', () {
      final card = {'code': 'A'};
      expect(giftCardIssue(card, 1), isNotNull);
    });
  });
}
