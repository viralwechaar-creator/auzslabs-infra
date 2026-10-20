import 'package:flutter/material.dart' hide Text;
import '../core/billing.dart' show r2;
import '../core/wastage.dart';
import 'console.dart' show Kpis, RangeBar;
import 'ds.dart';
import 'home.dart';
import 'kit.dart';
import 'theme.dart';

/// Record a wastage entry for [ing], ported from the website's wasteForm() (app/public/console/
/// p-inventory.js). Two things the website's own Save button does NOT do, added here on purpose
/// (same category of native-only safety improvement as the Purchase Order duplicate-receive guard):
///
/// 1. A review step (askYes) shows the quantity, unit and reason back to the person before anything
///    is written, satisfying "a user must be able to review the quantity and reason before confirming
///    the write" -- the website's own formModal has no such second step, it writes on the first tap.
/// 2. A `submitting` latch (closed over by every onSave call for the lifetime of this one sheet)
///    refuses a second call while the first write is still in flight, so a fast double-tap on Save,
///    or tapping Yes on the review dialog twice, can never deduct stock twice. The website's own
///    formModal has no re-entrancy guard at all (confirmed by reading save2() directly) -- this is a
///    native-only addition, not a divergence in what gets written when there is exactly one real
///    confirm.
Future<void> wasteForm(BuildContext context, HomeState h, Map<String, dynamic> ing) async {
  var submitting = false;
  await formSheet(
    context,
    'Record wastage — ${ing['name']}',
    [
      F('q', 'Quantity wasted (${ing['unit'] ?? 'units'})', type: 'number'),
      F('reason', 'Reason', type: 'select', value: defaultWastageReason, options: [for (final r in wastageReasons) [r, r]]),
    ],
    (v) async {
      if (submitting) return false;
      final qty = v['q'] as num?;
      if (qty == null || qty <= 0) return false;
      final reason = '${v['reason'] ?? defaultWastageReason}'.isEmpty ? defaultWastageReason : '${v['reason']}';
      if (!context.mounted) return false;
      final sure = await askYes(
        context,
        'Record this wastage?',
        'Waste ${r2(qty)} ${ing['unit'] ?? ''} of ${ing['name']} — reason: $reason.\n\nThis reduces stock on hand right away and cannot be undone from here.',
      );
      if (!sure) return false;
      submitting = true;
      // Re-read the ingredient's current copy from the repo rather than trusting the possibly-stale
      // [ing] argument this sheet was opened with -- the same defensive pattern used before applying
      // a Purchase Order receipt.
      final fresh = h.s.repo!.rec('${ing['id']}') ?? ing;
      await recordWastage(h.s.repo!, fresh, qty: qty, reason: reason, by: '${h.s.user?['email'] ?? h.s.user?['id'] ?? ''}');
      h.s.sync();
      return true;
    },
  );
}

/// The Wastage report tab (rep/inventory -> Wastage), ported from invReport('waste'): KPIs
/// (entries, cost of wastage in the selected range) plus a date-and-newest-first list of every
/// entry with its material, quantity, reason and cost -- same fields, same order, as the website's
/// own table.
class WastageTab extends StatefulWidget {
  const WastageTab(this.h, {super.key});
  final HomeState h;
  @override
  State<WastageTab> createState() => _WastageTabState();
}

class _WastageTabState extends State<WastageTab> {
  int days = 30;
  HomeState get h => widget.h;

  @override
  Widget build(BuildContext context) {
    final to = DateTime.now();
    final from = to.subtract(Duration(days: days - 1));
    String dk(DateTime d) => '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
    final rows = wastageRows(h.s.repo!, from: dk(from), to: dk(to));
    final cost = rows.fold<num>(0, (a, w) => a + wastageCost(h.s.repo!, w));
    return ListView(padding: const EdgeInsets.only(bottom: 28), children: [
      RangeBar(days, (v) => setState(() => days = v)),
      Kpis('Cost of wastage', inr(r2(cost)), '${rows.length} entr${rows.length == 1 ? 'y' : 'ies'} in this range', const []),
      if (rows.isEmpty)
        const Empty(Icons.delete_outline, 'No wastage recorded', 'Nothing was recorded as wastage in this range.')
      else
        Group([
          for (final w in rows)
            Li(
              '${w['ing'] ?? ''}',
              sub: '${_fmtD('${w['d'] ?? ''}')} · ${w['reason'] ?? '—'}',
              icon: Icons.delete_outline,
              tone: Tk.red,
              value: '${r2((w['q'] ?? 0) as num)} · ${inr(r2(wastageCost(h.s.repo!, w)))}',
              chevron: false,
            ),
        ]),
    ]);
  }
}

String _fmtD(String ymd) {
  final p = ymd.split('-');
  if (p.length != 3) return ymd;
  const m = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  final mi = int.tryParse(p[1]) ?? 0;
  return '${p[2]} ${mi >= 1 && mi <= 12 ? m[mi] : p[1]}';
}
