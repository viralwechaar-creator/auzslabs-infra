import 'package:flutter/material.dart' hide Text;
import 'i18n.dart';
import 'package:flutter/services.dart';
import 'package:qr_flutter/qr_flutter.dart';
import 'package:url_launcher/url_launcher.dart';
import '../core/billing.dart' show r2;
import '../core/session.dart';
import 'home.dart';
import 'kit.dart';
import 'more.dart';
import 'more2.dart';
import 'scan.dart';
import 'theme.dart';
import 'ds.dart';

String _day(DateTime d) => '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
String _dayOf(dynamic iso) {
  final t = DateTime.tryParse('$iso')?.toLocal();
  return t == null ? '' : _day(t);
}

String siteUrl(Session s, [String? table]) => 'https://${s.slug}.auzslab.in/site.html${table == null ? '' : '?t=$table'}';

/// The owner's Admin console, inside the app: the same sections as the website console, as grouped lists.
class AdminPage extends StatelessWidget {
  const AdminPage(this.h, {super.key});
  final HomeState h;
  @override
  Widget build(BuildContext context) {
    final s = h.s;
    void go(Widget Function() page) => Navigator.push(context, MaterialPageRoute<void>(builder: (_) => page()));
    Li row(IconData i, String t, String sub, Color tone, Widget Function() page) => Li(t, sub: sub, icon: i, tone: tone, onTap: () => go(page));
    return Scaffold(
      appBar: AppBar(title: const Text('Admin console')),
      body: ListView(padding: const EdgeInsets.only(bottom: 28), children: [
        const SizedBox(height: 8),
        Group([
          row(Icons.dashboard_outlined, 'Dashboard', 'Sales today, last 7 days, best sellers', Tk.purple, () => AdminDashboard(h)),
          if (s.can('reports') || s.can('m')) row(Icons.bar_chart, 'Reports', 'Sales, payments, top items', Tk.blue, () => ReportsPage(h)),
          row(Icons.insights_outlined, 'Today\'s report', 'Cash, UPI, card, refunds', const Color(0xFFF09A2E), () => DayReportPage(h)),
        ]),
        const SectionLabel('Menu and tables'),
        Group([
          if (s.can('menu') || s.can('m')) row(Icons.restaurant_menu, 'Menu', 'Items, categories, prices', Tk.green, () => MenuAdmin(h)),
          if (s.can('menu') || s.can('m')) row(Icons.table_restaurant_outlined, 'Tables and QR', 'Areas, tables, table QR codes', const Color(0xFF4FA8C0), () => TablesAdmin(h)),
          if (s.can('m')) row(Icons.percent, 'Taxes', 'GST rates for items', Tk.label3.withValues(alpha: .9), () => TaxAdmin(h)),
          if (s.can('m')) row(Icons.language, 'QR ordering and website', 'Your link, QR, UPI payments', Tk.teal, () => QrWebsitePage(h)),
        ]),
        const SectionLabel('Business'),
        Group([
          if (s.can('inventory') || s.can('m')) row(Icons.inventory_2_outlined, 'Stock', 'Raw materials and counts', Tk.label3.withValues(alpha: .9), () => StockAdmin(h)),
          if (s.can('crm') || s.can('m')) row(Icons.people_outline, 'Customers', 'Names, phones, visits', Tk.blue, () => CustomersAdmin(h)),
          if (s.can('m')) row(Icons.payments_outlined, 'Expenses', 'Money spent, by day', Tk.orange, () => ExpensesAdmin(h)),
          if (s.can('o')) row(Icons.badge_outlined, 'Team', 'Who can sign in', Tk.purple, () => TeamAdmin(h)),
        ]),
        const SectionLabel('Daily'),
        Group([
          row(Icons.point_of_sale, 'Register', 'Open and close the till', Tk.green, () => RegisterPage(h)),
          row(Icons.event_available_outlined, 'Reservations', 'Book and seat tables', Tk.blue, () => ReservationsPage(h)),
          row(Icons.access_time, 'Attendance and PIN', 'Clock in, approval PIN', Tk.orange, () => StaffPage(h)),
        ]),
        const SectionLabel('Settings'),
        Group([
          if (s.can('o')) row(Icons.settings_outlined, 'Settings', 'Business, tax, charges, discount limit', Tk.label3.withValues(alpha: .9), () => SettingsPage(h)),
          Li('Full web console', sub: 'Everything else, on the website', icon: Icons.language, tone: Tk.purple, onTap: () => launchUrl(Uri.https('app.auzslab.in', '/dashboard.html'), mode: LaunchMode.externalApplication)),
        ]),
      ]),
    );
  }
}

// ---------------------------------------------------------------- dashboard

class AdminDashboard extends StatelessWidget {
  const AdminDashboard(this.h, {this.embedded = false, super.key});
  final bool embedded;
  final HomeState h;
  @override
  Widget build(BuildContext context) {
    final s = h.s;
    final now = DateTime.now();
    final today = _day(now), yest = _day(now.subtract(const Duration(days: 1)));
    final paid = s.repo!.of('order').where((o) => o['status'] == 'paid').toList();
    double sum(String day) => paid.where((o) => _dayOf(o['paidAt']) == day).fold(0.0, (a, o) => a + (((o['t'] as Map?)?['total'] ?? 0) as num));
    int count(String day) => paid.where((o) => _dayOf(o['paidAt']) == day).length;
    final tSales = sum(today), ySales = sum(yest), tBills = count(today);
    final open = s.repo!.of('order').where((o) => o['status'] != 'paid' && o['status'] != 'void' && o['status'] != 'cancelled' && (o['lines'] as List? ?? []).isNotEmpty).length;
    final tables = s.repo!.of('table').length;
    final exp = s.repo!.of('exp').where((e) => e['d'] == today).fold(0.0, (a, e) => a + ((e['amt'] ?? 0) as num));
    final modes = <String, double>{};
    for (final o in paid.where((o) => _dayOf(o['paidAt']) == today)) {
      for (final p in ((o['pays'] as List?) ?? []).cast<Map>()) {
        modes['${p['m']}'] = (modes['${p['m']}'] ?? 0) + ((p['amt'] ?? 0) as num);
      }
    }
    final week = [for (var i = 6; i >= 0; i--) (_day(now.subtract(Duration(days: i))), sum(_day(now.subtract(Duration(days: i)))))];
    final maxW = week.fold<double>(1, (a, e) => e.$2 > a ? e.$2 : a);
    final items = <String, double>{};
    for (final o in paid.where((o) => _dayOf(o['paidAt']).compareTo(week.first.$1) >= 0)) {
      for (final l in ((o['lines'] as List?) ?? []).cast<Map>()) {
        items['${l['name']}'] = (items['${l['name']}'] ?? 0) + (l['price'] as num) * (l['qty'] as num);
      }
    }
    final top = items.entries.toList()..sort((a, b) => b.value.compareTo(a.value));
    final diff = ySales == 0 ? null : ((tSales - ySales) / ySales * 100).round();
    final low = s.repo!.of('ing').where((g) => ((g['low'] ?? 0) as num) > 0 && ((g['qty'] ?? 0) as num) <= ((g['low'] ?? 0) as num)).length;
    return Scaffold(
      appBar: embedded ? null : AppBar(title: const Text('Dashboard')),
      body: ListView(padding: const EdgeInsets.all(14), children: [
        Stat('Sales today', inr(r2(tSales)), sub: diff == null ? '$tBills bills' : '$tBills bills · ${diff >= 0 ? '+' : ''}$diff% vs yesterday', hero: true),
        const SizedBox(height: 10),
        GridView.count(crossAxisCount: 2, shrinkWrap: true, physics: const NeverScrollableScrollPhysics(), mainAxisSpacing: 10, crossAxisSpacing: 10, childAspectRatio: 1.9, children: [
          Stat('Open orders', '$open', sub: tables == 0 ? null : '$tables tables'),
          Stat('Expenses today', inr(r2(exp))),
          Stat('Yesterday', inr(r2(ySales))),
          Stat('Low stock', '$low', sub: low == 0 ? 'All good' : 'Needs restocking'),
        ]),
        const SizedBox(height: 12),
        _box('Last 7 days', [
          SizedBox(
            height: 120,
            child: Row(crossAxisAlignment: CrossAxisAlignment.end, children: [
              for (final d in week)
                Expanded(
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 3),
                    child: Column(mainAxisAlignment: MainAxisAlignment.end, children: [
                      Container(height: 6 + 84 * (d.$2 / maxW), decoration: BoxDecoration(color: d.$1 == today ? Tk.accent : Tk.accent.withValues(alpha: .35), borderRadius: BorderRadius.circular(6))),
                      const SizedBox(height: 4),
                      Text(d.$1.substring(8), style: TextStyle(fontSize: 11, color: Tk.label2)),
                    ]),
                  ),
                ),
            ]),
          ),
        ]),
        _box('Paid today by', [
          if (modes.isEmpty) Text('No payments yet today', style: TextStyle(color: Tk.label2)),
          for (final e in modes.entries) _kv(e.key == 'upi' ? 'UPI' : e.key[0].toUpperCase() + e.key.substring(1), inr(r2(e.value))),
        ]),
        _box('Best sellers this week', [
          if (top.isEmpty) Text('No sales yet', style: TextStyle(color: Tk.label2)),
          for (final e in top.take(6)) _kv(e.key, inr(r2(e.value))),
        ]),
      ]),
    );
  }
}

Widget _kv(String k, String v) => Padding(padding: const EdgeInsets.symmetric(vertical: 4), child: Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [Flexible(child: Text(k)), Text(v, style: const TextStyle(fontWeight: FontWeight.w700))]));
Widget _box(String t, List<Widget> kids) => Padding(padding: const EdgeInsets.only(top: 12), child: Container(padding: const EdgeInsets.all(14), decoration: BoxDecoration(color: Tk.card, borderRadius: BorderRadius.circular(16), border: Border.all(color: Tk.line, width: .5)), child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [Text(t, style: const TextStyle(fontWeight: FontWeight.w800)), const SizedBox(height: 8), ...kids])));

// ---------------------------------------------------------------- menu

class MenuAdmin extends StatefulWidget {
  const MenuAdmin(this.h, {this.embedded = false, this.tab = 0, super.key});
  final bool embedded;
  final int tab;
  final HomeState h;
  @override
  State<MenuAdmin> createState() => _MenuAdminState();
}

class _MenuAdminState extends State<MenuAdmin> with SingleTickerProviderStateMixin {
  late final TabController tc = TabController(length: 2, vsync: this, initialIndex: widget.tab);
  String q = '';
  Session get s => widget.h.s;

  Future<void> item([Map<String, dynamic>? it]) async {
    final cats = s.repo!.of('cat').toList()..sort((a, b) => '${a['name']}'.compareTo('${b['name']}'));
    if (cats.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Add a category first')));
      return;
    }
    final taxes = s.repo!.of('tax').toList();
    final groups = s.repo!.of('addongrp').toList();
    final sizesText = ((it?['sizes'] as List?) ?? []).cast<Map>().map((x) => '${x['l']} = ${x['p']}').join('\n');
    await formSheet(
      context,
      it == null ? 'New item' : 'Edit item',
      [
        F('name', 'Item name', value: it?['name']),
        F('cat', 'Category', type: 'select', value: it?['cat'] ?? cats.first['id'], options: [for (final c in cats) ['${c['id']}', '${c['name']}']]),
        F('price', 'Price (₹)', type: 'number', value: it?['price']),
        F('veg', 'Type', type: 'select', value: it?['veg'] ?? 'veg', options: const [['veg', 'Veg'], ['nonveg', 'Non-veg'], ['egg', 'Egg']]),
        if (taxes.isNotEmpty) F('taxId', 'Tax', type: 'select', value: it?['taxId'] ?? '', options: [['', 'Default rate'], for (final t in taxes) ['${t['id']}', '${t['name']} (${t['rate']}%)']]),
        F('sizes', 'Sizes (one per line, like  Small = 100). Leave empty for one price.', type: 'multiline', value: sizesText),
        if (groups.isNotEmpty) F('addonGroups', 'Add-on groups for this item', type: 'multi', value: [...((it?['addonGroups'] as List?) ?? const [])], options: [for (final g in groups) ['${g['id']}', '${g['name']}']]),
        F('desc', 'Description', type: 'multiline', value: it?['desc']),
        F('off', 'Sold out', type: 'check', value: it?['off'] == true),
      ],
      (v) async {
        if ('${v['name']}'.isEmpty || v['price'] == null) return false;
        final sizes = <Map<String, dynamic>>[];
        for (final ln in '${v['sizes'] ?? ''}'.split('\n')) {
          final parts = ln.split('=');
          if (parts.length != 2) continue;
          final pr = num.tryParse(parts[1].trim());
          if (parts[0].trim().isEmpty || pr == null) continue;
          sizes.add({'l': parts[0].trim(), 'p': pr});
        }
        final d = {...?it, 'sizes': sizes, if (groups.isNotEmpty) 'addonGroups': v['addonGroups'] ?? [], 'name': v['name'], 'cat': v['cat'], 'price': v['price'], 'veg': v['veg'], 'desc': v['desc'], 'off': v['off'] == true, 'taxId': ('${v['taxId'] ?? ''}').isEmpty ? null : v['taxId']};
        await s.repo!.save('item', d, id: it?['id'] as String?);
        setState(() {});
        s.sync();
        return true;
      },
      onDelete: it == null
          ? null
          : () async {
              await s.repo!.save('item', it, id: it['id'] as String, deleted: true);
              setState(() {});
              s.sync();
            },
    );
  }

  Future<void> cat([Map<String, dynamic>? c]) => formSheet(
        context,
        c == null ? 'New category' : 'Edit category',
        [F('name', 'Category name', value: c?['name']), F('active', 'Visible on menus', type: 'check', value: c?['active'] != false)],
        (v) async {
          if ('${v['name']}'.isEmpty) return false;
          await s.repo!.save('cat', {...?c, 'name': v['name'], 'active': v['active'] == true, 'n': c?['n'] ?? DateTime.now().millisecondsSinceEpoch}, id: c?['id'] as String?);
          setState(() {});
          s.sync();
          return true;
        },
        onDelete: c == null
            ? null
            : () async {
                await s.repo!.save('cat', c, id: c['id'] as String, deleted: true);
                setState(() {});
                s.sync();
              },
      );

  @override
  Widget build(BuildContext context) {
    final cats = s.repo!.of('cat').toList()..sort((a, b) => '${a['name']}'.compareTo('${b['name']}'));
    final catName = {for (final c in cats) '${c['id']}': '${c['name']}'};
    final items = s.repo!.of('item').where((i) => q.isEmpty || '${i['name']}'.toLowerCase().contains(q.toLowerCase())).toList()..sort((a, b) => '${catName[a['cat']]}${a['name']}'.compareTo('${catName[b['cat']]}${b['name']}'));
    return Scaffold(
      appBar: widget.embedded ? PreferredSize(preferredSize: const Size.fromHeight(48), child: Material(color: Tk.bg, child: TabBar(controller: tc, tabs: const [Tab(text: 'Items'), Tab(text: 'Categories')]))) : AppBar(title: const Text('Menu'), bottom: TabBar(controller: tc, tabs: const [Tab(text: 'Items'), Tab(text: 'Categories')])),
      floatingActionButton: ListenableBuilder(listenable: tc, builder: (_, _) => FloatingActionButton.extended(onPressed: () => tc.index == 0 ? item() : cat(), icon: const Icon(Icons.add), label: Text(tc.index == 0 ? 'Add item' : 'Add category'))),
      body: TabBarView(controller: tc, children: [
        Column(children: [
          Padding(padding: const EdgeInsets.fromLTRB(12, 10, 12, 4), child: TextField(decoration: InputDecoration(prefixIcon: Icon(Icons.search), hintText: tr('Search items')), onChanged: (v) => setState(() => q = v))),
          Expanded(
            child: items.isEmpty
                ? Empty(Icons.restaurant_menu, 'No items yet', 'Add your first item, or import a whole menu from the website console.', action: 'Add item', onAction: item)
                : ListView.builder(
                    padding: const EdgeInsets.fromLTRB(12, 4, 12, 90),
                    itemCount: items.length,
                    itemBuilder: (_, i) {
                      final it = items[i];
                      final first = i == 0 || items[i - 1]['cat'] != it['cat'];
                      return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        if (first) Padding(padding: const EdgeInsets.fromLTRB(4, 12, 0, 4), child: Text('${catName[it['cat']] ?? 'No category'}'.toUpperCase(), style: TextStyle(fontSize: 12, fontWeight: FontWeight.w800, color: Tk.label2, letterSpacing: .6))),
                        Card(
                          margin: const EdgeInsets.symmetric(vertical: 3),
                          child: ListTile(
                            onTap: () => item(it),
                            leading: Container(width: 14, height: 14, decoration: BoxDecoration(border: Border.all(color: it['veg'] == 'nonveg' ? Tk.red : Tk.green, width: 1.5), borderRadius: BorderRadius.circular(3)), child: Center(child: Container(width: 6, height: 6, decoration: BoxDecoration(shape: BoxShape.circle, color: it['veg'] == 'nonveg' ? Tk.red : Tk.green)))),
                            title: Text('${it['name']}', style: TextStyle(fontWeight: FontWeight.w700, decoration: it['off'] == true ? TextDecoration.lineThrough : null)),
                            subtitle: it['off'] == true ? Text('Sold out', style: TextStyle(color: Tk.red)) : null,
                            trailing: Text(inr((it['price'] ?? 0) as num), style: const TextStyle(fontWeight: FontWeight.w800)),
                          ),
                        ),
                      ]);
                    },
                  ),
          ),
        ]),
        cats.isEmpty
            ? Empty(Icons.category_outlined, 'No categories', 'Group your items, for example Tea, Snacks, Meals.', action: 'Add category', onAction: cat)
            : ListView(padding: const EdgeInsets.fromLTRB(12, 10, 12, 90), children: [
                for (final c in cats)
                  Card(child: ListTile(onTap: () => cat(c), title: Text('${c['name']}', style: const TextStyle(fontWeight: FontWeight.w700)), subtitle: Text('${s.repo!.of('item').where((i) => i['cat'] == c['id']).length} items${c['active'] == false ? ' · hidden' : ''}'), trailing: const Icon(Icons.chevron_right))),
              ]),
      ]),
    );
  }
}

// ---------------------------------------------------------------- tables + QR

class TablesAdmin extends StatefulWidget {
  const TablesAdmin(this.h, {this.embedded = false, super.key});
  final bool embedded;
  final HomeState h;
  @override
  State<TablesAdmin> createState() => _TablesAdminState();
}

class _TablesAdminState extends State<TablesAdmin> {
  Session get s => widget.h.s;

  Future<void> table([Map<String, dynamic>? t, String sec = 'Main']) => formSheet(
        context,
        t == null ? 'New table' : 'Edit table',
        [F('name', 'Table name or number', value: t?['name']), F('sec', 'Area', value: t?['sec'] ?? sec, hint: 'e.g. AC, Garden, Terrace'), F('seats', 'Seats', type: 'number', value: t?['seats'])],
        (v) async {
          if ('${v['name']}'.isEmpty) return false;
          await s.repo!.save('table', {...?t, 'name': v['name'], 'sec': ('${v['sec']}').isEmpty ? 'Main' : v['sec'], 'seats': v['seats']}, id: t?['id'] as String?);
          setState(() {});
          s.sync();
          return true;
        },
        onDelete: t == null
            ? null
            : () async {
                await s.repo!.save('table', t, id: t['id'] as String, deleted: true);
                setState(() {});
                s.sync();
              },
      );

  Future<void> bulk() => formSheet(
        context,
        'Add several tables',
        [F('prefix', 'Name prefix', value: 'T'), F('from', 'From number', type: 'number', value: 1), F('to', 'To number', type: 'number', value: 6), F('sec', 'Area', value: 'Main')],
        (v) async {
          final a = (v['from'] ?? 1) as num, b = (v['to'] ?? 1) as num;
          if (b < a || b - a > 100) return false;
          for (var n = a.toInt(); n <= b.toInt(); n++) {
            await s.repo!.save('table', {'name': '${v['prefix']}$n', 'sec': ('${v['sec']}').isEmpty ? 'Main' : v['sec']});
          }
          setState(() {});
          s.sync();
          return true;
        },
        saveLabel: 'Add tables',
      );

  @override
  Widget build(BuildContext context) {
    final ts = s.repo!.of('table').toList()..sort((a, b) => '${a['name']}'.compareTo('${b['name']}'));
    final secs = {for (final t in ts) '${t['sec'] ?? 'Main'}'}.toList()..sort();
    return Scaffold(
      appBar: AppBar(title: const Text('Tables and QR'), actions: [IconButton(tooltip: 'Add several', icon: const Icon(Icons.playlist_add), onPressed: bulk)]),
      floatingActionButton: FloatingActionButton.extended(onPressed: () => table(), icon: const Icon(Icons.add), label: const Text('Add table')),
      body: ts.isEmpty
          ? Empty(Icons.table_restaurant_outlined, 'No tables yet', 'Add tables so dine-in orders can be given a table, and so each table can have its own QR code.', action: 'Add several tables', onAction: bulk)
          : ListView(padding: const EdgeInsets.fromLTRB(12, 8, 12, 90), children: [
              for (final sc in secs) ...[
                Padding(padding: const EdgeInsets.fromLTRB(4, 14, 0, 6), child: Text(sc.toUpperCase(), style: TextStyle(fontSize: 12, fontWeight: FontWeight.w800, color: Tk.label2, letterSpacing: .6))),
                for (final t in ts.where((t) => '${t['sec'] ?? 'Main'}' == sc))
                  Card(
                    child: ListTile(
                      onTap: () => table(t),
                      title: Text('${t['name']}', style: const TextStyle(fontWeight: FontWeight.w700)),
                      subtitle: t['seats'] == null ? null : Text('${t['seats']} seats'),
                      trailing: IconButton(icon: const Icon(Icons.qr_code_2), tooltip: 'QR code', onPressed: () => showQr(context, s, '${t['name']}', siteUrl(s, '${t['id']}'))),
                    ),
                  ),
              ],
            ]),
    );
  }
}

/// Shows a QR code big enough to scan from a table, with copy and share.
void showQr(BuildContext c, Session s, String title, String url) {
  showModalBottomSheet<void>(
    context: c,
    showDragHandle: true,
    isScrollControlled: true,
    builder: (_) => Padding(
      padding: const EdgeInsets.fromLTRB(20, 0, 20, 24),
      child: Column(mainAxisSize: MainAxisSize.min, children: [
        Text('${s.cfg['name']}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 18)),
        Text(title, style: TextStyle(color: Tk.label2)),
        const SizedBox(height: 14),
        Container(padding: const EdgeInsets.all(12), decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(16), border: Border.all(color: Tk.line)), child: QrImageView(data: url, size: 240, eyeStyle: const QrEyeStyle(eyeShape: QrEyeShape.square, color: Colors.black), dataModuleStyle: const QrDataModuleStyle(dataModuleShape: QrDataModuleShape.square, color: Colors.black))),
        const SizedBox(height: 10),
        Text('Scan to view the menu and order', style: TextStyle(color: Tk.label2)),
        const SizedBox(height: 14),
        Row(children: [
          Expanded(child: OutlinedButton.icon(onPressed: () => Clipboard.setData(ClipboardData(text: url)), icon: const Icon(Icons.copy), label: const Text('Copy link'))),
          const SizedBox(width: 10),
          Expanded(child: FilledButton.icon(onPressed: () => launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication), icon: const Icon(Icons.open_in_new), label: const Text('Open'))),
        ]),
      ]),
    ),
  );
}

// ---------------------------------------------------------------- QR ordering + website

class QrWebsitePage extends StatefulWidget {
  const QrWebsitePage(this.h, {this.embedded = false, super.key});
  final bool embedded;
  final HomeState h;
  @override
  State<QrWebsitePage> createState() => _QrWebsitePageState();
}

class _QrWebsitePageState extends State<QrWebsitePage> {
  Session get s => widget.h.s;

  Future<void> upi() => formSheet(
        context,
        'Pay by UPI',
        [F('upiId', 'UPI ID', value: s.cfg['upiId'], hint: 'e.g. yourshop@okaxis'), F('upiName', 'Name shown to the payer', value: s.cfg['upiName'], hint: 'Defaults to your business name')],
        (v) async {
          await s.repo!.save('settings', {...s.cfg, 'upiId': v['upiId'], 'upiName': v['upiName']}, id: 'settings');
          setState(() {});
          s.sync();
          return true;
        },
      );

  @override
  Widget build(BuildContext context) {
    final url = siteUrl(s);
    final guests = s.repo!.of('table').length;
    return Scaffold(
      appBar: AppBar(title: const Text('QR ordering and website')),
      body: ListView(padding: const EdgeInsets.all(14), children: [
        Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(color: Tk.card, borderRadius: BorderRadius.circular(18), border: Border.all(color: Tk.line, width: .5)),
          child: Column(children: [
            const Text('Your ordering website', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
            const SizedBox(height: 4),
            Text(url, textAlign: TextAlign.center, style: TextStyle(color: Tk.label2, fontSize: 12)),
            const SizedBox(height: 12),
            QrImageView(data: url, size: 200),
            const SizedBox(height: 8),
            Row(children: [
              Expanded(child: OutlinedButton.icon(onPressed: () => Clipboard.setData(ClipboardData(text: url)), icon: const Icon(Icons.copy), label: const Text('Copy'))),
              const SizedBox(width: 10),
              Expanded(child: FilledButton.icon(onPressed: () => launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication), icon: const Icon(Icons.open_in_new), label: const Text('Open'))),
            ]),
          ]),
        ),
        const SizedBox(height: 12),
        Card(child: ListTile(leading: Icon(Icons.table_restaurant_outlined, color: Tk.accent), title: const Text('Table QR codes', style: TextStyle(fontWeight: FontWeight.w700)), subtitle: Text(guests == 0 ? 'Add tables first' : 'One QR for each of your $guests tables'), trailing: const Icon(Icons.chevron_right), onTap: () => Navigator.push(context, MaterialPageRoute<void>(builder: (_) => TablesAdmin(widget.h))))),
        Card(child: ListTile(leading: Icon(Icons.qr_code_scanner, color: Tk.accent), title: const Text('Scan a QR code', style: TextStyle(fontWeight: FontWeight.w700)), subtitle: const Text('Read a table or website QR with the camera'), trailing: const Icon(Icons.chevron_right), onTap: () => scanAndHandle(context, widget.h))),
        Card(child: ListTile(leading: Icon(Icons.account_balance_wallet_outlined, color: Tk.accent), title: const Text('Pay by UPI', style: TextStyle(fontWeight: FontWeight.w700)), subtitle: Text(('${s.cfg['upiId'] ?? ''}').isEmpty ? 'Not set up. Customers pay at the counter.' : '${s.cfg['upiId']}'), trailing: const Icon(Icons.chevron_right), onTap: upi)),
        Padding(padding: const EdgeInsets.all(8), child: Text('Guest orders arrive in the QR orders tab. Turn QR ordering on or off, and edit your website text and photos, in the full web console.', style: TextStyle(color: Tk.label2, fontSize: 12))),
      ]),
    );
  }
}

// ---------------------------------------------------------------- taxes

class TaxAdmin extends StatefulWidget {
  const TaxAdmin(this.h, {this.embedded = false, super.key});
  final bool embedded;
  final HomeState h;
  @override
  State<TaxAdmin> createState() => _TaxAdminState();
}

class _TaxAdminState extends State<TaxAdmin> {
  Session get s => widget.h.s;
  Future<void> tax([Map<String, dynamic>? t]) => formSheet(
        context,
        t == null ? 'New tax' : 'Edit tax',
        [F('name', 'Tax name', value: t?['name'], hint: 'e.g. GST 12%'), F('rate', 'Rate (%)', type: 'number', value: t?['rate']), F('inclusive', 'Prices include this tax', type: 'check', value: t?['inclusive'] == true)],
        (v) async {
          if ('${v['name']}'.isEmpty || v['rate'] == null) return false;
          await s.repo!.save('tax', {...?t, 'name': v['name'], 'rate': v['rate'], 'inclusive': v['inclusive'] == true}, id: t?['id'] as String?);
          setState(() {});
          s.sync();
          return true;
        },
        onDelete: t == null
            ? null
            : () async {
                await s.repo!.save('tax', t, id: t['id'] as String, deleted: true);
                setState(() {});
                s.sync();
              },
      );
  @override
  Widget build(BuildContext context) {
    final ts = s.repo!.of('tax').toList();
    return Scaffold(
      appBar: AppBar(title: const Text('Taxes')),
      floatingActionButton: FloatingActionButton.extended(onPressed: () => tax(), icon: const Icon(Icons.add), label: const Text('Add tax')),
      body: ts.isEmpty
          ? Empty(Icons.percent, 'Using one default rate', 'Every item uses ${s.cfg['tax']}% from Settings. Add other rates (for example 12% or 18%) and give them to specific items.', action: 'Add tax', onAction: tax)
          : ListView(padding: const EdgeInsets.all(12), children: [for (final t in ts) Card(child: ListTile(onTap: () => tax(t), title: Text('${t['name']}', style: const TextStyle(fontWeight: FontWeight.w700)), subtitle: Text(t['inclusive'] == true ? 'Included in price' : 'Added on top'), trailing: Text('${t['rate']}%', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16))))]),
    );
  }
}

// ---------------------------------------------------------------- stock

class StockAdmin extends StatefulWidget {
  const StockAdmin(this.h, {this.embedded = false, super.key});
  final bool embedded;
  final HomeState h;
  @override
  State<StockAdmin> createState() => _StockAdminState();
}

class _StockAdminState extends State<StockAdmin> {
  Session get s => widget.h.s;
  Future<void> ing([Map<String, dynamic>? g]) => formSheet(
        context,
        g == null ? 'New raw material' : 'Edit raw material',
        [
          F('name', 'Name', value: g?['name']),
          F('unit', 'Unit', type: 'select', value: g?['unit'] ?? 'kg', options: const [['kg', 'kg'], ['g', 'g'], ['l', 'litre'], ['ml', 'ml'], ['pcs', 'pieces'], ['pack', 'packs']]),
          F('qty', 'In stock now', type: 'number', value: g?['qty'] ?? 0),
          F('low', 'Warn me when it falls to', type: 'number', value: g?['low'] ?? 0),
          F('cost', 'Cost per unit (₹)', type: 'number', value: g?['cost']),
        ],
        (v) async {
          if ('${v['name']}'.isEmpty) return false;
          await s.repo!.save('ing', {...?g, 'name': v['name'], 'unit': v['unit'], 'qty': v['qty'] ?? 0, 'low': v['low'] ?? 0, 'cost': v['cost'] ?? 0}, id: g?['id'] as String?);
          setState(() {});
          s.sync();
          return true;
        },
        onDelete: g == null
            ? null
            : () async {
                await s.repo!.save('ing', g, id: g['id'] as String, deleted: true);
                setState(() {});
                s.sync();
              },
      );

  Future<void> adjust(Map<String, dynamic> g) => formSheet(
        context,
        'Adjust ${g['name']}',
        [F('q', 'Add or remove (use minus to remove) in ${g['unit'] ?? 'units'}', type: 'number')],
        (v) async {
          if (v['q'] == null) return false;
          await s.repo!.save('ing', {...g, 'qty': r2(((g['qty'] ?? 0) as num) + (v['q'] as num))}, id: g['id'] as String);
          setState(() {});
          s.sync();
          return true;
        },
      );

  @override
  Widget build(BuildContext context) {
    final gs = s.repo!.of('ing').toList()..sort((a, b) => '${a['name']}'.compareTo('${b['name']}'));
    bool isLow(Map g) => ((g['low'] ?? 0) as num) > 0 && ((g['qty'] ?? 0) as num) <= ((g['low'] ?? 0) as num);
    return Scaffold(
      appBar: AppBar(title: const Text('Stock')),
      floatingActionButton: FloatingActionButton.extended(onPressed: () => ing(), icon: const Icon(Icons.add), label: const Text('Add material')),
      body: gs.isEmpty
          ? Empty(Icons.inventory_2_outlined, 'No raw materials yet', 'Track what you buy and cook with: milk, flour, tea. You will get a warning when something runs low.', action: 'Add material', onAction: ing)
          : ListView(padding: const EdgeInsets.fromLTRB(12, 8, 12, 90), children: [
              for (final g in gs)
                Card(
                  child: ListTile(
                    onTap: () => ing(g),
                    title: Text('${g['name']}', style: const TextStyle(fontWeight: FontWeight.w700)),
                    subtitle: isLow(g) ? Text('Running low', style: TextStyle(color: Tk.orange, fontWeight: FontWeight.w600)) : null,
                    trailing: Row(mainAxisSize: MainAxisSize.min, children: [
                      Text('${g['qty'] ?? 0} ${g['unit'] ?? ''}', style: TextStyle(fontWeight: FontWeight.w800, color: isLow(g) ? Tk.orange : Tk.label)),
                      IconButton(icon: const Icon(Icons.tune), tooltip: 'Adjust', onPressed: () => adjust(g)),
                    ]),
                  ),
                ),
            ]),
    );
  }
}

// ---------------------------------------------------------------- customers

class CustomersAdmin extends StatefulWidget {
  const CustomersAdmin(this.h, {this.embedded = false, super.key});
  final bool embedded;
  final HomeState h;
  @override
  State<CustomersAdmin> createState() => _CustomersAdminState();
}

class _CustomersAdminState extends State<CustomersAdmin> {
  Session get s => widget.h.s;
  String q = '';
  Future<void> cust([Map<String, dynamic>? c]) => formSheet(
        context,
        c == null ? 'New customer' : 'Edit customer',
        [F('name', 'Name', value: c?['name']), F('phone', 'Phone', value: c?['phone']), F('email', 'Email', value: c?['email']), F('notes', 'Notes', type: 'multiline', value: c?['notes'])],
        (v) async {
          if ('${v['name']}'.isEmpty && '${v['phone']}'.isEmpty) return false;
          await s.repo!.save('customer', {...?c, 'name': v['name'], 'phone': v['phone'], 'email': v['email'], 'notes': v['notes']}, id: c?['id'] as String?);
          setState(() {});
          s.sync();
          return true;
        },
        onDelete: c == null
            ? null
            : () async {
                await s.repo!.save('customer', c, id: c['id'] as String, deleted: true);
                setState(() {});
                s.sync();
              },
      );
  @override
  Widget build(BuildContext context) {
    final paid = s.repo!.of('order').where((o) => o['status'] == 'paid').toList();
    final cs = s.repo!.of('customer').where((c) => q.isEmpty || '${c['name']} ${c['phone']}'.toLowerCase().contains(q.toLowerCase())).toList()..sort((a, b) => '${a['name']}'.compareTo('${b['name']}'));
    return Scaffold(
      appBar: AppBar(title: const Text('Customers')),
      floatingActionButton: FloatingActionButton.extended(onPressed: () => cust(), icon: const Icon(Icons.add), label: const Text('Add customer')),
      body: Column(children: [
        Padding(padding: const EdgeInsets.fromLTRB(12, 10, 12, 4), child: TextField(decoration: InputDecoration(prefixIcon: Icon(Icons.search), hintText: tr('Search name or phone')), onChanged: (v) => setState(() => q = v))),
        Expanded(
          child: cs.isEmpty
              ? Empty(Icons.people_outline, 'No customers yet', 'Add the customer on a bill and they appear here, with their visits and spend.', action: 'Add customer', onAction: cust)
              : ListView(padding: const EdgeInsets.fromLTRB(12, 4, 12, 90), children: [
                  for (final c in cs)
                    () {
                      final mine = paid.where((o) => (o['customer'] is Map ? (o['customer'] as Map)['id'] == c['id'] || (o['customer'] as Map)['phone'] == c['phone'] : false)).toList();
                      final spent = mine.fold<double>(0, (a, o) => a + (((o['t'] as Map?)?['total'] ?? 0) as num));
                      return Card(
                        child: ListTile(
                          onTap: () => cust(c),
                          leading: CircleAvatar(backgroundColor: Tk.accent.withValues(alpha: .12), child: Text(('${c['name']}'.isEmpty ? '#' : '${c['name']}'[0]).toUpperCase(), style: TextStyle(color: Tk.accent, fontWeight: FontWeight.w800))),
                          title: Text('${c['name']}'.isEmpty ? '${c['phone']}' : '${c['name']}', style: const TextStyle(fontWeight: FontWeight.w700)),
                          subtitle: Text('${c['phone'] ?? ''}${mine.isEmpty ? '' : ' · ${mine.length} visits'}'),
                          trailing: spent > 0 ? Text(inr(r2(spent)), style: const TextStyle(fontWeight: FontWeight.w800)) : null,
                        ),
                      );
                    }(),
                ]),
        ),
      ]),
    );
  }
}

// ---------------------------------------------------------------- expenses

class ExpensesAdmin extends StatefulWidget {
  const ExpensesAdmin(this.h, {this.embedded = false, super.key});
  final bool embedded;
  final HomeState h;
  @override
  State<ExpensesAdmin> createState() => _ExpensesAdminState();
}

class _ExpensesAdminState extends State<ExpensesAdmin> {
  Session get s => widget.h.s;
  Future<void> exp([Map<String, dynamic>? e]) => formSheet(
        context,
        e == null ? 'New expense' : 'Edit expense',
        [
          F('note', 'What was it for?', value: e?['note']),
          F('cat', 'Category', type: 'select', value: e?['cat'] ?? 'Other', options: [for (final c in const ['Raw material', 'Salary', 'Rent', 'Electricity', 'Repairs', 'Marketing', 'Other']) [c, c]]),
          F('amt', 'Amount (₹)', type: 'number', value: e?['amt']),
          F('d', 'Date (YYYY-MM-DD)', value: e?['d'] ?? _day(DateTime.now())),
          F('mode', 'Paid from', type: 'select', value: e?['mode'] ?? 'cash', options: const [['cash', 'Cash drawer'], ['bank', 'Bank / UPI'], ['owner', 'Owner pocket']]),
        ],
        (v) async {
          if ('${v['note']}'.isEmpty || v['amt'] == null || (v['amt'] as num) <= 0) return false;
          await s.repo!.save('exp', {...?e, 'note': v['note'], 'cat': v['cat'], 'amt': v['amt'], 'd': v['d'], 'mode': v['mode'], 'at': e?['at'] ?? DateTime.now().toUtc().toIso8601String()}, id: e?['id'] as String?);
          setState(() {});
          s.sync();
          return true;
        },
        onDelete: e == null
            ? null
            : () async {
                await s.repo!.save('exp', e, id: e['id'] as String, deleted: true);
                setState(() {});
                s.sync();
              },
      );
  @override
  Widget build(BuildContext context) {
    final es = s.repo!.of('exp').toList()..sort((a, b) => '${b['d']}${b['at']}'.compareTo('${a['d']}${a['at']}'));
    final month = _day(DateTime.now()).substring(0, 7);
    final mSum = es.where((e) => '${e['d']}'.startsWith(month)).fold<double>(0, (a, e) => a + ((e['amt'] ?? 0) as num));
    return Scaffold(
      appBar: AppBar(title: const Text('Expenses')),
      floatingActionButton: FloatingActionButton.extended(onPressed: () => exp(), icon: const Icon(Icons.add), label: const Text('Add expense')),
      body: es.isEmpty
          ? Empty(Icons.payments_outlined, 'No expenses yet', 'Record what you spend (milk, rent, salaries) so your profit is real.', action: 'Add expense', onAction: exp)
          : ListView(padding: const EdgeInsets.fromLTRB(12, 10, 12, 90), children: [
              Stat('This month', inr(r2(mSum)), hero: true),
              const SizedBox(height: 8),
              for (final e in es) Card(child: ListTile(onTap: () => exp(e), title: Text('${e['note']}', style: const TextStyle(fontWeight: FontWeight.w700)), subtitle: Text('${e['d']} · ${e['cat'] ?? ''}'), trailing: Text(inr((e['amt'] ?? 0) as num), style: const TextStyle(fontWeight: FontWeight.w800)))),
            ]),
    );
  }
}

// ---------------------------------------------------------------- team

class TeamAdmin extends StatefulWidget {
  const TeamAdmin(this.h, {this.embedded = false, super.key});
  final bool embedded;
  final HomeState h;
  @override
  State<TeamAdmin> createState() => _TeamAdminState();
}

class _TeamAdminState extends State<TeamAdmin> {
  Session get s => widget.h.s;
  late Future<List<Map<String, dynamic>>> f = s.api.select('profiles', select: 'id,name,role,username,login_off');
  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('Team')),
        body: FutureBuilder(
          future: f,
          builder: (_, snap) {
            if (snap.connectionState != ConnectionState.done) return const Center(child: CircularProgressIndicator());
            if (snap.hasError) return Empty(Icons.cloud_off, 'Could not load the team', 'Check your internet and try again.', action: 'Try again', onAction: () => setState(() => f = s.api.select('profiles', select: 'id,name,role,username,login_off')));
            final ps = snap.data!;
            return ListView(padding: const EdgeInsets.all(12), children: [
              for (final p in ps)
                Card(
                  child: ListTile(
                    leading: CircleAvatar(backgroundColor: Tk.accent.withValues(alpha: .12), child: Icon(p['role'] == 'owner' ? Icons.star : Icons.person, color: Tk.accent)),
                    title: Text('${p['name'] ?? p['username'] ?? 'Team member'}', style: const TextStyle(fontWeight: FontWeight.w700)),
                    subtitle: Text('${p['role']}${p['username'] != null ? ' · ${p['username']}' : ''}${p['login_off'] == true ? ' · login off' : ''}'),
                  ),
                ),
              Padding(padding: const EdgeInsets.all(12), child: FilledButton.icon(onPressed: () => launchUrl(Uri.https('app.auzslab.in', '/account.html'), mode: LaunchMode.externalApplication), icon: const Icon(Icons.person_add_alt), label: const Text('Add or manage staff on the website'))),
            ]);
          },
        ),
      );
}
