import 'package:flutter/material.dart' hide Text;
import '../core/calc.dart';
import '../core/ops.dart';
import '../core/session.dart';
import 'ds.dart';
import 'i18n.dart';
import 'mk.dart';
import 'theme.dart';

/// Dues: money customers owe (udhaar) and money owed to vendors. A vendor's bill can be opened to see which purchases are still unpaid.
class DuesPage extends StatefulWidget {
  const DuesPage(this.s, {super.key});
  final MobSession s;
  @override
  State<DuesPage> createState() => _DuesPageState();
}

class _DuesPageState extends State<DuesPage> {
  MobSession get s => widget.s;
  String? tab;

  @override
  Widget build(BuildContext context) {
    final tabs = <(String, String)>[if (s.feat('customers')) ('customer', 'Customer dues'), if (s.feat('vendors')) ('vendor', 'Vendor dues')];
    tab ??= tabs.isEmpty ? 'customer' : tabs.first.$1;
    final r = s.repo!;
    Widget body;
    if (tab == 'vendor') {
      if (!s.can('mob_reports')) {
        body = emptyBox(Icons.lock_outline, tr('You do not have access to this.'));
      } else {
        final bal = vendorBalances(r.rows('purchases'), r.rows('payments'));
        body = bal.isEmpty
            ? emptyBox(Icons.check_circle_outline, tr('Nothing yet'))
            : Group([
                for (final e in bal.entries)
                  Li('${r.byId('vendors', e.key)?['name'] ?? e.key}', icon: Icons.store_outlined, tone: Tk.orange, value: inr(e.value), onTap: () => _vendorDetail(e.key, e.value)),
              ]);
      }
    } else {
      final pays = r.rows('payments');
      double paidAgainst(String id) => pays.where((p) => p['kind'] == 'customer_due' && p['sale_id'] == id).fold(0.0, (a, p) => a + n(p['amount']));
      final rows = [
        for (final x in r.rows('sales'))
          if ((s.can('mob_reports') || x['staff_id'] == s.user!['id']) && x['voided'] != true && n(x['balance']) > 0) {...x, '_due': (n(x['balance']) - paidAgainst('${x['id']}')).clamp(0, double.infinity)}
      ].where((x) => n(x['_due']) > 0).toList();
      body = rows.isEmpty
          ? emptyBox(Icons.check_circle_outline, tr('Nothing yet'))
          : Group([for (final x in rows) Li('${x['customer_name'] ?? ''}'.isEmpty ? 'Walk-in' : '${x['customer_name']}', sub: '${x['bill_no'] ?? ''}', icon: Icons.person_outline, tone: Tk.orange, value: inr(n(x['_due'])), onTap: () => _settle(context, 'customer_due', {'saleId': x['id']}, n(x['_due'])))]);
    }
    return TabPage('Dues', [
      if (tabs.length > 1) Pad(Seg<String>(expand: true, items: tabs, value: tab!, onChanged: (v) => setState(() => tab = v))),
      body,
    ]);
  }

  void _vendorDetail(String vendorId, double due) {
    final r = s.repo!;
    final v = vendorPurchaseDues(r.rows('purchases'), r.rows('payments'), vendorId);
    final unpaid = v.rows.where((x) => n(x['_due']) > 0.01).toList();
    openSheet(context, '${r.byId('vendors', vendorId)?['name'] ?? ''}', (ctx, set) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Group([
            Li('Total purchased', value: inr(v.totalPurchased), chevron: false),
            Li('Total paid to vendor', value: inr(v.totalPaid), chevron: false),
            Li('Due', value: inr(due), chevron: false),
          ]),
          const SectionLabel('Unpaid purchases'),
          if (unpaid.isEmpty) emptyBox(Icons.check_circle_outline, tr('Paid in full'))
          else
            Group([for (final p in unpaid) Li('${r.byId('items', p['item_id'])?['name'] ?? ''}', sub: '${tr('Qty')} ${p['qty']} × ${inr(n(p['rate']))}', value: inr(n(p['_due'])), icon: Icons.inventory_2_outlined, tone: Tk.accent, chevron: false)]),
          Hint(tr('A payment clears the oldest unpaid purchase first.')),
        ]), actions: [
      SheetAction('Record a payment', (ctx) async {
        Navigator.pop(ctx);
        _settle(context, 'vendor_due', {'vendorId': vendorId}, due);
        return false;
      }),
    ]);
  }

  void _settle(BuildContext c, String kind, Map<String, dynamic> ref, double due) {
    final amt = TextEditingController(text: qtyStr(r2(due)));
    var m = 'cash';
    openSheet(c, 'Record a payment', (ctx, set) => Column(children: [Fld('Amount', amt, number: true, autofocus: true), gap(), Sel('Payment mode', m, [('cash', tr('Cash')), ('upi', tr('UPI')), ('card', tr('Card'))], (v) => m = v)]), actions: [
      SheetAction('Save', (ctx) async {
        if (n(amt.text) == 0) {
          toast(ctx, tr('Enter an amount'), err: true);
          return false;
        }
        final id = newId();
        final p = {'kind': kind, 'saleId': ref['saleId'], 'vendorId': ref['vendorId'], 'amount': n(amt.text), 'method': m};
        await s.repo!.localPush('payments', {'id': id, 'kind': kind, 'sale_id': p['saleId'], 'vendor_id': p['vendorId'], 'amount': p['amount'], 'method': m, 'staff_id': s.user!['id'], 'created_at': nowIso()}, 'mob_push_payment', {'p_id': id, 'p': p});
        if (c.mounted) toast(c, tr('Saved'));
        return true;
      }),
    ]);
  }
}
