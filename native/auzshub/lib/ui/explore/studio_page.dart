import 'package:flutter/material.dart' hide Text;
import 'package:url_launcher/url_launcher.dart';
import '../../core/launcher.dart';
import '../../core/session.dart';
import '../ds.dart';
import '../i18n.dart';
import '../mk.dart';
import '../pricing.dart';
import '../theme.dart';

/// "AUZslab Studio" (native equivalent of `site/studio.html`): bespoke software, built from a
/// blank page around the business, scoped and quoted per project. Deliberately not a cart item --
/// there is no price list here and nothing to add to a cart, only "tell us what you need".
class StudioPage extends StatelessWidget {
  const StudioPage(this.s, {super.key});
  final HubSession s;

  Widget _hero() => Container(
        margin: const EdgeInsets.fromLTRB(16, 10, 16, 6),
        padding: const EdgeInsets.all(20),
        decoration: BoxDecoration(color: Tk.accent, borderRadius: BorderRadius.circular(22)),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const Text('AUZSLAB STUDIO · PREMIUM', style: TextStyle(color: Colors.white70, fontWeight: FontWeight.w800, fontSize: 12, letterSpacing: 1.1)),
          const SizedBox(height: 10),
          const Text('Design it the way you love.', style: TextStyle(color: Colors.white, fontSize: 26, fontWeight: FontWeight.w800, height: 1.15, letterSpacing: -.4)),
          const SizedBox(height: 10),
          Text('We don\'t hand you a rigid system and ask you to fit into it. In Studio we start from a blank page and shape the software around your business: your screens, your flow, your look, in your own private workspace.', style: TextStyle(color: Colors.white.withValues(alpha: .88), fontSize: 15, height: 1.35)),
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

  Widget _chips(List<String> items) => Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
        child: Wrap(spacing: 8, runSpacing: 8, children: [for (final c in items) Pill(c, tone: Tk.accent)]),
      );

  Widget _step(String no, String title, String body) => Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(no, style: TextStyle(fontSize: 22, fontWeight: FontWeight.w800, color: Tk.label3)),
        const SizedBox(width: 12),
        Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(title, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w800)),
          const SizedBox(height: 4),
          Text(body, style: TextStyle(color: Tk.label2, fontSize: 13.5, height: 1.4)),
        ])),
      ]);

  Widget _bullets(List<String> items) => Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        for (final b in items)
          Padding(
            padding: const EdgeInsets.only(bottom: 6),
            child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('•  ', style: TextStyle(color: Tk.label2, fontSize: 14)),
              Expanded(child: Text(b, style: TextStyle(color: Tk.label2, fontSize: 14, height: 1.4))),
            ]),
          ),
      ]);

  @override
  Widget build(BuildContext context) => SubPage('AUZslab Studio', [
        _hero(),
        const SectionLabel('A box, or a blank page'),
        const Hint('Most software is a box. Studio is a blank page.'),
        _twoUp('The rigid system', 'Same screens for everyone. You change how you work to match the software.', 'Your Studio build', 'The software changes to match how you work: screens, steps, reports and branding decided with you, scoped and quoted per project.'),
        const SectionLabel('You decide'),
        const Hint('Everything here is yours to shape.'),
        _chips(const ['Screens', 'Steps & flow', 'Colours', 'Logo & name', 'Reports', 'The words you use', 'Staff roles', 'Receipts & bills', 'Your public site', 'What stays out']),
        const SectionLabel('How it works'),
        const Hint('From a rough idea to your own workspace.'),
        _card([
          _step('1', 'Tell us what feels wrong', 'A call or message about how you run, and what no software does for you.'),
          const SizedBox(height: 12),
          _step('2', 'Scope and quote', 'We write down what we will build and what it costs, before any work starts.'),
          const SizedBox(height: 12),
          _step('3', 'Sketch it together', 'You see how it looks and flows, and change it freely before we build.'),
          const SizedBox(height: 12),
          _step('4', 'Build in pieces', 'You try working pieces as they are finished, not one big reveal at the end.'),
          const SizedBox(height: 12),
          _step('5', 'Live in your workspace', 'It opens at your own address with your staff signed in and your data in place.'),
        ]),
        const SectionLabel('Your own workspace'),
        const Hint('Your space, kept apart from everyone else\'s: yourname.auzslab.in'),
        _card([
          _bullets(const [
            'Its own address, name, logo and colours.',
            'Its own data, separate from every other business.',
            'Its own owner and staff logins.',
            'Hosting, backups and updates are looked after by us.',
            'Can connect to AUZsPay payroll and AUZsLedger accounting when you add them.',
            'WhatsApp bill sharing where it fits your workflow.',
          ]),
        ]),
        const SectionLabel('It has been done'),
        _card([
          const Text('Showoff Salon wanted something different.', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w800)),
          const SizedBox(height: 8),
          Text('Their own look, a 67-service menu, online booking, WhatsApp invoices and an admin console for the team, in their own private workspace. It runs live today and became the base of our Salon product.', style: TextStyle(color: Tk.label2, fontSize: 14, height: 1.4)),
          const SizedBox(height: 12),
          SizedBox(width: double.infinity, child: OutlinedButton(onPressed: () => launchUrl(Uri.parse('https://showoffsalon.auzslab.in'), mode: LaunchMode.externalApplication), child: const Text('Visit Showoff Salon'))),
        ]),
        const SectionLabel('Billed separately, based on the work'),
        const Hint('There is no price list here and nothing to add to a cart.'),
        _card([
          _plain('Quote', 'Each project is priced from its own scope. There is no price list and nothing to add to a cart.'),
          const SizedBox(height: 12),
          _plain('Agreed first', 'Scope, price and payment milestones are written down and agreed before work starts.'),
          const SizedBox(height: 12),
          _plain('Separate', 'Studio work is billed on its own, apart from any standard AUZslab subscription you also use.'),
        ]),
        const SectionLabel('Is it for you?'),
        _twoUp(
          'Studio fits if…',
          'Your process does not match any standard product. You want a look and workflow that is yours. You plan to run it for years and want it built properly.',
          'A ready-made product is better if…',
          'You run a cafe, salon, retail or mobile shop the usual way, or need to be live today. See our ready-made plans instead.',
        ),
        _card([
          SizedBox(width: double.infinity, child: OutlinedButton(onPressed: () => Navigator.push(context, MaterialPageRoute<void>(builder: (_) => ProductsPricingPage(s))), child: const Text('See ready-made plans and pricing'))),
        ]),
        const SectionLabel('Questions'),
        _card([
          _plain('How much does it cost?', 'It depends on the work. We scope your project, give you a written quote, and bill it separately.'),
          const SizedBox(height: 12),
          _plain('Do I own my data?', 'Yes. Your data sits in your own private workspace, kept apart from other businesses, and you can export it.'),
          const SizedBox(height: 12),
          _plain('Can you add to it later?', 'Yes. New features are scoped and quoted the same way, as separate work.'),
        ]),
        const SectionLabel('Tell us what you would love'),
        _card([
          const Text('Describe what you love, and we\'ll tell you what it takes to build it.', style: TextStyle(fontSize: 17, fontWeight: FontWeight.w800)),
          const SizedBox(height: 12),
          SizedBox(width: double.infinity, child: FilledButton(onPressed: () => openSite(s, 'contact.html'), child: const Text('Describe what you love'))),
        ]),
        const SizedBox(height: 16),
      ]);
}
