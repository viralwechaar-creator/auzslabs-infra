import 'package:flutter/material.dart' hide Text;
import 'package:url_launcher/url_launcher.dart';
import '../core/session.dart';
import 'ds.dart';
import 'i18n.dart';
import 'mk.dart';
import 'p_dues.dart';
import 'p_home.dart';
import 'p_repairs.dart';
import 'p_reports.dart';
import 'p_sell.dart';
import 'p_settings.dart';
import 'p_stock.dart';
import 'theme.dart';
import 'mydata.dart';
import 'printer.dart';

const _icons = {
  'home': Icons.home_outlined,
  'sell': Icons.point_of_sale,
  'repairs': Icons.build_outlined,
  'stock': Icons.inventory_2_outlined,
  'reports': Icons.bar_chart,
  'myreport': Icons.bar_chart,
  'dues': Icons.account_balance_wallet_outlined,
  'settings': Icons.settings_outlined,
};
const _labels = {'home': 'Home', 'sell': 'New sale', 'repairs': 'Repairs', 'stock': 'Stock', 'reports': 'Reports', 'myreport': 'My sales', 'dues': 'Dues', 'settings': 'Settings'};

class MobShell extends StatefulWidget {
  const MobShell(this.s, {super.key});
  final MobSession s;
  @override
  State<MobShell> createState() => _MobShellState();
}

class _MobShellState extends State<MobShell> with WidgetsBindingObserver {
  MobSession get s => widget.s;
  String cur = 'home';
  final cart = SellCart();

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    s.refused.addListener(_refused);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    s.refused.removeListener(_refused);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState st) {
    if (st == AppLifecycleState.resumed) s.repo?.retryNow();
  }

  void _refused() {
    final m = s.refused.value;
    if (m == null || !mounted) return;
    s.refused.value = null;
    toast(context, '${tr('Not saved')}: $m', err: true);
  }

  void go(String id) => setState(() => cur = id);

  Widget _page() => switch (cur) {
        'sell' => SellPage(s, cart),
        'repairs' => RepairsPage(s),
        'stock' => StockPage(s),
        'reports' => ReportsPage(s),
        'myreport' => MyReportPage(s),
        'dues' => DuesPage(s),
        'settings' => SettingsPage(s),
        _ => HomePage(s, go),
      };

  Widget _syncPill() {
    final r = s.repo!;
    final n = r.outboxCount;
    late String text;
    late Color tone;
    if (r.offline) {
      text = n > 0 ? trv('Not synced ({n}) · tap to retry', {'n': n}) : 'Offline';
      tone = Tk.orange;
    } else if (r.syncFailing && n > 0) {
      text = trv('Not synced ({n}) · tap to retry', {'n': n});
      tone = Tk.red;
    } else if (n > 0 || r.syncing) {
      text = n > 0 ? trv('Waiting for internet ({n})', {'n': n}) : 'Syncing…';
      tone = Tk.orange;
    } else {
      text = 'Synced';
      tone = Tk.green;
    }
    return InkWell(
      onTap: () => r.retryNow(),
      borderRadius: BorderRadius.circular(12),
      child: Padding(padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 10), child: Row(mainAxisSize: MainAxisSize.min, children: [
        Container(width: 10, height: 10, decoration: BoxDecoration(color: tone, shape: BoxShape.circle)),
        const SizedBox(width: 8),
        Flexible(child: Text(text, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 14, color: Tk.label2))),
      ])),
    );
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: Listenable.merge([s, s.repo!]),
      builder: (ctx, _) {
        final tabs = s.tabs;
        if (!tabs.contains(cur) && cur != 'more' && !s.allNav.contains(cur)) cur = 'home';
        final selected = tabs.contains(cur) ? tabs.indexOf(cur) : (s.showMore ? tabs.length : 0);
        return Scaffold(
          body: Column(children: [
            Container(
              decoration: BoxDecoration(color: Tk.bar, border: Border(bottom: BorderSide(color: Tk.line, width: .5))),
              padding: EdgeInsets.fromLTRB(12, MediaQuery.of(ctx).padding.top + 2, 8, 2),
              child: Row(children: [
                Expanded(child: Text(s.shopName.isEmpty ? 'AUZsMob' : s.shopName, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800))),
                Flexible(child: _syncPill()),
              ]),
            ),
            Expanded(child: _page()),
          ]),
          bottomNavigationBar: NavigationBar(
            selectedIndex: selected,
            onDestinationSelected: (i) {
              if (i < tabs.length) {
                go(tabs[i]);
              } else {
                _more();
              }
            },
            destinations: [
              for (final id in tabs) NavigationDestination(icon: Icon(_icons[id]), label: tr(_labels[id]!)),
              if (s.showMore) NavigationDestination(icon: const Icon(Icons.more_horiz), label: tr('More')),
            ],
          ),
        );
      },
    );
  }

  void _more() {
    openSheet(context, 'More', (ctx, set) {
      return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        if (s.moreList.isNotEmpty)
          Group([for (final id in s.moreList) Li(_labels[id]!, icon: _icons[id], tone: Tk.label3, onTap: () {
                Navigator.pop(ctx);
                go(id);
              })]),
        gap(),
        const Align(alignment: Alignment.centerLeft, child: SectionLabel('Language')),
        Seg<String>(expand: true, items: const [('en', 'English'), ('hi', 'हिंदी')], value: Lang.code, onChanged: (v) {
          s.saveLang(v);
          set(() {});
        }),
        const Align(alignment: Alignment.centerLeft, child: SectionLabel('Appearance')),
        Seg<String>(expand: true, items: const [('system', 'Auto'), ('light', 'Light'), ('dark', 'Dark')], value: Tk.mode, onChanged: (v) {
          Tk.setMode(v);
          set(() {});
        }),
        gap(),
        Group([
          Li('${s.user?['email'] ?? ''}', sub: s.role, icon: Icons.person_outline, tone: Tk.label3, chevron: false),
          Li('Receipt printer', sub: 'Bluetooth thermal printer, 58 or 80 mm', icon: Icons.print_outlined, tone: Tk.label3, onTap: () {
            Navigator.pop(ctx);
            openPrinterSheet(context);
          }),
          Li('Help & report a problem', icon: Icons.help_outline, tone: Tk.label3, onTap: () => launchUrl(Uri.parse('https://wa.me/919251250829'), mode: LaunchMode.externalApplication)),
          Li('Beginner guide', icon: Icons.menu_book_outlined, tone: Tk.label3, onTap: () => launchUrl(Uri.https('auzslab.in', '/learn.html'), mode: LaunchMode.externalApplication)),
          if (s.isOwner) Li('Backup, export or clear data', icon: Icons.download_outlined, tone: Tk.label3, onTap: () {
            Navigator.pop(ctx);
            openMyData(context, s);
          }),
          Li('Sign out', icon: Icons.logout, tone: Tk.label3, onTap: () {
            Navigator.pop(ctx);
            s.signOut();
          }),
        ]),
        gap(8),
      ]);
    });
  }
}
