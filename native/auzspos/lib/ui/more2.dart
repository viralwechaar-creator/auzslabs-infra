import 'package:flutter/material.dart';
import '../core/billing.dart' show r2;
import '../core/repo.dart';
import '../core/session.dart';
import 'home.dart';
import 'theme.dart';

String _hm(String iso) {
  final t = DateTime.tryParse(iso)?.toLocal();
  return t == null ? '' : '${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}';
}

String _day(DateTime t) => '${t.year}-${t.month.toString().padLeft(2, '0')}-${t.day.toString().padLeft(2, '0')}';

/// Attendance (clock in / out) and the manager approval PIN.
class StaffPage extends StatefulWidget {
  const StaffPage(this.h, {super.key});
  final HomeState h;
  @override
  State<StaffPage> createState() => _StaffPageState();
}

class _StaffPageState extends State<StaffPage> {
  Session get s => widget.h.s;

  void _t(String m) => ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m)));

  Future<void> _setPin() async {
    final c = TextEditingController();
    final v = await showDialog<String>(
      context: context,
      builder: (d) => AlertDialog(
        title: const Text('Approval PIN'),
        content: Column(mainAxisSize: MainAxisSize.min, children: [
          const Text('Type this PIN on a cashier\'s till to approve discounts, cancellations and refunds.', style: TextStyle(color: Tk.label2)),
          TextField(controller: c, obscureText: true, keyboardType: TextInputType.number, maxLength: 8, autofocus: true, decoration: const InputDecoration(labelText: '4 to 8 digits')),
        ]),
        actions: [TextButton(onPressed: () => Navigator.pop(d), child: const Text('Cancel')), FilledButton(onPressed: () => Navigator.pop(d, c.text), child: const Text('Save'))],
      ),
    );
    if (v == null) return;
    if (v.length < 4) return _t('Use 4 to 8 digits');
    try {
      await s.api.rpc('pos_set_pin', {'p_pin': v});
      _t('Approval PIN saved');
    } catch (e) {
      _t('$e');
    }
  }

  @override
  Widget build(BuildContext context) {
    final uid = '${s.user!['id']}';
    final mine = s.repo!.of('shift').where((x) => x['u'] == uid).toList()..sort((a, b) => '${b['in']}'.compareTo('${a['in']}'));
    final open = mine.where((x) => x['out'] == null).firstOrNull;
    return Scaffold(
      appBar: AppBar(title: const Text('Attendance and PIN')),
      body: ListView(padding: const EdgeInsets.all(12), children: [
        Card(
          child: ListTile(
            leading: Icon(Icons.schedule, color: open != null ? Tk.green : Tk.label2),
            title: Text(open != null ? 'On shift since ${_hm('${open['in']}')}' : 'Not clocked in', style: const TextStyle(fontWeight: FontWeight.w700)),
            trailing: FilledButton(
              onPressed: () async {
                if (open != null) {
                  await s.repo!.save('shift', {...open, 'out': nowIso()}, id: '${open['id']}');
                } else {
                  await s.repo!.save('shift', {'u': uid, 'e': '${s.user!['email'] ?? ''}', 'in': nowIso()});
                }
                s.sync();
                setState(() {});
              },
              child: Text(open != null ? 'Clock out' : 'Clock in'),
            ),
          ),
        ),
        for (final x in mine.where((x) => x['out'] != null).take(10))
          Card(child: ListTile(dense: true, title: Text('${'${x['in']}'.substring(0, 10)}  ${_hm('${x['in']}')} to ${_hm('${x['out']}')}'), trailing: Text('${DateTime.parse('${x['out']}').difference(DateTime.parse('${x['in']}')).inMinutes} min'))),
        if (s.can('m')) ...[
          const SizedBox(height: 12),
          Card(child: ListTile(leading: Icon(Icons.lock_outline, color: Tk.accent), title: const Text('Set my approval PIN', style: TextStyle(fontWeight: FontWeight.w700)), subtitle: const Text('For approving discounts, cancellations and refunds on other tills'), onTap: _setPin)),
        ],
      ]),
    );
  }
}

/// Business settings (owner only): the same fields the website POS applies to every bill.
class SettingsPage extends StatefulWidget {
  const SettingsPage(this.h, {super.key});
  final HomeState h;
  @override
  State<SettingsPage> createState() => _SettingsPageState();
}

class _SettingsPageState extends State<SettingsPage> {
  Session get s => widget.h.s;
  late final Map<String, TextEditingController> c;
  late bool inclusive, roundOff, autoKot;

  @override
  void initState() {
    super.initState();
    final g = s.cfg;
    String v(String k) => g[k] == null ? '' : '${g[k]}';
    c = {for (final k in ['name', 'addr', 'phone', 'gstin', 'tax', 'serviceChargePct', 'packingCharge', 'deliveryCharge', 'maxDiscountPct', 'ftr', 'prefix']) k: TextEditingController(text: v(k))};
    inclusive = g['taxInclusive'] == true;
    roundOff = g['roundOff'] != false;
    autoKot = g['autoKot'] != false;
  }

  Widget _f(String k, String label, {bool number = false}) => Padding(padding: const EdgeInsets.only(bottom: 10), child: TextField(controller: c[k], keyboardType: number ? const TextInputType.numberWithOptions(decimal: true) : TextInputType.text, decoration: InputDecoration(labelText: label)));

  Future<void> _save() async {
    final cur = Map<String, dynamic>.from(s.repo!.rec('settings') ?? {});
    num n(String k) => num.tryParse(c[k]!.text.trim()) ?? 0;
    cur
      ..['name'] = c['name']!.text.trim()
      ..['addr'] = c['addr']!.text.trim()
      ..['phone'] = c['phone']!.text.trim()
      ..['gstin'] = c['gstin']!.text.trim()
      ..['ftr'] = c['ftr']!.text.trim()
      ..['prefix'] = c['prefix']!.text.trim().isEmpty ? 'INV' : c['prefix']!.text.trim()
      ..['tax'] = n('tax')
      ..['serviceChargePct'] = n('serviceChargePct')
      ..['packingCharge'] = n('packingCharge')
      ..['deliveryCharge'] = n('deliveryCharge')
      ..['maxDiscountPct'] = n('maxDiscountPct')
      ..['taxInclusive'] = inclusive
      ..['roundOff'] = roundOff
      ..['autoKot'] = autoKot;
    await s.repo!.save('settings', cur, id: 'settings');
    s.sync();
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Settings saved')));
    Navigator.pop(context);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Settings')),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        _f('name', 'Business name'),
        _f('addr', 'Address'),
        _f('phone', 'Phone'),
        _f('gstin', 'GSTIN'),
        const Padding(padding: EdgeInsets.symmetric(vertical: 6), child: Text('Billing', style: TextStyle(fontWeight: FontWeight.w800))),
        _f('tax', 'Default tax %', number: true),
        SwitchListTile(contentPadding: EdgeInsets.zero, title: const Text('Prices include tax'), value: inclusive, onChanged: (v) => setState(() => inclusive = v)),
        SwitchListTile(contentPadding: EdgeInsets.zero, title: const Text('Round the bill to a whole rupee'), value: roundOff, onChanged: (v) => setState(() => roundOff = v)),
        _f('serviceChargePct', 'Service charge % (dine-in)', number: true),
        _f('packingCharge', 'Packing charge (takeaway and delivery)', number: true),
        _f('deliveryCharge', 'Delivery charge', number: true),
        _f('maxDiscountPct', 'Discount a cashier may give alone (%, 0 = always ask a manager)', number: true),
        SwitchListTile(contentPadding: EdgeInsets.zero, title: const Text('Send to kitchen prints the ticket automatically'), value: autoKot, onChanged: (v) => setState(() => autoKot = v)),
        _f('prefix', 'Bill number prefix'),
        _f('ftr', 'Message at the bottom of the bill'),
        const SizedBox(height: 8),
        FilledButton(onPressed: _save, child: const Text('Save settings')),
        const SizedBox(height: 8),
        const Text('Menu, prices, taxes, tables and staff are changed in the Admin console on the website.', style: TextStyle(color: Tk.label2, fontSize: 12)),
      ]),
    );
  }
}

/// Sales over a period, worked out on the phone from the orders it holds.
class ReportsPage extends StatefulWidget {
  const ReportsPage(this.h, {super.key});
  final HomeState h;
  @override
  State<ReportsPage> createState() => _ReportsPageState();
}

class _ReportsPageState extends State<ReportsPage> {
  Session get s => widget.h.s;
  int days = 7;

  @override
  Widget build(BuildContext context) {
    final from = DateTime.now().subtract(Duration(days: days - 1));
    final fromDay = _day(from);
    String dayOf(dynamic iso) {
      final t = DateTime.tryParse('$iso')?.toLocal();
      return t == null ? '' : _day(t);
    }

    final paid = s.repo!.of('order').where((o) => o['status'] == 'paid' && dayOf(o['paidAt']).compareTo(fromDay) >= 0).toList();
    double total = 0, refunds = 0, disc = 0, tax = 0;
    final perDay = <String, double>{}, modes = <String, double>{}, types = <String, double>{}, items = <String, double>{}, itemQty = <String, num>{};
    for (final o in paid) {
      final t = (o['t'] as Map?) ?? {};
      final tt = ((t['total'] ?? 0) as num).toDouble();
      total += tt;
      disc += ((t['d'] ?? 0) as num).toDouble();
      tax += ((t['tax'] ?? 0) as num).toDouble();
      perDay[dayOf(o['paidAt'])] = (perDay[dayOf(o['paidAt'])] ?? 0) + tt;
      types['${o['type']}'] = (types['${o['type']}'] ?? 0) + tt;
      for (final p in ((o['pays'] as List?) ?? []).cast<Map>()) {
        modes['${p['m']}'] = (modes['${p['m']}'] ?? 0) + ((p['amt'] ?? 0) as num);
      }
      for (final r in ((o['refunds'] as List?) ?? []).cast<Map>()) {
        refunds += (r['amt'] ?? 0) as num;
      }
      for (final l in ((o['lines'] as List?) ?? []).cast<Map>()) {
        final k = '${l['name']}';
        items[k] = (items[k] ?? 0) + (l['price'] as num) * (l['qty'] as num);
        itemQty[k] = (itemQty[k] ?? 0) + (l['qty'] as num);
      }
    }
    final top = items.entries.toList()..sort((a, b) => b.value.compareTo(a.value));
    final dayKeys = perDay.keys.toList()..sort();
    final maxDay = perDay.values.fold<double>(0, (a, b) => a > b ? a : b);
    Widget kv(String k, String v) => Padding(padding: const EdgeInsets.symmetric(vertical: 3), child: Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [Text(k), Text(v, style: const TextStyle(fontWeight: FontWeight.w700))]));
    Widget box(String title, List<Widget> kids) => Card(child: Padding(padding: const EdgeInsets.all(14), child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [Text(title, style: const TextStyle(fontWeight: FontWeight.w800)), const SizedBox(height: 6), ...kids])));
    return Scaffold(
      appBar: AppBar(title: const Text('Reports')),
      body: ListView(padding: const EdgeInsets.all(12), children: [
        SegmentedButton<int>(segments: const [ButtonSegment(value: 1, label: Text('Today')), ButtonSegment(value: 7, label: Text('7 days')), ButtonSegment(value: 30, label: Text('30 days'))], selected: {days}, onSelectionChanged: (v) => setState(() => days = v.first)),
        const SizedBox(height: 10),
        Card(child: Padding(padding: const EdgeInsets.all(16), child: Column(children: [Text(inr(total), style: const TextStyle(fontSize: 32, fontWeight: FontWeight.w800)), Text('${paid.length} bills · average ${inr(paid.isEmpty ? 0 : r2(total / paid.length))}', style: const TextStyle(color: Tk.label2))]))),
        box('Summary', [kv('Tax collected', inr(r2(tax))), kv('Discounts given', inr(r2(disc))), kv('Refunds', inr(r2(refunds)))]),
        if (dayKeys.length > 1)
          box('Sales by day', [
            for (final d in dayKeys)
              Padding(padding: const EdgeInsets.symmetric(vertical: 3), child: Row(children: [SizedBox(width: 48, child: Text(d.substring(5), style: const TextStyle(fontSize: 12))), Expanded(child: LinearProgressIndicator(value: maxDay == 0 ? 0 : perDay[d]! / maxDay, minHeight: 10, color: Tk.accent, backgroundColor: Tk.accent.withValues(alpha: .1))), const SizedBox(width: 8), Text(inr(r2(perDay[d]!)), style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700))])),
          ]),
        box('By payment', [for (final e in modes.entries) kv(e.key, inr(r2(e.value))), if (modes.isEmpty) const Text('No payments')]),
        box('By order type', [for (final e in types.entries) kv(e.key, inr(r2(e.value))), if (types.isEmpty) const Text('No sales')]),
        box('Top items', [for (final e in top.take(10)) kv('${e.key} × ${itemQty[e.key]}', inr(r2(e.value))), if (top.isEmpty) const Text('No sales')]),
      ]),
    );
  }
}
