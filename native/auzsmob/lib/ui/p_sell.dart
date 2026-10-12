import 'package:flutter/material.dart' hide Text;
import '../core/thermal.dart';
import '../core/calc.dart';
import '../core/ops.dart';
import '../core/session.dart';
import 'ds.dart';
import 'history.dart';
import 'i18n.dart';
import 'mk.dart';
import 'receipt.dart';
import 'scanner.dart';
import 'theme.dart';

class CartLine {
  CartLine({this.unitId, required this.itemId, required this.name, this.qty = 1, required this.price, this.vendorId, this.costListed = 0, this.cost, this.service = false, this.partCost = 0, this.partName});
  String? unitId;
  String itemId, name;
  double qty, price, costListed;
  String? vendorId, partName;
  double? cost; // purchase price changed for this bill only
  bool service;
  double partCost;
}

/// The bill being made. Kept above the tabs so switching tab never loses it.
class SellCart extends ChangeNotifier {
  final lines = <CartLine>[];
  final discount = TextEditingController(text: '0');
  final custName = TextEditingController(), custPhone = TextEditingController();
  String pay = 'cash';
  double get subtotal => lines.fold(0.0, (a, l) => a + l.price * l.qty) - n(discount.text);
  double get total => subtotal < 0 ? 0 : subtotal;
  void changed() => notifyListeners();
  void reset() {
    lines.clear();
    discount.text = '0';
    custName.clear();
    custPhone.clear();
    pay = 'cash';
    notifyListeners();
  }
}

const _addVendor = '__add_vendor__';

/// Vendor drop-down that also lets the staffer add a brand-new vendor on the spot.
class VendorPick extends StatefulWidget {
  const VendorPick(this.s, this.value, this.onChanged, {this.label = 'Vendor (optional)', super.key});
  final MobSession s;
  final String? value;
  final ValueChanged<String?> onChanged;
  final String label;
  @override
  State<VendorPick> createState() => _VendorPickState();
}

class _VendorPickState extends State<VendorPick> {
  String? v;
  @override
  void initState() {
    super.initState();
    v = widget.value;
  }

  Future<void> _add() async {
    final name = TextEditingController(), phone = TextEditingController();
    String? madeId;
    await openSheet(context, 'Add', (ctx, set) => Column(children: [Fld('Name', name, autofocus: true), gap(), Fld('Phone', phone, phone: true)]), actions: [
      SheetAction('Save', (ctx) async {
        if (name.text.trim().isEmpty) {
          toast(ctx, tr('Name is required'), err: true);
          return false;
        }
        madeId = newId();
        await localSaveVendor(widget.s, madeId!, {'name': name.text.trim(), 'phone': phone.text.trim()});
        return true;
      }),
    ]);
    if (!mounted) return;
    setState(() => v = madeId);
    widget.onChanged(madeId);
  }

  @override
  Widget build(BuildContext context) {
    final vendors = widget.s.repo!.rows('vendors');
    final cur = vendors.any((x) => x['id'] == v) ? v! : '';
    return Sel(widget.label, cur, [('', tr('Vendor (optional)')), for (final x in vendors) ('${x['id']}', '${x['name']}'), (_addVendor, Lang.hi ? '+ नया वेंडर…' : '+ Add vendor…')], (x) {
      if (x == _addVendor) {
        _add();
        return;
      }
      setState(() => v = x.isEmpty ? null : x);
      widget.onChanged(v);
    });
  }
}

class SellPage extends StatefulWidget {
  const SellPage(this.s, this.cart, {super.key});
  final MobSession s;
  final SellCart cart;
  @override
  State<SellPage> createState() => _SellPageState();
}

class _SellPageState extends State<SellPage> {
  MobSession get s => widget.s;
  SellCart get cart => widget.cart;
  final q = TextEditingController();

  bool tracked(Map<String, dynamic> i) => s.feat('stock') && i['category'] != 'service';
  Map<String, dynamic> itemOf(String? id) => s.repo!.byId('items', id) ?? const {};

  void addUnit(Map<String, dynamic> u) {
    if (cart.lines.any((l) => l.unitId == u['id'])) {
      toast(context, tr('That unit is no longer available for sale.'), err: true);
      return;
    }
    final it = itemOf(u['item_id']);
    final name = '${it['name'] ?? u['item_id']} — ${u['imei'] ?? u['imei2']}';
    final listed = n(u['cost_price'] ?? it['cost_price']);
    askPrice(context, s, title: name, price: n(u['selling_price'] ?? it['selling_price']), cost: listed, onDone: (price, vendorId, cost) {
      if (cart.lines.any((l) => l.unitId == u['id'])) return;
      cart.lines.add(CartLine(unitId: '${u['id']}', itemId: '${u['item_id']}', name: name, price: price, vendorId: vendorId, costListed: listed, cost: cost != null && cost != listed ? cost : null));
      cart.changed();
    });
  }

  void addProduct(Map<String, dynamic> i, {({double price, String? vendorId})? fixed}) {
    void put(double price, String? vendorId, double? cost) {
      final inCart = cart.lines.where((l) => l.itemId == i['id'] && l.unitId == null).fold(0.0, (a, l) => a + l.qty);
      if (tracked(i) && inCart + 1 > s.repo!.stock('${i['id']}')) {
        toast(context, tr('Not enough stock.'), err: true);
        return;
      }
      final listed = n(i['cost_price']);
      final cv = cost != null && cost != listed ? cost : null;
      final row = cart.lines.where((l) => l.itemId == i['id'] && l.unitId == null && l.price == price && (l.vendorId) == vendorId && l.cost == cv).firstOrNull;
      if (row != null) {
        row.qty += 1;
      } else {
        cart.lines.add(CartLine(itemId: '${i['id']}', name: '${i['name']}', price: price, vendorId: vendorId, costListed: listed, cost: cv));
      }
      cart.changed();
    }

    if (fixed != null) return put(fixed.price, fixed.vendorId, null);
    final last = cart.lines.where((l) => l.itemId == i['id'] && l.unitId == null).lastOrNull;
    askPrice(context, s, title: '${i['name']}', price: last?.price ?? n(i['selling_price']), vendorId: last?.vendorId, cost: last?.cost ?? n(i['cost_price']), onDone: put);
  }

  void editLine(CartLine l) => askPrice(context, s, title: l.name, price: l.price, vendorId: l.vendorId, cost: l.service ? null : (l.cost ?? l.costListed), onDone: (price, vendorId, cost) {
        l.price = price;
        l.vendorId = vendorId;
        l.cost = cost != null && cost != l.costListed ? cost : null;
        cart.changed();
      });

  // A never-catalogued item plus an opening purchase (what is in hand), then straight into the cart.
  void quickAdd(String text) {
    final name = TextEditingController(text: text), sp = TextEditingController(), cp = TextEditingController(), have = TextEditingController(text: '1');
    String? vendor;
    openSheet(context, '${Lang.hi ? 'नया: ' : 'New: '}"$text"', (ctx, set) => Column(children: [
          Fld('Item name', name, autofocus: true),
          gap(),
          Row(children: [Expanded(child: Fld('Selling price', sp, number: true)), const SizedBox(width: 10), Expanded(child: Fld('Purchase rate', cp, number: true))]),
          gap(),
          Fld('Qty', have, number: true),
          if (s.feat('vendors')) ...[gap(), VendorPick(s, null, (v) => vendor = v)],
        ]), actions: [
      SheetAction('Save', (ctx) async {
        if (name.text.trim().isEmpty) {
          toast(ctx, tr('Name is required'), err: true);
          return false;
        }
        final itemId = newId();
        final haveQty = (n(have.text) < 1 ? 1.0 : n(have.text));
        final data = {'name': name.text.trim(), 'category': 'other', 'serialized': false, 'sellingPrice': n(sp.text), 'costPrice': n(cp.text)};
        await localSaveItem(s, itemId, data);
        await localPurchase(s, itemId: itemId, vendorId: vendor, qty: haveQty, rate: n(cp.text), sellingPrice: n(sp.text));
        final item = s.repo!.byId('items', itemId)!;
        if (mounted) addProduct(item, fixed: (price: n(sp.text), vendorId: vendor));
        return true;
      }),
    ]);
  }

  // Simple repairs: a repair is just a sale line (what you charged) with the cost of the part you bought for it.
  void serviceSheet() {
    final desc = TextEditingController(), charge = TextEditingController(), part = TextEditingController();
    String? vendor;
    openSheet(context, 'Repair / service', (ctx, set) => Column(children: [
          Fld('What was repaired', desc, autofocus: true),
          gap(),
          Row(children: [Expanded(child: Fld('Repair charge', charge, number: true)), const SizedBox(width: 10), Expanded(child: Fld('Part cost', part, number: true))]),
          if (s.feat('vendors')) ...[gap(), VendorPick(s, null, (v) => vendor = v, label: 'Part bought from')],
        ]), actions: [
      SheetAction('Add to cart', (ctx) async {
        if (desc.text.trim().isEmpty || !(n(charge.text) > 0)) {
          toast(ctx, tr('Name is required'), err: true);
          return false;
        }
        var svc = s.repo!.rows('items').where((i) => i['category'] == 'service' && i['active'] != false).firstOrNull;
        if (svc == null) {
          final id = newId();
          await localSaveItem(s, id, {'name': 'Repair / service', 'category': 'service', 'serialized': false, 'sellingPrice': 0, 'costPrice': 0});
          svc = s.repo!.byId('items', id);
        }
        cart.lines.add(CartLine(itemId: '${svc!['id']}', name: desc.text.trim(), price: n(charge.text), service: true, partCost: n(part.text), partName: desc.text.trim(), vendorId: vendor));
        cart.changed();
        return true;
      }),
    ]);
  }

  Future<void> checkout() async {
    if (cart.lines.isEmpty) return;
    final id = newId();
    final disc = n(cart.discount.text);
    final sub = cart.subtotal;
    final cust = s.feat('customers');
    final items = [
      for (final l in cart.lines)
        {
          'unitId': l.unitId, 'itemId': l.itemId, 'name': l.name, 'qty': l.qty, 'price': l.price,
          if (l.vendorId != null && !l.service) 'vendorId': l.vendorId,
          if (l.cost != null && !l.service) 'costOverride': l.cost,
          if (l.service) ...{'partCost': l.partCost, 'partName': l.partName, 'vendorId': l.vendorId},
        }
    ];
    final args = {'items': items, 'customerName': cust ? cart.custName.text.trim() : '', 'customerPhone': cust ? cart.custPhone.text.trim() : '', 'discount': disc, 'paid': sub < 0 ? 0 : sub, 'paymentMode': cart.pay};
    final local = {
      'id': id, 'tenant_id': null, 'bill_no': null, 'customer_name': args['customerName'], 'customer_phone': args['customerPhone'],
      'items': [for (final it in items) {...it, 'costPrice': it['costOverride'] ?? 0}],
      'subtotal': sub, 'discount': disc, 'total': cart.total, 'paid': args['paid'], 'balance': 0, 'payment_mode': cart.pay, 'voided': false, 'staff_id': s.user!['id'], 'created_at': nowIso(),
    };
    // flip the sold phones now so the next search does not offer them again before the sale reaches the server
    for (final l in cart.lines) {
      if (l.unitId != null) {
        final u = s.repo!.byId('units', l.unitId);
        if (u != null) await s.repo!.put('units', {...u, 'status': 'sold'});
      }
    }
    await s.repo!.localPush('sales', local, 'mob_push_sale', {'p_id': id, 'p': args});
    cart.reset();
    if (!mounted) return;
    await showDialog<void>(
      context: context,
      builder: (d) => AlertDialog(
        title: const Text('Sale complete'),
        content: Text('Saved on this phone. It will sync when there is internet.'),
        actions: [
          TextButton(onPressed: () => shareSaleOnWhatsApp(s, local), child: const Text('Send on WhatsApp')),
          TextButton(onPressed: () => printSale(s, local), child: const Text('Print or save PDF')),
          TextButton(
              onPressed: () async {
                final why = await Thermal.printSale(s.settings, local);
                if (d.mounted) toast(d, why ?? tr('Printed'), err: why != null);
              },
              child: const Text('Thermal printer')),
          FilledButton(onPressed: () => Navigator.pop(d), child: const Text('Done')),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: Listenable.merge([cart, q]),
      builder: (ctx, _) {
        final r = s.repo!;
        final ql = q.text.toLowerCase().trim();
        final items = r.rows('items').where((i) => i['active'] != false).toList();
        final units = r.rows('units').where((u) => u['status'] == 'in_stock').toList();
        final results = <Widget>[];
        if (ql.isNotEmpty) {
          for (final u in units.where((u) => '${u['imei'] ?? ''}'.contains(ql) || '${u['imei2'] ?? ''}'.contains(ql) || '${itemOf(u['item_id'])['name'] ?? ''}'.toLowerCase().contains(ql)).take(8)) {
            results.add(Li('${itemOf(u['item_id'])['name'] ?? ''}', sub: '${u['imei'] ?? u['imei2'] ?? ''}', icon: Icons.smartphone, tone: Tk.accent, value: inr(n(u['selling_price'] ?? itemOf(u['item_id'])['selling_price'])), onTap: () => addUnit(u)));
          }
          for (final i in items.where((i) => (i['serialized'] != true || !s.feat('serials')) && '${i['name']}'.toLowerCase().contains(ql)).take(8)) {
            final inCart = cart.lines.where((l) => l.itemId == i['id'] && l.unitId == null).fold(0.0, (a, l) => a + l.qty);
            final left = r.stock('${i['id']}') - inCart;
            final oos = tracked(i) && left <= 0;
            results.add(Li('${i['name']}', sub: oos ? tr('Out of stock') : (tracked(i) ? '${qtyStr(left)} ${tr('in stock')}' : null), icon: Icons.inventory_2_outlined, tone: oos ? Tk.label3 : Tk.accent, value: inr(n(i['selling_price'])), onTap: oos ? null : () => addProduct(i)));
          }
          results.add(Li('${Lang.hi ? 'नया: ' : 'New: '}"${q.text.trim()}"', icon: Icons.add, tone: Tk.green, onTap: () => quickAdd(q.text.trim())));
        }
        final l = cart.lines;
        final cust = s.feat('customers');
        return TabPage('New sale', [
          Pad(Row(children: [
            Expanded(child: TextField(controller: q, style: const TextStyle(fontSize: 18), decoration: InputDecoration(hintText: tr('Find an item or IMEI'), prefixIcon: const Icon(Icons.search), suffixIcon: q.text.isEmpty ? null : IconButton(icon: const Icon(Icons.close), onPressed: q.clear)))),
            const SizedBox(width: 8),
            IconButton.filledTonal(onPressed: () async {
              final c = await scanCode(context);
              if (c != null) q.text = c;
            }, icon: const Icon(Icons.qr_code_scanner), iconSize: 28),
          ])),
          if (s.repairsMode == 'simple') Pad(OutlinedButton.icon(onPressed: serviceSheet, icon: const Icon(Icons.build_outlined), label: const Text('Repair / service'))),
          if (results.isNotEmpty) Group(results),
          const SectionLabel('Cart'),
          if (l.isEmpty) emptyBox(Icons.shopping_bag_outlined, tr('Your cart is empty'))
          else
            Group([
              for (final x in l)
                Li(x.name, sub: '${x.unitId == null ? '${tr('Qty')} ${qtyStr(x.qty)} × ' : ''}${inr(x.price)}${x.cost != null ? ' · ${tr('Cost')} ${inr(x.cost!)}' : ''}', value: inr(x.price * x.qty), icon: x.unitId != null ? Icons.smartphone : Icons.inventory_2_outlined, tone: Tk.accent, chevron: false,
                    trailing: Row(mainAxisSize: MainAxisSize.min, children: [
                      IconButton(onPressed: () => editLine(x), icon: Icon(Icons.edit_outlined, color: Tk.label2)),
                      IconButton(onPressed: () {
                        l.remove(x);
                        cart.changed();
                      }, icon: Icon(Icons.close, color: Tk.label2)),
                    ])),
            ]),
          if (l.isNotEmpty) ...[
            const SectionLabel('Customer'),
            Pad(Column(children: [
              if (cust) Row(children: [Expanded(child: Fld('Customer (optional)', cart.custName)), const SizedBox(width: 10), Expanded(child: Fld('Phone', cart.custPhone, phone: true))]),
              if (cust) gap(),
              Row(children: [
                Expanded(child: Fld('Discount', cart.discount, number: true, onChanged: (_) => cart.changed())),
                const SizedBox(width: 10),
                Expanded(child: Sel('Payment mode', cart.pay, [('cash', tr('Cash')), ('upi', tr('UPI')), ('card', tr('Card')), if (cust) ('credit', tr('Credit (udhaar)'))], (v) {
                  cart.pay = v;
                  cart.changed();
                })),
              ]),
              gap(),
              Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [const Text('Total', style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800)), Text(inr(cart.total), style: const TextStyle(fontSize: 26, fontWeight: FontWeight.w800))]),
              gap(),
              FilledButton(onPressed: checkout, child: const Text('Checkout')),
            ])),
          ],
          gap(8),
          Pad(OutlinedButton.icon(onPressed: () => Navigator.push(context, MaterialPageRoute<void>(builder: (_) => SaleHistoryPage(s))), icon: const Icon(Icons.history), label: const Text('Sale history'))),
        ]);
      },
    );
  }
}

/// Asks the selling price for THIS bill (pre-filled with the catalogue price). The catalogue price is never changed, so two staff
/// can bill the same product at different prices. [cost] (shown only to people who may see purchase rates) and an optional vendor
/// are noted on the line.
void askPrice(BuildContext c, MobSession s, {required String title, required double price, String? vendorId, double? cost, required void Function(double price, String? vendorId, double? cost) onDone}) {
  final pr = TextEditingController(text: price == 0 ? '' : qtyStr(price));
  final co = cost != null && s.canSeeRates ? TextEditingController(text: qtyStr(cost)) : null;
  String? vendor = vendorId;
  openSheet(c, title, (ctx, set) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Fld('Selling price (this bill)', pr, number: true, autofocus: true),
        if (co != null) ...[gap(), Fld('Purchase price (this bill)', co, number: true)],
        gap(6),
        Hint(tr(co != null ? 'Changes only this bill. The catalogue prices stay as they are.' : 'Changes only this bill. The catalogue price stays as it is.')),
        if (s.feat('vendors')) ...[gap(), VendorPick(s, vendor, (v) => vendor = v)],
      ]), actions: [
    SheetAction('Add to cart', (ctx) async {
      if (pr.text.trim().isEmpty || !(n(pr.text) >= 0)) {
        toast(ctx, tr('Enter a price'), err: true);
        return false;
      }
      final cv = co != null && co.text.trim().isNotEmpty ? n(co.text) : null;
      onDone(n(pr.text), vendor, cv);
      return true;
    }),
  ]);
}

class SaleHistoryPage extends StatelessWidget {
  const SaleHistoryPage(this.s, {super.key});
  final MobSession s;
  @override
  Widget build(BuildContext context) {
    List<Map<String, dynamic>> rows() => s.repo!.rows('sales').where((x) => s.can('mob_reports') || x['staff_id'] == s.user!['id']).toList()..sort((a, b) => '${b['created_at'] ?? ''}'.compareTo('${a['created_at'] ?? ''}'));
    return ListenableBuilder(
      listenable: s.repo!,
      builder: (ctx, _) => VoidableHistory(
        s: s, title: tr('Sale history'), canVoid: s.can('mob_manage'), rows: rows, idOf: (r) => '${r['id']}', isVoided: (r) => r['voided'] == true,
        line: (r) => HistLine('${r['bill_no'] ?? '…'}', '${r['customer_name'] ?? ''}'.isEmpty ? 'Walk-in' : '${r['customer_name']}', inr(n(r['total']))),
        onOpen: (r) => saleDetailSheet(context, s, r),
        rpcBulk: 'mob_void_sales_bulk', idsParam: 'p_sale_ids',
        confirmText: (k) => trv('Void {n} sale(s)? This brings their items back into stock. This cannot be undone.', {'n': k}),
        applyVoided: (id) async {
          final r = s.repo!.byId('sales', id);
          if (r != null) await s.repo!.put('sales', {...r, 'voided': true});
          s.repo!.refresh();
        },
      ),
    );
  }
}

void saleDetailSheet(BuildContext c, MobSession s, Map<String, dynamic> sale) {
  openSheet(c, '${sale['bill_no'] ?? tr('New sale')}', (ctx, set) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        if (sale['voided'] == true) const Note('Voided', bad: true),
        Group([for (final it in (sale['items'] as List? ?? const [])) Li('${(it as Map)['name']}', sub: '${tr('Qty')} ${it['qty']}', value: inr(n(it['price']) * n(it['qty'])), chevron: false)]),
        gap(),
        Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [const Text('Total', style: TextStyle(fontSize: 19, fontWeight: FontWeight.w800)), Text(inr(n(sale['total'])), style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800))]),
        if ('${sale['customer_name'] ?? ''}'.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 6), child: Text('${sale['customer_name']}${'${sale['customer_phone'] ?? ''}'.isNotEmpty ? ' · ${sale['customer_phone']}' : ''}', style: TextStyle(color: Tk.label2))),
      ]), actions: [
    if (sale['voided'] != true) SheetAction('Share on WhatsApp', (ctx) async {
      await shareSaleOnWhatsApp(s, sale);
      return false;
    }, primary: false),
    if (sale['voided'] != true) SheetAction('Print or save PDF', (ctx) async {
      await printSale(s, sale);
      return false;
    }, primary: false),
    if (sale['voided'] != true) SheetAction('Print on thermal printer', (ctx) async {
      final why = await Thermal.printSale(s.settings, sale);
      if (ctx.mounted) toast(ctx, why ?? tr('Printed'), err: why != null);
      return false;
    }, primary: false),
    if (s.can('mob_manage') && sale['voided'] != true)
      SheetAction('Void sale', (ctx) async {
        final ok = await confirm(ctx, 'Void sale', tr('This brings the items back into stock. This cannot be undone.'), yes: 'Void sale', danger: true);
        if (!ok) return false;
        await s.api.rpc('mob_void_sale', {'p_sale_id': sale['id'], 'p_reason': null});
        await s.repo!.put('sales', {...sale, 'voided': true});
        s.repo!.refresh();
        return true;
      }, danger: true),
  ]);
}
