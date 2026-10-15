import 'package:flutter/material.dart' hide Text;
import 'package:url_launcher/url_launcher.dart';
import '../core/launcher.dart';
import '../core/session.dart';
import '../core/version.dart';
import '../core/webflag.dart';
import 'account.dart';
import 'admin.dart';
import 'cart.dart';
import 'ds.dart';
import 'i18n.dart';
import 'mk.dart';
import 'requests.dart';
import 'site.dart';
import 'team.dart';
import 'theme.dart';

/// The hub: one place that finds out who you are and shows what you can open (same tiles as the website hub).
class HubHome extends StatefulWidget {
  const HubHome(this.s, {super.key});
  final HubSession s;
  @override
  State<HubHome> createState() => _HubHomeState();
}

class _HubHomeState extends State<HubHome> {
  HubSession get s => widget.s;
  int ready = 0;

  @override
  void initState() {
    super.initState();
    _count();
  }

  /// How many of my requests are waiting for my payment (shown on the My requests tile).
  Future<void> _count() async {
    try {
      final r = await s.api.rpc('my_client_orders');
      if (r is List && mounted) setState(() => ready = r.where((o) => o is Map && o['status'] == 'link_sent').length);
    } catch (_) {}
  }

  Future<void> _open(ProductApp a) async {
    final ok = await openProductApp(s, a);
    if (!ok && mounted) toast(context, '${a.name} is not installed on this phone. Opening its download page.');
  }

  Widget _app(ProductApp a, IconData i, Color c) => Li(a.name, sub: a.note, icon: i, tone: c, onTap: () => _open(a));
  Widget _web(String t, String sub, String url, IconData i, Color c) => Li(t, sub: sub, icon: i, tone: c, onTap: () => launchUrl(Uri.parse('$url#auz_gt=${s.handoff()}'), mode: LaunchMode.externalApplication));

  Widget _team() => Li('Team workspace', sub: 'Leads, client setups and your team work', icon: Icons.groups_outlined, tone: Tk.accent, onTap: () => Navigator.push(context, MaterialPageRoute<void>(builder: (_) => TeamWorkspace(s))));

  List<Widget> _account() => [
        Li('My requests', sub: ready == 0 ? 'Status of what you asked for, payment and bills' : (ready == 1 ? '1 request is ready for payment' : '$ready requests are ready for payment'), icon: Icons.assignment_outlined, tone: Tk.blue, onTap: () async {
          await Navigator.push(context, MaterialPageRoute<void>(builder: (_) => RequestsPage(s)));
          _count();
        }),
        Li('My account and purchases', sub: 'Profile, orders, bills and add-ons', icon: Icons.person_outline, tone: Tk.purple, onTap: () => Navigator.push(context, MaterialPageRoute<void>(builder: (_) => AccountPage(s)))),
        Li('My cart', sub: 'Products you asked for', icon: Icons.shopping_bag_outlined, tone: Tk.teal, onTap: () => Navigator.push(context, MaterialPageRoute<void>(builder: (_) => CartPage(s)))),
      ];

  List<Widget> _explore() => [
        Li('Explore AUZslab', sub: 'Products, pricing, demos and guides', icon: Icons.explore_outlined, tone: Tk.orange, onTap: () => Navigator.push(context, MaterialPageRoute<void>(builder: (_) => SitePage(s, 'index')))),
        Li('Products and pricing', sub: 'See what each product does and costs', icon: Icons.sell_outlined, tone: Tk.green, onTap: () => Navigator.push(context, MaterialPageRoute<void>(builder: (_) => SitePage(s, 'pricing')))),
      ];

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: s,
      builder: (_, _) {
        final k = s.kind;
        final rows = <Widget>[];
        late String title, sub;
        final icons = {'pos': Icons.point_of_sale, 'mob': Icons.smartphone, 'pay': Icons.groups_outlined, 'ledger': Icons.receipt_long_outlined, 'scan': Icons.qr_code_scanner};
        final tones = {'pos': Tk.accent, 'mob': Tk.blue, 'pay': Tk.green, 'ledger': Tk.purple, 'scan': Tk.teal};
        switch (k) {
          case Kind.admin:
            title = 'AUZslab admin';
            sub = 'Clients, requests, pricing and the team.';
            rows.addAll([Li('Admin panel', sub: 'Requests, clients, leads, money, team and pricing', icon: Icons.admin_panel_settings_outlined, tone: Tk.accent, onTap: () => Navigator.push(context, MaterialPageRoute<void>(builder: (_) => AdminWorkspace(s)))), ..._explore()]);
          case Kind.team:
            title = 'Team workspace';
            sub = 'Leads, client setups and your team work.';
            rows.addAll([_team(), ..._explore()]);
          case Kind.customer:
            title = 'Welcome';
            sub = 'Look at the products, set up your account and ask for what your business needs.';
            rows.addAll([..._account(), ..._explore()]);
          case Kind.business:
            title = s.businessName.isEmpty ? 'AUZslab' : s.businessName;
            sub = 'Choose an app.';
            for (final a in productApps) {
              if (a.allowedFor(s)) rows.add(_app(a, icons[a.id]!, tones[a.id]!));
            }
            if (s.niche == 'salon') rows.insert(0, _web('AUZslab Salon', 'Bookings, billing and clients', 'https://${s.slug}.auzslab.in/salon/admin/', Icons.content_cut, Tk.accent));
            if (s.own('pos') && (s.isOwner || s.isManager)) rows.add(_web('Admin console', 'Reports, menu, stock and settings', 'https://app.auzslab.in/dashboard.html', Icons.dashboard_outlined, Tk.label2));
            if (s.own('website_builder') && s.isOwner) rows.add(_web('Website Builder', 'Edit your shop website', 'https://app.auzslab.in/builder.html', Icons.web_outlined, Tk.orange));
            if (s.isTeam) rows.add(_team());
            if (rows.isEmpty) rows.add(const Note('No apps are switched on for this login yet. Ask AUZslab or your owner.'));
            rows.addAll([..._account(), ..._explore()]);
        }
        return Scaffold(
          body: SafeArea(
            child: RefreshIndicator(
              onRefresh: () async {
                await s.load();
                await _count();
              },
              child: ListView(padding: const EdgeInsets.only(bottom: 32), children: [
                Padding(padding: const EdgeInsets.fromLTRB(16, 12, 16, 0), child: Row(children: [ClipRRect(borderRadius: BorderRadius.circular(10), child: Image.asset('assets/icon.png', height: 36)), const SizedBox(width: 10), const Text('AUZslab', style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800))])),
                PageHead(title, sub: sub),
                const SizedBox(height: 8),
                Group(rows),
                const SizedBox(height: 22),
                Center(child: Text(s.email, style: TextStyle(fontSize: 15, color: Tk.label2))),
                Row(mainAxisAlignment: MainAxisAlignment.center, children: [
                  TextButton(onPressed: () => showSettings(context), child: const Text('Settings')),
                  TextButton(onPressed: () => s.signOut(), child: const Text('Sign out')),
                ]),
                if (s.loading) const Padding(padding: EdgeInsets.all(8), child: Center(child: SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2)))),
              ]),
            ),
          ),
        );
      },
    );
  }
}

/// Language and appearance, saved on this phone.
void showSettings(BuildContext c) {
  // Hidden until a long-press on the build line below reveals it, for this phone only -- never
  // shown to an ordinary person opening Settings. See core/webflag.dart.
  var devRevealed = WebPilot.homeEnabled.value;
  openSheet(c, 'Settings', (ctx, set) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        const SectionLabel('Language'),
        Seg<String>(expand: true, items: const [('en', 'English'), ('hi', 'हिंदी')], value: Lang.code, onChanged: (v) {
          Lang.set(v);
          set(() {});
        }),
        const SectionLabel('Appearance'),
        Seg<String>(expand: true, items: const [('system', 'Auto'), ('light', 'Light'), ('dark', 'Dark')], value: Tk.mode, onChanged: (v) {
          Tk.setMode(v);
          set(() {});
        }),
        const SizedBox(height: 20),
        GestureDetector(
          onLongPress: () => set(() => devRevealed = true),
          child: Center(child: Text('AUZslab · build $kBuild', style: TextStyle(fontSize: 12, color: Tk.label3))),
        ),
        if (devRevealed) ...[
          const SizedBox(height: 14),
          const SectionLabel('Developer options (this phone only)'),
          const Note('Pilot test switch, not for normal use: loads the real auzslab.in Home page here instead of the app’s own Home screen. Turning it off restores the app’s Home page immediately.'),
          const SizedBox(height: 8),
          Row(children: [
            const Expanded(child: Text('Use the live website for Home (test)')),
            Switch(
              value: WebPilot.homeEnabled.value,
              onChanged: (v) {
                WebPilot.set(v);
                set(() {});
              },
            ),
          ]),
        ],
      ]));
}
