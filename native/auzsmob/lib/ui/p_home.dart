import 'package:flutter/material.dart' hide Text;
import '../core/calc.dart';
import '../core/session.dart';
import 'ds.dart';
import 'i18n.dart';
import 'mk.dart';
import 'p_purchase.dart';
import 'p_repairs.dart';
import 'theme.dart';

/// Home: four big thumb-friendly actions, the staffer's own work today, and (owner/manager) the shop's live numbers.
class HomePage extends StatefulWidget {
  const HomePage(this.s, this.go, {super.key});
  final MobSession s;
  final void Function(String) go;
  @override
  State<HomePage> createState() => _HomePageState();
}

class _HomePageState extends State<HomePage> {
  MobSession get s => widget.s;
  Map<String, dynamic>? dash;
  List<Map<String, dynamic>> activity = [];
  Map<String, String> names = {};
  String? err;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    if (!s.can('mob_reports')) return;
    try {
      final d = await s.api.rpc('mob_report_dashboard', {});
      final a = await s.api.rpc('mob_report_activity', {});
      final st = await s.staffList().catchError((_) => <Map<String, dynamic>>[]);
      if (!mounted) return;
      setState(() {
        dash = Map<String, dynamic>.from(d as Map);
        activity = (a as List).map((e) => Map<String, dynamic>.from(e as Map)).toList();
        names = {for (final x in st) '${x['id']}': '${x['name']}'};
        err = null;
      });
    } catch (e) {
      if (mounted) setState(() => err = '$e');
    }
  }

  Widget _big(String label, IconData i, VoidCallback f) => Expanded(
        child: Padding(
          padding: const EdgeInsets.all(5),
          child: Material(
            color: Tk.card,
            borderRadius: BorderRadius.circular(20),
            child: InkWell(
              borderRadius: BorderRadius.circular(20),
              onTap: f,
              child: Container(
                height: 132,
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(borderRadius: BorderRadius.circular(20), border: Border.all(color: Tk.line, width: .5)),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
                  Container(width: 44, height: 44, decoration: BoxDecoration(color: Tk.accent.withValues(alpha: .12), borderRadius: BorderRadius.circular(12)), child: Icon(i, color: Tk.accent, size: 26)),
                  Text(label, maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800)),
                ]),
              ),
            ),
          ),
        ),
      );

  @override
  Widget build(BuildContext context) {
    final r = s.repo!;
    final me = s.user?['id'];
    bool mine(Map<String, dynamic> x) => me == null || x['staff_id'] == me;
    bool today(Map<String, dynamic> x) {
      final d = DateTime.tryParse('${x['created_at'] ?? ''}')?.toLocal();
      return d != null && ymd(d) == todayStr();
    }

    final sales = r.rows('sales').where((x) => mine(x) && today(x) && x['voided'] != true).toList();
    final purchases = r.rows('purchases').where((x) => mine(x) && today(x)).toList();
    final repairs = r.rows('repairs').where((x) => mine(x) && today(x)).toList();
    final acts = <(String, IconData, VoidCallback)?>[
      if (s.can('mob_sell') && s.feat('sell')) ('New sale', Icons.point_of_sale, () => widget.go('sell')),
      if (s.can('mob_purchase') && s.feat('purchase')) ('Add purchase', Icons.add_shopping_cart, () => Navigator.push(context, MaterialPageRoute<void>(builder: (_) => PurchasePage(s)))),
      if (s.can('mob_repair') && s.repairsMode == 'full') ('New repair', Icons.build_outlined, () => openRepairSheet(context, s)),
      if (s.can('mob_purchase') && s.feat('purchase') && s.feat('serials')) ('Buy used phone', Icons.smartphone, () => Navigator.push(context, MaterialPageRoute<void>(builder: (_) => BuyUsedPage(s)))),
    ];
    final rows = <Widget>[];
    for (var i = 0; i < acts.length; i += 2) {
      rows.add(Padding(padding: const EdgeInsets.symmetric(horizontal: 11), child: Row(children: [
        _big(acts[i]!.$1, acts[i]!.$2, acts[i]!.$3),
        if (i + 1 < acts.length) _big(acts[i + 1]!.$1, acts[i + 1]!.$2, acts[i + 1]!.$3) else const Expanded(child: SizedBox.shrink()),
      ])));
    }
    String nm(dynamic id) => names['$id'] ?? '$id';
    return TabPage('Home', [
      ...rows,
      const SectionLabel('My work today'),
      metricGrid([
        Metric('Today\'s sales', '${sales.length}', sub: inr(sales.fold<double>(0, (a, x) => a + n(x['total'])))),
        Metric('Add purchase', '${purchases.length}'),
        Metric('Repairs', '${repairs.length}'),
      ]),
      if (s.can('mob_reports')) ...[
        if (err != null) Note(err!, bad: true),
        if (dash == null && err == null) const Padding(padding: EdgeInsets.all(24), child: Center(child: CircularProgressIndicator())),
        if (dash != null) ...[
          const SectionLabel('Today\'s sales'),
          metricGrid([
            Metric('Revenue', inr(n(dash!['sales_total'])), sub: '${dash!['sales_count']} ${tr('bills')}', hero: true),
            Metric('Profit', inr(n(dash!['profit_total']))),
            if (s.repairsMode == 'full') Metric('Pending repairs', '${dash!['repairs_pending']}', onTap: () => widget.go('repairs')),
            if (s.feat('customers')) Metric('Customer dues', inr(n(dash!['customer_dues'])), onTap: () => widget.go('dues')),
          ]),
          if (s.feat('stock') && (dash!['low_stock'] as List).isNotEmpty)
            Note('${(dash!['low_stock'] as List).length} ${tr('items low in stock')}: ${(dash!['low_stock'] as List).take(5).map((x) => (x as Map)['name']).join(', ')}', bad: true),
          const SectionLabel('Who did what'),
          if (activity.isEmpty) emptyBox(Icons.insights_outlined, tr('Nothing yet'))
          else
            Group([
              for (final a in activity.take(10))
                Li('${tr(a['kind'] == 'sale' ? 'New sale' : a['kind'] == 'purchase' ? 'Add purchase' : 'Repair job')} — ${nm(a['staff_id'])}', sub: fmtDT(a['at']), value: inr(n(a['amount'])), chevron: false),
            ]),
        ],
      ],
    ], onRefresh: () async {
      await s.repo!.retryNow();
      await _load();
    });
  }
}
