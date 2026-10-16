import 'dart:async';
import 'package:flutter/services.dart';
import 'package:flutter/material.dart' hide Text;
import 'i18n.dart';
import '../core/repo.dart';
import '../core/session.dart';
import '../core/stock.dart' as stock;
import '../core/alerts.dart';
import 'actions.dart';
import 'admin.dart';
import 'kit.dart';
import 'ds.dart';
import 'theme.dart';
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
  String tab = 'sell';
  Map<String, dynamic>? cur; // the order being built
  List<Map<String, dynamic>> guests = [];
  Timer? _g;
  bool _guestsLoaded = false;
  Session get s => widget.s;

  void openOrder(Map<String, dynamic> o) => setState(() {
        cur = Map<String, dynamic>.from(o)..['lines'] = [for (final l in (o['lines'] as List)) Map<String, dynamic>.from(l as Map)];
        tab = 'sell';
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
      tab = 'sell';
    });
  }

  void toast(String m) => _toast(m);

  @override
  void initState() {
    super.initState();
    s.addListener(_note);
    if (s.repo!.of('table').isNotEmpty) tab = 'tables';
    _g = Timer.periodic(const Duration(seconds: 10), (_) => loadGuests());
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
        if (await Alerts.enabled()) await Alerts.ring(title: call ? 'Guest is calling the waiter' : 'New QR order', body: 'Open AUZsPOS to accept it');
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
    final items = [for (final l in fresh) {'n': '${l['name']}${(l['size'] ?? '') != '' ? ' (${l['size']})' : ''}', 'q': (l['qty'] as num) - ((l['sent'] ?? 0) as num), 's': l['st'] ?? 'Kitchen', if ('${l['note'] ?? ''}'.isNotEmpty) 'note': l['note']}];
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
    await stock.dedu(s.repo!, o);
    await stock.deduVariant(s.repo!, o);
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
    final hasTables = s.repo!.of('table').isNotEmpty;
    final keys = [if (hasTables) 'tables', 'sell', 'orders', 'kitchen', 'more'];
    if (!keys.contains(tab)) tab = keys.first;
    final page = switch (tab) {
      'tables' => TablesPage(this),
      'sell' => SellPage(this),
      'orders' => OrdersPage(this),
      'kitchen' => KitchenPage(this),
      _ => MorePage(this),
    };
    final r = s.repo!;
    final status = s.syncing ? 'Syncing…' : r.lastError != null ? 'Sync problem' : r.pending > 0 ? 'Not synced (${r.pending})' : 'Synced';
    final tone = r.lastError != null ? Tk.red : (r.pending > 0 || s.syncing) ? Tk.orange : Tk.green;
    NavigationDestination dest(String k) => switch (k) {
          'tables' => const NavigationDestination(icon: Icon(Icons.table_restaurant_outlined), selectedIcon: Icon(Icons.table_restaurant), label: 'Tables'),
          'sell' => const NavigationDestination(icon: Icon(Icons.shopping_bag_outlined), selectedIcon: Icon(Icons.shopping_bag), label: 'Sell'),
          'orders' => NavigationDestination(icon: Badge(isLabelVisible: guests.isNotEmpty, label: Text('${guests.length}'), child: const Icon(Icons.receipt_long_outlined)), selectedIcon: const Icon(Icons.receipt_long), label: 'Orders'),
          'kitchen' => const NavigationDestination(icon: Icon(Icons.local_fire_department_outlined), selectedIcon: Icon(Icons.local_fire_department), label: 'Kitchen'),
          _ => const NavigationDestination(icon: Icon(Icons.more_horiz), label: 'More'),
        };
    return Scaffold(
      body: Column(children: [
        NavBar(title: tab == 'sell' ? 'Sell' : null, status: status, statusTone: tone, onStatus: _syncInfo, badge: guests.length, onBell: () {
          if (guests.isNotEmpty) {
            setState(() => tab = 'orders');
          } else {
            _toast('No new alerts');
          }
        }),
        Expanded(child: page),
      ]),
      bottomNavigationBar: Container(
        decoration: BoxDecoration(border: Border(top: BorderSide(color: Tk.line, width: .5))),
        child: NavigationBar(selectedIndex: keys.indexOf(tab), onDestinationSelected: (i) => setState(() => tab = keys[i]), destinations: [for (final k in keys) dest(k)]),
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

  Future<void> pickTable(Map<String, dynamic> o) async {
    final tables = s.repo!.of('table').toList()..sort((a, b) => '${a['name']}'.compareTo('${b['name']}'));
    if (tables.isEmpty) return h._toast('Add tables in Admin console > Tables first');
    final id = await showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      builder: (ctx) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
            const Text('Choose a table', style: TextStyle(fontSize: 22, fontWeight: FontWeight.w800)),
            const SizedBox(height: 12),
            Flexible(child: SingleChildScrollView(child: Wrap(spacing: 8, runSpacing: 8, children: [for (final t in tables) Cat('${t['name']}', o['table'] == t['id'], () => Navigator.pop(ctx, '${t['id']}'))]))),
          ]),
        ),
      ),
    );
    if (id != null) setState(() {
      o['table'] = id;
      o['type'] = 'Dine-in';
    });
  }

  @override
  Widget build(BuildContext context) {
    final cats = s.repo!.of('cat').where((c) => c['active'] != false).toList()..sort((a, b) => '${a['n'] ?? 0}${a['name']}'.compareTo('${b['n'] ?? 0}${b['name']}'));
    final o = h.cur ??= h.newOrder(type: 'Dine-in');
    catId ??= cats.isEmpty ? null : '${cats.first['id']}';
    if (catId != null && !cats.any((c) => '${c['id']}' == catId)) catId = cats.isEmpty ? null : '${cats.first['id']}';
    final lines = (o['lines'] as List).cast<Map<String, dynamic>>();
    final all = s.repo!.menuItems();
    final searching = q.isNotEmpty;
    final items = all.where((i) => searching ? '${i['name']} ${i['short'] ?? ''}'.toLowerCase().contains(q.toLowerCase()) : (catId == null || i['cat'] == catId)).toList()..sort((a, b) => '${a['name']}'.compareTo('${b['name']}'));
    final t = s.tot(o);
    final qty = lines.fold<num>(0, (a, l) => a + (l['qty'] as num));
    final tableName = o['table'] == null ? null : '${s.repo!.rec('${o['table']}')?['name'] ?? ''}';
    final hasTables = s.repo!.of('table').isNotEmpty;
    return Column(children: [
      Padding(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
        child: SingleChildScrollView(scrollDirection: Axis.horizontal, child: Row(children: [
          Seg<String>(items: const [('Dine-in', 'Dine-in'), ('Takeaway', 'Takeaway'), ('Delivery', 'Delivery')], value: '${o['type']}', onChanged: (v) => setState(() => o['type'] = v)),
          if (hasTables) ...[const SizedBox(width: 12), PillBtn(tableName == null || tableName.isEmpty ? 'Table' : tableName, icon: Icons.table_restaurant_outlined, onTap: () => pickTable(o))],
        ])),
      ),
      Padding(padding: const EdgeInsets.fromLTRB(16, 12, 16, 0), child: TextField(style: const TextStyle(fontSize: 18), decoration: InputDecoration(hintText: tr('Search items or codes'), prefixIcon: Icon(Icons.search, color: Tk.label3)), onChanged: (v) => setState(() => q = v))),
      SizedBox(
        height: 64,
        child: ListView(scrollDirection: Axis.horizontal, padding: const EdgeInsets.fromLTRB(16, 12, 8, 6), children: [
          for (final c in cats) Cat('${c['name']}', !searching && catId == c['id'], () => setState(() {
                catId = '${c['id']}';
                q = '';
              }), count: all.where((i) => i['cat'] == c['id']).length),
        ]),
      ),
      Expanded(
        child: items.isEmpty
            ? (all.isEmpty ? Empty(Icons.restaurant_menu, 'Your menu is empty', s.syncing ? 'Downloading your menu…' : 'Add items in More > Admin console > Menu, or connect once to download your existing menu.', action: s.can('m') ? 'Add menu items' : null, onAction: s.can('m') ? () => Navigator.push(context, MaterialPageRoute<void>(builder: (_) => MenuAdmin(h))) : null) : const Empty(Icons.search_off, 'No items here', 'Try another category or search.'))
            : GridView.builder(
                padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
                gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(maxCrossAxisExtent: 270, mainAxisExtent: 196, crossAxisSpacing: 14, mainAxisSpacing: 14),
                itemCount: items.length,
                itemBuilder: (_, i) => _tile(o, items[i]),
              ),
      ),
      if (lines.isNotEmpty)
        Padding(
          padding: const EdgeInsets.fromLTRB(12, 4, 12, 10),
          child: Material(
            color: Tk.accent,
            borderRadius: BorderRadius.circular(20),
            child: InkWell(
              borderRadius: BorderRadius.circular(20),
              onTap: () => cartSheet(o),
              child: Padding(
                padding: const EdgeInsets.fromLTRB(18, 12, 12, 12),
                child: Row(children: [
                  Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text('$qty item${qty == 1 ? '' : 's'} · ${o['type']}${tableName != null && tableName.isNotEmpty ? ' · $tableName' : ''}', style: const TextStyle(color: Colors.white70, fontSize: 15)),
                    Text(inr(t.total), style: const TextStyle(color: Colors.white, fontSize: 24, fontWeight: FontWeight.w800)),
                  ])),
                  const Text('Review', style: TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.w700)),
                  const SizedBox(width: 4),
                  const Icon(Icons.chevron_right, color: Colors.white),
                ]),
              ),
            ),
          ),
        ),
    ]);
  }

  Widget _tile(Map<String, dynamic> o, Map<String, dynamic> it) {
    final sizes = ((it['sizes'] as List?) ?? []).cast<Map>();
    final why = s.itemOffWhy(it, '${o['type']}');
    final off = why.isNotEmpty;
    final img = '${it['img'] ?? ''}';
    final veg = '${it['veg'] ?? 'veg'}';
    final vc = veg == 'nonveg' ? Tk.red : veg == 'egg' ? const Color(0xFFC98A00) : Tk.green;
    final price = sizes.isEmpty ? inr((it['price'] ?? 0) as num) : sizes.map((x) => inr(x['p'] as num)).join(' / ');
    return Opacity(
      opacity: off ? .55 : 1,
      child: Material(
        color: off ? Tk.card2 : Tk.card,
        borderRadius: BorderRadius.circular(22),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: off ? () => h._toast('${it['name']}: $why') : () => _addFlow(o, it, sizes),
          child: Container(
            decoration: BoxDecoration(borderRadius: BorderRadius.circular(22), border: Border.all(color: Tk.line, width: .5)),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              if (img.isNotEmpty) SizedBox(height: 92, width: double.infinity, child: Image.network(img, fit: BoxFit.cover, errorBuilder: (_, _, _) => Container(color: Tk.fill2))),
              Expanded(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(14, 12, 12, 12),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text('${it['name']}', maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800, height: 1.15)),
                    if (off) Padding(padding: const EdgeInsets.only(top: 4), child: Text(why, style: TextStyle(color: Tk.red, fontSize: 16, fontWeight: FontWeight.w600))),
                    const Spacer(),
                    Row(children: [
                      Expanded(child: Text(price, style: TextStyle(fontSize: 19, color: Tk.label2, fontWeight: FontWeight.w500))),
                      Container(width: 24, height: 24, decoration: BoxDecoration(border: Border.all(color: vc, width: 2), borderRadius: BorderRadius.circular(6)), child: Center(child: Container(width: 10, height: 10, decoration: BoxDecoration(shape: BoxShape.circle, color: vc)))),
                    ]),
                  ]),
                ),
              ),
            ]),
          ),
        ),
      ),
    );
  }

  /// Same rule as addItemFlow() on the website: sizes, add-on groups, own extras or a note prompt open the option sheet.
  void _addFlow(Map<String, dynamic> o, Map it, List<Map> sizes) {
    final groups = ((it['addonGroups'] as List?) ?? []).map((id) => s.repo!.rec('$id')).whereType<Map>().toList();
    final own = _parseMods(groups.isNotEmpty ? it['ownMods'] : it['mods']);
    if (sizes.isEmpty && groups.isEmpty && own.isEmpty && it['askNote'] != true) {
      add(o, it, '', it['price']);
    } else {
      _optionSheet(o, it, sizes, groups, own);
    }
  }

  List<(String, num)> _parseMods(dynamic l) {
    final raw = l is List ? l.map((e) => '$e') : '${l ?? ''}'.split(',');
    return [
      for (final m in raw)
        if (m.trim().isNotEmpty) (m.split(':').first.trim(), num.tryParse(m.contains(':') ? m.split(':')[1].trim() : '') ?? 0),
    ];
  }

  void _optionSheet(Map<String, dynamic> o, Map it, List<Map> sizes, List<Map> groups, List<(String, num)> own) {
    final gs = [
      for (final g in groups) (name: '${g['name']}', min: (num.tryParse('${g['min'] ?? 0}') ?? 0).toInt(), max: (num.tryParse('${g['max'] ?? 0}') ?? 0).toInt(), mods: _parseMods(g['mods'])),
      if (own.isNotEmpty) (name: groups.isNotEmpty ? 'Extras' : 'Add-ons', min: 0, max: 0, mods: own),
    ];
    Map? size = sizes.isEmpty ? null : sizes.first;
    final picked = <int, Set<String>>{for (var i = 0; i < gs.length; i++) i: <String>{}};
    final note = TextEditingController();
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (ctx) => StatefulBuilder(builder: (ctx, set) {
        num unit() => (size != null ? size!['p'] as num : (it['price'] ?? 0) as num) + [for (var i = 0; i < gs.length; i++) for (final m in gs[i].mods) if (picked[i]!.contains(m.$1)) m.$2].fold<num>(0, (a, b) => a + b);
        return SafeArea(
          child: Padding(
            padding: EdgeInsets.fromLTRB(16, 0, 16, MediaQuery.of(ctx).viewInsets.bottom + 12),
            child: SingleChildScrollView(
              child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, mainAxisSize: MainAxisSize.min, children: [
                Text('${it['name']}', style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800)),
                if (sizes.isNotEmpty) ...[
                  const SectionLabel('Size'),
                  Group([for (final z in sizes) Li('${z['l']}', chevron: false, trailing: Row(mainAxisSize: MainAxisSize.min, children: [Text(inr(z['p'] as num), style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700)), const SizedBox(width: 8), Icon(identical(size, z) ? Icons.radio_button_checked : Icons.radio_button_off, color: Tk.accent)]), onTap: () => set(() => size = z))]),
                ],
                for (var i = 0; i < gs.length; i++) ...[
                  SectionLabel('${gs[i].name}${gs[i].min > 0 ? '  (choose at least ${gs[i].min})' : gs[i].max > 0 ? '  (up to ${gs[i].max})' : ''}'),
                  Group([
                    for (final m in gs[i].mods)
                      Li(m.$1, chevron: false, trailing: Row(mainAxisSize: MainAxisSize.min, children: [if (m.$2 != 0) Text('+${inr(m.$2)}', style: const TextStyle(fontSize: 17)), const SizedBox(width: 8), Icon(picked[i]!.contains(m.$1) ? Icons.check_box : Icons.check_box_outline_blank, color: Tk.accent)]), onTap: () => set(() {
                            final p = picked[i]!;
                            if (p.contains(m.$1)) {
                              p.remove(m.$1);
                            } else {
                              if (gs[i].max == 1) p.clear();
                              if (gs[i].max > 1 && p.length >= gs[i].max) return;
                              p.add(m.$1);
                            }
                          })),
                  ]),
                ],
                const SizedBox(height: 12),
                TextField(controller: note, decoration: InputDecoration(labelText: tr('Note for the kitchen'), hintText: tr('e.g. less spicy, no onion'))),
                const SizedBox(height: 12),
                FilledButton(
                  onPressed: () {
                    for (var i = 0; i < gs.length; i++) {
                      if (gs[i].min > 0 && picked[i]!.length < gs[i].min) {
                        ScaffoldMessenger.of(ctx).showSnackBar(SnackBar(content: Text('Choose at least ${gs[i].min} in ${gs[i].name}')));
                        return;
                      }
                    }
                    final mods = [for (var i = 0; i < gs.length; i++) ...picked[i]!];
                    final text = [if (mods.isNotEmpty) mods.join(', '), if (note.text.trim().isNotEmpty) note.text.trim()].join(' · ');
                    Navigator.pop(ctx);
                    add(o, it, size == null ? '' : '${size!['l']}', unit(), note: text);
                  },
                  child: Text('Add · ${inr(unit())}'),
                ),
              ]),
            ),
          ),
        );
      }),
    );
  }

  void add(Map<String, dynamic> o, Map it, String size, num price, {String note = ''}) {
    final lines = (o['lines'] as List).cast<Map<String, dynamic>>();
    final same = lines.where((l) => l['id'] == it['id'] && (l['size'] ?? '') == size && l['price'] == price && '${l['note'] ?? ''}' == note).firstOrNull;
    setState(() {
      if (same != null) {
        same['qty'] = (same['qty'] as num) + 1;
      } else {
        lines.add({'id': it['id'], 'name': it['name'], 'size': size, 'price': price, 'qty': 1, 'sent': 0, 'st': it['st'] ?? 'Kitchen', if (note.isNotEmpty) 'note': note});
      }
    });
    HapticFeedback.selectionClick();
  }

  void pickSize(Map<String, dynamic> o, Map it, List<Map> sizes) {
    showModalBottomSheet<void>(
      context: context,
      builder: (_) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(0, 0, 0, 12),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            Text('${it['name']}', style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800)),
            const SizedBox(height: 10),
            Group([for (final z in sizes) Li('${z['l']}', trailing: Text(inr(z['p'] as num), style: const TextStyle(fontSize: 19, fontWeight: FontWeight.w800)), onTap: () {
                  Navigator.pop(context);
                  add(o, it, '${z['l']}', z['p'] as num);
                })]),
          ]),
        ),
      ),
    );
  }

  void cartSheet(Map<String, dynamic> o) {
    showModalBottomSheet<void>(
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

        Widget tr(String l, num v, {bool bold = false}) => Padding(padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12), child: Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [Text(l, style: TextStyle(fontSize: bold ? 22 : 18, fontWeight: bold ? FontWeight.w800 : FontWeight.w500)), Text(inr(v), style: TextStyle(fontSize: bold ? 24 : 18, fontWeight: bold ? FontWeight.w800 : FontWeight.w600))]));
        Widget chip(IconData i, String l, Future<void> Function() f) => Padding(padding: const EdgeInsets.only(right: 8), child: PillBtn(l, icon: i, onTap: () async {
              await f();
              set(() {});
              setState(() {});
            }));
        return SafeArea(
          child: Padding(
            padding: EdgeInsets.only(bottom: MediaQuery.of(ctx).viewInsets.bottom),
            child: Column(mainAxisSize: MainAxisSize.min, children: [
              Padding(padding: const EdgeInsets.fromLTRB(20, 0, 8, 8), child: Row(children: [
                Expanded(child: Text('Order · ${o['type']}', style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w800))),
                TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Done', style: TextStyle(fontSize: 19))),
              ])),
              Flexible(
                child: ListView(shrinkWrap: true, children: [
                  Group([
                    for (final l in lines)
                      Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                        child: Row(children: [
                          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                            Text('${l['name']}${(l['size'] ?? '') != '' ? ' (${l['size']})' : ''}', style: const TextStyle(fontSize: 19, fontWeight: FontWeight.w600)),
                            Text('${inr(l['price'] as num)}${(l['sent'] ?? 0) > 0 ? ' · sent ${l['sent']}' : ''}', style: TextStyle(fontSize: 15, color: Tk.label2)),
                            if ('${l['note'] ?? ''}'.isNotEmpty) Text('${l['note']}', style: TextStyle(fontSize: 14, color: Tk.accent)),
                          ])),
                          Container(
                            decoration: BoxDecoration(color: Tk.fill, borderRadius: BorderRadius.circular(22)),
                            child: Row(children: [
                              IconButton(visualDensity: VisualDensity.compact, icon: const Icon(Icons.remove), onPressed: () => bump(l, -1)),
                              SizedBox(width: 22, child: Text('${l['qty']}', textAlign: TextAlign.center, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800))),
                              IconButton(visualDensity: VisualDensity.compact, icon: const Icon(Icons.add), onPressed: () => bump(l, 1)),
                            ]),
                          ),
                        ]),
                      ),
                  ]),
                  const SizedBox(height: 12),
                  Group([
                    tr('Subtotal', t.sub),
                    for (final of in t.offers) tr('${of['name']}', -(of['amt'] as num)),
                    if (t.d > 0) tr(o['complimentary'] == true ? 'Complimentary' : o['coupon'] != null ? 'Coupon ${o['coupon']}' : 'Discount', -t.d),
                    if (t.svc > 0) tr('Service charge', t.svc),
                    if (t.tax > 0) tr('GST', t.tax),
                    if (t.round != 0) tr('Round off', t.round),
                    tr('Total', t.total, bold: true),
                  ]),
                  const SizedBox(height: 12),
                  SingleChildScrollView(scrollDirection: Axis.horizontal, padding: const EdgeInsets.symmetric(horizontal: 16), child: Row(children: [
                    chip(Icons.percent, o['disc'] != null && o['complimentary'] != true ? 'Change discount' : 'Discount', () => discountSheet(ctx, s, o, () {})),
                    chip(Icons.local_offer_outlined, 'Coupon', () => couponSheet(ctx, s, o, () {})),
                    chip(Icons.card_giftcard, o['complimentary'] == true ? 'Complimentary ✓' : 'Complimentary', () => compSheet(ctx, s, o, () {})),
                    chip(Icons.person_outline, ((o['cust'] as Map?)?['name'] ?? '') != '' ? '${(o['cust'] as Map)['name']}' : 'Customer / note', () => customerSheet(ctx, o, () {})),
                    chip(Icons.call_split, 'Split bill', () async {
                      Navigator.pop(ctx);
                      await splitSheet(context, h, o);
                    }),
                    chip(Icons.cancel_outlined, 'Cancel order', () async {
                      if (await cancelOrder(ctx, h, o)) {
                        if (ctx.mounted) Navigator.pop(ctx);
                        h.refresh(() => h.cur = null);
                        h._toast('Order cancelled');
                      }
                    }),
                  ])),
                  const SizedBox(height: 14),
                ]),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
                child: Row(children: [
                  Expanded(child: OutlinedButton(onPressed: () async {
                    Navigator.pop(ctx);
                    await h.persist(o);
                    h.refresh(() => h.cur = null);
                    h._toast('Order held');
                  }, child: const Text('Hold'))),
                  const SizedBox(width: 8),
                  Expanded(child: OutlinedButton(onPressed: () async {
                    Navigator.pop(ctx);
                    await h.sendKitchen(o);
                    setState(() {});
                  }, child: const Text('Send to kitchen'))),
                  const SizedBox(width: 8),
                  Expanded(child: FilledButton(onPressed: () {
                    Navigator.pop(ctx);
                    payDialog(o);
                  }, child: Text('Pay ${inr(t.total)}', maxLines: 1))),
                ]),
              ),
            ]),
          ),
        );
      }),
    );
  }

  void payDialog(Map<String, dynamic> o) {
    final t = s.tot(o);
    showModalBottomSheet<void>(
      context: context,
      builder: (ctx) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Text('Take payment', textAlign: TextAlign.center, style: TextStyle(fontSize: 18, color: Tk.label2)),
            Text(inr(t.total), textAlign: TextAlign.center, style: TextStyle(fontSize: 40, fontWeight: FontWeight.w800)),
            SizedBox(height: 14),
            Group([
              for (final m in [['cash', 'Cash', Icons.payments_outlined, Tk.green], ['upi', 'UPI', Icons.qr_code_2, Tk.blue], ['card', 'Card', Icons.credit_card, Tk.purple]])
                Li(m[1] as String, icon: m[2] as IconData, tone: m[3] as Color, onTap: () async {
                  Navigator.pop(ctx);
                  await h.pay(o, m[0] as String);
                  h.refresh(() => h.cur = null);
                  if (context.mounted) await billActions(context, h, o);
                }),
            ]),
          ]),
        ),
      ),
    );
  }
}

class OrdersPage extends StatefulWidget {
  const OrdersPage(this.h, {super.key});
  final _HomeState h;
  @override
  State<OrdersPage> createState() => _OrdersPageState();
}

class _OrdersPageState extends State<OrdersPage> {
  String view = 'open';
  _HomeState get h => widget.h;
  Session get s => h.s;

  Color _tone(String st) => switch (st) { 'open' => Tk.orange, 'paid' => Tk.green, _ => Tk.red };
  Color _bg(String st) => switch (st) { 'open' => Tk.orangeBg, 'paid' => Tk.greenBg, _ => Tk.redBg };

  @override
  Widget build(BuildContext context) {
    final all = s.repo!.of('order').where((o) => (o['lines'] as List?)?.isNotEmpty ?? false).toList()..sort((a, b) => '${b['created']}'.compareTo('${a['created']}'));
    final open = all.where((o) => o['status'] == 'open').toList(), done = all.where((o) => o['status'] != 'open').take(40).toList();
    final shown = view == 'open' ? open : done;
    Widget row(Map<String, dynamic> o) {
      final t = (o['t'] as Map?)?['total'] ?? s.tot(o).total;
      final tb = o['table'] == null ? '' : ' · ${s.repo!.rec('${o['table']}')?['name'] ?? ''}';
      final st = '${o['status']}';
      return InkWell(
        onTap: () => orderSheet(context, h, o),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
          child: Row(children: [
            Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('${o['no'] ?? 'New order'}', style: const TextStyle(fontSize: 19, fontWeight: FontWeight.w700)),
              const SizedBox(height: 6),
              Wrap(spacing: 6, children: [
                _pill('${o['type']}$tb', Tk.fill, Tk.label),
                _pill(st == 'open' ? 'Open' : st == 'paid' ? 'Paid' : 'Cancelled', _bg(st), _tone(st)),
                if (st == 'open' && o['kstat'] != null) _pill('Kitchen: ${o['kstat']}', Tk.fill, Tk.label2),
              ]),
            ])),
            Text(inr(t as num), style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800)),
            Icon(Icons.chevron_right, color: Tk.label3),
          ]),
        ),
      );
    }

    return ListView(padding: const EdgeInsets.only(bottom: 24), children: [
      PageHead('Orders', sub: '${open.length} open · ${h.guests.length} from QR'),
      Padding(padding: const EdgeInsets.fromLTRB(16, 10, 16, 6), child: Seg<String>(expand: true, items: const [('open', 'Open'), ('recent', 'Recent')], value: view, onChanged: (v) => setState(() => view = v))),
      if (h.guests.isNotEmpty) ...[
        const SectionLabel('QR orders'),
        for (final x in h.guests) _guest(x),
      ],
      const SizedBox(height: 10),
      if (shown.isEmpty) const Padding(padding: EdgeInsets.only(top: 30), child: Empty(Icons.receipt_long_outlined, 'Nothing here yet', 'Orders you start in Sell show up here until they are paid.')) else Group([for (final o in shown) row(o)]),
    ]);
  }

  Widget _pill(String t, Color bg, Color fg) => Container(padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 5), decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(16)), child: Text(t, style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: fg)));

  Widget _guest(Map<String, dynamic> x) => Container(
        margin: const EdgeInsets.fromLTRB(16, 0, 16, 10),
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(color: Tk.card, borderRadius: BorderRadius.circular(22), border: Border.all(color: Tk.accent.withValues(alpha: .4), width: 1.2)),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Expanded(child: Text((x['tbl'] ?? '') == '' ? 'Takeaway' : 'Table ${s.repo!.rec('${x['tbl']}')?['name'] ?? x['tbl']}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 20))),
            _pill('New', Tk.accentSoft, Tk.accent),
          ]),
          if (x['name'] != null) Text('${x['name']} ${x['phone'] ?? ''}', style: TextStyle(color: Tk.label2, fontSize: 16)),
          const SizedBox(height: 8),
          for (final i in ((x['items'] as List?) ?? []).cast<Map>()) Text('${i['qty']} × ${i['name']}${(i['size'] ?? '') != '' ? ' (${i['size']})' : ''}${'${i['note'] ?? ''}'.isNotEmpty ? ' — ${i['note']}' : ''}', style: const TextStyle(fontSize: 18)),
          if (x['note'] != null) Padding(padding: const EdgeInsets.only(top: 4), child: Text('${x['note']}', style: TextStyle(fontStyle: FontStyle.italic, color: Tk.label2))),
          const SizedBox(height: 12),
          FilledButton(onPressed: () => h.acceptGuest(x), child: Text(((x['items'] as List?) ?? []).isEmpty ? 'Got it' : 'Accept and send to kitchen')),
        ]),
      );
}
