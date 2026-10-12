import 'package:flutter/material.dart' hide Text;
import '../core/calc.dart';
import '../core/session.dart';
import 'ds.dart';
import 'i18n.dart';
import 'lv.dart';
import 'mk.dart';
import 'theme.dart';

/// The business at a glance: every figure comes from acc_dashboard (derived from the books).
class HomePage extends StatelessWidget {
  const HomePage(this.s, {required this.go, super.key});
  final LedgerSession s;
  final void Function(int tab) go;
  @override
  Widget build(BuildContext context) {
    return Loader<Map<String, dynamic>>(
      load: () async => Map<String, dynamic>.from(await s.api.rpc('acc_dashboard', {'p': {}}) as Map),
      builder: (ctx, d, reload) {
        final m = d['month'] is Map ? Map<String, dynamic>.from(d['month'] as Map) : const <String, dynamic>{};
        final a = d['alerts'] is Map ? Map<String, dynamic>.from(d['alerts'] as Map) : const <String, dynamic>{};
        final cash = ((d['cash_bank'] as List?) ?? const []).map((e) => Map<String, dynamic>.from(e as Map)).toList();
        final top = ((d['top_products'] as List?) ?? const []).map((e) => Map<String, dynamic>.from(e as Map)).toList();
        final att = <(IconData, String, String, int?)>[
          if (n(a['overdue_invoices']) > 0) (Icons.schedule, '${n(a['overdue_invoices']).toInt()} ${tr('overdue invoices')}', '${inr(n(d['overdue_receivables']), dp: 0)} ${tr('to collect')}', 2),
          if (n(a['bills_due_week']) > 0) (Icons.receipt_long_outlined, '${n(a['bills_due_week']).toInt()} ${tr('bills due this week')}', tr('Pay suppliers on time'), 2),
          if (n(a['drafts']) > 0) (Icons.edit_outlined, '${n(a['drafts']).toInt()} ${tr('drafts')}', tr('Not posted yet'), 2),
          if (n(a['low_stock']) > 0) (Icons.inventory_2_outlined, '${n(a['low_stock']).toInt()} ${tr('items low on stock')}', tr('At or below reorder level'), 3),
        ];
        return TabPage(s.orgName.isEmpty ? 'Home' : s.orgName, [
          Hint(fmtD(DateTime.now().toIso8601String(), weekday: true)),
          Padding(padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6), child: Metric('Sales today', inr(n(d['sales_today']), dp: 0), sub: '${tr('This month')} ${inr(n(m['sales']), dp: 0)}', hero: true)),
          metricGrid([
            Metric('Collected today', inr(n(d['collections_today']), dp: 0)),
            Metric('Purchases today', inr(n(d['purchases_today']), dp: 0)),
            Metric('Expenses today', inr(n(d['expenses_today']), dp: 0)),
            Metric('Profit this month', inr(n(m['profit']), dp: 0), tone: n(m['profit']) < 0 ? Tk.red : Tk.green, sub: m['gross_margin'] != null ? '${m['gross_margin']}% ${tr('gross margin')}' : null),
            Metric('Customers owe you', inr(n(d['receivables']), dp: 0), sub: n(d['overdue_receivables']) > 0 ? '${inr(n(d['overdue_receivables']), dp: 0)} ${tr('overdue')}' : tr('Nothing overdue')),
            Metric('You owe suppliers', inr(n(d['payables']), dp: 0), sub: n(d['overdue_payables']) > 0 ? '${inr(n(d['overdue_payables']), dp: 0)} ${tr('overdue')}' : tr('Nothing overdue')),
            Metric('Stock value', inr(n(d['stock_value']), dp: 0), sub: tr('At cost')),
          ]),
          const SectionLabel('Needs attention'),
          if (att.isEmpty) Group([Li('All clear', sub: 'Nothing needs attention right now.', icon: Icons.check_circle_outline, tone: Tk.green, chevron: false)]) else Group([for (final x in att) Li(x.$2, sub: x.$3, icon: x.$1, tone: Tk.orange, onTap: x.$4 == null ? null : () => go(x.$4!))]),
          if (cash.isNotEmpty) ...[
            const SectionLabel('Cash and bank'),
            Group([for (final c in cash) Li('${c['name']}', value: inr(n(c['balance']), dp: 0), icon: Icons.account_balance_wallet_outlined, tone: Tk.green, chevron: false)]),
          ],
          if (top.isNotEmpty) ...[
            const SectionLabel('Top products, 30 days'),
            Group([for (final p in top) Li('${p['name']}', value: inr(n(p['revenue']), dp: 0), icon: Icons.star_outline, tone: Tk.accent, chevron: false)]),
          ],
        ], onRefresh: reload);
      },
    );
  }
}
