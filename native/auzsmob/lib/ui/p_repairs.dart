import 'package:flutter/material.dart' hide Text;
import '../core/calc.dart';
import '../core/ops.dart';
import '../core/session.dart';
import 'ds.dart';
import 'i18n.dart';
import 'mk.dart';
import 'theme.dart';

const _statusLabel = {'received': 'Received', 'in_repair': 'In repair', 'ready': 'Ready', 'delivered': 'Delivered', 'cancelled': 'Cancelled'};

String latestStatus(String repairId, List<Map<String, dynamic>> events) {
  final mine = events.where((e) => e['repair_id'] == repairId && e['type'] == 'status').toList()..sort((a, b) => '${b['created_at'] ?? ''}'.compareTo('${a['created_at'] ?? ''}'));
  return mine.isEmpty ? 'received' : '${mine.first['status']}';
}

String deviceLabel(Map<String, dynamic> r) {
  final d = '${r['device_model'] ?? ''}'.isNotEmpty ? '${r['device_model']}' : '${r['imei'] ?? ''}';
  return d.isEmpty ? tr('Repair job') : d;
}

Color _tone(String st) => switch (st) { 'ready' => Tk.green, 'in_repair' => Tk.orange, 'cancelled' => Tk.red, 'delivered' => Tk.label2, _ => Tk.blue };

class RepairsPage extends StatelessWidget {
  const RepairsPage(this.s, {super.key});
  final MobSession s;
  @override
  Widget build(BuildContext context) {
    final r = s.repo!;
    final events = r.rows('repairEvents');
    final mine = r.rows('repairs').where((x) => s.can('mob_reports') || x['staff_id'] == s.user!['id']).map((x) => {...x, '_status': latestStatus('${x['id']}', events)}).toList()..sort((a, b) => '${b['created_at'] ?? ''}'.compareTo('${a['created_at'] ?? ''}'));
    final open = mine.where((x) => !['delivered', 'cancelled'].contains(x['_status'])).toList();
    final closed = mine.where((x) => ['delivered', 'cancelled'].contains(x['_status'])).take(20).toList();
    Widget group(List<Map<String, dynamic>> l) => Group([
          for (final x in l)
            Li(deviceLabel(x), sub: '${x['customer_name'] ?? ''}', icon: Icons.build_outlined, tone: _tone('${x['_status']}'), trailing: Pill(tr(_statusLabel['${x['_status']}'] ?? '${x['_status']}'), tone: _tone('${x['_status']}')), onTap: () => Navigator.push(context, MaterialPageRoute<void>(builder: (_) => RepairDetailPage(s, '${x['id']}')))),
        ]);
    return TabPage('Repairs', [
      const SectionLabel('Open jobs'),
      if (open.isEmpty) emptyBox(Icons.build_outlined, tr('Nothing yet')) else group(open),
      if (closed.isNotEmpty) ...[const SectionLabel('Closed jobs'), group(closed)],
    ], actions: [iconBtn(Icons.add_circle, () => openRepairSheet(context, s), tip: 'New ticket')]);
  }
}

/// New repair ticket. Opened straight from a tap (never as a route), so a background refresh cannot stack a second sheet.
void openRepairSheet(BuildContext c, MobSession s) {
  final cn = TextEditingController(), cp = TextEditingController(), model = TextEditingController(), imei = TextEditingController(), problem = TextEditingController(), adv = TextEditingController(text: '0'), est = TextEditingController(), war = TextEditingController(text: '0');
  openSheet(c, 'New repair ticket', (ctx, set) => Column(children: [
        Row(children: [Expanded(child: Fld('Customer', cn, autofocus: true)), const SizedBox(width: 10), Expanded(child: Fld('Phone', cp, phone: true))]),
        gap(),
        Row(children: [Expanded(child: Fld('Device model', model)), const SizedBox(width: 10), Expanded(child: Fld('Serial / IMEI', imei))]),
        gap(),
        Fld('What is the problem?', problem, multiline: true),
        gap(),
        Row(children: [Expanded(child: Fld('Advance paid', adv, number: true)), const SizedBox(width: 10), Expanded(child: Fld('Estimate', est, number: true))]),
        gap(),
        Fld('Warranty (days)', war, number: true),
      ]), actions: [
    SheetAction('Save', (ctx) async {
      final id = newId();
      final p = {'customerName': cn.text.trim(), 'customerPhone': cp.text.trim(), 'deviceModel': model.text.trim(), 'imei': imei.text.trim(), 'problem': problem.text.trim(), 'advance': n(adv.text), 'estimate': est.text.trim().isEmpty ? null : n(est.text), 'warrantyDays': n(war.text)};
      final now = nowIso();
      await s.repo!.localPush('repairs', {'id': id, 'customer_name': p['customerName'], 'customer_phone': p['customerPhone'], 'device_model': p['deviceModel'], 'imei': p['imei'], 'problem': p['problem'], 'advance': p['advance'], 'estimate': p['estimate'], 'warranty_days': p['warrantyDays'], 'staff_id': s.user!['id'], 'created_at': now}, 'mob_create_repair', {'p_id': id, 'p': p});
      await s.repo!.put('repairEvents', {'id': newId(), 'repair_id': id, 'type': 'status', 'status': 'received', 'staff_id': s.user!['id'], 'created_at': now});
      s.repo!.refresh();
      if (c.mounted) {
        toast(c, tr('Saved'));
        Navigator.push(c, MaterialPageRoute<void>(builder: (_) => RepairDetailPage(s, id)));
      }
      return true;
    }),
  ]);
}

class RepairDetailPage extends StatelessWidget {
  const RepairDetailPage(this.s, this.id, {super.key});
  final MobSession s;
  final String id;

  Future<void> _event(BuildContext c, String type, Map<String, dynamic> p, Map<String, dynamic> local) async {
    final eid = newId();
    await s.repo!.localPush('repairEvents', {'id': eid, 'repair_id': id, 'type': type, 'staff_id': s.user!['id'], 'created_at': nowIso(), ...local}, 'mob_push_repair_event', {'p_id': eid, 'p_repair_id': id, 'p': {'type': type, ...p}});
    if (c.mounted) toast(c, tr('Saved'));
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: s.repo!,
      builder: (ctx, _) {
        final r = s.repo!.byId('repairs', id);
        if (r == null) return SubPage(tr('Repair job'), [emptyBox(Icons.build_outlined, tr('Nothing yet'))]);
        final events = s.repo!.rows('repairEvents').where((e) => e['repair_id'] == id).toList()..sort((a, b) => '${a['created_at'] ?? ''}'.compareTo('${b['created_at'] ?? ''}'));
        final status = latestStatus(id, events);
        final parts = events.where((e) => e['type'] == 'part').toList(), pays = events.where((e) => e['type'] == 'payment').toList();
        final canAct = s.can('mob_reports') || r['staff_id'] == s.user!['id'];
        return SubPage(deviceLabel(r), [
          Pad(Row(children: [Pill(tr(_statusLabel[status] ?? status), tone: _tone(status)), const Spacer(), Text(fmtDT(r['created_at']), style: TextStyle(color: Tk.label2))])),
          if (canAct) Pad(Wrap(spacing: 8, runSpacing: 8, children: [for (final st in repairStatuses) ChoiceChip(label: Text(_statusLabel[st]!), selected: st == status, onSelected: (_) => _event(ctx, 'status', {'status': st}, {'status': st}))])),
          const SectionLabel('Customer'),
          Group([Li('${r['customer_name'] ?? '—'}', sub: '${r['customer_phone'] ?? ''}', icon: Icons.person_outline, tone: Tk.label3, chevron: false)]),
          const SectionLabel('Problem'),
          Group([Li('${r['problem'] ?? '—'}'.isEmpty ? '—' : '${r['problem']}', chevron: false)]),
          if (parts.isNotEmpty) ...[
            const SectionLabel('Parts used'),
            Group([for (final p in parts) Li('${s.repo!.byId('items', '${p['item_id']}')?['name'] ?? p['item_id']}', sub: '${tr('Qty')} ${p['qty']}', value: inr(n(p['cost']) * n(p['qty'])), chevron: false)]),
          ],
          if (pays.isNotEmpty) ...[
            const SectionLabel('Payments'),
            Group([for (final p in pays) Li(inr(n(p['amount'])), sub: '${p['method']}', chevron: false)]),
          ],
          if (canAct) ...[
            gap(),
            Pad(Row(children: [
              Expanded(child: OutlinedButton.icon(onPressed: () => _addPart(ctx), icon: const Icon(Icons.inventory_2_outlined), label: const Text('Add part'))),
              const SizedBox(width: 10),
              Expanded(child: OutlinedButton.icon(onPressed: () => _addPay(ctx), icon: const Icon(Icons.payments_outlined), label: const Text('Add payment'))),
            ])),
          ],
        ]);
      },
    );
  }

  void _addPart(BuildContext c) {
    final items = s.repo!.rows('items').where((i) => i['active'] != false).toList();
    if (items.isEmpty) {
      toast(c, tr('Add at least one item'), err: true);
      return;
    }
    var sel = '${items.first['id']}';
    final qty = TextEditingController(text: '1');
    openSheet(c, 'Add part', (ctx, set) => Column(children: [Sel('Item name', sel, [for (final i in items) ('${i['id']}', '${i['name']}')], (v) => sel = v), gap(), Fld('Qty', qty, number: true)]), actions: [
      SheetAction('Add', (ctx) async {
        final item = items.firstWhere((i) => '${i['id']}' == sel);
        final q = n(qty.text) == 0 ? 1.0 : n(qty.text);
        await _event(c, 'part', {'itemId': item['id'], 'qty': q, 'cost': item['cost_price']}, {'item_id': item['id'], 'qty': q, 'cost': item['cost_price']});
        return true;
      }),
    ]);
  }

  void _addPay(BuildContext c) {
    final amt = TextEditingController();
    var m = 'cash';
    openSheet(c, 'Add payment', (ctx, set) => Column(children: [Fld('Amount', amt, number: true, autofocus: true), gap(), Sel('Payment mode', m, [('cash', tr('Cash')), ('upi', tr('UPI')), ('card', tr('Card'))], (v) => m = v)]), actions: [
      SheetAction('Add', (ctx) async {
        if (n(amt.text) == 0) {
          toast(ctx, tr('Enter an amount'), err: true);
          return false;
        }
        await _event(c, 'payment', {'amount': n(amt.text), 'method': m}, {'amount': n(amt.text), 'method': m});
        return true;
      }),
    ]);
  }
}
