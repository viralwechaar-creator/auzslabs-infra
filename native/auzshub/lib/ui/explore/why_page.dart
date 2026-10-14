import 'package:flutter/material.dart' hide Text;
import '../../core/launcher.dart';
import '../../core/session.dart';
import '../ds.dart';
import '../i18n.dart';
import '../mk.dart';
import '../pricing.dart';
import '../theme.dart';

/// "Why AUZslab" (native equivalent of site/platform.html): the platform pitch -- one adaptable
/// core instead of a one-size-fits-all system, a business-type page for each kind of business,
/// how onboarding actually goes, and why the business stays independent of AUZslab.
class WhyAuzslabPage extends StatelessWidget {
  const WhyAuzslabPage(this.s, {super.key});
  final HubSession s;

  Widget _hero() => Container(
        margin: const EdgeInsets.fromLTRB(16, 10, 16, 6),
        padding: const EdgeInsets.all(20),
        decoration: BoxDecoration(color: Tk.accent, borderRadius: BorderRadius.circular(22)),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const Text('WHY AUZSLAB', style: TextStyle(color: Colors.white70, fontWeight: FontWeight.w800, fontSize: 12, letterSpacing: 1.1)),
          const SizedBox(height: 10),
          const Text('Businesses differ. Software should too.', style: TextStyle(color: Colors.white, fontSize: 26, fontWeight: FontWeight.w800, height: 1.15, letterSpacing: -.4)),
          const SizedBox(height: 10),
          Text('Most business software asks every business to work the same way. AUZslab is built on a different idea: a powerful core that adapts to the business using it.', style: TextStyle(color: Colors.white.withValues(alpha: .88), fontSize: 15, height: 1.35)),
        ]),
      );

  Widget _card(List<Widget> kids) => Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
        child: Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(color: Tk.card, borderRadius: BorderRadius.circular(18), border: Border.all(color: Tk.line, width: .5)),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: kids),
        ),
      );

  Widget _twoUp(String leftLabel, String leftBody, String rightLabel, String rightBody) => Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Expanded(child: _plain(leftLabel, leftBody)),
          const SizedBox(width: 12),
          Expanded(child: _plain(rightLabel, rightBody)),
        ]),
      );

  Widget _plain(String label, String body) => Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(label, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w800)),
        const SizedBox(height: 6),
        Text(body, style: TextStyle(color: Tk.label2, fontSize: 13.5, height: 1.4)),
      ]);

  Widget _bizLink(String name, String tag, String blurb) => Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 5),
        child: Material(
          color: Tk.card,
          borderRadius: BorderRadius.circular(16),
          child: InkWell(
            borderRadius: BorderRadius.circular(16),
            onTap: () {}, // business-type pages are a later native pass; this page stays text-only for now
            child: Container(
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(borderRadius: BorderRadius.circular(16), border: Border.all(color: Tk.line, width: .5)),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Pill(tag),
                const SizedBox(height: 8),
                Text(name, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800)),
                const SizedBox(height: 4),
                Text(blurb, style: TextStyle(color: Tk.label2, fontSize: 13.5, height: 1.35)),
              ]),
            ),
          ),
        ),
      );

  @override
  Widget build(BuildContext context) => SubPage('Why AUZslab', [
        _hero(),
        const SectionLabel('The idea'),
        _twoUp('Traditional software', 'One system for everyone. Your team bends its routine to fit the screens, and the gaps end up in spreadsheets.', 'AUZslab', 'One connected core, shaped to you: roles, approvals, rules, reports and your own branding. Where you need more, we build it.'),
        const SectionLabel('Powerful at the core. Simple on the surface.'),
        _card([Text('Sales, stock, accounts, payroll and customers share one set of data, so every part of the business sees the same picture, and AUZslab Intelligence can explain what it means.', style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700, height: 1.35))]),
        const SectionLabel('Built for your kind of business'),
        const Hint('Each one gets its own page: what actually works for it, not a generic pitch.'),
        _bizLink('Cafes, restaurants, bars, bakeries and hotels', 'Hospitality', 'Floor plan, kitchen tickets, ingredient stock, GST billing, QR self-order.'),
        _bizLink('Clothing & apparel', 'Size/colour stock, trial room, returns', 'Barcode-per-variant billing, a trial-room queue, exchanges against the original invoice.'),
        _bizLink('Retail & bookstores', 'Stock, barcode billing & loyalty', "Shoe shops, bookstores and general retail -- know what's on the shelf, bill in seconds, bring customers back on purpose."),
        _bizLink('Salons & spas', 'Client profiles & loyalty', "Every client's history, retail product stock, and staff pay, from one account."),
        _bizLink('Mobile retail & repair', 'IMEI stock, repair tickets & staff isolation', "Sell phones and accessories, track every repair job, and keep each staffer's sales and work visible to the owner only."),
        const SectionLabel('How it works'),
        _card([
          _step('01', 'Tell us how you work', 'What you run, and which modules you want, from the product list or just in your own words.'),
          const SizedBox(height: 12),
          _step('02', 'We shape your setup', 'Your own business address, an owner login, and a setup built around your business type, roles and rules.'),
          const SizedBox(height: 12),
          _step('03', 'We keep improving it', 'You can be selling the same day. After that we stay: customisation, integrations and improvements as you grow.'),
        ]),
        const SectionLabel('Independent by design'),
        _twoUp('Your data', 'Your data belongs to you, and we look after it for you.', 'Your terms', "No third-party outage takes your business down with it. Works offline, too: a sale saves to the device first and syncs the moment you're back online."),
        const SectionLabel('Ready?'),
        _card([
          const Text("Let's build the right system for your business.", style: TextStyle(fontSize: 17, fontWeight: FontWeight.w800)),
          const SizedBox(height: 12),
          SizedBox(width: double.infinity, child: FilledButton(onPressed: () => Navigator.push(context, MaterialPageRoute<void>(builder: (_) => ProductsPricingPage(s))), child: const Text('See all products'))),
          const SizedBox(height: 8),
          SizedBox(width: double.infinity, child: OutlinedButton(onPressed: () => openSite(s, 'contact.html'), child: const Text("Let's talk"))),
        ]),
        const SizedBox(height: 16),
      ]);

  Widget _step(String no, String title, String body) => Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(no, style: TextStyle(fontSize: 22, fontWeight: FontWeight.w800, color: Tk.label3)),
        const SizedBox(width: 12),
        Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(title, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w800)),
          const SizedBox(height: 4),
          Text(body, style: TextStyle(color: Tk.label2, fontSize: 13.5, height: 1.4)),
        ])),
      ]);
}
