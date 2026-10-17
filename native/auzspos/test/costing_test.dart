import 'package:auzspos/core/costing.dart';
import 'package:flutter_test/flutter_test.dart';
import 'sync_test.dart' show FakeServer, mk;

/// Food costing / margins, ported from the website's unitCost() (app/public/console/core.js) and the
/// "Food costing" tab of invReport() (app/public/console/p-inventory.js). Pure functions over a
/// Repo, same split as stock_test.dart/wastage_test.dart, so the formulas are directly provable
/// against the website's own arithmetic.
void main() {
  group('unitCost: a plain item with a flat cost and no recipe or combo', () {
    test('falls back to item.cost', () async {
      final repo = mk(FakeServer());
      final item = (await repo.save('item', {'name': 'Bottled Water', 'price': 20, 'cost': 8})).data;
      expect(unitCost(repo, item), 8);
    });

    test('with no cost set at all, it is 0 (never null, never an error)', () async {
      final repo = mk(FakeServer());
      final item = (await repo.save('item', {'name': 'Mystery', 'price': 20})).data;
      expect(unitCost(repo, item), 0);
    });
  });

  group('unitCost: recipe-based items', () {
    test('sums ingredient cost * quantity for every recipe line', () async {
      final repo = mk(FakeServer());
      await repo.save('ing', {'name': 'Milk', 'cost': 40});
      await repo.save('ing', {'name': 'Tea', 'cost': 200});
      final item = (await repo.save('item', {'name': 'Masala Chai', 'price': 30, 'rec': 'Milk:0.1,Tea:0.01'})).data;
      // 40*0.1 + 200*0.01 = 4 + 2 = 6
      expect(unitCost(repo, item), 6);
    });

    test('matches ingredient names case-insensitively, same as the website', () async {
      final repo = mk(FakeServer());
      await repo.save('ing', {'name': 'SUGAR', 'cost': 50});
      final item = (await repo.save('item', {'name': 'Cake', 'price': 90, 'rec': 'sugar:1'})).data;
      expect(unitCost(repo, item), 50);
    });

    test('a recipe line naming an unknown ingredient contributes nothing (never throws)', () async {
      final repo = mk(FakeServer());
      await repo.save('ing', {'name': 'Milk', 'cost': 40});
      final item = (await repo.save('item', {'name': 'Ghost Dish', 'price': 50, 'rec': 'Milk:1,Unicorn Tears:5'})).data;
      expect(unitCost(repo, item), 40);
    });

    test('a recipe line with no quantity at all propagates NaN for that item, matching the \n       website\'s own unguarded `+x[1]` (no ||1 fallback on a recipe line, unlike a combo line)', () async {
      final repo = mk(FakeServer());
      await repo.save('ing', {'name': 'Milk', 'cost': 40});
      final item = (await repo.save('item', {'name': 'Broken Recipe', 'price': 50, 'rec': 'Milk'})).data; // no ":qty"
      expect(unitCost(repo, item).isNaN, true);
    });

    test('a recipe line with an explicit zero quantity contributes exactly zero (unlike a combo \n       line, where zero falls back to 1)', () async {
      final repo = mk(FakeServer());
      await repo.save('ing', {'name': 'Milk', 'cost': 40});
      final item = (await repo.save('item', {'name': 'Decaf', 'price': 50, 'rec': 'Milk:0'})).data;
      expect(unitCost(repo, item), 0);
    });
  });

  group('unitCost: combo items', () {
    test('sums the unitCost of each named component item, scaled by its combo quantity', () async {
      final repo = mk(FakeServer());
      await repo.save('ing', {'name': 'Rice', 'cost': 5});
      final biryani = (await repo.save('item', {'name': 'Chicken Biryani', 'price': 180, 'rec': 'Rice:20'})).data; // cost 100
      await repo.save('item', {'name': 'Coke', 'price': 40, 'cost': 15});
      final combo = (await repo.save('item', {'name': 'Biryani Combo', 'price': 200, 'combo': true, 'comboText': 'Chicken Biryani:1, Coke:1'})).data;
      expect(unitCost(repo, biryani), 100);
      expect(unitCost(repo, combo), 115, reason: '100 (1x biryani) + 15 (1x coke)');
    });

    test('a combo line with an explicit zero quantity falls back to 1, unlike a recipe line \n       (JS `+x[1]||1`: a literal 0 is falsy)', () async {
      final repo = mk(FakeServer());
      await repo.save('item', {'name': 'Coke', 'price': 40, 'cost': 15});
      final combo = (await repo.save('item', {'name': 'Odd Combo', 'price': 50, 'combo': true, 'comboText': 'Coke:0'})).data;
      expect(unitCost(repo, combo), 15, reason: 'the zero quantity is treated as 1, not 0');
    });

    test('a combo line with no quantity at all also falls back to 1', () async {
      final repo = mk(FakeServer());
      await repo.save('item', {'name': 'Coke', 'price': 40, 'cost': 15});
      final combo = (await repo.save('item', {'name': 'Bare Combo', 'price': 50, 'combo': true, 'comboText': 'Coke'})).data;
      expect(unitCost(repo, combo), 15);
    });

    test('matches component item names case-insensitively', () async {
      final repo = mk(FakeServer());
      await repo.save('item', {'name': 'COKE', 'price': 40, 'cost': 15});
      final combo = (await repo.save('item', {'name': 'Combo', 'price': 50, 'combo': true, 'comboText': 'coke:1'})).data;
      expect(unitCost(repo, combo), 15);
    });

    test('a combo line naming an unknown item contributes nothing', () async {
      final repo = mk(FakeServer());
      final combo = (await repo.save('item', {'name': 'Combo', 'price': 50, 'combo': true, 'comboText': 'Nothing Burger:1'})).data;
      expect(unitCost(repo, combo), 0);
    });

    test('a combo of combos recurses correctly (nested combos, matching the website\'s own \n       recursive unitCost(ci) call)', () async {
      final repo = mk(FakeServer());
      await repo.save('item', {'name': 'Coke', 'price': 40, 'cost': 15});
      await repo.save('item', {'name': 'Fries', 'price': 60, 'cost': 20});
      final innerCombo = (await repo.save('item', {'name': 'Drink + Fries', 'price': 90, 'combo': true, 'comboText': 'Coke:1, Fries:1'})).data; // cost 35
      final outerCombo = (await repo.save('item', {'name': 'Mega Combo', 'price': 150, 'combo': true, 'comboText': 'Drink + Fries:2'})).data;
      expect(unitCost(repo, innerCombo), 35);
      expect(unitCost(repo, outerCombo), 70, reason: '2x the inner combo\'s own unitCost of 35');
    });
  });

  group('unitCost: combo takes priority over a recipe on the same item, matching the website\'s \n       own if/else-if order', () {
    test('an item marked combo with comboText ignores its own rec field entirely', () async {
      final repo = mk(FakeServer());
      await repo.save('ing', {'name': 'Milk', 'cost': 9999});
      await repo.save('item', {'name': 'Coke', 'price': 40, 'cost': 15});
      final item = (await repo.save('item', {'name': 'Weird Item', 'price': 50, 'combo': true, 'comboText': 'Coke:1', 'rec': 'Milk:1'})).data;
      expect(unitCost(repo, item), 15, reason: 'the combo branch wins; the rec field is never consulted');
    });
  });

  group('marginPct / costPct', () {
    test('marginPct rounds (price-cost)/price*100 to the nearest whole percent', () {
      expect(marginPct(100, 40), 60);
      expect(marginPct(100, 33), 67, reason: '67.0 rounds to 67');
    });

    test('costPct rounds cost/price*100 to the nearest whole percent', () {
      expect(costPct(100, 40), 40);
    });

    test('costPct with a price of zero is +infinity, matching the website\'s own unguarded \n       division (JS cost/0*100), not a crash in either language', () {
      expect(costPct(0, 40).isInfinite, true);
    });
  });

  group('costingRows: the Food costing report tab', () {
    test('only items with a recipe or a nonzero cost, and a positive computed unitCost, are listed', () async {
      final repo = mk(FakeServer());
      await repo.save('ing', {'name': 'Milk', 'cost': 40});
      await repo.save('item', {'name': 'Costed', 'price': 50, 'cost': 20}); // included
      await repo.save('item', {'name': 'Recipe item', 'price': 60, 'rec': 'Milk:0.5'}); // included, cost 20
      await repo.save('item', {'name': 'No cost at all', 'price': 30}); // excluded: no rec, no cost
      await repo.save('item', {'name': 'Zero cost', 'price': 30, 'cost': 0}); // excluded: cost falsy, no rec
      await repo.save('item', {'name': 'Recipe to nowhere', 'price': 30, 'rec': 'Unicorn Tears:1'}); // excluded: computed cost is 0

      final rows = costingRows(repo);
      expect(rows.map((r) => r.item['name']).toSet(), {'Costed', 'Recipe item'});
    });

    test('sorts ascending by margin FRACTION (thinnest margin first), matching the website\'s own \n       sort key -- not the rounded percent shown in the UI', () async {
      final repo = mk(FakeServer());
      await repo.save('item', {'name': 'Thin margin', 'price': 100, 'cost': 90}); // margin 0.10
      await repo.save('item', {'name': 'Fat margin', 'price': 100, 'cost': 20}); // margin 0.80
      await repo.save('item', {'name': 'Mid margin', 'price': 100, 'cost': 50}); // margin 0.50

      final rows = costingRows(repo);
      expect(rows.map((r) => r.item['name']), ['Thin margin', 'Mid margin', 'Fat margin']);
    });

    test('an empty catalog returns an empty list, not an error', () async {
      final repo = mk(FakeServer());
      expect(costingRows(repo), isEmpty);
    });

    test('CostRow exposes price and the unrounded margin fraction for display + sorting', () async {
      final repo = mk(FakeServer());
      final item = (await repo.save('item', {'name': 'Half off', 'price': 100, 'cost': 50})).data;
      final row = CostRow(item, unitCost(repo, item));
      expect(row.price, 100);
      expect(row.marginFraction, 0.5);
    });
  });

  group('margins: the Dashboard "Business Health" card\'s per-item list, ported verbatim from \n       the website\'s own margins() in p-dashboard.js', () {
    test('only items with a positive computed cost AND a positive price are included', () async {
      final repo = mk(FakeServer());
      await repo.save('item', {'name': 'Costed', 'price': 50, 'cost': 20}); // included: margin 60
      await repo.save('item', {'name': 'No cost', 'price': 30}); // excluded: cost is 0
      await repo.save('item', {'name': 'No price', 'price': 0, 'cost': 5}); // excluded: price is 0
      final mg = margins(repo);
      expect(mg.map((m) => m.name), ['Costed']);
      expect(mg.first.marginPct, 60);
    });

    test('margin is rounded to 2 decimals (website\'s r2), not a whole percent', () async {
      final repo = mk(FakeServer());
      await repo.save('item', {'name': 'Thirds', 'price': 30, 'cost': 10}); // (30-10)/30*100 = 66.666...
      final mg = margins(repo);
      expect(mg.first.marginPct, 66.67);
    });

    test('an empty catalog returns an empty list, not an error', () async {
      final repo = mk(FakeServer());
      expect(margins(repo), isEmpty);
    });
  });

  group('businessHealth: average margin vs. the configured target', () {
    test('returns null when no item has both a cost and a price (nothing to show)', () async {
      final repo = mk(FakeServer());
      await repo.save('item', {'name': 'No cost', 'price': 30});
      expect(businessHealth(repo, 70), isNull);
    });

    test('averages every item\'s margin and counts how many fall below the target', () async {
      final repo = mk(FakeServer());
      await repo.save('item', {'name': 'A', 'price': 100, 'cost': 10}); // margin 90
      await repo.save('item', {'name': 'B', 'price': 100, 'cost': 50}); // margin 50
      final bh = businessHealth(repo, 70)!;
      expect(bh.total, 2);
      expect(bh.avg, 70);
      expect(bh.below, 1, reason: 'only B (margin 50) is below the 70 target');
      expect(bh.target, 70);
    });

    test('the default target of 70 is passed in by the caller, not hardcoded here', () async {
      final repo = mk(FakeServer());
      await repo.save('item', {'name': 'A', 'price': 100, 'cost': 50}); // margin 50
      expect(businessHealth(repo, 40)!.below, 0, reason: 'margin 50 is not below a target of 40');
      expect(businessHealth(repo, 60)!.below, 1, reason: 'margin 50 IS below a target of 60');
    });
  });
}
