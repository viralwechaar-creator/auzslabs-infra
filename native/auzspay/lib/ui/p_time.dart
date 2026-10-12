import 'package:flutter/material.dart' hide Text;
import '../core/api.dart';
import '../core/calc.dart';
import '../core/session.dart';
import 'ds.dart';
import 'i18n.dart';
import 'lv.dart';
import 'mk.dart';
import 'p_today.dart';
import 'theme.dart';

class TimePage extends StatefulWidget {
  const TimePage(this.s, {super.key});
  final PaySession s;
  @override
  State<TimePage> createState() => _TimePageState();
}

class _TimePageState extends State<TimePage> {
  PaySession get s => widget.s;
  late String m = monthOf(todayStr());
  int gen = 0;

  Future<Map<String, dynamic>> _load() async => Map<String, dynamic>.from(await s.api.rpc('pay_me_attendance', {'p_month': m}) as Map);

  void _fix(BuildContext context, Map<String, dynamic>? day, Future<void> Function() reload) {
    final f = {'date': day?['date'] ?? ymd(DateTime.now().subtract(const Duration(days: 1))), 'in': '', 'out': '', 'reason': ''};
    final ctl = {for (final k in ['in', 'out', 'reason']) k: TextEditingController()};
    final dateC = TextEditingController(text: '${f['date']}');
    openSheet(context, 'Ask for a correction', (ctx, set) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Hint('Forgot to clock in or out? Tell your manager the right times.'),
          gap(),
          TextField(
            controller: dateC,
            readOnly: true,
            decoration: InputDecoration(labelText: tr('Day')),
            onTap: () async {
              final d = await showDatePicker(context: ctx, initialDate: DateTime.tryParse(dateC.text) ?? DateTime.now(), firstDate: DateTime.now().subtract(const Duration(days: 60)), lastDate: DateTime.now());
              if (d != null) dateC.text = ymd(d);
            },
          ),
          gap(),
          for (final k in ['in', 'out'])
            Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: TextField(
                controller: ctl[k],
                readOnly: true,
                decoration: InputDecoration(labelText: tr(k == 'in' ? 'Started at' : 'Finished at')),
                onTap: () async {
                  final t = await showTimePicker(context: ctx, initialTime: const TimeOfDay(hour: 9, minute: 0));
                  if (t != null) ctl[k]!.text = '${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}';
                },
              ),
            ),
          Fld('What happened', ctl['reason']!, hint: 'For example: phone battery died'),
        ]), actions: [
      SheetAction('Send', (ctx) async {
        try {
          await s.api.rpc('pay_me_regularize', {'p': {'date': dateC.text, 'in': ctl['in']!.text, 'out': ctl['out']!.text, 'reason': ctl['reason']!.text}});
          if (context.mounted) toast(context, tr('Sent to your manager'));
          await reload();
          return true;
        } on ApiError catch (e) {
          if (ctx.mounted) toast(ctx, e.message, err: true);
          return false;
        }
      }),
    ]);
  }

  void _day(BuildContext context, Map<String, dynamic> x, List punches, List reqs, Future<void> Function() reload) {
    final ps = punches.map((p) => Map<String, dynamic>.from(p as Map)).where((p) => p['voided'] != true && '${p['at']}'.isNotEmpty && ymd(DateTime.parse('${p['at']}').toLocal()) == x['date']).toList();
    final req = reqs.any((r) => (r as Map)['att_date'] == x['date'] && r['status'] == 'pending');
    final rows = <(String, String?)>[
      ('First in', x['first_in'] != null ? fmtT(x['first_in']) : null),
      ('Last out', x['last_out'] != null ? fmtT(x['last_out']) : null),
      ('Worked', n(x['worked_mins']) > 0 ? mins(n(x['worked_mins'])) : null),
      ('Late by', n(x['late_mins']) > 0 ? mins(n(x['late_mins'])) : null),
      ('Overtime', n(x['ot_mins']) > 0 ? mins(n(x['ot_mins'])) : null),
    ].where((r) => r.$2 != null).toList();
    final canFix = x['locked'] != true && !req && '${x['date']}'.compareTo(todayStr()) <= 0 && x['status'] != 'upcoming';
    openSheet(context, fmtD(x['date'], weekday: true), (ctx, set) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Wrap(spacing: 8, children: [Pill(tr(attLabel['${x['status']}'] ?? '${x['status']}'), tone: attTone('${x['status']}')), if (x['holiday'] != null) Pill('${x['holiday']}'), if (x['leave'] != null) Pill('${x['leave']}', tone: Tk.blue)]),
          gap(),
          if (rows.isNotEmpty) Group([for (final r in rows) Li(tr(r.$1), value: r.$2, chevron: false)]),
          if (ps.isNotEmpty) ...[const SectionLabel('Clock-ins'), Group([for (final p in ps) Li('${tr(p['kind'] == 'out' ? 'Out' : 'In')} ${fmtT(p['at'])}', sub: '${p['source'] ?? ''}${p['out_of_range'] == true ? ' · ${tr('away from work')}' : ''}', chevron: false)])],
          if (req) const Note('You asked for a correction for this day. Waiting for your manager.'),
          if (x['locked'] == true) Hint('This day is in a finalised payroll and cannot change.'),
        ]), actions: [
      if (canFix)
        SheetAction('Ask for a correction', (ctx) async {
          Navigator.pop(ctx);
          _fix(context, x, reload);
          return null;
        }),
    ]);
  }

  @override
  Widget build(BuildContext context) {
    return Loader<Map<String, dynamic>>(
      key: ValueKey('$m$gen'),
      load: _load,
      builder: (ctx, d, reload) {
        final days = ((d['days'] as List?) ?? const []).map((x) => Map<String, dynamic>.from(x as Map)).toList();
        int c(bool Function(Map<String, dynamic>) f) => days.where(f).length;
        final shown = days.where((x) => x['status'] != 'upcoming').toList().reversed.toList();
        return TabPage('My time', [
          Pad(Row(children: [
            iconBtn(Icons.chevron_left, () => setState(() => m = monthAdd(m, -1))),
            Expanded(child: Center(child: Text(monthName(m), style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800)))),
            if (m.compareTo(monthOf(todayStr())) < 0) iconBtn(Icons.chevron_right, () => setState(() => m = monthAdd(m, 1))) else const SizedBox(width: 48),
          ])),
          metricGrid([
            Metric('Present', '${c((x) => ['present', 'late', 'missing'].contains(x['status']))}', tone: Tk.green),
            Metric('Late', '${c((x) => x['status'] == 'late')}', tone: Tk.orange),
            Metric('Absent', '${c((x) => x['status'] == 'absent')}', tone: Tk.red),
            Metric('Leave', '${c((x) => ['leave', 'half_leave'].contains(x['status']))}', tone: Tk.blue),
          ]),
          Pad(OutlinedButton.icon(onPressed: () => _fix(ctx, null, () async => reload()), icon: const Icon(Icons.edit_outlined), label: const Text('Fix a day'))),
          if (shown.isEmpty) emptyBox(Icons.calendar_month_outlined, 'No days yet') else Group([
            for (final x in shown)
              Li(fmtD(x['date'], weekday: true, noYear: true),
                  sub: [if (x['first_in'] != null) '${fmtT(x['first_in'])}${x['last_out'] != null ? ' – ${fmtT(x['last_out'])}' : ''}', if (n(x['worked_mins']) > 0) mins(n(x['worked_mins']))].join(' · ').isEmpty ? null : [if (x['first_in'] != null) '${fmtT(x['first_in'])}${x['last_out'] != null ? ' – ${fmtT(x['last_out'])}' : ''}', if (n(x['worked_mins']) > 0) mins(n(x['worked_mins']))].join(' · '),
                  trailing: Pill(tr(attLabel['${x['status']}'] ?? '${x['status']}'), tone: attTone('${x['status']}')),
                  onTap: () => _day(ctx, x, (d['punches'] as List?) ?? const [], (d['requests'] as List?) ?? const [], () async => reload())),
          ]),
          const Hint('Tap a day to see your times. If something is wrong, ask for a correction: your manager approves it.'),
        ], onRefresh: reload);
      },
    );
  }
}
