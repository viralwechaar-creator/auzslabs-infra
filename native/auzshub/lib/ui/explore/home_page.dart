import 'package:flutter/material.dart' hide Text;
import '../../core/launcher.dart';
import '../../core/session.dart';
import '../ds.dart';
import '../i18n.dart';
import '../mk.dart';
import '../pricing.dart';
import '../theme.dart';
import 'why_page.dart';

/// "AUZslab" (native equivalent of site/index.html): the homepage's own hero framing, its
/// "how we work" steps and the connected-platform pitch -- the real copy, laid out as a clean
/// native screen instead of the site's scroll-animated fx-worlds panels.
class HomePage extends StatelessWidget {
  const HomePage(this.s, {super.key});
  final HubSession s;

  Widget _hero() => Container(
        margin: const EdgeInsets.fromLTRB(16, 10, 16, 6),
        padding: const EdgeInsets.all(20),
        decoration: BoxDecoration(color: Tk.accent, borderRadius: BorderRadius.circular(22)),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const Text('BUSINESS SOFTWARE, BUILT DIFFERENTLY', style: TextStyle(color: Colors.white70, fontWeight: FontWeight.w800, fontSize: 12, letterSpacing: 1.1)),
          const SizedBox(height: 10),
          const Text('Software built around the way you work.', style: TextStyle(color: Colors.white, fontSize: 26, fontWeight: FontWeight.w800, height: 1.15, letterSpacing: -.4)),
          const SizedBox(height: 10),
          Text('Sales, stock, accounts and people in one connected system, shaped to your workflow, not a rigid template.', style: TextStyle(color: Colors.white.withValues(alpha: .88), fontSize: 15, height: 1.35)),
        ]),
      );

  Widget _card(String eyebrow, String title, String body) => Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
        child: Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(color: Tk.card, borderRadius: BorderRadius.circular(18), border: Border.all(color: Tk.line, width: .5)),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(eyebrow, style: TextStyle(color: Tk.label2, fontSize: 12, fontWeight: FontWeight.w800, letterSpacing: .6)),
            const SizedBox(height: 4),
            Text(title, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
            const SizedBox(height: 6),
            Text(body, style: TextStyle(color: Tk.label2, fontSize: 14.5, height: 1.4)),
          ]),
        ),
      );

  Widget _ctaCard(BuildContext context, String title, String sub, IconData icon, Color tone, VoidCallback onTap) => Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
        child: Material(
          color: Tk.card,
          borderRadius: BorderRadius.circular(18),
          child: InkWell(
            borderRadius: BorderRadius.circular(18),
            onTap: onTap,
            child: Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(borderRadius: BorderRadius.circular(18), border: Border.all(color: Tk.line, width: .5)),
              child: Row(children: [
                Container(width: 46, height: 46, decoration: BoxDecoration(color: tone, borderRadius: BorderRadius.circular(13)), child: Icon(icon, color: Colors.white, size: 24)),
                const SizedBox(width: 14),
                Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(title, style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700)),
                  Padding(padding: const EdgeInsets.only(top: 2), child: Text(sub, style: TextStyle(color: Tk.label2, fontSize: 14))),
                ])),
                Icon(Icons.chevron_right, color: Tk.label3, size: 26),
              ]),
            ),
          ),
        ),
      );

  @override
  Widget build(BuildContext context) => SubPage('AUZslab', [
        _hero(),
        const SectionLabel('Every business works differently'),
        const Hint('Your software should understand that.'),
        _card('01 · Start', 'A powerful core, ready on day one', 'Billing, stock, accounts, payroll and customers, ready from the moment you sign up.'),
        _card('02 · Shape', 'Set up the way you run things', 'Roles, approvals, rules, reports and branding set to how your business actually works. Anything more, we build.'),
        _card('03 · Grow', 'We keep improving it with you', "We don't just hand over a login. We set it up with you and keep improving it as you grow."),
        const SectionLabel('One platform, built around you'),
        _card('Connected', 'Every part, connected', 'Sales, stock, accounts, payroll and customers share one set of data, so every part of the business sees the same picture.'),
        const SectionLabel('AUZslab Intelligence'),
        _card('Built in', "Don't just see your business. Understand it.", 'Your software records what happened. Intelligence shows what it means: sales trends and busy hours, stock and margins, staff results and regulars, all from the data you already have.'),
        const SectionLabel('See for yourself'),
        _ctaCard(context, 'Why AUZslab', 'Businesses differ. Software should too.', Icons.lightbulb_outline, Tk.orange, () => Navigator.push(context, MaterialPageRoute<void>(builder: (_) => WhyAuzslabPage(s)))),
        _ctaCard(context, 'Products and pricing', 'See what each product does and costs, with live prices', Icons.sell_outlined, Tk.green, () => Navigator.push(context, MaterialPageRoute<void>(builder: (_) => ProductsPricingPage(s)))),
        _ctaCard(context, 'Visit the full website', 'Demos, every product page and more, in your browser', Icons.public, Tk.blue, () => openSite(s, '')),
        const SizedBox(height: 16),
      ]);
}
