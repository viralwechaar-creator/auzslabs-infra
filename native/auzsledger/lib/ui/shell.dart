import 'package:flutter/material.dart' hide Text;
import 'package:url_launcher/url_launcher.dart';
import '../core/session.dart';
import 'cart.dart';
import 'ds.dart';
import 'i18n.dart';
import 'mk.dart';
import 'p_home.dart';
import 'p_books.dart';
import 'p_parties.dart';
import 'p_reports.dart';
import 'p_products.dart';
import 'p_sales.dart';
import 'p_scan.dart';
import 'theme.dart';

class LedgerShell extends StatefulWidget {
  const LedgerShell(this.s, {super.key});
  final LedgerSession s;
  @override
  State<LedgerShell> createState() => _LedgerShellState();
}

class _LedgerShellState extends State<LedgerShell> with WidgetsBindingObserver {
  LedgerSession get s => widget.s;
  int tab = 0;
  final cart = ScanCart();

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
    if (st == AppLifecycleState.resumed) s.flush();
  }

  void _refused() {
    final m = s.refused.value;
    if (m == null || !mounted) return;
    s.refused.value = null;
    toast(context, '${tr('Not saved')}: $m', err: true);
  }

  Widget _pill() {
    final n = s.queue.length;
    late String text;
    late Color tone;
    if (s.offline) {
      text = n > 0 ? '${tr('Offline')} · $n ${tr('waiting')}' : tr('Offline');
      tone = Tk.orange;
    } else if (n > 0 || s.syncing) {
      text = n > 0 ? '$n ${tr('waiting to send')}' : tr('Syncing…');
      tone = Tk.orange;
    } else {
      text = tr('Synced');
      tone = Tk.green;
    }
    return InkWell(
      onTap: () => s.flush(),
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
      listenable: s,
      builder: (ctx, _) {
        final pages = <Widget>[HomePage(s, go: (i) => setState(() => tab = i)), ScanPage(s, cart), SalesPage(s), ProductsPage(s)];
        return Scaffold(
          body: Column(children: [
            Container(
              decoration: BoxDecoration(color: Tk.bar, border: Border(bottom: BorderSide(color: Tk.line, width: .5))),
              padding: EdgeInsets.fromLTRB(12, MediaQuery.of(ctx).padding.top + 2, 8, 2),
              child: Row(children: [
                Expanded(child: Text(s.orgName.isEmpty ? 'AUZsLedger' : s.orgName, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800))),
                Flexible(child: _pill()),
              ]),
            ),
            Expanded(child: tab < 4 ? pages[tab] : const SizedBox.shrink()),
          ]),
          bottomNavigationBar: NavigationBar(
            selectedIndex: tab,
            onDestinationSelected: (i) {
              if (i == 4) {
                _more();
              } else {
                setState(() => tab = i);
              }
            },
            destinations: [
              NavigationDestination(icon: const Icon(Icons.home_outlined), label: tr('Home')),
              NavigationDestination(icon: const Icon(Icons.qr_code_scanner), label: tr('Sell')),
              NavigationDestination(icon: const Icon(Icons.receipt_long_outlined), label: tr('Documents')),
              NavigationDestination(icon: const Icon(Icons.inventory_2_outlined), label: tr('Products')),
              NavigationDestination(icon: const Icon(Icons.more_horiz), label: tr('More')),
            ],
          ),
        );
      },
    );
  }

  void _go(BuildContext ctx, Widget page) {
    Navigator.pop(ctx);
    Navigator.push(context, MaterialPageRoute(builder: (_) => page));
  }

  void _more() {
    openSheet(context, 'More', (ctx, set) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          const Align(alignment: Alignment.centerLeft, child: SectionLabel('Language')),
          Seg<String>(expand: true, items: const [('en', 'English'), ('hi', 'हिंदी')], value: Lang.code, onChanged: (v) {
            Lang.set(v);
            set(() {});
          }),
          const Align(alignment: Alignment.centerLeft, child: SectionLabel('Appearance')),
          Seg<String>(expand: true, items: const [('system', 'Auto'), ('light', 'Light'), ('dark', 'Dark')], value: Tk.mode, onChanged: (v) {
            Tk.setMode(v);
            set(() {});
          }),
          gap(),
          Group([
            Li('Customers and suppliers', icon: Icons.groups_outlined, tone: Tk.blue, onTap: () {
              Navigator.pop(ctx);
              Navigator.push(context, MaterialPageRoute(builder: (_) => PartiesPage(s)));
            }),
            if (s.can('acc_reports') || s.can('acc_admin')) Li('Reports', icon: Icons.bar_chart_outlined, tone: Tk.accent, onTap: () {
              Navigator.pop(ctx);
              Navigator.push(context, MaterialPageRoute(builder: (_) => ReportsPage(s)));
            }),
            if (s.can('acc_sales') || s.can('acc_purchase') || s.can('acc_admin')) Li('Receipts and payments', icon: Icons.account_balance_wallet_outlined, tone: Tk.green, onTap: () => _go(ctx, MoneyPage(s))),
            if (s.can('acc_sales') || s.can('acc_admin')) Li('Credit note', sub: 'Goods or money came back', icon: Icons.undo, tone: Tk.orange, onTap: () => _go(ctx, CreditNotePage(s))),
            if (s.can('acc_banking') || s.can('acc_admin')) Li('Banking', sub: 'Statement and matching', icon: Icons.account_balance_outlined, tone: Tk.blue, onTap: () => _go(ctx, BankingPage(s))),
            if (s.can('acc_banking') || s.can('acc_journal') || s.can('acc_admin')) Li('Journals and transfers', icon: Icons.menu_book_outlined, tone: Tk.accent, onTap: () => _go(ctx, JournalPage(s))),
            if (s.can('acc_reports') || s.can('acc_admin')) Li('GST returns', sub: 'Registers and filing', icon: Icons.percent, tone: Tk.orange, onTap: () => _go(ctx, GstReturnsPage(s))),
            if (s.can('acc_import') || s.can('acc_admin')) Li('Import', sub: 'Customers, products, stock', icon: Icons.upload_file, tone: Tk.blue, onTap: () => _go(ctx, ImportPage(s))),
            Li('Business settings', icon: Icons.settings_outlined, tone: Tk.label3, onTap: () => _go(ctx, OrgSettingsPage(s))),
            Li('${s.user?['email'] ?? ''}', sub: s.role, icon: Icons.person_outline, tone: Tk.label3, chevron: false),
            Li('Help & report a problem', icon: Icons.help_outline, tone: Tk.label3, onTap: () => launchUrl(Uri.parse('https://wa.me/919251250829'), mode: LaunchMode.externalApplication)),
            Li('Open AUZsLedger on the web (reports, banking, GST)', icon: Icons.open_in_new, tone: Tk.label3, onTap: () => launchUrl(Uri.https('app.auzslab.in', '/accounts.html'), mode: LaunchMode.externalApplication)),
            Li('Sign out', icon: Icons.logout, tone: Tk.label3, onTap: () {
              Navigator.pop(ctx);
              s.signOut();
            }),
          ]),
          Pad(Text('AUZsLedger native app · build 1', style: TextStyle(color: Tk.label3, fontSize: 13))),
        ]));
  }
}
