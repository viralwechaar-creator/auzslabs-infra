import 'package:flutter/material.dart' hide Text;
import 'i18n.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:url_launcher/url_launcher.dart';
import '../core/billing.dart' show r2;
import '../core/cash.dart' show dayCloseDenoms, denomTotal;
import '../core/repo.dart';
import 'actions.dart';
import 'console.dart';
import 'ds.dart';
import 'home.dart';
import 'kit.dart';
import 'theme.dart';

String _s(dynamic v) => v == null ? '' : '$v';
Future<void> _wa(String phone, String msg) {
  var p = phone.replaceAll(RegExp(r'[^0-9]'), '');
  if (p.length == 10) p = '91$p';
  return launchUrl(Uri.parse('https://wa.me/$p?text=${Uri.encodeComponent(msg)}'), mode: LaunchMode.externalApplication);
}

// ------------------------------------------------------------------ customers (derived like the web console)

class Cust {
  Cust(this.name, this.phone);
  String name, phone;
  double spend = 0;
  int visits = 0;
  String first = '', last = '', dob = '';
  String get tier => spend >= 10000 ? 'Gold' : spend >= 3000 ? 'Silver' : 'Regular';
}

List<Cust> custs(HomeState h) {
  final m = <String, Cust>{};
  for (final c in h.s.repo!.of('customer')) {
    final p = _s(c['phone']);
    if (p.isEmpty) continue;
    m[p] = Cust(_s(c['name']), p)..dob = _s(c['dob']);
  }
  for (final o in paidIn(h.s.repo!, 3650)) {
    final c = o['cust'];
    if (c is! Map || _s(c['phone']).isEmpty) continue;
    final p = _s(c['phone']);
    final x = m.putIfAbsent(p, () => Cust(_s(c['name']), p));
    if (x.name.isEmpty) x.name = _s(c['name']);
    x.spend += totalOf(o);
    x.visits++;
    final d = dayOfIso(o['paidAt']);
    if (x.first.isEmpty || d.compareTo(x.first) < 0) x.first = d;
    if (x.last.isEmpty || d.compareTo(x.last) > 0) x.last = d;
  }
  return m.values.toList();
}

const segRules = [('all', 'All customers'), ('new', 'New (first order in 30 days)'), ('repeat', 'Repeat (2+ visits)'), ('lapsed', 'Lapsed (no visit in 30 days)'), ('gold', 'Gold tier'), ('silver', 'Silver tier'), ('bday', 'Birthday this month')];

List<Cust> segMembers(HomeState h, String rule) {
  final now = DateTime.now();
  final d30 = dayKey(now.subtract(const Duration(days: 30)));
  return custs(h).where((c) {
    switch (rule) {
      case 'new':
        return c.first.isNotEmpty && c.first.compareTo(d30) >= 0;
      case 'repeat':
        return c.visits > 1;
      case 'lapsed':
        return c.last.isNotEmpty && c.last.compareTo(d30) < 0;
      case 'gold':
        return c.tier == 'Gold';
      case 'silver':
        return c.tier == 'Silver';
      case 'bday':
        return c.dob.length >= 7 && int.tryParse(c.dob.substring(5, 7)) == now.month;
      default:
        return true;
    }
  }).toList();
}

/// One tap per customer opens WhatsApp with the message filled in (messages go from the owner's own phone).
void sendCenter(BuildContext context, HomeState h, String title, String rule, String msg0, {Map<String, dynamic>? camp}) {
  final people = segMembers(h, rule).where((c) => c.phone.isNotEmpty).toList();
  var msg = msg0.isEmpty ? 'Hi {name}, thank you for being our guest at ${h.s.cfg['name']}. ' : msg0;
  final sent = <String>{...(((camp?['sent']) as List?) ?? []).map((e) => '$e')};
  final ctl = TextEditingController(text: msg);
  showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    builder: (ctx) => StatefulBuilder(builder: (ctx, set) => SafeArea(
          child: Padding(
            padding: EdgeInsets.fromLTRB(16, 0, 16, MediaQuery.of(ctx).viewInsets.bottom + 12),
            child: SizedBox(
              height: MediaQuery.of(ctx).size.height * .8,
              child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                Text('Message · $title', style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800)),
                const SizedBox(height: 4),
                Text('Tap WhatsApp next to each customer. {name} becomes their name. ${people.length} customers.', style: TextStyle(color: Tk.label2)),
                const SizedBox(height: 10),
                TextField(controller: ctl, minLines: 3, maxLines: 5, onChanged: (v) => msg = v),
                const SizedBox(height: 10),
                Expanded(
                  child: people.isEmpty
                      ? const Empty(Icons.people_outline, 'Nobody here yet', 'No customers with a phone number match this group.')
                      : ListView(children: [
                          Group([
                            for (final c in people.take(200))
                              Li(c.name.isEmpty ? c.phone : c.name, sub: c.phone, icon: Icons.person_outline, trailing: FilledButton(
                                style: FilledButton.styleFrom(minimumSize: const Size(0, 44), padding: const EdgeInsets.symmetric(horizontal: 16), backgroundColor: sent.contains(c.phone) ? Tk.fill : const Color(0xFF25D366), foregroundColor: sent.contains(c.phone) ? Tk.label : Colors.white),
                                onPressed: () async {
                                  await _wa(c.phone, msg.replaceAll('{name}', c.name.isEmpty ? 'there' : c.name));
                                  sent.add(c.phone);
                                  if (camp != null) {
                                    await h.s.repo!.save('campaign', {...camp, 'sent': sent.toList(), 'lastSent': nowIso()}, id: '${camp['id']}');
                                    h.s.sync();
                                  }
                                  set(() {});
                                },
                                child: Text(sent.contains(c.phone) ? 'Sent' : 'WhatsApp'),
                              )),
                          ]),
                        ]),
                ),
              ]),
            ),
          ),
        )),
  );
}

// ------------------------------------------------------------------ marketing

class SegmentsPage extends StatefulWidget {
  const SegmentsPage(this.h, {super.key});
  final HomeState h;
  @override
  State<SegmentsPage> createState() => _SegmentsPageState();
}

class _SegmentsPageState extends State<SegmentsPage> {
  HomeState get h => widget.h;
  Future<void> edit([Map<String, dynamic>? s]) => formSheet(context, s == null ? 'New segment' : 'Edit segment', [F('name', 'Segment name', value: s?['name']), F('rule', 'Who is in it', type: 'select', value: s?['rule'] ?? 'all', options: [for (final (k, l) in segRules) [k, l]])], (v) async {
        if ('${v['name']}'.isEmpty) return false;
        await h.s.repo!.save('segment', {...?s, ...v}, id: s?['id'] as String?);
        setState(() {});
        h.s.sync();
        return true;
      }, onDelete: s == null ? null : () async {
        await h.s.repo!.save('segment', s, id: '${s['id']}', deleted: true);
        setState(() {});
        h.s.sync();
      });
  @override
  Widget build(BuildContext context) {
    final custom = h.s.repo!.of('segment').toList();
    return ListView(padding: const EdgeInsets.only(bottom: 28), children: [
      PageHead('Segments', sub: 'Groups of customers you can message together.', trailing: PillBtn('New', icon: Icons.add, fill: true, onTap: edit)),
      const SizedBox(height: 12),
      Group([
        for (final (k, l) in segRules) Li(l, sub: '${segMembers(h, k).length} customers', icon: Icons.groups_outlined, tone: Tk.blue, trailing: TextButton(onPressed: () => sendCenter(context, h, l, k, ''), child: const Text('Message')), chevron: false),
        for (final s in custom) Li('${s['name']}', sub: '${segMembers(h, '${s['rule']}').length} customers', icon: Icons.groups_outlined, tone: Tk.accent, trailing: TextButton(onPressed: () => sendCenter(context, h, '${s['name']}', '${s['rule']}', ''), child: const Text('Message')), onTap: () => edit(s)),
      ]),
    ]);
  }
}

class CampaignsPage extends StatefulWidget {
  const CampaignsPage(this.h, {super.key});
  final HomeState h;
  @override
  State<CampaignsPage> createState() => _CampaignsPageState();
}

class _CampaignsPageState extends State<CampaignsPage> {
  HomeState get h => widget.h;
  Future<void> edit([Map<String, dynamic>? c]) {
    final segs = [for (final (k, l) in segRules) [k, l], for (final s in h.s.repo!.of('segment')) ['${s['rule']}', '${s['name']}']];
    return formSheet(context, c == null ? 'New campaign' : 'Edit campaign', [
      F('name', 'Campaign name', value: c?['name']),
      F('type', 'Type', type: 'select', value: c?['type'] ?? 'Offer', options: [for (final x in const ['Offer', 'Festival', 'Win-back', 'Birthday', 'New item', 'Announcement']) [x, x]]),
      F('rule', 'Send to', type: 'select', value: c?['rule'] ?? 'all', options: segs),
      F('date', 'Planned date (YYYY-MM-DD)', value: c?['date']),
      F('msg', 'Message', type: 'multiline', value: c?['msg'], hint: 'Use {name} for the customer name'),
    ], (v) async {
      if ('${v['name']}'.isEmpty || '${v['msg']}'.isEmpty) return false;
      await h.s.repo!.save('campaign', {'createdAt': nowIso(), 'sent': <dynamic>[], ...?c, ...v}, id: c?['id'] as String?);
      setState(() {});
      h.s.sync();
      return true;
    }, onDelete: c == null ? null : () async {
      await h.s.repo!.save('campaign', c, id: '${c['id']}', deleted: true);
      setState(() {});
      h.s.sync();
    });
  }

  @override
  Widget build(BuildContext context) {
    final cs = h.s.repo!.of('campaign').toList()..sort((a, b) => '${b['createdAt']}'.compareTo('${a['createdAt']}'));
    final sent = cs.fold<int>(0, (a, c) => a + (((c['sent'] as List?) ?? []).length));
    return ListView(padding: const EdgeInsets.only(bottom: 28), children: [
      PageHead('Campaigns', sub: 'Plan a message, pick who gets it, send with one tap per customer.', trailing: PillBtn('New', icon: Icons.add, fill: true, onTap: edit)),
      Kpis('Campaigns', '${cs.length}', 'Messages sent: $sent', const []),
      const SizedBox(height: 8),
      if (cs.isEmpty) Empty(Icons.campaign_outlined, 'No campaigns yet', 'Plan an offer, festival or win-back message.', action: 'New campaign', onAction: edit) else Group([
        for (final c in cs) Li('${c['name']}', sub: '${c['type']} · ${_s(c['date']).isEmpty ? 'No date' : c['date']} · ${((c['sent'] as List?) ?? []).length} sent', icon: Icons.campaign_outlined, tone: Tk.accent, trailing: FilledButton(style: FilledButton.styleFrom(minimumSize: const Size(0, 44), padding: const EdgeInsets.symmetric(horizontal: 16)), onPressed: () => sendCenter(context, h, '${c['name']}', '${c['rule']}', '${c['msg']}', camp: c), child: const Text('Send')), onTap: () => edit(c)),
      ]),
    ]);
  }
}

class OffersPage extends StatelessWidget {
  const OffersPage(this.h, {super.key});
  final HomeState h;
  @override
  Widget build(BuildContext context) {
    final cs = h.s.repo!.of('coupon').toList();
    return ListView(padding: const EdgeInsets.only(bottom: 28), children: [
      const PageHead('Offers', sub: 'Coupon codes customers can use at the counter. Edit them in Menu Management > Discounts.'),
      const SizedBox(height: 12),
      if (cs.isEmpty) const Empty(Icons.local_offer_outlined, 'No coupons yet', 'Create one under Menu Management > Discounts.') else Group([
        for (final c in cs)
          Li('${c['code']}', sub: '${c['type'] == '%' ? '${c['value']}% off' : '₹${c['value']} off'} · ${_s(c['expiry']).isEmpty ? 'No expiry' : 'until ${c['expiry']}'}', icon: Icons.local_offer_outlined, tone: Tk.accent, trailing: TextButton(onPressed: () => sendCenter(context, h, 'Offer ${c['code']}', 'all', 'Hi {name}, use code ${c['code']} at ${h.s.cfg['name']} for ${c['type'] == '%' ? '${c['value']}% off' : '₹${c['value']} off'}.'), child: const Text('Share')), chevron: false),
      ]),
    ]);
  }
}

class PromotionsPage extends StatelessWidget {
  const PromotionsPage(this.h, this.go, {super.key});
  final HomeState h;
  final void Function(String) go;
  @override
  Widget build(BuildContext context) {
    final today = dayKey(DateTime.now());
    final live = h.s.repo!.of('coupon').where((c) => _s(c['expiry']).isEmpty || _s(c['expiry']).compareTo(today) >= 0).toList();
    final plan = h.s.repo!.of('campaign').where((c) => _s(c['date']).isNotEmpty && _s(c['date']).compareTo(today) >= 0).toList()..sort((a, b) => '${a['date']}'.compareTo('${b['date']}'));
    final offers = h.s.repo!.of('offer').where((o) => o['active'] != false).length;
    return ListView(padding: const EdgeInsets.only(bottom: 28), children: [
      const PageHead('Promotions', sub: 'What is running right now.'),
      Kpis('Live coupons', '${live.length}', 'Buy X get Y offers: $offers', [('Campaigns planned', '${plan.length}', null)]),
      const SectionLabel('Live coupons'),
      Group(live.isEmpty ? [const Li('No live coupons', chevron: false)] : [for (final c in live) Li('${c['code']}', sub: c['type'] == '%' ? '${c['value']}% off' : '₹${c['value']} off', chevron: false)]),
      const SectionLabel('Upcoming campaigns'),
      Group(plan.isEmpty ? [const Li('Nothing planned', chevron: false)] : [for (final c in plan) Li('${c['name']}', sub: '${c['date']}', onTap: () => go('mkt/campaigns'))]),
    ]);
  }
}

class WhatsAppPage extends StatelessWidget {
  const WhatsAppPage(this.h, {super.key});
  final HomeState h;
  @override
  Widget build(BuildContext context) {
    final name = '${h.s.cfg['name']}';
    final msgs = [
      ('Thank you', 'all', 'Hi {name}, thank you for visiting $name. We hope to see you again soon.'),
      ('Win-back', 'lapsed', 'Hi {name}, we miss you at $name. Visit this week and enjoy a treat on us.'),
      ('Birthday', 'bday', 'Happy birthday {name}. Come celebrate with us at $name.'),
      ('New item', 'all', 'Hi {name}, we just added something new to the menu at $name.'),
    ];
    final withPhone = custs(h).where((c) => c.phone.isNotEmpty).length;
    return ListView(padding: const EdgeInsets.only(bottom: 28), children: [
      const PageHead('WhatsApp Marketing', sub: 'Send messages from your own WhatsApp. No setup or per-message fee.'),
      Kpis('Customers with a number', '$withPhone', 'Your WhatsApp: ${_s(h.s.cfg['whatsapp']).isEmpty ? (_s(h.s.cfg['phone']).isEmpty ? 'not set' : h.s.cfg['phone']) : h.s.cfg['whatsapp']}', const []),
      const SectionLabel('Quick send'),
      Group([for (final (t, r, m) in msgs) Li(t, sub: '${segMembers(h, r).length} customers', icon: Icons.chat_outlined, tone: const Color(0xFF25D366), onTap: () => sendCenter(context, h, t, r, m))]),
    ]);
  }
}

class LoyaltyCampPage extends StatelessWidget {
  const LoyaltyCampPage(this.h, {super.key});
  final HomeState h;
  @override
  Widget build(BuildContext context) {
    final n = '${h.s.cfg['name']}';
    final rows = [
      ('Reward Gold members', 'gold', 'Hi {name}, as one of our Gold guests, enjoy a special treat on your next visit to $n.'),
      ('Thank Silver members', 'silver', 'Hi {name}, thank you for being a regular at $n. Reach Gold with a few more visits.'),
      ('Win back lapsed guests', 'lapsed', 'Hi {name}, we miss you. Visit $n this week and enjoy a bonus.'),
      ('Birthday wishes', 'bday', 'Happy birthday {name}. Dessert is on us at $n.'),
    ];
    return ListView(padding: const EdgeInsets.only(bottom: 28), children: [
      const PageHead('Loyalty Campaigns', sub: 'Reward your best customers and bring back the ones who stopped coming.'),
      const SizedBox(height: 12),
      Group([for (final (t, r, m) in rows) Li(t, sub: '${segMembers(h, r).length} customers', icon: Icons.favorite_border, tone: Tk.red, onTap: () => sendCenter(context, h, t, r, m))]),
    ]);
  }
}

// ------------------------------------------------------------------ integrations

const platKeys = {'agg/swiggy': 'Swiggy', 'agg/zomato': 'Zomato', 'agg/ondc': 'ONDC', 'agg/dunzo': 'Dunzo', 'agg/ubereats': 'Uber Eats'};

class PlatformPage extends StatefulWidget {
  const PlatformPage(this.h, this.name, {super.key});
  final HomeState h;
  final String name;
  @override
  State<PlatformPage> createState() => _PlatformPageState();
}

class _PlatformPageState extends State<PlatformPage> {
  HomeState get h => widget.h;
  Map<String, dynamic>? get rec => h.s.repo!.of('platform').where((p) => p['name'] == widget.name).firstOrNull;

  Future<void> settings() => formSheet(context, '${widget.name} settings', [F('commission', 'Commission (%)', type: 'number', value: rec?['commission'] ?? 0), F('storeId', 'Store / restaurant ID', value: rec?['storeId']), F('link', 'Partner dashboard link', value: rec?['link']), F('priceMarkup', 'Menu price markup (%)', type: 'number', value: rec?['priceMarkup'] ?? 0), F('active', 'Listed on this platform', type: 'check', value: rec?['active'] != false)], (v) async {
        await h.s.repo!.save('platform', {...?rec, 'name': widget.name, ...v}, id: rec?['id'] as String?);
        setState(() {});
        h.s.sync();
        return true;
      });

  Future<void> addOrder() async {
    final items = h.s.repo!.of('item').toList()..sort((a, b) => '${a['name']}'.compareTo('${b['name']}'));
    if (items.isEmpty) return h.toast('Add menu items first');
    final lines = <Map<String, dynamic>>[];
    final ref = TextEditingController(), name = TextEditingController(), phone = TextEditingController();
    var type = 'Delivery', pay = 'Online';
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (ctx) => StatefulBuilder(builder: (ctx, set) {
        final sub = lines.fold<num>(0, (a, l) => a + (l['price'] as num) * (l['qty'] as num));
        return SafeArea(
          child: Padding(
            padding: EdgeInsets.fromLTRB(16, 0, 16, MediaQuery.of(ctx).viewInsets.bottom + 12),
            child: SingleChildScrollView(
              child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                Text('Add ${widget.name} order', style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800)),
                const SizedBox(height: 12),
                TextField(controller: ref, decoration: InputDecoration(labelText: tr('Platform order ID'))),
                const SizedBox(height: 10),
                Row(children: [Expanded(child: TextField(controller: name, decoration: InputDecoration(labelText: tr('Customer name')))), const SizedBox(width: 10), Expanded(child: TextField(controller: phone, keyboardType: TextInputType.phone, decoration: InputDecoration(labelText: tr('Mobile'))))]),
                const SizedBox(height: 10),
                Seg<String>(expand: true, items: const [('Delivery', 'Delivery'), ('Takeaway', 'Takeaway')], value: type, onChanged: (v) => set(() => type = v)),
                const SizedBox(height: 10),
                Seg<String>(expand: true, items: const [('Online', 'Paid online'), ('Cash', 'Cash on delivery')], value: pay, onChanged: (v) => set(() => pay = v)),
                const SizedBox(height: 10),
                DropdownButtonFormField<String>(
                  initialValue: null,
                  decoration: InputDecoration(labelText: tr('Add item')),
                  items: [for (final i in items) DropdownMenuItem(value: '${i['id']}', child: Text('${i['name']} — ${inr((i['price'] ?? 0) as num)}'))],
                  onChanged: (v) {
                    final it = items.firstWhere((x) => '${x['id']}' == v);
                    final f = lines.where((l) => l['id'] == it['id']).firstOrNull;
                    set(() => f != null ? f['qty'] = (f['qty'] as num) + 1 : lines.add({'id': it['id'], 'name': it['name'], 'size': '', 'price': it['price'] ?? 0, 'qty': 1, 'sent': 1, 'st': it['st'] ?? 'Kitchen'}));
                  },
                ),
                for (final l in lines) ListTile(dense: true, title: Text('${l['qty']} × ${l['name']}'), trailing: Text(inr((l['price'] as num) * (l['qty'] as num))), onLongPress: () => set(() => lines.remove(l))),
                const SizedBox(height: 6),
                Text('Items total (before tax): ${inr(sub)}', textAlign: TextAlign.right, style: const TextStyle(fontWeight: FontWeight.w700)),
                const SizedBox(height: 12),
                FilledButton(
                  onPressed: () async {
                    if (lines.isEmpty) return h.toast('Add at least one item');
                    final o = {
                      'id': uid(), 'type': type, 'table': null, 'lines': lines, 'status': 'paid', 'created': nowIso(), 'paidAt': nowIso(), 'by': h.s.user!['id'], 'paidBy': h.s.user!['id'],
                      'src': widget.name, 'extRef': ref.text.trim(), 'cust': {'name': name.text.trim(), 'phone': phone.text.trim()}, 'kstat': 'done',
                      'no': '${widget.name.substring(0, 3).toUpperCase()}-${ref.text.trim().isEmpty ? DateTime.now().millisecondsSinceEpoch.toString().substring(7) : ref.text.trim()}',
                    };
                    final t = h.s.tot(o);
                    o['t'] = t.toJson();
                    o['pays'] = [{'m': pay == 'Cash' ? 'cash' : 'online', 'amt': t.total, 'at': nowIso()}];
                    await h.s.repo!.save('order', o, id: '${o['id']}');
                    h.s.sync();
                    if (ctx.mounted) Navigator.pop(ctx);
                    if (mounted) setState(() {});
                    h.toast('Order added');
                  },
                  child: const Text('Save order'),
                ),
              ]),
            ),
          ),
        );
      }),
    );
  }

  @override
  Widget build(BuildContext context) {
    final os = h.s.repo!.of('order').where((o) => o['src'] == widget.name && o['status'] != 'void').toList()..sort((a, b) => '${b['created']}'.compareTo('${a['created']}'));
    final rev = os.fold<num>(0, (a, o) => a + totalOf(o));
    final pct = ((rec?['commission'] ?? 0) as num);
    final comm = r2(rev * pct / 100);
    return ListView(padding: const EdgeInsets.only(bottom: 28), children: [
      PageHead(widget.name, sub: 'Orders you enter from ${widget.name}, with commission and payout.', trailing: PillBtn('Add', icon: Icons.add, fill: true, onTap: addOrder)),
      Kpis('Sales', inr(r2(rev)), '${os.length} orders', [('Commission ($pct%)', inr(comm), Tk.orange), ('You earn', inr(r2(rev - comm)), Tk.green)]),
      Padding(padding: const EdgeInsets.fromLTRB(16, 4, 16, 0), child: Row(children: [
        Expanded(child: OutlinedButton(onPressed: settings, child: const Text('Settings'))),
        if (_s(rec?['link']).isNotEmpty) ...[const SizedBox(width: 10), Expanded(child: OutlinedButton(onPressed: () => launchUrl(Uri.parse('${rec!['link']}'), mode: LaunchMode.externalApplication), child: const Text('Partner dashboard')))],
      ])),
      const SectionLabel('Recent orders'),
      if (os.isEmpty) const Empty(Icons.public, 'No orders yet', 'When an order arrives on the platform tablet, add it here so sales and reports stay complete.') else Group([for (final o in os.take(60)) Li('${o['no']}', sub: '${_s(o['extRef'])} ${_s((o['cust'] as Map?)?['name'])}'.trim(), icon: Icons.receipt_long_outlined, value: inr(totalOf(o)), onTap: () => orderSheet(context, h, o))]),
    ]);
  }
}

class ExplorePage extends StatelessWidget {
  const ExplorePage(this.h, {super.key});
  final HomeState h;
  @override
  Widget build(BuildContext context) {
    void web(String host, String p) => launchUrl(Uri.https(host, p), mode: LaunchMode.externalApplication);
    return ListView(padding: const EdgeInsets.only(bottom: 28), children: [
      const PageHead('Explore Products', sub: 'Everything on your AUZslab login.'),
      const SizedBox(height: 12),
      Group([
        Li('Billing POS', sub: 'Take orders, print bills, run the kitchen.', icon: Icons.storefront_outlined, tone: Tk.accent, onTap: () => Navigator.popUntil(context, (r) => r.isFirst)),
        if (h.s.featureOn('payroll')) Li('Payroll', sub: 'Salaries, leave and payslips.', icon: Icons.groups_outlined, tone: Tk.orange, onTap: () => web('app.auzslab.in', '/payroll.html')),
        if (h.s.featureOn('accounting')) Li('Accounting', sub: 'Books, invoices and GST.', icon: Icons.receipt_long_outlined, tone: Tk.green, onTap: () => web('app.auzslab.in', '/accounts.html')),
        if (h.s.featureOn('mobile')) Li('AUZsMob', sub: 'Mobile shop sales and repairs.', icon: Icons.phone_iphone, tone: Tk.blue, onTap: () => web('app.auzslab.in', '/mob.html')),
        Li('Website Builder', sub: 'Build your public website.', icon: Icons.web, tone: Tk.purple, onTap: () => web('app.auzslab.in', '/builder.html')),
        Li('Your public site', sub: 'What guests see, with the QR ordering page.', icon: Icons.language, tone: Tk.teal, onTap: () => launchUrl(Uri.https('${h.s.slug}.auzslab.in', '/site.html'), mode: LaunchMode.externalApplication)),
      ]),
    ]);
  }
}

class FavoritesPage extends StatefulWidget {
  const FavoritesPage(this.go, {super.key});
  final void Function(String) go;
  @override
  State<FavoritesPage> createState() => _FavoritesPageState();
}

class _FavoritesPageState extends State<FavoritesPage> {
  Set<String> fav = {};
  @override
  void initState() {
    super.initState();
    SharedPreferences.getInstance().then((p) {
      if (mounted) setState(() => fav = (p.getStringList('console.favs') ?? []).toSet());
    });
  }

  Future<void> toggle(String id) async {
    setState(() => fav.contains(id) ? fav.remove(id) : fav.add(id));
    (await SharedPreferences.getInstance()).setStringList('console.favs', fav.toList());
  }

  @override
  Widget build(BuildContext context) {
    final pages = <(String, String)>[for (final n in consoleNav) if (n is CNode) ...[if (n.kids.isEmpty) (n.id, n.label), ...n.kids]];
    return ListView(padding: const EdgeInsets.only(bottom: 28), children: [
      const PageHead('Favourite Pages', sub: 'Star the pages you use most.'),
      if (fav.isNotEmpty) ...[const SectionLabel('Your favourites'), Group([for (final (id, l) in pages.where((p) => fav.contains(p.$1))) Li(l, icon: Icons.star, tone: Tk.orange, onTap: () => widget.go(id))])],
      const SectionLabel('All pages'),
      Group([for (final (id, l) in pages) Li(l, chevron: false, trailing: IconButton(icon: Icon(fav.contains(id) ? Icons.star : Icons.star_border, color: fav.contains(id) ? Tk.orange : Tk.label3), onPressed: () => toggle(id)), onTap: () => widget.go(id))]),
    ]);
  }
}

class ShortcutsPage extends StatelessWidget {
  const ShortcutsPage(this.h, this.go, {super.key});
  final HomeState h;
  final void Function(String) go;
  @override
  Widget build(BuildContext context) => ListView(padding: const EdgeInsets.only(bottom: 28), children: [
        const PageHead('Shortcuts', sub: 'Jump straight to a common job.'),
        const SizedBox(height: 12),
        Group([
          Li('Add expense', icon: Icons.payments_outlined, tone: Tk.orange, onTap: () => go('fin/expenses')),
          Li('New menu item', icon: Icons.restaurant_menu, tone: Tk.green, onTap: () => go('menu/items')),
          Li('Record purchase', icon: Icons.shopping_cart_outlined, tone: Tk.teal, onTap: () => go('inv/purchase')),
          Li('Issue gift card', icon: Icons.card_giftcard, tone: Tk.purple, onTap: () => go('crm/giftcards')),
          Li('New task', icon: Icons.checklist, tone: Tk.blue, onTap: () => go('team/tasks')),
          Li('New campaign', icon: Icons.campaign_outlined, tone: Tk.red, onTap: () => go('mkt/campaigns')),
          Li('Open billing POS', icon: Icons.storefront_outlined, tone: Tk.accent, onTap: () => Navigator.popUntil(context, (r) => r.isFirst)),
        ]),
      ]);
}

// ------------------------------------------------------------------ management

class HardwarePage extends StatefulWidget {
  const HardwarePage(this.h, {super.key});
  final HomeState h;
  @override
  State<HardwarePage> createState() => _HardwarePageState();
}

class _HardwarePageState extends State<HardwarePage> {
  Future<void> set(String k, bool v) async {
    final s = widget.h.s;
    await s.repo!.save('settings', {...s.cfg, k: v}, id: 'settings');
    s.sync();
    setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    final c = widget.h.s.cfg;
    return ListView(padding: const EdgeInsets.only(bottom: 28), children: [
      const PageHead('Hardware', sub: 'Off by default. Only turn one on if you have that setup.'),
      const SizedBox(height: 12),
      Group([
        Li('Barcode scanner', sub: 'Adds a Barcode field to items. Works with any USB or Bluetooth scanner in keyboard mode.', icon: Icons.qr_code_scanner, tone: Tk.teal, chevron: false, trailing: Switch(value: c['hwBarcode'] == true, onChanged: widget.h.s.can('o') ? (v) => set('hwBarcode', v) : null)),
        Li('Token display screen', sub: 'Shows ready-for-pickup numbers on a spare tablet or monitor.', icon: Icons.tv, tone: Tk.purple, chevron: false, trailing: Switch(value: c['hwToken'] == true, onChanged: widget.h.s.can('o') ? (v) => set('hwToken', v) : null)),
      ]),
    ]);
  }
}

const _auditLabel = {
  'bill_paid': 'Bill paid', 'bill_credit': 'Credit bill', 'bill_void': 'Bill cancelled', 'refund': 'Refund', 'return': 'Return', 'discount': 'Discount', 'complimentary': 'Complimentary', 'reprint': 'Bill reprinted', 'kot_cancel': 'Cancelled after KOT',
  'settings_change': 'Settings changed', 'item_add': 'Item added', 'item_delete': 'Item deleted', 'price_change': 'Price changed', 'coupon_add': 'Coupon added', 'coupon_change': 'Coupon changed', 'coupon_delete': 'Coupon deleted', 'giftcard_add': 'Gift card issued',
  'cash_in': 'Cash in', 'cash_out': 'Cash out', 'register_open': 'Register opened', 'register_close': 'Register closed', 'day_close': 'Day closed', 'day_reopen': 'Day reopened',
};

class AuditPage extends StatefulWidget {
  const AuditPage(this.h, {super.key});
  final HomeState h;
  @override
  State<AuditPage> createState() => _AuditPageState();
}

class _AuditPageState extends State<AuditPage> {
  late Future<List<Map<String, dynamic>>> f = widget.h.s.api.select('pos_audit', order: 'at', limit: 400);
  @override
  Widget build(BuildContext context) => FutureBuilder(
        future: f,
        builder: (_, snap) {
          if (snap.connectionState != ConnectionState.done) return const Center(child: CircularProgressIndicator());
          if (snap.hasError) return Empty(Icons.cloud_off, 'Could not load the audit trail', 'Check your internet and try again.', action: 'Try again', onAction: () => setState(() => f = widget.h.s.api.select('pos_audit', order: 'at', limit: 400)));
          final rows = snap.data!.reversed.toList();
          Color tone(String a) => RegExp('void|delete|refund|cancel|return|complimentary|error').hasMatch(a) ? Tk.red : RegExp('discount|price|reprint').hasMatch(a) ? Tk.orange : Tk.blue;
          return ListView(padding: const EdgeInsets.only(bottom: 28), children: [
            const PageHead('Audit Trail', sub: 'Written by the database on every sensitive change. It cannot be edited or deleted.'),
            const SizedBox(height: 12),
            if (rows.isEmpty) const Empty(Icons.shield_outlined, 'Nothing recorded yet', 'Payments, cancellations, refunds, discounts, price and settings changes appear here.') else Group([
              for (final r in rows)
                Li(_auditLabel['${r['action']}'] ?? '${r['action']}', sub: '${_s(r['at']).length > 16 ? _s(r['at']).substring(0, 16).replaceFirst('T', ' ') : ''} · ${_s(r['actor_role'])}${_s(r['ref']).isEmpty ? '' : ' · ${r['ref']}'}${_s(r['reason']).isEmpty ? '' : ' · ${r['reason']}'}${_s(r['approved_by']).isEmpty ? '' : ' · approved by ${r['approved_by']}'}', icon: Icons.shield_outlined, tone: tone('${r['action']}'), value: r['amount'] == null ? null : inr(r['amount'] as num), chevron: false),
            ]),
          ]);
        },
      );
}

class LogsPage extends StatelessWidget {
  const LogsPage(this.h, {super.key});
  final HomeState h;
  @override
  Widget build(BuildContext context) {
    final r = h.s.repo!;
    final acts = <(String, String, String)>[];
    void add(String kind, String type, String Function(Map<String, dynamic>) f) {
      for (final x in r.of(kind)) {
        acts.add(('${x['at'] ?? x['created'] ?? x['createdAt'] ?? x['d'] ?? ''}', type, f(x)));
      }
    }

    add('voidlog', 'Void', (x) => '${x['item'] ?? 'Order ${x['no'] ?? ''}'} · ${_s(x['reason'])}');
    add('cashmove', 'Cash drawer', (x) => '${x['type'] == 'in' ? 'Top-up' : 'Withdrawal'} ₹${x['amt']} · ${_s(x['note'])}');
    add('dayclose', 'Day close', (x) => '${_s(x['d'])} · difference ₹${x['variance'] ?? 0}');
    add('exp', 'Expense', (x) => '₹${x['amt']} · ${_s(x['cat'])}');
    add('waste', 'Wastage', (x) => '${x['q']} ${_s(x['ing'])} · ${_s(x['reason'])}');
    add('adjustment', 'Stock adjustment', (x) => '${x['q']} ${_s(x['ing'])}');
    // Found during integration verification: transfer() (admin.dart StockAdmin) writes a `transfer`
    // record exactly like the website's own transferForm(), but nothing in the app ever showed it --
    // the website's equivalent Movements tab does list transfers. Same field names (`from`/`to`
    // already resolved to outlet/area display names by the writer).
    add('transfer', 'Stock transfer', (x) => '${x['q']} ${_s(x['ing'])} · ${_s(x['from'])} → ${_s(x['to'])}');
    add('settlement', 'Settlement', (x) => '${_s(x['platform'])} ₹${x['amt']}');
    acts.removeWhere((e) => e.$1.isEmpty);
    acts.sort((a, b) => b.$1.compareTo(a.$1));
    return ListView(padding: const EdgeInsets.only(bottom: 28), children: [
      const PageHead('User Logs', sub: 'Recent activity: voids, cash, expenses, stock.'),
      const SizedBox(height: 12),
      if (acts.isEmpty) const Empty(Icons.history, 'Nothing recorded yet', 'Activity shows up here as your team works.') else Group([for (final a in acts.take(150)) Li(a.$2, sub: '${a.$1.length >= 10 ? a.$1.substring(0, 10) : a.$1} · ${a.$3}', icon: Icons.history, chevron: false)]),
    ]);
  }
}

// ------------------------------------------------------------------ CRM

class LoyaltyPage extends StatefulWidget {
  const LoyaltyPage(this.h, {super.key});
  final HomeState h;
  @override
  State<LoyaltyPage> createState() => _LoyaltyPageState();
}

class _LoyaltyPageState extends State<LoyaltyPage> {
  Future<void> save(Map<String, dynamic> p) async {
    final s = widget.h.s;
    await s.repo!.save('settings', {...s.cfg, ...p}, id: 'settings');
    s.sync();
    setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    final h = widget.h;
    final c = h.s.cfg;
    final all = custs(h)..sort((a, b) => b.spend.compareTo(a.spend));
    final owner = h.s.can('o');
    Future<void> num_(String k, String t) => formSheet(context, t, [F('v', t, type: 'number', value: c[k])], (v) async {
          await save({k: v['v']});
          return true;
        });
    return ListView(padding: const EdgeInsets.only(bottom: 28), children: [
      const PageHead('Loyalty Program', sub: 'Customers earn points on every bill and spend them at the POS.'),
      Kpis('Members', '${all.length}', 'Gold ${all.where((x) => x.tier == 'Gold').length} · Silver ${all.where((x) => x.tier == 'Silver').length}', const []),
      const SectionLabel('Rules'),
      Group([
        Li('Loyalty program', sub: 'Show points and redemption on the billing POS.', icon: Icons.favorite_border, tone: Tk.red, chevron: false, trailing: Switch(value: c['loyaltyOn'] == true, onChanged: owner ? (v) => save({'loyaltyOn': v}) : null)),
        Li('Spend per point (₹)', sub: 'A customer earns 1 point for every this many rupees.', icon: Icons.stars_outlined, value: '${c['loyaltyEarnRs'] ?? ''}', onTap: owner ? () => num_('loyaltyEarnRs', 'Spend per point (₹)') : null),
        Li('Value of a point (₹)', sub: 'Discount given per point redeemed.', icon: Icons.redeem, value: '${c['loyaltyRedeemRs'] ?? ''}', onTap: owner ? () => num_('loyaltyRedeemRs', 'Value of a point (₹)') : null),
      ]),
      const SectionLabel('Top members'),
      Group(all.isEmpty ? [const Li('No members yet', chevron: false)] : [for (final x in all.take(20)) Li(x.name.isEmpty ? x.phone : x.name, sub: '${x.tier} · ${x.visits} visits', icon: Icons.person_outline, chevron: false, value: inr(r2(x.spend)))]),
    ]);
  }
}

class FeedbackPage extends StatelessWidget {
  const FeedbackPage(this.h, {super.key});
  final HomeState h;
  @override
  Widget build(BuildContext context) {
    final fb = h.s.repo!.of('feedback').toList()..sort((a, b) => '${b['at'] ?? b['created']}'.compareTo('${a['at'] ?? a['created']}'));
    num rating(Map f) => (f['rating'] ?? f['stars'] ?? 0) as num;
    final avg = fb.isEmpty ? 0 : r2(fb.fold<num>(0, (a, f) => a + rating(f)) / fb.length);
    return ListView(padding: const EdgeInsets.only(bottom: 28), children: [
      const PageHead('Feedback', sub: 'What guests say after they order.'),
      Kpis('Average rating', '$avg / 5', '${fb.length} responses', [('Low ratings (1–2)', '${fb.where((f) => rating(f) <= 2).length}', Tk.red)]),
      const SizedBox(height: 8),
      if (fb.isEmpty) const Empty(Icons.rate_review_outlined, 'No feedback yet', 'Ratings given on the bill link and QR page appear here.') else Group([
        for (final f in fb.take(50)) Li('${rating(f)} ★  ${_s(f['comment'] ?? f['text'] ?? f['note'])}', sub: _s(f['at'] ?? f['created']).length >= 10 ? _s(f['at'] ?? f['created']).substring(0, 10) : '', icon: Icons.star, tone: rating(f) <= 2 ? Tk.red : rating(f) >= 4 ? Tk.green : Tk.orange, chevron: false),
      ]),
    ]);
  }
}

// ------------------------------------------------------------------ finance

class _DayCash {
  _DayCash(this.cash, this.card, this.other, this.online, this.expected, this.close, this.sales, this.bills);
  final double cash, card, other, online, expected, sales;
  final int bills;
  final Map<String, dynamic>? close;
  double get total => cash + card + other + online;
}

_DayCash dayCash(Repo repo, String d) {
  double cash = 0, card = 0, other = 0, online = 0, sales = 0;
  var bills = 0;
  for (final o in repo.of('order').where((o) => o['status'] == 'paid' && dayOfIso(o['paidAt']) == d)) {
    bills++;
    sales += totalOf(o);
    // Change given back on a cash sale leaves the drawer with the drawer; it must not inflate expected cash,
    // same subtraction as the website's cashIn in dayCash() (app/public/console/p-finance.js).
    final change = ((o['change'] ?? 0) as num).toDouble();
    final paysCash = ((o['pays'] as List?) ?? []).cast<Map>().any((p) => '${p['m']}' == 'cash');
    for (final p in ((o['pays'] as List?) ?? []).cast<Map>()) {
      final a = ((p['amt'] ?? 0) as num).toDouble();
      switch ('${p['m']}') {
        case 'cash':
          cash += a;
        case 'card':
          card += a;
        case 'online':
          online += a;
        default:
          other += a;
      }
    }
    if (paysCash) cash -= change;
  }
  final moves = repo.of('cashmove').where((x) => '${x['d']}' == d);
  final ins = moves.where((x) => x['type'] == 'in').fold<double>(0, (a, x) => a + ((x['amt'] ?? 0) as num));
  final outs = moves.where((x) => x['type'] != 'in').fold<double>(0, (a, x) => a + ((x['amt'] ?? 0) as num));
  final exp = repo.of('exp').where((x) => '${x['d']}' == d && (x['mode'] ?? 'cash') == 'cash').fold<double>(0, (a, x) => a + ((x['amt'] ?? 0) as num));
  final close = repo.of('dayclose').where((x) => '${x['d']}' == d).firstOrNull;
  return _DayCash(cash, card, other, online, r2(cash + ins - outs - exp).toDouble(), close, sales, bills);
}

/// Day-close reminder: a past day that had real paid business on it but has not been closed yet.
/// Built directly on dayCash() above -- no second closing system, no separate financial
/// calculation of its own. See findDayNeedingClose()'s own doc comment for the exact rule.
class OpenDayNeedingClose {
  OpenDayNeedingClose(this.date, this.sales, this.bills, this.expected);
  final String date; // 'YYYY-MM-DD'
  final double sales, expected;
  final int bills;
}

/// Finds the single most recent day that genuinely needs closing, or null if there is none to
/// report. "Genuinely needs closing" means, in order:
///   1. It is a day BEFORE today -- today itself is still in progress and is never flagged (the
///      website's own 14-day table, fin/cash, calls today "Open", never "Not closed", for exactly
///      this reason).
///   2. It has at least one paid bill (`bills > 0`) -- a day the shop was simply closed (a Sunday,
///      a holiday) has nothing to close and is silently skipped, never reported as overdue.
///   3. It has no `dayclose` record of its own yet (dayCash()'s own `close` field -- the exact same
///      lookup dayCloseOf() does on the website, never a second, parallel check).
///
/// The scan walks backward from yesterday and STOPS the moment it reaches a day that IS already
/// closed -- the business is considered "caught up" from that point backward, so an older gap
/// behind an already-closed day is never surfaced (closing is expected to happen in order; if that
/// assumption is ever wrong for a real tenant, this under-reports rather than over-reports, the
/// safer direction for a reminder that must never claim something that isn't true). A day with
/// zero bills does NOT stop the scan -- it is skipped so a still-older open day behind a quiet
/// Sunday is not hidden by it. [lookbackDays] bounds how far back the scan goes (default 14,
/// matching this app's own existing 14-day cash/reconciliation window) so this can never become an
/// unbounded loop over a tenant's entire history.
///
/// Reads only the LOCAL Repo (the same data dayCash() already reads), so it is exactly as
/// offline-capable, and exactly as honest about not-yet-synced data, as the Cash Management screen
/// already is -- not a new capability and not a new gap. It never writes anything, so calling it
/// repeatedly (e.g. on every rebuild) can never duplicate an alert or a closing record; it simply
/// stops returning a day the moment that day's own `dayclose` record exists.
OpenDayNeedingClose? findDayNeedingClose(Repo repo, {DateTime? now, int lookbackDays = 14}) {
  final today = now ?? DateTime.now();
  for (var i = 1; i <= lookbackDays; i++) {
    final d = dayKey(today.subtract(Duration(days: i)));
    final s = dayCash(repo, d);
    if (s.close != null) break;
    if (s.bills > 0) return OpenDayNeedingClose(d, s.sales, s.bills, s.expected);
  }
  return null;
}

class CashPage extends StatefulWidget {
  const CashPage(this.h, {super.key});
  final HomeState h;
  @override
  State<CashPage> createState() => _CashPageState();
}

class _CashPageState extends State<CashPage> {
  DateTime day = DateTime.now();
  HomeState get h => widget.h;

  @override
  void initState() {
    super.initState();
    // Day-close navigation fix: a one-shot date stashed by the Alerts Center's 'dayclose' alert
    // (console.dart's _actionRow) -- open directly on that day instead of today, then consume it
    // so a later, unrelated visit to Cash from the nav drawer is never affected by a stale value.
    final pending = h.pendingCashDay;
    if (pending != null) {
      final parsed = DateTime.tryParse(pending);
      if (parsed != null) day = parsed;
      h.pendingCashDay = null;
    }
  }

  @override
  Widget build(BuildContext context) {
    final d = dayKey(day);
    final s = dayCash(h.s.repo!, d);
    final c = s.close;
    // Day-close reminder: a read-only check (findDayNeedingClose() never writes anything) run fresh
    // on every build, so it disappears by itself the moment the day it names is actually closed --
    // no flag to clear, no separate "dismiss" state to go stale. Hidden once it's naming the exact
    // day already on screen, since that day's own Close button right below already covers it.
    final reminder = findDayNeedingClose(h.s.repo!);
    return ListView(padding: const EdgeInsets.only(bottom: 28), children: [
      const PageHead('Cash', sub: 'Expected cash in the drawer and day close.'),
      if (reminder != null && reminder.date != d)
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 10, 16, 0),
          child: Group([
            Li(
              '${reminder.date} is not closed yet',
              sub: '${reminder.bills} bill${reminder.bills == 1 ? '' : 's'} · ${inr(r2(reminder.sales))} sales',
              icon: Icons.lock_open_outlined,
              tone: Tk.orange,
              trailing: OutlinedButton(onPressed: () => setState(() => day = DateTime.parse(reminder.date)), child: const Text('Review')),
              chevron: false,
            ),
          ]),
        ),
      Padding(padding: const EdgeInsets.fromLTRB(16, 10, 16, 0), child: Row(children: [
        IconButton.filledTonal(onPressed: () => setState(() => day = day.subtract(const Duration(days: 1))), icon: const Icon(Icons.chevron_left)),
        Expanded(child: Center(child: Text(d, style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800)))),
        IconButton.filledTonal(onPressed: dayKey(day) == dayKey(DateTime.now()) ? null : () => setState(() => day = day.add(const Duration(days: 1))), icon: const Icon(Icons.chevron_right)),
      ])),
      Kpis('Expected cash', inr(s.expected), 'Cash sales + top-ups − expenses − withdrawals', [('Cash sales', inr(r2(s.cash)), null), ('Card', inr(r2(s.card)), null), ('UPI / other', inr(r2(s.other)), null), ('Online', inr(r2(s.online)), null)]),
      const SizedBox(height: 10),
      if (c != null)
        Group([Li('Day closed', sub: 'Counted ₹${c['countedCash']} · difference ₹${c['variance'] ?? 0}${_s(c['varianceReason']).isEmpty ? '' : ' · ${c['varianceReason']}'}', icon: Icons.lock_outline, tone: ((c['variance'] ?? 0) as num).abs() > .5 ? Tk.red : Tk.green, chevron: false)])
      else
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          child: Row(children: [
            Expanded(child: OutlinedButton(onPressed: () async {
              final counted = await _denomSheet(context, s.expected, d);
              if (counted != null) await _closeDialog(d, s, counted);
            }, child: const Text('Count by denomination'))),
            const SizedBox(width: 10),
            Expanded(child: FilledButton(onPressed: () => _closeDialog(d, s, s.expected), child: const Text('Enter total'))),
          ]),
        ),
    ]);
  }

  /// The confirm-and-save step shared by both Day Close paths (a typed total, or a denomination
  /// count that produced one) -- same `closeDay()` the website funnels into either way
  /// (denomForm()'s own "Use this count" button calls `closeDay(d,t)` with the counted total).
  Future<void> _closeDialog(String d, _DayCash s, num defaultCounted) => formSheet(context, 'Close $d', [F('counted', 'Cash actually counted (₹)', type: 'number', value: defaultCounted), F('reason', 'Reason for any difference', type: 'select', value: '', options: const [['', 'No difference'], ['Counting error', 'Counting error'], ['Change given short', 'Change given short'], ['Cash taken without entry', 'Cash taken without entry'], ['Tip paid out', 'Tip paid out'], ['Other', 'Other']])], (v) async {
        if (v['counted'] == null) return false;
        final variance = r2((v['counted'] as num) - s.expected);
        // Same guard as closeDay() on the website: a variance over 50 paise needs a reason picked.
        if (variance.abs() > .5 && '${v['reason'] ?? ''}'.isEmpty) {
          if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Pick a reason for the difference')));
          return false;
        }
        await h.s.repo!.save('dayclose', {'d': d, 'sales': s.sales, 'bills': s.bills, 'expectedCash': s.expected, 'countedCash': v['counted'], 'variance': variance, 'varianceReason': '${v['reason'] ?? ''}'.isEmpty ? null : v['reason'], 'at': nowIso(), 'by': h.s.user!['id']});
        h.s.sync();
        setState(() {});
        return true;
      });

  /// Count the drawer note by note/coin by coin -- same breakdown (and the same ₹2000 note) as
  /// denomForm() in the website's app/public/console/p-finance.js. Returns the counted total, or
  /// null if the manager cancelled -- nothing is saved here; the caller still runs the same
  /// variance/reason confirmation as every other Day Close path.
  Future<num?> _denomSheet(BuildContext context, num expected, String d) {
    final counts = <int, int>{};
    return showModalBottomSheet<num?>(
      context: context,
      isScrollControlled: true,
      builder: (ctx) => StatefulBuilder(builder: (ctx, set) {
        final total = denomTotal(counts);
        return SafeArea(
          child: Padding(
            padding: EdgeInsets.fromLTRB(16, 0, 16, MediaQuery.of(ctx).viewInsets.bottom + 16),
            child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              Padding(padding: const EdgeInsets.symmetric(vertical: 14), child: Text('Count the drawer — $d', textAlign: TextAlign.center, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700))),
              Text('Enter how many of each note or coin are in the drawer.', textAlign: TextAlign.center, style: TextStyle(color: Tk.label2)),
              const SizedBox(height: 10),
              Flexible(
                child: ListView(shrinkWrap: true, children: [
                  for (final n in dayCloseDenoms)
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: 4),
                      child: Row(children: [
                        Expanded(child: Text('₹$n', style: const TextStyle(fontWeight: FontWeight.w700))),
                        SizedBox(width: 84, child: TextField(keyboardType: TextInputType.number, textAlign: TextAlign.center, decoration: const InputDecoration(isDense: true, hintText: '0'), onChanged: (v) => set(() => counts[n] = int.tryParse(v) ?? 0))),
                        SizedBox(width: 72, child: Text(inr(n * (counts[n] ?? 0)), textAlign: TextAlign.right)),
                      ]),
                    ),
                ]),
              ),
              const Divider(),
              Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [const Text('Counted total', style: TextStyle(fontWeight: FontWeight.w700)), Text(inr(total), style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800))]),
              Text('Expected ${inr(expected)}', style: TextStyle(color: Tk.label2, fontSize: 13)),
              const SizedBox(height: 14),
              Row(children: [
                Expanded(child: OutlinedButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel'))),
                const SizedBox(width: 8),
                Expanded(child: FilledButton(onPressed: () => Navigator.pop(ctx, total), child: const Text('Use this count'))),
              ]),
            ]),
          ),
        );
      }),
    );
  }
}

class ReconcilePage extends StatelessWidget {
  const ReconcilePage(this.h, {super.key});
  final HomeState h;
  @override
  Widget build(BuildContext context) {
    final days = [for (var i = 0; i < 14; i++) DateTime.now().subtract(Duration(days: i))];
    return ListView(padding: const EdgeInsets.only(bottom: 28), children: [
      const PageHead('Reconciliation', sub: 'Cash counted against cash expected, last 14 days.'),
      const SizedBox(height: 12),
      Group([
        for (final dt in days)
          () {
            final d = dayKey(dt);
            final s = dayCash(h.s.repo!, d);
            final c = s.close;
            final diff = c == null ? 0 : ((c['variance'] ?? 0) as num);
            final label = c == null ? (d == dayKey(DateTime.now()) ? 'Open' : (s.total == 0 ? '—' : 'Not closed')) : diff.abs() > .5 ? 'Off by ₹$diff' : 'Matched';
            return Li(d, sub: 'Sales ${inr(r2(s.total))} · expected cash ${inr(s.expected)}${c != null ? ' · counted ₹${c['countedCash']}' : ''}', icon: Icons.fact_check_outlined, tone: c == null ? Tk.orange : diff.abs() > .5 ? Tk.red : Tk.green, value: label, chevron: false);
          }(),
      ]),
    ]);
  }
}

class AccountingPage extends StatefulWidget {
  const AccountingPage(this.h, {super.key});
  final HomeState h;
  @override
  State<AccountingPage> createState() => _AccountingPageState();
}

class _AccountingPageState extends State<AccountingPage> {
  int days = 30;
  @override
  Widget build(BuildContext context) {
    final h = widget.h;
    final paid = paidIn(h.s.repo!, days);
    final from = dayKey(DateTime.now().subtract(Duration(days: days - 1)));
    double revenue = 0, tax = 0, disc = 0;
    final rate = <String, (double, double)>{};
    for (final o in paid) {
      final t = (o['t'] as Map?) ?? {};
      revenue += ((t['total'] ?? 0) as num).toDouble();
      tax += ((t['tax'] ?? 0) as num).toDouble();
      disc += ((t['d'] ?? 0) as num).toDouble();
      for (final e in ((t['rates'] as Map?) ?? {}).entries) {
        final v = e.value as Map;
        final c = rate[e.key] ?? (0.0, 0.0);
        rate['${e.key}'] = (c.$1 + ((v['base'] ?? 0) as num), c.$2 + ((v['tax'] ?? 0) as num));
      }
    }
    final exp = h.s.repo!.of('exp').where((e) => '${e['d']}'.compareTo(from) >= 0).fold<double>(0, (a, e) => a + ((e['amt'] ?? 0) as num));
    final net = revenue - tax;
    final profit = net - exp;
    return ListView(padding: const EdgeInsets.only(bottom: 28), children: [
      RangeBar(days, (v) => setState(() => days = v)),
      Kpis('Profit (rough)', inr(r2(profit)), 'Net sales − expenses', [('Net sales', inr(r2(net)), null), ('Expenses', inr(r2(exp)), Tk.orange), ('GST collected', inr(r2(tax)), null), ('Discounts', inr(r2(disc)), null)]),
      const SectionLabel('Profit and loss'),
      Group([Li('Gross sales (with tax)', value: inr(r2(revenue)), chevron: false), Li('Less GST', value: '−${inr(r2(tax))}', chevron: false), Li('Net sales', value: inr(r2(net)), chevron: false), Li('Less expenses', value: '−${inr(r2(exp))}', chevron: false), Li('Profit', value: inr(r2(profit)), chevron: false, titleColor: profit >= 0 ? Tk.green : Tk.red)]),
      const SectionLabel('GST by rate'),
      Group(rate.isEmpty ? [const Li('No tax in this range', chevron: false)] : [for (final e in rate.entries) Li('${e.key}%', sub: 'Taxable ${inr(r2(e.value.$1))}', chevron: false, value: inr(r2(e.value.$2)))]),
    ]);
  }
}

// ------------------------------------------------------------------ team

class UsersPage extends StatefulWidget {
  const UsersPage(this.h, {super.key});
  final HomeState h;
  @override
  State<UsersPage> createState() => _UsersPageState();
}

const _permKeys = [('pos', 'Sell (POS)'), ('orders', 'Orders'), ('kitchen', 'Kitchen Display'), ('reports', 'Reports'), ('staff', 'Staff (view)'), ('inventory', 'Stock'), ('crm', 'Customers'), ('menu', 'Menu'), ('settings', 'Business Settings'), ('billing', 'Billing / Refunds')];

class _UsersPageState extends State<UsersPage> {
  String view = 'people';
  late Future<List<Map<String, dynamic>>> people = _load();
  late Future<List<Map<String, dynamic>>> roles = widget.h.s.api.select('roles', select: 'id,name,permissions');
  HomeState get h => widget.h;
  Future<List<Map<String, dynamic>>> _load() => h.s.api.select('profiles', select: 'id,name,username,role,login_off,phone,role_id');
  void reload() => setState(() => people = _load());

  Future<void> addStaff() async {
    if (!h.s.can('o')) return h.toast('Only the owner can add staff');
    await formSheet(context, 'Add staff', [F('name', 'Name', value: ''), F('phone', 'Mobile number'), F('role', 'Role', type: 'select', value: 'cashier', options: const [['cashier', 'Cashier'], ['manager', 'Manager']])], (v) async {
      if ('${v['name']}'.isEmpty) return false;
      try {
        final r = await h.s.api.rpc('staff_create', {'p_name': v['name'], 'p_phone': v['phone'], 'p_role_id': null, 'p_builtin': v['role'] == 'manager' ? 'manager' : null, 'p_outlet': null, 'p_username': null});
        if (mounted && r is Map) {
          await showDialog<void>(context: context, builder: (d) => AlertDialog(title: const Text('Staff added'), content: Text('Sign in with the Staff tab:\n\nUsername: ${r['username']}\nPIN: ${r['pin']}\n\nShown once. Write it down.'), actions: [FilledButton(onPressed: () => Navigator.pop(d), child: const Text('Done'))]));
        }
        reload();
        return true;
      } catch (e) {
        h.toast('$e');
        return false;
      }
    });
  }

  Future<void> person(Map<String, dynamic> p) async {
    if (p['role'] == 'owner') return h.toast('The owner account cannot be changed here');
    await showModalBottomSheet<void>(
      context: context,
      builder: (ctx) => SafeArea(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Text('${p['name'] ?? p['username']}', style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800)),
          Text('${p['role']}${p['username'] != null ? ' · ${p['username']}' : ''}', style: TextStyle(color: Tk.label2)),
          const SizedBox(height: 12),
          Group([
            if (p['username'] != null) Li('Reset PIN', icon: Icons.password, tone: Tk.orange, onTap: () async {
                  Navigator.pop(ctx);
                  try {
                    final r = await h.s.api.rpc('staff_reset_pin', {'p_staff_id': p['id'], 'p_pin': null});
                    if (mounted) await showDialog<void>(context: context, builder: (d) => AlertDialog(title: const Text('New PIN'), content: Text(r is Map ? 'PIN: ${r['pin']}' : '$r'), actions: [FilledButton(onPressed: () => Navigator.pop(d), child: const Text('Done'))]));
                  } catch (e) {
                    h.toast('$e');
                  }
                }),
            Li(p['login_off'] == true ? 'Turn login on' : 'Turn login off', icon: Icons.block, tone: Tk.red, onTap: () async {
              Navigator.pop(ctx);
              try {
                await h.s.api.rpc('staff_set_active', {'p_staff_id': p['id'], 'p_active': p['login_off'] == true});
                reload();
              } catch (e) {
                h.toast('$e');
              }
            }),
          ]),
          const SizedBox(height: 12),
        ]),
      ),
    );
  }

  Future<void> editRole(Map<String, dynamic>? r) async {
    final name = TextEditingController(text: _s(r?['name']));
    final perms = <String, bool>{for (final (k, _) in _permKeys) k: ((r?['permissions'] as Map?)?[k]) == true};
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (ctx) => StatefulBuilder(builder: (ctx, set) => SafeArea(
            child: Padding(
              padding: EdgeInsets.fromLTRB(16, 0, 16, MediaQuery.of(ctx).viewInsets.bottom + 12),
              child: SingleChildScrollView(child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                Text(r == null ? 'New role' : 'Role · ${r['name']}', style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800)),
                const SizedBox(height: 10),
                TextField(controller: name, decoration: InputDecoration(labelText: tr('Role name'))),
                for (final (k, l) in _permKeys) SwitchListTile(contentPadding: EdgeInsets.zero, title: Text(l), value: perms[k] == true, onChanged: (v) => set(() => perms[k] = v)),
                FilledButton(
                  onPressed: () async {
                    if (name.text.trim().isEmpty) return;
                    try {
                      if (r == null) {
                        await h.s.api.insert('roles', {'name': name.text.trim(), 'permissions': perms});
                      } else {
                        await h.s.api.update('roles', 'id', '${r['id']}', {'name': name.text.trim(), 'permissions': perms});
                      }
                      if (ctx.mounted) Navigator.pop(ctx);
                      setState(() => roles = h.s.api.select('roles', select: 'id,name,permissions'));
                    } catch (e) {
                      h.toast('$e');
                    }
                  },
                  child: const Text('Save role'),
                ),
              ])),
            ),
          )),
    );
  }

  @override
  Widget build(BuildContext context) => ListView(padding: const EdgeInsets.only(bottom: 28), children: [
        PageHead('Users & Roles', sub: 'Who can sign in and what they can do.', trailing: PillBtn('Add', icon: Icons.add, fill: true, onTap: view == 'people' ? addStaff : () => editRole(null))),
        Padding(padding: const EdgeInsets.fromLTRB(16, 10, 16, 10), child: Seg<String>(expand: true, items: const [('people', 'People'), ('roles', 'Roles')], value: view, onChanged: (v) => setState(() => view = v))),
        FutureBuilder(
          future: view == 'people' ? people : roles,
          builder: (_, snap) {
            if (snap.connectionState != ConnectionState.done) return const Padding(padding: EdgeInsets.all(40), child: Center(child: CircularProgressIndicator()));
            if (snap.hasError) return const Empty(Icons.cloud_off, 'Could not load', 'Check your internet and try again.');
            final rows = snap.data!;
            if (view == 'roles') {
              return rows.isEmpty ? const Empty(Icons.admin_panel_settings_outlined, 'No custom roles', 'Staff are Cashier or Manager by default. Add a role to give someone only some permissions.') : Group([for (final r in rows) Li('${r['name']}', sub: _permKeys.where((p) => ((r['permissions'] as Map?)?[p.$1]) == true).map((p) => p.$2).join(', '), icon: Icons.admin_panel_settings_outlined, tone: Tk.purple, onTap: () => editRole(r))]);
            }
            return Group([for (final p in rows) Li('${p['name'] ?? p['username'] ?? 'Team member'}', sub: '${p['role']}${p['username'] != null ? ' · ${p['username']}' : ''}${p['login_off'] == true ? ' · login off' : ''}', icon: p['role'] == 'owner' ? Icons.star : Icons.person_outline, tone: p['role'] == 'owner' ? Tk.orange : Tk.accent, onTap: () => person(p))]);
          },
        ),
      ]);
}

class PayrollLinkPage extends StatelessWidget {
  const PayrollLinkPage(this.h, {super.key});
  final HomeState h;
  @override
  Widget build(BuildContext context) => ListView(padding: const EdgeInsets.only(bottom: 28), children: [
        const PageHead('Payroll', sub: 'Salaries, leave and payslips.'),
        const SizedBox(height: 12),
        Group([Li(h.s.featureOn('payroll') ? 'Open AUZsPay' : 'AUZsPay is not on your plan', sub: h.s.featureOn('payroll') ? 'Payroll runs in its own app.' : 'Ask us to add it to your plan.', icon: Icons.groups_outlined, tone: Tk.orange, onTap: () => launchUrl(h.s.featureOn('payroll') ? Uri.https('app.auzslab.in', '/payroll.html') : Uri.https('auzslab.in', '/pricing.html'), mode: LaunchMode.externalApplication))]),
      ]);
}

// ------------------------------------------------------------------ menu extras

class AvailabilityPage extends StatefulWidget {
  const AvailabilityPage(this.h, {super.key});
  final HomeState h;
  @override
  State<AvailabilityPage> createState() => _AvailabilityPageState();
}

class _AvailabilityPageState extends State<AvailabilityPage> {
  String q = '';
  @override
  Widget build(BuildContext context) {
    final h = widget.h;
    final cats = {for (final c in h.s.repo!.of('cat')) '${c['id']}': '${c['name']}'};
    final items = h.s.repo!.of('item').where((i) => q.isEmpty || '${i['name']}'.toLowerCase().contains(q.toLowerCase())).toList()..sort((a, b) => '${cats[a['cat']]}${a['name']}'.compareTo('${cats[b['cat']]}${b['name']}'));
    final off = h.s.repo!.of('item').where((i) => i['off'] == true).length;
    return ListView(padding: const EdgeInsets.only(bottom: 28), children: [
      PageHead('Availability', sub: '$off sold out. Switch an item off to stop it being sold.'),
      Padding(padding: const EdgeInsets.fromLTRB(16, 12, 16, 12), child: TextField(decoration: InputDecoration(prefixIcon: Icon(Icons.search), hintText: tr('Search items')), onChanged: (v) => setState(() => q = v))),
      if (off > 0) Padding(padding: const EdgeInsets.fromLTRB(16, 0, 16, 12), child: OutlinedButton(onPressed: () async {
            for (final i in h.s.repo!.of('item').where((i) => i['off'] == true).toList()) {
              await h.s.repo!.save('item', {...i, 'off': false, 'offUntil': null}, id: '${i['id']}');
            }
            h.s.sync();
            setState(() {});
          }, child: const Text('Mark everything available'))),
      Group([
        for (final i in items.take(200))
          Li('${i['name']}', sub: '${cats[i['cat']] ?? ''}${i['off'] == true ? ' · sold out' : ''}', chevron: false, trailing: Switch(value: i['off'] != true, onChanged: (v) async {
            await h.s.repo!.save('item', {...i, 'off': !v, 'offUntil': null}, id: '${i['id']}');
            h.s.sync();
            setState(() {});
          })),
      ]),
    ]);
  }
}

class BulkPricePage extends StatefulWidget {
  const BulkPricePage(this.h, {super.key});
  final HomeState h;
  @override
  State<BulkPricePage> createState() => _BulkPricePageState();
}

/// Three of the website's bulk-menu actions (menu/items' selection toolbar in p-menu.js), scoped by
/// category rather than the website's checkbox multi-select -- "apply to every item in category X"
/// (or every item) covers the same end results without a separate selection-state UI. Bulk DELETE
/// from the website's toolbar is deliberately not reproduced here: an irreversible, category-wide
/// delete is exactly the kind of destructive bulk action this mission's own safety rules caution
/// against adding casually -- an owner who needs that can still delete items one at a time from the
/// item editor, which already supports it.
class _BulkPricePageState extends State<BulkPricePage> {
  String cat = 'all', mode = 'pct', action = 'price';
  final amt = TextEditingController();
  String moveTo = '';

  @override
  Widget build(BuildContext context) {
    final h = widget.h;
    final cats = h.s.repo!.of('cat').toList();
    final targets = h.s.repo!.of('item').where((i) => cat == 'all' || i['cat'] == cat).toList();
    return ListView(padding: const EdgeInsets.only(bottom: 28), children: [
      const PageHead('Bulk menu changes', sub: 'Price, type or category, for many items at once.'),
      Padding(padding: const EdgeInsets.fromLTRB(16, 14, 16, 0), child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Seg<String>(expand: true, items: const [('price', 'Price'), ('type', 'Veg type'), ('move', 'Category')], value: action, onChanged: (v) => setState(() => action = v)),
        const SizedBox(height: 12),
        DropdownButtonFormField<String>(
          initialValue: cat,
          decoration: InputDecoration(labelText: tr('Which items')),
          items: [const DropdownMenuItem(value: 'all', child: Text('Every item')), for (final c in cats) DropdownMenuItem(value: '${c['id']}', child: Text('${c['name']}'))],
          onChanged: (v) => setState(() => cat = v ?? 'all'),
        ),
        const SizedBox(height: 12),
        if (action == 'price') ...[
          Seg<String>(expand: true, items: const [('pct', 'Percent %'), ('rs', 'Rupees ₹')], value: mode, onChanged: (v) => setState(() => mode = v)),
          const SizedBox(height: 12),
          TextField(controller: amt, keyboardType: const TextInputType.numberWithOptions(decimal: true, signed: true), decoration: InputDecoration(labelText: tr('Change by (use minus to lower)'))),
          const SizedBox(height: 14),
          FilledButton(
            onPressed: () async {
              final a = double.tryParse(amt.text.trim());
              if (a == null || a == 0) return h.toast('Enter an amount');
              if (!await askYes(context, 'Change ${targets.length} item prices?', 'Prices (and sizes) change by ${mode == 'pct' ? '$a%' : '₹$a'}. You can change them back the same way.')) return;
              num g(num v) => r2((mode == 'pct' ? v * (1 + a / 100) : v + a).clamp(0, 1e9));
              for (final i in targets) {
                final c = Map<String, dynamic>.from(i);
                c['price'] = g((c['price'] ?? 0) as num);
                if (c['sizes'] is List) c['sizes'] = [for (final z in (c['sizes'] as List).cast<Map>()) {...z, 'p': g(z['p'] as num)}];
                await h.s.repo!.save('item', c, id: '${i['id']}');
              }
              h.s.sync();
              h.toast('Updated ${targets.length} items');
            },
            child: Text('Apply to ${targets.length} items'),
          ),
        ] else if (action == 'type') ...[
          for (final (k, l) in const [('veg', 'Mark Veg'), ('nonveg', 'Mark Non-veg'), ('egg', 'Mark contains Egg')])
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: OutlinedButton(
                onPressed: () async {
                  if (!await askYes(context, '$l for ${targets.length} items?', 'This changes the veg/non-veg/egg marker only, not the recipe or price.')) return;
                  for (final i in targets) {
                    await h.s.repo!.save('item', {...i, 'veg': k}, id: '${i['id']}');
                  }
                  h.s.sync();
                  h.toast('Updated ${targets.length} items');
                },
                child: Text('$l (${targets.length} items)'),
              ),
            ),
        ] else ...[
          DropdownButtonFormField<String>(
            initialValue: moveTo.isEmpty ? null : moveTo,
            decoration: InputDecoration(labelText: tr('Move to category')),
            items: [for (final c in cats) DropdownMenuItem(value: '${c['id']}', child: Text('${c['name']}'))],
            onChanged: (v) => setState(() => moveTo = v ?? ''),
          ),
          const SizedBox(height: 14),
          FilledButton(
            onPressed: moveTo.isEmpty
                ? null
                : () async {
                    if (!await askYes(context, 'Move ${targets.length} items?', 'They will all move into the chosen category.')) return;
                    for (final i in targets) {
                      await h.s.repo!.save('item', {...i, 'cat': moveTo}, id: '${i['id']}');
                    }
                    h.s.sync();
                    h.toast('Moved ${targets.length} items');
                  },
            child: Text('Move ${targets.length} items'),
          ),
        ],
      ])),
    ]);
  }
}
