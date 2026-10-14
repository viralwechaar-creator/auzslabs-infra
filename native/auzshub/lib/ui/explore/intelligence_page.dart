import 'package:flutter/material.dart' hide Text;
import '../../core/launcher.dart';
import '../../core/session.dart';
import '../ds.dart';
import '../i18n.dart';
import '../mk.dart';
import '../theme.dart';

/// "AUZslab Intelligence" (native equivalent of `site/intelligence.html`): six views built from
/// data the apps already record (console dashboards, alerts, CRM segments, payroll/ledger
/// reports), labelled "Example insight" where the site shows an example. There is NO automatic
/// natural-language insight or anomaly engine yet -- this page must not claim one. Keep every
/// claim here matched to a feature that already exists.
class IntelligencePage extends StatelessWidget {
  const IntelligencePage(this.s, {super.key});
  final HubSession s;

  Widget _hero() => Container(
        margin: const EdgeInsets.fromLTRB(16, 10, 16, 6),
        padding: const EdgeInsets.all(20),
        decoration: BoxDecoration(color: Tk.accent, borderRadius: BorderRadius.circular(22)),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const Text('AUZSLAB INTELLIGENCE', style: TextStyle(color: Colors.white70, fontWeight: FontWeight.w800, fontSize: 12, letterSpacing: 1.1)),
          const SizedBox(height: 10),
          const Text('Your business generates data. We help you understand it.', style: TextStyle(color: Colors.white, fontSize: 25, fontWeight: FontWeight.w800, height: 1.15, letterSpacing: -.4)),
          const SizedBox(height: 10),
          Text('Every sale, purchase, expense, shift and stock movement already lands in one place. Intelligence turns it into clear answers and better decisions.', style: TextStyle(color: Colors.white.withValues(alpha: .88), fontSize: 15, height: 1.35)),
        ]),
      );

  Widget _step(String no, String title, String body) => Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(no, style: TextStyle(fontSize: 22, fontWeight: FontWeight.w800, color: Tk.label3)),
          const SizedBox(width: 12),
          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(title, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800)),
            const SizedBox(height: 4),
            Text(body, style: TextStyle(color: Tk.label2, fontSize: 14, height: 1.4)),
          ])),
        ]),
      );

  Widget _view(String title, List<String> items) => Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
        child: Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(color: Tk.card, borderRadius: BorderRadius.circular(18), border: Border.all(color: Tk.line, width: .5)),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(title, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800)),
            const SizedBox(height: 8),
            for (final it in items)
              Padding(
                padding: const EdgeInsets.only(bottom: 4),
                child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text('•  ', style: TextStyle(color: Tk.label2, fontSize: 14)),
                  Expanded(child: Text(it, style: TextStyle(color: Tk.label2, fontSize: 14, height: 1.35))),
                ]),
              ),
          ]),
        ),
      );

  Widget _insight(String text) => Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
        child: Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(color: Tk.card, borderRadius: BorderRadius.circular(16), border: Border.all(color: Tk.line, width: .5)),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Pill('Example insight', tone: Tk.purple),
            const SizedBox(height: 10),
            Text(text, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600)),
          ]),
        ),
      );

  Widget _builtIn(String title, String body) => Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(title, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w800)),
          const SizedBox(height: 6),
          Text(body, style: TextStyle(color: Tk.label2, fontSize: 13.5, height: 1.4)),
        ]),
      );

  @override
  Widget build(BuildContext context) => SubPage('AUZslab Intelligence', [
        _hero(),
        const SectionLabel('From activity to understanding'),
        const Hint('Traditional software says "here are your numbers". AUZslab shows what changed, why it matters, and what to look at.'),
        _step('01', 'Business activity', 'Bills, purchases, expenses, attendance, stock moves.'),
        _step('02', 'Connected data', 'One system, so a sale already knows its stock, cost and staff member.'),
        _step('03', 'Insight, then action', 'Alerts and summaries that point you to what needs a look today.'),
        const SectionLabel('Six views of one business'),
        const Hint('What it looks at.'),
        _view('Sales', const ['Today against yesterday', 'Busy hours and quiet ones', 'Best and slowest sellers', 'Revenue by channel and payment']),
        _view('Inventory', const ['Low and sold-out stock', 'Items close to expiry', 'Reorder points', 'Wastage and stock changes']),
        _view('Profit', const ['Margins by item, from recipe costs', 'Expenses against revenue', 'Discounts, voids and refunds', 'Cash expected in the drawer']),
        _view('Staff', const ['Sales per biller', 'Profit per staff member (AUZsMob)', 'Attendance and hours', 'Every void and approval, logged']),
        _view('Customers', const ['New, regular and lapsed customers', 'Visit and spend history', 'Dues to collect', 'Birthdays and memberships ending']),
        _view('Operations', const ['Kitchen and order timings', 'Tasks running late', 'Bills waiting to sync', 'One activity log for the whole day']),
        const SectionLabel('What Intelligence can surface'),
        const Hint('Less time searching reports. More time acting on what matters.'),
        _insight('Sales are up on yesterday at the same hour.'),
        _insight('5 items are low on stock and 2 are sold out.'),
        _insight('Discounts and voids took a bigger share of revenue this week.'),
        _insight('Saturday evening is still your busiest window.'),
        _insight('Expenses grew faster than sales this month.'),
        _insight('12 regulars haven\'t visited in a while.'),
        const Hint('Examples of the kind of thing you will see. They are not real customer results.'),
        const SectionLabel('Built in, not bolted on'),
        _builtIn('Inside the apps you already use', 'Intelligence lives in AUZsPOS, AUZsLedger, AUZsPay and AUZsMob: on the dashboard, in alerts and in reports. No separate tool to learn.'),
        _builtIn('Fewer dashboards, not more', 'It is there to reduce complexity. When nothing needs attention, it says so.'),
        const SectionLabel('See it on your own numbers'),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
          child: Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(color: Tk.card, borderRadius: BorderRadius.circular(18), border: Border.all(color: Tk.line, width: .5)),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              const Text('Tell us how your business works.', style: TextStyle(fontSize: 17, fontWeight: FontWeight.w800)),
              const SizedBox(height: 12),
              SizedBox(width: double.infinity, child: FilledButton(onPressed: () => openSite(s, 'contact.html'), child: const Text("Let's talk"))),
              const SizedBox(height: 8),
              SizedBox(width: double.infinity, child: OutlinedButton(onPressed: () => openSite(s, 'live-demo.html'), child: const Text('Try the live demo'))),
            ]),
          ),
        ),
        const SizedBox(height: 16),
      ]);
}
