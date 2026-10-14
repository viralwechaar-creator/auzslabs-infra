import 'package:flutter/material.dart' hide Text;
import '../../core/session.dart';
import '../cart.dart';
import '../ds.dart';
import '../i18n.dart';
import '../mk.dart';
import '../theme.dart';

/// "Learn & resources" (native equivalent of `site/learn.html` plus the three
/// `resources-*.html` pages): a table of contents of four real resources, each opened as its
/// own native page with the site's real copy, word for word.
class LearnHubPage extends StatelessWidget {
  const LearnHubPage(this.s, {super.key});
  final HubSession s;

  @override
  Widget build(BuildContext context) => SubPage('Learn & resources', [
        const Hint('Plain, step-by-step guides. Pick what you use.'),
        Group([
          Li('Learn AUZslab, beginner manual', sub: 'Signing in, your first day, and every app, step by step', icon: Icons.menu_book_outlined, tone: Tk.orange, onTap: () => Navigator.push(context, MaterialPageRoute<void>(builder: (_) => const LearnManualPage()))),
          Li('Getting started', sub: 'From signup to your first bill, in order', icon: Icons.rocket_launch_outlined, tone: Tk.blue, onTap: () => Navigator.push(context, MaterialPageRoute<void>(builder: (_) => GettingStartedPage(s)))),
          Li('Operations & workflows', sub: 'What a shift actually looks like, by business type', icon: Icons.sync_alt, tone: Tk.teal, onTap: () => Navigator.push(context, MaterialPageRoute<void>(builder: (_) => GettingOperationsPage(s)))),
          Li('Growth & scaling', sub: 'Beyond the till: customers, reports, payroll', icon: Icons.trending_up, tone: Tk.green, onTap: () => Navigator.push(context, MaterialPageRoute<void>(builder: (_) => GrowthPage(s)))),
        ]),
        const SizedBox(height: 16),
      ]);
}

/// Shared building blocks for the four Learn pages below: a tinted hero, a plain card, a
/// question/answer card and a numbered-steps card, all styled like `why_page.dart`'s.
Widget learnHero(String eyebrow, String title, String sub, {Color? tone}) => Container(
      margin: const EdgeInsets.fromLTRB(16, 10, 16, 6),
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(color: tone ?? Tk.accent, borderRadius: BorderRadius.circular(22)),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(eyebrow.toUpperCase(), style: const TextStyle(color: Colors.white70, fontWeight: FontWeight.w800, fontSize: 12, letterSpacing: 1.1)),
        const SizedBox(height: 10),
        Text(title, style: const TextStyle(color: Colors.white, fontSize: 26, fontWeight: FontWeight.w800, height: 1.15, letterSpacing: -.4)),
        const SizedBox(height: 10),
        Text(sub, style: TextStyle(color: Colors.white.withValues(alpha: .88), fontSize: 15, height: 1.35)),
      ]),
    );

Widget learnCard(List<Widget> kids) => Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
      child: Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(color: Tk.card, borderRadius: BorderRadius.circular(18), border: Border.all(color: Tk.line, width: .5)),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: kids),
      ),
    );

/// One Q&A item: a bold question, then a plain-text answer (an ordered list, or a paragraph).
Widget learnQA(String q, {String? body, List<String>? steps}) => Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(q, style: const TextStyle(fontSize: 15.5, fontWeight: FontWeight.w800)),
        const SizedBox(height: 6),
        if (body != null) Text(body, style: TextStyle(color: Tk.label2, fontSize: 14, height: 1.45)),
        if (steps != null)
          for (var i = 0; i < steps.length; i++)
            Padding(
              padding: const EdgeInsets.only(bottom: 4),
              child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text('${i + 1}. ', style: TextStyle(color: Tk.label2, fontSize: 14, fontWeight: FontWeight.w700)),
                Expanded(child: Text(steps[i], style: TextStyle(color: Tk.label2, fontSize: 14, height: 1.45))),
              ]),
            ),
      ]),
    );

Widget learnTwoUp(String leftLabel, String leftBody, String rightLabel, String rightBody) => Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Expanded(child: learnPlain(leftLabel, leftBody)),
        const SizedBox(width: 12),
        Expanded(child: learnPlain(rightLabel, rightBody)),
      ]),
    );

Widget learnPlain(String label, String body) => Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Text(label, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w800)),
      const SizedBox(height: 6),
      Text(body, style: TextStyle(color: Tk.label2, fontSize: 13.5, height: 1.4)),
    ]);

Widget learnTags(List<String> tags) => Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
      child: Wrap(spacing: 8, runSpacing: 8, children: [for (final t in tags) Pill(t)]),
    );

/// "Learn AUZslab, beginner manual" (native equivalent of `site/learn.html`): the full plain
/// manual -- start here, the owner's first day, then AUZsPOS, AUZsMob, AUZsPay, AUZsLedger, the
/// salon app and the safety habits, same real copy as the site's accordions.
class LearnManualPage extends StatelessWidget {
  const LearnManualPage({super.key});

  @override
  Widget build(BuildContext context) => SubPage('Learn AUZslab', [
        learnHero('Learn · Beginner manual', 'Learn AUZslab, step by step.', 'Plain steps for people who have never used business software. Pick what you use.', tone: Tk.orange),
        const SectionLabel('Start here'),
        const Hint('Signing in and getting around. Everything works on a phone, tablet or computer. Nothing to install.'),
        learnCard([
          learnQA('How do I sign in?', steps: const [
            'Open app.auzslab.in (or your own business address).',
            'Owners and managers: choose Continue with Google, or use email and password.',
            'Staff: open the Staff tab and type the username and PIN your owner gave you.',
            'After sign in you see tiles for the apps your plan includes. Tap one to open it.',
          ]),
          learnQA('Put it on your phone like an app', steps: const [
            'Open the app address in Safari (iPhone) or Chrome (Android).',
            'iPhone: tap Share, then Add to Home Screen. Android: tap the menu, then Install app or Add to Home screen.',
            'Add each app you use from its own page, so its icon opens that app.',
          ]),
          learnQA('I forgot my password or PIN', body: 'Owners: use Forgot password on the sign-in screen. Staff: ask your owner to reset your PIN from their dashboard under Staff. Never share a PIN.'),
          learnQA('Where do I get help?', body: "Every app has Help & report a problem in its menu. It collects the details for you and sends a message to our team. You can also use the contact page."),
        ]),
        const SectionLabel('For owners'),
        const Hint('Your first day, in order. Do these once. It takes about half an hour.'),
        learnCard([
          learnQA('1. Add your business details', steps: const [
            'Sign in and open the Admin console (or Settings in your app).',
            'Fill in business name, phone, address and opening hours.',
            'Upload your logo. The apps and printed bills use it.',
          ]),
          learnQA('2. Add your menu, items or services', steps: const [
            'Open Menu (cafes and restaurants), Stock (AUZsMob) or Menu and prices (salon).',
            'Add a category, then add items with a name and price.',
            'Already have a PDF menu? In the admin console, Menu, tap Read menu file. Check the draft it makes, then create.',
          ]),
          learnQA('3. Add your staff', steps: const [
            'Open your account page, then Staff.',
            'Tap Add staff and choose Username + PIN.',
            'Write down the PIN. It is shown once. The owner can reset it any time.',
            'Give each person only the permissions their job needs.',
          ]),
          learnQA('4. Make your first bill', body: 'Open your app, add one item, take a payment and print or share the bill. Do it once as a test so staff see what customers will see. You can void a test bill afterwards if your permissions allow it.'),
          learnQA('5. Check your plan and renewal', body: 'Open Plan & account in any app to see your plan, renewal date and, if available, auto-renewal.'),
        ]),
        const SectionLabel('AUZsPOS'),
        const Hint('Taking orders and bills. For cafes, restaurants and shops.'),
        learnCard([
          learnQA('Make a bill', steps: const [
            'Tap Sell.',
            'Tap items to add them. Use the plus and minus to change quantity.',
            'Choose dine-in, takeaway or delivery. For dine-in, pick the table.',
            'Tap Pay, choose cash, UPI or card, and finish.',
            'Print the bill or share it on WhatsApp.',
          ]),
          learnQA('Send to the kitchen', body: 'Tap Send to kitchen before payment. The kitchen screen shows the order. When the kitchen marks it ready, the cashier sees it.'),
          learnQA('Discounts, voids and refunds', body: 'These need approval. A manager types an approval PIN. Owners and managers set their PIN once in Staff & settings. This protects your cash.'),
          learnQA('End of day', steps: const ['Open Register and count the cash.', 'Check the day report in the admin console under Reports.']),
          learnQA('Works without internet?', body: 'Yes. Bills are saved on the device and sent when the internet returns. A small status line shows what is waiting.'),
        ]),
        const SectionLabel('AUZsMob'),
        const Hint('Mobile shops and repairs. Buy, sell and repair phones, with staff accountability. A short Hindi and English owner guide also exists, see the language switch inside the app.'),
        learnCard([
          learnQA('Sell a phone or accessory', steps: const [
            'Tap New sale and search the item or IMEI.',
            'Confirm the selling price for this bill.',
            'Take payment: cash, UPI, card or credit.',
            'Share the receipt on WhatsApp.',
          ]),
          learnQA('Add stock (purchase)', steps: const [
            'Tap Add purchase.',
            'Pick or add the item and the vendor.',
            'Enter quantity and purchase price. For phones, enter each IMEI.',
          ]),
          learnQA('Repairs', steps: const [
            'Tap New repair.',
            'Enter the customer, device, problem and advance paid.',
            'Update the status as the job moves along, and record parts and payments.',
          ]),
          learnQA('Staff and profit', body: 'Each staff member sees only their own sales. The owner sees every staff member in Reports, with the profit table. The owner can also set a profit share under Settings.'),
        ]),
        const SectionLabel('AUZsPay'),
        const Hint('Staff attendance and salary.'),
        learnCard([
          learnQA('Clock in and out (staff)', steps: const [
            'Open AUZsPay on your phone.',
            'Tap the big Clock in button. Tap it again when you leave.',
            "No internet? It saves your punch with the real time and sends it later.",
          ]),
          learnQA('Run salary (owner)', steps: const [
            'Add each person under People with their salary.',
            'At month end open Payroll, check the numbers and finalise.',
            'Staff see their payslip under My pay.',
          ]),
          learnQA('Leave', body: 'Staff ask for leave under My leave. The owner or manager approves it.'),
        ]),
        const SectionLabel('AUZsLedger'),
        const Hint('Accounts and GST.'),
        learnCard([
          learnQA('Make an invoice', steps: const [
            'Open Sales, then New invoice.',
            'Pick the customer, add items and check the tax.',
            'Save as a draft or Post. Posted invoices get a number and cannot be edited, only cancelled.',
          ]),
          learnQA('Scan to bill (barcodes)', steps: const [
            'Open Sales, then Scan to bill. The first time, allow the camera when your phone asks.',
            'Tap Scan to sell and point at a barcode. Each scan adds the item; scan again to add one more. You can also type a name or code.',
            'A new barcode asks for the name, price, GST and stock once. After that, scanning fills it in.',
            'Choose cash, UPI, bank or credit, then Charge. The invoice is posted and stock goes down.',
            'Tap Send on WhatsApp, or print or save the PDF.',
          ]),
          const Padding(padding: EdgeInsets.only(bottom: 14), child: Text('To bring stock in, switch to Add stock and scan what arrived. The same screen is also available as the small AUZsScan app at your business address, /scan.html.', style: TextStyle(fontSize: 14, height: 1.45))),
          learnQA('Record a supplier bill', body: 'Open Purchases and tap Scan invoice to read a PDF or photo, or enter it by hand. Always check the details before saving.'),
          learnQA('Reports', body: 'Open Financial reports for profit and loss, balance sheet and GST summaries. They are working papers for you and your accountant.'),
        ]),
        const SectionLabel('Salon app'),
        const Hint('Bookings, bills and staff.'),
        learnCard([
          learnQA('Take a booking', steps: const [
            'Open the salon console and go to Bookings.',
            'Add the customer, service, date and time.',
            'Change the status as the visit goes on.',
          ]),
          learnQA('Bill and share', body: 'Create the bill from the booking and send it to the customer on WhatsApp.'),
          learnQA('Your look', body: 'Under Settings, then Branding, add your logo, colours and hero photo.'),
        ]),
        const SectionLabel('Good habits'),
        const Hint('Keep your business safe.'),
        learnCard([
          learnQA('Five simple rules', steps: const [
            'Give every person their own login. Never share one.',
            'Never write PINs on the counter.',
            'Remove a login the day someone leaves.',
            'Take a backup now and then from your account page.',
            'Use a long unique password for the owner login.',
          ]),
        ]),
        const SectionLabel('Staff login card'),
        const Hint('Give each staff member a card. The PIN is shown only once when you add a staff member -- print the card from the website, fill it in by hand and hand it over.'),
        learnCard([
          const Text('AUZslab staff login', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
          const SizedBox(height: 8),
          const Text('1. Open app.auzslab.in\n2. Tap the Staff tab\n3. Type your username and PIN', style: TextStyle(fontSize: 14, height: 1.5)),
          const SizedBox(height: 10),
          Text('Username: ______________________', style: TextStyle(fontSize: 14, color: Tk.label2)),
          Text('PIN: __________ (keep it private)', style: TextStyle(fontSize: 14, color: Tk.label2)),
        ]),
        const SizedBox(height: 16),
      ]);
}

/// "Getting started" (native equivalent of `site/resources-getting-started.html`): what
/// actually happens after signup, in order, plus the two things worth knowing early.
class GettingStartedPage extends StatelessWidget {
  const GettingStartedPage(this.s, {super.key});
  final HubSession s;

  @override
  Widget build(BuildContext context) => SubPage('Getting started', [
        learnHero('Resources · Getting started', 'From signup to your first bill.', 'What actually happens after you sign up, in the order it happens. No jargon, no "contact support for details."', tone: Tk.blue),
        const SectionLabel('Step by step'),
        learnCard([
          learnQA('1. We set up your account', body: 'Once you send your requirements from the cart (or we set it up directly), your business gets its own address — yourbusiness.auzslab.in — and an owner login on the email you gave us. That one address is both your staff-facing till and your own public mini-website; nothing else to install.'),
          learnQA('2. You sign in and pick your business type', body: 'Sign in on your business address with the owner login, then open Settings → Business details. The first thing to set is your business type (restaurant/café, or retail) — this decides which screens you actually see. A café gets table management and a kitchen display; a clothing shop gets size/color stock and a trial-room queue instead. Everything else in Settings — your name, GST number, invoice prefix, logo and brand colour — feeds straight into every invoice you print.'),
          learnQA('3. You build your menu or product list', body: 'The Menu (or Products) tab is where you add categories and items. A café adds dishes with prices and optional size tiers; a retail shop adds products with size/color variants, each with its own stock count and an optional barcode. Either way, this is what your staff will see on the Sell screen five minutes later.'),
          learnQA('4. You add your staff', body: 'Staff get their own login and a role — cashier, manager, or a custom role you define with exactly the permissions you want them to have. Nobody needs to share the owner login just to take orders.'),
          learnQA('5. You take your first order', body: "Tap items onto the bill, take payment (cash, UPI, card, or a due/credit sale), and print or WhatsApp the receipt. It works offline too — the sale saves locally first and syncs to the server the moment you're back online, so a spotty connection never blocks a sale."),
        ]),
        const SectionLabel('Worth knowing early'),
        learnTwoUp('It works without internet', 'Sales save to the device first, then sync. A dropped connection at the counter never stops a sale.', 'Your data is yours', 'We run and look after everything for you, so there is nothing for you to install or maintain.'),
        const SectionLabel('Next'),
        learnCard([
          const Text('See how your team actually uses it day to day.', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w800)),
          const SizedBox(height: 12),
          SizedBox(width: double.infinity, child: FilledButton(onPressed: () => Navigator.push(context, MaterialPageRoute<void>(builder: (_) => GettingOperationsPage(s))), child: const Text('Operations & workflows'))),
        ]),
        const SizedBox(height: 16),
      ]);
}

/// "Operations & workflows" (native equivalent of `site/resources-operations.html`): what a
/// shift actually looks like for a café/restaurant versus a retail/clothing shop.
class GettingOperationsPage extends StatelessWidget {
  const GettingOperationsPage(this.s, {super.key});
  final HubSession s;

  @override
  Widget build(BuildContext context) => SubPage('Operations & workflows', [
        learnHero('Resources · Operations & workflows', 'What a shift actually looks like.', "Day-to-day workflows differ by business type — here's what each one sees on the floor.", tone: Tk.teal),
        const SectionLabel('If you run a café or restaurant'),
        learnTwoUp(
          'Tables & kitchen tickets',
          "A floor plan grouped by section (AC, Garden, Terrace — whatever you call them), coloured by whether a table's running a bill. Sending an order prints a kitchen ticket and moves it through new → preparing → ready → served on the kitchen display, with a bell when something's ready.",
          'Day settlement & KOT report',
          "Close a day once its bills are settled — an owner can reopen it if a correction's needed. The KOT report keeps a searchable log of every kitchen ticket sent, by date and order number.",
        ),
        const SectionLabel('If you run a retail or clothing shop'),
        learnTwoUp(
          'Size & color billing',
          "Every product's stock is tracked by size and color, not just as one number. Tap a product, pick the size/color a customer wants (or scan its own barcode), and the sale comes straight off that exact variant's stock.",
          'Trial room & returns',
          "Garments a customer's trying on go into their own Trial room queue, kept apart from actual sales until they decide. A sold item can later be returned or exchanged against its original invoice, restocking or swapping the exact variant.",
        ),
        const SectionLabel('Common to both'),
        learnTags(const ['Custom staff roles', 'Barcode scanning (optional)', 'Due / credit sales', 'Offline-first sync', 'GST invoices']),
        const SectionLabel('Next'),
        learnCard([
          const Text('See what brings customers back — and what management sees at the end of the month.', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w800)),
          const SizedBox(height: 12),
          SizedBox(width: double.infinity, child: FilledButton(onPressed: () => Navigator.push(context, MaterialPageRoute<void>(builder: (_) => GrowthPage(s))), child: const Text('Growth & scaling'))),
        ]),
        const SizedBox(height: 16),
      ]);
}

/// "Growth & scaling" (native equivalent of `site/resources-growth.html`): what AUZslab does
/// beyond the till -- customers, reporting, reordering and payroll, all from the same account.
class GrowthPage extends StatelessWidget {
  const GrowthPage(this.s, {super.key});
  final HubSession s;

  @override
  Widget build(BuildContext context) => SubPage('Growth & scaling', [
        learnHero('Resources · Growth & scaling', 'Beyond the till.', "Selling is one job. Knowing who's buying, what's slowing you down, and what your team costs you is another — AUZslab does both from the same account.", tone: Tk.green),
        const SectionLabel('Bring customers back on purpose'),
        learnTwoUp(
          'Segments, automatically',
          "Every customer who leaves a phone number gets sorted into a tier by lifetime spend and a risk band by how long since their last visit — no manual tagging, computed straight from their order history.",
          'Loyalty, coupons & feedback',
          'Points redeemable at billing, coupon codes with an expiry or a use-limit, and a star-rating-plus-comment box on every printed/shared receipt — so feedback comes back to you, not a review site.',
        ),
        const SectionLabel('See your business clearly'),
        learnTwoUp(
          "A report builder that's actually yours",
          'Pick a date range, a dimension (day, item, category, payment mode, order type) and a metric — sales, quantity, or bill count — and get exactly the table you asked for, exportable to CSV. Not a fixed dashboard you have to work around.',
          'Reorder before you run out',
          'A forecast built off real sale velocity — how fast an ingredient or a size/color has actually been moving in the last two weeks — flags what\'s low and suggests how much to reorder, instead of a static "low stock" number.',
        ),
        const SectionLabel('Your team, accounted for'),
        learnTwoUp(
          'Attendance & payroll',
          "Staff clock in and out on their own login; an owner sets each person's monthly rate and marks a month's pay once it's settled, with hours pulled straight from their own clock-ins — no separate spreadsheet to keep in sync.",
          'Custom roles',
          "Cashier and manager cover most cases, but you can define exactly what a role can and can't touch — discounts, refunds, menu edits — as your team grows past a couple of people.",
        ),
        const SectionLabel('All of it, one account'),
        learnTags(const ['No per-seat fees', 'No separate CRM subscription', 'No spreadsheet payroll', 'Your data stays yours']),
        const SectionLabel('Ready?'),
        learnCard([
          const Text("Tell us what your business runs on — we'll take it from there.", style: TextStyle(fontSize: 16, fontWeight: FontWeight.w800)),
          const SizedBox(height: 12),
          SizedBox(width: double.infinity, child: FilledButton(onPressed: () => Navigator.push(context, MaterialPageRoute<void>(builder: (_) => CartPage(s))), child: const Text('Get started'))),
        ]),
        const SizedBox(height: 16),
      ]);
}
