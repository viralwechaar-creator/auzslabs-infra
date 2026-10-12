import 'package:flutter/material.dart' hide Text;
import '../core/calc.dart';
import '../core/session.dart';
import 'ds.dart';
import 'i18n.dart';
import 'mk.dart';
import 'p_scan.dart';
import 'theme.dart';

/// Products and their stock: search, add, change prices and details, add or take away stock.
class ProductsPage extends StatefulWidget {
  const ProductsPage(this.s, {super.key});
  final ScanSession s;
  @override
  State<ProductsPage> createState() => _ProductsPageState();
}

class _ProductsPageState extends State<ProductsPage> {
  ScanSession get s => widget.s;
  final q = TextEditingController();
  String filter = 'all'; // all | low | out
  int shown = 60;

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: Listenable.merge([s, q]),
      builder: (ctx, _) {
        final ql = q.text.toLowerCase().trim();
        var l = s.products.where((p) => p['active'] != false && (ql.isEmpty || '${p['name']} ${p['sku']} ${p['barcode']}'.toLowerCase().contains(ql))).toList();
        bool track(Map<String, dynamic> p) => p['track_stock'] == true && p['is_service'] != true;
        if (filter == 'out') l = l.where((p) => track(p) && n(p['stock']) <= 0).toList();
        if (filter == 'low') l = l.where((p) => track(p) && n(p['stock']) > 0 && n(p['stock']) <= n(p['reorder_level'])).toList();
        l.sort((a, b) => '${a['name']}'.toLowerCase().compareTo('${b['name']}'.toLowerCase()));
        final value = s.products.where((p) => p['active'] != false && track(p) && n(p['stock']) > 0).fold(0.0, (a, p) => a + n(p['stock']) * n(p['avg_cost']));
        return TabPage('Products', [
          metricGrid([Metric('Products', '${s.products.where((p) => p['active'] != false).length}${s.productsPartial ? '+' : ''}'), Metric('Stock value', inr(value))]),
          Pad(TextField(controller: q, decoration: InputDecoration(hintText: tr('Search a product or code'), prefixIcon: const Icon(Icons.search)))),
          Pad(Seg<String>(expand: true, items: [('all', tr('All')), ('low', tr('Low')), ('out', tr('Out of stock'))], value: filter, onChanged: (v) => setState(() => filter = v))),
          if (l.isEmpty) emptyBox(Icons.inventory_2_outlined, tr('Nothing yet'), tr('Scan a new bar code to add a product.'))
          else
            Group([
              for (final p in l.take(shown))
                Li('${p['name']}', sub: '${p['sku'] ?? ''}${'${p['barcode'] ?? ''}'.isNotEmpty ? ' · ${p['barcode']}' : ''}', value: inr(n(p['sale_price'])), icon: Icons.inventory_2_outlined, tone: Tk.accent, chevron: false,
                    trailing: track(p) ? Pill('${qtyStr(n(p['stock']))} ${p['unit'] ?? ''}', tone: n(p['stock']) <= 0 ? Tk.red : (n(p['stock']) <= n(p['reorder_level']) ? Tk.orange : Tk.green)) : null,
                    onTap: () => _edit(p)),
            ]),
          if (l.length > shown) Pad(OutlinedButton(onPressed: () => setState(() => shown += 60), child: Text('${tr('Show more')} (${l.length - shown})'))),
        ], actions: [if (s.can('acc_inventory')) iconBtn(Icons.add_circle, () async {
              await newProduct(context, s);
              if (mounted) setState(() {});
            }, tip: 'New product')], onRefresh: () async {
          await s.flush();
          await s.refreshProducts();
        });
      },
    );
  }

  void _edit(Map<String, dynamic> p) {
    final canEdit = s.can('acc_inventory');
    final nm = TextEditingController(text: '${p['name']}'), bc = TextEditingController(text: '${p['barcode'] ?? ''}'), sale = TextEditingController(text: qtyStr(n(p['sale_price']))),
        buy = TextEditingController(text: qtyStr(n(p['avg_cost'] ?? p['purchase_price']))), mrp = TextEditingController(text: n(p['mrp']) > 0 ? qtyStr(n(p['mrp'])) : ''), hsn = TextEditingController(text: '${p['hsn'] ?? ''}');
    var gst = '${n(p['tax_rate']) == n(p['tax_rate']).roundToDouble() ? n(p['tax_rate']).toInt() : n(p['tax_rate'])}';
    final rates = {...s.taxRates.map((r) => r == r.roundToDouble() ? '${r.toInt()}' : '$r'), gst}.toList()..sort((a, b) => n(a).compareTo(n(b)));
    var active = p['active'] != false;
    openSheet(context, '${p['name']}', (ctx, set) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Hint('${p['sku'] ?? ''} · ${p['is_service'] == true ? tr('Service') : '${qtyStr(n(p['stock']))} ${p['unit'] ?? ''} ${tr('in stock')}'}'),
          if (canEdit) ...[
            Fld('Name', nm),
            gap(),
            Fld('Barcode', bc),
            gap(),
            Row(children: [Expanded(child: Fld('MRP', mrp, number: true)), const SizedBox(width: 10), Expanded(child: Fld('Selling price', sale, number: true)), const SizedBox(width: 10), Expanded(child: Fld('Purchase price', buy, number: true))]),
            gap(),
            Row(children: [Expanded(child: Sel('GST rate', gst, [for (final r in rates) (r, '$r%')], (v) => gst = v)), const SizedBox(width: 10), Expanded(child: Fld('HSN code', hsn))]),
            SwitchListTile(contentPadding: EdgeInsets.zero, title: const Text('Active'), value: active, onChanged: (v) => set(() => active = v)),
          ] else ...[
            Group([Li('Selling price', value: inr(n(p['sale_price'])), chevron: false), Li('GST', value: '${p['tax_rate']}%', chevron: false), if (n(p['mrp']) > 0) Li('MRP', value: inr(n(p['mrp'])), chevron: false)]),
          ],
        ]), actions: [
      if (canEdit)
        SheetAction('Save', (ctx) async {
          if (nm.text.trim().isEmpty) {
            toast(ctx, tr('Enter the product name'), err: true);
            return false;
          }
          if (n(mrp.text) > 0 && n(sale.text) > n(mrp.text)) {
            toast(ctx, tr('The selling price is above the MRP'), err: true);
            return false;
          }
          await saveProduct(s, {...p, 'name': nm.text.trim(), 'barcode': bc.text.trim(), 'sale_price': n(sale.text), 'purchase_price': n(buy.text), 'mrp': n(mrp.text), 'tax_rate': gst, 'hsn': hsn.text.trim(), 'active': active});
          await s.refreshProducts();
          return true;
        }),
      if (canEdit && p['track_stock'] == true && p['is_service'] != true)
        SheetAction('Adjust stock', (ctx) async {
          Navigator.pop(ctx);
          _adjust(p);
          return false;
        }, primary: false),
    ]);
  }

  void _adjust(Map<String, dynamic> p) {
    final qty = TextEditingController(), cost = TextEditingController(text: n(p['avg_cost']) > 0 ? qtyStr(n(p['avg_cost'])) : ''), why = TextEditingController(text: 'Stock count correction');
    var add = true;
    openSheet(context, 'Adjust stock', (ctx, set) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Hint('${p['name']} · ${tr('Now')} ${qtyStr(n(p['stock']))} ${p['unit'] ?? ''}'),
          Seg<bool>(expand: true, items: [(true, tr('Add')), (false, tr('Take away'))], value: add, onChanged: (v) => set(() => add = v)),
          gap(),
          Fld('Quantity', qty, number: true, autofocus: true),
          if (add) ...[gap(), Fld('Purchase price', cost, number: true)],
          gap(),
          Fld('Reason', why),
        ]), actions: [
      SheetAction('Save', (ctx) async {
        final k = n(qty.text);
        if (k <= 0) {
          toast(ctx, tr('Enter the quantity'), err: true);
          return false;
        }
        if (add && !(n(cost.text) > 0) && !(n(p['avg_cost']) > 0)) {
          toast(ctx, tr('Enter the purchase price so the stock can be valued.'), err: true);
          return false;
        }
        final wh = s.warehouses.where((w) => w['is_default'] == true).firstOrNull ?? s.warehouses.firstOrNull;
        await s.api.rpc('acc_stock_adjust', {'p': {'mode': 'delta', 'warehouse_id': wh?['id'], 'date': ymd(DateTime.now()), 'reason': why.text.trim(), 'opening': false, 'lines': [{'product_id': p['id'], 'qty': add ? k : -k, 'unit_cost': add && cost.text.isNotEmpty ? cost.text : null}]}});
        await s.refreshProducts();
        return true;
      }),
    ]);
  }
}
