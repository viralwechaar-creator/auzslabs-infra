// Food costing / margins, ported from the website's unitCost() (app/public/console/core.js) and the
// "Food costing" tab of invReport() (app/public/console/p-inventory.js, the final, unnamed-tab
// fallback branch of that function -- there is no `if(tab=='cost')` guard, it is simply what runs
// when none of the earlier tab checks match). No new record field, kind or contract: this reads
// `item.rec` / `item.combo` / `item.comboText` / `item.cost` / `item.price` and `ing.cost`, all
// already written by the existing menu editor (admin.dart) and already read by stock.dart for sale
// depletion.
//
// unitCost() is read verbatim from the website, including two small asymmetries between its combo
// and recipe branches that are easy to miss and are replicated here on purpose, not "fixed":
//   - A combo line's quantity falls back to 1 when it is zero or fails to parse (JS `+x[1]||1`: a
//     literal 0 is falsy in JS, so `qty:0` in a combo line silently becomes `qty:1`). A recipe line's
//     quantity has NO such fallback (`+x[1]` alone) -- a missing/unparseable quantity there produces
//     NaN, which then poisons the whole sum for that item (JS `a+NaN` is NaN for every later term,
//     same as Dart `num+double.nan`). Both behaviors are copied exactly.
//   - The combo branch RECURSES into unitCost() for each component item (a combo of combos is
//     possible and, as on the website, is not guarded against a reference cycle -- that limitation
//     is shared with the website, not introduced here).
// This file never re-implements the recipe-string parser already in stock.dart's deduRecipe()/dedu()
// as a shared helper: this codebase's own convention (see CLAUDE.md "no shared JS modules" for the
// website, mirrored here) is that each file keeps the small parsing it needs rather than reaching
// across files for it, and stock.dart's own combo-quantity fallback already differs slightly from the
// website's (it defaults an unparseable qty to 1 but keeps an explicit 0 as 0) -- reusing it here
// would have imported that difference into a feature whose only job is matching the website's own
// unitCost() precisely.
import 'repo.dart';

/// Parses one "Name:qty" segment the way the website's unitCost() parses a combo line: the name is
/// trimmed and matched case-insensitively; the quantity is read with a JS-`+x[1]||1`-equivalent
/// fallback -- zero, missing or unparseable all become 1.
({String name, num qty}) _comboPart(String part) {
  final bits = part.split(':');
  final name = bits.first.trim();
  final raw = bits.length > 1 ? num.tryParse(bits[1].trim()) : null;
  final qty = (raw == null || raw == 0) ? 1 : raw;
  return (name: name, qty: qty);
}

/// Parses one "Name:qty" segment the way the website's unitCost() parses a RECIPE line: no fallback
/// on the quantity -- a line with no parseable quantity contributes NaN (matching the website's own
/// `+x[1]` with no `||` guard), which then poisons the rest of that item's cost sum, exactly as it
/// does there.
({String name, num qty}) _recipePart(String part) {
  final bits = part.split(':');
  final name = bits.first.trim();
  final qty = bits.length > 1 ? (num.tryParse(bits[1].trim()) ?? double.nan) : double.nan;
  return (name: name, qty: qty);
}

/// The cost to make/stock one unit of [item] -- a combo's components' own unitCost (recursive), else
/// a recipe's ingredient costs, else the item's own flat `cost` field. Matches unitCost() exactly,
/// including its rounding (2 decimals) and its lack of a guard against a malformed recipe line (see
/// file header).
num unitCost(Repo repo, Map<String, dynamic> item) {
  final comboText = '${item['comboText'] ?? ''}';
  if (item['combo'] == true && comboText.isNotEmpty) {
    num sum = 0;
    for (final part in comboText.split(',')) {
      final p = _comboPart(part);
      if (p.name.isEmpty) continue;
      final ci = repo.of('item').where((x) => '${x['name'] ?? ''}'.toLowerCase() == p.name.toLowerCase()).firstOrNull;
      sum += ci == null ? 0 : unitCost(repo, ci) * p.qty;
    }
    return _r2(sum);
  }
  final rec = '${item['rec'] ?? ''}';
  if (rec.isNotEmpty) {
    num sum = 0;
    for (final part in rec.split(',')) {
      final p = _recipePart(part);
      final g = repo.of('ing').where((x) => '${x['name'] ?? ''}'.toLowerCase() == p.name.toLowerCase()).firstOrNull;
      sum += g == null ? 0 : ((g['cost'] ?? 0) as num) * p.qty;
    }
    return _r2(sum);
  }
  return ((item['cost'] ?? 0) as num);
}

num _r2(num n) => (n.toDouble() * 100).roundToDouble() / 100;

/// Margin as a whole-number percent of price: round((price-cost)/price*100). Matches the website's
/// own rounding (Math.round, not r2) exactly. Callers decide when a result is meaningful (the
/// website only shows this when price > 0 and cost > 0, e.g. the Recipes page's "Avg. margin" KPI).
int marginPct(num price, num cost) => ((price - cost) / price * 100).round();

/// Cost as a whole-number percent of price: round(cost/price*100). Matches the website's "Food
/// costing" table's own Cost% column exactly, including its lack of a zero-price guard: dividing by
/// a price of 0 produces +/-infinity, same as the website's own `cost/0*100` in JavaScript, not a
/// crash in either language.
double costPct(num price, num cost) => (cost / price * 100).roundToDouble();

/// One row of the "Food costing" report tab: an item, its unitCost and its margin fraction (NOT a
/// rounded percent -- used only for sorting, matching the website's own sort key, which compares the
/// raw fraction before any Math.round happens for display).
class CostRow {
  CostRow(this.item, this.cost);
  final Map<String, dynamic> item;
  final num cost;
  num get price => (item['price'] ?? 0) as num;
  num get marginFraction => (price - cost) / price;
}

/// The Food costing report tab, ported from invReport()'s final (unnamed/default) branch exactly:
/// every item with a recipe or a flat cost, whose computed unitCost is > 0, sorted ascending by
/// margin FRACTION (thinnest margins first) -- not by the rounded percent shown in the UI.
List<CostRow> costingRows(Repo repo) {
  final rows = <CostRow>[];
  for (final item in repo.of('item')) {
    final rec = '${item['rec'] ?? ''}';
    final hasCost = ((item['cost'] ?? 0) as num) != 0;
    if (rec.isEmpty && !hasCost) continue;
    final c = unitCost(repo, item);
    if (c > 0) rows.add(CostRow(item, c));
  }
  rows.sort((a, b) => a.marginFraction.compareTo(b.marginFraction));
  return rows;
}
