import 'package:flutter/material.dart' hide Text;
import 'package:url_launcher/url_launcher.dart';
import 'i18n.dart';
import '../core/billing.dart' show r2;
import '../core/auto_reorder.dart';
import '../core/inventory_reports.dart';
import '../core/purchase_orders.dart' show openPurchaseOrders;
import '../core/purchases.dart';
import '../core/wastage.dart' show wastageCostThisMonth;
import 'actions.dart';
import 'costing.dart';
import '../core/costing.dart' show businessHealth;
import '../core/dashboard_stats.dart' hide dayKeyOf;
import 'daily_summary.dart' show DailySummaryPage;
import 'purchase_orders.dart';
import 'wastage.dart';
import 'admin.dart';
import 'console.dart';
import 'console_more.dart';
import 'console_menu2.dart';
import 'ds.dart';
import 'home.dart';
import 'kit.dart';
import 'more2.dart';
import 'theme.dart';
import 'website.dart';

/// The page for a console menu id.
Widget consolePageFor(String id, HomeState h, void Function(String) go) {
  switch (id) {
    case 'dashboard':
      return _Overview(h, go);
    case 'daily/live':
      return OrderList(h, title: 'Live Orders', sub: 'Orders in progress right now', filter: (o) => o['status'] == 'open');
    case 'daily/all':
      return OrderList(h, title: 'All Orders', sub: 'Every bill, newest first', filter: (o) => true);
    case 'daily/online':
      return OrderList(h, title: 'Online Orders', sub: 'Orders from Swiggy, Zomato and other platforms', filter: (o) => '${o['src'] ?? ''}'.isNotEmpty && o['src'] != 'QR');
    case 'daily/due':
      return OrderList(h, title: 'Due Payment', sub: 'Bills not paid yet', filter: (o) => o['status'] == 'due');
    case 'daily/kot':
      return _Kot(h);
    case 'inv/raw':
      return CrudPage(h, _cfgRaw);
    case 'inv/stock':
      return StockAdmin(h, embedded: true);
    case 'inv/purchase':
      return _Purchases(h);
    case 'inv/vendors':
      return CrudPage(h, _cfgVendor);
    case 'inv/recipes':
      return _Recipes(h);
    case 'inv/consumption':
      return _Consumption(h);
    case 'rep/sales':
      return ReportsPage(h, embedded: true);
    case 'rep/orders':
      return _RepOrders(h);
    case 'rep/items':
      return _RepItems(h);
    case 'rep/inventory':
      return _RepInventory(h);
    case 'rep/customers':
      return _RepCustomers(h);
    case 'rep/staff':
      return _RepStaff(h);
    case 'rep/analytics':
      return _RepAnalytics(h);
    case 'rep/gst':
      return _RepGst(h);
    case 'menu/items':
      return MenuAdmin(h, embedded: true);
    case 'menu/categories':
      return MenuAdmin(h, embedded: true, tab: 1);
    case 'menu/variants':
      return CrudPage(h, _cfgVariant);
    case 'menu/addons':
      return CrudPage(h, _cfgAddon);
    case 'menu/tables':
      return TablesAdmin(h, embedded: true);
    case 'menu/taxes':
      return TaxAdmin(h, embedded: true);
    case 'menu/discounts':
      return CrudPage(h, _cfgCoupon);
    case 'crm/customers':
      return CustomersAdmin(h, embedded: true);
    case 'crm/giftcards':
      return CrudPage(h, _cfgGift);
    case 'crm/membership':
      return CrudPage(h, _cfgPlan);
    case 'crm/support':
      return CrudPage(h, _cfgTicket);
    case 'team/users':
      return UsersPage(h);
    case 'team/attendance':
      return _Attendance(h);
    case 'team/tasks':
      return CrudPage(h, _cfgTask);
    case 'fin/expenses':
      return ExpensesAdmin(h, embedded: true);
    case 'fin/withdrawals':
      return CrudPage(h, _cfgCash);
    case 'fin/settlements':
      return CrudPage(h, _cfgSettle);
    case 'mkt/campaigns':
      return CampaignsPage(h);
    case 'mkt/segments':
      return SegmentsPage(h);
    case 'mkt/offers':
      return OffersPage(h);
    case 'agg/platforms':
      return CrudPage(h, _cfgPlatform);
    case 'menu/overview':
      return MenuOverviewPage(h, go: go);
    case 'menu/preferences':
      return OrderPreferencesPage(h);
    case 'menu/commission':
      return ItemCommissionPage(h);
    case 'mgmt/whatsapp':
      return WaAutomationPage(h);
    case 'mgmt/config':
      return SettingsPage(h, embedded: true);
    case 'mgmt/qr':
      return QrWebsitePage(h, embedded: true);
    case 'mgmt/website':
      return WebsiteContentPage(h);
    case 'mgmt/data':
      return DataPage(h);
    case 'menu/physical':
      return PhysicalMenuPage(h);
    case 'menu/images':
      return BulkPhotosPage(h);
    case 'menu/import':
      return MenuImportPage(h);
    case 'mgmt/reasons':
      return CrudPage(h, _cfgReason);
    case 'mgmt/outlets':
      return CrudPage(h, _cfgOutlet);
    case 'mgmt/devices':
      return CrudPage(h, _cfgDevice);
    case 'menu/bogo':
      return CrudPage(h, _cfgOffer);
    case 'menu/availability':
      return AvailabilityPage(h);
    case 'menu/bulk':
      return BulkPricePage(h);
    case 'crm/loyalty':
      return LoyaltyPage(h);
    case 'crm/feedback':
      return FeedbackPage(h);
    case 'team/payroll':
      return PayrollLinkPage(h);
    case 'rep/daily':
      return DailySummaryPage(h);
    case 'fin/cash':
      return CashPage(h);
    case 'fin/accounting':
      return AccountingPage(h);
    case 'fin/reconcile':
      return ReconcilePage(h);
    case 'mkt/whatsapp':
      return WhatsAppPage(h);
    case 'mkt/promotions':
      return PromotionsPage(h, go);
    case 'mkt/loyaltycamp':
      return LoyaltyCampPage(h);
    case 'agg/swiggy':
    case 'agg/zomato':
    case 'agg/ondc':
    case 'agg/dunzo':
    case 'agg/ubereats':
      return PlatformPage(h, platKeys[id]!);
    case 'int/apps':
      return ExplorePage(h);
    case 'ql/favorites':
      return FavoritesPage(go);
    case 'ql/shortcuts':
      return ShortcutsPage(h, go);
    case 'mgmt/hardware':
      return HardwarePage(h);
    case 'mgmt/audit':
      return AuditPage(h);
    case 'mgmt/logs':
      return LogsPage(h);
    case 'ql/custom':
      return CrudPage(h, _cfgLink);
  }
  return const Empty(Icons.construction, 'Not available', 'This page is not part of the app yet.');
}

// ------------------------------------------------------------------ generic record page

class CrudCfg {
  const CrudCfg({required this.kind, required this.title, required this.sub, required this.icon, required this.add, required this.fields, required this.rowTitle, required this.rowSub, this.trail, this.tone, this.empty = ''});
  final String kind, title, sub, add, empty;
  final IconData icon;
  final Color? tone;
  final List<F> Function(Map<String, dynamic>? r) fields;
  final String Function(Map<String, dynamic> r) rowTitle, rowSub;
  final String Function(Map<String, dynamic> r)? trail;
}

String _s(dynamic v) => v == null ? '' : '$v';
List<List<String>> _opts(List<String> a) => [for (final x in a) [x, x]];

final _cfgRaw = CrudCfg(
  kind: 'ing', title: 'Raw Materials', sub: 'Everything you buy and cook with, with unit, cost and reorder level.', icon: Icons.egg_outlined, add: 'Add material', empty: 'Add milk, flour, tea. You get a warning when something runs low.',
  fields: (r) => [F('name', 'Name', value: r?['name']), F('unit', 'Unit', type: 'select', value: r?['unit'] ?? 'kg', options: _opts(['kg', 'g', 'l', 'ml', 'pcs', 'pack', 'dozen'])), F('qty', 'Stock on hand', type: 'number', value: r?['qty'] ?? 0), F('low', 'Low stock alert at', type: 'number', value: r?['low'] ?? 0), F('cost', 'Cost per unit (₹)', type: 'number', value: r?['cost']), F('expiry', 'Expiry date (YYYY-MM-DD)', value: r?['expiry']), F('vendor', 'Vendor', value: r?['vendor'])],
  // Low-stock consistency fix: reuses isLowStock() (core/inventory_reports.dart), the same function
  // the Alerts Center's 'lowstock' alert now uses, instead of a separate copy with an extra `low>0`
  // guard that made a material with no reorder threshold ever set show no "Low" tag even at zero stock.
  rowTitle: (r) => _s(r['name']), rowSub: (r) => '${r['qty'] ?? 0} ${r['unit'] ?? ''} · ₹${r['cost'] ?? 0}/${r['unit'] ?? 'unit'}', trail: (r) => isLowStock(r) ? 'Low' : '',
);

final _cfgVendor = CrudCfg(
  kind: 'vendor', title: 'Vendors', sub: 'Suppliers you buy from.', icon: Icons.local_shipping_outlined, add: 'Add vendor', empty: 'Add your suppliers with their phone and payment terms.',
  fields: (r) => [F('name', 'Vendor name', value: r?['name']), F('contact', 'Contact person', value: r?['contact']), F('phone', 'Phone', value: r?['phone']), F('email', 'Email', value: r?['email']), F('gstin', 'GSTIN', value: r?['gstin']), F('terms', 'Payment terms', value: r?['terms'], hint: 'e.g. 15 days'), F('address', 'Address', type: 'multiline', value: r?['address'])],
  rowTitle: (r) => _s(r['name']), rowSub: (r) => '${_s(r['contact'])} ${_s(r['phone'])}'.trim(),
);

final _cfgVariant = CrudCfg(
  kind: 'variant', title: 'Variants', sub: 'Sizes and portions you can reuse on items.', icon: Icons.straighten, add: 'Add variant', empty: 'For example Half, Full, Large.',
  fields: (r) => [F('name', 'Variant name', value: r?['name'], hint: 'e.g. Half, Large, 5 pcs'), F('dept', 'Type', type: 'select', value: r?['dept'] ?? 'size', options: const [['size', 'Size'], ['portion', 'Portion'], ['other', 'Other']])],
  rowTitle: (r) => _s(r['name']), rowSub: (r) => _s(r['dept']),
);

final _cfgAddon = CrudCfg(
  kind: 'addongrp', title: 'Add-ons', sub: 'Extras a guest can add to an item.', icon: Icons.add_circle_outline, add: 'Add group', empty: 'For example Toppings: Extra cheese 20, Jalapeños 10.',
  fields: (r) => [F('name', 'Group name', value: r?['name']), F('mods', 'Add-ons (Name:price, comma separated)', type: 'multiline', value: r?['mods'], hint: 'Extra cheese:20, Jalapeños:10'), F('min', 'Minimum choices', type: 'number', value: r?['min'] ?? 0), F('max', 'Maximum choices', type: 'number', value: r?['max'])],
  rowTitle: (r) => _s(r['name']), rowSub: (r) => _s(r['mods']),
);

final _cfgCoupon = CrudCfg(
  kind: 'coupon', title: 'Discounts', sub: 'Coupon codes for the cashier to apply.', icon: Icons.local_offer_outlined, add: 'Add coupon', empty: 'Create a code like WELCOME10.',
  fields: (r) => [F('code', 'Code', value: r?['code'], hint: 'WELCOME10'), F('type', 'Type', type: 'select', value: r?['type'] ?? '%', options: const [['%', '% off'], ['₹', '₹ off']]), F('value', 'Value', type: 'number', value: r?['value']), F('minBill', 'Minimum bill (₹)', type: 'number', value: r?['minBill']), F('expiry', 'Expires on (YYYY-MM-DD)', value: r?['expiry']), F('maxUses', 'Max uses', type: 'number', value: r?['maxUses'])],
  rowTitle: (r) => _s(r['code']), rowSub: (r) => '${r['type'] == '%' ? '${r['value']}% off' : '₹${r['value']} off'}${(r['minBill'] ?? 0) != 0 ? ' · min ₹${r['minBill']}' : ''}',
);

final _cfgOffer = CrudCfg(
  kind: 'offer', title: 'Offers', sub: 'Buy X get Y deals that apply on their own at billing.', icon: Icons.card_giftcard, add: 'Add offer', empty: 'For example Buy 2 get 1 free.',
  fields: (r) => [F('name', 'Offer name', value: r?['name']), F('buyQty', 'Buy quantity', type: 'number', value: r?['buyQty'] ?? 1), F('getQty', 'Get quantity', type: 'number', value: r?['getQty'] ?? 1), F('getPct', 'Discount on the "get" items (%)', type: 'number', value: r?['getPct'] ?? 100), F('from', 'Start date (YYYY-MM-DD)', value: r?['from']), F('to', 'End date (YYYY-MM-DD)', value: r?['to']), F('active', 'Active', type: 'check', value: r?['active'] != false)],
  rowTitle: (r) => _s(r['name']), rowSub: (r) => 'Buy ${r['buyQty']} get ${r['getQty']} at ${r['getPct']}% off', trail: (r) => r['active'] == false ? 'Off' : '',
);

final _cfgGift = CrudCfg(
  kind: 'giftcard', title: 'Gift Cards', sub: 'Prepaid cards a guest can pay with.', icon: Icons.card_giftcard, add: 'Issue gift card', empty: 'Issue a card with a code and a value.',
  fields: (r) => [F('code', 'Code', value: r?['code'] ?? 'GC${DateTime.now().millisecondsSinceEpoch.toRadixString(36).toUpperCase().substring(4)}'), F('amt', 'Value (₹)', type: 'number', value: r?['amt']), F('bal', 'Balance (₹)', type: 'number', value: r?['bal'], hint: 'Defaults to the full value'), F('to', 'Issued to (name)', value: r?['to']), F('phone', 'Mobile', value: r?['phone']), F('exp', 'Valid until (YYYY-MM-DD)', value: r?['exp'])],
  rowTitle: (r) => _s(r['code']), rowSub: (r) => '${_s(r['to'])} · of ₹${r['amt']}', trail: (r) => '₹${r['bal'] ?? r['amt']}',
);

final _cfgPlan = CrudCfg(
  kind: 'plan', title: 'Membership', sub: 'Plans a regular guest can buy.', icon: Icons.workspace_premium_outlined, add: 'Add plan', empty: 'Create a plan with a price and a duration.',
  fields: (r) => [F('name', 'Plan name', value: r?['name']), F('price', 'Price (₹)', type: 'number', value: r?['price']), F('days', 'Duration (days)', type: 'number', value: r?['days'] ?? 30), F('desc', 'Benefits', type: 'multiline', value: r?['desc']), F('active', 'Available to sell', type: 'check', value: r?['active'] != false)],
  rowTitle: (r) => _s(r['name']), rowSub: (r) => '${r['days']} days · ${_s(r['desc'])}', trail: (r) => '₹${r['price']}',
);

final _cfgTicket = CrudCfg(
  kind: 'ticket', title: 'Support', sub: 'Guest complaints and requests you are tracking.', icon: Icons.support_agent, add: 'New ticket', empty: 'Log a complaint or request to follow up.',
  fields: (r) => [F('subject', 'Subject', value: r?['subject']), F('custName', 'Customer', value: r?['custName']), F('custPhone', 'Mobile', value: r?['custPhone']), F('priority', 'Priority', type: 'select', value: r?['priority'] ?? 'medium', options: const [['low', 'Low'], ['medium', 'Medium'], ['high', 'High']]), F('status', 'Status', type: 'select', value: r?['status'] ?? 'open', options: const [['open', 'Open'], ['in_progress', 'In progress'], ['closed', 'Closed']]), F('description', 'Details', type: 'multiline', value: r?['description'])],
  rowTitle: (r) => _s(r['subject']), rowSub: (r) => '${_s(r['custName'])} · ${r['priority']}', trail: (r) => _s(r['status']).replaceAll('_', ' '),
);

final _cfgTask = CrudCfg(
  kind: 'task', title: 'Tasks', sub: 'Jobs for you and your team.', icon: Icons.checklist, add: 'New task', empty: 'Add a task and give it a due date.',
  fields: (r) => [F('title', 'Task', value: r?['title']), F('desc', 'Details', type: 'multiline', value: r?['desc']), F('dueDate', 'Due date (YYYY-MM-DD)', value: r?['dueDate']), F('priority', 'Priority', type: 'select', value: r?['priority'] ?? 'medium', options: const [['low', 'Low'], ['medium', 'Medium'], ['high', 'High']]), F('status', 'Status', type: 'select', value: r?['status'] ?? 'todo', options: const [['todo', 'To do'], ['in_progress', 'In progress'], ['done', 'Done']])],
  rowTitle: (r) => _s(r['title']), rowSub: (r) => '${_s(r['dueDate']).isEmpty ? 'No due date' : 'Due ${r['dueDate']}'} · ${r['priority']}', trail: (r) => _s(r['status']).replaceAll('_', ' '),
);

final _cfgCash = CrudCfg(
  kind: 'cashmove', title: 'Cash movements', sub: 'Money put into or taken out of the cash drawer.', icon: Icons.swap_vert, add: 'Add movement', empty: 'Record a top-up or a withdrawal.',
  fields: (r) => [F('type', 'Type', type: 'select', value: r?['type'] ?? 'out', options: const [['in', 'Cash top-up (add to drawer)'], ['out', 'Withdrawal']]), F('amt', 'Amount (₹)', type: 'number', value: r?['amt']), F('who', 'Who', value: r?['who']), F('d', 'Date (YYYY-MM-DD)', value: r?['d'] ?? dayKey(DateTime.now())), F('note', 'Note', value: r?['note'])],
  rowTitle: (r) => '${r['type'] == 'in' ? 'Top-up' : 'Withdrawal'} · ${_s(r['who'])}', rowSub: (r) => '${_s(r['d'])} ${_s(r['note'])}'.trim(), trail: (r) => '${r['type'] == 'in' ? '+' : '−'}₹${r['amt']}',
);

// Field names match the website's settlement record exactly (gross/commission/net/received/receivedOn/status
// -- app/public/console/p-finance.js settlementForm()); native previously saved a different shape
// (platform/amt/d/ref/note) that the website's "Pending payouts"/"Received"/"Commission paid" KPIs could
// never read, since they key off net/received/status/commission, not amt.
final _cfgSettle = CrudCfg(
  kind: 'settlement', title: 'Settlements', sub: 'Payouts from delivery platforms: what you sold, what they kept and what reached your bank.', icon: Icons.account_balance_outlined, add: 'Add settlement', empty: 'Record a payout from a platform.',
  fields: (r) => [
    F('platform', 'Platform', type: 'select', value: r?['platform'] ?? 'Swiggy', options: _opts(['Swiggy', 'Zomato', 'ONDC', 'Other'])),
    F('from', 'Period from (YYYY-MM-DD)', value: r?['from'] ?? dayKey(DateTime.now().subtract(const Duration(days: 6)))),
    F('to', 'Period to (YYYY-MM-DD)', value: r?['to'] ?? dayKey(DateTime.now())),
    F('gross', 'Gross sales (₹)', type: 'number', value: r?['gross']),
    F('commission', 'Commission & charges (₹)', type: 'number', value: r?['commission']),
    F('received', 'Amount received (₹)', type: 'number', value: r?['received'], hint: 'Leave empty while pending'),
    F('receivedOn', 'Received on (YYYY-MM-DD)', value: r?['receivedOn']),
    F('ref', 'Reference / UTR', value: r?['ref']),
  ],
  rowTitle: (r) => _s(r['platform']), rowSub: (r) => '${_s(r['to'])} ${_s(r['ref'])}'.trim(), trail: (r) => r['received'] != null ? '₹${r['received']}' : 'Pending',
);



final _cfgPlatform = CrudCfg(
  kind: 'platform', title: 'Platform Settings', sub: 'Commission and store details for each delivery platform.', icon: Icons.power_outlined, add: 'Add platform', empty: 'Add Swiggy or Zomato to estimate what you earn on each order.',
  // 'active' mirrors the website's platformEdit() "Listed on this platform" checkbox (app/public/
  // console/p-marketing.js) -- without it a platform could never be marked unlisted from this screen.
  fields: (r) => [F('name', 'Platform', value: r?['name']), F('commission', 'Commission (%)', type: 'number', value: r?['commission'] ?? 0), F('storeId', 'Store / restaurant ID', value: r?['storeId']), F('link', 'Partner dashboard link', value: r?['link']), F('priceMarkup', 'Menu price markup (%)', type: 'number', value: r?['priceMarkup'] ?? 0), F('active', 'Listed on this platform', type: 'check', value: r?['active'] != false)],
  rowTitle: (r) => _s(r['name']), rowSub: (r) => 'Commission ${r['commission'] ?? 0}%${r['active'] == false ? ' · Off' : ''}', trail: (r) => _s(r['storeId']),
);

final _cfgReason = CrudCfg(
  kind: 'reason', title: 'Cancellations', sub: 'Reasons the cashier can pick when cancelling.', icon: Icons.cancel_outlined, add: 'Add reason', empty: 'For example Customer changed mind.',
  fields: (r) => [F('name', 'Reason', value: r?['name'])],
  rowTitle: (r) => _s(r['name']), rowSub: (r) => '',
);

final _cfgOutlet = CrudCfg(
  kind: 'outlet', title: 'Outlets', sub: 'Your branches.', icon: Icons.apartment, add: 'Add outlet', empty: 'Add a second branch to run more than one outlet.',
  fields: (r) => [F('name', 'Outlet name', value: r?['name']), F('addr', 'Address', type: 'multiline', value: r?['addr']), F('phone', 'Phone', value: r?['phone']), F('gstin', 'GSTIN', value: r?['gstin']), F('active', 'Active', type: 'check', value: r?['active'] != false)],
  rowTitle: (r) => _s(r['name']), rowSub: (r) => _s(r['addr']), trail: (r) => r['active'] == false ? 'Off' : '',
);

final _cfgDevice = CrudCfg(
  kind: 'device', title: 'Devices', sub: 'Tills, printers and screens.', icon: Icons.devices_other, add: 'Add device', empty: 'Name each counter or printer so you can tell them apart.',
  fields: (r) => [F('name', 'Device name', value: r?['name'], hint: 'Counter 1'), F('type', 'Type', type: 'select', value: r?['type'] ?? 'POS', options: _opts(['POS', 'Printer', 'Kitchen screen', 'Token display', 'Tablet'])), F('code', 'Device code', value: r?['code']), F('printer', 'Printer / paper', value: r?['printer']), F('active', 'Active', type: 'check', value: r?['active'] != false)],
  rowTitle: (r) => _s(r['name']), rowSub: (r) => _s(r['type']), trail: (r) => r['active'] == false ? 'Off' : '',
);

final _cfgLink = CrudCfg(
  kind: 'quicklink', title: 'Custom Links', sub: 'Shortcuts to pages you use often.', icon: Icons.link, add: 'Add link', empty: 'Save a link, for example your partner dashboard.',
  fields: (r) => [F('label', 'Label', value: r?['label']), F('url', 'Link', value: r?['url'], hint: 'https://')],
  rowTitle: (r) => _s(r['label']), rowSub: (r) => _s(r['url']),
);

class CrudPage extends StatefulWidget {
  const CrudPage(this.h, this.cfg, {super.key});
  final HomeState h;
  final CrudCfg cfg;
  @override
  State<CrudPage> createState() => _CrudPageState();
}

class _CrudPageState extends State<CrudPage> {
  String q = '';
  CrudCfg get c => widget.cfg;
  HomeState get h => widget.h;

  Future<void> edit([Map<String, dynamic>? r]) => formSheet(
        context,
        r == null ? c.add : 'Edit ${c.title.toLowerCase()}',
        c.fields(r),
        (v) async {
          final first = v.values.firstWhere((x) => x is String && x.isNotEmpty, orElse: () => null);
          if (first == null) return false;
          final d = {...?r, ...v};
          if (c.kind == 'giftcard') d['bal'] = d['bal'] ?? d['amt'];
          if (c.kind == 'segment' || c.kind == 'campaign') d['n'] = d['n'] ?? DateTime.now().millisecondsSinceEpoch;
          if (c.kind == 'settlement') {
            final gross = (d['gross'] as num?) ?? 0, commission = (d['commission'] as num?) ?? 0;
            d['net'] = r2(gross - commission);
            d['status'] = d['received'] != null ? 'received' : 'pending';
          }
          await h.s.repo!.save(c.kind, d, id: r?['id'] as String?);
          setState(() {});
          h.s.sync();
          return true;
        },
        onDelete: r == null
            ? null
            : () async {
                await h.s.repo!.save(c.kind, r, id: r['id'] as String, deleted: true);
                setState(() {});
                h.s.sync();
              },
      );

  @override
  Widget build(BuildContext context) {
    final all = h.s.repo!.of(c.kind).toList()..sort((a, b) => c.rowTitle(a).toLowerCase().compareTo(c.rowTitle(b).toLowerCase()));
    final list = all.where((r) => q.isEmpty || '${c.rowTitle(r)} ${c.rowSub(r)}'.toLowerCase().contains(q.toLowerCase())).toList();
    return ListView(padding: const EdgeInsets.only(bottom: 28), children: [
      PageHead(c.title, sub: c.sub, trailing: PillBtn(c.add.split(' ').first, icon: Icons.add, fill: true, onTap: () => edit())),
      if (all.length > 6) Padding(padding: const EdgeInsets.fromLTRB(16, 12, 16, 4), child: TextField(decoration: InputDecoration(prefixIcon: Icon(Icons.search), hintText: tr('Search')), onChanged: (v) => setState(() => q = v))),
      const SizedBox(height: 12),
      if (list.isEmpty)
        Empty(c.icon, all.isEmpty ? 'Nothing here yet' : 'No matches', all.isEmpty ? c.empty : 'Try a different search.', action: all.isEmpty ? c.add : null, onAction: () => edit())
      else
        Group([
          for (final r in list)
            Li(c.rowTitle(r), sub: c.rowSub(r).isEmpty ? null : c.rowSub(r), icon: c.icon, tone: c.tone ?? Tk.accent, value: c.trail?.call(r), onTap: () => edit(r)),
        ]),
    ]);
  }
}

// ------------------------------------------------------------------ overview + daily

class _Overview extends StatefulWidget {
  const _Overview(this.h, this.go);
  final HomeState h;
  final void Function(String) go;
  @override
  State<_Overview> createState() => _OverviewState();
}

class _OverviewState extends State<_Overview> {
  int days = 7;
  bool bestItems = true;
  @override
  Widget build(BuildContext context) {
    final h = widget.h;
    final paid = paidIn(h.s.repo!, days);
    // Revenue is net of refunds (website's netOf()), not the raw bill total -- a partially refunded
    // bill must not overstate "Revenue"/"Profit (rough)" here.
    final total = paid.fold<num>(0, (a, o) => a + netOf(o));
    final modes = <String, double>{};
    final byDay = <String, double>{};
    for (final o in paid) {
      final d = dayOfIso(o['paidAt']);
      byDay[d] = (byDay[d] ?? 0) + netOf(o);
      for (final p in ((o['pays'] as List?) ?? []).cast<Map>()) {
        modes['${p['m']}'] = (modes['${p['m']}'] ?? 0) + ((p['amt'] ?? 0) as num);
      }
    }
    final open = h.s.repo!.of('order').where((o) => o['status'] == 'open' && ((o['lines'] as List?)?.isNotEmpty ?? false)).length;
    final exp = h.s.repo!.of('exp').where((e) => '${e['d']}'.compareTo(dayKey(DateTime.now().subtract(Duration(days: days - 1)))) >= 0).fold<num>(0, (a, e) => a + ((e['amt'] ?? 0) as num));
    final keys = byDay.keys.toList()..sort();
    final mx = byDay.values.fold<double>(1, (a, b) => b > a ? b : a);
    final today = dayKeyOf(DateTime.now());
    final todayStats = dayStats(h.s.repo!, today);
    final yStats = dayStats(h.s.repo!, dayKeyOf(DateTime.now().subtract(const Duration(days: 1))));
    final delta = yStats.rev > 0 ? ((todayStats.rev - yStats.rev) / yStats.rev * 100).round() : null;
    final itemRange = itemStats(h.s.repo!, dayKeyOf(DateTime.now().subtract(Duration(days: days - 1))), today);
    final topList = topOrLowItems(itemRange, best: bestItems, n: 8);
    return ListView(padding: const EdgeInsets.only(bottom: 28), children: [
      ..._greetingSection(h),
      RangeBar(days, (v) => setState(() => days = v)),
      Kpis('Revenue', inr(r2(total)), '${paid.length} bills · avg ${inr(paid.isEmpty ? 0 : r2(total / paid.length))}', [
        ('Open orders', '$open', null),
        ('Expenses', inr(r2(exp)), Tk.orange),
        ('Profit (rough)', inr(r2(total - exp)), total - exp >= 0 ? Tk.green : Tk.red),
        ('Tables', '${h.s.repo!.of('table').length}', null),
      ]),
      const SectionLabel("Today vs. yesterday"),
      Group([
        Li('Today\'s revenue', chevron: false, value: inr(todayStats.rev), trailing: delta == null
            ? null
            : Text('${delta < 0 ? '↓' : '↑'} ${delta.abs()}%', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: delta < 0 ? Tk.red : Tk.green))),
        Li('Yesterday', chevron: false, value: inr(yStats.rev)),
      ]),
      if (keys.length > 1) ...[
        const SectionLabel('Sales by day'),
        Group([for (final d in keys) Padding(padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12), child: Row(children: [SizedBox(width: 56, child: Text(d.substring(5), style: TextStyle(fontSize: 16, color: Tk.label2))), Expanded(child: ClipRRect(borderRadius: BorderRadius.circular(8), child: LinearProgressIndicator(value: byDay[d]! / mx, minHeight: 14, color: Tk.accent, backgroundColor: Tk.fill2))), const SizedBox(width: 12), Text(inr(r2(byDay[d]!)), style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700))]))]),
      ],
      ..._hourlyTrendSection(todayStats),
      const SectionLabel('Payment modes'),
      Group(modes.isEmpty ? [const Li('No payments in this range', chevron: false)] : [for (final e in modes.entries) Li(e.key == 'upi' ? 'UPI' : '${e.key[0].toUpperCase()}${e.key.substring(1)}', chevron: false, value: inr(r2(e.value)))]),
      ..._channelsSection(todayStats),
      ..._onlineOverviewSection(h, todayStats),
      SectionLabel(bestItems ? 'Best sellers' : 'Low performers'),
      Padding(
        padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
        child: Row(children: [
          Expanded(child: _tabChip('Best Sellers', bestItems, () => setState(() => bestItems = true))),
          const SizedBox(width: 8),
          Expanded(child: _tabChip('Low Performers', !bestItems, () => setState(() => bestItems = false))),
        ]),
      ),
      Group(topList.isEmpty
          ? [const Li('No sales yet', chevron: false)]
          : [for (final x in topList) Li(x.name, chevron: false, sub: '${x.pct.toStringAsFixed(1)}% of units sold', value: '${x.qty}')]),
      ..._businessHealthSection(h),
      ..._leakageSection(h, today),
      ..._snapshotSection(h, today),
      ..._quickActionsSection(widget.go),
    ]);
  }
}

Widget _tabChip(String label, bool on, VoidCallback onTap) => GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 10),
        alignment: Alignment.center,
        decoration: BoxDecoration(color: on ? Tk.accent : Tk.card, borderRadius: BorderRadius.circular(14), border: Border.all(color: on ? Tk.accent : Tk.line)),
        child: Text(label, style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: on ? Colors.white : Tk.label)),
      ),
    );

/// Outlet-aware greeting header, ported from the website's `greeting()` + `allOutletsNote()`.
List<Widget> _greetingSection(HomeState h) {
  final hr = DateTime.now().hour;
  final greeting = hr < 12 ? 'Good Morning!' : hr < 17 ? 'Good Afternoon!' : 'Good Evening!';
  final outlet = h.s.repo!.outlet;
  final outletName = outlet == 'all' ? 'all your outlets' : '${h.s.cfg['name'] ?? 'this outlet'}';
  return [
    Padding(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 0),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(greeting, style: const TextStyle(fontSize: 26, fontWeight: FontWeight.w800)),
        Padding(padding: const EdgeInsets.only(top: 2), child: Text("Here's what's happening at $outletName today.", style: TextStyle(fontSize: 16, color: Tk.label2))),
        if (outlet == 'all') Padding(padding: const EdgeInsets.only(top: 8), child: Text('Showing all outlets combined. Pick one outlet to work inside it.', style: TextStyle(fontSize: 14, color: Tk.orange))),
      ]),
    ),
  ];
}

/// "Sales Trend" -- hourly revenue for today, condensed to 2-hour buckets (12 bars) the same way the
/// website's own "Total Orders" mini-bars are condensed, since a 24-bar chart is too fine-grained for
/// a phone-width card. Genuine per-hour data from dayStats(), never decorative.
List<Widget> _hourlyTrendSection(DayStats today) {
  final buckets = List<num>.filled(12, 0);
  for (var i = 0; i < 24; i++) {
    buckets[i ~/ 2] += today.hours[i];
  }
  final mx = buckets.fold<num>(1, (a, b) => b > a ? b : a);
  if (today.hours.every((v) => v == 0)) {
    return [const SectionLabel('Sales Trend (today, by hour)'), Group(const [Li('No sales yet today', chevron: false)])];
  }
  return [
    const SectionLabel('Sales Trend (today, by hour)'),
    Container(
      margin: const EdgeInsets.symmetric(horizontal: 16),
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 10),
      decoration: BoxDecoration(color: Tk.card, borderRadius: BorderRadius.circular(22), border: Border.all(color: Tk.line, width: .5)),
      child: SizedBox(
        height: 90,
        child: Row(crossAxisAlignment: CrossAxisAlignment.end, children: [
          for (var i = 0; i < 12; i++)
            Expanded(
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 2),
                child: Column(mainAxisAlignment: MainAxisAlignment.end, children: [
                  Container(height: (buckets[i] / mx * 64).clamp(2, 64).toDouble(), decoration: BoxDecoration(color: Tk.accent.withValues(alpha: buckets[i] > 0 ? 1 : .25), borderRadius: BorderRadius.circular(3))),
                  const SizedBox(height: 6),
                  Text('${i * 2}', style: TextStyle(fontSize: 10, color: Tk.label3)),
                ]),
              ),
            ),
        ]),
      ),
    ),
  ];
}

/// "Order Channels" -- Dine-In/Takeaway/Delivery revenue+count for today.
List<Widget> _channelsSection(DayStats today) {
  final total = today.ch.values.fold<num>(0, (a, c) => a + c.value);
  return [
    const SectionLabel('Order Channels (today)'),
    Group([
      for (final k in ['Dine-In', 'Takeaway', 'Delivery'])
        Li(k, chevron: false, sub: '${today.ch[k]!.count} orders · ${total > 0 ? (today.ch[k]!.value / total * 100).round() : 0}%', value: inr(r2(today.ch[k]!.value))),
    ]),
  ];
}

/// "Online Orders Overview" -- today's online (src-tagged) orders, by platform.
List<Widget> _onlineOverviewSection(HomeState h, DayStats today) {
  final byP = onlinePlatformStats(today);
  final total = byP.values.fold<int>(0, (a, p) => a + p.n);
  final prepaid = byP.values.fold<int>(0, (a, p) => a + p.pre);
  final revenue = byP.values.fold<num>(0, (a, p) => a + p.rev);
  return [
    const SectionLabel('Online Orders Overview (today)'),
    Group([
      Li('Total online orders', chevron: false, value: '$total'),
      Li('Prepaid', chevron: false, value: '$prepaid'),
      Li('COD', chevron: false, value: '${total - prepaid}'),
      Li('Revenue', chevron: false, value: inr(r2(revenue))),
      if (byP.isEmpty) const Li('No online orders today', chevron: false) else for (final e in byP.entries) Li(e.key, chevron: false, sub: '${e.value.n} orders · ${e.value.pre} prepaid · ${e.value.cod} COD', value: inr(r2(e.value.rev))),
    ]),
  ];
}

/// "Revenue Leakage" -- today's cancelled/modified/shifted/reprinted bills and waived-off amount.
List<Widget> _leakageSection(HomeState h, String today) {
  final lk = revenueLeakage(h.s.repo!, today);
  return [
    const SectionLabel('Revenue Leakage (today)'),
    Group([
      Li('KOTs', chevron: false, value: '${lk.kots}'),
      Li('Cancelled Bills', chevron: false, value: '${lk.cancelledBills}'),
      Li('Modified Bills', chevron: false, value: '${lk.modifiedBills}'),
      Li('Shifted Orders', chevron: false, value: '${lk.shiftedOrders}'),
      Li('Reprinted Bills', chevron: false, value: '${lk.reprintedBills}'),
      Li('Waived Off', chevron: false, value: inr(r2(lk.waivedOff))),
    ]),
  ];
}

/// "Daily Snapshot" -- a 7-day stacked view of channel revenue, matching the website's own bar-chart
/// card (here: one row per day with a channel breakdown, since a phone-width stacked chart with 7
/// clusters of 3 bars each is cramped; the numbers are identical, only the chart shape differs).
List<Widget> _snapshotSection(HomeState h, String today) {
  final days = [for (var i = 6; i >= 0; i--) dayKeyOf(DateTime.now().subtract(Duration(days: i)))];
  final stats = [for (final d in days) dayStats(h.s.repo!, d)];
  final mx = stats.fold<num>(1, (a, s) => s.ch.values.fold<num>(a, (b, c) => c.value > b ? c.value : b));
  return [
    const SectionLabel('Daily Snapshot (last 7 days)'),
    Group([
      for (var i = 0; i < days.length; i++)
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(days[i].substring(5), style: TextStyle(fontSize: 14, color: Tk.label2)),
            const SizedBox(height: 4),
            Row(children: [
              for (final k in ['Dine-In', 'Takeaway', 'Delivery'])
                Expanded(
                  child: Padding(
                    padding: const EdgeInsets.only(right: 3),
                    child: ClipRRect(borderRadius: BorderRadius.circular(4), child: LinearProgressIndicator(value: (stats[i].ch[k]!.value / mx).clamp(0, 1).toDouble(), minHeight: 8, color: k == 'Dine-In' ? Tk.accent : (k == 'Takeaway' ? Tk.green : Tk.orange), backgroundColor: Tk.fill2)),
                  ),
                ),
            ]),
          ]),
        ),
    ]),
    Padding(
      padding: const EdgeInsets.fromLTRB(16, 4, 16, 0),
      child: Row(children: [
        _legendDot(Tk.accent, 'Dine-In'),
        const SizedBox(width: 14),
        _legendDot(Tk.green, 'Takeaway'),
        const SizedBox(width: 14),
        _legendDot(Tk.orange, 'Delivery'),
      ]),
    ),
  ];
}

Widget _legendDot(Color c, String label) => Row(mainAxisSize: MainAxisSize.min, children: [
      Container(width: 10, height: 10, decoration: BoxDecoration(color: c, shape: BoxShape.circle)),
      const SizedBox(width: 6),
      Text(label, style: TextStyle(fontSize: 13, color: Tk.label2)),
    ]);

/// "Quick Actions" -- shortcuts into other Console pages, matching the website's own set.
List<Widget> _quickActionsSection(void Function(String) go) => [
      const SectionLabel('Quick Actions'),
      Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16),
        child: Wrap(spacing: 10, runSpacing: 10, children: [
          for (final (label, icon, route) in const [('Manage Menu', Icons.restaurant_menu, 'menu/items'), ('Run Reports', Icons.bar_chart, 'rep/sales'), ('Know Staff Costs', Icons.groups_outlined, 'team/attendance'), ('Explore Marketing', Icons.campaign_outlined, 'mkt/campaigns')])
            OutlinedButton.icon(onPressed: () => go(route), icon: Icon(icon, size: 18), label: Text(label)),
        ]),
      ),
    ];

/// "Business Health" card: average margin across every priced+costed item vs. the business's
/// configured target margin (`settings.targetMargin`, default 70) and how many items fall short --
/// ported from the website Dashboard's own card (app/public/console/p-dashboard.js, `margins()` +
/// `+cfg().targetMargin||70`), using the already-ported `businessHealth()` in costing.dart.
List<Widget> _businessHealthSection(HomeState h) {
  final target = (h.s.cfg['targetMargin'] as num?) ?? 70;
  final bh = businessHealth(h.s.repo!, target);
  return [
    const SectionLabel('Business Health'),
    Group(bh == null
        ? [const Li('Add a cost or recipe to your items to see margin health', chevron: false)]
        : [
            Li('Target margin', chevron: false, value: '${target.toStringAsFixed(0)}%'),
            Li('Average margin', chevron: false, value: '${bh.avg}%', titleColor: bh.avg >= target ? Tk.green : Tk.red),
            Li(bh.below == 0 ? 'Every priced item meets the target' : '${bh.below} of ${bh.total} items are below target', chevron: false, titleColor: bh.below == 0 ? Tk.green : Tk.orange),
          ]),
  ];
}

class OrderList extends StatelessWidget {
  const OrderList(this.h, {required this.title, required this.sub, required this.filter, super.key});
  final HomeState h;
  final String title, sub;
  final bool Function(Map<String, dynamic>) filter;
  @override
  Widget build(BuildContext context) {
    final list = h.s.repo!.of('order').where((o) => ((o['lines'] as List?)?.isNotEmpty ?? false) && filter(o)).toList()..sort((a, b) => '${b['created']}'.compareTo('${a['created']}'));
    return ListView(padding: const EdgeInsets.only(bottom: 28), children: [
      PageHead(title, sub: sub),
      const SizedBox(height: 12),
      if (list.isEmpty) const Empty(Icons.receipt_long_outlined, 'No orders here', 'Orders will show up as soon as they are created.') else Group([
        for (final o in list.take(100))
          Li('${o['no'] ?? 'New'} · ${o['type']}${o['table'] != null ? ' · ${h.s.repo!.rec('${o['table']}')?['name'] ?? ''}' : ''}', sub: '${o['status']}${(o['src'] ?? '') != '' ? ' · ${o['src']}' : ''}', icon: Icons.receipt_long_outlined, value: inr(totalOf(o).toInt() == 0 ? h.s.tot(o).total : totalOf(o)), onTap: () => orderSheet(context, h, o)),
      ]),
    ]);
  }
}

class _Kot extends StatelessWidget {
  const _Kot(this.h);
  final HomeState h;
  @override
  Widget build(BuildContext context) {
    final list = h.s.repo!.of('kotlog').toList()..sort((a, b) => '${b['createdAt']}'.compareTo('${a['createdAt']}'));
    return ListView(padding: const EdgeInsets.only(bottom: 28), children: [
      PageHead('KOT', sub: 'Every kitchen ticket that was sent'),
      const SizedBox(height: 12),
      if (list.isEmpty) const Empty(Icons.receipt_outlined, 'No tickets yet', 'Tickets appear when an order is sent to the kitchen.') else Group([
        for (final k in list.take(80)) Li('KOT #${k['kotNo']} · ${k['orderNo'] ?? ''}', sub: ((k['items'] as List?) ?? []).cast<Map>().map((i) => '${i['q']} × ${i['n']}').join(', '), icon: Icons.receipt_outlined, tone: const Color(0xFFF09A2E), chevron: false),
      ]),
    ]);
  }
}

// ------------------------------------------------------------------ inventory pages

/// Direct purchases (existing, unchanged) plus, for an owner or manager, a Purchase Orders tab -- the
/// website's two independent purchasing paths (purchaseDirect() vs poForm()/receivePO(), both reachable
/// from its own inv/purchase page) shown here as a segmented control instead of two separate buttons.
class _Purchases extends StatefulWidget {
  const _Purchases(this.h);
  final HomeState h;
  @override
  State<_Purchases> createState() => _PurchasesState();
}

class _PurchasesState extends State<_Purchases> {
  HomeState get h => widget.h;
  late String tab;

  @override
  void initState() {
    super.initState();
    // Audit finding: the Alerts Center's 'po' alert ("N purchase orders not yet received") sends
    // the user to this exact screen (navTo 'inv/purchase'), but it always opened on "Direct
    // purchase" by default -- unrelated to what the alert was about, landing on an empty-looking
    // tab until the person manually switches the segmented control. openPurchaseOrders() is the
    // SAME function computeConsoleAlerts() now uses for that alert (console.dart) -- opening here
    // on whatever tab actually has something to review, for every path into this screen, not just
    // the alert's, and the two can never silently drift apart again.
    tab = openPurchaseOrders(h.s.repo!).isNotEmpty ? 'orders' : 'direct';
  }

  Future<void> add() {
    final ings = h.s.repo!.of('ing').toList();
    if (ings.isEmpty) {
      h.toast('Add raw materials first');
      return Future.value();
    }
    return formSheet(
      context,
      'Record a purchase',
      [F('name', 'Raw material', type: 'select', value: '${ings.first['name']}', options: [for (final g in ings) ['${g['name']}', '${g['name']}']]), F('qty', 'Quantity bought', type: 'number'), F('price', 'Price per unit (₹)', type: 'number'), F('vendor', 'Vendor'), F('d', 'Date (YYYY-MM-DD)', value: dayKey(DateTime.now()))],
      (v) async {
        final g = ings.where((x) => x['name'] == v['name']).firstOrNull;
        if (g == null || v['qty'] == null || (v['qty'] as num) <= 0) return false;
        await recordDirectPurchase(h.s.repo!, material: '${v['name']}', qty: v['qty'] as num, unitPrice: (v['price'] ?? 0) as num, unit: '${g['unit'] ?? ''}', vendor: v['vendor'] as String?, date: '${v['d']}');
        await h.s.repo!.save('ing', {...g, 'qty': r2(((g['qty'] ?? 0) as num) + (v['qty'] as num)), if (v['price'] != null) 'cost': v['price']}, id: '${g['id']}');
        setState(() {});
        h.s.sync();
        return true;
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final canOrders = h.s.role == 'owner' || h.s.role == 'manager';
    Widget direct() {
      final list = purchaseRows(h.s.repo!).take(100).toList();
      return ListView(padding: const EdgeInsets.only(bottom: 28), children: [
        PageHead('Direct purchase', sub: 'Stock you bought. Adds to your raw materials straight away.', trailing: PillBtn('Add', icon: Icons.add, fill: true, onTap: add)),
        const SizedBox(height: 12),
        if (list.isEmpty) Empty(Icons.shopping_cart_outlined, 'No purchases yet', 'Record what you buy so stock and costs stay right.', action: 'Record a purchase', onAction: add) else Group([
          for (final p in list) Li(p.itemsSummary, sub: '${p.date} · ${p.vendorName}', icon: Icons.shopping_cart_outlined, tone: Tk.green, value: inr(r2(p.amount)), chevron: false),
        ]),
      ]);
    }

    if (!canOrders) return direct();
    return Column(children: [
      Padding(padding: const EdgeInsets.fromLTRB(16, 10, 16, 0), child: Seg<String>(expand: true, items: const [('direct', 'Direct purchase'), ('orders', 'Purchase orders')], value: tab, onChanged: (v) => setState(() => tab = v))),
      Expanded(child: tab == 'orders' ? PoOrdersTab(h) : direct()),
    ]);
  }
}

class _Recipes extends StatefulWidget {
  const _Recipes(this.h);
  final HomeState h;
  @override
  State<_Recipes> createState() => _RecipesState();
}

class _RecipesState extends State<_Recipes> {
  HomeState get h => widget.h;
  @override
  Widget build(BuildContext context) {
    final items = h.s.repo!.of('item').toList()..sort((a, b) => '${a['name']}'.compareTo('${b['name']}'));
    return ListView(padding: const EdgeInsets.only(bottom: 28), children: [
      const PageHead('Recipes', sub: 'What each dish uses. Stock goes down when it sells.'),
      const SizedBox(height: 12),
      if (items.isEmpty) const Empty(Icons.menu_book_outlined, 'No items yet', 'Add menu items first.') else Group([
        for (final i in items)
          Li('${i['name']}', sub: _s(i['rec']).isEmpty ? 'No recipe' : _s(i['rec']), icon: Icons.menu_book_outlined, tone: _s(i['rec']).isEmpty ? null : Tk.green, onTap: () => formSheet(context, 'Recipe · ${i['name']}', [F('rec', 'Ingredients (name:quantity, comma separated)', type: 'multiline', value: i['rec'], hint: 'Milk:0.2, Tea:0.01')], (v) async {
                await h.s.repo!.save('item', {...i, 'rec': v['rec']}, id: '${i['id']}');
                setState(() {});
                h.s.sync();
                return true;
              })),
      ]),
    ]);
  }
}

class _Consumption extends StatelessWidget {
  const _Consumption(this.h);
  final HomeState h;
  @override
  Widget build(BuildContext context) {
    final recipes = {for (final i in h.s.repo!.of('item')) '${i['id']}': _s(i['rec'])};
    final use = <String, double>{};
    for (final o in paidIn(h.s.repo!, 7)) {
      for (final l in ((o['lines'] as List?) ?? []).cast<Map>()) {
        final rec = recipes['${l['id']}'] ?? '';
        for (final part in rec.split(',')) {
          final kv = part.split(':');
          if (kv.length < 2) continue;
          final n = kv[0].trim();
          final q = double.tryParse(kv[1].trim()) ?? 0;
          use[n] = (use[n] ?? 0) + q * (l['qty'] as num);
        }
      }
    }
    final rows = use.entries.toList()..sort((a, b) => b.value.compareTo(a.value));
    return ListView(padding: const EdgeInsets.only(bottom: 28), children: [
      const PageHead('Consumption', sub: 'Raw materials used by sales in the last 7 days'),
      const SizedBox(height: 12),
      if (rows.isEmpty) const Empty(Icons.analytics_outlined, 'Nothing to show', 'Add recipes to your items, then sell to see usage here.') else Group([for (final e in rows) Li(e.key, chevron: false, value: '${r2(e.value)}')]),
    ]);
  }
}

// ------------------------------------------------------------------ report pages

abstract class _RepState<T extends StatefulWidget> extends State<T> {
  int days = 7;
}

class _RepOrders extends StatefulWidget {
  const _RepOrders(this.h);
  final HomeState h;
  @override
  State<_RepOrders> createState() => _RepOrdersState();
}

class _RepOrdersState extends _RepState<_RepOrders> {
  @override
  Widget build(BuildContext context) {
    final from = dayKey(DateTime.now().subtract(Duration(days: days - 1)));
    // Every non-void-filtered order CREATED in range (website's own `all_`), not just paid ones --
    // Open/Due/Cancelled all read from this set, matching rep/orders exactly.
    final all = widget.h.s.repo!.of('order').where((o) => (o['t'] as Map?) != null && dayKey(DateTime.tryParse('${o['created']}') ?? DateTime(2000)).compareTo(from) >= 0).toList();
    final p = all.where((o) => o['status'] == 'paid').toList();
    final byType = <String, (int, double)>{};
    for (final o in p) {
      final t = '${o['type']}';
      final c = byType[t] ?? (0, 0.0);
      byType[t] = (c.$1 + 1, c.$2 + netOf(o));
    }
    final openDue = all.where((o) => o['status'] == 'open' || o['status'] == 'due').length;
    final cancelled = all.where((o) => o['status'] == 'void').length;
    final flagged = all.where((o) => o['status'] == 'void' || (((o['refunds'] as List?) ?? const []).isNotEmpty) || o['complimentary'] == true).toList();
    final kotMins = widget.h.s.repo!.of('kotlog').where((k) => k['readyAt'] != null && dayKey(DateTime.tryParse('${k['createdAt']}') ?? DateTime(2000)).compareTo(from) >= 0).map((k) {
      final c = DateTime.tryParse('${k['createdAt']}'), r = DateTime.tryParse('${k['readyAt']}');
      return (c == null || r == null) ? null : r.difference(c).inMinutes;
    }).whereType<int>().toList();
    final avgPrep = kotMins.isEmpty ? null : (kotMins.reduce((a, b) => a + b) / kotMins.length).round();
    final total = p.fold<num>(0, (a, o) => a + netOf(o));
    return ListView(padding: const EdgeInsets.only(bottom: 28), children: [
      RangeBar(days, (v) => setState(() => days = v)),
      Kpis('Orders', '${all.length}', '${p.length} paid · ${inr(r2(total))} revenue', [
        ('Open / due', '$openDue', null),
        ('Cancelled', '$cancelled', cancelled > 0 ? Tk.red : null),
        ('Avg. prep time', avgPrep == null ? '—' : '$avgPrep min', null),
      ]),
      const SectionLabel('By order type'),
      Group(byType.isEmpty ? [const Li('No orders in this range', chevron: false)] : [for (final e in byType.entries) Li(e.key, sub: '${e.value.$1} orders', chevron: false, value: inr(r2(e.value.$2)))]),
      const SectionLabel('Cancelled, refunded and complimentary'),
      Group(flagged.isEmpty
          ? [const Li('Nothing cancelled in this range', chevron: false)]
          : [
              for (final o in flagged)
                Li(
                  '${o['no'] ?? '—'}',
                  sub: o['status'] == 'void' ? (o['voidReason'] ?? 'Cancelled').toString() : (((o['refunds'] as List?) ?? const []).isNotEmpty ? 'Refunded' : (o['compReason'] ?? 'Complimentary').toString()),
                  icon: o['status'] == 'void' ? Icons.cancel_outlined : Icons.undo,
                  tone: o['status'] == 'void' ? Tk.red : Tk.orange,
                  chevron: false,
                  value: inr(((o['t'] as Map?)?['total'] ?? 0) as num),
                ),
            ]),
    ]);
  }
}

class _RepItems extends StatefulWidget {
  const _RepItems(this.h);
  final HomeState h;
  @override
  State<_RepItems> createState() => _RepItemsState();
}

class _RepItemsState extends _RepState<_RepItems> {
  String view = 'item';
  @override
  Widget build(BuildContext context) {
    final h = widget.h;
    final cats = {for (final c in h.s.repo!.of('cat')) '${c['id']}': '${c['name']}'};
    final itemCat = {for (final i in h.s.repo!.of('item')) '${i['id']}': '${cats[i['cat']] ?? 'Other'}'};
    final amt = <String, double>{}, qty = <String, num>{};
    final sold = <String>{};
    for (final o in paidIn(h.s.repo!, days)) {
      for (final l in ((o['lines'] as List?) ?? []).cast<Map>()) {
        final k = view == 'item' ? '${l['name']}' : (itemCat['${l['id']}'] ?? 'Other');
        amt[k] = (amt[k] ?? 0) + (l['price'] as num) * (l['qty'] as num);
        qty[k] = (qty[k] ?? 0) + (l['qty'] as num);
        sold.add('${l['id']}');
      }
    }
    final rows = amt.entries.toList()..sort((a, b) => b.value.compareTo(a.value));
    final notSold = h.s.repo!.of('item').where((i) => !sold.contains('${i['id']}')).length;
    final rev = amt.values.fold<double>(0, (a, b) => a + b);
    return ListView(padding: const EdgeInsets.only(bottom: 28), children: [
      RangeBar(days, (v) => setState(() => days = v)),
      Kpis('Revenue (items)', inr(r2(rev)), '${sold.length} items sold', [('Not sold in range', '$notSold', null), ('Top item', rows.isEmpty ? '–' : rows.first.key, null)]),
      Padding(padding: const EdgeInsets.fromLTRB(16, 14, 16, 6), child: Seg<String>(expand: true, items: const [('item', 'By item'), ('cat', 'By category')], value: view, onChanged: (v) => setState(() => view = v))),
      Group(rows.isEmpty ? [const Li('No sales in this range', chevron: false)] : [for (final e in rows) Li(e.key, sub: '${qty[e.key]} sold', chevron: false, value: inr(r2(e.value)))]),
    ]);
  }
}

/// Stock summary / Reorder / Expiry, matching 3 of the website's 6 invReportTabs() (Purchases, Wastage and
/// Food costing are a separate, later batch -- see the Reports-audit commit this builds on). "Create PO"
/// on the website pre-fills a draft Purchase Order (a `po` record: draft -> received workflow) that native
/// has never built any support for at all (native's existing Purchases screen uses a different, simpler
/// `purchase` record that adds to stock immediately, with no draft/receive step). Building the full `po`
/// draft/receive system is a materially bigger feature than "reorder suggestions" -- so the reorder row's
/// action instead reuses native's own existing direct-purchase flow, pre-filled with the suggested
/// quantity and the material's own vendor. This is a deliberate, smaller, documented substitute for the
/// website's "Create PO" button, not a silent gap.
class _RepInventory extends StatefulWidget {
  const _RepInventory(this.h);
  final HomeState h;
  @override
  State<_RepInventory> createState() => _RepInventoryState();
}

class _RepInventoryState extends State<_RepInventory> {
  String tab = 'stock';
  HomeState get h => widget.h;

  Future<void> recordPurchase(Map<String, dynamic> g, num suggestedQty) => formSheet(
        context,
        'Record a purchase',
        [
          F('name', 'Raw material', value: '${g['name']}'),
          F('qty', 'Quantity bought', type: 'number', value: suggestedQty > 0 ? suggestedQty : null),
          F('price', 'Price per unit (₹)', type: 'number', value: g['cost']),
          F('vendor', 'Vendor', value: g['vendor']),
          F('d', 'Date (YYYY-MM-DD)', value: dayKey(DateTime.now())),
        ],
        (v) async {
          if (v['qty'] == null || (v['qty'] as num) <= 0) return false;
          await recordDirectPurchase(h.s.repo!, material: '${g['name']}', qty: v['qty'] as num, unitPrice: (v['price'] ?? 0) as num, unit: '${g['unit'] ?? ''}', vendor: v['vendor'] as String?, date: '${v['d']}');
          await h.s.repo!.save('ing', {...g, 'qty': r2(((g['qty'] ?? 0) as num) + (v['qty'] as num)), if (v['price'] != null) 'cost': v['price']}, id: '${g['id']}');
          setState(() {});
          h.s.sync();
          return true;
        },
      );

  @override
  Widget build(BuildContext context) {
    final ings = h.s.repo!.of('ing').toList()..sort((a, b) => '${a['name']}'.compareTo('${b['name']}'));
    final value = ings.fold<double>(0, (a, g) => a + ((g['qty'] ?? 0) as num) * ((g['cost'] ?? 0) as num));
    final low = ings.where(isLowStock).length; // low-stock consistency fix: see _cfgRaw's own comment above
    return Column(children: [
      Padding(padding: const EdgeInsets.fromLTRB(16, 10, 16, 0), child: Seg<String>(expand: true, items: const [('stock', 'Stock'), ('reorder', 'Reorder'), ('expiry', 'Expiry'), ('waste', 'Wastage'), ('cost', 'Costing')], value: tab, onChanged: (v) => setState(() => tab = v))),
      Expanded(
        child: switch (tab) {
          'reorder' => _ReorderTab(h, onBuy: recordPurchase),
          'expiry' => _ExpiryTab(h),
          'waste' => WastageTab(h),
          'cost' => CostingTab(h),
          _ => ListView(padding: const EdgeInsets.only(bottom: 28), children: [
              const SizedBox(height: 8),
              Kpis('Stock value', inr(r2(value)), '${ings.length} raw materials', [('Low stock', '$low', low > 0 ? Tk.orange : null), ('Wastage this month', inr(r2(wastageCostThisMonth(h.s.repo!))), null)]),
              const SectionLabel('Stock'),
              Group(ings.isEmpty
                  ? [const Li('No raw materials yet', chevron: false)]
                  : [
                      for (final g in ings)
                        Li(
                          '${g['name']}',
                          sub: '₹${g['cost'] ?? 0} per ${g['unit'] ?? 'unit'}',
                          chevron: false,
                          value: '${g['qty'] ?? 0} ${g['unit'] ?? ''}',
                          trailing: OutlinedButton(onPressed: () => wasteForm(context, h, g), child: const Text('Waste')),
                        ),
                    ]),
            ]),
        },
      ),
    ]);
  }
}

class _ReorderTab extends StatefulWidget {
  const _ReorderTab(this.h, {required this.onBuy});
  final HomeState h;
  final Future<void> Function(Map<String, dynamic> g, num suggestedQty) onBuy;
  @override
  State<_ReorderTab> createState() => _ReorderTabState();
}

class _ReorderTabState extends State<_ReorderTab> {
  HomeState get h => widget.h;
  bool _busy = false;

  /// Automation 1 (this mission's business-automations batch): review-then-confirm flow for
  /// reorderPO()'s own automation, ported exactly -- see core/auto_reorder.dart's header for the
  /// full website trace. [_busy] is the same submission latch used by wasteForm()/receivePO()'s own
  /// native guard: it refuses a second tap while the first batch is still being written, so a fast
  /// double-tap on "Draft purchase orders" can never create the same vendor's drafts twice in the
  /// same gesture (pendingAutoReorder()'s own open-draft check additionally prevents a duplicate
  /// across two SEPARATE visits to this screen, e.g. after returning from Purchase Orders).
  Future<void> _autoReorder() async {
    if (_busy) return;
    final pending = pendingAutoReorder(h.s.repo!);
    if (pending.isEmpty) {
      h.toast(planAutoReorder(h.s.repo!).isEmpty ? 'Nothing is below its reorder level' : 'Every low vendor already has an open draft order');
      return;
    }
    final itemCount = pending.fold<int>(0, (a, g) => a + g.items.length);
    final sure = await askYes(
      context,
      'Create ${pending.length} draft purchase order${pending.length == 1 ? '' : 's'}?',
      'For $itemCount low item${itemCount == 1 ? '' : 's'}. Quantity brings each back to twice its reorder level. '
          'This only creates draft orders -- nothing is sent, nothing is paid, and stock is not added until you receive each order.',
    );
    if (!sure || !mounted) return;
    setState(() => _busy = true);
    try {
      await createAutoReorderDrafts(h.s.repo!, pending);
      h.s.sync();
      if (mounted) {
        setState(() {});
        h.toast('${pending.length} draft purchase order${pending.length == 1 ? '' : 's'} created');
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final rows = reorderRows(h.s.repo!)..sort((a, b) => (a.daysLeft ?? 999).compareTo(b.daysLeft ?? 999));
    final canOrders = h.s.role == 'owner' || h.s.role == 'manager';
    final pendingCount = canOrders ? pendingAutoReorder(h.s.repo!).length : 0;
    return ListView(padding: const EdgeInsets.only(bottom: 28), children: [
      PageHead(
        'Reorder',
        sub: 'Materials that are already low, or will run out within a week.',
        trailing: canOrders
            ? FilledButton.tonal(
                onPressed: _busy ? null : _autoReorder,
                child: Text(_busy ? 'Creating…' : pendingCount > 0 ? 'Draft purchase orders ($pendingCount)' : 'Draft purchase orders'),
              )
            : null,
      ),
      if (rows.isEmpty)
        const Empty(Icons.check_circle_outline, 'Nothing needs reordering', 'Every material has enough stock for now.')
      else
        Group([
          for (final r in rows)
            Li(
              '${r.ing['name']}',
              sub: '${isLowStock(r.ing) ? 'Low stock' : '${r.daysLeft} day${r.daysLeft == 1 ? '' : 's'} left'} · on hand ${r2(r.ing['qty'] ?? 0)} ${r.ing['unit'] ?? ''} · daily use ${r.dailyUse > 0 ? '${r.dailyUse} ${r.ing['unit'] ?? ''}' : '—'}',
              icon: Icons.shopping_cart_outlined,
              tone: isLowStock(r.ing) ? Tk.red : Tk.orange,
              trailing: OutlinedButton(onPressed: () => widget.onBuy(r.ing, r.suggestedQty), child: Text('Buy ${r2(r.suggestedQty)} ${r.ing['unit'] ?? ''}')),
              chevron: false,
            ),
        ]),
    ]);
  }
}

class _ExpiryTab extends StatelessWidget {
  const _ExpiryTab(this.h);
  final HomeState h;
  @override
  Widget build(BuildContext context) {
    final rows = expiryRows(h.s.repo!);
    return ListView(padding: const EdgeInsets.only(bottom: 28), children: [
      const PageHead('Expiry', sub: 'Materials with an expiry date, soonest first.'),
      if (rows.isEmpty)
        const Empty(Icons.event_outlined, 'No expiry dates set', 'Add an expiry date to a raw material to track it here.')
      else
        Group([
          for (final g in rows)
            Li(
              '${g['name']}',
              sub: 'Expires ${g['expiry']} · on hand ${r2(g['qty'] ?? 0)} ${g['unit'] ?? ''} · value at risk ${inr(stockValue(g))}',
              icon: Icons.event_outlined,
              tone: isExpired(g) ? Tk.red : isExpiringSoon(g) ? Tk.orange : Tk.green,
              value: isExpired(g) ? 'Expired' : isExpiringSoon(g) ? 'Within 7 days' : 'OK',
              chevron: false,
            ),
        ]),
    ]);
  }
}

class _RepCustomers extends StatefulWidget {
  const _RepCustomers(this.h);
  final HomeState h;
  @override
  State<_RepCustomers> createState() => _RepCustomersState();
}

/// Gold (>=10000) / Silver (>=3000) / Bronze -- matches the website's own tierOf() in p-reports.js.
String _custTier(num spend) => spend >= 10000 ? 'Gold' : spend >= 3000 ? 'Silver' : 'Bronze';
Color _custTierColor(String tier) => tier == 'Gold' ? Tk.orange : (tier == 'Silver' ? Tk.label2 : Tk.label3);

Future<void> _waWinBack(String phone, String name, String business) {
  var p = phone.replaceAll(RegExp(r'[^0-9]'), '');
  if (p.length == 10) p = '91$p';
  final msg = 'Hi ${name.isEmpty ? 'there' : name}, we miss you at $business! Come back this week and enjoy something special.';
  return launchUrl(Uri.parse('https://wa.me/$p?text=${Uri.encodeComponent(msg)}'), mode: LaunchMode.externalApplication);
}

class _RepCustomersState extends _RepState<_RepCustomers> {
  @override
  Widget build(BuildContext context) {
    // netOf() (net of refunds), matching the website's own customerStats() -- a partially refunded
    // bill must not inflate a customer's spend/tier.
    final spend = <String, double>{}, visits = <String, int>{}, phones = <String, String>{};
    DateTime? newestVisit;
    final lastVisit = <String, DateTime>{};
    for (final o in paidIn(widget.h.s.repo!, days, includeDue: true)) {
      final c = o['cust'] as Map?;
      final name = c == null ? '' : '${c['name'] ?? ''}';
      final phone = c == null ? '' : '${c['phone'] ?? ''}'.replaceAll(RegExp(r'\D'), '');
      final k = name.isNotEmpty ? name : phone;
      if (k.isEmpty) continue;
      spend[k] = (spend[k] ?? 0) + netOf(o);
      visits[k] = (visits[k] ?? 0) + 1;
      if (phone.isNotEmpty) phones[k] = phone;
      final t = DateTime.tryParse('${o['paidAt'] ?? o['created']}');
      if (t != null && (lastVisit[k] == null || t.isAfter(lastVisit[k]!))) lastVisit[k] = t;
      if (t != null && (newestVisit == null || t.isAfter(newestVisit))) newestVisit = t;
    }
    final rows = spend.entries.toList()..sort((a, b) => b.value.compareTo(a.value));
    final now = newestVisit ?? DateTime.now();
    final lapsed = rows.where((e) => lastVisit[e.key] != null && now.difference(lastVisit[e.key]!).inDays >= 30 && phones[e.key] != null).toList()..sort((a, b) => b.value.compareTo(a.value));
    final business = '${widget.h.s.cfg['name'] ?? 'us'}';
    return ListView(padding: const EdgeInsets.only(bottom: 28), children: [
      RangeBar(days, (v) => setState(() => days = v)),
      Kpis('Customers', '${rows.length}', 'Named guests who paid', [('Customers on file', '${widget.h.s.repo!.of('customer').length}', null), ('Repeat guests', '${visits.values.where((v) => v > 1).length}', Tk.green), ('Lapsed (30+ days)', '${lapsed.length}', lapsed.isNotEmpty ? Tk.orange : null)]),
      const SectionLabel('Top customers'),
      Group(rows.isEmpty
          ? [const Li('Add a customer name on a bill to see them here', chevron: false)]
          : [
              for (final e in rows.take(20))
                Li(e.key, sub: '${visits[e.key]} visit${visits[e.key] == 1 ? '' : 's'} · ${_custTier(e.value)}', icon: Icons.person_outline, chevron: false, titleColor: null, value: inr(r2(e.value)), trailing: Padding(padding: const EdgeInsets.only(left: 6), child: Icon(Icons.circle, size: 10, color: _custTierColor(_custTier(e.value))))),
            ]),
      const SectionLabel('Win-back list (not seen for 30+ days)'),
      Group(lapsed.isEmpty
          ? [const Li('No lapsed customers', chevron: false)]
          : [
              for (final e in lapsed.take(10))
                Li(e.key, sub: inr(r2(e.value)), icon: Icons.history, chevron: false, trailing: TextButton(onPressed: () => _waWinBack(phones[e.key]!, e.key, business), child: const Text('WhatsApp'))),
            ]),
    ]);
  }
}

class _RepStaff extends StatefulWidget {
  const _RepStaff(this.h);
  final HomeState h;
  @override
  State<_RepStaff> createState() => _RepStaffState();
}

class _RepStaffState extends _RepState<_RepStaff> {
  late final Future<List<Map<String, dynamic>>> people = widget.h.s.api.select('profiles', select: 'id,name,username,role');
  @override
  Widget build(BuildContext context) {
    final from = dayKey(DateTime.now().subtract(Duration(days: days - 1)));
    final sales = <String, double>{}, bills = <String, int>{};
    for (final o in paidIn(widget.h.s.repo!, days)) {
      final k = '${o['paidBy'] ?? o['by'] ?? ''}';
      sales[k] = (sales[k] ?? 0) + netOf(o);
      bills[k] = (bills[k] ?? 0) + 1;
    }
    // Hours worked per staffer (website's own sh/hrs calc: shift.in to shift.out, or now() if still
    // clocked in, in hours), and voids/discounts per staffer across orders CREATED in range (website's
    // own voids/discs calc keys off `o.by`, not `o.paidBy`, matching that exactly).
    final hours = <String, double>{};
    for (final sh in widget.h.s.repo!.of('shift')) {
      final inAt = DateTime.tryParse('${sh['in']}');
      if (inAt == null || dayKey(inAt).compareTo(from) < 0) continue;
      final outAt = sh['out'] != null ? DateTime.tryParse('${sh['out']}') : DateTime.now();
      if (outAt == null) continue;
      final u = '${sh['u'] ?? ''}';
      hours[u] = (hours[u] ?? 0) + outAt.difference(inAt).inMinutes / 60.0;
    }
    final voids = <String, int>{}, discs = <String, double>{};
    for (final o in widget.h.s.repo!.of('order').where((o) => dayKey(DateTime.tryParse('${o['created']}') ?? DateTime(2000)).compareTo(from) >= 0)) {
      final by = '${o['by'] ?? ''}';
      if (o['status'] == 'void') voids[by] = (voids[by] ?? 0) + 1;
      final d = ((o['t'] as Map?)?['d'] ?? 0) as num;
      discs[by] = (discs[by] ?? 0) + d;
    }
    final ids = {...sales.keys, ...hours.keys}.toList();
    return FutureBuilder(
      future: people,
      builder: (_, snap) {
        final names = {for (final p in snap.data ?? const <Map<String, dynamic>>[]) '${p['id']}': '${p['name'] ?? p['username'] ?? 'Team member'}'};
        final rows = ids.toList()..sort((a, b) => (sales[b] ?? 0).compareTo(sales[a] ?? 0));
        return ListView(padding: const EdgeInsets.only(bottom: 28), children: [
          RangeBar(days, (v) => setState(() => days = v)),
          Kpis('Staff sales', inr(r2(sales.values.fold<double>(0, (a, b) => a + b))), '${rows.where((k) => (bills[k] ?? 0) > 0).length} people billed', [
            ('Hours worked', '${r2(hours.values.fold<double>(0, (a, b) => a + b))} h', null),
            ('Voids', '${voids.values.fold<int>(0, (a, b) => a + b)}', Tk.red),
            ('Discounts given', inr(r2(discs.values.fold<double>(0, (a, b) => a + b))), Tk.orange),
          ]),
          const SectionLabel('By team member'),
          Group(rows.isEmpty
              ? [const Li('No staff activity in this range', chevron: false)]
              : [
                  for (final k in rows)
                    Li(
                      names[k] ?? 'Unknown',
                      sub: '${bills[k] ?? 0} bills · ${r2(hours[k] ?? 0)} h · ${voids[k] ?? 0} void${(voids[k] ?? 0) == 1 ? '' : 's'} · ${inr(r2(discs[k] ?? 0))} discount',
                      icon: Icons.person_outline,
                      chevron: false,
                      value: inr(r2(sales[k] ?? 0)),
                    ),
                ]),
        ]);
      },
    );
  }
}

class _RepAnalytics extends StatefulWidget {
  const _RepAnalytics(this.h);
  final HomeState h;
  @override
  State<_RepAnalytics> createState() => _RepAnalyticsState();
}

class _RepAnalyticsState extends _RepState<_RepAnalytics> {
  @override
  Widget build(BuildContext context) {
    final rows = paidIn(widget.h.s.repo!, days > 7 ? days : 30);
    final hours = List<double>.filled(24, 0);
    final wd = List<double>.filled(7, 0);
    final itemRev = <String, double>{};
    final modes = <String, num>{};
    for (final o in rows) {
      final t = DateTime.tryParse('${o['paidAt']}')?.toLocal();
      if (t == null) continue;
      hours[t.hour] += netOf(o);
      wd[t.weekday - 1] += netOf(o);
      for (final e in payModesOf(o).entries) {
        modes[e.key] = (modes[e.key] ?? 0) + e.value;
      }
      for (final l in ((o['lines'] as List?) ?? const []).cast<Map>()) {
        final name = '${l['name'] ?? ''}';
        itemRev[name] = (itemRev[name] ?? 0) + ((l['price'] ?? 0) as num) * ((l['qty'] ?? 0) as num);
      }
    }
    final cur = rows.fold<num>(0, (a, o) => a + netOf(o));
    // Previous period, same length, immediately before the current range -- matches the website's
    // own `addDays(f,-days.length)` to `f` (exclusive) comparison.
    final curFrom = dayKey(DateTime.now().subtract(Duration(days: days - 1)));
    final prevFrom = dayKey(DateTime.now().subtract(Duration(days: days * 2 - 1)));
    num prev = 0;
    for (final o in widget.h.s.repo!.of('order').where((o) => o['status'] == 'paid')) {
      final d = dayOfIso(o['paidAt']);
      if (d.isNotEmpty && d.compareTo(prevFrom) >= 0 && d.compareTo(curFrom) < 0) prev += netOf(o);
    }
    final deltaPct = prev > 0 ? ((cur - prev) / prev * 100).round() : null;
    final cs = customerStats(widget.h.s.repo!);
    final active = cs.values.where((c) => c.last != null && c.last!.compareTo(curFrom) >= 0).toList();
    final repeatPct = active.isEmpty ? 0 : (active.where((c) => c.visits > 1).length / active.length * 100).round();
    final topItems = (itemRev.entries.toList()..sort((a, b) => b.value.compareTo(a.value))).take(8).toList();
    final mxh = hours.fold<double>(1, (a, b) => b > a ? b : a), mxd = wd.fold<double>(1, (a, b) => b > a ? b : a);
    const names = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    Widget bar(String l, double v, double mx) => Padding(padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 9), child: Row(children: [SizedBox(width: 54, child: Text(l, style: TextStyle(fontSize: 16, color: Tk.label2))), Expanded(child: ClipRRect(borderRadius: BorderRadius.circular(8), child: LinearProgressIndicator(value: v / mx, minHeight: 14, color: Tk.accent, backgroundColor: Tk.fill2))), const SizedBox(width: 10), SizedBox(width: 70, child: Text(inr(r2(v)), textAlign: TextAlign.right, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700)))]));
    return ListView(padding: const EdgeInsets.only(bottom: 28), children: [
      RangeBar(days, (v) => setState(() => days = v)),
      Kpis('Net sales', inr(r2(cur)), deltaPct == null ? 'No previous period to compare' : '${deltaPct < 0 ? '↓' : '↑'} ${deltaPct.abs()}% vs. previous period', [
        ('Avg. daily sales', inr(r2(cur / days)), null),
        ('Avg. bill', inr(rows.isEmpty ? 0 : r2(cur / rows.length)), null),
        ('Repeat customers', '$repeatPct%', Tk.green),
      ]),
      const SectionLabel('Sales by hour'),
      Group([for (var i = 6; i < 24; i++) if (hours[i] > 0) bar('${i.toString().padLeft(2, '0')}:00', hours[i], mxh)]),
      const SectionLabel('Sales by weekday'),
      Group([for (var i = 0; i < 7; i++) bar(names[i], wd[i], mxd)]),
      const SectionLabel('Payment mix'),
      Group(modes.isEmpty ? [const Li('No sales', chevron: false)] : [for (final e in (modes.entries.toList()..sort((a, b) => b.value.compareTo(a.value)))) Li(e.key, chevron: false, value: inr(r2(e.value)))]),
      const SectionLabel('Top items'),
      Group(topItems.isEmpty ? [const Li('No sales', chevron: false)] : [for (final e in topItems) Li(e.key, chevron: false, value: inr(r2(e.value)))]),
    ]);
  }
}

class _RepGst extends StatefulWidget {
  const _RepGst(this.h);
  final HomeState h;
  @override
  State<_RepGst> createState() => _RepGstState();
}

class _RepGstState extends _RepState<_RepGst> {
  @override
  Widget build(BuildContext context) {
    final byRate = <String, (double, double)>{};
    var tax = 0.0, base = 0.0;
    for (final o in paidIn(widget.h.s.repo!, days, includeDue: true)) {
      final t = (o['t'] as Map?) ?? {};
      tax += ((t['tax'] ?? 0) as num).toDouble();
      base += ((t['net'] ?? t['sub'] ?? 0) as num).toDouble();
      final rates = (t['rates'] as Map?) ?? {};
      for (final e in rates.entries) {
        final v = e.value as Map;
        final c = byRate[e.key] ?? (0.0, 0.0);
        byRate[e.key] = (c.$1 + ((v['base'] ?? 0) as num), c.$2 + ((v['tax'] ?? 0) as num));
      }
    }
    return ListView(padding: const EdgeInsets.only(bottom: 28), children: [
      RangeBar(days, (v) => setState(() => days = v)),
      Kpis('GST collected', inr(r2(tax)), 'On ${inr(r2(base))} of sales', const []),
      const SectionLabel('By rate'),
      Group(byRate.isEmpty ? [const Li('No tax in this range', chevron: false)] : [for (final e in byRate.entries) Li('${e.key}%', sub: 'Taxable ${inr(r2(e.value.$1))}', chevron: false, value: inr(r2(e.value.$2)))]),
    ]);
  }
}

// ------------------------------------------------------------------ team

class _Attendance extends StatelessWidget {
  const _Attendance(this.h);
  final HomeState h;
  @override
  Widget build(BuildContext context) {
    final shifts = h.s.repo!.of('shift').toList()..sort((a, b) => '${b['in']}'.compareTo('${a['in']}'));
    String hm(dynamic iso) {
      final t = DateTime.tryParse('$iso')?.toLocal();
      return t == null ? '' : '${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}';
    }

    return ListView(padding: const EdgeInsets.only(bottom: 28), children: [
      const PageHead('Attendance', sub: 'Clock-ins from your team'),
      const SizedBox(height: 12),
      if (shifts.isEmpty) const Empty(Icons.access_time, 'No shifts yet', 'Staff clock in from More > Attendance.') else Group([
        for (final s in shifts.take(100))
          Li('${s['e'] ?? 'Staff'}', sub: '${dayOfIso(s['in'])} · ${hm(s['in'])} – ${s['out'] == null ? 'on shift' : hm(s['out'])}', icon: Icons.access_time, tone: s['out'] == null ? Tk.green : null, chevron: false),
      ]),
    ]);
  }
}
