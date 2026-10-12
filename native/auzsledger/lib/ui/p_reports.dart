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

const _reports = [
  ('pnl', 'Profit and loss'),
  ('bs', 'Balance sheet'),
  ('tb', 'Trial balance'),
  ('gst', 'GST summary'),
  ('ar', 'Money to receive'),
  ('ap', 'Money to pay'),
  ('cf', 'Cash flow'),
];

List<Map<String, dynamic>> _maps(dynamic l) => ((l as List?) ?? const []).map((e) => Map<String, dynamic>.from(e as Map)).toList();

/// What one report shows: figures at the top, rows below, and the same rows as CSV.
class ReportView {
  ReportView(this.metrics, this.rows, this.csv);
  final List<(String, String, String?)> metrics; // label, value, sub
  final List<Widget> rows;
  final List<List<Object?>> csv;
}

ReportView buildReport(String id, Map<String, dynamic> d, String Function(num) money) {
  Widget head(String t, String v) => Padding(padding: const EdgeInsets.fromLTRB(16, 14, 16, 4), child: Row(children: [Expanded(child: Text(t, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15))), Text(v, style: const TextStyle(fontWeight: FontWeight.w800))]));
  Widget line(String t, num v, {String? sub}) => Li(t, sub: sub, value: money(v), chevron: false);
  switch (id) {
    case 'pnl':
      final groups = _maps(d['groups']);
      final csv = <List<Object?>>[['Line', 'Amount']];
      final rows = <Widget>[];
      for (final g in groups) {
        rows.add(head('${g['grp']}', money(n(g['total']))));
        csv.add(['${g['grp']}', n(g['total'])]);
        final accs = _maps(g['accounts']);
        rows.add(Group([for (final a in accs) line('${a['name']}', n(a['amount']))]));
        for (final a in accs) {
          csv.add(['  ${a['name']}', n(a['amount'])]);
        }
      }
      csv.add(['Net profit', n(d['net_profit'])]);
      return ReportView([
        ('Revenue', money(n(d['revenue'])), null),
        ('Gross profit', money(n(d['gross_profit'])), '${d['gross_margin'] ?? 0}% margin'),
        ('Expenses', money(n(d['expense'])), null),
        ('Net profit', money(n(d['net_profit'])), '${d['net_margin'] ?? 0}% margin'),
      ], rows, csv);
    case 'bs':
      final groups = _maps(d['groups']);
      final csv = <List<Object?>>[['Type', 'Group', 'Account', 'Amount']];
      final rows = <Widget>[];
      for (final type in const ['asset', 'liability', 'equity']) {
        final gs = groups.where((g) => g['type'] == type).toList();
        rows.add(head(type == 'asset' ? 'Assets' : type == 'liability' ? 'Liabilities' : 'Equity', money(n(d[type == 'asset' ? 'assets' : type == 'liability' ? 'liabilities' : 'equity']))));
        for (final g in gs) {
          final accs = _maps(g['accounts']);
          rows.add(Group([for (final a in accs) line('${a['name']}', n(a['amount']), sub: '${g['grp']}')]));
          for (final a in accs) {
            csv.add([type, '${g['grp']}', '${a['name']}', n(a['amount'])]);
          }
        }
        if (type == 'equity') {
          rows.add(Group([line('Retained earnings (earlier years)', n(d['retained_prior'])), line('Profit this year so far', n(d['current_profit']))]));
          csv.add(['equity', 'Equity', 'Retained earnings (earlier years)', n(d['retained_prior'])]);
          csv.add(['equity', 'Equity', 'Profit this year so far', n(d['current_profit'])]);
        }
      }
      return ReportView([
        ('Assets', money(n(d['assets'])), null),
        ('Liabilities and equity', money(n(d['liabilities']) + n(d['equity'])), d['balanced'] == true ? 'Balanced' : 'Out by ${money(n(d['difference']))}'),
      ], rows, csv);
    case 'tb':
      final rs = _maps(d['rows']);
      var dr = 0.0, cr = 0.0;
      final csv = <List<Object?>>[['Code', 'Account', 'Type', 'Debit', 'Credit', 'Closing']];
      final rows = <Widget>[];
      for (final r in rs) {
        final c = n(r['closing']);
        if (c >= 0) {
          dr += c;
        } else {
          cr -= c;
        }
        csv.add(['${r['code'] ?? ''}', '${r['name']}', '${r['type']}', n(r['debit']), n(r['credit']), c]);
      }
      rows.add(Group([for (final r in rs) Li('${r['name']}', sub: '${r['code'] ?? ''} · ${r['type']}', value: n(r['closing']) >= 0 ? '${money(n(r['closing']))} Dr' : '${money(-n(r['closing']))} Cr', chevron: false)]));
      return ReportView([('Total debit', money(dr), null), ('Total credit', money(cr), (dr - cr).abs() < .01 ? 'Balanced' : 'Out by ${money(dr - cr)}')], rows, csv);
    case 'gst':
      final out = Map<String, dynamic>.from((d['output'] as Map?) ?? const {});
      final itc = Map<String, dynamic>.from((d['itc'] as Map?) ?? const {});
      final pay = Map<String, dynamic>.from((d['payable'] as Map?) ?? const {});
      double tax(Map m) => n(m['cgst']) + n(m['sgst']) + n(m['igst']) + n(m['cess']);
      Widget block(String t, Map<String, dynamic> m) => Group([
            Li(t, value: money(tax(m)), chevron: false),
            line('CGST', n(m['cgst'])),
            line('SGST', n(m['sgst'])),
            line('IGST', n(m['igst'])),
            if (n(m['cess']) != 0) line('Cess', n(m['cess'])),
          ]);
      return ReportView([
        ('Output tax', money(tax(out)), 'On sales of ${money(n(out['taxable']))}'),
        ('Input tax credit', money(tax(itc)), n(itc['blocked']) != 0 ? '${money(n(itc['blocked']))} blocked' : null),
        ('Net payable', money(tax(pay)), 'After set-off, indicative'),
      ], [block('Tax on sales', out), block('Credit on purchases', itc), block('Payable', pay)], [
        ['Part', 'CGST', 'SGST', 'IGST', 'Cess'],
        ['Output', n(out['cgst']), n(out['sgst']), n(out['igst']), n(out['cess'])],
        ['Input credit', n(itc['cgst']), n(itc['sgst']), n(itc['igst']), n(itc['cess'])],
        ['Payable', n(pay['cgst']), n(pay['sgst']), n(pay['igst']), n(pay['cess'])],
      ]);
    case 'ar':
    case 'ap':
      final t = Map<String, dynamic>.from((d['totals'] as Map?) ?? const {});
      final rs = _maps(d['rows']);
      final csv = <List<Object?>>[['Party', 'Current', '1-30', '31-60', '61-90', '90+', 'Advance', 'Total']];
      for (final r in rs) {
        csv.add(['${r['name']}', n(r['current']), n(r['d30']), n(r['d60']), n(r['d90']), n(r['d90p']), n(r['advance']), n(r['total'])]);
      }
      double over(Map r) => n(r['d30']) + n(r['d60']) + n(r['d90']) + n(r['d90p']);
      return ReportView([
        ('Total', money(n(t['total'])), null),
        ('Overdue', money(n(t['d30']) + n(t['d60']) + n(t['d90']) + n(t['d90p'])), null),
        ('Over 90 days', money(n(t['d90p'])), null),
        ('Not yet due', money(n(t['current'])), null),
      ], [Group([for (final r in rs) Li('${r['name']}', sub: over(r) > 0 ? 'Overdue ${money(over(r))}' : null, value: money(n(r['total'])), chevron: false)])], csv);
    default: // cf
      final rs = _maps(d['rows']);
      final csv = <List<Object?>>[['Activity', 'Line', 'Amount']];
      final rows = <Widget>[];
      for (final act in const ['Operating', 'Investing', 'Financing']) {
        final part = rs.where((r) => r['activity'] == act).toList();
        if (part.isEmpty) continue;
        rows.add(head('$act activities', money(part.fold<double>(0, (a, r) => a + n(r['amount'])))));
        rows.add(Group([for (final r in part) line('${r['name']}', n(r['amount']))]));
        for (final r in part) {
          csv.add([act, '${r['name']}', n(r['amount'])]);
        }
      }
      return ReportView([
        ('Opening cash and bank', money(n(d['opening'])), null),
        ('Net change', money(n(d['net'])), null),
        ('Closing cash and bank', money(n(d['closing'])), null),
      ], rows, csv);
  }
}

String csvText(List<List<Object?>> rows) => rows.map((r) => r.map(csvEscape).join(',')).join('\n');

/// Reports from the books (needs the acc_reports permission). Read-only; the same RPCs as the website's Reports.
class ReportsPage extends StatefulWidget {
  const ReportsPage(this.s, {super.key});
  final LedgerSession s;
  @override
  State<ReportsPage> createState() => _ReportsPageState();
}

class _ReportsPageState extends State<ReportsPage> {
  LedgerSession get s => widget.s;
  String id = 'pnl', period = 'month';
  ReportView? last;

  Future<Map<String, dynamic>> _load() async {
    final (from, to) = reportPeriod(period, DateTime.now());
    final r = switch (id) {
      'pnl' => await s.api.rpc('acc_pnl', {'p_from': from, 'p_to': to}),
      'bs' => await s.api.rpc('acc_balance_sheet', {'p_asof': to.compareTo(todayStr()) > 0 ? todayStr() : to}),
      'tb' => await s.api.rpc('acc_trial_balance', {'p_from': from, 'p_to': to}),
      'gst' => await s.api.rpc('acc_gst_summary', {'p_from': from, 'p_to': to}),
      'ar' => await s.api.rpc('acc_ageing', {'p': {'kind': 'receivable', 'as_of': todayStr()}}),
      'ap' => await s.api.rpc('acc_ageing', {'p': {'kind': 'payable', 'as_of': todayStr()}}),
      _ => await s.api.rpc('acc_cash_flow', {'p_from': from, 'p_to': to}),
    };
    return Map<String, dynamic>.from(r as Map);
  }

  Future<void> _share() async {
    final v = last;
    if (v == null) return;
    try {
      final dir = await getTemporaryDirectory();
      final f = File('${dir.path}/auzsledger-$id-${todayStr()}.csv');
      await f.writeAsString('﻿${csvText(v.csv)}');
      await SharePlus.instance.share(ShareParams(files: [XFile(f.path)], text: 'AUZsLedger report'));
    } catch (e) {
      if (mounted) toast(context, '$e', err: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final (from, to) = reportPeriod(period, DateTime.now());
    final dated = id != 'ar' && id != 'ap';
    return Scaffold(
      appBar: AppBar(title: const Text('Reports'), actions: [iconBtn(Icons.ios_share, _share, tip: 'Share as a spreadsheet')]),
      body: ListView(padding: const EdgeInsets.only(bottom: 40), children: [
        SizedBox(height: 52, child: ListView(scrollDirection: Axis.horizontal, padding: const EdgeInsets.symmetric(horizontal: 12), children: [
          for (final r in _reports)
            Padding(padding: const EdgeInsets.symmetric(vertical: 6), child: Cat(r.$2, id == r.$1, () => setState(() => id = r.$1))),
        ])),
        if (dated)
          Pad(Seg<String>(items: const [('month', 'This month'), ('lastmonth', 'Last month'), ('fy', 'This year'), ('lastfy', 'Last year')], value: period, onChanged: (v) => setState(() => period = v), expand: true)),
        if (dated) Padding(padding: const EdgeInsets.symmetric(horizontal: 18), child: Text(id == 'bs' ? 'As of ${fmtD(to.compareTo(todayStr()) > 0 ? todayStr() : to)}' : '${fmtD(from)} – ${fmtD(to)}', style: TextStyle(color: Tk.label2, fontSize: 13))),
        gap(8),
        Loader<Map<String, dynamic>>(key: ValueKey('$id|$period'), load: _load, builder: (ctx, d, reload) {
          final v = buildReport(id, d, inr);
          last = v;
          return Column(children: [
            metricGrid([for (final m in v.metrics) Metric(m.$1, m.$2, sub: m.$3)]),
            ...v.rows,
          ]);
        }),
      ]),
    );
  }
}
