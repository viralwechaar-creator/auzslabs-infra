import 'package:flutter/material.dart';
import '../core/repo.dart';
import 'home.dart';
import 'theme.dart';
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
    return Column(children: [
      if (secs.length > 1)
        SizedBox(
          height: 52,
          child: ListView(scrollDirection: Axis.horizontal, padding: const EdgeInsets.symmetric(horizontal: 8), children: [
            for (final s in ['all', ...secs]) Padding(padding: const EdgeInsets.all(6), child: ChoiceChip(label: Text(s == 'all' ? 'All' : s), selected: sec == s, onSelected: (_) => setState(() => sec = s))),
          ]),
        ),
      Padding(padding: const EdgeInsets.fromLTRB(16, 4, 16, 4), child: Align(alignment: Alignment.centerLeft, child: Text('$busy of ${states.length} tables busy', style: const TextStyle(color: Tk.label2)))),
      Expanded(
        child: GridView.builder(
          padding: const EdgeInsets.all(12),
          gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(maxCrossAxisExtent: 170, mainAxisExtent: 104, crossAxisSpacing: 10, mainAxisSpacing: 10),
          itemCount: states.length,
          itemBuilder: (_, i) {
            final (t, s) = states[i];
            final c = _tone(s.st);
            final amt = s.o == null ? null : h.s.tot(s.o!).total;
            return Material(
              color: s.st == 'free' ? Tk.card : c.withValues(alpha: .1),
              borderRadius: BorderRadius.circular(16),
              child: InkWell(
                borderRadius: BorderRadius.circular(16),
                onTap: () => _tap(t, s),
                child: Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(borderRadius: BorderRadius.circular(16), border: Border.all(color: s.st == 'free' ? Tk.line : c.withValues(alpha: .5))),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Row(children: [Expanded(child: Text('${t['name']}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 17))), if (t['seats'] != null) Text('${t['seats']} seats', style: const TextStyle(fontSize: 11, color: Tk.label2))]),
                    const Spacer(),
                    Text(_label[s.st]!, style: TextStyle(color: c, fontWeight: FontWeight.w600, fontSize: 13)),
                    if (s.o != null) Text('${inr(amt!)} · ${_mins(s.o!['created'])}', style: const TextStyle(fontSize: 12, color: Tk.label2)),
                  ]),
                ),
              ),
            );
          },
        ),
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

class KitchenPage extends StatelessWidget {
  const KitchenPage(this.h, {super.key});
  final HomeState h;

  @override
  Widget build(BuildContext context) {
    final r = h.s.repo!;
    final all = r.of('order').where((o) => o['status'] != 'void').toList();
    final queue = all.where((o) => o['kstat'] == 'new' || o['kstat'] == 'preparing').toList()..sort((a, b) => '${a['ktime']}'.compareTo('${b['ktime']}'));
    final ready = all.where((o) => o['kstat'] == 'ready').toList()..sort((a, b) => '${a['readyAt']}'.compareTo('${b['readyAt']}'));
    final out = all.where((o) => o['kstat'] == 'dispatched').toList();
    final target = (h.s.cfg['kdsTargetMin'] ?? 15) as num;
    return ListView(padding: const EdgeInsets.all(12), children: [
      if (queue.isEmpty && ready.isEmpty && out.isEmpty) const Padding(padding: EdgeInsets.only(top: 60), child: Empty(Icons.soup_kitchen_outlined, 'Kitchen is clear', 'New orders sent to the kitchen show up here as tickets.')),
      for (final o in queue) _ticket(context, o, target),
      if (ready.isNotEmpty) ...[
        const Padding(padding: EdgeInsets.fromLTRB(4, 12, 4, 6), child: Text('Ready', style: TextStyle(fontWeight: FontWeight.w800))),
        for (final o in ready)
          Card(
            child: ListTile(
              leading: const Icon(Icons.check_circle, color: Tk.green),
              title: Text('${o['no']} · ${o['type']}${o['table'] != null ? ' · ${_tn(o['table'])}' : ''}'),
              subtitle: Text('Ready ${_mins(o['readyAt'])}'),
              trailing: FilledButton.tonal(onPressed: () => _set(o, o['type'] == 'Dine-in' ? 'served' : 'dispatched'), child: Text(o['type'] == 'Dine-in' ? 'Served' : 'Handed over')),
            ),
          ),
      ],
      if (out.isNotEmpty) ...[
        const Padding(padding: EdgeInsets.fromLTRB(4, 12, 4, 6), child: Text('Out for delivery', style: TextStyle(fontWeight: FontWeight.w800))),
        for (final o in out) Card(child: ListTile(title: Text('${o['no']}'), subtitle: Text('${_mins(o['dispatchAt'])}'), trailing: FilledButton.tonal(onPressed: () => _set(o, 'done'), child: const Text('Delivered')))),
      ],
    ]);
  }

  String _tn(dynamic id) => '${h.s.repo!.rec('$id')?['name'] ?? ''}';

  Widget _ticket(BuildContext context, Map<String, dynamic> o, num target) {
    final started = DateTime.tryParse('${o['ktime']}');
    final late = started != null && DateTime.now().difference(started).inMinutes >= target;
    final batches = ((o['kotBatches'] as List?) ?? []).cast<Map>();
    final items = <Map>[...((o['knew'] as List?) ?? []).cast<Map>()];
    final prep = o['kstat'] == 'preparing';
    final typeColor = switch (o['type']) { 'Dine-in' => Tk.accent, 'Delivery' => Tk.orange, _ => Tk.green };
    return Card(
      margin: const EdgeInsets.only(bottom: 10),
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
