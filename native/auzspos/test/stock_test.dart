import 'package:auzspos/core/stock.dart';
import 'package:flutter_test/flutter_test.dart';
import 'sync_test.dart' show FakeServer, mk;

/// Recipe/variant stock depletion on a sale -- confirmed MISSING from native AUZsPOS entirely before this
/// (the website's dedu()/deduVariant() in app/public/pos/core.js had no native port at all). There is no
/// database function, trigger or RPC for this on either platform; it is plain client-side record arithmetic,
/// so this is tested directly against the Repo the same way sync_test.dart/outlet_test.dart already do.
void main() {
  test('dedu deducts a plain item\'s recipe ingredients by the line quantity', () async {
    final repo = mk(FakeServer());
    await repo.save('ing', {'name': 'Milk', 'qty': 1000});
    final tea = await repo.save('item', {'name': 'Tea', 'price': 20, 'rec': 'Milk:100'});
    await dedu(repo, {'lines': [{'id': tea.id, 'qty': 3}]});
    expect(repo.of('ing').single['qty'], 700, reason: '3 x 100ml used');
  });

  test('dedu is case-insensitive on the ingredient name and skips an item with no recipe', () async {
    final repo = mk(FakeServer());
    await repo.save('ing', {'name': 'Sugar', 'qty': 500});
    final cake = await repo.save('item', {'name': 'Cake', 'price': 90, 'rec': 'SUGAR:20'});
    final plain = await repo.save('item', {'name': 'Water', 'price': 10});
    await dedu(repo, {'lines': [{'id': cake.id, 'qty': 2}, {'id': plain.id, 'qty': 5}]});
    expect(repo.of('ing').single['qty'], 460);
  });

  test('a combo item deducts each of its named component items\' own recipe, scaled by the combo quantity', () async {
    final repo = mk(FakeServer());
    await repo.save('ing', {'name': 'Bun', 'qty': 100});
    await repo.save('ing', {'name': 'Fries potato', 'qty': 100});
    await repo.save('item', {'name': 'Burger', 'price': 150, 'rec': 'Bun:1'});
    await repo.save('item', {'name': 'Fries', 'price': 60, 'rec': 'Fries potato:50'});
    final combo = await repo.save('item', {'name': 'Combo', 'price': 180, 'combo': true, 'comboText': 'Burger:1,Fries:2'});
    await dedu(repo, {'lines': [{'id': combo.id, 'qty': 1}]});
    final ings = {for (final g in repo.of('ing')) g['name']: g['qty']};
    expect(ings['Bun'], 99, reason: '1 burger worth of bun');
    expect(ings['Fries potato'], 0, reason: '2 fries x 50 = 100');
  });

  test('deduVariant reduces only the matching size/colour and leaves other variants untouched', () async {
    final repo = mk(FakeServer());
    final shirt = await repo.save('item', {
      'name': 'Shirt',
      'price': 500,
      'variants': [
        {'size': 'M', 'color': 'Blue', 'qty': 10},
        {'size': 'L', 'color': 'Blue', 'qty': 10},
      ],
    });
    await deduVariant(repo, {'lines': [{'id': shirt.id, 'qty': 2, 'variant': {'size': 'M', 'color': 'Blue'}}]});
    final v = (repo.rec(shirt.id)!['variants'] as List).cast<Map>();
    expect(v.firstWhere((x) => x['size'] == 'M')['qty'], 8);
    expect(v.firstWhere((x) => x['size'] == 'L')['qty'], 10, reason: 'the L/Blue variant was never sold');
  });

  test('deduVariant does nothing when the line has no variant or the item has none', () async {
    final repo = mk(FakeServer());
    final tea = await repo.save('item', {'name': 'Tea', 'price': 20});
    await deduVariant(repo, {'lines': [{'id': tea.id, 'qty': 1}]});
    expect(repo.rec(tea.id)!['variants'], isNull);
  });

  test('dedu never lets stock arithmetic throw when an item line references a deleted/unknown item id', () async {
    final repo = mk(FakeServer());
    await dedu(repo, {'lines': [{'id': 'ghost-id', 'qty': 1}]});
    // no throw, nothing to assert beyond "it returned"
  });

  // Repeated-payment / duplicate-depletion risk (explicitly not solved inside dedu()/deduVariant() themselves
  // -- the guard against this lives one layer up, in home.dart's pay(), which checks the order's own
  // already-persisted status before calling these at all). This test documents, honestly, that calling
  // dedu() twice for the identical order DOES deplete stock twice: these functions have no idempotency key
  // of their own, by design (see stock.dart's header comment) -- proving the claim rather than asserting it.
  test('dedu called twice for the same order depletes stock twice -- it has no idempotency key of its own', () async {
    final repo = mk(FakeServer());
    await repo.save('ing', {'name': 'Milk', 'qty': 1000});
    final tea = await repo.save('item', {'name': 'Tea', 'price': 20, 'rec': 'Milk:100'});
    final order = {'lines': [{'id': tea.id, 'qty': 1}]};
    await dedu(repo, order);
    await dedu(repo, order); // simulating pay() being (incorrectly) called twice for the same sale
    expect(repo.of('ing').single['qty'], 800, reason: 'two deductions of 100ml each -- this function alone does not prevent it');
  });

  group('ingAtOutlet (stock transfer destination lookup)', () {
    test('matches an existing raw material at the target outlet, case-insensitively by name', () {
      final ings = [
        {'id': '1', 'name': 'Milk', 'outlet': 'branch2', 'qty': 5},
        {'id': '2', 'name': 'Sugar', 'outlet': 'main', 'qty': 10},
      ];
      expect(ingAtOutlet(ings, 'milk', 'branch2')!['id'], '1');
    });

    test('a record with no outlet field is treated as "main"', () {
      final ings = [{'id': '1', 'name': 'Milk', 'qty': 5}];
      expect(ingAtOutlet(ings, 'Milk', 'main')!['id'], '1');
    });

    test('returns null when the material does not yet exist at that outlet (caller must create it)', () {
      final ings = [{'id': '1', 'name': 'Milk', 'outlet': 'main', 'qty': 5}];
      expect(ingAtOutlet(ings, 'Milk', 'branch2'), isNull);
    });

    test('a name match at the WRONG outlet is never returned', () {
      final ings = [{'id': '1', 'name': 'Milk', 'outlet': 'branch2', 'qty': 5}];
      expect(ingAtOutlet(ings, 'Milk', 'main'), isNull);
    });
  });

  test('adjustReasons offers the same fixed set the website\'s adjustForm() does, for a consistent audit trail', () {
    expect(adjustReasons, ['Count correction', 'Damaged / spoiled', 'Expired', 'Found later', 'Other']);
  });

  group('transferQtyOk (regression -- must validate against CURRENT stock, never a stale open-time snapshot)', () {
    test('a quantity within current on-hand stock is allowed', () {
      expect(transferQtyOk(5, 10), isTrue);
      expect(transferQtyOk(10, 10), isTrue, reason: 'transferring exactly everything on hand is allowed');
    });

    test('more than current on-hand stock is refused, even if an earlier (stale) snapshot had enough', () {
      // The real scenario this guards: the transfer sheet opened when 10 were on hand, but a sale or
      // another transfer has since reduced it to 3 -- re-reading live stock at save time (admin.dart's
      // transfer()) must see 3, not the stale 10, so this must be refused.
      expect(transferQtyOk(10, 3), isFalse);
    });

    test('null, zero and negative quantities are all refused', () {
      expect(transferQtyOk(null, 10), isFalse);
      expect(transferQtyOk(0, 10), isFalse);
      expect(transferQtyOk(-5, 10), isFalse);
    });
  });
}
