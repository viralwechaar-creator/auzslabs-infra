import 'dart:async';
import 'package:flutter/material.dart' hide Text;
import 'package:url_launcher/url_launcher.dart';
import '../core/api.dart';
import '../core/calc.dart';
import '../core/session.dart';
import 'cam.dart';
import 'cart.dart';
import 'ds.dart';
import 'i18n.dart';
import 'mk.dart';
import 'receipt.dart';
import 'theme.dart';

const _methodName = {'cash': 'Cash', 'upi': 'UPI', 'bank': 'NEFT/RTGS'};

/// The same product written as UPC-A (12 digits) or EAN-13 with a leading zero.
List<String> codeVariants(String code) {
  final c = code.trim();
  if (c.length == 12) return [c, '0$c'];
  if (c.length == 13 && c.startsWith('0')) return [c, c.substring(1)];
  return [c];
}

/// Finds products by barcode or SKU. More than one means a duplicate code in the catalogue.
List<Map<String, dynamic>> lookupCode(ScanSession s, String code) {
  final vs = codeVariants(code), low = code.trim().toLowerCase();
  return s.products.where((p) => p['active'] != false && (vs.contains('${p['barcode'] ?? ''}'.trim()) || '${p['sku'] ?? ''}'.toLowerCase() == low)).toList();
}

class ScanPage extends StatefulWidget {
  const ScanPage(this.s, this.cart, {super.key});
  final ScanSession s;
  final ScanCart cart;
  @override
  State<ScanPage> createState() => _ScanPageState();
}

class _ScanPageState extends State<ScanPage> {
  ScanSession get s => widget.s;
  ScanCart get cart => widget.cart;
  final q = TextEditingController();
  bool busy = false;
  List<Map<String, dynamic>> toSend = [];

  @override
  void initState() {
    super.initState();
    _loadSynced();
  }

  Future<void> _loadSynced() async {
    final l = await s.syncedToSend();
    if (mounted) setState(() => toSend = l);
  }

  bool limited(Map<String, dynamic> p) => !s.allowNegative && p['track_stock'] == true && p['is_service'] != true;

  /// Adds one of [p] to the bill / receive list. Returns the line to show under the camera.
  ScanResult add(Map<String, dynamic> p, [double k = 1]) {
    if (cart.mode == 'sell') {
      final ex = cart.sell.where((l) => l.p['id'] == p['id']).firstOrNull;
      final next = (ex?.qty ?? 0) + k;
      if (limited(p) && next > n(p['stock'])) {
        return ScanResult(n(p['stock']) <= 0 ? '${p['name']} is out of stock' : 'Only ${qtyStr(n(p['stock']))} ${p['unit'] ?? ''} of ${p['name']} in stock', bad: true);
      }
      if (ex != null) {
        ex.qty = next;
      } else {
        cart.sell.add(SellLine(p, qty: k));
      }
      if (p['tax_inclusive'] == true && cart.incl == null) cart.incl = true;
      cart.changed();
      return ScanResult('${p['name']}  ×  ${qtyStr(next)}');
    }
    final ex = cart.recv.where((l) => l.p['id'] == p['id']).firstOrNull;
    if (ex != null) {
      ex.qty += k;
    } else {
      cart.recv.add(RecvLine(p, qty: k));
    }
    cart.changed();
    return ScanResult('${p['name']}  ×  ${qtyStr(ex?.qty ?? k)}');
  }

  String summary() {
    if (cart.mode == 'sell') {
      final c = cart.sell.length;
      return c == 0 ? tr('Nothing scanned yet') : '$c ${tr(c == 1 ? 'item' : 'items')}  ·  ${inr(totals().total)}';
    }
    final c = cart.recv.length;
    return c == 0 ? tr('Nothing scanned yet') : '$c ${tr(c == 1 ? 'item' : 'items')} ${tr('to add to stock')}';
  }

  DocCalc totals() => calcSales(cart.calcLines(), inclusive: cart.incl == true, org: s.org, party: cart.party, branch: s.branches.length == 1 ? s.branches.first : null);

  Future<Map<String, dynamic>?> _choose(List<Map<String, dynamic>> m, String code) async {
    Map<String, dynamic>? pick;
    await openSheet(context, 'Which one?', (ctx, set) => Column(children: [
          Hint('${tr('More than one product has the code')} $code. ${tr('Choose the one you mean.')}'),
          Group([for (final p in m) Li('${p['name']}', sub: '${p['sku']} · ${qtyStr(n(p['stock']))} ${p['unit'] ?? ''}', value: inr(n(p['sale_price'])), onTap: () {
                pick = p;
                Navigator.pop(ctx);
              })]),
        ]));
    return pick;
  }

  Future<ScanResult> onCode(String code) async {
    final m = lookupCode(s, code);
    if (m.length == 1) return add(m.first);
    return ScanResult(m.isEmpty ? '${tr('Not in your products')}: $code' : '${tr('More than one product has the code')} $code', bad: true, stop: true);
  }

  Future<void> openCamera() async {
    String? unknown;
    await Navigator.push<void>(context, MaterialPageRoute<void>(fullscreenDialog: true, builder: (_) => ContinuousScanner(
          title: cart.mode == 'sell' ? 'Scan to sell' : 'Scan to add stock',
          summary: summary,
          onCode: (c) async {
            final m = lookupCode(s, c);
            if (m.length == 1) return add(m.first);
            unknown = c;
            return ScanResult(m.isEmpty ? '${tr('Not in your products')}: $c' : '${tr('More than one product has the code')} $c', bad: true, stop: true);
          },
        )));
    if (!mounted) return;
    if (unknown != null) await _unknown(unknown!);
    setState(() {});
  }

  Future<void> _unknown(String code) async {
    final m = lookupCode(s, code);
    if (m.length > 1) {
      final p = await _choose(m, code);
      if (p != null) add(p);
    } else if (m.isEmpty) {
      final r = await newProduct(context, s, code: code, add: cart.mode == 'add');
      if (r != null) {
        final p = r.$1;
        add(p, cart.mode == 'add' && r.$2 > 0 ? r.$2 : 1);
      }
    }
    if (mounted && (cart.count > 0 || m.length != 1)) {
      // keep scanning: the person usually has more items
      await openCamera();
    }
  }

  void editLine(SellLine l) {
    final rate = TextEditingController(text: l.rate), disc = TextEditingController(text: l.disc), qty = TextEditingController(text: qtyStr(l.qty));
    var dt = l.dtype;
    var gst = '${l.gstRate() == l.gstRate().roundToDouble() ? l.gstRate().toInt() : l.gstRate()}';
    final rates = {...s.taxRates.map((r) => r == r.roundToDouble() ? '${r.toInt()}' : '$r'), gst}.toList()..sort((a, b) => n(a).compareTo(n(b)));
    final canEdit = s.can('acc_inventory');
    final buy = TextEditingController(text: '${l.p['avg_cost'] ?? l.p['purchase_price'] ?? ''}'), mrp = TextEditingController(text: '${l.p['mrp'] ?? ''}'), sale = TextEditingController(text: '${l.p['sale_price'] ?? ''}');
    openSheet(context, '${l.p['name']}', (ctx, set) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Hint('${l.p['sku'] ?? ''}${'${l.p['hsn'] ?? ''}'.isNotEmpty ? ' · HSN ${l.p['hsn']}' : ''} · GST ${l.p['tax_rate']}%${l.p['is_service'] == true ? '' : ' · ${qtyStr(n(l.p['stock']))} ${l.p['unit'] ?? ''}'}'),
          if (n(l.p['mrp']) > 0) Hint('MRP ${inr(n(l.p['mrp']))}'),
          Row(children: [Expanded(child: Fld('Price for this bill', rate, number: true)), const SizedBox(width: 10), Expanded(child: Fld('Qty', qty, number: true))]),
          gap(),
          Row(children: [
            Expanded(child: Fld('Discount', disc, number: true)),
            const SizedBox(width: 10),
            SizedBox(width: 130, child: Seg<String>(expand: true, items: const [('pct', '%'), ('amt', '₹')], value: dt, onChanged: (v) => set(() => dt = v))),
          ]),
          gap(),
          Sel('GST on this item (this bill only)', gst, [for (final r in rates) (r, '$r%')], (v) => gst = v),
          Hint(tr('Choose 0% for an item that carries no GST. The saved product is not changed.')),
          if (canEdit) ...[
            const SectionLabel('Product prices'),
            Row(children: [Expanded(child: Fld('Selling price', sale, number: true)), const SizedBox(width: 10), Expanded(child: Fld('Purchase price', buy, number: true)), const SizedBox(width: 10), Expanded(child: Fld('MRP', mrp, number: true))]),
            gap(8),
            OutlinedButton(onPressed: () async {
              try {
                await saveProduct(s, {...l.p, 'sale_price': n(sale.text), 'purchase_price': n(buy.text), 'mrp': n(mrp.text)});
                l.p = {...l.p, 'sale_price': n(sale.text), 'avg_cost': n(buy.text), 'purchase_price': n(buy.text), 'mrp': n(mrp.text)};
                if (ctx.mounted) toast(ctx, tr('Product prices saved'));
              } catch (e) {
                if (ctx.mounted) toast(ctx, '$e', err: true);
              }
            }, child: const Text('Save product prices')),
          ],
        ]), actions: [
      SheetAction('Done', (ctx) async {
        if (n(rate.text) < 0) {
          toast(ctx, tr('Price cannot be negative'), err: true);
          return false;
        }
        l.rate = rate.text;
        l.disc = disc.text;
        l.dtype = dt;
        l.gst = gst;
        final nq = n(qty.text);
        if (nq <= 0) {
          cart.sell.remove(l);
        } else if (limited(l.p) && nq > n(l.p['stock'])) {
          toast(ctx, '${tr('Only')} ${qtyStr(n(l.p['stock']))} ${tr('in stock')}', err: true);
          return false;
        } else {
          l.qty = nq;
        }
        cart.changed();
        return true;
      }),
      SheetAction('Remove', (ctx) async {
        cart.sell.remove(l);
        cart.changed();
        return true;
      }, primary: false, danger: true),
    ]);
  }

  void editRecv(RecvLine l) {
    final cost = TextEditingController(text: l.cost), qty = TextEditingController(text: qtyStr(l.qty));
    openSheet(context, '${l.p['name']}', (ctx, set) => Column(children: [Row(children: [Expanded(child: Fld('Purchase price', cost, number: true)), const SizedBox(width: 10), Expanded(child: Fld('Quantity received', qty, number: true))])]), actions: [
      SheetAction('Done', (ctx) async {
        l.cost = cost.text;
        if (n(qty.text) <= 0) {
          cart.recv.remove(l);
        } else {
          l.qty = n(qty.text);
        }
        cart.changed();
        return true;
      }),
      SheetAction('Remove', (ctx) async {
        cart.recv.remove(l);
        cart.changed();
        return true;
      }, primary: false, danger: true),
    ]);
  }

  // ---- charging ----
  Map<String, dynamic> payload(bool post, DocCalc c) {
    final acct = s.payAccounts(cart.pay).firstOrNull?['id'];
    final lines = [
      for (final l in cart.sell)
        {
          'product_id': l.p['id'], 'description': l.p['name'], 'hsn': l.p['hsn'] ?? '', 'qty': '${l.qty}', 'unit': l.p['unit'] ?? '', 'rate': l.rate,
          'disc_pct': l.dtype == 'pct' && l.disc.isNotEmpty ? l.disc : null, 'disc_amt': l.dtype == 'amt' && l.disc.isNotEmpty ? l.disc : null,
          'tax_rate': '${l.gstRate()}', 'account_id': null, 'batch_no': '', 'expiry': null, 'warehouse_id': null,
        }
    ];
    final payments = post && cart.pay != 'credit' && acct != null ? [{'account_id': acct, 'amount': c.total, 'mode': _methodName[cart.pay], 'reference': cart.ref.text}] : [];
    return {
      'id': null, 'doc_type': 'invoice', 'doc_date': ymd(DateTime.now()), 'due_date': null, 'party_id': cart.party?['id'], 'branch_id': s.branches.length == 1 ? s.branches.first['id'] : null,
      'warehouse_id': null, 'place_of_supply': null, 'reverse_charge': false, 'itc_eligible': true, 'price_includes_tax': cart.incl == true, 'supplier_ref': null, 'supplier_ref_date': null,
      'ref_doc_id': null, 'source_doc_id': null, 'notes': '', 'terms': '', 'roundoff': null, 'lines': lines, 'payments': payments, 'post': post,
    };
  }

  Future<void> charge() async {
    if (cart.sell.isEmpty || busy) return;
    final c = totals();
    final nm = cart.name.text.trim(), ph = cart.phone.text.trim();
    if (cart.pay == 'credit' && nm.isEmpty) {
      toast(context, tr('Enter the customer’s name for a sale on credit'), err: true);
      return;
    }
    if (cart.pay != 'credit' && s.payAccounts(cart.pay).isEmpty) {
      toast(context, tr('No cash or bank account is set up. Add one in AUZsLedger, Settings.'), err: true);
      return;
    }
    final offlineNow = s.offline;
    final ok = await confirm(context, '${tr('Charge')} ${inr(c.total)}?', offlineNow ? tr('You are offline. The sale is kept on this phone and goes to your books, with its final GST invoice number, when the connection is back.') : tr('This posts a GST invoice and reduces your stock.'), yes: 'Charge');
    if (!ok || !mounted) return;
    setState(() => busy = true);
    final sale = {...payload(true, c), 'party_name': nm, 'party_phone': ph};
    final op = s.newOp();
    final items = [for (final l in cart.sell) {'name': l.p['name'], 'qty': l.qty, 'amt': r2(l.qty * n(l.rate))}];
    try {
      Map<String, dynamic>? r;
      if (!offlineNow) {
        try {
          final d = await s.api.rpc('acc_offline_apply', {'p': {'op': op, 'kind': 'sale', 'payload': sale}}).timeout(const Duration(seconds: 10));
          r = Map<String, dynamic>.from(d as Map);
        } on ApiError catch (e) {
          if (!ScanSession.transient(e)) rethrow;
        } on TimeoutException {
          r = null;
        }
      }
      if (r == null) {
        final ref = await s.nextRef();
        await s.enqueue('sale', sale, op: op, meta: {'ref': ref, 'name': nm, 'phone': ph, 'total': c.total});
        final receipt = {'ref': ref, 'name': nm, 'phone': ph, 'total': c.total, 'items': items};
        cart.reset();
        if (mounted) await offlineReceipt(context, s, receipt);
      } else {
        cart.reset();
        s.refreshProducts();
        Map<String, dynamic>? full;
        try {
          full = Map<String, dynamic>.from(await s.api.rpc('acc_get_document', {'p_id': r['id']}) as Map);
        } catch (_) {}
        if (mounted) await saleDone(context, s, r, full, c.total, nm, ph, items);
      }
    } catch (e) {
      if (mounted) toast(context, '$e', err: true);
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> receive() async {
    if (cart.recv.isEmpty || busy) return;
    final lines = [for (final l in cart.recv) {'product_id': l.p['id'], 'qty': l.qty, 'unit_cost': l.cost.isEmpty ? null : n(l.cost)}];
    if (cart.recv.any((l) => n(l.cost) <= 0 && l.p['is_service'] != true && n(l.p['avg_cost']) <= 0)) {
      toast(context, tr('Enter the purchase price so the stock can be valued.'), err: true);
      return;
    }
    setState(() => busy = true);
    final wh = s.warehouses.where((w) => w['is_default'] == true).firstOrNull ?? s.warehouses.firstOrNull;
    final payload = {'mode': 'delta', 'warehouse_id': wh?['id'], 'date': ymd(DateTime.now()), 'reason': 'Stock added while scanning', 'opening': false, 'lines': lines};
    try {
      try {
        await s.api.rpc('acc_stock_adjust', {'p': payload}).timeout(const Duration(seconds: 10));
        s.refreshProducts();
        if (mounted) toast(context, '${tr('Added')} ${cart.recv.length} ${tr('item(s) to stock')}');
      } on ApiError catch (e) {
        if (!ScanSession.transient(e)) rethrow;
        await s.enqueue('stock', payload);
        if (mounted) toast(context, tr('Saved on this phone. It reaches your books when you are back online.'));
      } on TimeoutException {
        await s.enqueue('stock', payload);
        if (mounted) toast(context, tr('Saved on this phone. It reaches your books when you are back online.'));
      }
      cart.reset();
    } catch (e) {
      if (mounted) toast(context, '$e', err: true);
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Widget _queueCard() {
    final items = s.queue;
    if (items.isEmpty) return const SizedBox.shrink();
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      SectionLabel(tr('On this phone, not yet in your books')),
      Group([
        for (final it in items)
          Li(_qLabel(it).$1, sub: it['state'] == 'refused' ? '${tr('Refused')}: ${it['error']}' : (it['lastError'] != null ? '${tr('Last try failed')}: ${it['lastError']}' : _qLabel(it).$2),
              icon: it['state'] == 'refused' ? Icons.error_outline : Icons.schedule, tone: it['state'] == 'refused' ? Tk.red : Tk.orange, value: _qLabel(it).$3, chevron: false,
              trailing: it['state'] == 'refused'
                  ? Row(mainAxisSize: MainAxisSize.min, children: [
                      TextButton(onPressed: () => s.retry('${it['op']}'), child: const Text('Retry')),
                      TextButton(onPressed: () async {
                        if (await confirm(context, 'Discard this?', tr('It has not reached your books and cannot be brought back.'), yes: 'Discard', danger: true)) s.discard('${it['op']}');
                      }, child: Text(tr('Discard'), style: TextStyle(color: Tk.red))),
                    ])
                  : null),
      ]),
      Pad(OutlinedButton.icon(onPressed: () async {
        final r = await s.flush();
        if (!mounted) return;
        await _loadSynced();
        if (r.sent == 0 && r.refused == 0) {
          toast(context, tr(s.offline ? 'Still offline. It will go when the connection is back.' : 'Could not reach your books yet. It will try again.'), err: true);
        } else if (r.sent > 0) {
          toast(context, tr('Sent to your books.'));
        }
      }, icon: const Icon(Icons.cloud_upload_outlined), label: const Text('Send now'))),
    ]);
  }

  (String, String, String) _qLabel(Map<String, dynamic> it) {
    final p = it['payload'] as Map;
    if (it['kind'] == 'sale') return ('${(it['meta'] as Map?)?['ref'] ?? 'Sale'}', '${(p['lines'] as List).length} ${tr('item(s)')}', inr(n((it['meta'] as Map?)?['total'])));
    if (it['kind'] == 'product') return ('${tr('New product')}: ${((it['meta'] as Map?)?['temp'] as Map?)?['name'] ?? ''}', tr('Product'), '');
    return (tr('Stock received'), '${(p['lines'] as List).length} ${tr('item(s)')}', '');
  }

  Widget _syncedCard() {
    if (toSend.isEmpty) return const SizedBox.shrink();
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      SectionLabel('${tr('Ready to send: the real invoice link')} (${toSend.length})'),
      Hint(tr('These sales were made offline and now have a real GST invoice number. The customer still only has the plain text receipt.')),
      Group([
        for (final it in toSend)
          Li('${it['number'] ?? it['ref']}', sub: '${'${it['name'] ?? ''}'.isEmpty ? tr('Sale') : '${tr('Sale to')} ${it['name']}'} · ${inr(n(it['total']))}', icon: Icons.chat_outlined, tone: Tk.green, chevron: false,
              trailing: FilledButton(onPressed: () async {
                try {
                  final link = await s.shareLink('${it['id']}');
                  final msg = 'Hello${'${it['name'] ?? ''}'.isEmpty ? '' : ' ${it['name']}'}, thank you for shopping with ${s.orgName}. Your invoice ${it['number']} for ${inr(n(it['total']))} is here:\n$link';
                  await launchUrl(Uri.parse('https://wa.me/${waNumber('${it['phone']}')}?text=${Uri.encodeComponent(msg)}'), mode: LaunchMode.externalApplication);
                  await s.markSent('${it['ref']}');
                  await _loadSynced();
                } catch (e) {
                  if (mounted) toast(context, '$e', err: true);
                }
              }, style: FilledButton.styleFrom(minimumSize: const Size(0, 40)), child: const Text('Send')))
      ]),
    ]);
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: Listenable.merge([cart, s, q]),
      builder: (ctx, _) {
        final sell = cart.mode == 'sell';
        final ql = q.text.toLowerCase().trim();
        final found = ql.isEmpty ? <Map<String, dynamic>>[] : s.products.where((p) => p['active'] != false && ('${p['name']}'.toLowerCase().contains(ql) || '${p['sku'] ?? ''}'.toLowerCase().contains(ql) || '${p['barcode'] ?? ''}'.contains(ql))).take(8).toList();
        final c = totals();
        return TabPage('Scan', [
          Pad(Seg<String>(expand: true, items: [('sell', tr('Sell')), if (s.can('acc_inventory')) ('add', tr('Add stock'))], value: cart.mode, onChanged: cart.setMode)),
          Pad(FilledButton.icon(onPressed: openCamera, icon: const Icon(Icons.qr_code_scanner, size: 28), label: Text(sell ? tr('Scan to sell') : tr('Scan to add stock')), style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(64), textStyle: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800)))),
          Pad(TextField(controller: q, style: const TextStyle(fontSize: 18), decoration: InputDecoration(hintText: tr('Type a name or code'), prefixIcon: const Icon(Icons.search), suffixIcon: q.text.isEmpty ? null : IconButton(icon: const Icon(Icons.close), onPressed: q.clear)),
              onSubmitted: (v) {
                final m = lookupCode(s, v);
                if (m.length == 1) {
                  final r = add(m.first);
                  if (r.bad) toast(context, r.text, err: true);
                  q.clear();
                }
              })),
          if (found.isNotEmpty || ql.isNotEmpty)
            Group([
              for (final p in found)
                Li('${p['name']}', sub: '${p['sku'] ?? ''} · ${p['is_service'] == true ? tr('Service') : '${qtyStr(n(p['stock']))} ${p['unit'] ?? ''}'}', value: inr(n(p['sale_price'])), icon: Icons.inventory_2_outlined, tone: Tk.accent, onTap: () {
                  final r = add(p);
                  if (r.bad) toast(context, r.text, err: true);
                  q.clear();
                }),
              if (s.can('acc_inventory'))
                Li('${tr('New product')}: ${q.text.trim()}', icon: Icons.add, tone: Tk.green, onTap: () async {
                  final r = await newProduct(context, s, name: q.text.trim(), add: !sell);
                  if (r != null) {
                    add(r.$1, !sell && r.$2 > 0 ? r.$2 : 1);
                    q.clear();
                  }
                }),
            ]),
          if (s.can('acc_inventory') && ql.isEmpty)
            Pad(TextButton.icon(onPressed: () async {
              final r = await newProduct(context, s, add: !sell);
              if (r != null) add(r.$1, !sell && r.$2 > 0 ? r.$2 : 1);
            }, icon: const Icon(Icons.add), label: const Text('New product'))),
          SectionLabel(sell ? tr('Bill') : tr('To add to stock')),
          if (cart.count == 0) emptyBox(Icons.qr_code_2, tr('Nothing scanned yet'), tr('Point the camera at a bar code, or search above.'))
          else if (sell)
            Group([
              for (final l in cart.sell)
                Li('${l.p['name']}', sub: '${qtyStr(l.qty)} × ${inr(n(l.rate))}${l.disc.isNotEmpty ? ' − ${l.disc}${l.dtype == 'pct' ? '%' : '₹'}' : ''}${n(l.p['mrp']) > 0 && n(l.rate) > n(l.p['mrp']) ? ' · ${tr('above MRP')}' : ''} · GST ${l.gstRate() == l.gstRate().roundToDouble() ? l.gstRate().toInt() : l.gstRate()}%',
                    value: inr(c.lines[cart.sell.indexOf(l)]['total']!), icon: Icons.inventory_2_outlined, tone: Tk.accent, onTap: () => editLine(l),
                    trailing: Row(mainAxisSize: MainAxisSize.min, children: [
                      IconButton(onPressed: () {
                        l.qty -= 1;
                        if (l.qty <= 0) cart.sell.remove(l);
                        cart.changed();
                      }, icon: const Icon(Icons.remove_circle_outline)),
                      IconButton(onPressed: () {
                        final r = add(l.p);
                        if (r.bad) toast(context, r.text, err: true);
                      }, icon: const Icon(Icons.add_circle_outline)),
                    ])),
            ])
          else
            Group([for (final l in cart.recv) Li('${l.p['name']}', sub: '${qtyStr(l.qty)} × ${l.cost.isEmpty ? '—' : inr(n(l.cost))}', icon: Icons.add_box_outlined, tone: Tk.green, onTap: () => editRecv(l))]),
          if (sell && cart.sell.isNotEmpty) ...[
            const SectionLabel('Customer'),
            Pad(Column(children: [
              Row(children: [Expanded(child: Fld('Customer name', cart.name)), const SizedBox(width: 10), Expanded(child: Fld('WhatsApp number', cart.phone, phone: true))]),
              gap(),
              Sel('Payment mode', cart.pay, [('cash', tr('Cash')), ('upi', tr('UPI')), ('bank', tr('Bank')), ('credit', tr('Credit (udhaar)'))], (v) {
                cart.pay = v;
                cart.changed();
              }),
              if (cart.pay == 'upi' || cart.pay == 'bank') ...[gap(), Fld('Reference (optional)', cart.ref)],
              gap(),
              if (c.discount > 0) _row(tr('Discount'), '-${inr(c.discount)}'),
              _row(tr('Taxable value'), inr(c.taxable)),
              if (c.cgst > 0) _row('CGST', inr(c.cgst)),
              if (c.sgst > 0) _row('SGST', inr(c.sgst)),
              if (c.igst > 0) _row('IGST', inr(c.igst)),
              if (c.roundoff != 0) _row(tr('Round off'), inr(c.roundoff)),
              const Divider(),
              Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [const Text('Total', style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800)), Text(inr(c.total), style: const TextStyle(fontSize: 28, fontWeight: FontWeight.w800))]),
              gap(),
              FilledButton(onPressed: busy ? null : charge, child: Text('${tr('Charge')} ${inr(c.total)}')),
            ])),
          ],
          if (!sell && cart.recv.isNotEmpty) Pad(FilledButton(onPressed: busy ? null : receive, child: const Text('Add to stock'))),
          _queueCard(),
          _syncedCard(),
        ], onRefresh: () async {
          await s.flush();
          await s.refreshProducts();
          await _loadSynced();
        });
      },
    );
  }

  Widget _row(String a, String b) => Padding(padding: const EdgeInsets.symmetric(vertical: 3), child: Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [Text(a, style: TextStyle(color: Tk.label2, fontSize: 16)), Text(b, style: const TextStyle(fontSize: 16))]));
}

/// A new product (unknown barcode, or typed name). Returns the product (a temporary one when offline) and the quantity entered.
Future<(Map<String, dynamic>, double)?> newProduct(BuildContext c, ScanSession s, {String? code, String? name, bool add = false}) async {
  if (!s.can('acc_inventory')) {
    await showDialog<void>(context: c, builder: (d) => AlertDialog(title: const Text('Not in your products'), content: Text(tr('Your role cannot add products. Ask the owner to add it (Products, then New product).')), actions: [FilledButton(onPressed: () => Navigator.pop(d), child: const Text('OK'))]));
    return null;
  }
  final nm = TextEditingController(text: name ?? ''), bc = TextEditingController(), mrp = TextEditingController(), sale = TextEditingController(), buy = TextEditingController(), hsn = TextEditingController(), stock = TextEditingController(text: '1');
  var incl = true;
  var gst = '${s.defaultTaxRate == s.defaultTaxRate.roundToDouble() ? s.defaultTaxRate.toInt() : s.defaultTaxRate}';
  var unit = 'Nos';
  (Map<String, dynamic>, double)? result;
  final rates = s.taxRates.map((r) => r == r.roundToDouble() ? '${r.toInt()}' : '$r').toList();
  await openSheet(c, 'New product', (ctx, set) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Note(code != null ? '${tr('Barcode')} $code ${tr('is new. Add the details once; next time the scan fills everything in.')}' : tr('Add the product once. It is saved to your products.')),
        Fld('Name', nm, autofocus: true),
        if (code == null) ...[gap(), Fld('Barcode (if it has one)', bc)],
        gap(),
        Row(children: [Expanded(child: Fld('MRP', mrp, number: true, onChanged: (v) {
          if (sale.text.isEmpty && n(v) > 0) sale.text = v;
        })), const SizedBox(width: 10), Expanded(child: Fld('Selling price', sale, number: true))]),
        gap(),
        Fld('Purchase price', buy, number: true),
        SwitchListTile(contentPadding: EdgeInsets.zero, title: const Text('Selling price includes GST'), subtitle: Text(tr('Most packed goods are priced at MRP, tax included.')), value: incl, onChanged: (v) => set(() => incl = v)),
        Row(children: [Expanded(child: Sel('GST rate', gst, [for (final r in rates) (r, '$r%')], (v) => gst = v)), const SizedBox(width: 10), Expanded(child: Sel('Unit', unit, [for (final u in ['Nos', 'Kg', 'Gm', 'Ltr', 'Mtr', 'Box', 'Pack', 'Pair']) (u, u)], (v) => unit = v))]),
        gap(),
        Row(children: [Expanded(child: Fld('HSN code', hsn)), const SizedBox(width: 10), Expanded(child: Fld(add ? 'Quantity received' : 'Number in stock', stock, number: true))]),
      ]), actions: [
    SheetAction('Save and continue', (ctx) async {
      if (nm.text.trim().isEmpty) {
        toast(ctx, tr('Enter the product name'), err: true);
        return false;
      }
      if (!(n(sale.text) > 0)) {
        toast(ctx, tr('Enter the selling price'), err: true);
        return false;
      }
      if (n(mrp.text) > 0 && n(sale.text) > n(mrp.text)) {
        toast(ctx, tr('The selling price is above the MRP'), err: true);
        return false;
      }
      if (!add && n(stock.text) > 0 && !(n(buy.text) > 0)) {
        toast(ctx, tr('Enter the purchase price so the stock can be valued, or set the number in stock to 0'), err: true);
        return false;
      }
      final body = <String, dynamic>{
        'id': null, 'name': nm.text.trim(), 'sku': code ?? 'NP-${DateTime.now().millisecondsSinceEpoch.toRadixString(36).toUpperCase()}', 'barcode': code ?? bc.text.trim(), 'category': '', 'brand': '',
        'unit': unit, 'hsn': hsn.text.trim(), 'tax_rate': gst, 'tax_inclusive': incl, 'sale_price': sale.text, 'purchase_price': buy.text.isEmpty ? 0 : buy.text, 'mrp': mrp.text.isEmpty ? 0 : mrp.text,
        'is_service': false, 'track_stock': true, 'track_batch': false, 'track_serial': false, 'reorder_level': 0, 'reorder_qty': 0, 'notes': '', 'active': true, 'price_lists': <String, dynamic>{},
      };
      final q0 = n(stock.text);
      final wh = s.warehouses.where((w) => w['is_default'] == true).firstOrNull ?? s.warehouses.firstOrNull;
      Map<String, dynamic> stockPayload(String pid) => {'mode': 'delta', 'warehouse_id': wh?['id'], 'date': ymd(DateTime.now()), 'reason': 'Stock added while scanning', 'opening': false, 'lines': [{'product_id': pid, 'qty': q0, 'unit_cost': buy.text.isEmpty ? null : buy.text}]};
      Map<String, dynamic> temp() => {...body, 'id': s.tempId(), 'tax_rate': n(gst), 'avg_cost': n(buy.text), 'sale_price': n(sale.text), 'mrp': n(mrp.text), 'stock': 0, 'track_stock': true, 'is_service': false};
      Future<void> offlinePath() async {
        final t = temp();
        await s.enqueue('product', body, meta: {'temp': t});
        if (!add && q0 > 0) await s.enqueue('stock', stockPayload('${t['id']}'));
        result = (s.products.firstWhere((x) => x['id'] == t['id'], orElse: () => t), q0);
      }

      try {
        if (s.offline) {
          await offlinePath();
        } else {
          try {
            final r = await s.api.rpc('acc_save_product', {'p': body}).timeout(const Duration(seconds: 10));
            final id = (r as Map)['id'];
            if (!add && q0 > 0) await s.api.rpc('acc_stock_adjust', {'p': stockPayload('$id')});
            await s.refreshProducts();
            final p = s.products.where((x) => x['id'] == id).firstOrNull;
            if (p == null) throw ApiError('The product was saved but could not be loaded. Search for it by name.');
            result = (p, q0);
          } on TimeoutException {
            await offlinePath();
          } on ApiError catch (e) {
            if (!ScanSession.transient(e)) rethrow;
            await offlinePath();
          }
        }
      } catch (e) {
        if (ctx.mounted) toast(ctx, '$e', err: true);
        return false;
      }
      return true;
    }),
  ]);
  return result;
}

/// Saves price / details of an existing product (the whole record, as the books want it).
Future<void> saveProduct(ScanSession s, Map<String, dynamic> p) async {
  final body = <String, dynamic>{
    'id': p['id'], 'name': p['name'], 'sku': p['sku'], 'barcode': p['barcode'] ?? '', 'category': p['category'] ?? '', 'brand': p['brand'] ?? '', 'unit': p['unit'] ?? 'Nos', 'hsn': p['hsn'] ?? '',
    'tax_rate': p['tax_rate'], 'tax_inclusive': p['tax_inclusive'] ?? false, 'sale_price': p['sale_price'], 'purchase_price': p['purchase_price'] ?? p['avg_cost'] ?? 0, 'mrp': p['mrp'] ?? 0,
    'is_service': p['is_service'] ?? false, 'track_stock': p['track_stock'] ?? true, 'track_batch': p['track_batch'] ?? false, 'track_serial': p['track_serial'] ?? false, 'reorder_level': p['reorder_level'] ?? 0,
    'reorder_qty': p['reorder_qty'] ?? 0, 'notes': p['notes'] ?? '', 'active': p['active'] ?? true, 'price_lists': p['price_lists'] ?? <String, dynamic>{},
  };
  await s.api.rpc('acc_save_product', {'p': body});
  s.remember({'id': p['id'], 'name': p['name'], 'barcode': body['barcode'], 'sale_price': body['sale_price'], 'purchase_price': body['purchase_price'], 'avg_cost': body['purchase_price'], 'mrp': body['mrp'], 'tax_rate': body['tax_rate'], 'hsn': body['hsn'], 'unit': body['unit'], 'active': body['active']});
}
