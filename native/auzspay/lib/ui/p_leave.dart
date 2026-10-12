import 'package:flutter/material.dart' hide Text;
import '../core/api.dart';
import '../core/calc.dart';
import '../core/session.dart';
import 'ds.dart';
import 'i18n.dart';
import 'mk.dart';
import 'p_today.dart';

class LeavePage extends StatelessWidget {
  const LeavePage(this.s, {super.key});
  final PaySession s;

  void _apply(BuildContext context) {
    final types = ((s.me['leave_types'] as List?) ?? const []).map((x) => Map<String, dynamic>.from(x as Map)).toList();
    if (types.isEmpty) return toast(context, tr('No leave types are set up yet. Ask your manager.'), err: true);
    final bal = {for (final l in ((s.me['leave'] as List?) ?? const [])) '${(l as Map)['id']}': n(l['balance'])};
    var type = '${(types.firstWhere((t) => t['paid'] == true && (bal['${t['id']}'] ?? 0) > 0, orElse: () => types.first))['id']}';
    var half = 'none';
    final from = TextEditingController(text: ymd(DateTime.now().add(const Duration(days: 1)))), to = TextEditingController(), reason = TextEditingController();
    openSheet(context, 'Ask for leave', (ctx, set) {
      final t = types.firstWhere((x) => '${x['id']}' == type, orElse: () => types.first);
      return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Sel('Type', type, [for (final x in types) ('${x['id']}', '${x['name']}')], (v) => set(() => type = v)),
        Hint(t['paid'] == true ? '${qtyStr(bal[type] ?? 0)} ${tr('days left')}' : 'Unpaid: your salary is reduced for these days'),
        gap(),
        for (final (c, lbl) in [(from, 'First day'), if (half == 'none') (to, 'Last day')])
          Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: TextField(
              controller: c,
              readOnly: true,
              decoration: InputDecoration(labelText: tr(lbl)),
              onTap: () async {
                final d = await showDatePicker(context: ctx, initialDate: DateTime.tryParse(c.text) ?? DateTime.tryParse(from.text) ?? DateTime.now(), firstDate: DateTime.now().subtract(const Duration(days: 30)), lastDate: DateTime.now().add(const Duration(days: 365)));
                if (d != null) set(() => c.text = ymd(d));
              },
            ),
          ),
        Seg<String>(expand: true, items: const [('none', 'Full days'), ('first', 'Morning off'), ('second', 'Afternoon off')], value: half, onChanged: (v) => set(() => half = v)),
        gap(),
        Fld('Reason (optional)', reason, hint: 'For example: family wedding'),
      ]);
    }, actions: [
      SheetAction('Send', (ctx) async {
        try {
          final r = await s.api.rpc('pay_me_leave_apply', {'p': {'leave_type_id': type, 'from': from.text, 'to': half == 'none' ? (to.text.isEmpty ? from.text : to.text) : from.text, 'half': half, 'reason': reason.text}});
          await s.loadMe();
          if (context.mounted) toast(context, '${tr('Sent')}: ${qtyStr(n((r as Map)['days']))} ${tr('days asked')}');
          return true;
        } on ApiError catch (e) {
          if (ctx.mounted) toast(ctx, e.message, err: true);
          return false;
        }
      }),
    ]);
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: s,
      builder: (ctx, _) {
        final paid = ((s.me['leave'] as List?) ?? const []).map((x) => Map<String, dynamic>.from(x as Map)).where((l) => l['paid'] == true).toList();
        final reqs = ((s.me['requests'] as List?) ?? const []).map((x) => Map<String, dynamic>.from(x as Map)).where((r) => r['type'] == 'leave' || r['type'] == 'correction').toList();
        return TabPage('My leave', [
          if (s.active) Pad(FilledButton.icon(key: const Key('ask-leave'), onPressed: () => _apply(ctx), icon: const Icon(Icons.add), label: const Text('Ask for leave'))),
          if (paid.isEmpty) const Hint('You have no paid leave set up. You can still ask for unpaid leave.') else metricGrid([for (final l in paid) Metric('${l['name']}', qtyStr(n(l['balance'])), sub: '${tr('days left')}${n(l['used']) > 0 ? ' · ${qtyStr(n(l['used']))} ${tr('used')}' : ''}')]),
          const SectionLabel('Requests'),
          if (reqs.isEmpty) emptyBox(Icons.beach_access_outlined, 'No requests', 'Ask for leave and your manager gets it straight away.') else Group([for (final r in reqs) requestRow(ctx, s, r, s.loadMe)]),
        ], onRefresh: s.loadMe);
      },
    );
  }
}
