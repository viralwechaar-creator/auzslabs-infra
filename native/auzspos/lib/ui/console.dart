import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import '../core/billing.dart' show r2;
import '../core/repo.dart';
import 'actions.dart';
import 'console_pages.dart';
import 'ds.dart';
import 'home.dart';
import 'kit.dart';
import 'theme.dart';

/// One entry of the console menu. [kids] non-empty = an expandable group.
class CNode {
  const CNode(this.id, this.label, this.icon, [this.kids = const [], this.badge]);
  final String id, label;
  final IconData icon;
  final List<(String, String)> kids;
  final String? badge;
}

/// Same menu tree as the website console (NAV in console/core.js).
const consoleNav = <Object>[
  CNode('dashboard', 'Overview', Icons.home_outlined),
  'POS & Orders',
  CNode('daily/live', 'Live Orders', Icons.bolt_outlined),
  CNode('daily/all', 'All Orders', Icons.receipt_long_outlined),
  CNode('daily/online', 'Online Orders', Icons.public),
  CNode('daily/kot', 'KOT', Icons.receipt_outlined),
  CNode('daily/due', 'Due Payment', Icons.schedule),
  'Inventory & reports',
  CNode('g:inv', 'Inventory', Icons.inventory_2_outlined, [('inv/raw', 'Raw Materials'), ('inv/stock', 'Stock'), ('inv/purchase', 'Purchases'), ('inv/vendors', 'Vendors'), ('inv/recipes', 'Recipes'), ('inv/consumption', 'Consumption')]),
  CNode('g:rep', 'Reports', Icons.bar_chart, [('rep/sales', 'Sales'), ('rep/orders', 'Orders'), ('rep/items', 'Items'), ('rep/inventory', 'Inventory'), ('rep/customers', 'Customers'), ('rep/staff', 'Staff'), ('rep/analytics', 'Analytics'), ('rep/gst', 'GST Summary')]),
  'Manage',
  CNode('g:menu', 'Menu Management', Icons.restaurant_menu, [('menu/items', 'Items'), ('menu/categories', 'Categories'), ('menu/variants', 'Variants'), ('menu/addons', 'Add-ons'), ('menu/tables', 'Tables'), ('menu/taxes', 'Taxes'), ('menu/discounts', 'Discounts')]),
  CNode('g:crm', 'CRM', Icons.people_outline, [('crm/customers', 'Customers'), ('crm/giftcards', 'Gift Cards'), ('crm/membership', 'Membership'), ('crm/support', 'Support')]),
  CNode('g:team', 'Team Management', Icons.badge_outlined, [('team/users', 'Users & Roles'), ('team/attendance', 'Attendance'), ('team/tasks', 'Tasks')]),
  CNode('g:fin', 'Finance', Icons.account_balance_wallet_outlined, [('fin/expenses', 'Expenses'), ('fin/withdrawals', 'Cash movements'), ('fin/settlements', 'Settlements')]),
  CNode('g:mkt', 'Marketing', Icons.campaign_outlined, [('mkt/campaigns', 'Campaigns'), ('mkt/segments', 'Segments'), ('mkt/offers', 'Offers')], 'New'),
  CNode('g:int', 'Integrations', Icons.power_outlined, [('agg/platforms', 'Platform Settings')]),
  CNode('g:mgmt', 'Management', Icons.settings_outlined, [('mgmt/config', 'Configuration'), ('mgmt/qr', 'QR ordering & website'), ('mgmt/reasons', 'Cancellations'), ('mgmt/outlets', 'Outlets'), ('mgmt/devices', 'Devices')]),
  CNode('g:ql', 'Quick Links', Icons.star_outline, [('ql/custom', 'Custom Links')]),
];

String titleOfPage(String id) {
  for (final n in consoleNav) {
    if (n is CNode) {
      if (n.id == id) return n.label;
      for (final (k, l) in n.kids) {
        if (k == id) return l;
      }
    }
  }
  return 'Overview';
}

/// The Admin console inside the app: hamburger menu, title, search and bell on top, one page at a time, exactly the website console's structure.
class ConsolePage extends StatefulWidget {
  const ConsolePage(this.h, {this.start = 'dashboard', super.key});
  final HomeState h;
  final String start;
  @override
  State<ConsolePage> createState() => _ConsolePageState();
}

class _ConsolePageState extends State<ConsolePage> {
  late String page = widget.start;
  final open = <String>{};
  final key = GlobalKey<ScaffoldState>();
  HomeState get h => widget.h;

  void go(String id) {
    setState(() {
      page = id;
      for (final n in consoleNav) {
        if (n is CNode && n.kids.any((k) => k.$1 == id)) open.add(n.id);
      }
    });
    if (key.currentState?.isDrawerOpen ?? false) Navigator.pop(context);
  }

  int get _alerts {
    final r = h.s.repo!;
    final low = r.of('ing').where((g) => ((g['low'] ?? 0) as num) > 0 && ((g['qty'] ?? 0) as num) <= ((g['low'] ?? 0) as num)).length;
    final due = r.of('order').where((o) => o['status'] == 'due').length;
    return low + due + r.of('ticket').where((t) => t['status'] != 'closed' && t['status'] != 'done').length;
  }

  void _search() {
    final all = <(String, String)>[for (final n in consoleNav) if (n is CNode) ...[if (n.kids.isEmpty) (n.id, n.label), ...n.kids]];
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (ctx) {
        var q = '';
        return StatefulBuilder(builder: (ctx, set) {
          final hits = all.where((e) => e.$2.toLowerCase().contains(q.toLowerCase())).toList();
          return SafeArea(
            child: Padding(
              padding: EdgeInsets.fromLTRB(16, 0, 16, MediaQuery.of(ctx).viewInsets.bottom + 12),
              child: SizedBox(
                height: MediaQuery.of(ctx).size.height * .6,
                child: Column(children: [
                  TextField(autofocus: true, decoration: const InputDecoration(prefixIcon: Icon(Icons.search), hintText: 'Search pages'), onChanged: (v) => set(() => q = v)),
                  const SizedBox(height: 10),
                  Expanded(child: ListView(children: [Group([for (final e in hits) Li(e.$2, onTap: () {
                            Navigator.pop(ctx);
                            go(e.$1);
                          })])])),
                ]),
              ),
            ),
          );
        });
      },
    );
  }

  void _alertsSheet() {
    final r = h.s.repo!;
    final low = r.of('ing').where((g) => ((g['low'] ?? 0) as num) > 0 && ((g['qty'] ?? 0) as num) <= ((g['low'] ?? 0) as num)).toList();
    final due = r.of('order').where((o) => o['status'] == 'due').toList();
    final tk = r.of('ticket').where((t) => t['status'] != 'closed' && t['status'] != 'done').toList();
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (ctx) => SafeArea(
        child: ConstrainedBox(
          constraints: BoxConstraints(maxHeight: MediaQuery.of(ctx).size.height * .7),
          child: ListView(padding: const EdgeInsets.only(bottom: 16), children: [
            const Padding(padding: EdgeInsets.fromLTRB(20, 0, 20, 8), child: Text('Alerts', style: TextStyle(fontSize: 24, fontWeight: FontWeight.w800))),
            if (low.isEmpty && due.isEmpty && tk.isEmpty) const Empty(Icons.check_circle_outline, 'All clear', 'Low stock, dues and open tickets will show up here.'),
            if (low.isNotEmpty) Group([for (final g in low) Li('${g['name']} is running low', sub: '${g['qty']} ${g['unit'] ?? ''} left', icon: Icons.inventory_2_outlined, tone: Tk.orange, onTap: () {
                  Navigator.pop(ctx);
                  go('inv/raw');
                })]),
            if (due.isNotEmpty) ...[const SizedBox(height: 12), Group([Li('${due.length} bill${due.length == 1 ? '' : 's'} with payment due', icon: Icons.schedule, tone: Tk.red, onTap: () {
                    Navigator.pop(ctx);
                    go('daily/due');
                  })])],
            if (tk.isNotEmpty) ...[const SizedBox(height: 12), Group([Li('${tk.length} open support ticket${tk.length == 1 ? '' : 's'}', icon: Icons.support_agent, tone: Tk.blue, onTap: () {
                    Navigator.pop(ctx);
                    go('crm/support');
                  })])],
          ]),
        ),
      ),
    );
  }

  Widget _drawer() {
    Widget lbl(String t) => Padding(padding: const EdgeInsets.fromLTRB(20, 18, 16, 6), child: Text(t.toUpperCase(), style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w800, letterSpacing: .8, color: Tk.label3)));
    final kids = <Widget>[];
    for (final n in consoleNav) {
      if (n is String) {
        kids.add(lbl(n));
      } else if (n is CNode) {
        final isOpen = open.contains(n.id);
        final onGroup = n.kids.any((k) => k.$1 == page);
        if (n.kids.isEmpty) {
          kids.add(_navTile(n.icon, n.label, page == n.id, () => go(n.id)));
        } else {
          kids.add(_navTile(n.icon, n.label, onGroup && !isOpen, () => setState(() => isOpen ? open.remove(n.id) : open.add(n.id)), badge: n.badge, chev: isOpen));
          if (isOpen) {
            for (final (k, l) in n.kids) {
              kids.add(InkWell(
                onTap: () => go(k),
                child: Container(
                  margin: const EdgeInsets.fromLTRB(52, 1, 12, 1),
                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 11),
                  decoration: BoxDecoration(color: page == k ? Tk.accentSoft : null, borderRadius: BorderRadius.circular(12)),
                  child: Text(l, style: TextStyle(fontSize: 17, fontWeight: page == k ? FontWeight.w800 : FontWeight.w500, color: page == k ? Tk.accent : Tk.label)),
                ),
              ));
            }
          }
        }
      }
    }
    return Drawer(
      backgroundColor: Tk.bg,
      width: 330,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.horizontal(right: Radius.circular(24))),
      child: SafeArea(
        child: ListView(padding: const EdgeInsets.only(bottom: 20), children: [
          Padding(padding: const EdgeInsets.fromLTRB(20, 14, 20, 4), child: Row(children: [
            Image.asset('assets/icon.png', height: 36),
            const SizedBox(width: 12),
            Expanded(child: Text('${h.s.cfg['name']}', maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800))),
          ])),
          const Padding(padding: EdgeInsets.fromLTRB(20, 0, 20, 4), child: Text('Admin console', style: TextStyle(color: Tk.label2, fontSize: 15))),
          _navTile(Icons.storefront_outlined, 'Billing POS', false, () {
            Navigator.pop(context);
            Navigator.pop(context);
          }),
          ...kids,
          lbl('Account'),
          _navTile(Icons.logout, 'Sign out', false, () async {
            Navigator.pop(context);
            Navigator.pop(context);
            await h.s.signOut();
          }),
        ]),
      ),
    );
  }

  Widget _navTile(IconData i, String t, bool on, VoidCallback f, {String? badge, bool? chev}) => InkWell(
        onTap: f,
        child: Container(
          margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 1),
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 13),
          decoration: BoxDecoration(color: on ? Tk.accentSoft : null, borderRadius: BorderRadius.circular(14)),
          child: Row(children: [
            Icon(i, size: 24, color: on ? Tk.accent : Tk.label),
            const SizedBox(width: 14),
            Expanded(child: Text(t, style: TextStyle(fontSize: 18, fontWeight: on ? FontWeight.w800 : FontWeight.w600, color: on ? Tk.accent : Tk.label))),
            if (badge != null) Container(margin: const EdgeInsets.only(right: 6), padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 3), decoration: BoxDecoration(color: Tk.accentSoft, borderRadius: BorderRadius.circular(10)), child: Text(badge, style: TextStyle(fontSize: 12, fontWeight: FontWeight.w800, color: Tk.accent))),
            if (chev != null) Icon(chev ? Icons.expand_less : Icons.expand_more, color: Tk.label3),
          ]),
        ),
      );

  Widget _topBtn(IconData i, VoidCallback f, {int badge = 0}) => Padding(
        padding: const EdgeInsets.only(left: 8),
        child: Material(
          color: Colors.white,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18), side: const BorderSide(color: Tk.line, width: .8)),
          child: InkWell(
            customBorder: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
            onTap: f,
            child: SizedBox(width: 54, height: 54, child: Badge(isLabelVisible: badge > 0, smallSize: 10, child: Icon(i, size: 26))),
          ),
        ),
      );

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      key: key,
      drawer: _drawer(),
      backgroundColor: Tk.bg,
      body: Column(children: [
        Container(
          decoration: const BoxDecoration(color: Color(0xF5FAF9F7), border: Border(bottom: BorderSide(color: Tk.line, width: .5))),
          padding: EdgeInsets.fromLTRB(14, MediaQuery.of(context).padding.top + 8, 14, 10),
          child: Row(children: [
            Padding(padding: const EdgeInsets.only(right: 8), child: Material(color: Colors.white, shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18), side: const BorderSide(color: Tk.line, width: .8)), child: InkWell(customBorder: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)), onTap: () => key.currentState?.openDrawer(), child: const SizedBox(width: 54, height: 54, child: Icon(Icons.menu, size: 28))))),
            const SizedBox(width: 6),
            Expanded(child: Text(titleOfPage(page), maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 26, fontWeight: FontWeight.w800, letterSpacing: -.5))),
            _topBtn(Icons.search, _search),
            _topBtn(Icons.notifications_none, _alertsSheet, badge: _alerts),
          ]),
        ),
        Expanded(child: KeyedSubtree(key: ValueKey(page), child: consolePageFor(page, h, go))),
      ]),
    );
  }
}

/// Date range chips used by the report pages.
class RangeBar extends StatelessWidget {
  const RangeBar(this.days, this.onChange, {super.key});
  final int days;
  final ValueChanged<int> onChange;
  @override
  Widget build(BuildContext context) {
    final to = DateTime.now(), from = to.subtract(Duration(days: days - 1));
    const m = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    String d(DateTime x) => '${x.day} ${m[x.month - 1]}';
    return SizedBox(
      height: 60,
      child: ListView(scrollDirection: Axis.horizontal, padding: const EdgeInsets.fromLTRB(16, 8, 16, 6), children: [
        Container(
          margin: const EdgeInsets.only(right: 10),
          padding: const EdgeInsets.symmetric(horizontal: 16),
          decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(22), border: Border.all(color: Tk.accent, width: 1.5)),
          child: Row(children: [Icon(Icons.calendar_today_outlined, size: 20, color: Tk.accent), const SizedBox(width: 10), Text(days == 1 ? 'Today' : '${d(from)} – ${d(to)} ${to.year}', style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700))]),
        ),
        for (final (v, l) in const [(1, 'Today'), (7, '7 days'), (30, '30 days'), (90, '90 days')])
          Padding(padding: const EdgeInsets.only(right: 10), child: GestureDetector(onTap: () => onChange(v), child: Container(padding: const EdgeInsets.symmetric(horizontal: 18), alignment: Alignment.center, decoration: BoxDecoration(color: days == v ? Tk.accent : Colors.white, borderRadius: BorderRadius.circular(22), border: Border.all(color: days == v ? Tk.accent : Tk.line)), child: Text(l, style: TextStyle(fontSize: 17, fontWeight: FontWeight.w600, color: days == v ? Colors.white : Tk.label))))),
      ]),
    );
  }
}

/// Hero KPI + tiles used on console pages (dark accent card, then white tiles).
class Kpis extends StatelessWidget {
  const Kpis(this.hero, this.heroValue, this.heroSub, this.tiles, {super.key});
  final String hero, heroValue, heroSub;
  final List<(String, String, Color?)> tiles;
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.fromLTRB(16, 4, 16, 6),
        child: Column(children: [
          Container(
            width: double.infinity,
            padding: const EdgeInsets.fromLTRB(22, 22, 22, 22),
            decoration: BoxDecoration(color: Tk.accent, borderRadius: BorderRadius.circular(26)),
            child: Row(children: [
              Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text(hero, style: const TextStyle(color: Colors.white, fontSize: 22, fontWeight: FontWeight.w700)), const SizedBox(height: 4), Text(heroSub, style: const TextStyle(color: Colors.white70, fontSize: 17))])),
              Text(heroValue, style: const TextStyle(color: Colors.white, fontSize: 44, fontWeight: FontWeight.w800, letterSpacing: -1)),
            ]),
          ),
          const SizedBox(height: 12),
          Wrap(spacing: 12, runSpacing: 12, children: [
            for (final (l, v, c) in tiles)
              Container(
                width: (MediaQuery.of(context).size.width - 32 - 12) / 2,
                padding: const EdgeInsets.fromLTRB(18, 14, 18, 14),
                decoration: BoxDecoration(color: c == null ? Colors.white : c.withValues(alpha: .1), borderRadius: BorderRadius.circular(22), border: Border.all(color: c == null ? Tk.line : c.withValues(alpha: .35), width: .8)),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text(l, style: TextStyle(fontSize: 17, fontWeight: FontWeight.w600, color: c ?? Tk.label2)), const SizedBox(height: 4), Text(v, style: const TextStyle(fontSize: 30, fontWeight: FontWeight.w800, letterSpacing: -.5))]),
              ),
          ]),
        ]),
      );
}

String dayKey(DateTime d) => '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
String dayOfIso(dynamic iso) {
  final t = DateTime.tryParse('$iso')?.toLocal();
  return t == null ? '' : dayKey(t);
}

List<Map<String, dynamic>> paidIn(HomeState h, int days) {
  final from = dayKey(DateTime.now().subtract(Duration(days: days - 1)));
  return h.s.repo!.of('order').where((o) => o['status'] == 'paid' && dayOfIso(o['paidAt']).compareTo(from) >= 0).toList();
}

num totalOf(Map<String, dynamic> o) => ((o['t'] as Map?)?['total'] ?? 0) as num;

// ignore: unused_element
void _unused() => (r2, nowIso, orderSheet, launchUrl, formSheet);
