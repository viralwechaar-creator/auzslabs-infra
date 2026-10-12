import 'package:flutter/material.dart' hide Text;
import '../core/api.dart';
import '../core/calc.dart';
import '../core/session.dart';
import 'ds.dart';
import 'i18n.dart';
import 'mk.dart';
import 'p_pay.dart';
import 'theme.dart';

List<Map<String, dynamic>> _maps(dynamic l) => ((l as List?) ?? const []).map((e) => Map<String, dynamic>.from(e as Map)).toList();

String _monthOf(DateTime d) => '${d.year}-${d.month.toString().padLeft(2, '0')}';

/// Start a monthly payroll for a month. Opens it when it already exists (the server answers with the existing one).
Future<void> newRun(BuildContext context, PaySession s) async {
  final now = DateTime.now();
  var m = now.day <= 20 ? _monthOf(DateTime(now.year, now.month - 1)) : _monthOf(now);
  final months = [for (var i = -3; i <= 1; i++) _monthOf(DateTime(now.year, now.month + i))];
  await openSheet(context, 'New payroll', (ctx, set) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Text(tr('Everyone\'s pay is worked out from salary, days worked, leave, overtime and advances. You check it before anything is final.'), style: TextStyle(color: Tk.label2)),
        gap(),
        Sel('Month', m, [for (final x in months) (x, monthName('$x-01'))], (v) => set(() => m = v)),
      ]), actions: [
    SheetAction('Create and calculate', (ctx) async {
      try {
        final id = await s.api.rpc('pay_run_create', {'p': {'kind': 'regular', 'month': '$m-01'}});
        await s.api.rpc('pay_run_calculate', {'p_run': '$id'});
        if (ctx.mounted) Navigator.pop(ctx);
        if (context.mounted) await Navigator.push(context, MaterialPageRoute<void>(builder: (_) => RunPage(s, '$id', monthName('$m-01'))));
      } on ApiError catch (e) {
        if (ctx.mounted) toast(ctx, e.message, err: true);
        return false;
      }
      return true;
    }),
  ]);

}

/// One payroll: the numbers, who is in it, and the next step (check, approve, finalise, pay).
class RunPage extends StatefulWidget {
  const RunPage(this.s, this.id, this.title, {super.key});
  final PaySession s;
  final String id, title;
  @override
  State<RunPage> createState() => _RunPageState();
}

class _RunPageState extends State<RunPage> {
  PaySession get s => widget.s;
  Map<String, dynamic>? r;
  String? error;
  bool busy = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final d = Map<String, dynamic>.from(await s.api.rpc('pay_get_run', {'p_id': widget.id}) as Map);
      if (!mounted) return;
      setState(() {
        r = d['run'] is Map ? {...Map<String, dynamic>.from(d['run'] as Map), 'items': d['items']} : d;
        error = null;
      });
    } on ApiError catch (e) {
      if (mounted) setState(() => error = e.message);
    }
  }

  bool get needsReview {
    final ac = (s.org['settings'] is Map ? (s.org['settings'] as Map)['access'] : null);
    return ac is Map && ac['require_review'] == true;
  }

  Future<void> _do(Future<dynamic> Function() fn, String done) async {
    setState(() => busy = true);
    try {
      await fn();
      if (mounted) toast(context, tr(done));
      await _load();
    } on ApiError catch (e) {
      if (mounted) toast(context, e.message, err: true);
    }
    if (mounted) setState(() => busy = false);
  }

  Future<String?> _ask(String title, String hint) async {
    final c = TextEditingController();
    return showDialog<String>(
      context: context,
      builder: (d) => AlertDialog(
        title: Text(title),
        content: TextField(controller: c, autofocus: true, decoration: InputDecoration(hintText: tr(hint))),
        actions: [TextButton(onPressed: () => Navigator.pop(d), child: const Text('Cancel')), FilledButton(onPressed: () => Navigator.pop(d, c.text.trim()), child: const Text('OK'))],
      ),
    );
  }

  Future<void> _pay() async {
    final run = r!;
    var mode = 'cash';
    await openSheet(context, 'Pay salaries', (ctx, set) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text(tr('Net pay to give out'), style: TextStyle(color: Tk.label2)),
          Text(inr(n(run['net'])), style: const TextStyle(fontSize: 30, fontWeight: FontWeight.w800)),
          gap(),
          Seg<String>(expand: true, items: const [('cash', 'Cash'), ('bank', 'Bank transfer'), ('upi', 'UPI')], value: mode, onChanged: (v) => set(() => mode = v)),
          gap(8),
          Text(mode == 'cash' ? tr('Marks everyone left as paid in cash today.') : tr('Creates a payment list. Pay it from your bank, then mark it paid here.'), style: TextStyle(color: Tk.label2)),
        ]), actions: [
      SheetAction('Continue', (ctx) async {
        try {
          final b = await s.api.rpc('pay_batch_create', {'p_run': widget.id, 'p': {'mode': mode, 'mark_paid': mode == 'cash'}});
          if (mode != 'cash' && ctx.mounted) {
            Navigator.pop(ctx);
            await _markBatch('$b');
          } else if (ctx.mounted) {
            Navigator.pop(ctx);
          }
          await _load();
          return true;
        } on ApiError catch (e) {
          if (ctx.mounted) toast(ctx, e.message, err: true);
          return false;
        }
      }),
    ]);
  }

  Future<void> _markBatch(String id) async {
    final ref = TextEditingController();
    await openSheet(context, 'Mark paid', (ctx, set) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text(tr('After you have paid from your bank, mark the whole list as paid.'), style: TextStyle(color: Tk.label2)),
          gap(),
          Fld('Bank reference (optional)', ref),
        ]), actions: [
      SheetAction('Mark everyone paid', (ctx) async {
        try {
          await s.api.rpc('pay_batch_mark', {'p_batch': id, 'p': {'all': 'paid', 'paid_on': todayStr(), 'ref': ref.text.trim()}});
          return true;
        } on ApiError catch (e) {
          if (ctx.mounted) toast(ctx, e.message, err: true);
          return false;
        }
      }),
      SheetAction('Later', (ctx) async => true, primary: false),
    ]);
  }

  Future<void> _item(Map<String, dynamic> i) async {
    final run = r!;
    final canEdit = ['draft', 'calculated'].contains('${run['status']}') && s.can('pay_run');
    final onHold = '${i['status']}' == 'hold';
    await openSheet(context, '${i['name']}', (ctx, set) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Group([
            Li('Net pay', value: inr(n(i['net'])), chevron: false),
            Li('Gross', value: inr(n(i['gross'])), chevron: false),
            Li('Deductions', value: inr(n(i['deductions'])), chevron: false),
            if (i['paid_days'] != null) Li('Days paid', value: qtyStr(n(i['paid_days'])), chevron: false),
          ]),
          for (final w in _maps(i['warnings'])) Note('${w['text']}', bad: true),
        ]), actions: [
      SheetAction('Open payslip', (ctx) async {
        Navigator.pop(ctx);
        await Navigator.push(context, MaterialPageRoute<void>(builder: (_) => PayslipPage(s, '${i['id']}')));
        return true;
      }, primary: false),
      if (canEdit)
        SheetAction(onHold ? 'Release salary' : 'Hold this salary', (ctx) async {
          String? why;
          if (!onHold) {
            why = await _ask('Hold this salary?', 'Reason');
            if (why == null || why.isEmpty) return false;
          }
          try {
            await s.api.rpc('pay_item_hold', {'p_item': '${i['id']}', 'p_hold': !onHold, 'p_reason': why});
          } on ApiError catch (e) {
            if (ctx.mounted) toast(ctx, e.message, err: true);
            return false;
          }
          return true;
        }, primary: false),
    ]);
    await _load();
  }

  @override
  Widget build(BuildContext context) {
    final run = r;
    if (run == null) {
      return Scaffold(appBar: AppBar(title: Text(widget.title)), body: error != null ? emptyBox(Icons.error_outline, error!) : const Center(child: CircularProgressIndicator()));
    }
    final st = '${run['status']}';
    final acts = runActions(status: st, kind: '${run['kind'] ?? 'regular'}', canRun: s.can('pay_run'), canApprove: s.can('pay_approve'), canPay: s.can('pay_pay'), needsReview: needsReview);
    final items = _maps(run['items']);
    final warn = items.where((i) => _maps(i['warnings']).any((w) => w['code'] != 'projected')).length;
    Widget btn(String id, String label, VoidCallback f, {bool primary = false, bool danger = false}) => primary
        ? FilledButton(onPressed: busy ? null : f, child: Text(label))
        : OutlinedButton(onPressed: busy ? null : f, style: danger ? OutlinedButton.styleFrom(foregroundColor: Tk.red) : null, child: Text(label));
    final buttons = <Widget>[
      if (acts.contains('calculate')) btn('calculate', 'Calculate', () => _do(() => s.api.rpc('pay_run_calculate', {'p_run': widget.id}), 'Calculated'), primary: true),
      if (['calculated'].contains(st) && s.can('pay_run')) btn('recalc', 'Calculate again', () => _do(() => s.api.rpc('pay_run_calculate', {'p_run': widget.id}), 'Calculated')),
      if (acts.contains('submit')) btn('submit', 'Send for approval', () => _do(() => s.api.rpc('pay_run_submit', {'p_run': widget.id}), 'Sent for approval'), primary: st == 'calculated'),
      if (acts.contains('approve_finalise')) btn('af', 'Approve and finalise', () async {
        if (!await confirm(context, 'Finalise ${run['title']}?', 'Net pay ${inr(n(run['net']))} for ${run['employees']} people. After this the pay is frozen and payslips are issued. Mistakes are corrected in the next payroll.', yes: 'Finalise')) return;
        await _do(() async {
          await s.api.rpc('pay_run_approve', {'p_run': widget.id, 'p_note': null});
          await s.api.rpc('pay_run_finalize', {'p_run': widget.id});
        }, 'Finalised');
      }, primary: true),
      if (acts.contains('approve')) btn('approve', 'Approve', () => _do(() => s.api.rpc('pay_run_approve', {'p_run': widget.id, 'p_note': null}), 'Approved'), primary: true),
      if (acts.contains('finalise')) btn('finalise', 'Finalise', () async {
        if (!await confirm(context, 'Finalise ${run['title']}?', 'After this the pay is frozen and payslips are issued.', yes: 'Finalise')) return;
        await _do(() => s.api.rpc('pay_run_finalize', {'p_run': widget.id}), 'Finalised');
      }, primary: true),
      if (acts.contains('send_back')) btn('back', 'Send back', () async {
        final why = await _ask('Send back', 'Say what needs changing');
        if (why == null || why.isEmpty) return;
        await _do(() => s.api.rpc('pay_run_send_back', {'p_run': widget.id, 'p_reason': why}), 'Sent back');
      }),
      if (acts.contains('pay')) btn('pay', 'Pay salaries', _pay, primary: true),
      if (acts.contains('close')) btn('close', 'Close (lock)', () async {
        if (await confirm(context, 'Close this payroll?', 'Nothing more can be paid from it.', yes: 'Close')) await _do(() => s.api.rpc('pay_run_lock', {'p_run': widget.id}), 'Closed');
      }),
      if (acts.contains('cancel')) btn('cancel', 'Cancel this payroll', () async {
        final why = await _ask('Cancel ${run['title']}?', 'Reason');
        if (why == null || why.isEmpty) return;
        await _do(() => s.api.rpc('pay_run_cancel', {'p_run': widget.id, 'p_reason': why}), 'Cancelled');
      }, danger: true),
    ];
    return Scaffold(
      appBar: AppBar(title: Text(widget.title)),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(padding: const EdgeInsets.only(bottom: 40), children: [
          Padding(padding: const EdgeInsets.fromLTRB(16, 8, 16, 0), child: Row(children: [Pill(tr(st == 'finalized' ? 'finalised' : st), tone: ['paid', 'locked'].contains(st) ? Tk.green : Tk.accent), const SizedBox(width: 8), Expanded(child: Text('${run['number'] ?? ''}', style: TextStyle(color: Tk.label2, fontSize: 13)))])),
          metricGrid([
            Metric('Net pay', inr(n(run['net']), dp: 0), hero: true),
            Metric('People', '${run['employees'] ?? items.length}', sub: n(run['held']) > 0 ? '${n(run['held']).toInt()} ${tr('on hold')}' : null),
            Metric('Gross', inr(n(run['gross']), dp: 0)),
            Metric('Deductions', inr(n(run['deductions']), dp: 0)),
          ]),
          if (warn > 0 && ['draft', 'calculated', 'review', 'approved'].contains(st)) Note('$warn ${tr('people to check. You can still go ahead.')}', bad: true),
          if ('${run['cancel_reason'] ?? ''}'.isNotEmpty && st == 'cancelled') Note('${tr('Cancelled')}: ${run['cancel_reason']}', bad: true),
          if (buttons.isNotEmpty) Pad(Wrap(spacing: 10, runSpacing: 10, children: buttons)),
          const SectionLabel('People'),
          Group([
            for (final i in items)
              Li('${i['name']}', sub: i['paid_days'] != null ? '${qtyStr(n(i['paid_days']))} ${tr('days')}${'${i['status']}' == 'hold' ? ' · ${tr('on hold')}' : ''}' : null, value: inr(n(i['net'])), icon: Icons.person_outline, tone: Tk.accent, onTap: () => _item(i)),
          ]),
        ]),
      ),
    );
  }
}
