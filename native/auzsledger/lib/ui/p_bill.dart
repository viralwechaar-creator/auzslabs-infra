import 'package:flutter/material.dart' hide Text;
import '../core/api.dart';
import '../core/calc.dart';
import '../core/session.dart';
import 'ds.dart';
import 'i18n.dart';
import 'mk.dart';
import 'theme.dart';

/// A new purchase bill or expense, posted to the books. Needs a connection (posting is decided by the books).
Future<void> newBill(BuildContext context, LedgerSession s, {bool expense = false}) async {
  await Navigator.push(context, MaterialPageRoute(builder: (_) => BillPage(s, expense: expense)));
}

class BillPage extends StatefulWidget {
  const BillPage(this.s, {this.expense = false, super.key});
  final LedgerSession s;
  final bool expense;
  @override
  State<BillPage> createState() => _BillPageState();
}

class _BillPageState extends State<BillPage> {
  LedgerSession get s => widget.s;
  Map<String, dynamic>? supplier;
  final lines = <Map<String, dynamic>>[];
  final ref = TextEditingController(), note = TextEditingController();
  String pay = 'later'; // later | cash | bank
  bool busy = false, incl = false;

  bool get exp => widget.expense;

  DocCalc _calc() => calcSales([for (final l in lines) {'qty': l['qty'], 'rate': l['rate'], 'tax_rate': l['tax_rate']}], inclusive: incl, org: s.org, party: supplier);

  void _addLine([Map<String, dynamic>? p]) {
    final name = TextEditingController(text: '${p?['name'] ?? ''}'), qty = TextEditingController(text: '1'), rate = TextEditingController(text: p == null ? '' : '${p['avg_cost'] ?? p['purchase_price'] ?? ''}');
    var gst = '${p?['tax_rate'] ?? s.defaultTaxRate}';
    openSheet(context, exp ? 'Expense' : 'Item', (ctx, set) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Fld(exp ? 'What for' : 'Item', name),
          gap(),
          Row(children: [
            if (!exp) Expanded(child: Fld('Quantity', qty, number: true)),
            if (!exp) const SizedBox(width: 10),
            Expanded(child: Fld(exp ? 'Amount' : 'Rate', rate, number: true)),
          ]),
          gap(),
          Sel('GST', gst, [for (final r in s.taxRates) ('${r.toInt() == r ? r.toInt() : r}', '${r.toInt() == r ? r.toInt() : r}%')], (v) => set(() => gst = v)),
        ]), actions: [
      SheetAction('Add', (ctx) async {
        if (name.text.trim().isEmpty || n(rate.text) <= 0 || n(qty.text) <= 0) return false;
        setState(() => lines.add({'product_id': p?['id'], 'description': name.text.trim(), 'hsn': p?['hsn'] ?? '', 'unit': p?['unit'] ?? '', 'qty': exp ? 1 : n(qty.text), 'rate': n(rate.text), 'tax_rate': n(gst)}));
        return true;
      }),
    ]);
  }

  void _pickProduct() {
    final q = TextEditingController();
    openSheet(context, 'Choose a product', (ctx, set) {
      final ql = q.text.toLowerCase();
      final l = s.products.where((p) => p['active'] != false && (ql.isEmpty || '${p['name']} ${p['sku']}'.toLowerCase().contains(ql))).take(30).toList();
      return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        TextField(controller: q, autofocus: true, onChanged: (_) => set(() {}), decoration: InputDecoration(hintText: tr('Search a product or code'), prefixIcon: const Icon(Icons.search))),
        gap(),
        Group([
          Li('Something else', icon: Icons.edit_outlined, tone: Tk.label3, onTap: () {
            Navigator.pop(ctx);
            _addLine();
          }),
          for (final p in l)
            Li('${p['name']}', sub: '${p['sku'] ?? ''}', icon: Icons.inventory_2_outlined, tone: Tk.accent, onTap: () {
              Navigator.pop(ctx);
              _addLine(p);
            }),
        ]),
      ]);
    });
  }

  void _pickSupplier() {
    final q = TextEditingController();
    openSheet(context, 'Supplier', (ctx, set) {
      final ql = q.text.toLowerCase();
      final l = s.parties.where((p) => p['is_walkin'] != true && p['active'] != false && (p['kind'] == 'supplier' || p['kind'] == 'both') && (ql.isEmpty || '${p['name']}'.toLowerCase().contains(ql))).take(40).toList();
      return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        TextField(controller: q, onChanged: (_) => set(() {}), decoration: InputDecoration(hintText: tr('Search by name or phone'), prefixIcon: const Icon(Icons.search))),
        gap(),
        if (l.isEmpty) Hint('No suppliers yet. Add one under More > Parties.') else Group([for (final p in l) Li('${p['name']}', icon: Icons.local_shipping_outlined, tone: Tk.accent, onTap: () {
          Navigator.pop(ctx);
          setState(() => supplier = p);
        })]),
      ]);
    });
  }

  Future<void> _save() async {
    if (lines.isEmpty) return toast(context, tr('Add at least one item'), err: true);
    if (!exp && supplier == null) return toast(context, tr('Choose a supplier'), err: true);
    final c = _calc();
    final acct = pay == 'later' ? null : s.payAccounts(pay).firstOrNull?['id'];
    if (pay != 'later' && acct == null) return toast(context, tr('No cash or bank account is set up'), err: true);
    if (exp && pay == 'later' && supplier == null) return toast(context, tr('Choose where the money was paid from'), err: true);
    setState(() => busy = true);
    try {
      await s.api.rpc('acc_save_document', {'p': {
        'id': null, 'doc_type': exp ? 'expense' : 'bill', 'doc_date': ymd(DateTime.now()), 'due_date': null, 'party_id': supplier?['id'], 'branch_id': s.branches.length == 1 ? s.branches.first['id'] : null,
        'warehouse_id': null, 'place_of_supply': null, 'reverse_charge': false, 'itc_eligible': true, 'price_includes_tax': incl, 'supplier_ref': ref.text.trim().isEmpty ? null : ref.text.trim(), 'supplier_ref_date': null,
        'ref_doc_id': null, 'source_doc_id': null, 'notes': note.text, 'terms': '', 'roundoff': null, 'post': true,
        'lines': [for (final l in lines) {'product_id': l['product_id'], 'description': l['description'], 'hsn': l['hsn'], 'qty': '${l['qty']}', 'unit': l['unit'], 'rate': l['rate'], 'disc_pct': null, 'disc_amt': null, 'tax_rate': '${l['tax_rate']}', 'account_id': null, 'batch_no': '', 'expiry': null, 'warehouse_id': null}],
        'payments': acct == null ? [] : [{'account_id': acct, 'amount': c.total, 'mode': pay == 'cash' ? 'Cash' : 'Bank', 'reference': ''}],
      }});
      if (!mounted) return;
      toast(context, tr('Saved to your books'));
      Navigator.pop(context);
    } on ApiError catch (e) {
      if (mounted) toast(context, e.message, err: true);
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = _calc();
    return SubPage(exp ? 'New expense' : 'New purchase bill', [
      Group([
        Li(supplier == null ? (exp ? 'Supplier (optional)' : 'Choose a supplier') : '${supplier!['name']}', icon: Icons.local_shipping_outlined, tone: Tk.accent, onTap: _pickSupplier),
      ]),
      if (!exp) Pad(TextField(controller: ref, decoration: InputDecoration(labelText: tr('Supplier bill number (optional)')))),
      const SectionLabel('Items'),
      if (lines.isEmpty) emptyBox(Icons.add_shopping_cart, 'No items yet') else Group([
        for (var i = 0; i < lines.length; i++)
          Li('${lines[i]['description']}', sub: exp ? null : '${qtyStr(n(lines[i]['qty']))} × ${inr(n(lines[i]['rate']))} · GST ${qtyStr(n(lines[i]['tax_rate']))}%', value: inr(n(lines[i]['qty']) * n(lines[i]['rate'])), icon: Icons.close, tone: Tk.label3, chevron: false, onTap: () => setState(() => lines.removeAt(i))),
      ]),
      Pad(OutlinedButton.icon(onPressed: exp ? () => _addLine() : _pickProduct, icon: const Icon(Icons.add), label: Text(exp ? 'Add an expense' : 'Add an item'))),
      const SectionLabel('Payment'),
      Pad(Seg<String>(expand: true, items: const [('later', 'Pay later'), ('cash', 'Paid cash'), ('bank', 'Paid bank')], value: pay, onChanged: (v) => setState(() => pay = v))),
      Pad(SwitchListTile(contentPadding: EdgeInsets.zero, title: Text(tr('Prices include GST')), value: incl, onChanged: (v) => setState(() => incl = v))),
      Pad(TextField(controller: note, decoration: InputDecoration(labelText: tr('Note (optional)')))),
      Group([
        Li('Subtotal', value: inr(c.taxable), chevron: false),
        Li('GST', value: inr(c.cgst + c.sgst + c.igst), chevron: false),
        Li('Total', value: inr(c.total), chevron: false, titleColor: Tk.label),
      ]),
    ], bottom: FilledButton(onPressed: busy ? null : _save, child: Text(busy ? tr('Saving…') : tr('Save to books'))));
  }
}
