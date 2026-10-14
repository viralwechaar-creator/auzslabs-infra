import 'package:flutter/material.dart' hide Text;
import '../../core/session.dart';
import '../ds.dart';
import '../mk.dart';
import 'product_accounting.dart';
import 'product_common.dart';
import 'product_pos.dart';

/// "AUZsPay" (native equivalent of site/payroll.html): attendance, leave, salary and statutory
/// dues in one place -- staff see their own payslips, the owner sees the whole picture.
class ProductPayrollPage extends StatelessWidget {
  const ProductPayrollPage(this.s, {super.key});
  final HubSession s;

  @override
  Widget build(BuildContext context) => SubPage('AUZsPay', [
        productHero('AUZSPAY · PAYROLL', 'Payroll built around your business.', 'Attendance, leave, salary and statutory dues in one place, set up to match how your team actually works. Staff see their own payslips; you see the whole picture.'),
        const Note('AUZsPay is still in testing: sign up as an early tester and your first month, plus the one-time setup fee, is free.'),
        const SectionLabel("What's included"),
        productCard([
          includedRow('Attendance, already tracked', 'Staff clock in on their phone or a shared kiosk, even offline. Hours flow straight into the pay run.'),
          includedRow('Your salary rules', 'Salary structures, overtime, PF, ESI, PT and TDS, kept as dated rules you can see and change.'),
          includedRow('Leave, advances, claims', 'Leave requests and approvals, salary advances and loans, and expense claims, all settled in the same run.'),
          includedRow('A run you can trust', 'Calculate, review, approve, then finalise. A finished month is locked; corrections go in the next one.'),
          includedRow('Owner-only, by design', 'Managers see their team, staff see only themselves, and salary stays with you unless you choose to share it.'),
          includedRow('Reports that explain', 'Payslips, attendance, cost per person and statutory reports, ready to download whenever you need them.'),
        ]),
        const SectionLabel('Get AUZsPay'),
        LivePriceCard(s, 'payroll'),
        const SectionLabel('Pairs well with'),
        pairsWith([
          ('POS', () => ProductPosPage(s)),
          ('AUZsLedger', () => ProductAccountingPage(s)),
        ]),
        const SizedBox(height: 16),
      ]);
}
