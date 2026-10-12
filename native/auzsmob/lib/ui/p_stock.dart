import 'package:flutter/material.dart' hide Text;
import '../core/calc.dart';
import '../core/ops.dart';
import '../core/session.dart';
import 'ds.dart';
import 'i18n.dart';
import 'mk.dart';
import 'theme.dart';

const _cats = [('service', 'Service'), ('phone_new', 'New phone'), ('phone_used', 'Used phone'), ('accessory', 'Accessory'), ('watch', 'Watch'), ('earbuds', 'Earbuds'), ('headphone', 'Headphone'), ('cable', 'Cable'), ('charger', 'Charger'), ('other', 'Other')];
String catLabel(String? c) => tr(_cats.where((x) => x.$1 == c).firstOrNull?.$2 ?? 'Other');

class StockPage extends StatefulWidget {
  const StockPage(this.s, {super.key});
  final MobSession s;
  @override
  State<StockPage> createState() => _StockPageState();
}

class _StockPageState extends State<StockPage> {
  MobSession get s => widget.s;
  String tab = 'catalog';
  final q = TextEditingController();

  @override
  Widget build(BuildContext context) {
    final r = s.repo!;
    final manage = s.can('mob_manage');
    final tabs = <(String, String)>[('catalog', 'Catalog'), if (s.feat('serials')) ('units', 'Units'), if (s.feat('vendors')) ('vendors', 'Vendors')];
    if (!tabs.any((t) => t.$1 == tab)) tab = 'catalog';
    final ql = q.text.toLowerCase().trim();
    Widget body;
    if (tab == 'units') {
      final units = [...r.rows('units')]..sort((a, b) => (a['status'] == 'in_stock' ? 0 : 1) - (b['status'] == 'in_stock' ? 0 : 1));
      final shown = ql.isEmpty ? units : units.where((u) => '${u['imei'] ?? ''} ${u['imei2'] ?? ''} ${r.byId('items', u['item_id'])?['name'] ?? ''}'.toLowerCase().contains(ql)).toList();
      body = shown.isEmpty
          ? emptyBox(Icons.smartphone, tr('Nothing yet'))
          : Group([for (final u in shown.take(200)) Li('${u['imei'] ?? u['imei2'] ?? '—'}', sub: '${r.byId('items', u['item_id'])?['name'] ?? ''}', icon: Icons.smartphone, tone: u['status'] == 'in_stock' ? Tk.green : Tk.label3, trailing: Pill(tr(u['status'] == 'in_stock' ? 'In stock' : u['status'] == 'sold' ? 'Sold' : 'Returned'), tone: u['status'] == 'in_stock' ? Tk.green : Tk.label2), chevron: false)]);
    } else if (tab == 'vendors') {
      final vs = r.rows('vendors').where((v) => ql.isEmpty || '${v['name']}'.toLowerCase().contains(ql)).toList();
      body = vs.isEmpty ? emptyBox(Icons.store_outlined, tr('Nothing yet')) : Group([for (final v in vs) Li('${v['name']}', sub: '${v['phone'] ?? ''}', icon: Icons.store_outlined, tone: Tk.accent, onTap: manage ? () => vendorSheet(context, s, v) : null, chevron: manage)]);
    } else {
      final items = r.rows('items').where((i) => i['active'] != false && (ql.isEmpty || '${i['name']}'.toLowerCase().contains(ql))).toList()..sort((a, b) => '${a['name']}'.toLowerCase().compareTo('${b['name']}'.toLowerCase()));
      body = items.isEmpty
          ? emptyBox(Icons.inventory_2_outlined, tr('Nothing yet'))
          : Group([
              for (final i in items)
                () {
                  final st = r.stock('${i['id']}');
                  final low = st <= n(i['low_stock_at']);
                  final showStock = s.feat('stock') && i['category'] != 'service';
                  return Li('${i['name']}', sub: '${catLabel('${i['category']}')}${s.canSeeRates ? ' · ${tr('Cost')} ${inr(n(i['cost_price']))}' : ''}', icon: Icons.inventory_2_outlined, tone: Tk.accent, value: inr(n(i['selling_price'])),
                      trailing: showStock ? (i['serialized'] == true ? Pill(tr('Units')) : Pill(qtyStr(st), tone: low ? Tk.red : Tk.green)) : null, onTap: manage ? () => itemSheet(context, s, i) : null, chevron: false);
                }(),
            ]);
    }
    return TabPage('Stock', [
      Pad(Seg<String>(expand: true, items: [for (final t in tabs) (t.$1, t.$2)], value: tab, onChanged: (v) => setState(() => tab = v))),
      Pad(TextField(controller: q, onChanged: (_) => setState(() {}), decoration: InputDecoration(hintText: tr('Search'), prefixIcon: const Icon(Icons.search)))),
      body,
    ], actions: [if (manage && tab != 'units') iconBtn(Icons.add_circle, () => tab == 'vendors' ? vendorSheet(context, s, null) : itemSheet(context, s, null), tip: tab == 'vendors' ? 'Add' : 'Add item')]);
  }
}

void itemSheet(BuildContext c, MobSession s, Map<String, dynamic>? rec) {
  final d = rec ?? {};
  final name = TextEditingController(text: '${d['name'] ?? ''}'), price = TextEditingController(text: rec == null ? '' : qtyStr(n(d['selling_price']))), cost = TextEditingController(text: rec == null ? '' : qtyStr(n(d['cost_price']))), low = TextEditingController(text: rec == null ? '' : qtyStr(n(d['low_stock_at'])));
  var cat = '${d['category'] ?? 'other'}';
  var serial = d['serialized'] == true;
  openSheet(c, rec == null ? 'Add item' : 'Edit', (ctx, set) => Column(children: [
        Fld('Item name', name, autofocus: true),
        gap(),
        Sel('Category', cat, [for (final x in _cats) (x.$1, tr(x.$2))], (v) => cat = v),
        if (s.feat('serials')) SwitchListTile(contentPadding: EdgeInsets.zero, title: const Text('Has a serial number / IMEI'), value: serial, onChanged: (v) => set(() => serial = v)),
        gap(),
        Row(children: [Expanded(child: Fld('Selling price', price, number: true)), const SizedBox(width: 10), Expanded(child: Fld('Purchase rate', cost, number: true))]),
        if (s.feat('stock')) ...[gap(), Fld('Low-stock alert at', low, number: true)],
      ]), actions: [
    SheetAction('Save', (ctx) async {
      if (name.text.trim().isEmpty) {
        toast(ctx, tr('Name is required'), err: true);
        return false;
      }
      final id = rec == null ? newId() : '${rec['id']}';
      await localSaveItem(s, id, {'name': name.text.trim(), 'category': cat, 'serialized': serial, 'sellingPrice': n(price.text), 'costPrice': n(cost.text), 'lowStockAt': n(low.text)}, base: rec == null ? null : rec['updated_at'] as String?);
      if (c.mounted) toast(c, tr('Saved'));
      return true;
    }),
  ]);
}

void vendorSheet(BuildContext c, MobSession s, Map<String, dynamic>? rec) {
  final name = TextEditingController(text: '${rec?['name'] ?? ''}'), phone = TextEditingController(text: '${rec?['phone'] ?? ''}');
  openSheet(c, rec == null ? 'Add' : 'Edit', (ctx, set) => Column(children: [Fld('Name', name, autofocus: true), gap(), Fld('Phone', phone, phone: true)]), actions: [
    SheetAction('Save', (ctx) async {
      if (name.text.trim().isEmpty) {
        toast(ctx, tr('Name is required'), err: true);
        return false;
      }
      await localSaveVendor(s, rec == null ? newId() : '${rec['id']}', {'name': name.text.trim(), 'phone': phone.text.trim()}, base: rec?['updated_at'] as String?);
      if (c.mounted) toast(c, tr('Saved'));
      return true;
    }),
  ]);
}

