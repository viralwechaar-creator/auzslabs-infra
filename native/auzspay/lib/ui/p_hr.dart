import 'package:flutter/material.dart' hide Text;
import '../core/api.dart';
import '../core/calc.dart';
import '../core/session.dart';
import 'ds.dart';
import 'i18n.dart';
import 'kit.dart';
import 'lv.dart';
import 'mk.dart';
import 'p_addperson.dart';
import 'p_pay.dart';
import 'p_run.dart';
import 'p_today.dart';
import 'theme.dart';

List<Map<String, dynamic>> _maps(dynamic l) => ((l as List?) ?? const []).map((e) => Map<String, dynamic>.from(e as Map)).toList();

/// What an HR person or line manager sees on the Today screen of the website: attendance, decisions waiting, payroll, headcount.
class HrDashPage extends StatelessWidget {
  const HrDashPage(this.s, {super.key});
  final PaySession s;
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('HR today')),
      body: Loader<Map<String, dynamic>>(
        load: () async => Map<String, dynamic>.from(await s.api.rpc('pay_dashboard') as Map),
        builder: (ctx, d, reload) {
          final a = d['attendance'] is Map ? Map<String, dynamic>.from(d['attendance'] as Map) : const <String, dynamic>{};
          final pend = d['pending'] is Map ? Map<String, dynamic>.from(d['pending'] as Map) : const <String, dynamic>{};
          final total = pend.values.fold<double>(0, (x, y) => x + n(y));
          final hc = d['headcount'] is Map ? Map<String, dynamic>.from(d['headcount'] as Map) : const <String, dynamic>{};
          final pr = d['payroll'] is Map ? Map<String, dynamic>.from(d['payroll'] as Map) : null;
          return RefreshIndicator(
            onRefresh: reload,
            child: ListView(padding: const EdgeInsets.only(bottom: 40), children: [
              Hint(fmtD(d['today'], weekday: true)),
              const SectionLabel('Attendance today'),
              metricGrid([
                Metric('In', '${(n(a['present']) + n(a['late'])).toInt()}', tone: Tk.green),
                Metric('Late', '${n(a['late']).toInt()}', tone: Tk.orange),
                Metric('On leave', '${n(a['leave']).toInt()}', tone: Tk.blue),
                Metric('Absent', '${(n(a['absent']) + n(a['waiting'])).toInt()}', tone: Tk.red),
              ]),
              if (total > 0) ...[
                const SectionLabel('Needs your decision'),
                Group([
                  for (final (k, t) in const [('leave', 'leave requests'), ('corrections', 'attendance corrections'), ('loans', 'advance requests'), ('claims', 'expense claims'), ('bank', 'bank changes')])
                    if (n(pend[k]) > 0) Li('${n(pend[k]).toInt()} ${tr(t)}', icon: Icons.pending_actions_outlined, tone: Tk.orange, onTap: () => Navigator.push(ctx, MaterialPageRoute(builder: (_) => ApprovalsPage(s)))),
                ]),
              ],
              if (pr != null) ...[
                const SectionLabel('Payroll'),
                Group([Li('${pr['title'] ?? monthName(pr['month'])}', sub: '${pr['status'] ?? ''}', value: pr['net'] != null ? inr(n(pr['net']), dp: 0) : null, icon: Icons.account_balance_wallet_outlined, tone: Tk.accent, chevron: false)]),
              ],
              const SectionLabel('People'),
              metricGrid([
                Metric('People', '${(n(hc['active']) + n(hc['notice'])).toInt()}', sub: n(hc['notice']) > 0 ? '${n(hc['notice']).toInt()} ${tr('leaving')}' : null),
                Metric('Joined this month', '${n(hc['joined_this_month']).toInt()}'),
                if (d['monthly_cost'] != null) Metric('Monthly salaries', inr(n(d['monthly_cost']), dp: 0), sub: 'gross, everyone current'),
              ]),
            ]),
          );
        },
      ),
    );
  }
}

/// Leave, corrections, advances, claims and bank changes waiting for a decision.
class ApprovalsPage extends StatefulWidget {
  const ApprovalsPage(this.s, {super.key});
  final PaySession s;
  @override
  State<ApprovalsPage> createState() => _ApprovalsPageState();
}

class _ApprovalsPageState extends State<ApprovalsPage> {
  PaySession get s => widget.s;
  int gen = 0;

  Future<String?> _ask(BuildContext c, String title, String label, {String? value, bool number = false}) async {
    final t = TextEditingController(text: value ?? '');
    return showDialog<String>(
      context: c,
      builder: (d) => AlertDialog(
        title: Text(title),
        content: TextField(controller: t, autofocus: true, keyboardType: number ? const TextInputType.numberWithOptions(decimal: true) : TextInputType.text, decoration: InputDecoration(labelText: tr(label))),
        actions: [TextButton(onPressed: () => Navigator.pop(d), child: const Text('Cancel')), FilledButton(onPressed: () => Navigator.pop(d, t.text), child: const Text('OK'))],
      ),
    );
  }

  Future<void> _decide(BuildContext c, Map<String, dynamic> x, bool ok) async {
    final type = '${x['type']}';
    try {
      if (type == 'leave') {
        final note = ok ? null : await _ask(c, 'Decline leave', 'Reason (optional)');
        if (!ok && note == null) return;
        await s.api.rpc('pay_leave_decide', {'p_id': x['id'], 'p_approve': ok, 'p_note': note});
      } else if (type == 'correction') {
        await s.api.rpc('pay_reg_decide', {'p_id': x['id'], 'p_approve': ok, 'p_note': null});
      } else if (type == 'loan') {
        if (ok) {
          var done = false;
          await formSheet(c, 'Approve ${x['title'] ?? 'advance'}', [
            F('amount', 'Amount', type: 'number', value: x['amount']),
            F('emi', 'Recover each month', type: 'number', value: x['emi'] ?? x['amount'], hint: 'Taken from salary until it is paid back'),
            F('start_month', 'First month to recover', value: monthOf(todayStr()), hint: 'YYYY-MM'),
            F('disbursed_via', 'Given how', type: 'select', value: 'cash', options: const [['cash', 'Cash'], ['bank', 'Bank transfer'], ['none', 'Already given']]),
          ], (v) async {
            try {
              await s.api.rpc('pay_loan_decide', {'p_id': x['id'], 'p_approve': true, 'p': {'amount': n(v['amount']), 'emi': n(v['emi']), 'start_month': v['start_month'], 'disbursed_via': v['disbursed_via']}});
              done = true;
              return true;
            } on ApiError catch (e) {
              if (c.mounted) toast(c, e.message, err: true);
              return false;
            }
          }, saveLabel: 'Approve');
          if (!done) return;
        } else {
          final note = await _ask(c, 'Decline request', 'Reason (optional)');
          if (note == null) return;
          await s.api.rpc('pay_loan_decide', {'p_id': x['id'], 'p_approve': false, 'p': {'note': note}});
        }
      } else if (type == 'claim') {
        if (ok) {
          final amt = await _ask(c, 'Approve claim', 'Approved amount', value: '${x['amount']}', number: true);
          if (amt == null) return;
          await s.api.rpc('pay_claim_decide', {'p_id': x['id'], 'p_approve': true, 'p': {'amount': n(amt)}});
        } else {
          final note = await _ask(c, 'Decline', 'Reason (optional)');
          if (note == null) return;
          await s.api.rpc('pay_claim_decide', {'p_id': x['id'], 'p_approve': false, 'p': {'note': note}});
        }
      } else if (type == 'bank') {
        await s.api.rpc('pay_bank_decide', {'p_id': x['id'], 'p_approve': ok});
      }
      if (c.mounted) toast(c, tr(ok ? 'Approved' : 'Declined'));
      setState(() => gen++);
    } on ApiError catch (e) {
      if (c.mounted) toast(c, e.message, err: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Approvals')),
      body: Loader<List<Map<String, dynamic>>>(
        key: ValueKey(gen),
        load: () async => _maps(await s.api.rpc('pay_list_requests', {'p': {'status': 'pending'}})),
        builder: (ctx, list, reload) => list.isEmpty
            ? emptyBox(Icons.check_circle_outline, 'Nothing to approve')
            : RefreshIndicator(
                onRefresh: reload,
                child: ListView(padding: const EdgeInsets.only(bottom: 40), children: [
                  for (final x in list)
                    Container(
                      margin: const EdgeInsets.fromLTRB(16, 8, 16, 0),
                      padding: const EdgeInsets.all(14),
                      decoration: BoxDecoration(color: Tk.card, borderRadius: BorderRadius.circular(18), border: Border.all(color: Tk.line, width: .5)),
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Text('${x['name']}', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
                        Text('${x['title'] ?? x['type']}', style: TextStyle(fontSize: 16, color: Tk.label2)),
                        const SizedBox(height: 4),
                        Text(_meta(x), style: TextStyle(fontSize: 15, color: Tk.label2)),
                        if ('${x['reason'] ?? ''}'.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 4), child: Text('“${x['reason']}”', style: TextStyle(fontSize: 15, fontStyle: FontStyle.italic, color: Tk.label))),
                        const SizedBox(height: 10),
                        Row(children: [
                          Expanded(child: FilledButton(onPressed: () => _decide(ctx, x, true), child: const Text('Approve'))),
                          const SizedBox(width: 10),
                          Expanded(child: OutlinedButton(onPressed: () => _decide(ctx, x, false), child: const Text('Decline'))),
                        ]),
                      ]),
                    ),
                ]),
              ),
      ),
    );
  }

  String _meta(Map<String, dynamic> x) {
    switch ('${x['type']}') {
      case 'leave':
        return '${fmtD(x['from'], noYear: true)}${x['to'] != null && x['to'] != x['from'] ? ' – ${fmtD(x['to'], noYear: true)}' : ''}${x['half'] != null && x['half'] != 'none' ? ' (${x['half']} ${tr('half')})' : ''} · ${tr('Balance')} ${qtyStr(n(x['balance']))}';
      case 'correction':
        return '${tr('In')} ${fmtT(x['in'])}${x['out'] != null ? ', ${tr('out')} ${fmtT(x['out'])}' : ''}';
      case 'loan':
        return '${tr('Asked')} ${inr(n(x['amount']))}${x['emi'] != null && n(x['emi']) != n(x['amount']) ? ', ${inr(n(x['emi']))} ${tr('a month')}' : ''}';
      case 'claim':
        return '${inr(n(x['amount']))} · ${fmtD(x['from'], noYear: true)}';
      case 'bank':
        return 'IFSC ${x['ifsc'] ?? ''}';
    }
    return '';
  }
}

/// The people the business pays.
class PeoplePage extends StatefulWidget {
  const PeoplePage(this.s, {super.key});
  final PaySession s;
  @override
  State<PeoplePage> createState() => _PeoplePageState();
}

class _PeoplePageState extends State<PeoplePage> {
  PaySession get s => widget.s;
  String f = 'current', q = '';
  int v = 0; // bumped after adding someone so the list loads again
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('People'), actions: [
        if (s.can('pay_people'))
          TextButton.icon(
              onPressed: () async {
                if (await addPerson(context, s) && mounted) setState(() => v++);
              },
              icon: const Icon(Icons.person_add_alt_1),
              label: const Text('Add person')),
      ]),
      body: Loader<List<Map<String, dynamic>>>(
        key: ValueKey(v),
        load: () async => _maps(await s.api.rpc('pay_list_employees', {'p': {'status': 'all'}})),
        builder: (ctx, all, reload) {
          final ql = q.toLowerCase();
          final rows = all.where((e) => (f == 'all' || (f == 'current' ? e['status'] != 'exited' : e['status'] == f)) && (ql.isEmpty || ['name', 'code', 'phone', 'designation', 'department'].any((k) => '${e[k] ?? ''}'.toLowerCase().contains(ql)))).toList();
          return RefreshIndicator(
            onRefresh: reload,
            child: ListView(padding: const EdgeInsets.only(bottom: 40), children: [
              Hint('${all.where((e) => e['status'] != 'exited').length} ${tr('working here')}'),
              Pad(TextField(onChanged: (v) => setState(() => q = v), decoration: InputDecoration(prefixIcon: const Icon(Icons.search), hintText: tr('Search by name, phone or job')))),
              Pad(Seg<String>(expand: true, items: const [('current', 'Current'), ('notice', 'Leaving'), ('exited', 'Left'), ('all', 'All')], value: f, onChanged: (v) => setState(() => f = v))),
              gap(),
              if (rows.isEmpty) emptyBox(Icons.search, 'No one found') else Group([
                for (final e in rows)
                  Li('${e['name']}',
                      sub: [e['designation'], e['department']].where((x) => '${x ?? ''}'.isNotEmpty).join(' · '),
                      icon: Icons.person_outline,
                      tone: attTone('${e['today']}'),
                      value: s.can('pay_salary') && n(e['gross']) > 0 ? inr(n(e['gross']), dp: 0) : null,
                      onTap: () => Navigator.push(ctx, MaterialPageRoute(builder: (_) => PersonPage(s, e)))),
              ]),
            ]),
          );
        },
      ),
    );
  }
}

class PersonPage extends StatelessWidget {
  const PersonPage(this.s, this.e, {super.key});
  final PaySession s;
  final Map<String, dynamic> e;
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text('${e['name']}')),
      body: Loader<Map<String, dynamic>>(
        load: () async => Map<String, dynamic>.from(await s.api.rpc('pay_get_employee', {'p_id': e['id']}) as Map),
        builder: (ctx, d, _) {
          final emp = d['employee'] is Map ? Map<String, dynamic>.from(d['employee'] as Map) : e;
          final slips = _maps(d['payslips']);
          final rows = <(String, String?)>[
            ('Job', [emp['designation'], emp['department']].where((x) => '${x ?? ''}'.isNotEmpty).join(' · ')),
            ('Phone', '${emp['phone'] ?? ''}'),
            ('Email', '${emp['email'] ?? ''}'),
            ('Joined', emp['joined_on'] != null ? fmtD(emp['joined_on']) : null),
            ('Status', '${emp['status'] ?? ''}'),
            if (s.can('pay_salary') && emp['gross'] != null) ('Monthly pay', inr(n(emp['gross']), dp: 0)),
          ].where((r) => (r.$2 ?? '').isNotEmpty).toList();
          return ListView(padding: const EdgeInsets.only(bottom: 40), children: [
            Group([for (final r in rows) Li(tr(r.$1), value: r.$2, chevron: false)]),
            if (slips.isNotEmpty) ...[
              const SectionLabel('Payslips'),
              Group([for (final p in slips.take(24)) Li('${p['title'] ?? monthName(p['month'])}', value: inr(n(p['net'])), icon: Icons.description_outlined, tone: Tk.accent, onTap: () => Navigator.push(ctx, MaterialPageRoute(builder: (_) => PayslipPage(s, '${p['id']}'))))]),
            ],
          ]);
        },
      ),
    );
  }
}

/// Payroll runs, read-only: month, people, total, status; open one for the payslips inside it.
class RunsPage extends StatelessWidget {
  const RunsPage(this.s, {super.key});
  final PaySession s;
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Payroll'), actions: [if (s.can('pay_run')) TextButton.icon(onPressed: () => newRun(context, s), icon: const Icon(Icons.add), label: const Text('New payroll'))]),
      body: Loader<List<Map<String, dynamic>>>(
        load: () async => _maps(await s.api.rpc('pay_list_runs', {'p': {}})),
        builder: (ctx, runs, reload) => runs.isEmpty
            ? emptyBox(Icons.account_balance_wallet_outlined, 'No payroll yet', s.can('pay_run') ? 'Tap New payroll to run the first month.' : 'Finalised payrolls show here.')
            : RefreshIndicator(
                onRefresh: reload,
                child: ListView(padding: const EdgeInsets.only(bottom: 40), children: [
                  Group([
                    for (final r in runs)
                      Li('${r['title']}',
                          sub: '${r['employees'] ?? 0} ${tr('people')} · ${monthName(r['month'])}${n(r['warning_count']) > 0 ? ' · ${n(r['warning_count']).toInt()} ${tr('to check')}' : ''}',
                          value: inr(n(r['net']), dp: 0),
                          icon: Icons.account_balance_wallet_outlined,
                          tone: ['paid', 'locked'].contains('${r['status']}') ? Tk.label3 : Tk.accent,
                          onTap: () => Navigator.push(ctx, MaterialPageRoute(builder: (_) => RunPage(s, '${r['id']}', '${r['title']}')))),
                  ]),
                ]),
              ),
      ),
    );
  }
}

/// Line manager: who reports to me and what is waiting.
class TeamPage extends StatelessWidget {
  const TeamPage(this.s, {super.key});
  final PaySession s;
  @override
  Widget build(BuildContext context) {
    final team = _maps(s.me['team']);
    return Scaffold(
      appBar: AppBar(title: const Text('My team')),
      body: ListView(padding: const EdgeInsets.only(bottom: 40), children: [
        Hint('${team.length} ${tr('people report to you')}'),
        Pad(FilledButton.icon(onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => ApprovalsPage(s))), icon: const Icon(Icons.pending_actions_outlined), label: const Text('Approvals'))),
        const SectionLabel('Today'),
        if (team.isEmpty) emptyBox(Icons.groups_outlined, 'Nobody reports to you') else Group([
          for (final x in team) Li('${x['name']}', sub: x['in'] != null ? '${tr('In at')} ${fmtT(x['in'])}' : null, icon: Icons.person_outline, tone: attTone('${x['status']}'), trailing: Pill(tr(attLabel['${x['status']}'] ?? '${x['status'] ?? ''}'), tone: attTone('${x['status']}'))),
        ]),
      ]),
    );
  }
}
