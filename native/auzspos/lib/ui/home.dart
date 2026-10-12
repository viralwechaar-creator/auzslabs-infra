import 'dart:async';
import 'package:flutter/services.dart';
import 'package:flutter/material.dart';
import '../core/repo.dart';
import '../core/session.dart';
import 'actions.dart';
import 'floor.dart';
import 'more.dart';
import 'receipt.dart';

String inr(num v) => '₹${v == v.roundToDouble() ? v.toInt() : v.toStringAsFixed(2)}';

typedef HomeState = _HomeState;

class Home extends StatefulWidget {
  const Home(this.s, {super.key});
  final Session s;
  @override
  State<Home> createState() => _HomeState();
}

class _HomeState extends State<Home> {
  int tab = 0;
  Map<String, dynamic>? cur; // the order being built
  List<Map<String, dynamic>> guests = [];
  Timer? _g;
  bool _guestsLoaded = false;
  Session get s => widget.s;

  void openOrder(Map<String, dynamic> o) => setState(() {
        cur = Map<String, dynamic>.from(o)..['lines'] = [for (final l in (o['lines'] as List)) Map<String, dynamic>.from(l as Map)];
        tab = 0;
      });

  void startDineIn(String tableId) {
    final unsaved = cur != null && (cur!['lines'] as List).isNotEmpty && s.repo!.rec('${cur!['id']}') == null;
    setState(() {
      if (unsaved && cur!['table'] == null) {
        cur!['type'] = 'Dine-in';
        cur!['table'] = tableId;
      } else {
        cur = newOrder(type: 'Dine-in', table: tableId);
      }
      tab = 0;
    });
  }

  void toast(String m) => _toast(m);

  @override
  void initState() {
    super.initState();
    s.addListener(_note);
    _g = Timer.periodic(const Duration(seconds: 20), (_) => loadGuests());
    loadGuests();
  }

  @override
  void dispose() {
    s.removeListener(_note);
    _g?.cancel();
    super.dispose();
  }

  void _note() {
    final n = s.notice;
    if (n != null && mounted) {
      s.notice = null;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(n)));
    }
  }

  Future<void> loadGuests() async {
    try {
      final r = await s.api.select('guest_orders', eq: {'status': 'new'}, order: 'created_at');
      final known = guests.map((g) => g['id']).toSet();
      final fresh = r.where((g) => !known.contains(g['id'])).toList();
      if (mounted) setState(() => guests = r);
      if (fresh.isNotEmpty && _guestsLoaded && mounted) {
        final call = fresh.any((g) => '${g['note']}' == 'Waiter called');
        HapticFeedback.heavyImpact();
        SystemSound.play(SystemSoundType.alert);
        _toast(call ? 'A guest is calling the waiter' : 'New QR order');
      }
      _guestsLoaded = true;
    } catch (_) {}
  }

  Map<String, dynamic> newOrder({String type = 'Takeaway', String? table}) => {'id': uid(), 'type': type, 'table': table, 'lines': <Map<String, dynamic>>[], 'status': 'open', 'created': nowIso(), 'by': s.user!['id'], 'cust': <String, dynamic>{}};

  Future<void> persist(Map<String, dynamic> o) async {
    if (o['no'] == null) o['no'] = await s.nextNo();
    final live = s.repo!.rec('${o['id']}');
    if (live != null) {
      for (final k in const ['kstat', 'preparingAt', 'readyAt', 'dispatchAt', 'deliveredAt', 'servedAt']) {
        if (live[k] != null) o[k] = live[k];
      }
    }
    o['t'] = s.tot(o).toJson();
    await s.repo!.save('order', o, id: o['id'] as String);
    unawaited(s.sync());
  }

  Future<void> sendKitchen(Map<String, dynamic> o) async {
    if (o['type'] == 'Dine-in' && o['table'] == null && s.repo!.of('table').isNotEmpty) return _toast('Pick a table first (Review > Table)');
    final lines = (o['lines'] as List).cast<Map<String, dynamic>>();
    final fresh = lines.where((l) => (l['qty'] as num) > ((l['sent'] ?? 0) as num)).toList();
    if (fresh.isEmpty) return _toast('Nothing new to send');
    final kno = await s.nextKot();
    final items = [for (final l in fresh) {'n': '${l['name']}${(l['size'] ?? '') != '' ? ' (${l['size']})' : ''}', 'q': (l['qty'] as num) - ((l['sent'] ?? 0) as num), 's': l['st'] ?? 'Kitchen'}];
    for (final l in lines) {
      l['sent'] = l['qty'];
    }
    final k = o['kstat'] == 'new';
    o['knew'] = [if (k) ...((o['knew'] as List?) ?? []), ...items];
    o['kotBatches'] = [if (k) ...((o['kotBatches'] as List?) ?? []), {'time': nowIso(), 'items': items, 'no': kno}];
    o['kstat'] = 'new';
    o['ktime'] = k ? (o['ktime'] ?? nowIso()) : nowIso();
    await persist(o);
    await s.repo!.save('kotlog', {'orderId': o['id'], 'orderNo': o['no'], 'kotNo': kno, 'type': o['type'], 'table': o['table'], 'cust': o['cust'], 'items': items, 'createdAt': nowIso()});
    unawaited(s.sync());
    _toast('Sent to kitchen · KOT #$kno');
  }

  Future<bool> pay(Map<String, dynamic> o, String mode) async {
    final t = s.tot(o);
    o['pays'] = [{'m': mode, 'amt': t.total, 'at': nowIso()}];
    o['status'] = 'paid';
    o['paidAt'] = nowIso();
    o['paidBy'] = s.user!['id'];
    o['tok'] ??= uid().replaceAll('-', '').substring(0, 12);
    if (o['no'] == null || '${o['no']}'.endsWith('~')) o['no'] = await s.nextNo();
    await persist(o);
    if (o['type'] == 'Dine-in' && o['table'] != null) {
      final t = s.repo!.rec('${o['table']}');
      if (t != null) await s.repo!.save('table', {...t, 'cleaned': false}, id: '${o['table']}');
    }
    return true;
  }

  Future<void> acceptGuest(Map<String, dynamic> g) async {
    final items = ((g['items'] as List?) ?? []).cast<Map>();
    try {
      final ok = await s.api.rpc('claim_guest_order', {'p_id': g['id'], 'p_status': 'done'});
      if (ok == null || ok == false) {
        _toast('Another till already handled this');
        return await loadGuests();
      }
    } catch (e) {
      return _toast('$e');
    }
    if (items.isNotEmpty) {
      final tbl = (g['tbl'] ?? '') == '' ? null : '${g['tbl']}';
      final o = newOrder(type: tbl != null ? 'Dine-in' : 'Takeaway', table: tbl);
      final menu = s.items;
      for (final i in items) {
        final it = menu['${i['id']}'];
        if (it == null) continue;
        final sz = ((it['sizes'] as List?) ?? []).cast<Map>().where((x) => x['l'] == i['size']).firstOrNull;
        (o['lines'] as List).add({'id': it['id'], 'name': it['name'], 'size': i['size'] ?? '', 'price': sz != null ? sz['p'] : it['price'], 'qty': i['qty'], 'sent': 0, 'st': it['st'] ?? 'Kitchen'});
      }
      o['cust'] = {'name': g['name'], 'phone': g['phone']};
      o['src'] = 'QR';
      if (g['note'] != null) o['gn'] = g['note'];
      await persist(o);
      await sendKitchen(o);
    }
    loadGuests();
  }

  void refresh(VoidCallback f) => setState(f);
  Future<void> _syncInfo() async {
    final r = s.repo!;
    unawaited(s.sync());
    if (!mounted) return;
    await showDialog<void>(
      context: context,
      builder: (c) => AlertDialog(
        title: const Text('Sync'),
        content: Text('Waiting to send: ${r.pending}\n'
            '${r.lastOk != null ? 'Last synced: ${r.lastOk!.toLocal().toString().substring(11, 19)}' : 'Not synced yet in this session'}\n'
            '${r.lastError != null ? '\nProblem: ${r.lastError}' : 'No problems'}\n\nSyncing again now…'),
        actions: [TextButton(onPressed: () => Navigator.pop(c), child: const Text('OK'))],
      ),
    );
  }

  void _toast(String m) => ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m)));

  @override
  Widget build(BuildContext context) {
    final pages = [
      SellPage(this),
      TablesPage(this),
      KitchenPage(this),
      OrdersPage(this),
      GuestPage(this),
      MorePage(this),
    ];
    return Scaffold(
      appBar: AppBar(
        title: Text('${s.cfg['name']}'),
        actions: [
          Center(child: InkWell(onTap: _syncInfo, child: Padding(padding: const EdgeInsets.all(8), child: Text(s.syncing ? 'Syncing…' : s.repo!.lastError != null ? 'Sync problem' : s.repo!.pending > 0 ? 'Not synced (${s.repo!.pending})' : 'Synced', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: (s.repo!.pending > 0 || s.repo!.lastError != null) ? Colors.orange.shade800 : Colors.green.shade700))))),
          IconButton(icon: const Icon(Icons.sync), onPressed: s.sync),
          PopupMenuButton<String>(onSelected: (_) => s.signOut(), itemBuilder: (_) => const [PopupMenuItem(value: 'out', child: Text('Sign out'))]),
        ],
      ),
      body: pages[tab],
      bottomNavigationBar: NavigationBar(
        selectedIndex: tab,
        onDestinationSelected: (i) => setState(() => tab = i),
        destinations: [
          const NavigationDestination(icon: Icon(Icons.point_of_sale), label: 'Sell'),
          const NavigationDestination(icon: Icon(Icons.table_restaurant_outlined), label: 'Tables'),
          const NavigationDestination(icon: Icon(Icons.soup_kitchen_outlined), label: 'Kitchen'),
          const NavigationDestination(icon: Icon(Icons.receipt_long), label: 'Orders'),
          NavigationDestination(icon: Badge(isLabelVisible: guests.isNotEmpty, label: Text('${guests.length}'), child: const Icon(Icons.qr_code_2)), label: 'QR orders'),
          const NavigationDestination(icon: Icon(Icons.more_horiz), label: 'More'),
        ],
      ),
    );
  }
}

class SellPage extends StatefulWidget {
  const SellPage(this.h, {super.key});
  final _HomeState h;
  @override
  State<SellPage> createState() => _SellPageState();
}

class _SellPageState extends State<SellPage> {
  String? catId;
  String q = '';
  _HomeState get h => widget.h;
  Session get s => h.s;

  @override
  Widget build(BuildContext context) {
    final cats = s.repo!.of('cat').toList()..sort((a, b) => '${a['name']}'.compareTo('${b['name']}'));
    final o = h.cur ??= h.newOrder();
    final lines = (o['lines'] as List).cast<Map<String, dynamic>>();
    var items = s.repo!.of('item').where((i) => i['active'] != false && (catId == null || i['cat'] == catId) && (q.isEmpty || '${i['name']}'.toLowerCase().contains(q.toLowerCase()))).toList()..sort((a, b) => '${a['name']}'.compareTo('${b['name']}'));
    final t = s.tot(o);
    final qty = lines.fold<num>(0, (a, l) => a + (l['qty'] as num));
    return Column(children: [
      Padding(padding: const EdgeInsets.fromLTRB(12, 8, 12, 0), child: TextField(decoration: const InputDecoration(hintText: 'Search items', prefixIcon: Icon(Icons.search), isDense: true, border: OutlineInputBorder()), onChanged: (v) => setState(() => q = v))),
      SizedBox(
        height: 52,
        child: ListView(scrollDirection: Axis.horizontal, padding: const EdgeInsets.symmetric(horizontal: 8), children: [
          Padding(padding: const EdgeInsets.all(6), child: ChoiceChip(label: const Text('All'), selected: catId == null, onSelected: (_) => setState(() => catId = null))),
          for (final c in cats) Padding(padding: const EdgeInsets.all(6), child: ChoiceChip(label: Text('${c['name']}'), selected: catId == c['id'], onSelected: (_) => setState(() => catId = '${c['id']}'))),
        ]),
      ),
      Expanded(
        child: items.isEmpty
            ? Center(child: Text(s.repo!.of('item').isEmpty ? 'Loading your menu… connect once to download it.' : 'No items'))
            : GridView.builder(
                padding: const EdgeInsets.all(12),
                gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(maxCrossAxisExtent: 180, mainAxisExtent: 84, crossAxisSpacing: 8, mainAxisSpacing: 8),
                itemCount: items.length,
                itemBuilder: (_, i) {
                  final it = items[i];
                  final sizes = ((it['sizes'] as List?) ?? []).cast<Map>();
                  final off = it['soldOut'] == true;
                  return Material(
                    color: off ? Colors.grey.shade200 : Colors.white,
                    borderRadius: BorderRadius.circular(14),
                    child: InkWell(
                      borderRadius: BorderRadius.circular(14),
                      onTap: off ? () => h._toast('${it['name']} is sold out') : () => sizes.isEmpty ? add(o, it, '', it['price']) : pickSize(o, it, sizes),
                      child: Padding(padding: const EdgeInsets.all(10), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Expanded(child: Text('${it['name']}', maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w600))), Text(sizes.isEmpty ? inr(it['price'] ?? 0) : 'from ${inr(sizes.map((x) => x['p'] as num).reduce((a, b) => a < b ? a : b))}', style: const TextStyle(color: Colors.black54))])),
                    ),
                  );
                },
              ),
      ),
      if (lines.isNotEmpty)
        Material(
          elevation: 8,
          child: Padding(
            padding: const EdgeInsets.all(12),
            child: Row(children: [
              Expanded(child: InkWell(onTap: () => cartSheet(o), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text('$qty item${qty == 1 ? '' : 's'} · ${o['type']}${o['table'] != null ? ' · ${s.repo!.rec('${o['table']}')?['name'] ?? ''}' : ''}', style: const TextStyle(color: Colors.black54)), Text(inr(t.total), style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800))]))),
              OutlinedButton(onPressed: () => cartSheet(o), child: const Text('Review')),
              const SizedBox(width: 8),
              FilledButton(onPressed: () => payDialog(o), child: const Text('Pay')),
            ]),
          ),
        ),
    ]);
  }

  void add(Map<String, dynamic> o, Map it, String size, num price) {
    final lines = (o['lines'] as List).cast<Map<String, dynamic>>();
    final same = lines.where((l) => l['id'] == it['id'] && (l['size'] ?? '') == size && l['price'] == price).firstOrNull;
    setState(() {
      if (same != null) {
        same['qty'] = (same['qty'] as num) + 1;
      } else {
        lines.add({'id': it['id'], 'name': it['name'], 'size': size, 'price': price, 'qty': 1, 'sent': 0, 'st': it['st'] ?? 'Kitchen'});
      }
    });
  }

  void pickSize(Map<String, dynamic> o, Map it, List<Map> sizes) {
    showModalBottomSheet(context: context, builder: (_) => SafeArea(child: Column(mainAxisSize: MainAxisSize.min, children: [for (final z in sizes) ListTile(title: Text('${z['l']}'), trailing: Text(inr(z['p'] as num)), onTap: () { Navigator.pop(context); add(o, it, '${z['l']}', z['p'] as num); })])));
  }

  void cartSheet(Map<String, dynamic> o) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (_) => StatefulBuilder(builder: (ctx, set) {
        final lines = (o['lines'] as List).cast<Map<String, dynamic>>();
        final t = s.tot(o);
        void bump(Map<String, dynamic> l, int d) {
          final sent = (l['sent'] ?? 0) as num;
          if (d < 0 && (l['qty'] as num) - 1 < sent) {
            h._toast('Already sent to the kitchen. Cancel it from the Orders tab.');
            return;
          }
          l['qty'] = (l['qty'] as num) + d;
          if ((l['qty'] as num) <= 0) lines.remove(l);
          set(() {});
          setState(() {});
          if (lines.isEmpty) Navigator.pop(ctx);
        }

        return SafeArea(
          child: Padding(
            padding: EdgeInsets.fromLTRB(16, 16, 16, 16 + MediaQuery.of(ctx).viewInsets.bottom),
            child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              SegmentedButton<String>(
                segments: const [ButtonSegment(value: 'Takeaway', label: Text('Takeaway')), ButtonSegment(value: 'Dine-in', label: Text('Dine-in')), ButtonSegment(value: 'Delivery', label: Text('Delivery'))],
                selected: {'${o['type']}'},
                onSelectionChanged: (v) {
                  o['type'] = v.first;
                  set(() {});
                  setState(() {});
                },
              ),
              if (o['type'] == 'Dine-in')
                Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: DropdownButtonFormField<String>(
                    initialValue: o['table'] as String?,
                    decoration: const InputDecoration(labelText: 'Table', isDense: true, border: OutlineInputBorder()),
                    items: [for (final tb in s.repo!.of('table')) DropdownMenuItem(value: '${tb['id']}', child: Text('${tb['name']}'))],
                    onChanged: (v) => o['table'] = v,
                  ),
                ),
              const SizedBox(height: 8),
              Flexible(
                child: ListView(shrinkWrap: true, children: [
                  for (final l in lines)
                    ListTile(
                      dense: true,
                      title: Text('${l['name']}${(l['size'] ?? '') != '' ? ' (${l['size']})' : ''}'),
                      subtitle: Text('${inr(l['price'] as num)}${(l['sent'] ?? 0) > 0 ? ' · sent ${l['sent']}' : ''}'),
                      trailing: Row(mainAxisSize: MainAxisSize.min, children: [IconButton(icon: const Icon(Icons.remove_circle_outline), onPressed: () => bump(l, -1)), Text('${l['qty']}', style: const TextStyle(fontWeight: FontWeight.w700)), IconButton(icon: const Icon(Icons.add_circle_outline), onPressed: () => bump(l, 1))]),
                    ),
                ]),
              ),
              const Divider(),
              _row('Subtotal', t.sub),
              for (final of in t.offers) _row('${of['name']}', -(of['amt'] as num)),
              if (t.d > 0) _row(o['complimentary'] == true ? 'Complimentary' : o['coupon'] != null ? 'Coupon ${o['coupon']}' : 'Discount', -t.d),
              if (t.svc > 0) _row('Service charge', t.svc),
              if (t.tax > 0) _row('Tax', t.tax),
              if (t.round != 0) _row('Round off', t.round),
              _row('Total', t.total, bold: true),
              const SizedBox(height: 8),
              Wrap(spacing: 8, runSpacing: 4, children: [
                ActionChip(avatar: const Icon(Icons.percent, size: 16), label: Text(o['disc'] != null && o['complimentary'] != true ? 'Change discount' : 'Discount'), onPressed: () async { await discountSheet(ctx, s, o, () { set(() {}); setState(() {}); }); set(() {}); }),
                ActionChip(avatar: const Icon(Icons.local_offer_outlined, size: 16), label: const Text('Coupon'), onPressed: () async { await couponSheet(ctx, s, o, () { set(() {}); setState(() {}); }); set(() {}); }),
                ActionChip(avatar: const Icon(Icons.card_giftcard, size: 16), label: Text(o['complimentary'] == true ? 'Complimentary ✓' : 'Complimentary'), onPressed: () async { await compSheet(ctx, s, o, () { set(() {}); setState(() {}); }); set(() {}); }),
                ActionChip(avatar: const Icon(Icons.person_outline, size: 16), label: Text(((o['cust'] as Map?)?['name'] ?? '') != '' ? '${(o['cust'] as Map)['name']}' : 'Customer / note'), onPressed: () async { await customerSheet(ctx, o, () { set(() {}); setState(() {}); }); set(() {}); }),
                ActionChip(avatar: const Icon(Icons.call_split, size: 16), label: const Text('Split bill'), onPressed: () async { Navigator.pop(ctx); await splitSheet(context, h, o); }),
                ActionChip(avatar: const Icon(Icons.cancel_outlined, size: 16), label: const Text('Cancel order'), onPressed: () async { if (await cancelOrder(ctx, h, o)) { if (ctx.mounted) Navigator.pop(ctx); h.refresh(() => h.cur = null); h._toast('Order cancelled'); } }),
              ]),
              const SizedBox(height: 8),
              Row(children: [
                Expanded(child: OutlinedButton(onPressed: () async { Navigator.pop(ctx); await h.persist(o); h.refresh(() => h.cur = null); h._toast('Order held'); }, child: const Text('Hold'))),
                const SizedBox(width: 8),
                Expanded(child: OutlinedButton(onPressed: () async { Navigator.pop(ctx); await h.sendKitchen(o); setState(() {}); }, child: const Text('Send to kitchen'))),
              ]),
            ]),
          ),
        );
      }),
    );
  }

  Widget _row(String l, num v, {bool bold = false}) => Padding(padding: const EdgeInsets.symmetric(vertical: 2), child: Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [Text(l, style: TextStyle(fontWeight: bold ? FontWeight.w800 : null)), Text(inr(v), style: TextStyle(fontWeight: bold ? FontWeight.w800 : null, fontSize: bold ? 18 : null))]));

  void payDialog(Map<String, dynamic> o) {
    final t = s.tot(o);
    showModalBottomSheet(
      context: context,
      builder: (ctx) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Text('Take ${inr(t.total)}', textAlign: TextAlign.center, style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w800)),
            const SizedBox(height: 12),
            for (final m in const [['cash', 'Cash'], ['upi', 'UPI'], ['card', 'Card']])
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: FilledButton.tonal(
                  style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(52)),
                  onPressed: () async {
                    Navigator.pop(ctx);
                    await h.pay(o, m[0]);
                    h.refresh(() => h.cur = null);
                    if (context.mounted) await billActions(context, h, o);
                  },
                  child: Text(m[1]),
                ),
              ),
          ]),
        ),
      ),
    );
  }
}

class OrdersPage extends StatelessWidget {
  const OrdersPage(this.h, {super.key});
  final _HomeState h;
  @override
  Widget build(BuildContext context) {
    final s = h.s;
    final all = s.repo!.of('order').where((o) => (o['lines'] as List?)?.isNotEmpty ?? false).toList()..sort((a, b) => '${b['created']}'.compareTo('${a['created']}'));
    final open = all.where((o) => o['status'] == 'open').toList(), done = all.where((o) => o['status'] != 'open').take(30).toList();
    Widget tile(Map<String, dynamic> o) {
      final t = (o['t'] as Map?)?['total'] ?? s.tot(o).total;
      return ListTile(
        title: Text('${o['no'] ?? 'New'} · ${o['type']}${o['table'] != null ? ' · ${s.repo!.rec('${o['table']}')?['name'] ?? ''}' : ''}'),
        subtitle: Text('${o['status']}${o['kstat'] != null ? ' · kitchen: ${o['kstat']}' : ''}'),
        trailing: Text(inr(t as num), style: const TextStyle(fontWeight: FontWeight.w700)),
        onTap: o['status'] == 'open' ? () => h.openOrder(o) : () => billSheet(context, h, o),
      );
    }

    return ListView(children: [
      const Padding(padding: EdgeInsets.fromLTRB(16, 12, 16, 4), child: Text('Open orders', style: TextStyle(fontWeight: FontWeight.w800))),
      if (open.isEmpty) const Padding(padding: EdgeInsets.all(16), child: Text('No open orders')),
      for (final o in open) tile(o),
      const Padding(padding: EdgeInsets.fromLTRB(16, 16, 16, 4), child: Text('Recent', style: TextStyle(fontWeight: FontWeight.w800))),
      for (final o in done) tile(o),
    ]);
  }
}

class GuestPage extends StatelessWidget {
  const GuestPage(this.h, {super.key});
  final _HomeState h;
  @override
  Widget build(BuildContext context) {
    final g = h.guests;
    if (g.isEmpty) return const Center(child: Text('No QR orders waiting'));
    return RefreshIndicator(
      onRefresh: h.loadGuests,
      child: ListView(children: [
        for (final x in g)
          Card(
            margin: const EdgeInsets.all(12),
            child: Padding(
              padding: const EdgeInsets.all(14),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text((x['tbl'] ?? '') == '' ? 'Takeaway' : 'Table ${h.s.repo!.rec('${x['tbl']}')?['name'] ?? x['tbl']}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
                if (x['name'] != null) Text('${x['name']} ${x['phone'] ?? ''}'),
                const SizedBox(height: 6),
                for (final i in ((x['items'] as List?) ?? []).cast<Map>()) Text('${i['qty']} × ${i['name']}${(i['size'] ?? '') != '' ? ' (${i['size']})' : ''}'),
                if (x['note'] != null) Text('${x['note']}', style: const TextStyle(fontStyle: FontStyle.italic)),
                const SizedBox(height: 10),
                FilledButton(onPressed: () => h.acceptGuest(x), child: Text(((x['items'] as List?) ?? []).isEmpty ? 'Got it' : 'Accept and send to kitchen')),
              ]),
            ),
          ),
      ]),
    );
  }
}
