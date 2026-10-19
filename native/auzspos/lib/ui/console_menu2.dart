import 'dart:async';
import 'package:flutter/material.dart' hide Text;
import 'i18n.dart';
import '../core/session.dart';
import 'console.dart';
import 'ds.dart';
import 'home.dart';
import 'kit.dart';
import 'theme.dart';

/// Three console pages that existed on the website (app/public/console/p-menu.js) but had no native
/// equivalent, plus the real WhatsApp Business API connection page (p-mgmt.js) -- found missing by the
/// AUZsPOS Admin Console parity audit. Kept in their own file rather than growing console_pages.dart/
/// console_more.dart further, matching this codebase's one-concern-per-file split.

/// menu/overview -- a tile dashboard linking into the other menu/* pages, mirroring PAGES['menu/overview'].
class MenuOverviewPage extends StatelessWidget {
  const MenuOverviewPage(this.h, {this.go, super.key});
  final HomeState h;
  final void Function(String)? go;
  @override
  Widget build(BuildContext context) {
    final s = h.s;
    final items = s.repo!.ofAll('item').toList();
    final cats = s.repo!.ofAll('cat').toList();
    final sold = items.where((i) => s.itemOffWhy(i, 'Dine-in').isNotEmpty).length;
    final avg = items.isEmpty ? 0.0 : items.fold<num>(0, (a, i) => a + ((i['price'] ?? 0) as num)) / items.length;
    final tiles = <(String, String, String, IconData)>[
      ('menu/items', 'Items', '${items.length} items', Icons.inventory_2_outlined),
      ('menu/categories', 'Categories', '${cats.length} categories', Icons.category_outlined),
      ('menu/addons', 'Add-ons', '${s.repo!.ofAll('addongrp').length} groups', Icons.add_circle_outline),
      ('menu/variants', 'Variants', '${s.repo!.ofAll('variant').length} saved', Icons.style_outlined),
      ('menu/tables', 'Tables & Areas', '${s.repo!.ofAll('table').length} tables', Icons.table_restaurant_outlined),
      ('menu/taxes', 'Taxes', '${s.cfg['tax'] ?? 0}% default', Icons.percent),
      ('menu/discounts', 'Discounts', '${s.repo!.ofAll('coupon').length} coupons', Icons.local_offer_outlined),
      ('menu/bogo', 'Buy X Get Y', '${s.repo!.ofAll('offer').length} offers', Icons.card_giftcard_outlined),
      ('menu/availability', 'Availability', '$sold sold out', Icons.visibility_outlined),
      ('menu/physical', 'Physical menu', 'Print or upload', Icons.print_outlined),
      ('menu/images', 'Bulk photos', '${items.where((i) => '${i['img'] ?? ''}'.isEmpty).length} missing', Icons.image_outlined),
    ];
    final avgTxt = '₹${avg == avg.roundToDouble() ? avg.toInt() : avg.toStringAsFixed(2)}';
    return ListView(padding: const EdgeInsets.only(bottom: 28), children: [
      const PageHead('Menu & Discounts', sub: 'Everything about what you sell, where, and at what price.'),
      Kpis('Items', '${items.length}', '${cats.length} categories', [('Sold out now', '$sold', Tk.orange), ('Average price', avgTxt, null)]),
      const SectionLabel('Manage'),
      Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16),
        child: GridView.builder(
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(maxCrossAxisExtent: 220, mainAxisExtent: 96, crossAxisSpacing: 10, mainAxisSpacing: 10),
          itemCount: tiles.length,
          itemBuilder: (_, i) {
            final (id, title, sub, icon) = tiles[i];
            return Material(
              color: Tk.card,
              borderRadius: BorderRadius.circular(18),
              child: InkWell(
                borderRadius: BorderRadius.circular(18),
                onTap: go == null ? null : () => go!(id),
                child: Container(
                  decoration: BoxDecoration(borderRadius: BorderRadius.circular(18), border: Border.all(color: Tk.line, width: .5)),
                  padding: const EdgeInsets.all(14),
                  child: Row(children: [
                    Container(width: 36, height: 36, decoration: BoxDecoration(color: Tk.accentSoft, borderRadius: BorderRadius.circular(10)), child: Icon(icon, color: Tk.accent, size: 20)),
                    const SizedBox(width: 10),
                    Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
                      Text(title, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
                      Text(sub, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 14, color: Tk.label2)),
                    ])),
                  ]),
                ),
              ),
            );
          },
        ),
      ),
      const SectionLabel('Categories at a glance'),
      Group(cats.isEmpty
          ? [const Li('No categories yet', chevron: false)]
          : [for (final c in cats) Li('${c['name']}', sub: '${items.where((i) => i['cat'] == c['id']).length} items', chevron: false)]),
    ]);
  }
}

/// menu/preferences -- order handling, charges/tax, loyalty/tips/printing, kitchen/reservations. Owner-only writes,
/// same settings-record pattern as every other toggle page in this app (HardwarePage, LoyaltyPage).
class OrderPreferencesPage extends StatefulWidget {
  const OrderPreferencesPage(this.h, {super.key});
  final HomeState h;
  @override
  State<OrderPreferencesPage> createState() => _OrderPreferencesPageState();
}

class _OrderPreferencesPageState extends State<OrderPreferencesPage> {
  Session get s => widget.h.s;

  Future<void> set(String k, dynamic v) async {
    await s.repo!.save('settings', {...s.cfg, k: v}, id: 'settings');
    unawaited(s.sync());
    setState(() {});
  }

  Future<void> numSheet(String k, String title, {String unit = ''}) => formSheet(context, title, [F('v', '$title${unit.isEmpty ? '' : ' ($unit)'}', type: 'number', value: s.cfg[k])], (v) async {
        await set(k, v['v']);
        return true;
      });

  @override
  Widget build(BuildContext context) {
    final c = s.cfg;
    final owner = s.can('o');
    num numVal(String k, num d) => num.tryParse('${c[k] ?? d}') ?? d;
    return ListView(padding: const EdgeInsets.only(bottom: 28), children: [
      const PageHead('Order Preferences', sub: 'Ordering and fulfilment rules for this business.'),
      if (!owner) Padding(padding: const EdgeInsets.fromLTRB(16, 0, 16, 8), child: Text('Only the owner can change these. You can view them.', style: TextStyle(color: Tk.label2))),
      const SectionLabel('Order handling'),
      Group([
        Li('Auto-accept online orders', sub: 'Orders from platforms are accepted without a tap', chevron: false, trailing: Switch(value: c['autoAccept'] == true, onChanged: owner ? (v) => set('autoAccept', v) : null)),
        Li('Require customer phone on every bill', sub: 'Needed for loyalty, feedback and WhatsApp receipts', chevron: false, trailing: Switch(value: c['requirePhone'] != false, onChanged: owner ? (v) => set('requirePhone', v) : null)),
        Li('Default preparation time', sub: 'Shown to online customers', value: '${numVal('prepMinutes', 20)} min', onTap: owner ? () => numSheet('prepMinutes', 'Default preparation time', unit: 'minutes') : null),
        Li('Advance orders need at least', sub: 'Lead time for scheduled orders', value: '${numVal('advanceMinHours', 1)} h', onTap: owner ? () => numSheet('advanceMinHours', 'Advance orders need at least', unit: 'hours') : null),
      ]),
      const SectionLabel('Charges and tax'),
      Group([
        Li('Packing charge per order', sub: 'Added to takeaway/delivery bills, taxed at the default GST rate', value: inr(numVal('packingCharge', 0)), onTap: owner ? () => numSheet('packingCharge', 'Packing charge per order', unit: '₹') : null),
        Li('Service charge on dine-in', sub: 'Percent of the bill after discount; a manager can remove it from a bill', value: '${numVal('serviceChargePct', 0)}%', onTap: owner ? () => numSheet('serviceChargePct', 'Service charge on dine-in', unit: '%') : null),
        Li('Delivery charge', sub: 'Flat charge per delivery order', value: inr(numVal('deliveryCharge', 0)), onTap: owner ? () => numSheet('deliveryCharge', 'Delivery charge', unit: '₹') : null),
        Li('Menu prices include GST', sub: 'Tax is worked out of the price instead of added on top', chevron: false, trailing: Switch(value: c['taxInclusive'] == true, onChanged: owner ? (v) => set('taxInclusive', v) : null)),
        Li('Round bills off to nearest rupee', sub: 'The difference shows as Round off on the bill', chevron: false, trailing: Switch(value: c['roundOff'] != false, onChanged: owner ? (v) => set('roundOff', v) : null)),
      ]),
      const SectionLabel('Loyalty, tips and printing'),
      Group([
        Li('Loyalty points', sub: 'Earn and redeem points at billing', chevron: false, trailing: Switch(value: c['loyaltyOn'] != false, onChanged: owner ? (v) => set('loyaltyOn', v) : null)),
        Li('Ask for a tip at payment', sub: 'Adds a tip row at payment; tips are recorded but are not sales or GST', chevron: false, trailing: Switch(value: c['tipPrompt'] == true, onChanged: owner ? (v) => set('tipPrompt', v) : null)),
        Li('Print KOT automatically', sub: 'Kitchen tickets and cancellation slips print when sent', chevron: false, trailing: Switch(value: c['autoKot'] != false, onChanged: owner ? (v) => set('autoKot', v) : null)),
        Li('Print the bill after payment', sub: 'Turn off to print only when asked', chevron: false, trailing: Switch(value: c['printOnPay'] != false, onChanged: owner ? (v) => set('printOnPay', v) : null)),
      ]),
      const SectionLabel('Kitchen and reservations'),
      Group([
        Li('Kitchen target time', sub: 'Tickets older than this turn red on the kitchen screen', value: '${numVal('kdsTargetMin', 15)} min', onTap: owner ? () => numSheet('kdsTargetMin', 'Kitchen target time', unit: 'minutes') : null),
        Li('Reservation length', sub: 'How long a reserved table is held', value: '${numVal('resMinutes', 90)} min', onTap: owner ? () => numSheet('resMinutes', 'Reservation length', unit: 'minutes') : null),
      ]),
      Padding(padding: const EdgeInsets.fromLTRB(16, 14, 16, 0), child: Text('These are saved for the whole business and the billing POS applies all of them.', style: TextStyle(color: Tk.label3, fontSize: 14))),
    ]);
  }
}

/// menu/commission -- per-item commission for each delivery platform, falling back to the platform's own default.
/// Mirrors PAGES['menu/commission'] (item.comm[platformName] = {type:'%', val}).
class ItemCommissionPage extends StatefulWidget {
  const ItemCommissionPage(this.h, {super.key});
  final HomeState h;
  @override
  State<ItemCommissionPage> createState() => _ItemCommissionPageState();
}

const _platformNames = ['Zomato', 'Swiggy', 'ONDC', 'Dunzo', 'Uber Eats'];

class _ItemCommissionPageState extends State<ItemCommissionPage> {
  String? cur;
  String q = '';
  Session get s => widget.h.s;

  List<Map<String, dynamic>> _platforms() {
    final have = s.repo!.ofAll('platform').toList();
    return [
      for (final n in _platformNames) have.firstWhere((p) => p['name'] == n, orElse: () => {'name': n, 'commission': 0}),
      for (final p in have)
        if (!_platformNames.contains(p['name'])) p,
    ];
  }

  Future<void> saveDefault(String name, num def) async {
    final existing = s.repo!.ofAll('platform').where((p) => p['name'] == name).firstOrNull;
    await s.repo!.save('platform', {...(existing ?? {'name': name, 'active': true}), 'commission': def}, id: existing == null ? null : '${existing['id']}');
    unawaited(s.sync());
    setState(() {});
  }

  Future<void> saveItemCommission(Map<String, dynamic> it, String platform, num? val) async {
    final c = Map<String, dynamic>.from((it['comm'] as Map?) ?? {});
    if (val == null) {
      c.remove(platform);
    } else {
      c[platform] = {'type': '%', 'val': val};
    }
    await s.repo!.save('item', {...it, 'comm': c}, id: '${it['id']}');
    unawaited(s.sync());
    setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    final pl = _platforms();
    cur ??= pl.first['name'] as String;
    final p = pl.firstWhere((x) => x['name'] == cur, orElse: () => pl.first);
    final def = (p['commission'] ?? 0) as num;
    final items = s.repo!.ofAll('item').where((i) => q.isEmpty || '${i['name']}'.toLowerCase().contains(q.toLowerCase())).toList()..sort((a, b) => '${a['name']}'.compareTo('${b['name']}'));
    final defCtl = TextEditingController(text: '$def');
    return ListView(padding: const EdgeInsets.only(bottom: 28), children: [
      const PageHead('Item Commission', sub: 'Per-item commission each platform charges. Items without their own value use the platform default.'),
      Padding(padding: const EdgeInsets.fromLTRB(16, 8, 16, 0), child: SingleChildScrollView(scrollDirection: Axis.horizontal, child: Row(children: [for (final pp in pl) Padding(padding: const EdgeInsets.only(right: 8), child: Cat('${pp['name']}', cur == pp['name'], () => setState(() => cur = '${pp['name']}')))]))),
      Padding(padding: const EdgeInsets.fromLTRB(16, 12, 16, 0), child: TextField(decoration: InputDecoration(hintText: tr('Search items…'), prefixIcon: Icon(Icons.search, color: Tk.label3)), onChanged: (v) => setState(() => q = v))),
      const SizedBox(height: 10),
      Group([
        Li('$cur default commission', trailing: Row(mainAxisSize: MainAxisSize.min, children: [
          SizedBox(width: 72, child: TextField(controller: defCtl, keyboardType: TextInputType.number, decoration: const InputDecoration(isDense: true, suffixText: '%'))),
          const SizedBox(width: 8),
          FilledButton(onPressed: () => saveDefault(cur!, num.tryParse(defCtl.text) ?? 0), child: const Text('Save')),
        ]), chevron: false),
      ]),
      const SizedBox(height: 10),
      if (items.isEmpty)
        const Empty(Icons.search_off, 'No items', 'Add items in Menu > Items first.')
      else
        Group([
          for (final it in items)
            Li(
              '${it['name']}',
              sub: '${inr((it['price'] ?? 0) as num)} · you keep ${inr(((it['price'] ?? 0) as num) * (1 - ((((it['comm'] as Map?)?[cur] as Map?)?['val'] ?? def) as num) / 100))}',
              chevron: false,
              trailing: SizedBox(
                width: 92,
                child: TextField(
                  key: ValueKey('${it['id']}-$cur'),
                  controller: TextEditingController(text: '${((it['comm'] as Map?)?[cur] as Map?)?['val'] ?? ''}'),
                  keyboardType: TextInputType.number,
                  decoration: InputDecoration(isDense: true, hintText: '$def% default'),
                  onSubmitted: (v) => saveItemCommission(it, cur!, v.trim().isEmpty ? null : num.tryParse(v)),
                ),
              ),
            ),
        ]),
    ]);
  }
}

/// mgmt/whatsapp -- the real WhatsApp Business API connection: a shop's own number, which automated messages go
/// out, template catalogue to set up once in Meta, and the last 30 days' log. Distinct from mkt/whatsapp (the free
/// wa.me one-at-a-time send centre, already native as WhatsAppPage in console_more.dart).
class WaAutomationPage extends StatefulWidget {
  const WaAutomationPage(this.h, {super.key});
  final HomeState h;
  @override
  State<WaAutomationPage> createState() => _WaAutomationPageState();
}

class _WaAutomationPageState extends State<WaAutomationPage> {
  Map<String, dynamic>? wa;
  String? error;
  bool loading = false;
  Session get s => widget.h.s;

  @override
  void initState() {
    super.initState();
    load();
  }

  Future<void> load() async {
    setState(() => loading = true);
    try {
      final r = await s.api.rpc('wa_my_status');
      setState(() {
        wa = r == null ? null : Map<String, dynamic>.from(r as Map);
        error = null;
      });
    } catch (e) {
      setState(() => error = '$e');
    } finally {
      setState(() => loading = false);
    }
  }

  Future<void> saveSettings(Map<String, dynamic> patch) async {
    if (wa == null) return;
    try {
      await s.api.rpc('wa_save_settings', {'p': {'enabled': wa!['enabled'], 'events': wa!['events'], ...patch}});
      setState(() => wa = {...wa!, ...patch});
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
    }
  }

  Future<void> connect() async {
    final idc = TextEditingController(), wabac = TextEditingController(), tokc = TextEditingController();
    final ok = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (ctx) => SafeArea(
        child: Padding(
          padding: EdgeInsets.fromLTRB(16, 0, 16, MediaQuery.of(ctx).viewInsets.bottom + 16),
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            const Padding(padding: EdgeInsets.symmetric(vertical: 16), child: Text('Connect my WhatsApp number', style: TextStyle(fontSize: 22, fontWeight: FontWeight.w800))),
            TextField(controller: idc, decoration: const InputDecoration(labelText: 'Phone number ID', hintText: 'e.g. 105873456789012')),
            const SizedBox(height: 10),
            TextField(controller: wabac, decoration: const InputDecoration(labelText: 'WhatsApp Business Account ID (optional)')),
            const SizedBox(height: 10),
            TextField(controller: tokc, obscureText: true, decoration: const InputDecoration(labelText: 'Permanent access token')),
            const SizedBox(height: 4),
            Padding(padding: const EdgeInsets.only(top: 4), child: Text('From Meta WhatsApp Manager → API setup. The token is stored encrypted and never shown again.', style: TextStyle(fontSize: 13, color: Tk.label3))),
            const SizedBox(height: 14),
            FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Connect')),
          ]),
        ),
      ),
    );
    if (ok != true) return;
    if (idc.text.trim().isEmpty || tokc.text.trim().isEmpty) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Phone number ID and the access token are required')));
      return;
    }
    try {
      await s.api.connectWhatsApp(phoneNumberId: idc.text.trim(), wabaId: wabac.text.trim().isEmpty ? null : wabac.text.trim(), token: tokc.text.trim());
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Connected')));
      load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
    }
  }

  Future<void> disconnect() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Disconnect this number?'),
        content: const Text('Automatic messages will stop (unless AUZslab sends them for you).'),
        actions: [TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')), FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Disconnect'))],
      ),
    );
    if (ok != true) return;
    try {
      await s.api.rpc('wa_disconnect');
      load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
    }
  }

  @override
  Widget build(BuildContext context) {
    const head = PageHead('WhatsApp', sub: 'Bills, bookings and reminders sent to your customers by themselves, from your own business number.');
    if (loading && wa == null) return ListView(children: [head, const Padding(padding: EdgeInsets.all(24), child: Center(child: CircularProgressIndicator()))]);
    if (error != null) {
      return ListView(children: [
        head,
        Empty(Icons.lock_outline, 'Only the owner or a manager can see this page', '$error', action: 'Try again', onAction: load),
      ]);
    }
    final w = wa;
    if (w == null) return ListView(children: [head, const Padding(padding: EdgeInsets.all(16), child: Text('Loading…'))]);
    final owner = s.can('o');
    final connected = w['connected'] == true;
    final templates = ((w['templates'] as List?) ?? []).cast<Map>();
    final recent = ((w['recent'] as List?) ?? []).cast<Map>();
    final counts = Map<String, dynamic>.from((w['counts'] as Map?) ?? {});
    return ListView(padding: const EdgeInsets.only(bottom: 28), children: [
      head,
      if (!owner) Padding(padding: const EdgeInsets.fromLTRB(16, 0, 16, 8), child: Text('Only the owner can change these settings. You can view them.', style: TextStyle(color: Tk.label2))),
      const SectionLabel('Sender'),
      Group([
        Li(
          'Who sends the messages',
          sub: 'Customers see this number. Until a number is connected, nothing is sent automatically and the tap-to-send WhatsApp buttons keep working.',
          chevron: false,
          trailing: Text(connected ? 'Your own number ${w['number'] ?? ''}' : (w['allow_platform'] == true ? 'Sent from the AUZslab number' : 'Not connected'), style: TextStyle(color: connected ? Tk.green : Tk.label2, fontWeight: FontWeight.w600)),
        ),
      ]),
      if (owner)
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 10, 16, 0),
          child: Row(children: [
            if (connected) OutlinedButton(onPressed: disconnect, child: const Text('Disconnect')) else FilledButton(onPressed: connect, child: const Text('Connect my number')),
            if (connected) ...[const SizedBox(width: 10), OutlinedButton(onPressed: connect, child: const Text('Change number'))],
          ]),
        ),
      const SectionLabel('Automatic messages'),
      Group([
        Li('Send messages automatically', sub: 'Master switch for everything below.', chevron: false, trailing: Switch(value: w['enabled'] == true, onChanged: owner ? (v) => saveSettings({'enabled': v}) : null)),
        for (final t in templates)
          Li('${t['title']}', sub: '${t['body']}'.replaceAll(RegExp(r'\{\{\d\}\}'), '…'), chevron: false, trailing: Switch(value: (w['events'] as Map?)?[t['key']] != false, onChanged: (owner && w['enabled'] == true) ? (v) => saveSettings({'events': {...Map<String, dynamic>.from((w['events'] as Map?) ?? {}), t['key']: v}}) : null)),
      ]),
      const SectionLabel('Last 30 days'),
      Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16),
        child: counts.isEmpty
            ? Text('No messages yet', style: TextStyle(color: Tk.label2))
            : Wrap(spacing: 8, runSpacing: 8, children: [for (final e in counts.entries) Container(padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6), decoration: BoxDecoration(color: Tk.fill, borderRadius: BorderRadius.circular(14)), child: Text('${e.key} ${e.value}'))]),
      ),
      const SectionLabel('Recent messages'),
      Group(recent.isEmpty
          ? [const Li('No messages yet', chevron: false)]
          : [
              for (final m in recent)
                Li(
                  (templates.firstWhere((t) => t['key'] == m['template'], orElse: () => {'title': m['template']}))['title'] as String,
                  sub: '+${m['to_phone']}${'${m['error'] ?? ''}'.isEmpty ? '' : ' · ${m['error']}'}',
                  chevron: false,
                  value: '${m['status']}',
                ),
            ]),
      const SectionLabel('Message templates (one-time setup in Meta WhatsApp Manager)'),
      Padding(padding: const EdgeInsets.fromLTRB(16, 0, 16, 8), child: Text('WhatsApp only allows automatic messages from approved templates. Create each of these once in your WhatsApp account with exactly this name and text, language English.', style: TextStyle(fontSize: 14, color: Tk.label3))),
      for (final t in templates)
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 10),
          child: Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(border: Border.all(color: Tk.line), borderRadius: BorderRadius.circular(12)),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('${t['name']}', style: const TextStyle(fontWeight: FontWeight.w700)),
              Text('${t['body']}', style: TextStyle(color: Tk.label2, fontSize: 14)),
              Text('Variables: ${((t['params'] as List?) ?? []).cast<String>().indexed.map((e) => '{{${e.$1 + 1}}} = ${e.$2}').join(', ')}', style: TextStyle(color: Tk.label3, fontSize: 13)),
            ]),
          ),
        ),
    ]);
  }
}
