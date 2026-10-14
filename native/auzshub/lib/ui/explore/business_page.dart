import 'package:flutter/material.dart' hide Text;
import '../../core/launcher.dart';
import '../../core/session.dart';
import '../ds.dart';
import '../i18n.dart';
import '../mk.dart';
import '../pricing.dart';
import '../theme.dart';

/// "Built for your business" (native equivalent of the 5 `site/business-*.html` pages): a table of
/// contents over the five business types, each its own native screen, same hero/struggle/feature
/// shape `home_page.dart`/`why_page.dart` already use.
class BusinessTypesHubPage extends StatelessWidget {
  const BusinessTypesHubPage(this.s, {super.key});
  final HubSession s;

  @override
  Widget build(BuildContext context) => SubPage('Built for your business', [
        _hero(),
        const SectionLabel('Pick your kind of business'),
        const Hint('Each one gets its own setup: what actually works for it, not a generic pitch.'),
        Group([
          Li('Cafés, restaurants, bars & bakeries', sub: 'Tables, kitchen tickets, GST billing, QR self-order', icon: Icons.local_cafe_outlined, tone: Tk.teal, onTap: () => _open(context, CafesPage(s))),
          Li('Salons & spas', sub: 'Online booking, branded invoices, client history', icon: Icons.content_cut_outlined, tone: Tk.blue, onTap: () => _open(context, SalonsPage(s))),
          Li('Retail & bookstores', sub: 'Barcode billing, stock, loyalty', icon: Icons.storefront_outlined, tone: Tk.purple, onTap: () => _open(context, RetailPage(s))),
          Li('Clothing & apparel', sub: 'Size/colour stock, trial room, returns', icon: Icons.checkroom_outlined, tone: Tk.orange, onTap: () => _open(context, ClothingPage(s))),
          Li('Mobile retail & repair', sub: 'IMEI stock, repair tickets, staff isolation', icon: Icons.phone_iphone_outlined, tone: Tk.green, onTap: () => _open(context, MobileRepairPage(s))),
        ]),
        const SizedBox(height: 16),
      ]);

  void _open(BuildContext context, Widget page) => Navigator.push(context, MaterialPageRoute<void>(builder: (_) => page));

  Widget _hero() => Container(
        margin: const EdgeInsets.fromLTRB(16, 10, 16, 6),
        padding: const EdgeInsets.all(20),
        decoration: BoxDecoration(color: Tk.accent, borderRadius: BorderRadius.circular(22)),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const Text('BUSINESS TYPES', style: TextStyle(color: Colors.white70, fontWeight: FontWeight.w800, fontSize: 12, letterSpacing: 1.1)),
          const SizedBox(height: 10),
          const Text('Cafés, salons, retail, clothing and mobile repair shops, each shown its own way.', style: TextStyle(color: Colors.white, fontSize: 24, fontWeight: FontWeight.w800, height: 1.15, letterSpacing: -.4)),
          const SizedBox(height: 10),
          Text('Same connected core underneath, set up around how your kind of business actually runs.', style: TextStyle(color: Colors.white.withValues(alpha: .88), fontSize: 15, height: 1.35)),
        ]),
      );
}

/// Shared layout pieces for the five business-type detail pages below -- the same shape
/// `home_page.dart`/`why_page.dart` already use (hero, feature card, two-up struggle, closer).
Widget bizHero(String eyebrow, String title, String body) => Container(
      margin: const EdgeInsets.fromLTRB(16, 10, 16, 6),
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(color: Tk.accent, borderRadius: BorderRadius.circular(22)),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(eyebrow, style: const TextStyle(color: Colors.white70, fontWeight: FontWeight.w800, fontSize: 12, letterSpacing: 1.1)),
        const SizedBox(height: 10),
        Text(title, style: const TextStyle(color: Colors.white, fontSize: 26, fontWeight: FontWeight.w800, height: 1.15, letterSpacing: -.4)),
        const SizedBox(height: 10),
        Text(body, style: TextStyle(color: Colors.white.withValues(alpha: .88), fontSize: 15, height: 1.35)),
      ]),
    );

Widget bizStruggle(String leftTitle, String leftBody, String rightTitle, String rightBody) => Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Expanded(child: _struggleCard(leftTitle, leftBody)),
        const SizedBox(width: 12),
        Expanded(child: _struggleCard(rightTitle, rightBody)),
      ]),
    );

Widget _struggleCard(String title, String body) => Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Text(title, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w800)),
      const SizedBox(height: 6),
      Text(body, style: TextStyle(color: Tk.label2, fontSize: 13.5, height: 1.4)),
    ]);

Widget bizFeature(String title, String body) => Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
      child: Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(color: Tk.card, borderRadius: BorderRadius.circular(18), border: Border.all(color: Tk.line, width: .5)),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(title, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800)),
          const SizedBox(height: 6),
          Text(body, style: TextStyle(color: Tk.label2, fontSize: 14, height: 1.4)),
        ]),
      ),
    );

Widget bizCloser(BuildContext context, HubSession s, String title) => Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
      child: Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(color: Tk.card, borderRadius: BorderRadius.circular(18), border: Border.all(color: Tk.line, width: .5)),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(title, style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800)),
          const SizedBox(height: 12),
          SizedBox(width: double.infinity, child: FilledButton(onPressed: () => Navigator.push(context, MaterialPageRoute<void>(builder: (_) => ProductsPricingPage(s))), child: const Text('See all products'))),
          const SizedBox(height: 8),
          SizedBox(width: double.infinity, child: OutlinedButton(onPressed: () => openSite(s, 'contact.html'), child: const Text("Let's talk"))),
        ]),
      ),
    );

/// `site/business-cafes.html`: cafés, restaurants, bars, bakeries & hotels.
class CafesPage extends StatelessWidget {
  const CafesPage(this.s, {super.key});
  final HubSession s;
  @override
  Widget build(BuildContext context) => SubPage('Cafés & restaurants', [
        bizHero('CAFÉS, RESTAURANTS, BARS & BAKERIES', 'Built for how a hospitality business actually runs.', 'From a table getting sat to the kitchen finding out, to the bill printing right. One account, no paper tickets, no separate stock spreadsheet. Same system for a café, a restaurant, a bar, a bakery or a hotel\'s own F&B counter.'),
        const SectionLabel('The gap between the till and the kitchen'),
        bizStruggle('Paper KOTs and shouting across the counter', 'An order written on paper is an order that can get lost, misread, or forgotten between the till and the kitchen.', 'No idea what\'s actually running low', 'Ingredient stock tracked in a notebook, if at all — you find out you\'re out of something when a customer orders it.'),
        const SectionLabel('What a café account gets you'),
        bizFeature('Tables, KOT & kitchen display', 'A floor plan by section, kitchen tickets the instant an order\'s sent, and a kitchen display that moves through new → preparing → ready.'),
        bizFeature('Ingredient stock & reorder alerts', 'Recipes deduct ingredient stock automatically as orders go through, with a reorder forecast built off real usage.'),
        bizFeature('GST invoices & day settlement', 'Every bill numbered and tax-broken-down automatically; close a day once it\'s settled, reopen it if something needs fixing.'),
        bizFeature('Self-order & your own mini-site', 'A QR code on every table, and a public page for your café that doubles as the ordering menu.'),
        bizFeature('Regulars, loyalty & feedback', 'See who\'s coming back and who\'s gone quiet, run a coupon, and collect a star rating right off the receipt.'),
        bizFeature('Staff pay, off their own clock-ins', 'A rate per staffer, hours computed from real attendance, one button to mark a month paid.'),
        const SectionLabel('Ready?'),
        bizCloser(context, s, 'Your kitchen\'s done with paper tickets.'),
        const SizedBox(height: 16),
      ]);
}

/// `site/business-salons.html`: AUZslab Salon.
class SalonsPage extends StatelessWidget {
  const SalonsPage(this.s, {super.key});
  final HubSession s;
  @override
  Widget build(BuildContext context) => SubPage('Salons', [
        bizHero('AUZSLAB SALON', 'Your salon, online and in your pocket.', 'A website that looks like your salon, online booking that fills your chairs, and billing, clients and expenses in one admin console you run from your phone.'),
        const SectionLabel('What salons struggle with'),
        bizStruggle('Bookings lost in WhatsApp chats', 'Appointments scattered across calls and messages, with double-bookings and no-shows nobody can trace.', 'A website that never gets updated', 'Old prices and missing photos online because every change means calling a developer.'),
        const SectionLabel('Everything a salon needs, in one console'),
        bizFeature('A site that looks like yours', 'Your logo, colours, fonts, hero photo, gallery, stylists and service menu on a fast public site. Edit every word and price from the admin.'),
        bizFeature('Online booking with live slots', 'Clients pick services, a date and a time. You set opening hours, closed days, slot length and how many chairs share a slot.'),
        bizFeature('Branded invoices over WhatsApp', 'Build a bill in seconds, send a short link on WhatsApp, and clients can print or save it as a PDF with your logo and footer.'),
        bizFeature('Every client remembered', 'Bookings and bills build a client list automatically — visits, total billed and last visit, without a separate notebook.'),
        bizFeature('Rent, salaries and bills tracked', 'Log what goes out as easily as what comes in, so you always know what the month really earned.'),
        bizFeature('Staff logins with limited access', 'Your team signs in with their phone number to take bookings, make bills and send them on WhatsApp. They can\'t touch prices, the website, expenses or other people\'s bills. Clock-ins flow into AUZslab Payroll.'),
        const SectionLabel('Ready?'),
        bizCloser(context, s, 'Let\'s get your chairs booked out.'),
        const SizedBox(height: 16),
      ]);
}

/// `site/business-retail.html`: shoe shops, bookstores & general retail.
class RetailPage extends StatelessWidget {
  const RetailPage(this.s, {super.key});
  final HubSession s;
  @override
  Widget build(BuildContext context) => SubPage('Retail & bookstores', [
        bizHero('SHOE SHOPS, BOOKSTORES & RETAIL', 'Know your stock, bill in seconds.', 'Scan a barcode, print or WhatsApp the receipt, and always know what\'s actually on the shelf, without a spreadsheet on the side. Same system for a shoe shop, a bookstore, or general retail.'),
        const SectionLabel('Counting stock by hand, every single time'),
        bizStruggle('Stock counted by hand', 'A physical count is the only way to know what\'s actually left, because nothing tracks it automatically as you sell.', 'Billing that takes longer than it should', 'Typing out each item at the counter instead of scanning it, with a customer waiting.'),
        const SectionLabel('The stock-to-till pipeline'),
        bizFeature('Barcode billing', 'Scan an item and it\'s on the bill — works with any USB/Bluetooth scanner already set to keyboard-emulation mode.'),
        bizFeature('Stock tracking & reorder alerts', 'Stock updates automatically as sales go through, with a reorder forecast built off real velocity, not a fixed threshold.'),
        bizFeature('GST invoices, print or WhatsApp', 'Every bill numbered and tax-broken-down, handed over printed or sent straight to a customer\'s phone.'),
        bizFeature('Loyalty, coupons & feedback', 'Points redeemable at billing, a coupon for a slow week, and feedback collected right off the receipt.'),
        bizFeature('Due & credit sales', 'Let a trusted customer settle later — the sale still logs now, and the balance shows up as due.'),
        bizFeature('Staff pay, off their own clock-ins', 'A rate per staffer, hours computed from real attendance, one button to mark a month paid.'),
        const SectionLabel('Ready?'),
        bizCloser(context, s, 'Know what\'s on the shelf.'),
        const SizedBox(height: 16),
      ]);
}

/// `site/business-clothing.html`: clothing & apparel.
class ClothingPage extends StatelessWidget {
  const ClothingPage(this.s, {super.key});
  final HubSession s;
  @override
  Widget build(BuildContext context) => SubPage('Clothing & apparel', [
        bizHero('CLOTHING & APPAREL', 'Stock by size and color, not by guess.', 'A clothing shop isn\'t "one item, one stock count" — it\'s a size/color matrix, a trial room, and returns. This is the one built for that.'),
        const SectionLabel('What most POS software gets wrong for clothing'),
        bizStruggle('One stock number per product isn\'t enough', 'A "T-shirt" isn\'t one thing to stock — it\'s a dozen size/color combinations, each running low on its own schedule.', 'Trial room chaos, returns on paper', 'What a customer took to try on isn\'t a sale yet, but most tills have no way to tell the two apart — and a return means undoing a receipt by hand.'),
        const SectionLabel('Built specifically for this'),
        bizFeature('Size & color billing', 'Every product\'s stock tracked by size and color, not one flat number — pick the exact variant a customer wants, or scan its own barcode.'),
        bizFeature('Trial room queue', 'Garments a customer\'s trying on go into their own queue, kept apart from actual sales until they decide.'),
        bizFeature('Returns & exchanges', 'Return or exchange a sold variant against its original invoice — stock restocks or swaps automatically either way.'),
        bizFeature('Purchase entry, per variant', 'Enter a vendor bill straight against the exact size/color rows it restocks — not a flat "add stock" number.'),
        bizFeature('Reorder forecasting', 'A suggested reorder quantity built off which specific size/color is actually selling, not a guess.'),
        bizFeature('Loyalty & repeat customers', 'Points redeemable at billing, and automatic segments so you know who\'s a regular and who\'s gone quiet.'),
        const SectionLabel('Ready?'),
        bizCloser(context, s, 'Stock that finally makes sense.'),
        const SizedBox(height: 16),
      ]);
}

/// `site/business-mobile-repair.html`: AUZsMob, mobile retail & repair.
class MobileRepairPage extends StatelessWidget {
  const MobileRepairPage(this.s, {super.key});
  final HubSession s;
  @override
  Widget build(BuildContext context) => SubPage('Mobile retail & repair', [
        bizHero('AUZSMOB · MOBILE RETAIL & REPAIR', 'Built around the way your shop runs.', 'Sell phones and accessories, track every repair, and know who sold or fixed what, without any staffer seeing another\'s numbers. In Hindi or English, even offline.'),
        const SectionLabel('What mobile shops struggle with'),
        bizStruggle('Stock nobody can actually trust', 'A notebook or a spreadsheet can\'t tell two identical phones apart — so a swapped or returned handset just disappears into the count.', 'No real picture of who did what', 'Multiple staff billing and repairing off one shared login means the owner can\'t see — and staff can see each other\'s — sales and work.'),
        const SectionLabel('Everything a mobile retail & repair shop needs'),
        bizFeature('Every phone tracked by its own IMEI', 'Each handset is its own unit with its own IMEI/serial, condition and warranty — not just a number in a stock count. Accessories stay simple plain-quantity stock.'),
        bizFeature('A real repair-ticket workflow', 'Intake a device, log the issue, track status through to done, record parts used and take payment — a genuine job tracker, not a sticky note.'),
        bizFeature('Each staffer sees only their own', 'Sales and repair jobs are recorded under the staffer who made them, and enforced by the system — one staff member can\'t see another\'s numbers, full stop.'),
        bizFeature('The owner sees everything, always', 'Every staffer\'s sales, repairs and totals roll up for the owner/admin — full visibility at the top, isolation everywhere else.'),
        bizFeature('Suppliers, purchases & stock movement', 'Record what came in and from whom, with low-stock alerts and a full movement log behind every change in stock.'),
        bizFeature('Picks its wording to match your shop', 'Mobile & repair, electronics retail, computer repair, or general retail — chosen once at setup, no clutter from features you don\'t run.'),
        const SectionLabel('Ready?'),
        bizCloser(context, s, 'Sell phones. Track repairs. Keep it straight.'),
        const SizedBox(height: 16),
      ]);
}
