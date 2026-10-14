import 'package:flutter/material.dart' hide Text;
import '../core/session.dart';
import 'home.dart';
import 'site.dart';

/// The hub's main screen: the website (Home, Products, Pricing, Menu) and, in the last tab, what this login can open.
class HubShell extends StatefulWidget {
  const HubShell(this.s, {super.key});
  final HubSession s;
  @override
  State<HubShell> createState() => _HubShellState();
}

class _HubShellState extends State<HubShell> {
  int tab = -1;

  @override
  Widget build(BuildContext context) {
    final s = widget.s;
    // People who work in the apps land on "My apps"; customers land on the website home.
    final t = tab >= 0 ? tab : (s.kind == Kind.customer ? 0 : 4);
    return Scaffold(
      body: IndexedStack(index: t, children: [
        SitePage(s, 'index', top: true),
        SitePage(s, 'products', top: true),
        SitePage(s, 'pricing', top: true),
        SiteMenu(s),
        HubHome(s),
      ]),
      bottomNavigationBar: NavigationBar(
        selectedIndex: t,
        onDestinationSelected: (i) => setState(() => tab = i),
        destinations: [
          const NavigationDestination(icon: Icon(Icons.home_outlined), selectedIcon: Icon(Icons.home), label: 'Home'),
          const NavigationDestination(icon: Icon(Icons.apps_outlined), selectedIcon: Icon(Icons.apps), label: 'Products'),
          const NavigationDestination(icon: Icon(Icons.sell_outlined), selectedIcon: Icon(Icons.sell), label: 'Pricing'),
          const NavigationDestination(icon: Icon(Icons.menu), label: 'Menu'),
          NavigationDestination(icon: const Icon(Icons.dashboard_outlined), selectedIcon: const Icon(Icons.dashboard), label: s.kind == Kind.customer ? 'Account' : 'My apps'),
        ],
      ),
    );
  }
}
