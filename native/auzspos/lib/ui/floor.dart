import 'package:flutter/material.dart';
import '../core/repo.dart';
import 'home.dart';
import 'theme.dart';
import 'ds.dart';
import 'more.dart';
import 'kit.dart';
import 'admin.dart';

String _mins(dynamic iso) {
  final t = DateTime.tryParse('$iso');
  if (t == null) return '';
  final m = DateTime.now().difference(t).inMinutes;
  return m < 1 ? 'just now' : '$m min';
}

/// Table state, same meaning as tableState() in the website POS.
({String st, Map<String, dynamic>? o}) tableState(HomeState h, Map<String, dynamic> t) {
  final o = h.s.repo!.of('order').where((x) => x['status'] == 'open' && x['table'] == t['id'] && ((x['lines'] as List?)?.isNotEmpty ?? false)).firstOrNull;
  if (o != null) {
    final k = o['kstat'];
    return (st: k == null ? 'placed' : k == 'new' ? 'kot' : k == 'preparing' ? 'prep' : k == 'ready' ? 'ready' : 'bill', o: o);
  }
  if (t['cleaned'] == false) return (st: 'dirty', o: null);
  return (st: 'free', o: null);
}

const _label = {'free': 'Available', 'placed': 'Ordering', 'kot': 'In kitchen', 'prep': 'Preparing', 'ready': 'Ready to serve', 'bill': 'Served · bill pending', 'dirty': 'Needs cleaning'};

Color _tone(String st) => switch (st) { 'kot' || 'prep' => Tk.orange, 'ready' => Tk.green, 'bill' => Tk.accent, 'dirty' => Colors.grey, _ => Tk.label2 };

class TablesPage extends StatefulWidget {
  const TablesPage(this.h, {super.key});
  final HomeState h;
  @override
  State<TablesPage> createState() => _TablesPageState();
}

class _TablesPageState extends State<TablesPage> {
  String sec = 'all';
  @override
  Widget build(BuildContext context) {
    final h = widget.h;
    final all = h.s.repo!.of('table').toList()..sort((a, b) => '${a['name']}'.compareTo('${b['name']}'));
    if (all.isEmpty) return Empty(Icons.table_restaurant_outlined, 'No tables yet', 'Add your tables to take dine-in orders and print a QR code for each one.', action: h.s.can('m') ? 'Add tables' : null, onAction: h.s.can('m') ? () => Navigator.push(context, MaterialPageRoute<void>(builder: (_) => TablesAdmin(h))) : null);
    final secs = {for (final t in all) '${t['sec'] ?? 'Main'}'}.toList();
    final shown = all.where((t) => sec == 'all' || '${t['sec'] ?? 'Main'}' == sec).toList();
    final states = [for (final t in shown) (t, tableState(h, t))];
    final busy = states.where((e) => e.$2.o != null).length;
    return ListView(padding: const EdgeInsets.only(bottom: 24), children: [
      PageHead('Tables', sub: '${states.length - busy} tables free · $busy seated'),
      Padding(padding: const EdgeInsets.fromLTRB(16, 10, 16, 0), child: Row(children: [
        PillBtn('Takeaway', icon: Icons.shopping_bag_outlined, onTap: () {
          h.refresh(() {
            h.cur = h.newOrder(type: 'Takeaway');
            h.tab = 'sell';
          });
        }),
        const SizedBox(width: 12),
        PillBtn('Reservations', icon: Icons.event_available_outlined, onTap: () => Navigator.push(context, MaterialPageRoute<void>(builder: (_) => ReservationsPage(h)))),
      ])),
      if (secs.length > 1) Padding(padding: const EdgeInsets.fromLTRB(16, 14, 16, 0), child: Seg<String>(expand: true, items: [('all', 'All'), for (final x in secs) (x, x)], value: sec, onChanged: (v) => setState(() => sec = v))),
      Padding(
        padding: const EdgeInsets.fromLTRB(16, 14, 16, 0),
        child: GridView.builder(
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(maxCrossAxisExtent: 250, mainAxisExtent: 112, crossAxisSpacing: 12, mainAxisSpacing: 12),
          itemCount: states.length,
          itemBuilder: (_, i) {
            final (t, s) = states[i];
            final c = _tone(s.st);
            final amt = s.o == null ? null : h.s.tot(s.o!).total;
            return Material(
              color: s.st == 'free' ? Colors.white : c.withValues(alpha: .1),
              borderRadius: BorderRadius.circular(22),
              child: InkWell(
                borderRadius: BorderRadius.circular(22),
                onTap: () => _tap(t, s),
                child: Container(
                  padding: const EdgeInsets.fromLTRB(18, 16, 14, 14),
                  decoration: BoxDecoration(borderRadius: BorderRadius.circular(22), border: Border.all(color: s.st == 'free' ? Tk.line : c.withValues(alpha: .5), width: .8)),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Row(children: [Expanded(child: Text('${t['name']}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 28, letterSpacing: -.5))), if (t['seats'] != null) Text('${t['seats']} seats', style: const TextStyle(fontSize: 14, color: Tk.label2))]),
                    const Spacer(),
                    Text(s.st == 'free' ? 'Available' : _label[s.st]!, style: TextStyle(color: s.st == 'free' ? Tk.green : c, fontWeight: FontWeight.w600, fontSize: 19)),
                    if (s.o != null) Text('${inr(amt!)} · ${_mins(s.o!['created'])}', style: const TextStyle(fontSize: 15, color: Tk.label2)),
                  ]),
                ),
              ),
            );
          },
        ),
      ),
      Padding(
        padding: const EdgeInsets.fromLTRB(18, 18, 16, 0),
        child: Wrap(spacing: 18, runSpacing: 10, children: [
          for (final (c, l) in [(Tk.label3, 'Ordering'), (const Color(0xFFF09A2E), 'In kitchen'), (const Color(0xFF34C759), 'Ready'), (const Color(0xFF263B30), 'Bill pending'), (Tk.blue, 'Reserved')])
            Row(mainAxisSize: MainAxisSize.min, children: [Container(width: 16, height: 16, decoration: BoxDecoration(color: c, borderRadius: BorderRadius.circular(4))), const SizedBox(width: 8), Text(l, style: const TextStyle(fontSize: 18, color: Tk.label2))]),
        ]),
      ),
    ]);
  }

  Future<void> _tap(Map<String, dynamic> t, ({String st, Map<String, dynamic>? o}) s) async {
    final h = widget.h;
    if (s.o != null) {
      h.openOrder(s.o!);
      return;
    }
    if (s.st == 'dirty') {
      final a = await showModalBottomSheet<String>(
        context: context,
        builder: (_) => SafeArea(child: Column(mainAxisSize: MainAxisSize.min, children: [
          ListTile(title: Text('${t['name']} needs cleaning', style: const TextStyle(fontWeight: FontWeight.w700)), subtitle: const Text('Mark it clean when it is ready for the next guests.')),
          ListTile(leading: const Icon(Icons.cleaning_services_outlined), title: const Text('Mark cleaned'), onTap: () => Navigator.pop(context, 'clean')),
          ListTile(leading: const Icon(Icons.event_seat_outlined), title: const Text('Seat guests anyway'), onTap: () => Navigator.pop(context, 'seat')),
        ])),
      );
      if (a == null) return;
      await h.s.repo!.save('table', {...t, 'cleaned': true, 'cleanedAt': nowIso(), 'cleanedBy': h.s.user!['id']}, id: '${t['id']}');
      h.s.sync();
      if (a == 'clean') {
        h.toast('${t['name']} is ready');
        setState(() {});
        return;
      }
    }
    h.startDineIn('${t['id']}');
  }
}

class KitchenPage extends StatefulWidget {
  const KitchenPage(this.h, {super.key});
  final HomeState h;
  @override
  State<KitchenPage> createState() => _KitchenPageState();
}

class _KitchenPageState extends State<KitchenPage> {
  String station = 'all', type = 'all';
  HomeState get h => widget.h;

  @override
  Widget build(BuildContext context) {
    final r = h.s.repo!;
    bool typeOk(Map o) => type == 'all' || o['type'] == type;
    final all = r.of('order').where((o) => o['status'] != 'void' && typeOk(o)).toList();
    final queue = all.where((o) => o['kstat'] == 'new' || o['kstat'] == 'preparing').toList()..sort((a, b) => '${a['ktime']}'.compareTo('${b['ktime']}'));
    final ready = all.where((o) => o['kstat'] == 'ready').toList()..sort((a, b) => '${a['readyAt']}'.compareTo('${b['readyAt']}'));
    final out = all.where((o) => o['kstat'] == 'dispatched').toList();
    final target = (h.s.cfg['kdsTargetMin'] ?? 15) as num;
    final stations = {'Kitchen', 'Dessert', 'Bar', for (final i in r.of('item')) '${i['st'] ?? 'Kitchen'}'}.toList();
    final waiting = r.of('order').where((o) => o['status'] != 'void' && (o['kstat'] == 'new' || o['kstat'] == 'preparing')).length;
    return ListView(padding: const EdgeInsets.only(bottom: 24), children: [
      PageHead('Kitchen', sub: '$waiting ticket${waiting == 1 ? '' : 's'} waiting · target $target min'),
      Padding(padding: const EdgeInsets.fromLTRB(16, 12, 16, 0), child: SingleChildScrollView(scrollDirection: Axis.horizontal, child: Seg<String>(items: [('all', 'All'), for (final x in stations) (x, x)], value: station, onChanged: (v) => setState(() => station = v)))),
      Padding(padding: const EdgeInsets.fromLTRB(16, 10, 16, 14), child: SingleChildScrollView(scrollDirection: Axis.horizontal, child: Seg<String>(items: const [('all', 'All'), ('Dine-in', 'Dine-in'), ('Takeaway', 'Takeaway'), ('Delivery', 'Delivery')], value: type, onChanged: (v) => setState(() => type = v)))),
      if (queue.isEmpty && ready.isEmpty && out.isEmpty)
        Container(
          margin: const EdgeInsets.symmetric(horizontal: 16),
          padding: const EdgeInsets.symmetric(vertical: 44, horizontal: 20),
          decoration: BoxDecoration(color: Tk.card, borderRadius: BorderRadius.circular(22), border: Border.all(color: Tk.line, width: .5)),
          child: const Column(children: [
            Icon(Icons.local_fire_department_outlined, size: 48, color: Tk.label3),
            SizedBox(height: 14),
            Text('No orders waiting', style: TextStyle(fontSize: 22, fontWeight: FontWeight.w800)),
            SizedBox(height: 8),
            Text('New kitchen tickets appear here the moment they are sent.', textAlign: TextAlign.center, style: TextStyle(fontSize: 19, color: Tk.label2)),
          ]),
        ),
      for (final o in queue) _ticket(context, o, target),
      if (ready.isNotEmpty) ...[
        const SectionLabel('Ready'),
        Group([
          for (final o in ready)
            Li('${o['no']} · ${o['type']}${o['table'] != null ? ' · ${_tn(o['table'])}' : ''}', sub: 'Ready ${_mins(o['readyAt'])}', icon: Icons.check, tone: Tk.green, trailing: FilledButton(style: FilledButton.styleFrom(minimumSize: const Size(0, 44), padding: const EdgeInsets.symmetric(horizontal: 16)), onPressed: () => _set(o, o['type'] == 'Dine-in' ? 'served' : 'dispatched'), child: Text(o['type'] == 'Dine-in' ? 'Served' : 'Handed over'))),
        ]),
      ],
      if (out.isNotEmpty) ...[
        const SectionLabel('Out for delivery'),
        Group([for (final o in out) Li('${o['no']}', sub: _mins(o['dispatchAt']), icon: Icons.delivery_dining, tone: Tk.orange, trailing: FilledButton(style: FilledButton.styleFrom(minimumSize: const Size(0, 44), padding: const EdgeInsets.symmetric(horizontal: 16)), onPressed: () => _set(o, 'done'), child: const Text('Delivered')))]),
      ],
    ]);
  }

  String _tn(dynamic id) => '${h.s.repo!.rec('$id')?['name'] ?? ''}';

  Widget _ticket(BuildContext context, Map<String, dynamic> o, num target) {
    final started = DateTime.tryParse('${o['ktime']}');
    final late = started != null && DateTime.now().difference(started).inMinutes >= target;
    final batches = ((o['kotBatches'] as List?) ?? []).cast<Map>();
    final items = <Map>[...((o['knew'] as List?) ?? []).cast<Map>()].where((i) => station == 'all' || '${i['s'] ?? 'Kitchen'}' == station).toList();
    if (items.isEmpty) return const SizedBox.shrink();
    final prep = o['kstat'] == 'preparing';
    final typeColor = switch (o['type']) { 'Dine-in' => Tk.accent, 'Delivery' => Tk.orange, _ => Tk.green };
    return Card(
      margin: const EdgeInsets.fromLTRB(16, 0, 16, 12),
      clipBehavior: Clip.antiAlias,
      child: Container(
        decoration: BoxDecoration(border: Border(top: BorderSide(color: late ? Tk.red : typeColor, width: 4))),
        padding: const EdgeInsets.all(14),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Expanded(child: Text('${o['no']} · ${o['type']}${o['table'] != null ? ' · ${_tn(o['table'])}' : ''}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16))),
            Text(_mins(o['ktime']), style: TextStyle(color: late ? Tk.red : Tk.label2, fontWeight: FontWeight.w700)),
          ]),
          if (batches.isNotEmpty && batches.last['no'] != null) Text('KOT #${batches.last['no']}', style: const TextStyle(color: Tk.label2, fontSize: 12)),
          const SizedBox(height: 8),
          for (final i in items) Padding(padding: const EdgeInsets.symmetric(vertical: 2), child: Text('${i['q']} × ${i['n']}${i['note'] != null ? '  (${i['note']})' : ''}', style: const TextStyle(fontSize: 16))),
          const SizedBox(height: 10),
          SizedBox(width: double.infinity, child: prep ? FilledButton(onPressed: () => _set(o, 'ready'), child: const Text('Mark ready')) : FilledButton.tonal(onPressed: () => _set(o, 'preparing'), child: const Text('Start preparing'))),
        ]),
      ),
    );
  }

  Future<void> _set(Map<String, dynamic> o, String k) async {
    final r = h.s.repo!;
    final c = Map<String, dynamic>.from(r.rec('${o['id']}') ?? o);
    c['kstat'] = k;
    final t = nowIso();
    if (k == 'preparing') c['preparingAt'] = t;
    if (k == 'ready') {
      c['readyAt'] = t;
      for (final kl in r.of('kotlog').where((x) => x['orderId'] == o['id'] && x['readyAt'] == null).toList()) {
        await r.save('kotlog', {...kl, 'readyAt': t}, id: '${kl['id']}');
      }
    }
    if (k == 'served') c['servedAt'] = t;
    if (k == 'dispatched') c['dispatchAt'] = t;
    if (k == 'done') c['deliveredAt'] = t;
    await r.save('order', c, id: '${o['id']}');
    h.s.sync();
  }
}
