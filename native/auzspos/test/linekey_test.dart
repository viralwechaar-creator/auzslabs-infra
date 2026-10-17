import 'package:auzspos/core/linekey.dart';
import 'package:flutter_test/flutter_test.dart';

/// lineKey() decides which cart lines a split/merge should combine -- exact port of lineKey() in the
/// website's pos/core.js. Used by the split-bill "Another table" destination (actions.dart) to merge
/// moved items into an already-open order at the target table without duplicating a line that is
/// really the same item/size/note, and without wrongly combining two genuinely different ones.
void main() {
  test('two lines with the same id, size and note produce the same key', () {
    final a = {'id': 'i1', 'size': 'Large', 'note': 'No onions', 'qty': 1};
    final b = {'id': 'i1', 'size': 'Large', 'note': 'No onions', 'qty': 2};
    expect(lineKey(a), lineKey(b));
  });

  test('a different size or note is a different line, even for the same item id', () {
    final base = {'id': 'i1', 'size': 'Large', 'note': ''};
    expect(lineKey(base), isNot(lineKey({...base, 'size': 'Small'})));
    expect(lineKey(base), isNot(lineKey({...base, 'note': 'Extra spicy'})));
  });

  test('a different item id is always a different line regardless of size/note', () {
    expect(lineKey({'id': 'i1'}), isNot(lineKey({'id': 'i2'})));
  });

  test('missing size/note fields behave the same as empty strings, matching the website', () {
    expect(lineKey({'id': 'i1'}), lineKey({'id': 'i1', 'size': '', 'note': ''}));
  });

  test('two lines are only truly combinable when their key AND price both match -- price is the caller\'s job', () {
    // lineKey() alone says nothing about price; actions.dart's splitSheet() checks `x['price'] == l['price']`
    // in addition to the key, same as the website's `lineKey(x)===lineKey(l) && x.price===l.price`. This
    // test documents that a same-key, different-price pair is NOT distinguished by lineKey() alone.
    final cheap = {'id': 'i1', 'size': '', 'note': '', 'price': 100};
    final discounted = {'id': 'i1', 'size': '', 'note': '', 'price': 80};
    expect(lineKey(cheap), lineKey(discounted), reason: 'same key -- the caller must also compare price before merging');
  });
}
