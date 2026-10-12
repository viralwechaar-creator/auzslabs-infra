import 'package:flutter/material.dart' hide Text;
import '../core/session.dart';
import 'i18n.dart';
import 'mk.dart';
import 'p_leave.dart';
import 'p_more.dart';
import 'p_pay.dart';
import 'p_time.dart';
import 'p_today.dart';
import 'theme.dart';

class PayShell extends StatefulWidget {
  const PayShell(this.s, {super.key});
  final PaySession s;
  @override
  State<PayShell> createState() => _PayShellState();
}

class _PayShellState extends State<PayShell> with WidgetsBindingObserver {
  PaySession get s => widget.s;
  int tab = 0;

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
    if (st == AppLifecycleState.resumed) {
      s.flushPunches();
      s.loadMe();
    }
  }

  void _refused() {
    final m = s.refused.value;
    if (m == null || !mounted) return;
    s.refused.value = null;
    toast(context, '${tr('A clock-in saved offline was not accepted')}: $m', err: true);
  }

  Widget _pill() {
    final n = s.punchq.length;
    late String text;
    late Color tone;
    if (n > 0) {
      text = '$n ${tr('waiting to send')}';
      tone = Tk.orange;
    } else if (s.meOffline) {
      text = tr('Offline');
      tone = Tk.orange;
    } else {
      text = tr('Synced');
      tone = Tk.green;
    }
    return InkWell(
      onTap: () {
        s.flushPunches();
        s.loadMe();
      },
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
        final pages = <Widget>[TodayPage(s, go: (i) => setState(() => tab = i)), TimePage(s), LeavePage(s), PayPage(s), MorePage(s)];
        return Scaffold(
          body: Column(children: [
            Container(
              decoration: BoxDecoration(color: Tk.bar, border: Border(bottom: BorderSide(color: Tk.line, width: .5))),
              padding: EdgeInsets.fromLTRB(12, MediaQuery.of(ctx).padding.top + 2, 8, 2),
              child: Row(children: [
                Expanded(child: Text(s.orgName.isEmpty ? 'AUZsPay' : s.orgName, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800))),
                Flexible(child: _pill()),
              ]),
            ),
            Expanded(child: IndexedStack(index: tab, children: pages)),
          ]),
          bottomNavigationBar: NavigationBar(
            selectedIndex: tab,
            onDestinationSelected: (i) => setState(() => tab = i),
            destinations: [
              NavigationDestination(icon: const Icon(Icons.home_outlined), label: tr('Today')),
              NavigationDestination(icon: const Icon(Icons.schedule), label: tr('Time')),
              NavigationDestination(icon: const Icon(Icons.beach_access_outlined), label: tr('Leave')),
              NavigationDestination(icon: const Icon(Icons.account_balance_wallet_outlined), label: tr('Pay')),
              NavigationDestination(icon: const Icon(Icons.more_horiz), label: tr('More')),
            ],
          ),
        );
      },
    );
  }
}
