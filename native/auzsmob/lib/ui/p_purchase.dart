import 'package:flutter/material.dart' hide Text;
import '../core/calc.dart';
import '../core/ops.dart';
import '../core/session.dart';
import 'ds.dart';
import 'history.dart';
import 'i18n.dart';
import 'mk.dart';
import 'p_sell.dart';
import 'scanner.dart';
import 'theme.dart';

class _PLine {
  _PLine({required this.itemId, required this.isNew, required this.name, required this.category, required this.rate, this.sellPrice, required this.qty, this.vendorId, this.newVendorName = '', this.serialized = false, this.imei});
  String itemId, name, category, newVendorName;
  bool isNew, serialized;
  double rate, qty;
  double? sellPrice;
  String? vendorId, imei;
}

/// Add purchase / part: several different items on one bill, each saved on the phone first so it works with no internet.
class PurchasePage extends StatefulWidget {
  const PurchasePage(this.s, {super.key});
  final MobSession s;
  @override
  State<PurchasePage> createState() => _PurchasePageState();
}

class _PurchasePageState extends State<PurchasePage> {
  MobSession get s => widget.s;
  final q = TextEditingController(), rate = TextEditingController(), sell = TextEditingController(), qty = TextEditingController(text: '1'), imei = TextEditingController(), newVendor = TextEditingController();
  Map<String, dynamic>? picked; // {id, name, category, serialized, _new}
  String? vendor;
  bool serial = false;
  final cart = <_PLine>[];
  bool saving = false;

  void pick(Map<String, dynamic> i) => setState(() {
        picked = i;
        q.clear();
        serial = s.feat('serials') && i['serialized'] == true;
        if (i['_new'] != true) {
          rate.text = i['cost_price'] == null ? '' : qtyStr(n(i['cost_price']));
          sell.text = i['selling_price'] == null ? '' : qtyStr(n(i['selling_price']));
        }
      });

  void addToBill() {
    final p = picked;
    if (p == null) return;
    cart.add(_PLine(
      itemId: '${p['id']}', isNew: p['_new'] == true, name: '${p['name']}', category: '${p['category'] ?? 'other'}', rate: n(rate.text), sellPrice: sell.text.isEmpty ? null : n(sell.text),
      qty: n(qty.text) == 0 ? 1 : n(qty.text), vendorId: s.feat('vendors') ? vendor : null, newVendorName: s.feat('vendors') ? newVendor.text.trim() : '', serialized: s.feat('serials') && serial, imei: imei.text.trim().isEmpty ? null : imei.text.trim(),
    ));
    setState(() {
      picked = null;
      vendor = null;
      newVendor.clear();
      rate.clear();
      sell.clear();
      qty.text = '1';
      serial = false;
      imei.clear();
    });
  }

  Future<void> save() async {
    if (cart.isEmpty || saving) return;
    setState(() => saving = true);
    try {
      for (final l in cart) {
        if (l.isNew) await localSaveItem(s, l.itemId, {'name': l.name, 'category': l.category, 'serialized': l.serialized, 'sellingPrice': l.sellPrice, 'costPrice': l.rate});
        var vid = l.vendorId;
        if (s.feat('vendors') && vid == null && l.newVendorName.isNotEmpty) {
          vid = newId();
          await localSaveVendor(s, vid, {'name': l.newVendorName});
        }
        await localPurchase(s, itemId: l.itemId, vendorId: vid, qty: l.qty, rate: l.rate, sellingPrice: l.sellPrice, serialized: l.serialized, imei: l.imei);
      }
      if (!mounted) return;
      toast(context, tr('Purchase saved'));
      Navigator.pop(context);
    } catch (e) {
      if (mounted) toast(context, '$e', err: true);
    } finally {
      if (mounted) setState(() => saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final r = s.repo!;
    final ql = q.text.trim().toLowerCase();
    final matches = ql.isEmpty ? <Map<String, dynamic>>[] : r.rows('items').where((i) => i['active'] != false && '${i['name']}'.toLowerCase().contains(ql)).take(6).toList();
    final p = picked;
    return SubPage(
      tr('Add purchase'),
      [
        const SectionLabel('Item name'),
        Pad(TextField(controller: q, onChanged: (_) => setState(() {}), style: const TextStyle(fontSize: 18), decoration: InputDecoration(hintText: tr('Item name'), prefixIcon: const Icon(Icons.search)))),
        if (ql.isNotEmpty)
          Group([
            for (final i in matches) Li('${i['name']}', sub: '${i['category'] ?? ''}', icon: Icons.inventory_2_outlined, tone: Tk.accent, onTap: () => pick(i)),
            Li('${Lang.hi ? 'नया: ' : 'New: '}"${q.text.trim()}"', icon: Icons.add, tone: Tk.green, onTap: () => pick({'id': newId(), 'name': q.text.trim(), 'category': 'other', 'serialized': false, '_new': true})),
          ]),
        if (p != null) ...[
          const SizedBox(height: 10),
          Group([Li('${p['name']}', icon: Icons.inventory_2_outlined, tone: Tk.accent, chevron: false, trailing: TextButton(onPressed: () => setState(() => picked = null), child: const Text('Cancel')))]),
          Pad(Column(children: [
            if (s.feat('vendors')) ...[VendorPick(s, vendor, (v) => vendor = v, label: 'Vendor'), gap(8), Fld('Or type a new vendor', newVendor)],
            gap(),
            Row(children: [Expanded(child: Fld('Purchase rate', rate, number: true)), const SizedBox(width: 10), Expanded(child: Fld('Selling price', sell, number: true))]),
            gap(),
            Fld('Qty', qty, number: true),
            if (s.feat('serials')) ...[
              SwitchListTile(contentPadding: EdgeInsets.zero, title: const Text('Has a serial number / IMEI'), value: serial, onChanged: (v) => setState(() => serial = v)),
              if (serial) Row(children: [Expanded(child: Fld('Serial / IMEI', imei)), IconButton(onPressed: () async {
                final c = await scanCode(context);
                if (c != null) setState(() => imei.text = c);
              }, icon: Icon(Icons.qr_code_scanner, color: Tk.accent))]),
            ],
            gap(),
            OutlinedButton(onPressed: addToBill, child: const Text('Add to this purchase')),
          ])),
        ],
        const SectionLabel('Purchase'),
        if (cart.isEmpty) emptyBox(Icons.shopping_cart_outlined, tr('Nothing yet'))
        else
          Group([for (var i = 0; i < cart.length; i++) Li(cart[i].name, sub: '${tr('Qty')} ${qtyStr(cart[i].qty)} × ${inr(cart[i].rate)}', value: inr(cart[i].qty * cart[i].rate), icon: Icons.inventory_2_outlined, tone: Tk.accent, chevron: false, trailing: IconButton(onPressed: () => setState(() => cart.removeAt(i)), icon: Icon(Icons.close, color: Tk.label2)))]),
      ],
      actions: [if (s.can('mob_manage')) TextButton(onPressed: () => Navigator.push(context, MaterialPageRoute<void>(builder: (_) => PurchaseHistoryPage(s))), child: const Text('Purchase history'))],
      bottom: cart.isEmpty ? null : FilledButton(onPressed: saving ? null : save, child: const Text('Save purchase')),
    );
  }
}

/// Buy a used phone from a person: the seller's details, the IMEI, condition and price paid.
class BuyUsedPage extends StatefulWidget {
  const BuyUsedPage(this.s, {super.key});
  final MobSession s;
  @override
  State<BuyUsedPage> createState() => _BuyUsedPageState();
}

class _BuyUsedPageState extends State<BuyUsedPage> {
  MobSession get s => widget.s;
  String? model;
  final seller = TextEditingController(), sphone = TextEditingController(), imei = TextEditingController(), price = TextEditingController(), acc = TextEditingController();
  String cond = 'good';

  Future<void> save() async {
    if (model == null || imei.text.trim().isEmpty) {
      toast(context, tr('Name is required'), err: true);
      return;
    }
    final r = s.repo!;
    final pid = newId(), unitId = newId(), now = nowIso();
    final rate = n(price.text);
    final args = {'itemId': model, 'qty': 1, 'rate': rate, 'source': 'secondhand', 'imei': imei.text.trim(), 'condition': cond, 'sellerName': seller.text.trim(), 'sellerPhone': sphone.text.trim(), 'accessoriesIncluded': acc.text.trim(), 'unitId': unitId};
    await r.put('units', {'id': unitId, 'item_id': model, 'imei': args['imei'], 'imei2': null, 'source': 'secondhand', 'condition': cond, 'seller_name': args['sellerName'], 'seller_phone': args['sellerPhone'], 'id_proof_url': null, 'accessories_included': args['accessoriesIncluded'], 'cost_price': rate, 'selling_price': null, 'status': 'in_stock', 'created_at': now, 'updated_at': now});
    await r.put('stockMovements', {'id': newId(), 'item_id': model, 'unit_id': unitId, 'qty': 1, 'type': 'secondhand_intake', 'ref_id': pid, 'staff_id': s.user!['id'], 'created_at': now});
    await r.localPush('purchases', {'id': pid, 'item_id': model, 'qty': 1, 'rate': rate, 'total': rate, 'staff_id': s.user!['id'], 'created_at': now}, 'mob_push_purchase', {'p_id': pid, 'p': args});
    if (!mounted) return;
    toast(context, tr('Purchase saved'));
    Navigator.pop(context);
  }

  @override
  Widget build(BuildContext context) {
    final models = s.repo!.rows('items').where((i) => i['category'] == 'phone_used' || i['category'] == 'phone_new').toList();
    model ??= models.isEmpty ? null : '${models.first['id']}';
    return SubPage(
      tr('Buy used phone'),
      [
        const SectionLabel('Device'),
        Pad(models.isEmpty ? Note(Lang.hi ? 'पहले एक फ़ोन मॉडल बनाएं' : 'Create a phone model first (Stock > Add item, category Phone).') : Sel('Device model', model ?? '', [for (final m in models) ('${m['id']}', '${m['name']}')], (v) => setState(() => model = v))),
        const SectionLabel('Buy used phone'),
        Pad(Column(children: [
          Row(children: [Expanded(child: Fld('Seller name', seller)), const SizedBox(width: 10), Expanded(child: Fld('Seller phone', sphone, phone: true))]),
          gap(),
          Row(children: [Expanded(child: Fld('Serial / IMEI', imei)), IconButton(onPressed: () async {
            final c = await scanCode(context);
            if (c != null) setState(() => imei.text = c);
          }, icon: Icon(Icons.qr_code_scanner, color: Tk.accent))]),
          gap(),
          Row(children: [
            Expanded(child: Sel('Condition', cond, [('new', tr('New')), ('good', tr('Good')), ('fair', tr('Fair')), ('poor', tr('Poor'))], (v) => setState(() => cond = v))),
            const SizedBox(width: 10),
            Expanded(child: Fld('Price paid', price, number: true)),
          ]),
          gap(),
          Fld('Accessories included', acc),
        ])),
        Note(tr('If this IMEI is already in your stock, the server will refuse the duplicate.')),
      ],
      bottom: FilledButton(onPressed: models.isEmpty ? null : save, child: const Text('Save')),
    );
  }
}

class PurchaseHistoryPage extends StatelessWidget {
  const PurchaseHistoryPage(this.s, {super.key});
  final MobSession s;
  @override
  Widget build(BuildContext context) {
    String nameOf(dynamic id) => '${s.repo!.byId('items', '$id')?['name'] ?? ''}';
    String vendorOf(dynamic id) => '${s.repo!.byId('vendors', '$id')?['name'] ?? ''}';
    List<Map<String, dynamic>> rows() => s.repo!.rows('purchases').where((x) => s.can('mob_reports') || x['staff_id'] == s.user!['id']).toList()..sort((a, b) => '${b['created_at'] ?? ''}'.compareTo('${a['created_at'] ?? ''}'));
    return ListenableBuilder(
      listenable: s.repo!,
      builder: (ctx, _) => VoidableHistory(
        s: s, title: tr('Purchase history'), canVoid: s.can('mob_manage'), rows: rows, idOf: (r) => '${r['id']}', isVoided: (r) => r['voided'] == true,
        line: (r) => HistLine(nameOf(r['item_id']), vendorOf(r['vendor_id']).isEmpty ? '${tr('Qty')} ${r['qty']}' : vendorOf(r['vendor_id']), inr(n(r['total']))),
        onOpen: (r) => openSheet(context, nameOf(r['item_id']), (c, set) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              if (r['voided'] == true) const Note('Voided', bad: true),
              Group([
                Li(nameOf(r['item_id']), sub: '${tr('Qty')} ${r['qty']} × ${inr(n(r['rate']))}', value: inr(n(r['total'])), chevron: false),
                if (r['vendor_id'] != null) Li('Vendor (optional)', value: vendorOf(r['vendor_id']), chevron: false),
              ]),
            ]), actions: [
          if (s.can('mob_manage') && r['voided'] != true)
            SheetAction('Void purchase', (c) async {
              final ok = await confirm(c, 'Void purchase', tr('This brings the items back into stock. This cannot be undone.'), yes: 'Void purchase', danger: true);
              if (!ok) return false;
              await s.api.rpc('mob_void_purchase', {'p_purchase_id': r['id'], 'p_reason': null});
              await s.repo!.put('purchases', {...r, 'voided': true});
              s.repo!.refresh();
              return true;
            }, danger: true),
        ]),
        rpcBulk: 'mob_void_purchases_bulk', idsParam: 'p_purchase_ids',
        confirmText: (k) => trv('Void {n} purchase(s)? This cannot be undone.', {'n': k}),
        applyVoided: (id) async {
          final r = s.repo!.byId('purchases', id);
          if (r != null) await s.repo!.put('purchases', {...r, 'voided': true});
          s.repo!.refresh();
        },
      ),
    );
  }
}
