import 'package:flutter/material.dart';
import '../core/billing.dart' show r2;
import '../core/repo.dart';
import '../core/session.dart';
import 'home.dart';
import 'more2.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:url_launcher/url_launcher.dart';
import 'admin.dart';
import 'ds.dart';
import 'scan.dart';
import 'theme.dart';

String _hm(String iso) {
  final t = DateTime.tryParse(iso)?.toLocal();
  return t == null ? '' : '${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}';
}

String _today() {
  final d = DateTime.now();
  return '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
}

class MorePage extends StatefulWidget {
  const MorePage(this.h, {super.key});
  final HomeState h;
  @override
  State<MorePage> createState() => _MorePageState();
}

class _MorePageState extends State<MorePage> {
  HomeState get h => widget.h;
  Session get s => h.s;
  bool alert = true;

  @override
  void initState() {
    super.initState();
    SharedPreferences.getInstance().then((p) {
      if (mounted) setState(() => alert = p.getBool('alertSound') ?? true);
    });
  }

  void _go(Widget Function() page) => Navigator.push(context, MaterialPageRoute<void>(builder: (_) => page()));
  void _site(String page) => launchUrl(Uri.https('auzslab.in', '/$page'), mode: LaunchMode.externalApplication);
  void _web(String page) => launchUrl(Uri.https('app.auzslab.in', '/$page'), mode: LaunchMode.externalApplication);

  Future<void> _clock() async {
    final uid = '${s.user!['id']}';
    final open = s.repo!.of('shift').where((x) => x['u'] == uid && x['out'] == null).firstOrNull;
    if (open != null) {
      await s.repo!.save('shift', {...open, 'out': nowIso()}, id: '${open['id']}');
    } else {
      await s.repo!.save('shift', {'u': uid, 'e': '${s.user!['email'] ?? ''}', 'in': nowIso()});
    }
    s.sync();
    setState(() {});
  }

  void _help() {
    showModalBottomSheet<void>(
      context: context,
      builder: (_) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.only(bottom: 12),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            const Text('Help and report a problem', style: TextStyle(fontSize: 22, fontWeight: FontWeight.w800)),
            const SizedBox(height: 12),
            Group([
              Li('Call us', icon: Icons.call, tone: Tk.green, value: '+91 92512 50829', onTap: () => launchUrl(Uri.parse('tel:+919251250829'))),
              Li('WhatsApp', icon: Icons.chat, tone: const Color(0xFF25D366), onTap: () => launchUrl(Uri.parse('https://wa.me/919251250829'), mode: LaunchMode.externalApplication)),
              Li('Email', icon: Icons.mail_outline, tone: Tk.blue, onTap: () => launchUrl(Uri.parse('mailto:helloauzslab@gmail.com?subject=AUZsPOS%20help'))),
            ]),
          ]),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final uid = '${s.user!['id']}';
    final open = s.repo!.of('shift').where((x) => x['u'] == uid && x['out'] == null).firstOrNull;
    final role = '${s.role[0].toUpperCase()}${s.role.substring(1)}';
    final m = s.can('m');
    return ListView(padding: const EdgeInsets.only(bottom: 28), children: [
      PageHead('More', sub: '${s.user?['email'] ?? s.user?['username'] ?? ''} · $role'),
      const SizedBox(height: 12),
      Group([
        Li('Reservations', icon: Icons.event_available_outlined, tone: Tk.blue, onTap: () => _go(() => ReservationsPage(h))),
        Li('Register', icon: Icons.point_of_sale, tone: Tk.green, onTap: () => _go(() => RegisterPage(h))),
        Li('Today\'s report', icon: Icons.insights_outlined, tone: const Color(0xFFF09A2E), onTap: () => _go(() => DayReportPage(h))),
        if (s.can('reports')) Li('Reports', icon: Icons.bar_chart, tone: Tk.purple, onTap: () => _go(() => ReportsPage(h))),
      ]),
      const SectionLabel('Attendance'),
      Group([
        Li(open != null ? 'On shift since ${_hm('${open['in']}')}' : 'Not clocked in', icon: Icons.schedule, trailing: FilledButton(style: FilledButton.styleFrom(minimumSize: const Size(0, 46), padding: const EdgeInsets.symmetric(horizontal: 18)), onPressed: _clock, child: Text(open != null ? 'Clock out' : 'Clock in'))),
      ]),
      if (m) ...[
        const SectionLabel('Approvals'),
        Group([Li('Set my approval PIN', sub: 'Type it on a cashier\'s till to approve discounts, cancellations and refunds', icon: Icons.lock_outline, tone: const Color(0xFFF09A2E), onTap: () => _go(() => StaffPage(h)))]),
      ],
      const SectionLabel('This device'),
      Group([
        Li('Alert sound on this device', sub: 'Loud new-order beep and vibration', icon: Icons.notifications_active_outlined, tone: Tk.red, chevron: false, trailing: Switch(value: alert, onChanged: (v) async {
          setState(() => alert = v);
          (await SharedPreferences.getInstance()).setBool('alertSound', v);
        })),
        Li('Outlet', icon: Icons.apartment, value: '${s.cfg['name']}', chevron: false),
        Li('Receipt printer', icon: Icons.print_outlined, value: 'Print window', chevron: false),
        Li('Sync now', icon: Icons.bolt, onTap: () {
          s.sync();
          h.toast('Syncing…');
        }),
      ]),
      if (m) ...[
        const SectionLabel('Business tools'),
        Group([
          Li('Admin console', sub: 'Reports, menu, stock, customers, team, settings', icon: Icons.home_outlined, tone: Tk.purple, onTap: () => _go(() => AdminPage(h))),
          Li('Scan a QR code', sub: 'Read a table or website QR with the camera', icon: Icons.qr_code_scanner, tone: Tk.teal, onTap: () => scanAndHandle(context, h)),
          Li('QR Ordering', sub: 'Customize what customers see when they scan a table', icon: Icons.language, tone: const Color(0xFF4FA8C0), onTap: () => _go(() => QrWebsitePage(h))),
          if (s.featureOn('payroll')) Li('Payroll', icon: Icons.groups_outlined, tone: const Color(0xFFF09A2E), onTap: () => _web('payroll.html')),
          if (s.featureOn('mobile')) Li('AUZsMob', icon: Icons.phone_iphone, tone: Tk.blue, onTap: () => _web('mob.html')),
          if (s.featureOn('accounting')) Li('Accounting', icon: Icons.receipt_long_outlined, tone: const Color(0xFF4CC26A), onTap: () => _web('accounts.html')),
          Li('Inventory', sub: 'Check stock levels and adjust quantity on hand', icon: Icons.inventory_2_outlined, onTap: () => _go(() => StockAdmin(h))),
        ]),
      ],
      const SectionLabel('Account'),
      Group([
        Li('Plan & account', icon: Icons.bar_chart, onTap: () => _site('account.html')),
        Li('Help & report a problem', icon: Icons.help_outline, onTap: _help),
        Li('Backup, export or clear data', icon: Icons.cloud_download_outlined, onTap: () => _site('account.html')),
        Li('Sign out', icon: Icons.logout, tone: Tk.red, chevron: false, onTap: () async {
          if (s.repo!.pending > 0 && !await _confirm(context, 'Sign out with unsent changes?', '${s.repo!.pending} change(s) have not reached the server. Signing out now will lose them.')) return;
          await s.signOut();
        }),
        Li('Delete my account', icon: Icons.delete_outline, tone: Tk.red, chevron: false, onTap: () => launchUrl(Uri.https('auzslab.in', '/account.html'), mode: LaunchMode.externalApplication)),
      ]),
      const Padding(padding: EdgeInsets.only(top: 22), child: Center(child: Text('Powered by AUZslab', style: TextStyle(fontSize: 16, color: Tk.label2)))),
    ]);
  }
}

Future<bool> _confirm(BuildContext c, String t, String m) async => (await showDialog<bool>(context: c, builder: (d) => AlertDialog(title: Text(t), content: Text(m), actions: [TextButton(onPressed: () => Navigator.pop(d, false), child: const Text('Back')), FilledButton(onPressed: () => Navigator.pop(d, true), child: const Text('Continue'))]))) ?? false;

Map<String, dynamic>? currentRegister(Session s) {
  final open = s.repo!.of('register').where((r) => r['closedAt'] == null).toList()..sort((a, b) => '${b['openedAt']}'.compareTo('${a['openedAt']}'));
  return open.firstOrNull;
}

class RegSummary {
  RegSummary(this.methods, this.refundsCash, this.bills, this.sales, this.cashIn, this.cashOut, this.tipsCash, this.expected, this.moves);
  final Map<String, double> methods;
  final double refundsCash, sales, cashIn, cashOut, tipsCash, expected;
  final int bills;
  final List<Map<String, dynamic>> moves;
}

/// Port of registerSummary() in the website POS.
RegSummary registerSummary(Session s, Map<String, dynamic> reg) {
  final a = '${reg['openedAt']}', b = '${reg['closedAt'] ?? nowIso()}';
  bool inWin(dynamic iso) => iso != null && '$iso'.compareTo(a) >= 0 && '$iso'.compareTo(b) <= 0;
  final m = {'cash': 0.0, 'upi': 0.0, 'card': 0.0, 'giftcard': 0.0, 'other': 0.0};
  double refCash = 0, sales = 0, tipsCash = 0;
  var bills = 0;
  for (final o in s.repo!.of('order')) {
    if (o['status'] != 'paid' && o['status'] != 'due') continue;
    var counted = false;
    for (final p in ((o['pays'] as List?) ?? []).cast<Map>()) {
      final t = p['at'] ?? o['paidAt'] ?? o['dueAt'];
      if (!inWin(t)) continue;
      final k = m.containsKey(p['m']) ? '${p['m']}' : 'other';
      m[k] = m[k]! + ((p['amt'] ?? 0) as num);
      counted = true;
    }
    if (counted) {
      bills++;
      sales += (((o['t'] as Map?)?['total']) ?? 0) as num;
    }
    final tip = o['tip'];
    if (tip is Map && tip['m'] == 'cash' && inWin(o['paidAt'])) tipsCash += (tip['amt'] ?? 0) as num;
    for (final r in ((o['refunds'] as List?) ?? []).cast<Map>()) {
      if (inWin(r['at']) && (r['m'] ?? 'cash') == 'cash') refCash += (r['amt'] ?? 0) as num;
    }
  }
  final moves = s.repo!.of('cashmove').where((x) => x['register'] == reg['id'] || (x['register'] == null && inWin(x['at']))).toList();
  double sum(String type) => moves.where((x) => x['type'] == type).fold<double>(0, (a, x) => a + ((x['amt'] ?? 0) as num));
  final cin = sum('in'), cout = sum('out');
  final expected = r2(((reg['float'] ?? 0) as num) + m['cash']! + tipsCash - refCash + cin - cout);
  return RegSummary({for (final e in m.entries) e.key: r2(e.value)}, r2(refCash), bills, r2(sales), r2(cin), r2(cout), r2(tipsCash), expected, moves);
}

class RegisterPage extends StatefulWidget {
  const RegisterPage(this.h, {super.key});
  final HomeState h;
  @override
  State<RegisterPage> createState() => _RegisterPageState();
}

class _RegisterPageState extends State<RegisterPage> {
  Session get s => widget.h.s;
  void _t(String m) => ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m)));

  Future<String?> _num(String title, String label, {String hint = ''}) async {
    final c = TextEditingController();
    return showDialog<String>(context: context, builder: (d) => AlertDialog(title: Text(title), content: TextField(controller: c, autofocus: true, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: InputDecoration(labelText: label, hintText: hint)), actions: [TextButton(onPressed: () => Navigator.pop(d), child: const Text('Cancel')), FilledButton(onPressed: () => Navigator.pop(d, c.text), child: const Text('OK'))]));
  }

  Future<void> _open() async {
    final v = await _num('Open the register', 'Opening cash in the drawer');
    if (v == null) return;
    await s.repo!.save('register', {'name': 'Till', 'openedAt': nowIso(), 'openedBy': s.user!['id'], 'openedByName': '${s.user!['email'] ?? ''}', 'float': r2(double.tryParse(v) ?? 0), 'd': _today()});
    s.sync();
    setState(() {});
  }

  Future<void> _move(String type, Map<String, dynamic> reg) async {
    final amt = TextEditingController(), note = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (d) => AlertDialog(
        title: Text(type == 'in' ? 'Cash in' : 'Cash out'),
        content: Column(mainAxisSize: MainAxisSize.min, children: [
          TextField(controller: amt, autofocus: true, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: const InputDecoration(labelText: 'Amount')),
          const SizedBox(height: 8),
          TextField(controller: note, decoration: InputDecoration(labelText: 'What for', hintText: type == 'in' ? 'e.g. change from bank' : 'e.g. milk, bank deposit')),
        ]),
        actions: [TextButton(onPressed: () => Navigator.pop(d, false), child: const Text('Cancel')), FilledButton(onPressed: () => Navigator.pop(d, true), child: const Text('Record'))],
      ),
    );
    final v = r2(double.tryParse(amt.text) ?? 0);
    if (ok != true || v <= 0) return;
    await s.repo!.save('cashmove', {'d': _today(), 'type': type, 'who': '${s.user!['email'] ?? ''}', 'amt': v, 'note': note.text.trim(), 'by': s.user!['id'], 'at': nowIso(), 'register': reg['id']});
    s.sync();
    setState(() {});
  }

  Future<void> _close(Map<String, dynamic> reg) async {
    final sm = registerSummary(s, reg);
    final v = await _num('Close register', 'Cash counted in the drawer', hint: 'Expected ${inr(sm.expected)}');
    if (v == null) return;
    final counted = r2(double.tryParse(v) ?? 0);
    final done = {...reg, 'closedAt': nowIso(), 'closedBy': s.user!['id'], 'closedByName': '${s.user!['email'] ?? ''}', 'counted': counted, 'expected': sm.expected, 'variance': r2(counted - sm.expected), 'methods': sm.methods, 'refunds': {'cash': sm.refundsCash}, 'bills': sm.bills, 'sales': sm.sales, 'tips': sm.tipsCash, 'cashIn': sm.cashIn, 'cashOut': sm.cashOut};
    await s.repo!.save('register', done, id: '${reg['id']}');
    s.sync();
    if (!mounted) return;
    final diff = r2(counted - sm.expected);
    _t(diff.abs() < 1 ? 'Register closed. Balanced.' : 'Register closed. ${diff > 0 ? 'Over' : 'Short'} by ${inr(diff.abs())}');
    setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    final reg = currentRegister(s);
    final hist = s.repo!.of('register').where((r) => r['closedAt'] != null).toList()..sort((a, b) => '${b['closedAt']}'.compareTo('${a['closedAt']}'));
    return Scaffold(
      appBar: AppBar(title: const Text('Register')),
      body: ListView(padding: const EdgeInsets.all(12), children: [
        if (reg == null)
          Card(child: Padding(padding: const EdgeInsets.all(16), child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [const Text('The register is closed', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 16)), const SizedBox(height: 4), const Text('Count the cash in the drawer before the first sale.', style: TextStyle(color: Tk.label2)), const SizedBox(height: 12), FilledButton(onPressed: _open, child: const Text('Open register'))])))
        else
          ..._openView(reg),
        if (hist.isNotEmpty) ...[
          const Padding(padding: EdgeInsets.fromLTRB(4, 16, 4, 6), child: Text('Closed registers', style: TextStyle(fontWeight: FontWeight.w800))),
          for (final x in hist.take(10))
            Card(child: ListTile(title: Text('${'${x['openedAt']}'.substring(0, 10)} · ${(x['bills'] ?? 0)} bills'), subtitle: Text('Expected ${inr((x['expected'] ?? 0) as num)} · Counted ${inr((x['counted'] ?? 0) as num)}'), trailing: Text(((x['variance'] ?? 0) as num).abs() < 1 ? 'Balanced' : '${(x['variance'] as num) > 0 ? 'Over' : 'Short'} ${inr((x['variance'] as num).abs())}', style: TextStyle(color: ((x['variance'] ?? 0) as num).abs() < 1 ? Tk.green : Tk.red, fontWeight: FontWeight.w700)))),
        ],
      ]),
    );
  }

  List<Widget> _openView(Map<String, dynamic> reg) {
    final sm = registerSummary(s, reg), m = sm.methods;
    Widget kv(String k, double v, {bool bold = false}) => Padding(padding: const EdgeInsets.symmetric(vertical: 3), child: Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [Text(k, style: TextStyle(fontWeight: bold ? FontWeight.w800 : null)), Text(inr(v), style: TextStyle(fontWeight: bold ? FontWeight.w800 : null))]));
    return [
      Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Text('Open since ${'${reg['openedAt']}'.substring(11, 16)}', style: const TextStyle(color: Tk.label2)),
            const SizedBox(height: 6),
            Text(inr(sm.expected), textAlign: TextAlign.center, style: const TextStyle(fontSize: 32, fontWeight: FontWeight.w800)),
            const Text('Expected cash in the drawer', textAlign: TextAlign.center, style: TextStyle(color: Tk.label2)),
            const Divider(height: 24),
            kv('Opening cash', ((reg['float'] ?? 0) as num).toDouble()),
            kv('Cash sales', m['cash']!),
            if (sm.cashIn > 0) kv('Cash in', sm.cashIn),
            if (sm.cashOut > 0) kv('Cash out', -sm.cashOut),
            if (sm.refundsCash > 0) kv('Cash refunds', -sm.refundsCash),
            const Divider(height: 24),
            kv('UPI', m['upi']!),
            kv('Card', m['card']!),
            if (m['giftcard']! + m['other']! > 0) kv('Gift card / other', m['giftcard']! + m['other']!),
            kv('${sm.bills} bills · total sales', sm.sales, bold: true),
          ]),
        ),
      ),
      const SizedBox(height: 8),
      Row(children: [
        Expanded(child: OutlinedButton.icon(onPressed: () => _move('in', reg), icon: const Icon(Icons.add), label: const Text('Cash in'))),
        const SizedBox(width: 8),
        Expanded(child: OutlinedButton.icon(onPressed: () => _move('out', reg), icon: const Icon(Icons.remove), label: const Text('Cash out'))),
      ]),
      const SizedBox(height: 8),
      FilledButton.icon(onPressed: () => _close(reg), icon: const Icon(Icons.lock_outline), label: const Text('Close register')),
      if (sm.moves.isNotEmpty) ...[
        const Padding(padding: EdgeInsets.fromLTRB(4, 16, 4, 6), child: Text('Cash movements', style: TextStyle(fontWeight: FontWeight.w800))),
        for (final x in sm.moves) Card(child: ListTile(dense: true, leading: Icon(x['type'] == 'in' ? Icons.add_circle_outline : Icons.remove_circle_outline, color: x['type'] == 'in' ? Tk.green : Tk.orange), title: Text('${x['type'] == 'in' ? 'Cash in' : 'Cash out'}${(x['note'] ?? '') != '' ? ' · ${x['note']}' : ''}'), trailing: Text(inr((x['amt'] ?? 0) as num)))),
      ],
    ];
  }
}

class DayReportPage extends StatelessWidget {
  const DayReportPage(this.h, {super.key});
  final HomeState h;
  @override
  Widget build(BuildContext context) {
    final s = h.s, day = _today();
    final paid = s.repo!.of('order').where((o) => o['status'] == 'paid' && '${o['paidAt'] ?? ''}'.startsWith(day) || (o['status'] == 'paid' && _localDay('${o['paidAt'] ?? ''}') == day)).toList();
    final modes = <String, double>{};
    double total = 0, refunds = 0;
    for (final o in paid) {
      total += ((o['t'] as Map?)?['total'] ?? 0) as num;
      for (final p in ((o['pays'] as List?) ?? []).cast<Map>()) {
        modes['${p['m']}'] = (modes['${p['m']}'] ?? 0) + ((p['amt'] ?? 0) as num);
      }
      for (final r in ((o['refunds'] as List?) ?? []).cast<Map>()) {
        refunds += (r['amt'] ?? 0) as num;
      }
    }
    final voided = s.repo!.of('order').where((o) => o['status'] == 'void' && _localDay('${o['voidAt'] ?? ''}') == day).length;
    final open = s.repo!.of('order').where((o) => o['status'] == 'open' && ((o['lines'] as List?)?.isNotEmpty ?? false)).length;
    final byItem = <String, num>{};
    for (final o in paid) {
      for (final l in ((o['lines'] as List?) ?? []).cast<Map>()) {
        byItem['${l['name']}'] = (byItem['${l['name']}'] ?? 0) + (l['qty'] as num);
      }
    }
    final top = byItem.entries.toList()..sort((a, b) => b.value.compareTo(a.value));
    Widget kv(String k, String v) => Padding(padding: const EdgeInsets.symmetric(vertical: 3), child: Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [Text(k), Text(v, style: const TextStyle(fontWeight: FontWeight.w700))]));
    return Scaffold(
      appBar: AppBar(title: const Text('Today\'s report')),
      body: ListView(padding: const EdgeInsets.all(12), children: [
        Card(child: Padding(padding: const EdgeInsets.all(16), child: Column(children: [Text(inr(total), style: const TextStyle(fontSize: 32, fontWeight: FontWeight.w800)), Text('${paid.length} paid bills today', style: const TextStyle(color: Tk.label2))]))),
        Card(child: Padding(padding: const EdgeInsets.all(16), child: Column(children: [for (final e in modes.entries) kv('Paid by ${e.key}', inr(e.value)), if (modes.isEmpty) const Text('No payments yet'), const Divider(), kv('Refunds', inr(refunds)), kv('Cancelled bills', '$voided'), kv('Open orders now', '$open')]))),
        if (top.isNotEmpty) Card(child: Padding(padding: const EdgeInsets.all(16), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [const Text('Top items', style: TextStyle(fontWeight: FontWeight.w800)), const SizedBox(height: 6), for (final e in top.take(8)) kv(e.key, '${e.value}')]))),
      ]),
    );
  }

  String _localDay(String iso) {
    final t = DateTime.tryParse(iso)?.toLocal();
    if (t == null) return '';
    return '${t.year}-${t.month.toString().padLeft(2, '0')}-${t.day.toString().padLeft(2, '0')}';
  }
}

class ReservationsPage extends StatefulWidget {
  const ReservationsPage(this.h, {super.key});
  final HomeState h;
  @override
  State<ReservationsPage> createState() => _ReservationsPageState();
}

class _ReservationsPageState extends State<ReservationsPage> {
  Session get s => widget.h.s;
  String day = _today();
  List<Map<String, dynamic>> rows = [];
  String? err;
  bool loading = true;

  @override
  void initState() {
    super.initState();
    load();
  }

  Future<void> load() async {
    setState(() => loading = true);
    try {
      final r = await s.api.select('bookings', eq: {'date': day}, order: 'time');
      rows = r;
      err = null;
    } catch (e) {
      err = 'Reservations need an internet connection. $e';
    }
    if (mounted) setState(() => loading = false);
  }

  String _tn(dynamic id) => '${s.repo!.rec('$id')?['name'] ?? ''}';

  Future<void> _status(Map<String, dynamic> b, String st, {String? table}) async {
    try {
      await s.api.update('bookings', 'id', '${b['id']}', {'status': st, if (table != null) 'resource_id': table});
      await load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
    }
  }

  Future<void> _seat(Map<String, dynamic> b) async {
    var tbl = b['resource_id'] as String?;
    if (tbl == null) {
      final tables = s.repo!.of('table').toList();
      tbl = await showModalBottomSheet<String>(context: context, builder: (c) => SafeArea(child: ListView(shrinkWrap: true, children: [const ListTile(title: Text('Which table?', style: TextStyle(fontWeight: FontWeight.w800))), for (final t in tables) ListTile(title: Text('${t['name']}'), onTap: () => Navigator.pop(c, '${t['id']}'))])));
      if (tbl == null) return;
    }
    await _status(b, 'seated', table: tbl);
    if (!mounted) return;
    Navigator.pop(context);
    widget.h.startDineIn(tbl);
  }

  Future<void> _new() async {
    final name = TextEditingController(), phone = TextEditingController(), note = TextEditingController();
    var time = const TimeOfDay(hour: 19, minute: 0);
    var party = 2;
    String? table;
    final ok = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (ctx) => StatefulBuilder(builder: (ctx, set) {
        final tables = s.repo!.of('table').toList();
        return SafeArea(
          child: Padding(
            padding: EdgeInsets.fromLTRB(16, 16, 16, 16 + MediaQuery.of(ctx).viewInsets.bottom),
            child: SingleChildScrollView(
              child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                const Text('New reservation', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
                const SizedBox(height: 10),
                TextField(controller: name, textCapitalization: TextCapitalization.words, decoration: const InputDecoration(labelText: 'Name')),
                const SizedBox(height: 8),
                TextField(controller: phone, keyboardType: TextInputType.phone, decoration: const InputDecoration(labelText: 'Phone')),
                const SizedBox(height: 8),
                Row(children: [
                  Expanded(child: OutlinedButton(onPressed: () async { final t = await showTimePicker(context: ctx, initialTime: time); if (t != null) set(() => time = t); }, child: Text('Time ${time.format(ctx)}'))),
                  const SizedBox(width: 8),
                  IconButton(onPressed: () => set(() => party = party > 1 ? party - 1 : 1), icon: const Icon(Icons.remove_circle_outline)),
                  Text('$party guests', style: const TextStyle(fontWeight: FontWeight.w700)),
                  IconButton(onPressed: () => set(() => party++), icon: const Icon(Icons.add_circle_outline)),
                ]),
                const SizedBox(height: 8),
                DropdownButtonFormField<String>(initialValue: table, decoration: const InputDecoration(labelText: 'Table (optional)'), items: [const DropdownMenuItem(value: null, child: Text('Decide on arrival')), for (final t in tables.where((t) => t['seats'] == null || (t['seats'] as num) >= party)) DropdownMenuItem(value: '${t['id']}', child: Text('${t['name']}${t['seats'] != null ? ' · ${t['seats']} seats' : ''}'))], onChanged: (v) => table = v),
                const SizedBox(height: 8),
                TextField(controller: note, decoration: const InputDecoration(labelText: 'Note')),
                const SizedBox(height: 12),
                FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Reserve')),
              ]),
            ),
          ),
        );
      }),
    );
    if (ok != true) return;
    if (name.text.trim().isEmpty || phone.text.replaceAll(RegExp(r'[^0-9]'), '').length < 10) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('A name and a 10-digit phone are needed')));
      return;
    }
    String hh(int n) => n.toString().padLeft(2, '0');
    final start = '${hh(time.hour)}:${hh(time.minute)}';
    final endMin = time.hour * 60 + time.minute + ((s.cfg['resMinutes'] ?? 90) as num).toInt();
    final end = '${hh((endMin ~/ 60) % 24)}:${hh(endMin % 60)}';
    try {
      await s.api.insert('bookings', {'customer_name': name.text.trim(), 'customer_phone': phone.text.trim(), 'date': day, 'time': start, 'end_time': end, 'party_size': party, 'resource_id': table, 'note': note.text.trim().isEmpty ? null : note.text.trim(), 'source': 'Phone', 'outlet': 'main', 'status': 'confirmed', 'items': [], 'total': 0});
      await load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Reservations'), actions: [
        IconButton(icon: const Icon(Icons.chevron_left), onPressed: () { setState(() => day = _shift(day, -1)); load(); }),
        Center(child: Text(day.substring(5), style: const TextStyle(fontWeight: FontWeight.w700))),
        IconButton(icon: const Icon(Icons.chevron_right), onPressed: () { setState(() => day = _shift(day, 1)); load(); }),
      ]),
      floatingActionButton: FloatingActionButton.extended(onPressed: _new, icon: const Icon(Icons.add), label: const Text('Reserve')),
      body: loading
          ? const Center(child: CircularProgressIndicator())
          : err != null
              ? Center(child: Padding(padding: const EdgeInsets.all(24), child: Text(err!, textAlign: TextAlign.center)))
              : rows.isEmpty
                  ? const Center(child: Text('No reservations this day'))
                  : ListView(padding: const EdgeInsets.all(12), children: [
                      for (final b in rows)
                        Card(
                          child: Padding(
                            padding: const EdgeInsets.all(12),
                            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                              Row(children: [Expanded(child: Text('${'${b['time']}'.substring(0, 5)} · ${b['customer_name']}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16))), Text('${b['status']}', style: TextStyle(color: b['status'] == 'confirmed' ? Tk.green : Tk.label2, fontWeight: FontWeight.w600))]),
                              Text('${b['party_size'] ?? ''} guests${b['resource_id'] != null ? ' · ${_tn(b['resource_id'])}' : ''} · ${b['customer_phone'] ?? ''}${b['note'] != null ? '\n${b['note']}' : ''}', style: const TextStyle(color: Tk.label2)),
                              if (b['status'] == 'confirmed' || b['status'] == 'pending') ...[
                                const SizedBox(height: 8),
                                Wrap(spacing: 8, children: [
                                  FilledButton.tonal(onPressed: () => _seat(b), child: const Text('Seat')),
                                  OutlinedButton(onPressed: () => _status(b, 'no_show'), child: const Text('No-show')),
                                  OutlinedButton(onPressed: () => _status(b, 'cancelled'), child: const Text('Cancel')),
                                ]),
                              ],
                            ]),
                          ),
                        ),
                    ]),
    );
  }

  String _shift(String d, int n) {
    final t = DateTime.parse(d).add(Duration(days: n));
    return '${t.year}-${t.month.toString().padLeft(2, '0')}-${t.day.toString().padLeft(2, '0')}';
  }
}
