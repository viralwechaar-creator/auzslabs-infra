import 'package:flutter/material.dart' hide Text;
import 'package:geolocator/geolocator.dart';
import '../core/api.dart';
import '../core/calc.dart';
import '../core/session.dart';
import 'ds.dart';
import 'i18n.dart';
import 'mk.dart';
import 'theme.dart';

const attLabel = {
  'present': 'Present', 'late': 'Late', 'absent': 'Absent', 'leave': 'On leave', 'half_leave': 'Half day leave', 'missing': 'No clock-out',
  'holiday': 'Holiday', 'off': 'Day off', 'upcoming': 'Coming up', 'waiting': 'Not in yet',
};
Color attTone(String s) => switch (s) {
      'present' => Tk.green,
      'late' || 'missing' || 'waiting' => Tk.orange,
      'absent' => Tk.red,
      'leave' || 'half_leave' => Tk.blue,
      _ => Tk.label3,
    };

/// Requests the person made, with the way to cancel one that is still waiting.
Widget requestRow(BuildContext context, PaySession s, Map<String, dynamic> r, Future<void> Function() done) {
  final type = '${r['type']}';
  String sub;
  if (type == 'leave') {
    sub = '${fmtD(r['from'], noYear: true)}${r['to'] != null && r['to'] != r['from'] ? ' – ${fmtD(r['to'], noYear: true)}' : ''} · ${qtyStr(n(r['days']))} ${tr('days')}';
  } else if (type == 'correction') {
    sub = '${fmtD(r['from'], noYear: true)} · ${tr('in')} ${fmtT(r['in'])}${r['out'] != null ? ', ${tr('out')} ${fmtT(r['out'])}' : ''}';
  } else if (type == 'loan') {
    sub = '${inr(n(r['amount']))}${r['status'] == 'active' ? ' · ${inr(n(r['outstanding']))} ${tr('still to repay')}' : ''}';
  } else {
    sub = '${inr(n(r['amount']))}${r['from'] != null ? ' · ${fmtD(r['from'], noYear: true)}' : ''}';
  }
  final waiting = ['pending', 'submitted', 'requested'].contains('${r['status']}');
  return Li('${r['title'] ?? type}',
      sub: sub,
      icon: switch (type) { 'leave' => Icons.beach_access_outlined, 'correction' => Icons.schedule, 'loan' => Icons.payments_outlined, _ => Icons.receipt_long_outlined },
      tone: waiting ? Tk.orange : Tk.label3,
      trailing: Pill(waiting ? tr('Waiting') : tr(_cap('${r['status']}')), tone: waiting ? Tk.orange : (r['status'] == 'approved' || r['status'] == 'active' || r['status'] == 'paid' ? Tk.green : Tk.label2)),
      onTap: waiting
          ? () async {
              if (!await confirm(context, 'Cancel this request?', '${r['title'] ?? type}: $sub', yes: 'Cancel request', danger: true)) return;
              try {
                await s.api.rpc('pay_me_cancel', {'p_type': type, 'p_id': r['id']});
                if (context.mounted) toast(context, tr('Cancelled'));
                await done();
              } on ApiError catch (e) {
                if (context.mounted) toast(context, e.message, err: true);
              }
            }
          : null);
}

String _cap(String s) => s.isEmpty ? s : s[0].toUpperCase() + s.substring(1).replaceAll('_', ' ');

class TodayPage extends StatefulWidget {
  const TodayPage(this.s, {required this.go, super.key});
  final PaySession s;
  final void Function(int tab) go;
  @override
  State<TodayPage> createState() => _TodayPageState();
}

class _TodayPageState extends State<TodayPage> {
  PaySession get s => widget.s;
  bool busy = false;

  Future<void> _punch() async {
    setState(() => busy = true);
    try {
      double? lat, lng, acc;
      final org = s.org;
      if (org['has_site'] == true && '${org['geofence']}' != 'off') {
        try {
          var perm = await Geolocator.checkPermission();
          if (perm == LocationPermission.denied) perm = await Geolocator.requestPermission();
          if (perm == LocationPermission.always || perm == LocationPermission.whileInUse) {
            final pos = await Geolocator.getCurrentPosition(locationSettings: const LocationSettings(accuracy: LocationAccuracy.high, timeLimit: Duration(seconds: 12)));
            lat = pos.latitude;
            lng = pos.longitude;
            acc = pos.accuracy;
          }
        } catch (_) {/* no location: the server decides what that means for this person */}
      }
      final r = await s.punchNow(lat: lat, lng: lng, accuracy: acc);
      if (!mounted) return;
      final t = fmtT(DateTime.now().toUtc().toIso8601String());
      toast(context, switch (r) {
        'offline' => '${tr('Saved on this phone at')} $t. ${tr('It will be sent when you are back online.')}',
        'duplicate' => tr('Already done a moment ago'),
        'in' => '${tr('Clocked in at')} $t',
        'out' => '${tr('Clocked out at')} $t',
        'in-away' => '${tr('Clocked in at')} $t. ${tr('You seem to be away from work, so your manager will see a note.')}',
        _ => '${tr('Clocked out at')} $t. ${tr('You seem to be away from work, so your manager will see a note.')}',
      });
    } on ApiError catch (e) {
      if (mounted) toast(context, e.message, err: true);
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Widget _punchCard() {
    final p = s.punch, open = p['open'] == true;
    final t = s.me['today'] is Map ? Map<String, dynamic>.from(s.me['today'] as Map) : const <String, dynamic>{};
    final punches = (s.me['punches'] as List?) ?? const [];
    final shift = p['shift'] != null ? '${p['shift']} · ${'${p['shift_start']}'.padLeft(5).substring(0, 5)} – ${'${p['shift_end']}'.padLeft(5).substring(0, 5)}' : null;
    final sub = [
      if (shift != null) shift,
      if (n(t['late_mins']) > 0) '${tr('Late by')} ${mins(n(t['late_mins']))}',
      if (n(t['worked_mins']) > 0 && !open) '${tr('Worked')} ${mins(n(t['worked_mins']))}',
    ].join(' · ');
    return Container(
      margin: const EdgeInsets.fromLTRB(16, 10, 16, 6),
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(color: Tk.card, borderRadius: BorderRadius.circular(24), border: Border.all(color: Tk.line, width: .5)),
      child: Column(children: [
        Text(open ? '${tr('Working since')} ${fmtT(p['in'])}' : (punches.isNotEmpty ? '${tr('Clocked out at')} ${fmtT(p['last'])}' : tr('Not clocked in yet')), style: TextStyle(fontSize: 16, color: Tk.label2)),
        const SizedBox(height: 14),
        SizedBox(
          width: 170,
          height: 170,
          child: FilledButton(
            key: const Key('punch'),
            onPressed: busy ? null : _punch,
            style: FilledButton.styleFrom(shape: const CircleBorder(), backgroundColor: open ? Tk.red : Tk.accent, padding: EdgeInsets.zero),
            child: busy
                ? const SizedBox(width: 30, height: 30, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 3))
                : Column(mainAxisAlignment: MainAxisAlignment.center, children: [
                    Icon(open ? Icons.logout : Icons.touch_app_outlined, size: 44, color: Colors.white),
                    const SizedBox(height: 6),
                    Text(open ? 'Clock out' : 'Clock in', style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800, color: Colors.white)),
                  ]),
          ),
        ),
        if (sub.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 12), child: Text(sub, textAlign: TextAlign.center, style: TextStyle(fontSize: 14, color: Tk.label2))),
        if (s.punchq.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 8), child: Text('${s.punchq.length} ${tr('waiting to send')}', style: TextStyle(fontSize: 14, color: Tk.orange, fontWeight: FontWeight.w700))),
      ]),
    );
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: s,
      builder: (ctx, _) {
        final d = s.me, e = s.employee;
        if (!s.hasEmployee) {
          return TabPage('Today', [
            emptyBox(Icons.badge_outlined, 'You are not set up as an employee yet', 'Ask your employer to add you in AUZsPay with this login.'),
            if (s.hr) Pad(FilledButton(onPressed: () => widget.go(4), child: const Text('Open the HR side'))),
          ], onRefresh: s.loadMe);
        }
        final first = '${e['name'] ?? ''}'.split(' ').first;
        final leave = ((d['leave'] as List?) ?? const []).map((x) => Map<String, dynamic>.from(x as Map)).where((l) => l['paid'] == true).toList();
        final left = leave.fold<double>(0, (a, l) => a + n(l['balance']));
        final slip = d['payslip'] is Map ? Map<String, dynamic>.from(d['payslip'] as Map) : null;
        final reqs = ((d['requests'] as List?) ?? const []).map((x) => Map<String, dynamic>.from(x as Map)).where((r) => ['pending', 'submitted', 'requested'].contains('${r['status']}')).toList();
        final notices = ((d['announcements'] as List?) ?? const []).map((x) => Map<String, dynamic>.from(x as Map)).toList();
        final hol = ((d['holidays'] as List?) ?? const []).map((x) => Map<String, dynamic>.from(x as Map)).toList();
        final pending = n(d['team_pending']).toInt();
        return TabPage('${tr('Hi')}, $first', [
          if (e['designation'] != null) Hint('${fmtD(d['date'], weekday: true)} · ${e['designation']}'),
          if (s.meOffline) const Note('You are offline. Showing your last saved day. Clock-ins are kept on this phone with the right time and sent when you are back online.', bad: true),
          if (e['status'] == 'exited') Note('${tr('Your last day was')} ${fmtD(e['last_day'])}. ${tr('Your payslips stay here.')}'),
          if (e['mode'] == 'punch' && s.active) _punchCard() else if (s.active) Group([Li(d['today'] is Map && (d['today'] as Map)['status'] != null ? tr(attLabel['${(d['today'] as Map)['status']}'] ?? 'A normal day') : tr('A normal day'), sub: e['mode'] == 'none' ? tr('Your attendance is not tracked') : tr('Your manager marks absences and leave'), icon: Icons.calendar_today_outlined, tone: Tk.blue, chevron: false)]),
          if (s.isManager && pending > 0) Note('$pending ${tr('requests from your team')}'),
          gap(),
          metricGrid([
            Metric('Leave left', '${qtyStr(left)} ${tr('days')}', onTap: () => widget.go(2)),
            Metric('Last pay', slip == null ? '—' : inr(n(slip['net'])), sub: slip == null ? tr('No payslip yet') : monthName(slip['month'], short: true), onTap: () => widget.go(3)),
            Metric('Waiting', '${reqs.length}', sub: reqs.isEmpty ? tr('Nothing waiting') : tr('Your requests'), onTap: () => widget.go(2)),
          ]),
          if (notices.isNotEmpty) ...[
            const SectionLabel('Notices'),
            Group([for (final a in notices) Li('${a['title']}', sub: [if ('${a['body'] ?? ''}'.isNotEmpty) '${a['body']}', fmtD(a['at'])].join('\n'), icon: Icons.campaign_outlined, tone: Tk.blue, chevron: false)]),
          ],
          if (reqs.isNotEmpty) ...[
            const SectionLabel('Your requests'),
            Group([for (final r in reqs.take(4)) requestRow(ctx, s, r, s.loadMe)]),
          ],
          if (hol.isNotEmpty) ...[
            const SectionLabel('Coming holidays'),
            Group([for (final x in hol.take(4)) Li('${x['name']}', value: fmtD(x['date'], weekday: true, noYear: true), icon: Icons.event_outlined, tone: Tk.label3, chevron: false)]),
          ],
        ], onRefresh: () async {
          await s.loadMe();
          await s.flushPunches();
        });
      },
    );
  }
}
