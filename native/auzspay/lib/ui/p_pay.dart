import 'package:flutter/material.dart' hide Text;
import 'package:image_picker/image_picker.dart';
import '../core/api.dart';
import '../core/calc.dart';
import '../core/session.dart';
import 'ds.dart';
import 'i18n.dart';
import 'kit.dart';
import 'lv.dart';
import 'mk.dart';
import 'p_today.dart';
import 'theme.dart';

class PayPage extends StatelessWidget {
  const PayPage(this.s, {super.key});
  final PaySession s;

  void _advance(BuildContext context, Future<void> Function() reload) => formSheet(context, 'Ask for an advance', [
        F('amount', 'Amount', type: 'number', hint: '₹'),
        F('emi', 'Repay each month (optional)', type: 'number', hint: 'All from the next salary'),
        F('reason', 'Reason (optional)'),
      ], (v) async {
        try {
          await s.api.rpc('pay_me_loan_request', {'p': v});
          if (context.mounted) toast(context, tr('Sent for approval'));
          await s.loadMe();
          await reload();
          return true;
        } on ApiError catch (e) {
          if (context.mounted) toast(context, e.message, err: true);
          return false;
        }
      }, saveLabel: 'Send');

  void _claim(BuildContext context, Future<void> Function() reload) {
    final masters = ((s.ctx['masters'] as List?) ?? const []).map((x) => Map<String, dynamic>.from(x as Map)).where((m) => m['kind'] == 'claim_type' && m['active'] == true).map((m) => '${m['name']}').toList();
    final cats = masters.isEmpty ? ['Travel', 'Food', 'Phone', 'Supplies', 'Other'] : masters;
    var cat = cats.first;
    var photoName = '';
    String? attachment;
    final amount = TextEditingController(), date = TextEditingController(text: todayStr()), desc = TextEditingController();
    openSheet(context, 'Claim an expense', (ctx, set) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Sel('What for', cat, [for (final c in cats) (c, c)], (v) => set(() => cat = v)),
          gap(8),
          Fld('Amount (₹)', amount, number: true),
          gap(8),
          Fld('Date (YYYY-MM-DD)', date),
          gap(8),
          Fld('Details (optional)', desc),
          gap(8),
          OutlinedButton.icon(
            icon: const Icon(Icons.add_a_photo_outlined),
            label: Text(photoName.isEmpty ? tr('Add a photo of the receipt') : photoName),
            onPressed: () async {
              final f = await ImagePicker().pickImage(source: ImageSource.gallery, maxWidth: 1600, imageQuality: 80);
              final emp = '${s.employee['id'] ?? ''}';
              if (f == null || emp.isEmpty) return;
              try {
                final path = await s.api.uploadDoc(await f.readAsBytes(), emp);
                set(() {
                  attachment = path;
                  photoName = f.name;
                });
              } on ApiError catch (e) {
                if (ctx.mounted) toast(ctx, e.message, err: true);
              }
            },
          ),
        ]), actions: [
      SheetAction('Send', (ctx) async {
        try {
          await s.api.rpc('pay_me_claim', {'p': claimPayload(category: cat, amount: amount.text, date: date.text, description: desc.text, attachment: attachment)});
          if (context.mounted) toast(context, tr('Claim sent'));
          await s.loadMe();
          await reload();
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
    return Loader<List<Map<String, dynamic>>>(
      load: () async => ((await s.api.rpc('pay_me_payslips')) as List).map((e) => Map<String, dynamic>.from(e as Map)).toList(),
      builder: (ctx, list, reload) {
        final money = ((s.me['requests'] as List?) ?? const []).map((x) => Map<String, dynamic>.from(x as Map)).where((r) => r['type'] == 'loan' || r['type'] == 'claim').toList();
        return TabPage('My pay', [
          if (list.isNotEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
              child: Metric('${list.first['title']}', inr(n(list.first['net'])), sub: '${list.first['paid'] == true ? tr('Paid') : tr('Being paid')}${list.first['pay_date'] != null ? ' · ${fmtD(list.first['pay_date'])}' : ''} · ${tr('tap to see the payslip')}', hero: true, onTap: () => Navigator.push(ctx, MaterialPageRoute(builder: (_) => PayslipPage(s, '${list.first['id']}')))),
            ),
          if (list.isEmpty) emptyBox(Icons.account_balance_wallet_outlined, 'No payslips yet', 'Your payslip shows here as soon as your employer finalises the payroll.') else ...[
            const SectionLabel('Payslips'),
            Group([for (final x in list) Li('${x['title']}', sub: '${tr('Earned')} ${inr(n(x['gross']))} · ${tr('deducted')} ${inr(n(x['deductions']))}', value: inr(n(x['net'])), icon: Icons.description_outlined, tone: Tk.accent, onTap: () => Navigator.push(ctx, MaterialPageRoute(builder: (_) => PayslipPage(s, '${x['id']}'))))]),
          ],
          const SectionLabel('Advances and claims'),
          Group([
            if (s.employee['status'] == 'active') Li('Ask for a salary advance', sub: 'Repaid from your next salaries', icon: Icons.payments_outlined, tone: Tk.green, onTap: () => _advance(ctx, reload)),
            Li('Claim an expense', sub: 'Travel, food or anything you paid for work', icon: Icons.receipt_long_outlined, tone: Tk.orange, onTap: () => _claim(ctx, reload)),
            for (final r in money) requestRow(ctx, s, r, () async {
              await s.loadMe();
              await reload();
            }),
          ]),
        ], onRefresh: () async {
          await s.loadMe();
          await reload();
        });
      },
    );
  }
}

class PayslipPage extends StatelessWidget {
  const PayslipPage(this.s, this.id, {super.key});
  final PaySession s;
  final String id;
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Payslip')),
      body: Loader<Map<String, dynamic>>(
        load: () async => Map<String, dynamic>.from(await s.api.rpc('pay_get_item', {'p_id': id}) as Map),
        builder: (ctx, d, _) {
          final it = Map<String, dynamic>.from(d['item'] as Map), run = Map<String, dynamic>.from(d['run'] as Map);
          final att = it['att'] is Map ? Map<String, dynamic>.from(it['att'] as Map) : const <String, dynamic>{};
          final lines = ((d['lines'] as List?) ?? const []).map((x) => Map<String, dynamic>.from(x as Map)).toList();
          final earn = lines.where((l) => l['kind'] == 'earning' || l['kind'] == 'reimbursement').toList(), ded = lines.where((l) => l['kind'] == 'deduction').toList();
          Widget block(List<Map<String, dynamic>> rows, num total, String label) => Group([
                for (final l in rows) Li('${l['name']}', sub: '${l['calc'] ?? ''}'.isEmpty ? null : '${l['calc']}', value: inr(n(l['amount'])), chevron: false),
                Li(label, value: inr(total), chevron: false, titleColor: Tk.label),
              ]);
          return ListView(padding: const EdgeInsets.only(bottom: 40), children: [
            Pad(Text('${(d['org'] as Map?)?['name'] ?? ''}', style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800))),
            Hint('${run['title']}${'${it['payslip_no'] ?? ''}'.isEmpty ? '' : ' · ${it['payslip_no']}'}'),
            Padding(padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8), child: Metric('Net pay', inr(n(it['net'])), hero: true)),
            if (att['paid_days'] != null)
              Pad(Wrap(spacing: 8, runSpacing: 6, children: [
                Pill('${qtyStr(n(att['paid_days']))}${att['divisor'] != null ? '/${qtyStr(n(att['divisor']))}' : ''} ${tr('days paid')}', tone: Tk.green),
                if (n(att['lop_days']) > 0) Pill('${qtyStr(n(att['lop_days']))} ${tr('unpaid days')}', tone: Tk.red),
                if (n(att['leave_paid']) > 0) Pill('${qtyStr(n(att['leave_paid']))} ${tr('paid leave')}', tone: Tk.blue),
                if (n(att['ot_hours']) > 0) Pill('${qtyStr(n(att['ot_hours']))} ${tr('overtime hours')}', tone: Tk.orange),
              ])),
            const SectionLabel('Earnings'),
            block(earn, n(it['gross']), 'Gross pay'),
            const SectionLabel('Deductions'),
            if (ded.isEmpty) const Hint('None') else block(ded, n(it['deductions']), 'Total deductions'),
            if (d['ytd'] is Map) Hint('${tr('This financial year so far')}: ${tr('gross')} ${inr(n((d['ytd'] as Map)['gross']), dp: 0)}, ${tr('net')} ${inr(n((d['ytd'] as Map)['net']), dp: 0)}, ${tr('tax')} ${inr(n((d['ytd'] as Map)['tds']), dp: 0)}'),
          ]);
        },
      ),
    );
  }
}
