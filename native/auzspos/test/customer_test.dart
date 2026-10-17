import 'package:auzspos/core/customer.dart';
import 'package:flutter_test/flutter_test.dart';

/// Ports of digits()/custHistory()/netOf()/refundedOf()/loyaltyOf() in the website's pos/core.js,
/// backing the native customerSheet()'s new GSTIN/loyalty-history fields (actions.dart).
void main() {
  group('digitsOnly / isValidGstin', () {
    test('strips everything but digits', () {
      expect(digitsOnly('+91 98765-43210'), '919876543210');
    });
    test('a real-shaped GSTIN (2-digit state code + 13 alnum) is valid', () {
      expect(isValidGstin('27AAAAA0000A1Z5'), isTrue);
    });
    test('wrong length, lowercase, or a non-digit state code is invalid', () {
      expect(isValidGstin('27AAAAA0000A1Z'), isFalse, reason: 'too short');
      expect(isValidGstin('27aaaaa0000a1z5'), isFalse, reason: 'lowercase is refused, matching the website regex exactly');
      expect(isValidGstin('2AAAAA0000A1Z5A'), isFalse, reason: 'state code must be exactly 2 digits');
    });
  });

  group('netOf / refundedOf', () {
    test('net is the bill total minus any refunds', () {
      final o = {'t': {'total': 1000}, 'refunds': [{'amt': 200}, {'amt': 50}]};
      expect(refundedOf(o), 250);
      expect(netOf(o), 750);
    });
    test('no refunds means net equals the full total', () {
      expect(netOf({'t': {'total': 500}}), 500);
    });
  });

  group('custHistory', () {
    final orders = [
      {'id': 'a', 'status': 'paid', 'cust': {'phone': '9876543210'}, 't': {'total': 100}},
      {'id': 'b', 'status': 'due', 'cust': {'phone': '98765-43210'}, 't': {'total': 200}}, // same phone, formatted differently (no country code: digits() does a literal match, same as the website)
      {'id': 'c', 'status': 'open', 'cust': {'phone': '9876543210'}, 't': {'total': 300}}, // not paid/due yet -- excluded
      {'id': 'd', 'status': 'paid', 'cust': {'phone': '1111111111'}, 't': {'total': 400}}, // different customer
      {'id': 'e', 'status': 'paid', 'cust': {'phone': '9876543210'}, 't': {'total': 50}}, // this is the order currently open -- excluded
    ];

    test('matches the same phone across different formatting, excludes open/other-customer/current-order rows', () {
      final hist = custHistory(orders, '9876543210', 'e');
      expect(hist.map((o) => o['id']).toSet(), {'a', 'b'});
    });

    test('a phone under 10 digits never matches anything (avoids matching blank/short phones against each other)', () {
      expect(custHistory(orders, '123', null), isEmpty);
    });
  });

  group('loyaltySummary', () {
    test('visits, lifetime spend and points, excluding the order currently open', () {
      final orders = [
        {'id': 'a', 'status': 'paid', 'cust': {'phone': '9876543210'}, 't': {'total': 500}},
        {'id': 'b', 'status': 'paid', 'cust': {'phone': '9876543210'}, 't': {'total': 700}, 'refunds': [{'amt': 200}]},
        {'id': 'now', 'status': 'open', 'cust': {'phone': '9876543210'}, 't': {'total': 999}},
      ];
      final sum = loyaltySummary(orders, '9876543210', 'now', earnPerRs: 100);
      expect(sum.visits, 2);
      expect(sum.lifetime, 1000); // 500 + (700-200)
      expect(sum.points, 10); // floor(1000/100) - 0 redeemed
    });

    test('previously redeemed points are subtracted, never going negative', () {
      final orders = [
        {'id': 'a', 'status': 'paid', 'cust': {'phone': '9876543210'}, 't': {'total': 100}, 'loyaltyRedeemed': 50},
      ];
      final sum = loyaltySummary(orders, '9876543210', null, earnPerRs: 100);
      expect(sum.points, 0, reason: 'floor(100/100)=1, minus 50 already redeemed, clamped to 0');
    });

    test('a phone with no history at all is zero everywhere, not an error', () {
      final sum = loyaltySummary(const [], '9876543210', null);
      expect(sum.visits, 0);
      expect(sum.lifetime, 0);
      expect(sum.points, 0);
    });
  });

  group('profileToMergeOnSave (customerSheet Save -- regression for a real data-corruption bug found '
      'during integration verification)', () {
    test('when the phone was not changed before saving, reuses the already-loaded profile (no extra lookup)', () {
      var lookups = 0;
      final opened = {'phone': '9876543210', 'tags': ['VIP']};
      final result = profileToMergeOnSave(
        openedPhoneDigits: '9876543210',
        savingPhoneDigits: '9876543210',
        openedProfile: opened,
        lookup: (ph) { lookups++; return null; },
      );
      expect(result, same(opened));
      expect(lookups, 0, reason: 'the common case (phone unchanged) must not need a fresh lookup');
    });

    test('BUG THIS REPRODUCES: when the cashier changes the phone before saving, the ORIGINAL '
        'customer\'s profile must never be carried onto the NEW phone\'s record', () {
      final staleOriginalCustomer = {'phone': '9876543210', 'tags': ['VIP'], 'favorite': true, 'dob': '1990-01-01'};
      final realExistingCustomerAtNewNumber = {'phone': '1111111111', 'tags': ['Regular'], 'favorite': false};
      final result = profileToMergeOnSave(
        openedPhoneDigits: '9876543210',
        savingPhoneDigits: '1111111111', // cashier typed a different number before tapping Save
        openedProfile: staleOriginalCustomer,
        lookup: (ph) => ph == '1111111111' ? realExistingCustomerAtNewNumber : null,
      );
      expect(result, same(realExistingCustomerAtNewNumber), reason: 'must look up the NEW phone\'s own real profile, never reuse the stale one loaded for the original phone');
      expect(result!['tags'], ['Regular'], reason: 'the original VIP customer\'s tags must not bleed onto this unrelated customer');
    });

    test('changing to a phone with NO existing customer looks up null, not the stale profile', () {
      final staleOriginalCustomer = {'phone': '9876543210', 'tags': ['VIP']};
      final result = profileToMergeOnSave(
        openedPhoneDigits: '9876543210',
        savingPhoneDigits: '2222222222',
        openedProfile: staleOriginalCustomer,
        lookup: (ph) => null,
      );
      expect(result, isNull, reason: 'a brand-new customer at the new number starts with nothing from the old one');
    });
  });
}
