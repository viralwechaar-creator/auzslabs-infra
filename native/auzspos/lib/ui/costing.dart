import 'package:flutter/material.dart' hide Text;
import '../core/costing.dart';
import 'ds.dart';
import 'home.dart';
import 'kit.dart';
import 'theme.dart';

/// The Food costing report (rep/inventory -> Food costing), ported from invReport()'s final,
/// unnamed-tab branch: every item with a recipe or a flat cost whose computed unitCost is positive,
/// sorted ascending by margin fraction (thinnest margins first) -- same rows, same order, as the
/// website's own table. Columns: price, food cost, margin %, cost %.
class CostingTab extends StatelessWidget {
  const CostingTab(this.h, {super.key});
  final HomeState h;
  @override
  Widget build(BuildContext context) {
    final rows = costingRows(h.s.repo!);
    return ListView(padding: const EdgeInsets.only(bottom: 28), children: [
      const PageHead('Food costing', sub: 'What each item costs to make, and the margin it leaves -- thinnest margins first.'),
      if (rows.isEmpty)
        const Empty(Icons.pie_chart_outline, 'No costed items', 'Add a recipe or a cost price to an item to see it here.')
      else
        Group([
          for (final r in rows)
            Li(
              '${r.item['name']}',
              sub: 'Price ₹${_num(r.price)} · Food cost ₹${_num(r.cost)} · Cost ${_pct(costPct(r.price, r.cost))}',
              icon: Icons.pie_chart_outline,
              tone: _tone(r.marginFraction),
              value: _pct(r.marginFraction * 100),
              chevron: false,
            ),
        ]),
    ]);
  }
}

String _num(num n) => n == n.roundToDouble() ? n.toInt().toString() : n.toStringAsFixed(2);

/// Same display convention as the website's Math.round(...)+'%' -- shows "—" only for a
/// non-finite result (a zero price, matching costPct()'s own JS-equivalent division behavior)
/// rather than printing "Infinity%"/"NaN%" on screen.
String _pct(num v) => v.isFinite ? '${v.round()}%' : '—';

Color _tone(num marginFraction) => !marginFraction.isFinite
    ? Tk.label3
    : marginFraction < 0.2
        ? Tk.red
        : marginFraction < 0.4
            ? Tk.orange
            : Tk.green;
