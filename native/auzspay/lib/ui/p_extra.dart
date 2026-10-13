import 'dart:io';
import 'package:flutter/material.dart' hide Text;
import 'package:image_picker/image_picker.dart';
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';
import '../core/api.dart';
import '../core/calc.dart';
import '../core/session.dart';
import 'ds.dart';
import 'i18n.dart';
import 'kit.dart';
import 'lv.dart';
import 'mk.dart';
import 'theme.dart';

List<Map<String, dynamic>> _maps(dynamic l) => ((l as List?) ?? const []).map((e) => Map<String, dynamic>.from(e as Map)).toList();

/// Open a stored document: download it to the phone and hand it to the share sheet (open in another app, save, print).
Future<void> openDocument(BuildContext context, PaySession s, Map<String, dynamic> d) async {
  try {
    final bytes = await s.api.downloadDoc('${d['path']}');
    final name = '${d['name'] ?? d['doc_type'] ?? 'document'}'.replaceAll(RegExp(r'[^A-Za-z0-9._-]'), '_');
    final ext = '${d['content_type'] ?? ''}'.contains('pdf') ? '.pdf' : ('${d['content_type'] ?? ''}'.contains('png') ? '.png' : '.jpg');
    final f = File('${(await getTemporaryDirectory()).path}/$name${name.contains('.') ? '' : ext}');
    await f.writeAsBytes(bytes);
    await SharePlus.instance.share(ShareParams(files: [XFile(f.path)]));
  } catch (e) {
    if (context.mounted) toast(context, e is ApiError ? e.message : '$e', err: true);
  }
}

/// Add a document (a photo from the gallery) for [empId]; HR can hide it from the employee.
Future<bool> addDocument(BuildContext context, PaySession s, String empId, {bool hr = true}) async {
  final f = await ImagePicker().pickImage(source: ImageSource.gallery, maxWidth: 2000, imageQuality: 85);
  if (f == null || !context.mounted) return false;
  var saved = false;
  await formSheet(context, 'Add a document', [
    F('doc_type', 'Kind of document', type: 'select', value: 'ID proof', options: [for (final t in const ['ID proof', 'Address proof', 'Bank proof', 'Offer letter', 'Certificate', 'Other']) [t, t]]),
    F('name', 'Name', value: f.name),
    if (hr) F('employee_can_see', 'Employee can see it', type: 'check', value: true),
  ], (v) async {
    try {
      final bytes = await f.readAsBytes();
      final path = await s.api.uploadDoc(bytes, empId);
      await s.api.rpc('pay_add_document', {'p': {'employee_id': empId, 'doc_type': v['doc_type'], 'name': v['name'], 'path': path, 'content_type': f.name.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg', 'size': bytes.length, 'employee_can_see': hr ? v['employee_can_see'] == true : true}});
      saved = true;
      return true;
    } on ApiError catch (e) {
      if (context.mounted) toast(context, e.message, err: true);
      return false;
    }
  });
  return saved;
}

/// The documents HR has shared with me.
class MyDocsPage extends StatelessWidget {
  const MyDocsPage(this.s, {super.key});
  final PaySession s;
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('My documents')),
      body: Loader<List<Map<String, dynamic>>>(
        load: () async => _maps(await s.api.rpc('pay_me_documents', {})),
        builder: (ctx, docs, _) => docs.isEmpty
            ? emptyBox(Icons.folder_open_outlined, 'No documents yet', 'Documents your employer shares with you show here.')
            : ListView(children: [Group([for (final d in docs) Li('${d['name'] ?? d['doc_type']}', sub: '${d['doc_type'] ?? ''} · ${fmtD('${d['created_at'] ?? ''}')}', icon: Icons.description_outlined, tone: Tk.accent, onTap: () => openDocument(ctx, s, d))])]),
      ),
    );
  }
}

/// My income-tax declaration: regime, deductions, earlier pay this year, and what it means each month.
class MyTaxPage extends StatefulWidget {
  const MyTaxPage(this.s, {this.empId, super.key});
  final PaySession s;
  final String? empId; // HR editing someone else
  @override
  State<MyTaxPage> createState() => _MyTaxPageState();
}

class _MyTaxPageState extends State<MyTaxPage> {
  Map<String, dynamic>? d;
  String regime = 'new';
  bool metro = false;
  final c = <String, TextEditingController>{};
  static const keys = [
    ('rent_monthly', 'Rent paid a month'),
    ('sec80c', 'Investments under 80C'),
    ('sec80d', 'Health insurance (80D)'),
    ('sec80ccd1b', 'NPS (80CCD 1B)'),
    ('home_loan_interest', 'Home loan interest'),
    ('other_deductions', 'Other deductions'),
    ('prev_income', 'Taxable pay earlier this year'),
    ('prev_tds', 'Tax already deducted on it'),
  ];

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final r = Map<String, dynamic>.from((widget.empId == null ? await widget.s.api.rpc('pay_me_tax', {}) : await widget.s.api.rpc('pay_get_tax', {'p_emp': widget.empId})) as Map);
      final dec = r['declaration'] is Map ? Map<String, dynamic>.from(r['declaration'] as Map) : <String, dynamic>{};
      final items = dec['items'] is Map ? Map<String, dynamic>.from(dec['items'] as Map) : <String, dynamic>{};
      for (final k in keys) {
        c[k.$1] = TextEditingController(text: items[k.$1] == null ? '' : qtyStr(n(items[k.$1])));
      }
      if (!mounted) return;
      setState(() {
        d = r;
        regime = '${dec['regime'] ?? r['regime_default'] ?? 'new'}' == 'old' ? 'old' : 'new';
        metro = items['metro'] == true;
      });
    } on ApiError catch (e) {
      if (mounted) toast(context, e.message, err: true);
    }
  }

  Future<void> _save() async {
    final p = taxPayload(regime, {for (final k in keys) k.$1: c[k.$1]!.text}, metro: metro);
    try {
      if (widget.empId == null) {
        await widget.s.api.rpc('pay_me_tax_save', {'p': p});
      } else {
        await widget.s.api.rpc('pay_save_tax', {'p_emp': widget.empId, 'p': p});
      }
      if (mounted) toast(context, tr('Saved: used from the next payroll'));
      await _load();
    } on ApiError catch (e) {
      if (mounted) toast(context, e.message, err: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final pj = d?['projection'] is Map ? Map<String, dynamic>.from(d!['projection'] as Map) : <String, dynamic>{};
    return Scaffold(
      appBar: AppBar(title: Text('${tr('Income tax')} ${d?['fy'] ?? ''}')),
      bottomNavigationBar: d == null ? null : SafeArea(child: Padding(padding: const EdgeInsets.fromLTRB(16, 8, 16, 12), child: FilledButton(onPressed: _save, child: const Text('Save')))),
      body: d == null
          ? const Center(child: CircularProgressIndicator())
          : ListView(padding: const EdgeInsets.only(bottom: 90), children: [
              if (pj['annual_tax'] != null)
                metricGrid([
                  Metric('Expected yearly income', inr(n(pj['annual_income']), dp: 0)),
                  Metric('Tax for the year', inr(n(pj['annual_tax']), dp: 0), sub: pj['regime'] == 'old' ? 'Old regime' : 'New regime'),
                  Metric('Each month from now', inr(n(pj['amt']), dp: 0)),
                ])
              else if ('${pj['note'] ?? ''}'.isNotEmpty)
                Note('${pj['note']}'),
              const SectionLabel('Regime'),
              Pad(Seg<String>(expand: true, items: const [('new', 'New regime'), ('old', 'Old regime')], value: regime, onChanged: (v) => setState(() => regime = v))),
              Pad(Text(tr('The new regime has lower rates and no deductions except the standard one'), style: TextStyle(color: Tk.label2, fontSize: 13))),
              if (regime == 'old') ...[
                const SectionLabel('Deductions'),
                for (final k in keys.take(6))
                  Pad(TextField(controller: c[k.$1], keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: InputDecoration(labelText: tr(k.$2)))),
                Pad(SwitchListTile(contentPadding: EdgeInsets.zero, title: Text(tr('Lives in Delhi, Mumbai, Kolkata or Chennai')), value: metro, onChanged: (v) => setState(() => metro = v))),
              ],
              const SectionLabel('Earlier this year'),
              for (final k in keys.skip(6)) Pad(TextField(controller: c[k.$1], keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: InputDecoration(labelText: tr(k.$2)))),
            ]),
    );
  }
}

/// A shared phone at work: pick your name, type your PIN, clock in or out.
class KioskPage extends StatefulWidget {
  const KioskPage(this.s, {super.key});
  final PaySession s;
  @override
  State<KioskPage> createState() => _KioskPageState();
}

class _KioskPageState extends State<KioskPage> {
  List<Map<String, dynamic>> people = [];
  String q = '';
  String? err;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final l = _maps(await widget.s.api.rpc('pay_kiosk_list', {}));
      if (mounted) setState(() => people = l);
    } on ApiError catch (e) {
      if (mounted) setState(() => err = e.message);
    }
  }

  void _punch(Map<String, dynamic> p) {
    final pin = TextEditingController();
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (ctx) => Padding(
        padding: EdgeInsets.fromLTRB(16, 0, 16, MediaQuery.of(ctx).viewInsets.bottom + 16),
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text('${p['name']}', style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800)),
          const SizedBox(height: 4),
          Text(tr(kioskIsIn(p) ? 'Clocked in now. Tap Clock out to finish.' : 'Not clocked in. Tap Clock in to start.'), style: TextStyle(color: Tk.label2)),
          const SizedBox(height: 12),
          if (p['pin'] == true) TextField(controller: pin, autofocus: true, obscureText: true, keyboardType: TextInputType.number, decoration: InputDecoration(labelText: tr('Your PIN'))),
          const SizedBox(height: 12),
          FilledButton(
            onPressed: () async {
              try {
                final r = Map<String, dynamic>.from(await widget.s.api.rpc('pay_kiosk_punch', {'p_emp': p['id'], 'p_pin': pin.text}) as Map);
                if (!ctx.mounted) return;
                if (r['ok'] == true) {
                  Navigator.pop(ctx);
                  toast(context, '${p['name']}: ${tr(r['kind'] == 'out' ? 'Clocked out' : 'Clocked in')}');
                  await _load();
                } else {
                  toast(ctx, '${r['error'] ?? 'Could not record'}', err: true);
                }
              } on ApiError catch (e) {
                if (ctx.mounted) toast(ctx, e.message, err: true);
              }
            },
            child: Text(kioskIsIn(p) ? 'Clock out' : 'Clock in'),
          ),
        ]),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final l = people.where((p) => q.isEmpty || '${p['name']}'.toLowerCase().contains(q.toLowerCase())).toList();
    return Scaffold(
      appBar: AppBar(title: const Text('Clock in kiosk')),
      body: ListView(padding: const EdgeInsets.only(bottom: 40), children: [
        Pad(TextField(onChanged: (v) => setState(() => q = v), decoration: InputDecoration(hintText: tr('Find your name'), prefixIcon: const Icon(Icons.search)))),
        if (err != null) Note(err!, bad: true),
        if (l.isEmpty && err == null) emptyBox(Icons.groups_outlined, 'No one to show')
        else
          Group([for (final p in l) Li('${p['name']}', sub: tr(kioskIsIn(p) ? 'In' : 'Out'), icon: kioskIsIn(p) ? Icons.login : Icons.logout, tone: kioskIsIn(p) ? Tk.green : Tk.label3, onTap: () => _punch(p))]),
      ]),
    );
  }
}
