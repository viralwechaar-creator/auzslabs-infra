import 'dart:io';
import 'package:flutter/material.dart' hide Text;
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';
import '../core/calc.dart';
import '../core/session.dart';
import 'ds.dart';
import 'i18n.dart';
import 'mk.dart';
import 'theme.dart';

/// Reports (owner / manager): Dashboard, Staff ledger (who bought what from whom for how much, who sold it to whom, profit) and
/// Staff updates (a feed of every sale, purchase and repair). Totals come from the server: a staff phone only holds its own data.
class ReportsPage extends StatefulWidget {
  const ReportsPage(this.s, {super.key});
  final MobSession s;
  @override
  State<ReportsPage> createState() => _ReportsPageState();
}

class _ReportsPageState extends State<ReportsPage> {
  MobSession get s => widget.s;
  String tab = 'dashboard', range = 'today', staffId = '';
  String? from, to;
  Future<Map<String, dynamic>>? fut;
  int ver = 0;

  @override
  void initState() {
    super.initState();
    fut = _load();
  }

  void _reload() => setState(() => fut = _load());

  Future<Map<String, dynamic>> _load() async {
    final (a, b) = rangeDates(range, from: from, to: to);
    final names = await s.staffList(refresh: true);
    if (tab == 'ledger') {
      final d = await s.api.rpc('mob_report_ledger', {'p_from': a, 'p_to': b, 'p_staff_id': staffId.isEmpty ? null : staffId});
      return {'names': names, 'data': Map<String, dynamic>.from(d as Map)};
    }
    if (tab == 'updates') {
      final d = await s.api.rpc('mob_report_activity', {'p_from': a, 'p_to': b});
      return {'names': names, 'data': d};
    }
    final d = await s.api.rpc('mob_report_dashboard', {'p_from': a, 'p_to': b});
    return {'names': names, 'data': Map<String, dynamic>.from(d as Map)};
  }

  Future<void> _export() async {
    try {
      final d = Map<String, dynamic>.from(await s.api.rpc('mob_report_ledger', {'p_from': '2000-01-01', 'p_to': todayStr(), 'p_limit': 1000000}) as Map);
      final rows = (d['rows'] as List? ?? const []).map((e) => Map<String, dynamic>.from(e as Map)).toList();
      final dir = await getTemporaryDirectory();
      final f = File('${dir.path}/auzsmob-report-${todayStr()}.csv');
      await f.writeAsString(ledgerCsv(rows));
      await SharePlus.instance.share(ShareParams(files: [XFile(f.path)], text: 'AUZsMob report'));
    } catch (e) {
      if (mounted) toast(context, '$e', err: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    return TabPage('Reports', [
      Pad(Seg<String>(expand: true, items: const [('dashboard', 'Dashboard'), ('ledger', 'Staff ledger'), ('updates', 'Staff updates')], value: tab, onChanged: (v) {
        tab = v;
        _reload();
      })),
      RangeBar(range: range, from: from, to: to, onPick: (r, f, t) {
        range = r;
        from = f;
        to = t;
        _reload();
      }),
      FutureBuilder<Map<String, dynamic>>(
        future: fut,
        builder: (ctx, snap) {
          if (snap.connectionState != ConnectionState.done) return const Padding(padding: EdgeInsets.all(32), child: Center(child: CircularProgressIndicator()));
          if (snap.hasError) return Note('${snap.error}', bad: true);
          final names = (snap.data!['names'] as List).map((e) => Map<String, dynamic>.from(e as Map)).toList();
          String nm(dynamic id) => '${names.where((x) => x['id'] == id).firstOrNull?['name'] ?? id}';
          if (tab == 'ledger') return _ledger(Map<String, dynamic>.from(snap.data!['data'] as Map), names);
          if (tab == 'updates') return _updates(snap.data!['data'] as List, names, nm);
          return _dash(Map<String, dynamic>.from(snap.data!['data'] as Map), nm);
        },
      ),
    ], actions: [iconBtn(Icons.ios_share, _export, tip: 'Export to spreadsheet')], onRefresh: () async => _reload());
  }

  Widget _dash(Map<String, dynamic> d, String Function(dynamic) nm) {
    final by = (d['by_staff'] as List? ?? const []).map((e) => Map<String, dynamic>.from(e as Map)).toList();
    final low = (d['low_stock'] as List? ?? const []);
    return Column(children: [
      metricGrid([
        Metric('Revenue', inr(n(d['sales_total'])), hero: true),
        Metric('Profit', inr(n(d['profit_total']))),
        Metric('Pending repairs', '${d['repairs_pending']}'),
        Metric('Customer dues', inr(n(d['customer_dues']))),
      ]),
      const Align(alignment: Alignment.centerLeft, child: SectionLabel('By staff')),
      if (by.isEmpty) emptyBox(Icons.insights_outlined, tr('Nothing yet'))
      else
        Group([for (final x in by) Li(nm(x['staff_id']), sub: '${x['sales']} ${tr('bills')} · ${tr('Profit')} ${inr(n(x['profit']))}', value: inr(n(x['revenue'])), icon: Icons.person_outline, tone: Tk.accent, chevron: false)]),
      if (low.isNotEmpty) ...[
        const Align(alignment: Alignment.centerLeft, child: SectionLabel('Low stock')),
        Group([for (final x in low) Li('${(x as Map)['name']}', value: qtyStr(n(x['qty'])), icon: Icons.warning_amber_rounded, tone: Tk.red, chevron: false)]),
      ],
    ]);
  }

  Widget _updates(List data, List<Map<String, dynamic>> names, String Function(dynamic) nm) {
    final all = data.map((e) => Map<String, dynamic>.from(e as Map)).toList();
    final rows = staffId.isEmpty ? all : all.where((x) => x['staff_id'] == staffId).toList();
    return Column(children: [
      Pad(Sel('All staff', staffId, [('', tr('All staff')), for (final x in names) ('${x['id']}', '${x['name']}')], (v) {
        staffId = v;
        setState(() {});
      })),
      Hint(tr('Every sale, purchase and repair your staff entered, newest first.')),
      if (rows.isEmpty) emptyBox(Icons.insights_outlined, tr('Nothing yet'))
      else
        Group([for (final a in rows) Li('${tr(a['kind'] == 'sale' ? 'New sale' : a['kind'] == 'purchase' ? 'Add purchase' : 'Repair job')} — ${nm(a['staff_id'])}', sub: fmtDT(a['at']), value: inr(n(a['amount'])), chevron: false)]),
    ]);
  }

  Widget _ledger(Map<String, dynamic> d, List<Map<String, dynamic>> names) {
    final rows = (d['rows'] as List? ?? const []).map((e) => Map<String, dynamic>.from(e as Map)).toList();
    return Column(children: [
      Pad(Sel('All staff', staffId, [('', tr('All staff')), for (final x in names) ('${x['id']}', '${x['name']}')], (v) {
        staffId = v;
        _reload();
      })),
      Hint(tr('One row per item sold: who bought it from whom, who sold it to whom, and the profit.')),
      metricGrid([
        Metric('Total sales', inr(n(d['total_sale']))),
        Metric('Total cost', inr(n(d['total_cost']))),
        Metric('Total profit', inr(n(d['total_profit'])), tone: n(d['total_profit']) < 0 ? Tk.red : Tk.green),
      ]),
      _share(rows, names),
      if (d['truncated'] == true) Hint(trv('Showing the newest {n} of {total}.', {'n': rows.length, 'total': d['total_rows'] ?? '…'})),
      if (rows.isEmpty) emptyBox(Icons.receipt_long_outlined, tr('Nothing yet'))
      else
        for (final r in rows) LedgerCard(r, () => _ledgerDetail(r)),
    ]);
  }

  Widget _share(List<Map<String, dynamic>> rows, List<Map<String, dynamic>> names) {
    final pct = s.sharePct;
    if (pct <= 0) return const SizedBox.shrink();
    final by = <String, double>{};
    for (final r in rows) {
      if (r['sold_by_id'] != null) by['${r['sold_by_id']}'] = (by['${r['sold_by_id']}'] ?? 0) + n(r['profit']);
    }
    final list = [
      for (final e in by.entries)
        if ((names.where((x) => x['id'] == e.key).firstOrNull?['role']) != 'owner') (e.key, names.where((x) => x['id'] == e.key).firstOrNull?['name'] ?? e.key, r2(e.value), splitProfit(e.value, pct)),
    ];
    if (list.isEmpty) return const SizedBox.shrink();
    final shop = list.fold(0.0, (a, x) => a + x.$4.shop), keep = list.fold(0.0, (a, x) => a + x.$4.staff);
    return Column(children: [
      SectionLabel('${tr('Profit sharing')} (${qtyStr(pct)}%)'),
      metricGrid([Metric('Owner\'s share', inr(r2(shop)), tone: Tk.green), Metric('Staff keep', inr(r2(keep)))]),
      Group([for (final x in list) Li('${x.$2}', sub: '${tr('Total profit')} ${inr(x.$3)}', value: inr(x.$4.shop), icon: Icons.person_outline, tone: Tk.accent, chevron: false)]),
    ]);
  }

  void _ledgerDetail(Map<String, dynamic> r) {
    openSheet(context, '${r['item_name']}', (ctx, set) => Group([
          Li('Date', value: fmtDT(r['sold_at']), chevron: false),
          if (r['imei'] != null) Li('IMEI', value: '${r['imei']}', chevron: false),
          Li('Bought from', value: '${r['vendor_name'] ?? tr('No vendor linked')}', chevron: false),
          Li('Bought by', value: '${r['purchased_by'] ?? '—'}', chevron: false),
          Li('Total cost', value: inr(n(r['cost_total'])), chevron: false),
          Li('Sold by', value: '${r['sold_by'] ?? '—'}', chevron: false),
          Li('Sold to', value: '${r['customer_name'] ?? ''}', chevron: false),
          Li('Total sales', value: inr(n(r['sale_total'])), chevron: false),
          Li('Profit', value: inr(n(r['profit'])), chevron: false),
        ]));
  }
}

/// One card per sold item with quantity, purchase price, selling price and profit all visible at once.
class LedgerCard extends StatelessWidget {
  const LedgerCard(this.r, this.onTap, {this.showCost = true, super.key});
  final Map<String, dynamic> r;
  final VoidCallback? onTap;
  final bool showCost;
  Widget _c(String cap, String v, {Color? tone}) => Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text(cap, style: TextStyle(fontSize: 12, color: Tk.label2)), Text(v, style: TextStyle(fontSize: 16, fontWeight: FontWeight.w800, color: tone ?? Tk.label))]));
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 5),
        child: Material(
          color: Tk.card,
          borderRadius: BorderRadius.circular(18),
          child: InkWell(
            borderRadius: BorderRadius.circular(18),
            onTap: onTap,
            child: Container(
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(borderRadius: BorderRadius.circular(18), border: Border.all(color: Tk.line, width: .5)),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Row(children: [Expanded(child: Text('${r['item_name']}${r['imei'] != null ? ' · ${r['imei']}' : ''}', style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700))), Text(fmtDT(r['sold_at']), style: TextStyle(fontSize: 12, color: Tk.label2))]),
                const SizedBox(height: 10),
                Row(children: [
                  _c(tr('Qty'), qtyStr(n(r['qty']))),
                  if (showCost) _c(tr('Purchase rate'), inr(n(r['cost_total']))),
                  _c(tr('Selling price'), inr(n(r['sale_total']))),
                  _c(tr('Profit'), inr(n(r['profit'])), tone: n(r['profit']) < 0 ? Tk.red : Tk.green),
                ]),
              ]),
            ),
          ),
        ),
      );
}

/// A staffer's own sales and profit (mob_report_mine returns ONLY the caller's own sales; purchase prices only when allowed).
class MyReportPage extends StatefulWidget {
  const MyReportPage(this.s, {super.key});
  final MobSession s;
  @override
  State<MyReportPage> createState() => _MyReportPageState();
}

class _MyReportPageState extends State<MyReportPage> {
  MobSession get s => widget.s;
  String range = 'today';
  String? from, to;
  Future<Map<String, dynamic>>? fut;
  @override
  void initState() {
    super.initState();
    fut = _load();
  }

  Future<Map<String, dynamic>> _load() async {
    final (a, b) = rangeDates(range, from: from, to: to);
    return Map<String, dynamic>.from(await s.api.rpc('mob_report_mine', {'p_from': a, 'p_to': b}) as Map);
  }

  @override
  Widget build(BuildContext context) {
    return TabPage('My sales', [
      RangeBar(range: range, from: from, to: to, onPick: (r, f, t) => setState(() {
            range = r;
            from = f;
            to = t;
            fut = _load();
          })),
      FutureBuilder<Map<String, dynamic>>(
        future: fut,
        builder: (ctx, snap) {
          if (snap.connectionState != ConnectionState.done) return const Padding(padding: EdgeInsets.all(32), child: Center(child: CircularProgressIndicator()));
          if (snap.hasError) return Note('${snap.error}', bad: true);
          final d = snap.data!;
          final rows = (d['rows'] as List? ?? const []).map((e) => Map<String, dynamic>.from(e as Map)).toList();
          final sp = s.split(n(d['total_profit']));
          return Column(children: [
            metricGrid([Metric('Total sales', inr(n(d['total_sale'])), sub: '${d['bills']} ${tr('bills')}'), Metric('Total profit', inr(n(d['total_profit'])), tone: n(d['total_profit']) < 0 ? Tk.red : Tk.green)]),
            if (s.sharePct > 0) metricGrid([Metric('Owner\'s share (${qtyStr(sp.pct)}%)', inr(sp.shop)), Metric('You keep', inr(sp.staff), tone: Tk.green)]),
            if (rows.isEmpty) emptyBox(Icons.receipt_long_outlined, tr('Nothing yet'))
            else
              for (final r in rows) LedgerCard(r, null, showCost: d['can_see_cost'] == true),
          ]);
        },
      ),
    ], onRefresh: () async => setState(() => fut = _load()));
  }
}
