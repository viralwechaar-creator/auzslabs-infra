import 'package:flutter/material.dart' hide Text;
import 'package:flutter/services.dart';
import 'package:url_launcher/url_launcher.dart';
import '../core/api.dart';
import '../core/session.dart';
import '../core/util.dart';
import 'admin_money.dart';
import 'ds.dart';
import 'i18n.dart';
import 'mk.dart';
import 'team.dart';
import 'theme.dart';

/// The AUZslab admin panel, native: the same sections as the website's admin panel (site/admin.html), same database calls.
class AdminWorkspace extends StatefulWidget {
  const AdminWorkspace(this.s, {super.key});
  final HubSession s;
  @override
  State<AdminWorkspace> createState() => _AdminWorkspaceState();
}

class _AdminWorkspaceState extends State<AdminWorkspace> {
  int tab = 0;
  Map<String, dynamic> counts = {};

  @override
  void initState() {
    super.initState();
    widget.s.api.rpc('admin_open_counts').then((r) {
      if (mounted && r is Map) setState(() => counts = Map<String, dynamic>.from(r));
    }).catchError((_) {});
  }

  @override
  Widget build(BuildContext context) {
    final s = widget.s;
    final pages = <Widget>[RequestsAdmin(s), ClientsAdmin(s), LeadsAdmin(s), MoneyAdmin(s), AdminMore(s, counts)];
    const items = [('Requests', Icons.inbox_outlined), ('Clients', Icons.storefront_outlined), ('Leads', Icons.contacts_outlined), ('Money', Icons.payments_outlined), ('More', Icons.more_horiz)];
    return Scaffold(
      body: SafeArea(child: IndexedStack(index: tab, children: pages)),
      bottomNavigationBar: NavigationBar(
        selectedIndex: tab,
        onDestinationSelected: (i) => setState(() => tab = i),
        destinations: [for (final e in items) NavigationDestination(icon: Icon(e.$2), label: tr(e.$1))],
      ),
    );
  }
}

Widget _wait() => const Padding(padding: EdgeInsets.all(40), child: Center(child: CircularProgressIndicator()));

// ---------------------------------------------------------------- Clients

class ClientsAdmin extends StatefulWidget {
  const ClientsAdmin(this.s, {super.key});
  final HubSession s;
  @override
  State<ClientsAdmin> createState() => _ClientsAdminState();
}

class _ClientsAdminState extends State<ClientsAdmin> {
  List<Map<String, dynamic>>? rows;
  String? err;
  final q = TextEditingController();

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final r = await widget.s.api.rpc('list_clients', {});
      if (mounted) setState(() {
            rows = maps(r);
            err = null;
          });
    } on ApiError catch (e) {
      if (mounted) setState(() => err = e.message);
    }
  }

  int? _days(Map c) {
    final d = DateTime.tryParse('${c['renewal_date'] ?? ''}');
    return d == null ? null : d.difference(DateTime.now()).inDays;
  }

  @override
  Widget build(BuildContext context) {
    final l = (rows ?? const []).where((c) {
      final t = q.text.toLowerCase();
      return t.isEmpty || '${c['name']} ${c['slug']}'.toLowerCase().contains(t);
    }).toList();
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(padding: const EdgeInsets.only(bottom: 24), children: [
        PageHead('Clients', sub: rows == null ? null : '${rows!.length} businesses'),
        Pad(TextField(controller: q, decoration: InputDecoration(prefixIcon: const Icon(Icons.search), hintText: tr('Search clients')), onChanged: (_) => setState(() {}))),
        if (err != null) Note(err!, bad: true),
        if (rows == null && err == null) _wait(),
        if (rows != null)
          Group([
            for (final c in l)
              Li('${c['name']}',
                  sub: '${c['slug']}.auzslab.in · ${c['build_type'] == 'custom' ? 'Custom-built' : c['niche']}',
                  trailing: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.end, children: [
                    Pill('${c['status']}', tone: c['status'] == 'active' ? Tk.green : Tk.orange),
                    if (_days(c) != null) Text(_days(c)! < 0 ? 'overdue ${-_days(c)!} d' : '${_days(c)} d left', style: TextStyle(fontSize: 12, color: _days(c)! < 7 ? Tk.red : Tk.label2)),
                  ]),
                  onTap: () => _open(c)),
          ]),
      ]),
    );
  }

  void _open(Map<String, dynamic> c) {
    final fee = TextEditingController(text: c['monthly_fee'] == null ? '' : '${c['monthly_fee']}');
    final renewal = TextEditingController(text: '${c['renewal_date'] ?? ''}');
    final notes = TextEditingController(text: '${c['notes'] ?? ''}');
    var status = '${c['status']}';
    final svc = (c['features'] is Map ? c['features'] as Map : const {}).entries.where((e) => e.value == true).map((e) => '${e.key}').toList();
    openSheet(context, '${c['name']}', (ctx, set) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text('${c['slug']}.auzslab.in', style: TextStyle(color: Tk.label2)),
          if (svc.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 6), child: Text(svc.join(', '), style: TextStyle(fontSize: 13, color: Tk.label2))),
          const SectionLabel('Plan'),
          Sel('Status', status, const [('active', 'Active'), ('suspended', 'Suspended'), ('cancelled', 'Cancelled')], (v) => set(() => status = v)),
          gap(),
          Fld('Monthly fee', fee, number: true),
          gap(),
          Fld('Renewal date (YYYY-MM-DD)', renewal),
          gap(),
          Fld('Notes', notes, multiline: true),
          gap(14),
          OutlinedButton(onPressed: () async {
            if (!await confirm(ctx, 'Reset the owner password?', 'Their current password stops working immediately. A temporary one is shown once.', yes: 'Reset', danger: true)) return;
            try {
              final r = await widget.s.api.rpc('admin_reset_client_password', {'p_tenant_id': c['id']});
              final m = Map<String, dynamic>.from(r as Map);
              if (ctx.mounted) {
                await Clipboard.setData(ClipboardData(text: '${m['temp_password']}'));
                await openSheet(ctx, 'New password', (c2, set2) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                      Text('${m['email']}', style: TextStyle(color: Tk.label2)),
                      gap(),
                      SelectableText('${m['temp_password']}', style: const TextStyle(fontSize: 30, fontWeight: FontWeight.w800, letterSpacing: 2)),
                      gap(),
                      const Hint('Copied. Share it with them directly (for example on WhatsApp). It will not be shown again.'),
                    ]));
              }
            } on ApiError catch (e) {
              if (ctx.mounted) toast(ctx, e.message, err: true);
            }
          }, child: const Text('Reset owner password')),
          gap(8),
          OutlinedButton(onPressed: () => launchUrl(Uri.parse('https://${c['slug']}.auzslab.in'), mode: LaunchMode.externalApplication), child: const Text('Open their address')),
        ]), actions: [
      SheetAction('Save', (_) async {
        try {
          await widget.s.api.rpc('update_client', {'p_tenant_id': c['id'], 'p_monthly_fee': fee.text.trim().isEmpty ? null : num.tryParse(fee.text), 'p_renewal_date': renewal.text.trim().isEmpty ? null : renewal.text.trim(), 'p_notes': notes.text, 'p_status': status});
          return true;
        } on ApiError catch (e) {
          if (mounted) toast(context, e.message, err: true);
          return false;
        }
      }, primary: true),
    ]).then((_) => _load());
  }
}

// ---------------------------------------------------------------- Leads

class LeadsAdmin extends StatefulWidget {
  const LeadsAdmin(this.s, {super.key});
  final HubSession s;
  @override
  State<LeadsAdmin> createState() => _LeadsAdminState();
}

class _LeadsAdminState extends State<LeadsAdmin> {
  List<Map<String, dynamic>>? rows;
  String? err;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final r = await widget.s.api.rpc('team_all_leads');
      if (mounted) setState(() {
            rows = maps(r);
            err = null;
          });
    } on ApiError catch (e) {
      if (mounted) setState(() => err = e.message);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = rows;
    final open = (l ?? const []).where((x) => !leadClosed(x)).toList();
    final closed = (l ?? const []).where(leadClosed).toList();
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(padding: const EdgeInsets.only(bottom: 24), children: [
        PageHead('Leads', sub: l == null ? null : '${open.length} open'),
        if (err != null) Note(err!, bad: true),
        if (l == null && err == null) _wait(),
        if (l != null && l.isEmpty) emptyBox(Icons.contacts_outlined, 'No leads yet.'),
        if (open.isNotEmpty) ...[SectionLabel('Open · ${open.length}'), Group([for (final x in open) _row(x)])],
        if (closed.isNotEmpty) ...[SectionLabel('Closed · ${closed.length}'), Group([for (final x in closed) _row(x)])],
      ]),
    );
  }

  Widget _row(Map<String, dynamic> l) => Li('${l['business'] ?? ''}'.isNotEmpty ? '${l['business']}' : '${l['name']}',
      sub: [if ('${l['business'] ?? ''}'.isNotEmpty) '${l['name']}', '${l['contact'] ?? ''}', if ('${l['assignee'] ?? ''}'.isNotEmpty) '→ ${l['assignee']}' else 'unassigned'].where((x) => x.isNotEmpty).join(' · '),
      trailing: Pill(stageName('${l['status']}'), tone: l['status'] == 'converted' ? Tk.green : (l['status'] == 'declined' ? Tk.label3 : Tk.blue)),
      onTap: () => _open(l));

  Future<void> _open(Map<String, dynamic> l) async {
    var stage = '${l['status']}';
    String? assign = l['assigned_to'] == null ? null : '${l['assigned_to']}';
    List<Map<String, dynamic>> people = [];
    try {
      people = maps(await widget.s.api.rpc('team_overview', {'p_days': 30})).where((m) => m['active'] == true && ['salesman', 'support', 'manager'].contains(m['role'])).toList();
    } catch (_) {}
    if (!mounted) return;
    await openSheet(context, '${l['business'] ?? ''}'.isNotEmpty ? '${l['business']}' : '${l['name']}', (ctx, set) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text('${l['name']} · ${l['contact'] ?? ''}', style: TextStyle(color: Tk.label2)),
          if ('${l['message'] ?? ''}'.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 8), child: Note('${l['message']}')),
          Row(children: [
            if ('${l['contact'] ?? ''}'.isNotEmpty) TextButton(onPressed: () => openWa('${l['contact']}', 'Hello ${l['name']},'), child: const Text('WhatsApp')),
          ]),
          const SectionLabel('Stage'),
          Wrap(spacing: 6, runSpacing: 6, children: [for (final s in leadStages) ChoiceChip(label: Text(s.$2), selected: stage == s.$1, onSelected: (_) => set(() => stage = s.$1))]),
          const SectionLabel('Assigned to'),
          Sel('Assigned to', assign ?? '', [('', 'Nobody'), for (final m in people) ('${m['id']}', '${m['name']} (${teamRoles[m['role']] ?? m['role']})')], (v) => set(() => assign = v.isEmpty ? null : v)),
        ]), actions: [
      SheetAction('Save', (_) async {
        try {
          await widget.s.api.rpc('team_update_lead', {'p_id': l['id'], 'p': {'status': stage}});
          if (assign != (l['assigned_to'] == null ? null : '${l['assigned_to']}')) await widget.s.api.rpc('team_assign_lead', {'p_lead': l['id'], 'p_user': assign});
          return true;
        } on ApiError catch (e) {
          if (mounted) toast(context, e.message, err: true);
          return false;
        }
      }, primary: true),
      SheetAction('Delete lead', (_) async {
        if (!await confirm(context, 'Delete this lead?', 'It is removed for good.', yes: 'Delete', danger: true)) return false;
        try {
          await widget.s.api.rpc('admin_delete_lead', {'p_kind': 'lead', 'p_id': l['id']});
          return true;
        } on ApiError catch (e) {
          if (mounted) toast(context, e.message, err: true);
          return false;
        }
      }, primary: false, danger: true),
    ]);
    _load();
  }
}

// ---------------------------------------------------------------- More

class AdminMore extends StatelessWidget {
  const AdminMore(this.s, this.counts, {super.key});
  final HubSession s;
  final Map<String, dynamic> counts;

  void _go(BuildContext c, Widget w) => Navigator.push(c, MaterialPageRoute<void>(builder: (_) => w));

  @override
  Widget build(BuildContext context) {
    final team = n0(counts['team']), priv = n0(counts['privacy']);
    Widget badge(num n) => n > 0 ? Pill('$n', tone: Tk.red) : const Icon(Icons.chevron_right);
    return ListView(padding: const EdgeInsets.only(bottom: 24), children: [
      const PageHead('More', sub: 'Team, pricing, users and privacy'),
      Group([
        Li('Team', sub: 'Members, roles and notices', icon: Icons.groups_outlined, tone: Tk.accent, onTap: () => _go(context, TeamAdmin(s))),
        Li('Team applications', sub: 'Approve or reject people who want to join', icon: Icons.how_to_reg_outlined, tone: Tk.blue, trailing: badge(team), onTap: () => _go(context, ApplicationsAdmin(s))),
        Li('Pricing', sub: 'Monthly price of each product', icon: Icons.sell_outlined, tone: Tk.green, onTap: () => _go(context, PricingAdmin(s))),
        Li('Users', sub: 'All accounts', icon: Icons.person_search_outlined, tone: Tk.purple, onTap: () => _go(context, UsersAdmin(s))),
        Li('Privacy requests', sub: 'Data access, correction and deletion', icon: Icons.privacy_tip_outlined, tone: Tk.orange, trailing: badge(priv), onTap: () => _go(context, PrivacyAdmin(s))),
      ]),
      const SectionLabel('On the website'),
      Group([
        for (final e in const [('Full admin panel', 'Bundles, onboarding, audit log, WhatsApp, system', 'admin.html')])
          Li(e.$1, sub: e.$2, icon: Icons.open_in_browser, tone: Tk.label2, onTap: () => openAuz(s, e.$3)),
      ]),
      const SectionLabel('Account'),
      Group([Li('Back to the hub', icon: Icons.apps, tone: Tk.blue, onTap: () => Navigator.of(context).popUntil((r) => r.isFirst))]),
    ]);
  }
}

Future<void> openAuz(HubSession s, String page) => launchUrl(Uri.parse('https://auzslab.in/$page#auz_gt=${s.handoff()}'), mode: LaunchMode.externalApplication);

// ---------------------------------------------------------------- Team

class TeamAdmin extends StatefulWidget {
  const TeamAdmin(this.s, {super.key});
  final HubSession s;
  @override
  State<TeamAdmin> createState() => _TeamAdminState();
}

class _TeamAdminState extends State<TeamAdmin> {
  List<Map<String, dynamic>>? rows;
  String? err;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final r = await widget.s.api.rpc('team_overview', {'p_days': 30});
      if (mounted) setState(() => rows = maps(r));
    } on ApiError catch (e) {
      if (mounted) setState(() => err = e.message);
    }
  }

  void _add() {
    final email = TextEditingController(), name = TextEditingController(), phone = TextEditingController();
    var role = 'salesman';
    openSheet(context, 'Add a team member', (ctx, set) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          const Hint('They sign in with Google using this email at app.auzslab.in.'),
          Fld('Email', email),
          gap(),
          Fld('Name', name),
          gap(),
          Fld('Phone', phone, phone: true),
          gap(),
          Sel('Role', role, [for (final e in teamRoles.entries) (e.key, e.value)], (v) => set(() => role = v)),
        ]), actions: [
      SheetAction('Add', (_) async {
        try {
          await widget.s.api.rpc('admin_add_team_member', {'p_email': email.text.trim(), 'p_name': name.text.trim().isEmpty ? null : name.text.trim(), 'p_role': role, 'p_phone': phone.text.trim().isEmpty ? null : phone.text.trim()});
          return true;
        } on ApiError catch (e) {
          if (mounted) toast(context, e.message, err: true);
          return false;
        }
      }, primary: true),
    ]).then((_) => _load());
  }

  void _notice() {
    final title = TextEditingController(), body = TextEditingController();
    var aud = 'all';
    openSheet(context, 'Notice to the team', (ctx, set) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Fld('Title', title),
          gap(),
          Fld('Message', body, multiline: true),
          gap(),
          Sel('Send to', aud, [('all', 'Everyone'), for (final e in teamRoles.entries) (e.key, e.value)], (v) => set(() => aud = v)),
        ]), actions: [
      SheetAction('Send', (_) async {
        try {
          final r = await widget.s.api.rpc('admin_post_team_notice', {'p_title': title.text.trim(), 'p_body': body.text.trim(), 'p_audience': aud});
          if (mounted) toast(context, 'Sent to ${r is Map ? r['sent_to'] ?? 0 : 0} team member(s).');
          return true;
        } on ApiError catch (e) {
          if (mounted) toast(context, e.message, err: true);
          return false;
        }
      }, primary: true),
    ]);
  }

  @override
  Widget build(BuildContext context) {
    final l = rows;
    return SubPage('Team', [
      if (err != null) Note(err!, bad: true),
      Pad(Row(children: [Expanded(child: FilledButton(onPressed: _add, child: const Text('Add member'))), const SizedBox(width: 8), Expanded(child: OutlinedButton(onPressed: _notice, child: const Text('Send a notice')))])),
      if (l == null && err == null) _wait(),
      if (l != null)
        Group([
          for (final m in l)
            Li('${m['name']}${m['active'] == true ? '' : ' (off)'}', sub: '${teamRoles[m['role']] ?? m['role']} · ${m['email'] ?? ''}', value: agoText(m['last_active']), icon: Icons.person_outline, tone: m['active'] == true ? Tk.blue : Tk.label3, onTap: () => _member(m)),
        ]),
    ]);
  }

  void _member(Map<String, dynamic> m) {
    var role = '${m['role']}';
    final active = m['active'] == true;
    openSheet(context, '${m['name']}', (ctx, set) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text('${m['email'] ?? ''}${'${m['phone'] ?? ''}'.isNotEmpty ? ' · ${m['phone']}' : ''}', style: TextStyle(color: Tk.label2)),
          Text(m['role'] == 'setup' ? '${m['setups_open']} setups open · ${m['setups_done']} finished' : '${m['leads_open']} open leads · ${m['updates']} updates · ${m['leads_converted']} won', style: TextStyle(color: Tk.label2)),
          gap(),
          Sel('Role', role, [for (final e in teamRoles.entries) (e.key, e.value)], (v) => set(() => role = v)),
        ]), actions: [
      SheetAction('Save role', (_) async {
        try {
          if (role != '${m['role']}') await widget.s.api.rpc('admin_set_team_role', {'p_id': m['id'], 'p_role': role});
          return true;
        } on ApiError catch (e) {
          if (mounted) toast(context, e.message, err: true);
          return false;
        }
      }, primary: true),
      SheetAction(active ? 'Turn off' : 'Turn on', (_) async {
        try {
          await widget.s.api.rpc('admin_set_salesman_active', {'p_id': m['id'], 'p_active': !active});
          return true;
        } on ApiError catch (e) {
          if (mounted) toast(context, e.message, err: true);
          return false;
        }
      }, primary: false, danger: active),
    ]).then((_) => _load());
  }
}

class ApplicationsAdmin extends StatefulWidget {
  const ApplicationsAdmin(this.s, {super.key});
  final HubSession s;
  @override
  State<ApplicationsAdmin> createState() => _ApplicationsAdminState();
}

class _ApplicationsAdminState extends State<ApplicationsAdmin> {
  List<Map<String, dynamic>>? rows;
  String? err;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final r = await widget.s.api.rpc('admin_list_team_applications', {'p_status': 'new'});
      if (mounted) setState(() => rows = maps(r));
    } on ApiError catch (e) {
      if (mounted) setState(() => err = e.message);
    }
  }

  Future<void> _decide(Map a, String decision, String role) async {
    try {
      final r = await widget.s.api.rpc('admin_decide_team_application', {'p_id': a['id'], 'p_decision': decision, 'p_role': role});
      if (!mounted) return;
      if (decision == 'approve') toast(context, r is Map && r['active'] == true ? 'Approved. They are on the team now.' : 'Approved. They join when they first sign in with Google using that email.');
      _load();
    } on ApiError catch (e) {
      if (mounted) toast(context, e.message, err: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = rows;
    return SubPage('Team applications', [
      if (err != null) Note(err!, bad: true),
      if (l == null && err == null) _wait(),
      if (l != null && l.isEmpty) emptyBox(Icons.how_to_reg_outlined, 'No new applications.'),
      if (l != null)
        for (final a in l)
          _ApplicationCard(a, onDecide: (d, role) => _decide(a, d, role)),
    ]);
  }
}

class _ApplicationCard extends StatefulWidget {
  const _ApplicationCard(this.a, {required this.onDecide});
  final Map<String, dynamic> a;
  final void Function(String decision, String role) onDecide;
  @override
  State<_ApplicationCard> createState() => _ApplicationCardState();
}

class _ApplicationCardState extends State<_ApplicationCard> {
  late String role = widget.a['role_wanted'] == 'other' || !teamRoles.containsKey(widget.a['role_wanted']) ? 'support' : '${widget.a['role_wanted']}';

  @override
  Widget build(BuildContext context) {
    final a = widget.a;
    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(color: Tk.card, borderRadius: BorderRadius.circular(18), border: Border.all(color: Tk.line, width: .5)),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text('${a['name']}', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
        Text('${a['email']} · ${a['phone'] ?? ''}${'${a['city'] ?? ''}'.isNotEmpty ? ' · ${a['city']}' : ''}', style: TextStyle(color: Tk.label2, fontSize: 13)),
        if ('${a['experience'] ?? ''}'.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 6), child: Text('Experience: ${a['experience']}')),
        if ('${a['about'] ?? ''}'.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 4), child: Text('${a['about']}')),
        const SizedBox(height: 8),
        Sel('Role to give', role, [for (final e in teamRoles.entries) (e.key, e.value)], (v) => setState(() => role = v)),
        const SizedBox(height: 8),
        Row(children: [
          Expanded(child: FilledButton(onPressed: () => widget.onDecide('approve', role), child: const Text('Approve'))),
          const SizedBox(width: 8),
          Expanded(child: OutlinedButton(onPressed: () async {
            if (await confirm(context, 'Reject this application?', 'They get a polite email.', yes: 'Reject', danger: true)) widget.onDecide('reject', role);
          }, child: const Text('Reject'))),
        ]),
        if ('${a['phone'] ?? ''}'.isNotEmpty) TextButton(onPressed: () => openWa('${a['phone']}', 'Hello ${a['name']},'), child: const Text('WhatsApp')),
      ]),
    );
  }
}

// ---------------------------------------------------------------- Pricing

class PricingAdmin extends StatefulWidget {
  const PricingAdmin(this.s, {super.key});
  final HubSession s;
  @override
  State<PricingAdmin> createState() => _PricingAdminState();
}

class _PricingAdminState extends State<PricingAdmin> {
  List<Map<String, dynamic>>? rows;
  String? err;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final r = await widget.s.api.rpc('public_product_prices');
      if (mounted) setState(() => rows = maps(r));
    } on ApiError catch (e) {
      if (mounted) setState(() => err = e.message);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = rows;
    return SubPage('Pricing', [
      const Hint('Monthly price of each product. Bundles, yearly prices and add-on prices are on the website admin panel.'),
      if (err != null) Note(err!, bad: true),
      if (l == null && err == null) _wait(),
      if (l != null)
        Group([
          for (final p in l)
            Li('${p['label'] ?? p['key']}', sub: '${p['key']}${p['gst_exempt'] == true ? ' · no GST' : ''}', value: n0(p['monthly_price']) > 0 ? inr(n0(p['monthly_price'])) : 'Included / not priced', onTap: () => _edit(p)),
        ]),
    ]);
  }

  void _edit(Map<String, dynamic> p) {
    final price = TextEditingController(text: '${n0(p['monthly_price'])}');
    openSheet(context, '${p['label'] ?? p['key']}', (ctx, set) => Fld('Monthly price', price, number: true), actions: [
      SheetAction('Save', (_) async {
        try {
          await widget.s.api.rpc('admin_set_product_price', {'p_key': p['key'], 'p_monthly_price': num.tryParse(price.text) ?? 0});
          return true;
        } on ApiError catch (e) {
          if (mounted) toast(context, e.message, err: true);
          return false;
        }
      }, primary: true),
    ]).then((_) => _load());
  }
}

// ---------------------------------------------------------------- Users

class UsersAdmin extends StatefulWidget {
  const UsersAdmin(this.s, {super.key});
  final HubSession s;
  @override
  State<UsersAdmin> createState() => _UsersAdminState();
}

class _UsersAdminState extends State<UsersAdmin> {
  List<Map<String, dynamic>>? rows;
  String? err;
  final q = TextEditingController();

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final r = await widget.s.api.rpc('admin_list_users', {'p_query': q.text.trim().isEmpty ? null : q.text.trim(), 'p_limit': 50});
      if (mounted) setState(() {
            rows = maps(r);
            err = null;
          });
    } on ApiError catch (e) {
      if (mounted) setState(() => err = e.message);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = rows;
    return SubPage('Users', [
      Pad(TextField(controller: q, decoration: InputDecoration(prefixIcon: const Icon(Icons.search), hintText: tr('Search by name or email')), textInputAction: TextInputAction.search, onSubmitted: (_) => _load())),
      if (err != null) Note(err!, bad: true),
      if (l == null && err == null) _wait(),
      if (l != null && l.isEmpty) emptyBox(Icons.person_search_outlined, 'No users match that search.'),
      if (l != null)
        Group([
          for (final u in l)
            Li('${u['name'] ?? u['email']}', sub: '${u['email']}', trailing: u['disabled_at'] != null ? Pill('suspended', tone: Tk.orange) : (u['deleted_at'] != null ? Pill('deleted', tone: Tk.red) : null), onTap: () => _open(u)),
        ]),
    ]);
  }

  void _open(Map<String, dynamic> u) {
    final disabled = u['disabled_at'] != null;
    openSheet(context, '${u['name'] ?? u['email']}', (ctx, set) => Text('${u['email']}', style: TextStyle(color: Tk.label2)), actions: [
      SheetAction(disabled ? 'Reactivate' : 'Suspend', (_) async {
        if (!disabled && !await confirm(context, 'Suspend this account?', 'They are signed out everywhere and cannot sign in.', yes: 'Suspend', danger: true)) return false;
        try {
          await widget.s.api.rpc('admin_set_user_disabled', {'p_user_id': u['id'], 'p_disabled': !disabled});
          return true;
        } on ApiError catch (e) {
          if (mounted) toast(context, e.message, err: true);
          return false;
        }
      }, primary: !disabled, danger: !disabled),
    ]).then((_) => _load());
  }
}

// ---------------------------------------------------------------- Privacy

class PrivacyAdmin extends StatefulWidget {
  const PrivacyAdmin(this.s, {super.key});
  final HubSession s;
  @override
  State<PrivacyAdmin> createState() => _PrivacyAdminState();
}

class _PrivacyAdminState extends State<PrivacyAdmin> {
  List<Map<String, dynamic>>? rows;
  String? err;

  static const kinds = {'access': 'See my data', 'correction': 'Correct my data', 'erasure': 'Delete my data', 'withdraw': 'Withdraw consent', 'nominee': 'Nominee', 'grievance': 'Complaint', 'other': 'Other'};

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final r = await widget.s.api.rpc('admin_list_data_requests', {'p_status': 'active'});
      if (mounted) setState(() => rows = maps(r));
    } on ApiError catch (e) {
      if (mounted) setState(() => err = e.message);
    }
  }

  Future<void> _set(Map r, String status, String? text) async {
    try {
      await widget.s.api.rpc('admin_update_data_request', {'p_id': r['id'], 'p_status': status, 'p_response': text});
      _load();
    } on ApiError catch (e) {
      if (mounted) toast(context, e.message, err: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = rows;
    return SubPage('Privacy requests', [
      const Hint('Reply within 30 days. Nobody is emailed automatically.'),
      if (err != null) Note(err!, bad: true),
      if (l == null && err == null) _wait(),
      if (l != null && l.isEmpty) emptyBox(Icons.privacy_tip_outlined, 'No open requests.'),
      if (l != null)
        Group([
          for (final r in l)
            Li('${kinds['${r['kind']}'] ?? r['kind']} · ${r['name'] ?? r['login_email']}', sub: '${r['message'] ?? ''}'.isEmpty ? '${r['login_email']}' : '${r['message']}', value: r['overdue'] == true ? 'late' : '${r['due_at']}'.split('T').first, onTap: () => _open(r)),
        ]),
    ]);
  }

  void _open(Map<String, dynamic> r) {
    final reply = TextEditingController();
    openSheet(context, '${kinds['${r['kind']}'] ?? r['kind']}', (ctx, set) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text('${r['name'] ?? ''} · ${r['login_email']}${'${r['phone'] ?? ''}'.isNotEmpty ? ' · ${r['phone']}' : ''}', style: TextStyle(color: Tk.label2)),
          if ('${r['message'] ?? ''}'.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 8), child: Note('${r['message']}')),
          gap(),
          Fld('Reply', reply, multiline: true),
        ]), actions: [
      SheetAction('Reply and mark done', (_) async {
        if (reply.text.trim().isEmpty) {
          toast(context, 'Write a reply first.', err: true);
          return false;
        }
        await _set(r, 'done', reply.text.trim());
        return true;
      }, primary: true),
      SheetAction('Acknowledge', (_) async {
        await _set(r, 'in_progress', null);
        return true;
      }, primary: false),
      SheetAction('Decline', (_) async {
        if (reply.text.trim().isEmpty) {
          toast(context, 'Write the reason first.', err: true);
          return false;
        }
        await _set(r, 'rejected', reply.text.trim());
        return true;
      }, primary: false, danger: true),
    ]);
  }
}
