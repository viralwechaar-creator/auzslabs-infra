import 'dart:io';
import 'package:flutter/material.dart' hide Text;
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';
import '../core/calc.dart';
import '../core/session.dart';
import 'ds.dart';
import 'i18n.dart';
import 'lv.dart';
import 'mk.dart';
import 'theme.dart';

/// (id, title, what it shows, needs pay rights, how it is dated: run/range = a month, none = now)
const reportList = <(String, String, String, bool, String)>[
  ('register', 'Salary register', 'Every person and every pay line for a month', true, 'run'),
  ('summary', 'Cost by department', 'Gross, deductions, net and employer cost', true, 'range'),
  ('bank', 'Bank transfer list', 'Who gets paid how much, to which account', true, 'run'),
  ('ctc', 'Salaries now', 'Current monthly and annual cost of each person', true, 'none'),
  ('loans', 'Loans and advances', 'Given, recovered and still owed', true, 'none'),
  ('pf', 'Provident fund', 'Monthly PF figures', true, 'run'),
  ('esi', 'ESI contributions', 'Monthly ESI figures', true, 'run'),
  ('pt', 'Professional tax', 'Tax deducted by state and month', true, 'range'),
  ('tds', 'Income tax deducted (TDS)', 'Working figures for the quarterly return', true, 'range'),
  ('liabilities', 'Statutory dues', 'What is owed, paid and still due', true, 'none'),
  ('attendance', 'Attendance summary', 'Present, absent, leave and overtime per person', false, 'range'),
  ('late', 'Late arrivals', 'Every late clock-in with the minutes', false, 'range'),
  ('leave', 'Leave balances', 'Days left of each paid leave type', false, 'none'),
  ('headcount', 'Joiners and leavers', 'Who joined and who left', false, 'range'),
];

bool _canPay(PaySession s) => s.can('pay_salary') || s.can('pay_run') || s.can('pay_pay');

/// A report row as text: numbers shown as rupees when the column looks like money, else plain.
String reportCell(dynamic v, String head, {required bool money}) {
  if (v == null || '$v'.isEmpty) return '';
  if (RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch('$v')) return fmtD(v);
  if (money && v is num && !RegExp(r'days|people|hours|minutes|code|count', caseSensitive: false).hasMatch(head)) return inr(v);
  return v is num ? qtyStr(v) : '$v';
}

String reportCsv(List<dynamic> head, List<dynamic> rows) => [head, ...rows].map((r) => (r as List).map(csvEscape).join(',')).join('\n');

class ReportsPage extends StatelessWidget {
  const ReportsPage(this.s, {super.key});
  final PaySession s;
  @override
  Widget build(BuildContext context) {
    final list = reportList.where((r) => !r.$4 || _canPay(s)).toList();
    return Scaffold(
      appBar: AppBar(title: const Text('Reports')),
      body: ListView(padding: const EdgeInsets.only(bottom: 40), children: [
        Group([Li('Attendance this month (grid)', sub: 'Every person, every day', icon: Icons.grid_view_outlined, tone: Tk.accent, onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => AttendanceGridPage(s))))]),
        const SectionLabel('Reports'),
        Group([for (final r in list) Li(r.$2, sub: r.$3, icon: Icons.bar_chart_outlined, tone: Tk.blue, onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => ReportPage(s, r.$1, r.$2, r.$5))))]),
      ]),
    );
  }
}

class ReportPage extends StatefulWidget {
  const ReportPage(this.s, this.kind, this.title, this.mode, {super.key});
  final PaySession s;
  final String kind, title, mode;
  @override
  State<ReportPage> createState() => _ReportPageState();
}

class _ReportPageState extends State<ReportPage> {
  String month = DateTime.now().toIso8601String().substring(0, 7);
  List<dynamic> lastHead = const [], lastRows = const [];

  Future<void> _share() async {
    try {
      final f = File('${(await getTemporaryDirectory()).path}/auzspay-${widget.kind}-$month.csv');
      await f.writeAsString('﻿${reportCsv(lastHead, lastRows)}');
      await SharePlus.instance.share(ShareParams(files: [XFile(f.path)], text: widget.title));
    } catch (e) {
      if (mounted) toast(context, '$e', err: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final dated = widget.mode != 'none';
    return Scaffold(
      appBar: AppBar(title: Text(widget.title), actions: [iconBtn(Icons.ios_share, _share, tip: 'Share as a spreadsheet')]),
      body: ListView(padding: const EdgeInsets.only(bottom: 40), children: [
        if (dated)
          Padding(padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4), child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [
            IconButton(onPressed: () => setState(() => month = monthAdd(month, -1)), icon: const Icon(Icons.chevron_left)),
            Text(monthName(month), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 17)),
            IconButton(onPressed: () => setState(() => month = monthAdd(month, 1)), icon: const Icon(Icons.chevron_right)),
          ])),
        Loader<Map<String, dynamic>>(
          key: ValueKey('${widget.kind}|$month'),
          load: () async => Map<String, dynamic>.from(await widget.s.api.rpc('pay_report', {'p_kind': widget.kind, 'p': {'month': month, if (widget.mode == 'range') ...{'from': '$month-01', 'to': '$month-${DateTime(int.parse(month.substring(0, 4)), int.parse(month.substring(5)) + 1, 0).day}'}}}) as Map),
          builder: (ctx, d, reload) {
            final head = (d['head'] as List?) ?? const [];
            final rows = (d['rows'] as List?) ?? const [];
            lastHead = head;
            lastRows = rows;
            final nf = d['numeric_from'] is num ? (d['numeric_from'] as num).toInt() : 99;
            if (rows.isEmpty) return emptyBox(Icons.insert_chart_outlined, 'Nothing for this period', 'Try another month.');
            return Column(children: [
              if (d['note'] != null) Note('${d['note']}'),
              Group([
                for (final r in rows.take(300))
                  Li(
                    '${(r as List).isEmpty ? '' : r[0]}',
                    sub: [for (var i = 1; i < r.length && i < head.length; i++) if ('${r[i] ?? ''}'.isNotEmpty) '${head[i]}: ${reportCell(r[i], '${head[i]}', money: i >= nf)}'].join('\n'),
                    chevron: false,
                  ),
              ]),
              if (rows.length > 300) Pad(Text('Showing the first 300 of ${rows.length}. Share the spreadsheet for all of them.', style: TextStyle(color: Tk.label2, fontSize: 13))),
            ]);
          },
        ),
      ]),
    );
  }
}

const _attLabel = {'P': 'Present', 'L': 'Late', 'H': 'Half day', 'A': 'Absent', 'M': 'No clock-out', 'V': 'Leave', 'h': 'Half leave', 'O': 'Day off', 'F': 'Holiday'};

Color attColor(String c) => switch (c) {
      'P' => Tk.green,
      'L' || 'H' || 'M' => Tk.orange,
      'A' => Tk.red,
      'V' || 'h' => Tk.blue,
      _ => Tk.label3,
    };

/// Everyone, every day of the month, in one table. Tap a person for the details.
class AttendanceGridPage extends StatefulWidget {
  const AttendanceGridPage(this.s, {super.key});
  final PaySession s;
  @override
  State<AttendanceGridPage> createState() => _AttendanceGridPageState();
}

class _AttendanceGridPageState extends State<AttendanceGridPage> {
  String month = DateTime.now().toIso8601String().substring(0, 7);

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Attendance')),
      body: ListView(padding: const EdgeInsets.only(bottom: 40), children: [
        Padding(padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4), child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [
          IconButton(onPressed: () => setState(() => month = monthAdd(month, -1)), icon: const Icon(Icons.chevron_left)),
          Text(monthName(month), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 17)),
          IconButton(onPressed: () => setState(() => month = monthAdd(month, 1)), icon: const Icon(Icons.chevron_right)),
        ])),
        Loader<Map<String, dynamic>>(
          key: ValueKey(month),
          load: () async => Map<String, dynamic>.from(await widget.s.api.rpc('pay_attendance_grid', {'p_month': month}) as Map),
          builder: (ctx, d, reload) {
            final days = (d['days'] as num?)?.toInt() ?? 30;
            final rows = ((d['rows'] as List?) ?? const []).map((e) => Map<String, dynamic>.from(e as Map)).toList();
            if (rows.isEmpty) return emptyBox(Icons.groups_outlined, 'No one this month');
            return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Padding(padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6), child: Wrap(spacing: 10, runSpacing: 4, children: [
                for (final e in _attLabel.entries) Row(mainAxisSize: MainAxisSize.min, children: [Container(width: 10, height: 10, decoration: BoxDecoration(color: attColor(e.key), borderRadius: BorderRadius.circular(3))), const SizedBox(width: 4), Text(e.value, style: TextStyle(fontSize: 12, color: Tk.label2))]),
              ])),
              for (final r in rows)
                Container(
                  margin: const EdgeInsets.fromLTRB(16, 6, 16, 6),
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(color: Tk.card, borderRadius: BorderRadius.circular(16), border: Border.all(color: Tk.line, width: .5)),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Row(children: [
                      Expanded(child: Text('${r['name']}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16))),
                      Text('${tr('Present')} ${r['present']} · ${tr('Absent')} ${r['absent']}${n(r['lop']) > 0 ? ' · ${tr('Unpaid')} ${qtyStr(n(r['lop']))}' : ''}', style: TextStyle(fontSize: 12, color: Tk.label2)),
                    ]),
                    const SizedBox(height: 8),
                    Wrap(spacing: 3, runSpacing: 3, children: [
                      for (var i = 0; i < '${r['cells']}'.length && i < days; i++)
                        Tooltip(
                          message: '${i + 1}: ${_attLabel['${r['cells']}'[i]] ?? ''}',
                          child: Container(
                            width: 20, height: 24, alignment: Alignment.center,
                            decoration: BoxDecoration(color: attColor('${r['cells']}'[i]).withValues(alpha: '${r['cells']}'[i] == '-' || '${r['cells']}'[i] == 'U' ? .05 : .16), borderRadius: BorderRadius.circular(5)),
                            child: Text('${i + 1}', style: TextStyle(fontSize: 10, fontWeight: FontWeight.w700, color: attColor('${r['cells']}'[i]))),
                          ),
                        ),
                    ]),
                  ]),
                ),
            ]);
          },
        ),
      ]),
    );
  }
}
