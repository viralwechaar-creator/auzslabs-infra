import 'package:flutter/material.dart' hide Text;
import 'package:url_launcher/url_launcher.dart';
import '../core/api.dart';
import '../core/session.dart';
import 'ds.dart';
import 'i18n.dart';
import 'kit.dart';
import 'mk.dart';
import 'p_extra.dart';
import 'p_hr.dart';
import 'p_reports.dart';
import 'theme.dart';

class MorePage extends StatelessWidget {
  const MorePage(this.s, {super.key});
  final PaySession s;

  void _push(BuildContext c, Widget w) => Navigator.push(c, MaterialPageRoute(builder: (_) => w));

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: Listenable.merge([s, Lang.rev, Tk.rev]),
      builder: (ctx, _) => TabPage('More', [
        if (s.hasEmployee) Group([
          Li('Profile', sub: '${s.employee['name'] ?? ''}', icon: Icons.person_outline, tone: Tk.accent, onTap: () => _push(ctx, ProfilePage(s))),
          Li('Income tax', sub: 'Regime and deductions', icon: Icons.receipt_long_outlined, tone: Tk.orange, onTap: () => _push(ctx, MyTaxPage(s))),
          Li('My documents', icon: Icons.folder_open_outlined, tone: Tk.blue, onTap: () => _push(ctx, MyDocsPage(s))),
        ]),
        if (s.isManager) ...[gap(), Group([Li('My team', icon: Icons.groups_outlined, tone: Tk.blue, onTap: () => _push(ctx, TeamPage(s)))])],
        if (s.hr) ...[
          const SectionLabel('HR'),
          Group([
            Li('HR today', icon: Icons.dashboard_outlined, tone: Tk.accent, onTap: () => _push(ctx, HrDashPage(s))),
            if (s.can('pay_time')) Li('Clock in kiosk', sub: 'A shared phone at work', icon: Icons.touch_app_outlined, tone: Tk.green, onTap: () => _push(ctx, KioskPage(s))),
            Li('Approvals', icon: Icons.pending_actions_outlined, tone: Tk.orange, onTap: () => _push(ctx, ApprovalsPage(s))),
            Li('People', icon: Icons.groups_outlined, tone: Tk.blue, onTap: () => _push(ctx, PeoplePage(s))),
            if (s.can('pay_reports') || s.can('pay_view')) Li('Reports', icon: Icons.bar_chart_outlined, tone: Tk.blue, onTap: () => _push(ctx, ReportsPage(s))),
            if (s.can('pay_run') || s.can('pay_view')) Li('Payroll', icon: Icons.account_balance_wallet_outlined, tone: Tk.green, onTap: () => _push(ctx, RunsPage(s))),
          ]),
        ],
        const SectionLabel('This device'),
        Pad(Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text(tr('Language'), style: TextStyle(color: Tk.label2)),
          const SizedBox(height: 6),
          Seg<String>(expand: true, items: const [('en', 'English'), ('hi', 'हिंदी')], value: Lang.code, onChanged: Lang.set),
          gap(),
          Text(tr('Appearance'), style: TextStyle(color: Tk.label2)),
          const SizedBox(height: 6),
          Seg<String>(expand: true, items: const [('system', 'Auto'), ('light', 'Light'), ('dark', 'Dark')], value: Tk.mode, onChanged: Tk.setMode),
        ])),
        gap(),
        Group([
          Li('${s.user?['email'] ?? ''}', sub: s.role, icon: Icons.account_circle_outlined, tone: Tk.label3, chevron: false),
          Li('Help & report a problem', icon: Icons.help_outline, tone: Tk.label3, onTap: () => launchUrl(Uri.parse('https://wa.me/919251250829'), mode: LaunchMode.externalApplication)),
          Li('Open AUZsPay on the web', icon: Icons.open_in_new, tone: Tk.label3, onTap: () => launchUrl(Uri.https('app.auzslab.in', '/payroll.html'), mode: LaunchMode.externalApplication)),
          Li('Sign out', icon: Icons.logout, tone: Tk.label3, onTap: () => s.signOut()),
        ]),
        Pad(Text('AUZsPay native app · build 1', style: TextStyle(color: Tk.label3, fontSize: 13))),
      ]),
    );
  }
}

class ProfilePage extends StatefulWidget {
  const ProfilePage(this.s, {super.key});
  final PaySession s;
  @override
  State<ProfilePage> createState() => _ProfilePageState();
}

class _ProfilePageState extends State<ProfilePage> {
  PaySession get s => widget.s;

  void _edit() {
    final e = s.employee;
    formSheet(context, 'My details', [
      F('phone', 'Phone', value: e['phone']),
      F('address', 'Address', value: e['address']),
      F('emergency_name', 'Emergency contact name', value: e['emergency_name']),
      F('emergency_phone', 'Emergency contact phone', value: e['emergency_phone']),
    ], (v) async {
      try {
        await s.api.rpc('pay_me_profile', {'p': v});
        await s.loadMe();
        if (mounted) toast(context, tr('Saved'));
        return true;
      } on ApiError catch (er) {
        if (mounted) toast(context, er.message, err: true);
        return false;
      }
    });
  }

  void _bank() {
    formSheet(context, 'New salary account', [
      F('holder', 'Name on the account', value: s.employee['name']),
      F('bank_name', 'Bank'),
      F('account_no', 'Account number'),
      F('ifsc', 'IFSC', hint: 'Printed on your cheque book, like SBIN0001234'),
    ], (v) async {
      try {
        await s.api.rpc('pay_me_bank_request', {'p': {...v, 'ifsc': '${v['ifsc']}'.toUpperCase()}});
        if (mounted) toast(context, tr('Sent for approval'));
        return true;
      } on ApiError catch (er) {
        if (mounted) toast(context, er.message, err: true);
        return false;
      }
    }, saveLabel: 'Send for approval');
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: s,
      builder: (ctx, _) {
        final e = s.employee;
        final rows = <(String, String?)>[
          ('Manager', '${e['manager'] ?? ''}'),
          ('Location', '${e['location'] ?? ''}'),
          ('Attendance', switch ('${e['mode']}') { 'punch' => tr('Clock in and out'), 'manual' => tr('Marked by your manager'), _ => tr('Not tracked') }),
          ('Phone', '${e['phone'] ?? ''}'),
          ('Email', '${e['email'] ?? ''}'),
          ('Address', '${e['address'] ?? ''}'),
        ].where((r) => (r.$2 ?? '').isNotEmpty).toList();
        return Scaffold(
          appBar: AppBar(title: const Text('Profile'), actions: [TextButton(onPressed: _edit, child: const Text('Edit'))]),
          body: ListView(padding: const EdgeInsets.only(bottom: 40), children: [
            Pad(Text('${e['name'] ?? ''}', style: const TextStyle(fontSize: 26, fontWeight: FontWeight.w800))),
            Hint([e['designation'], e['department']].where((x) => '${x ?? ''}'.isNotEmpty).join(' · ')),
            gap(),
            Group([for (final r in rows) Li(tr(r.$1), value: r.$2, chevron: false)]),
            const SectionLabel('Salary account'),
            Group([Li('Change my bank account', sub: 'Checked and approved before your next salary', icon: Icons.account_balance_outlined, tone: Tk.green, onTap: _bank)]),
          ]),
        );
      },
    );
  }
}
