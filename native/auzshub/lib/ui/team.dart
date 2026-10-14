import 'dart:convert';
import 'package:flutter/material.dart' hide Text;
import 'package:url_launcher/url_launcher.dart';
import '../core/api.dart';
import '../core/session.dart';
import 'ds.dart';
import 'i18n.dart';
import 'mk.dart';
import 'theme.dart';

/// Role names and lead stages, same wording as app/public/salesman.html.
const teamRoles = {'salesman': 'Salesman', 'setup': 'Client setup', 'support': 'Support', 'manager': 'Manager'};
const leadStages = <(String, String)>[('new', 'New'), ('contacted', 'Contacted'), ('demo', 'Demo shown'), ('quoted', 'Quote sent'), ('converted', 'Won'), ('declined', 'Lost')];
const nicheChoices = <(String, String)>[
  ('', 'Not sure'),
  ('cafe', 'Cafe / restaurant'),
  ('salon', 'Salon / spa'),
  ('retail', 'Retail / General'),
  ('mobile', 'Mobile shop'),
];
const activityNames = {
  'lead_added': 'Added a lead',
  'lead_stage': 'Moved a lead',
  'lead_note': 'Wrote a note',
  'lead_followup': 'Set a follow-up',
  'lead_assigned': 'Was given a lead',
  'trial_created': 'Created a trial',
  'setup_assigned': 'Was given a setup',
  'setup_open': 'Opened a client business',
  'setup_checklist': 'Updated a checklist',
  'setup_done': 'Finished a setup',
};

String stageName(String? k) => leadStages.firstWhere((e) => e.$1 == k, orElse: () => (k ?? '', k ?? '')).$2;
String todayYmd() {
  final d = DateTime.now();
  return '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
}

String plusDays(int n) {
  final d = DateTime.now().add(Duration(days: n));
  return '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
}

bool leadClosed(Map l) => l['status'] == 'converted' || l['status'] == 'declined';
bool leadOverdue(Map l) => !leadClosed(l) && '${l['next_followup'] ?? ''}'.isNotEmpty && '${l['next_followup']}'.compareTo(todayYmd()) < 0;

/// The team workspace: the same tabs as the website's team page, per role.
class TeamWorkspace extends StatefulWidget {
  const TeamWorkspace(this.s, {super.key});
  final HubSession s;
  @override
  State<TeamWorkspace> createState() => _TeamWorkspaceState();
}

class _TeamWorkspaceState extends State<TeamWorkspace> {
  Map<String, dynamic>? me;
  String? err;
  int tab = 0;

  ApiClient get api => widget.s.api;
  String get role => '${me?['role'] ?? ''}';

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final r = await api.rpc('team_me');
      if (mounted) setState(() => me = Map<String, dynamic>.from(r as Map));
    } on ApiError catch (e) {
      if (mounted) setState(() => err = e.message.contains('not a team member') ? 'You are not on the AUZslab team yet.' : e.message);
    }
  }

  List<(String, IconData)> get tabs => switch (role) {
        'salesman' => [('Home', Icons.home_outlined), ('Leads', Icons.contacts_outlined), ('Trials', Icons.rocket_launch_outlined), ('Me', Icons.person_outline)],
        'setup' => [('Home', Icons.home_outlined), ('Setups', Icons.build_outlined), ('Me', Icons.person_outline)],
        'support' => [('Home', Icons.home_outlined), ('Leads', Icons.contacts_outlined), ('Me', Icons.person_outline)],
        _ => [('Home', Icons.home_outlined), ('Leads', Icons.contacts_outlined), ('Setups', Icons.build_outlined), ('Team', Icons.groups_outlined), ('Me', Icons.person_outline)],
      };

  Widget _page(String name) => switch (name) {
        'Home' => TeamHome(api, me!, () => setState(() => tab = tabs.indexWhere((t) => t.$1 == (role == 'setup' ? 'Setups' : 'Leads')))),
        'Leads' => LeadsPage(api, me!),
        'Setups' => SetupsPage(widget.s, me!),
        'Trials' => TrialsPage(widget.s),
        'Team' => PeoplePage(api),
        _ => MePage(widget.s, me!),
      };

  @override
  Widget build(BuildContext context) {
    if (me == null) {
      return Scaffold(appBar: AppBar(title: const Text('Team workspace')), body: Center(child: err == null ? const CircularProgressIndicator() : Padding(padding: const EdgeInsets.all(24), child: Note(err!, bad: true))));
    }
    final t = tabs;
    if (tab >= t.length) tab = 0;
    return Scaffold(
      body: SafeArea(child: KeyedSubtree(key: ValueKey('${t[tab].$1}$tab'), child: _page(t[tab].$1))),
      bottomNavigationBar: NavigationBar(
        selectedIndex: tab,
        onDestinationSelected: (i) => setState(() => tab = i),
        destinations: [for (final e in t) NavigationDestination(icon: Icon(e.$2), label: tr(e.$1))],
      ),
    );
  }
}

Widget _loading() => const Padding(padding: EdgeInsets.all(40), child: Center(child: CircularProgressIndicator()));

Widget _stat(String label, num v, {Color? tone}) => Expanded(
      child: Container(
        margin: const EdgeInsets.all(4),
        padding: const EdgeInsets.symmetric(vertical: 14),
        decoration: BoxDecoration(color: Tk.card, borderRadius: BorderRadius.circular(16), border: Border.all(color: Tk.line, width: .5)),
        child: Column(children: [
          Text('$v', style: TextStyle(fontSize: 24, fontWeight: FontWeight.w800, color: tone)),
          Text(label, style: TextStyle(fontSize: 12, color: Tk.label2)),
        ]),
      ),
    );

String agoText(dynamic s) {
  final d = DateTime.tryParse('${s ?? ''}');
  if (d == null) return 'never';
  final m = DateTime.now().difference(d).inMinutes;
  if (m < 1) return 'just now';
  if (m < 60) return '$m min ago';
  if (m < 1440) return '${m ~/ 60} h ago';
  return '${m ~/ 1440} d ago';
}

// ---------------------------------------------------------------- Home

class TeamHome extends StatefulWidget {
  const TeamHome(this.api, this.me, this.seeAll, {super.key});
  final ApiClient api;
  final Map<String, dynamic> me;
  final VoidCallback seeAll;
  @override
  State<TeamHome> createState() => _TeamHomeState();
}

class _TeamHomeState extends State<TeamHome> {
  Map<String, dynamic>? work;
  List<Map<String, dynamic>> items = [], notices = [];
  String? err;

  String get role => '${widget.me['role']}';

  @override
  void initState() {
    super.initState();
    _load();
  }

  List<Map<String, dynamic>> _list(dynamic r) => (r is List ? r : const []).map((e) => Map<String, dynamic>.from(e as Map)).toList();

  Future<void> _load() async {
    try {
      final w = await widget.api.rpc('team_my_work', {'p_days': 30});
      final it = role == 'setup' ? await widget.api.rpc('team_my_setups') : await widget.api.rpc(role == 'manager' ? 'team_all_leads' : 'team_my_leads');
      var n = <Map<String, dynamic>>[];
      try {
        n = _list(await widget.api.rpc('team_list_notices', {'p_limit': 5}));
      } catch (_) {}
      if (mounted) {
        setState(() {
          work = Map<String, dynamic>.from(w as Map);
          items = _list(it);
          notices = n;
        });
      }
    } on ApiError catch (e) {
      if (mounted) setState(() => err = e.message);
    }
  }

  @override
  Widget build(BuildContext context) {
    final sum = (work?['summary'] is Map ? work!['summary'] as Map : const {});
    final due = items.where((l) => role != 'setup' && !leadClosed(l) && '${l['next_followup'] ?? ''}'.isNotEmpty && '${l['next_followup']}'.compareTo(todayYmd()) <= 0).toList();
    final openSetups = items.where((x) => role == 'setup' && x['status'] == 'open' && x['expired'] != true).toList();
    final recent = (work?['recent'] is List ? work!['recent'] as List : const []).whereType<Map>().toList();
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(padding: const EdgeInsets.only(bottom: 24), children: [
        PageHead('Hello, ${'${widget.me['name'] ?? ''}'.split(' ').first}', sub: teamRoles[role] ?? role),
        if (err != null) Note(err!, bad: true),
        if (work == null && err == null) _loading(),
        if (work != null) ...[
          Padding(padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4), child: Row(children: role == 'setup'
              ? [_stat('open', sum['setups_open'] ?? 0), _stat('finished', sum['setups_done'] ?? 0), _stat('updates', sum['updates'] ?? 0)]
              : [_stat('open leads', sum['leads_open'] ?? 0), _stat('won', sum['leads_converted'] ?? 0), _stat('overdue', sum['leads_overdue'] ?? 0, tone: (sum['leads_overdue'] ?? 0) > 0 ? Tk.red : null)])),
          SectionLabel(role == 'setup' ? 'Your setups' : 'Follow up now'),
          if (role == 'setup')
            openSetups.isEmpty ? const Hint('Nothing assigned right now. The owner will give you a client to set up.') : Group([for (final a in openSetups.take(5)) Li('${a['client']}', sub: '${a['slug']}.auzslab.in', icon: Icons.build_outlined, tone: Tk.accent, onTap: widget.seeAll)])
          else
            due.isEmpty ? const Hint('You are all caught up.') : Group([for (final l in due.take(5)) _leadLi(l, onTap: widget.seeAll)]),
          if (notices.isNotEmpty) ...[
            const SectionLabel('Notices'),
            Group([for (final n in notices) Li('${n['title']}', sub: '${n['body'] ?? ''}', chevron: false)]),
          ],
          const SectionLabel('Recent work'),
          recent.isEmpty ? const Hint('Nothing yet.') : Group([for (final a in recent.take(8)) Li(activityNames['${a['kind']}'] ?? '${a['kind']}', sub: '${a['label'] ?? ''}', value: agoText(a['at'] ?? a['created_at']), chevron: false)]),
        ],
      ]),
    );
  }
}

Widget _leadLi(Map l, {required VoidCallback onTap}) {
  final od = leadOverdue(l);
  final fu = '${l['next_followup'] ?? ''}';
  return Li('${l['business'] ?? ''}'.isNotEmpty ? '${l['business']}' : '${l['name']}',
      sub: [if ('${l['business'] ?? ''}'.isNotEmpty) '${l['name']}', '${l['contact'] ?? ''}', if ('${l['assignee'] ?? ''}'.isNotEmpty) '${l['assignee']}'].where((x) => x.isNotEmpty).join(' · '),
      trailing: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.end, children: [
        Pill(stageName('${l['status']}'), tone: l['status'] == 'converted' ? Tk.green : (l['status'] == 'declined' ? Tk.label3 : Tk.blue)),
        if (fu.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 4), child: Text(od ? 'Overdue $fu' : fu, style: TextStyle(fontSize: 12, color: od ? Tk.red : Tk.label2))),
      ]),
      onTap: onTap);
}

// ---------------------------------------------------------------- Leads

class LeadsPage extends StatefulWidget {
  const LeadsPage(this.api, this.me, {super.key});
  final ApiClient api;
  final Map<String, dynamic> me;
  @override
  State<LeadsPage> createState() => _LeadsPageState();
}

class _LeadsPageState extends State<LeadsPage> {
  List<Map<String, dynamic>>? leads;
  String? err;
  String get role => '${widget.me['role']}';
  bool get canAdd => role == 'salesman' || role == 'manager';

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final r = await widget.api.rpc(role == 'manager' ? 'team_all_leads' : 'team_my_leads');
      if (mounted) {
        setState(() {
          leads = (r is List ? r : const []).map((e) => Map<String, dynamic>.from(e as Map)).toList();
          err = null;
        });
      }
    } on ApiError catch (e) {
      if (mounted) setState(() => err = e.message);
    }
  }

  void _add() {
    final name = TextEditingController(), biz = TextEditingController(), contact = TextEditingController(), msg = TextEditingController();
    final fu = TextEditingController(text: plusDays(1));
    var niche = '';
    openSheet(context, 'Add a lead', (ctx, set) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Fld('Their name', name),
          gap(),
          Fld('Business', biz),
          gap(),
          Fld('Phone or email', contact),
          gap(),
          Sel('Type of business', niche, nicheChoices, (v) => set(() => niche = v)),
          gap(),
          Fld('What do they need?', msg, multiline: true),
          gap(),
          Fld('Follow up on (YYYY-MM-DD)', fu),
        ]), actions: [
      SheetAction('Save lead', (_) async {
        try {
          await widget.api.rpc('team_add_lead', {'p': {'name': name.text, 'business': biz.text, 'contact': contact.text, 'niche': niche, 'message': msg.text, 'next_followup': fu.text}});
          if (mounted) toast(context, 'Lead added');
          _load();
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
    final l = leads;
    final closed = l?.where(leadClosed).toList() ?? [];
    final open = l?.where((x) => !leadClosed(x)).toList() ?? [];
    open.sort((a, b) => '${a['next_followup'] ?? '9999'}'.compareTo('${b['next_followup'] ?? '9999'}'));
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(padding: const EdgeInsets.only(bottom: 24), children: [
        PageHead('Leads', sub: l == null ? null : '${open.length} open', trailing: canAdd ? iconBtn(Icons.add_circle, _add, tip: 'Add a lead') : null),
        if (err != null) Note(err!, bad: true),
        if (l == null && err == null) _loading(),
        if (l != null && l.isEmpty) emptyBox(Icons.contacts_outlined, 'No leads yet.', canAdd ? 'Add the first one.' : 'The owner will assign some to you.'),
        if (open.isNotEmpty) ...[SectionLabel('Open · ${open.length}'), Group([for (final x in open) _leadLi(x, onTap: () => _open(x))])],
        if (closed.isNotEmpty) ...[SectionLabel('Closed · ${closed.length}'), Group([for (final x in closed) _leadLi(x, onTap: () => _open(x))])],
      ]),
    );
  }

  Future<void> _open(Map<String, dynamic> l) async {
    var stage = '${l['status']}';
    final fu = TextEditingController(text: '${l['next_followup'] ?? ''}');
    final note = TextEditingController();
    String? assign = l['assigned_to'] == null ? null : '${l['assigned_to']}';
    var people = <Map<String, dynamic>>[];
    if (role == 'manager') {
      try {
        final r = await widget.api.rpc('team_overview', {'p_days': 30});
        people = (r as List).map((e) => Map<String, dynamic>.from(e as Map)).where((m) => m['active'] == true && ['salesman', 'support', 'manager'].contains(m['role'])).toList();
      } catch (_) {}
    }
    List<Map<String, dynamic>> hist = [];
    try {
      final r = await widget.api.rpc('team_lead_notes', {'p_id': l['id']});
      hist = (r as List).map((e) => Map<String, dynamic>.from(e as Map)).toList();
    } catch (_) {}
    if (!mounted) return;
    await openSheet(context, '${l['business'] ?? ''}'.isNotEmpty ? '${l['business']}' : '${l['name']}', (ctx, set) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text([if ('${l['business'] ?? ''}'.isNotEmpty) '${l['name']}', '${l['contact'] ?? ''}', '${l['niche'] ?? ''}'].where((x) => x.isNotEmpty).join(' · '), style: TextStyle(color: Tk.label2)),
          if ('${l['contact'] ?? ''}'.isNotEmpty)
            Row(children: [
              TextButton(onPressed: () => launchUrl(Uri.parse('tel:${l['contact']}')), child: const Text('Call')),
              TextButton(onPressed: () => launchUrl(Uri.parse('https://wa.me/${'${l['contact']}'.replaceAll(RegExp(r'\D'), '')}'), mode: LaunchMode.externalApplication), child: const Text('WhatsApp')),
            ]),
          if ('${l['message'] ?? ''}'.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 6), child: Note('${l['message']}')),
          const SectionLabel('Stage'),
          Wrap(spacing: 6, runSpacing: 6, children: [for (final s in leadStages) ChoiceChip(label: Text(s.$2), selected: stage == s.$1, onSelected: (_) => set(() => stage = s.$1))]),
          const SectionLabel('Follow up'),
          Fld('Date (YYYY-MM-DD)', fu),
          Wrap(spacing: 6, children: [
            ActionChip(label: const Text('Tomorrow'), onPressed: () => set(() => fu.text = plusDays(1))),
            ActionChip(label: const Text('In 3 days'), onPressed: () => set(() => fu.text = plusDays(3))),
            ActionChip(label: const Text('Next week'), onPressed: () => set(() => fu.text = plusDays(7))),
            ActionChip(label: const Text('Clear'), onPressed: () => set(() => fu.text = '')),
          ]),
          if (role == 'manager') ...[
            const SectionLabel('Assigned to'),
            Sel('Assigned to', assign ?? '', [('', 'Nobody'), for (final m in people) ('${m['id']}', '${m['name']} (${teamRoles[m['role']] ?? m['role']})')], (v) => set(() => assign = v.isEmpty ? null : v)),
          ],
          gap(),
          Fld('Add a note', note, multiline: true),
          const SectionLabel('History'),
          if (hist.isEmpty) Text('Nothing yet.', style: TextStyle(color: Tk.label2)),
          for (final n in hist) Padding(padding: const EdgeInsets.symmetric(vertical: 3), child: Text('${n['author'] ?? 'Someone'} · ${n['kind'] == 'stage' ? 'stage ${n['body']}' : n['kind'] == 'followup' ? 'follow-up ${n['body']}' : n['body']} · ${agoText(n['created_at'])}', style: const TextStyle(fontSize: 14))),
        ]), actions: [
      SheetAction('Save', (_) async {
        try {
          final patch = <String, dynamic>{'status': stage, 'next_followup': fu.text};
          if (note.text.trim().isNotEmpty) patch['note'] = note.text.trim();
          await widget.api.rpc('team_update_lead', {'p_id': l['id'], 'p': patch});
          if (role == 'manager' && assign != (l['assigned_to'] == null ? null : '${l['assigned_to']}')) await widget.api.rpc('team_assign_lead', {'p_lead': l['id'], 'p_user': assign});
          return true;
        } on ApiError catch (e) {
          if (mounted) toast(context, e.message, err: true);
          return false;
        }
      }, primary: true),
    ]);
    _load();
  }
}

// ---------------------------------------------------------------- Setups

/// Opens the client's real business in the browser, signed in with a limited 8-hour session (same call the website makes).
Future<void> openClientBusiness(HubSession s, String tenantId, String slug, String page) async {
  final r = await s.api.postJson('/admin/salesman-open-pos', {'tenant_id': tenantId});
  final m = Map<String, dynamic>.from(r as Map);
  final frag = base64Url.encode(utf8.encode(jsonEncode({'t': m['access_token'], 'u': m['user']}))).replaceAll('=', '');
  await launchUrl(Uri.parse('https://$slug.auzslab.in$page#auz_gt=$frag'), mode: LaunchMode.externalApplication);
}

const setupApps = <String, List<(String, String)>>{
  'salon': [('Open their admin console', '/salon/admin/')],
  'mobile': [('Open their AUZsMob', '/mob.html')],
  'retail': [('Open their AUZsLedger', '/accounts.html')],
  'cafe': [('Open their POS', '/index.html'), ('Open the admin console', '/dashboard.html')],
};

class SetupsPage extends StatefulWidget {
  const SetupsPage(this.s, this.me, {super.key});
  final HubSession s;
  final Map<String, dynamic> me;
  @override
  State<SetupsPage> createState() => _SetupsPageState();
}

class _SetupsPageState extends State<SetupsPage> {
  List<Map<String, dynamic>>? list;
  String? err;
  bool get manager => widget.me['role'] == 'manager';

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final r = await widget.s.api.rpc(manager ? 'team_list_setups' : 'team_my_setups');
      if (mounted) setState(() => list = (r is List ? r : const []).map((e) => Map<String, dynamic>.from(e as Map)).toList());
    } on ApiError catch (e) {
      if (mounted) setState(() => err = e.message);
    }
  }

  Widget _row(Map<String, dynamic> a) {
    final cl = (a['checklist'] is List ? a['checklist'] as List : const []).whereType<Map>().toList();
    final done = cl.where((x) => x['done'] == true).length;
    final state = a['status'] == 'done' ? 'Finished' : (a['expired'] == true ? 'Access ended' : 'Until ${'${a['expires_at']}'.split('T').first}');
    return Li('${a['client']}', sub: '${a['slug']}.auzslab.in${manager && '${a['assignee'] ?? ''}'.isNotEmpty ? ' · ${a['assignee']}' : ''} · $done/${cl.length} steps', value: state, icon: Icons.build_outlined, tone: Tk.accent, onTap: () => _open(a));
  }

  @override
  Widget build(BuildContext context) {
    final l = list;
    final open = l?.where((x) => x['status'] == 'open').toList() ?? [];
    final closed = l?.where((x) => x['status'] != 'open').toList() ?? [];
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(padding: const EdgeInsets.only(bottom: 24), children: [
        PageHead('Client setups', trailing: manager ? iconBtn(Icons.add_circle, _assign, tip: 'Assign a setup') : null),
        if (err != null) Note(err!, bad: true),
        if (l == null && err == null) _loading(),
        if (l != null && open.isEmpty) const Hint('Nothing assigned right now.'),
        if (open.isNotEmpty) ...[SectionLabel('Open · ${open.length}'), Group([for (final a in open) _row(a)])],
        if (closed.isNotEmpty) ...[SectionLabel('Finished · ${closed.length}'), Group([for (final a in closed) _row(a)])],
      ]),
    );
  }

  Future<void> _assign() async {
    List<Map<String, dynamic>> clients = [], people = [];
    try {
      clients = ((await widget.s.api.rpc('team_clients')) as List).map((e) => Map<String, dynamic>.from(e as Map)).toList();
      people = ((await widget.s.api.rpc('team_overview', {'p_days': 30})) as List).map((e) => Map<String, dynamic>.from(e as Map)).where((m) => m['role'] == 'setup' && m['active'] == true).toList();
    } on ApiError catch (e) {
      if (mounted) toast(context, e.message, err: true);
      return;
    }
    var client = clients.isEmpty ? '' : '${clients.first['id']}', user = people.isEmpty ? '' : '${people.first['id']}', days = '14';
    if (!mounted) return;
    await openSheet(context, 'Assign a setup', (ctx, set) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          const Hint('The person gets a checklist and can open that client\'s business for a limited time. Every opening is logged.'),
          Sel('Client', client, [for (final c in clients) ('${c['id']}', '${c['name']} (${c['slug']})')], (v) => set(() => client = v)),
          gap(),
          Sel('Setup person', user, [for (final m in people) ('${m['id']}', '${m['name']}')], (v) => set(() => user = v)),
          gap(),
          Sel('Access for', days, const [('3', '3 days'), ('7', '7 days'), ('14', '14 days'), ('30', '30 days')], (v) => set(() => days = v)),
        ]), actions: [
      SheetAction('Assign', (_) async {
        if (user.isEmpty) {
          toast(context, 'Add a team member with the Client setup role first.', err: true);
          return false;
        }
        try {
          await widget.s.api.rpc('team_assign_setup', {'p_tenant': client, 'p_user': user, 'p_days': int.parse(days)});
          return true;
        } on ApiError catch (e) {
          if (mounted) toast(context, e.message, err: true);
          return false;
        }
      }, primary: true),
    ]);
    _load();
  }

  Future<void> _open(Map<String, dynamic> a) async {
    final mine = a['assigned_to'] == widget.me['id'];
    final live = a['status'] == 'open' && a['expired'] != true && mine;
    final cl = (a['checklist'] is List ? a['checklist'] as List : const []).whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList();
    final note = TextEditingController(text: '${a['note'] ?? ''}');
    final apps = setupApps['${a['niche']}'] ?? const [('Open their POS', '/index.html'), ('Open the admin console', '/dashboard.html')];
    Future<bool> save(bool finish) async {
      try {
        await widget.s.api.rpc('team_setup_update', {'p_id': a['id'], 'p': {'checklist': [for (final c in cl) {'k': c['k'], 'done': c['done'] == true}], 'note': note.text, if (finish) 'done': true}});
        return true;
      } on ApiError catch (e) {
        if (mounted) toast(context, e.message, err: true);
        return false;
      }
    }

    await openSheet(context, '${a['client']}', (ctx, set) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text('${a['slug']}.auzslab.in${a['status'] == 'open' ? ' · access until ${'${a['expires_at']}'.split('T').first}' : ''}', style: TextStyle(color: Tk.label2)),
          if (live) ...[
            gap(),
            for (final (n, p) in apps)
              Padding(padding: const EdgeInsets.only(bottom: 6), child: OutlinedButton(onPressed: () async {
                try {
                  await openClientBusiness(widget.s, '${a['tenant_id']}', '${a['slug']}', p);
                } on ApiError catch (e) {
                  if (mounted) toast(context, e.message, err: true);
                }
              }, child: Text(n))),
            Text('Opens their real business, signed in, for 8 hours. It is logged.', style: TextStyle(fontSize: 13, color: Tk.label2)),
          ],
          if (a['expired'] == true && a['status'] == 'open') const Note('Your access to this client has ended. Ask the owner to give it again.', bad: true),
          const SectionLabel('Checklist'),
          for (final c in cl) CheckboxListTile(contentPadding: EdgeInsets.zero, controlAffinity: ListTileControlAffinity.leading, title: Text('${c['label']}'), value: c['done'] == true, onChanged: live ? (v) => set(() => c['done'] = v == true) : null),
          gap(),
          Fld('Note', note, multiline: true),
        ]), actions: [
      if (live) SheetAction('Save', (_) => save(false), primary: true),
      if (live)
        SheetAction('Mark setup finished', (_) async {
          if (!await confirm(context, 'Finish this setup?', 'Your access to ${a['client']} ends straight away.', yes: 'Finish')) return false;
          return save(true);
        }),
    ]);
    _load();
  }
}

// ---------------------------------------------------------------- Trials (salesman)

class TrialsPage extends StatefulWidget {
  const TrialsPage(this.s, {super.key});
  final HubSession s;
  @override
  State<TrialsPage> createState() => _TrialsPageState();
}

class _TrialsPageState extends State<TrialsPage> {
  List<Map<String, dynamic>>? list;
  String? err;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final r = await widget.s.api.rpc('salesman_my_trials');
      if (mounted) setState(() => list = (r is List ? r : const []).map((e) => Map<String, dynamic>.from(e as Map)).toList());
    } on ApiError catch (e) {
      if (mounted) setState(() => err = e.message);
    }
  }

  String _slug(String s) => s.toLowerCase().replaceAll(RegExp(r'[^a-z0-9]'), '');

  void _create() {
    final name = TextEditingController(), slug = TextEditingController();
    var niche = 'cafe';
    openSheet(context, 'New prospect', (ctx, set) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          const Hint('Creates a real trial business you can show them. Delete it if the deal falls through.'),
          Fld('Business name', name, onChanged: (v) {
            if (slug.text.isEmpty || slug.text == _slug(v.substring(0, v.isEmpty ? 0 : v.length - 1))) slug.text = _slug(v);
          }),
          gap(),
          Fld('Address (e.g. chapterone)', slug),
          gap(),
          Sel('Type of business', niche, nicheChoices.skip(1).toList(), (v) => set(() => niche = v)),
        ]), actions: [
      SheetAction('Create trial', (_) async {
        if (name.text.trim().isEmpty || _slug(slug.text).length < 2) {
          toast(context, 'Enter a business name and a short address.', err: true);
          return false;
        }
        try {
          await widget.s.api.rpc('salesman_provision_trial', {'p_business_name': name.text.trim(), 'p_slug': _slug(slug.text), 'p_niche': niche});
          return true;
        } on ApiError catch (e) {
          if (mounted) toast(context, e.message, err: true);
          return false;
        }
      }, primary: true),
    ]).then((_) => _load());
  }

  @override
  Widget build(BuildContext context) {
    final l = list;
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(padding: const EdgeInsets.only(bottom: 24), children: [
        PageHead('Trials', sub: 'Prospects you made a trial for', trailing: iconBtn(Icons.add_circle, _create, tip: 'New prospect')),
        if (err != null) Note(err!, bad: true),
        if (l == null && err == null) _loading(),
        if (l != null && l.isEmpty) emptyBox(Icons.rocket_launch_outlined, 'No prospects yet.', 'Create one with the + button.'),
        if (l != null && l.isNotEmpty) Group([for (final t in l) Li('${t['name']}', sub: '${t['slug']}.auzslab.in · ${t['niche']}${t['has_owner'] == true ? ' · owner login set' : ''}', icon: Icons.storefront_outlined, tone: Tk.accent, onTap: () => _open(t))]),
      ]),
    );
  }

  void _open(Map<String, dynamic> t) {
    final apps = setupApps['${t['niche']}'] ?? const [('Open their POS', '/index.html')];
    openSheet(context, '${t['name']}', (ctx, set) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text('${t['slug']}.auzslab.in', style: TextStyle(color: Tk.label2)),
          gap(),
          for (final (n, p) in apps)
            Padding(padding: const EdgeInsets.only(bottom: 6), child: OutlinedButton(onPressed: () async {
              try {
                await openClientBusiness(widget.s, '${t['id']}', '${t['slug']}', p);
              } on ApiError catch (e) {
                if (ctx.mounted) toast(ctx, e.message, err: true);
              }
            }, child: Text(n))),
          if (t['niche'] == 'cafe' && '${t['table_id'] ?? ''}'.isNotEmpty)
            Padding(padding: const EdgeInsets.only(bottom: 6), child: OutlinedButton(onPressed: () => launchUrl(Uri.parse('https://${t['slug']}.auzslab.in/site.html?t=${t['table_id']}'), mode: LaunchMode.externalApplication), child: const Text('Open QR order demo'))),
          OutlinedButton(onPressed: () => launchUrl(Uri.parse('https://app.auzslab.in/salesman.html#auz_gt=${widget.s.handoff()}'), mode: LaunchMode.externalApplication), child: const Text('Branding and delete (website)')),
        ]));
  }
}

// ---------------------------------------------------------------- Team (manager)

class PeoplePage extends StatefulWidget {
  const PeoplePage(this.api, {super.key});
  final ApiClient api;
  @override
  State<PeoplePage> createState() => _PeoplePageState();
}

class _PeoplePageState extends State<PeoplePage> {
  List<Map<String, dynamic>>? list;
  String? err;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final r = await widget.api.rpc('team_overview', {'p_days': 30});
      if (mounted) setState(() => list = (r is List ? r : const []).map((e) => Map<String, dynamic>.from(e as Map)).toList());
    } on ApiError catch (e) {
      if (mounted) setState(() => err = e.message);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = list;
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(padding: const EdgeInsets.only(bottom: 24), children: [
        const PageHead('Team', sub: 'Everyone\'s work, last 30 days'),
        if (err != null) Note(err!, bad: true),
        if (l == null && err == null) _loading(),
        if (l != null)
          Group([
            for (final m in l)
              Li('${m['name']}${m['active'] == true ? '' : ' (off)'}',
                  sub: m['role'] == 'setup' ? '${teamRoles['setup']} · ${m['setups_open']} open · ${m['setups_done']} finished' : '${teamRoles[m['role']] ?? m['role']} · ${m['leads_open']} open leads · ${m['updates']} updates${m['role'] == 'salesman' ? ' · ${m['trials']} trials · ${m['leads_converted']} won' : ''}',
                  value: agoText(m['last_active']),
                  icon: Icons.person_outline,
                  tone: Tk.blue,
                  onTap: () => _feed(m)),
          ]),
      ]),
    );
  }

  Future<void> _feed(Map<String, dynamic> m) async {
    List feed = [];
    try {
      feed = (await widget.api.rpc('team_activity_feed', {'p_uid': m['id'], 'p_limit': 40})) as List;
    } on ApiError catch (e) {
      if (mounted) toast(context, e.message, err: true);
      return;
    }
    if (!mounted) return;
    openSheet(context, '${m['name']}', (ctx, set) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text('${teamRoles[m['role']] ?? m['role']} · ${m['email'] ?? ''}${'${m['phone'] ?? ''}'.isNotEmpty ? ' · ${m['phone']}' : ''}', style: TextStyle(color: Tk.label2)),
          const SectionLabel('Recent work'),
          if (feed.isEmpty) Text('Nothing yet.', style: TextStyle(color: Tk.label2)),
          for (final a in feed.whereType<Map>()) Padding(padding: const EdgeInsets.symmetric(vertical: 3), child: Text('${activityNames['${a['kind']}'] ?? a['kind']}${'${a['label'] ?? ''}'.isNotEmpty ? ' · ${a['label']}' : ''} · ${agoText(a['created_at'] ?? a['at'])}')),
        ]));
  }
}

// ---------------------------------------------------------------- Me

class MePage extends StatefulWidget {
  const MePage(this.s, this.me, {super.key});
  final HubSession s;
  final Map<String, dynamic> me;
  @override
  State<MePage> createState() => _MePageState();
}

class _MePageState extends State<MePage> {
  var days = '30';
  Map<String, dynamic>? sum;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final r = await widget.s.api.rpc('team_my_work', {'p_days': int.parse(days)});
      if (mounted) setState(() => sum = r is Map && r['summary'] is Map ? Map<String, dynamic>.from(r['summary'] as Map) : {});
    } on ApiError catch (_) {}
  }

  @override
  Widget build(BuildContext context) {
    final m = widget.me;
    final setup = m['role'] == 'setup';
    final s = sum ?? const <String, dynamic>{};
    return ListView(padding: const EdgeInsets.only(bottom: 24), children: [
      PageHead('${m['name']}', sub: '${teamRoles[m['role']] ?? m['role']} · ${m['email']}'),
      const SectionLabel('My results'),
      Pad(Sel('Period', days, const [('7', 'Last 7 days'), ('30', 'Last 30 days'), ('90', 'Last 90 days'), ('0', 'All time')], (v) {
        days = v;
        _load();
      })),
      if (sum != null)
        Padding(padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8), child: Row(children: setup
            ? [_stat('open', s['setups_open'] ?? 0), _stat('finished', s['setups_done'] ?? 0), _stat('updates', s['updates'] ?? 0)]
            : [_stat('open leads', s['leads_open'] ?? 0), _stat('updates', s['updates'] ?? 0), _stat('won', s['leads_converted'] ?? 0)])),
      const SectionLabel('Account'),
      Group([
        Li('Back to the hub', icon: Icons.apps, tone: Tk.blue, onTap: () => Navigator.of(context).pop()),
        Li('Sign out', icon: Icons.logout, tone: Tk.red, chevron: false, onTap: () {
          Navigator.of(context).popUntil((r) => r.isFirst);
          widget.s.signOut();
        }),
      ]),
    ]);
  }
}
