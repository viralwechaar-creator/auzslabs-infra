import 'dart:convert';
import 'package:flutter/services.dart' show rootBundle;

/// The website's pages as data (assets/site/pages.json, made from site/*.html by tool/make_site_data.py).
class SiteData {
  SiteData._(this.pages);
  final Map<String, dynamic> pages;
  static SiteData? _i;
  static SiteData? peek() => _i;
  static Future<SiteData> load() async {
    if (_i != null) return _i!;
    final raw = await rootBundle.loadString('assets/site/pages.json');
    return _i = SiteData._(jsonDecode(raw) as Map<String, dynamic>);
  }

  /// For tests: use a page set that is already in memory.
  static void use(Map<String, dynamic> p) => _i = SiteData._(p);

  Map<String, dynamic>? page(String name) => pages[name] as Map<String, dynamic>?;
  bool has(String name) => pages.containsKey(name);
}

/// One link of the menu (same groups as the website's menu).
class MenuLink {
  const MenuLink(this.label, this.page, {this.anchor, this.sub = ''});
  final String label;
  final String page;
  final String? anchor;
  final String sub;
}

class MenuGroup {
  const MenuGroup(this.title, this.links);
  final String title;
  final List<MenuLink> links;
}

const siteMenu = <MenuGroup>[
  MenuGroup('Products', [
    MenuLink('AUZsPOS', 'pos', sub: 'Billing, tables and kitchen'),
    MenuLink('AUZsPOS QR', 'qr-ordering', sub: 'Guests order from their phone'),
    MenuLink('AUZsPay', 'payroll', sub: 'Attendance, salary and leave'),
    MenuLink('AUZsLedger', 'accounting', sub: 'Invoices, GST and books'),
    MenuLink('AUZsScan', 'scan-and-bill', sub: 'Scan, bill and add stock'),
    MenuLink('AUZsMob', 'products', anchor: 'slab-mobile', sub: 'Phone shop stock, sales and repairs'),
    MenuLink('AUZslab Salon', 'products', anchor: 'slab-salon', sub: 'Bookings, billing and clients'),
    MenuLink('Studio: bespoke software', 'studio', sub: 'Made around your business'),
    MenuLink('Custom build', 'ip-custom-development', sub: 'Tell us what you need'),
    MenuLink('Billing and invoicing', 'billing', sub: 'Included with AUZsPOS'),
    MenuLink('Customers (CRM)', 'crm', sub: 'Included with AUZsPOS'),
    MenuLink('Inventory', 'inventory', sub: 'Included with AUZsPOS'),
  ]),
  MenuGroup('Business types', [
    MenuLink('Cafes and restaurants', 'business-cafes'),
    MenuLink('Salons', 'business-salons'),
    MenuLink('Retail and bookstores', 'business-retail'),
    MenuLink('Clothing and apparel', 'business-clothing'),
    MenuLink('Mobile retail and repair', 'business-mobile-repair'),
  ]),
  MenuGroup('Discover', [
    MenuLink('Intelligence', 'intelligence', sub: 'See what your numbers mean'),
    MenuLink('Why AUZslab', 'platform'),
    MenuLink('Live demo', 'live-demo', sub: 'Try it yourself'),
    MenuLink('Pricing', 'pricing'),
  ]),
  MenuGroup('Resources', [
    MenuLink('Getting started', 'resources-getting-started'),
    MenuLink('Learn: beginner manual', 'learn'),
    MenuLink('Operations and workflows', 'resources-operations'),
    MenuLink('Growth and scaling', 'resources-growth'),
    MenuLink('Creatopz, marketing partner', 'creatopz'),
  ]),
  MenuGroup('Company', [
    MenuLink('Contact', 'contact'),
    MenuLink('Join our team', 'join-team'),
    MenuLink('Security', 'security'),
    MenuLink('Sitemap', 'sitemap'),
  ]),
  MenuGroup('Legal', [
    MenuLink('Terms', 'terms'),
    MenuLink('Privacy policy', 'privacy'),
    MenuLink('Refund policy', 'refund'),
    MenuLink('Cookie policy', 'cookies'),
    MenuLink('Acceptable use', 'acceptable-use'),
    MenuLink('Hardware terms', 'hardware-terms'),
    MenuLink('Delete my account', 'delete-account'),
  ]),
];

/// One entry of the website's drawer menu: a plain link, or a group with sub-links (the "(+8)" ones).
class NavEntry {
  const NavEntry(this.label, {this.page, this.anchor, this.kids = const [], this.cart = false});
  final String label;
  final String? page, anchor;
  final List<NavEntry> kids;
  final bool cart;
}

/// The same order and wording as the website's drawer (the Primary nav on every marketing page).
const siteNav = <NavEntry>[
  NavEntry('Home', page: 'index'),
  NavEntry('Products', kids: [
    NavEntry('AUZsPOS', page: 'pos'),
    NavEntry('AUZsPOS QR', page: 'qr-ordering'),
    NavEntry('AUZsPay', page: 'payroll'),
    NavEntry('AUZsLedger', page: 'accounting'),
    NavEntry('AUZsScan', page: 'scan-and-bill'),
    NavEntry('AUZsMob', page: 'products', anchor: 'slab-mobile'),
    NavEntry('AUZslab Salon', page: 'products', anchor: 'slab-salon'),
    NavEntry('Studio: bespoke software', page: 'studio'),
  ]),
  NavEntry('Business types', kids: [
    NavEntry('Cafes and restaurants', page: 'business-cafes'),
    NavEntry('Salons', page: 'business-salons'),
    NavEntry('Retail and bookstores', page: 'business-retail'),
    NavEntry('Clothing and apparel', page: 'business-clothing'),
    NavEntry('Mobile retail and repair', page: 'business-mobile-repair'),
  ]),
  NavEntry('Intelligence', page: 'intelligence'),
  NavEntry('Why AUZslab', page: 'platform'),
  NavEntry('Live demo', page: 'live-demo'),
  NavEntry('Pricing', page: 'pricing'),
  NavEntry('Cart', cart: true),
  NavEntry('Resources', kids: [
    NavEntry('Getting started', page: 'resources-getting-started'),
    NavEntry('Learn: beginner manual', page: 'learn'),
    NavEntry('Operations and workflows', page: 'resources-operations'),
    NavEntry('Growth and scaling', page: 'resources-growth'),
    NavEntry('Creatopz, marketing partner', page: 'creatopz'),
  ]),
  NavEntry('Contact', page: 'contact'),
];

/// Short names of the products (cart keys), for the plan cards.
const planIcons = <String, String>{
  'pos': 'assets/site/p_pos.png',
  'self_order': 'assets/site/p_self_order.png',
  'payroll': 'assets/site/p_payroll.png',
  'accounting': 'assets/site/p_accounting.png',
  'mobile': 'assets/site/p_mobile.png',
  'scan': 'assets/site/p_scan.png',
};

/// What a link on the website means in the app.
class SiteLink {
  const SiteLink(this.kind, [this.page = '', this.anchor, this.url = '']);
  /// page, anchor (same page), cart, account, external, web, none
  final String kind;
  final String page;
  final String? anchor;
  final String url;
}

SiteLink resolveHref(String? href, {Set<String> known = const {}}) {
  final h = (href ?? '').trim();
  if (h.isEmpty || h == '#') return const SiteLink('none');
  if (h.startsWith('#')) return SiteLink('anchor', '', h.substring(1));
  if (h.startsWith('tel:') || h.startsWith('mailto:') || h.startsWith('sms:')) return SiteLink('external', '', null, h);
  var path = h;
  if (h.startsWith('http')) {
    final u = Uri.tryParse(h);
    if (u == null) return const SiteLink('none');
    if (u.host != 'auzslab.in' && u.host != 'www.auzslab.in') return SiteLink('external', '', null, h);
    path = u.path.replaceFirst('/', '') + (u.hasFragment ? '#${u.fragment}' : '');
  }
  path = path.replaceFirst(RegExp(r'^/'), '');
  String? anchor;
  final hash = path.indexOf('#');
  if (hash >= 0) {
    anchor = path.substring(hash + 1);
    path = path.substring(0, hash);
  }
  final q = path.indexOf('?');
  if (q >= 0) path = path.substring(0, q);
  if (path.isEmpty || path == 'index.html') return SiteLink('page', 'index', anchor);
  if (path == 'cart.html' || path == 'checkout.html') return const SiteLink('cart');
  if (path == 'signup.html' || path == 'signin.html' || path == 'account.html') return const SiteLink('account');
  if (path == 'demo.html') return SiteLink('page', 'live-demo', anchor);
  final name = path.replaceAll(RegExp(r'\.html$'), '');
  if (known.contains(name)) return SiteLink('page', name, anchor);
  return SiteLink('web', '', null, 'https://auzslab.in/$path${anchor == null ? '' : '#$anchor'}');
}

/// Live prices from the database (same functions the website's pricing page reads).
class PricingData {
  PricingData(this.prices, this.bundles, this.addons);
  final Map<String, Map<String, dynamic>> prices;
  final List<Map<String, dynamic>> bundles;
  final List<Map<String, dynamic>> addons;

  static PricingData from(dynamic p, dynamic b, dynamic a) {
    List<Map<String, dynamic>> list(dynamic x) => x is List ? [for (final e in x) if (e is Map) Map<String, dynamic>.from(e)] : <Map<String, dynamic>>[];
    return PricingData({for (final e in list(p)) '${e['key']}': e}, list(b), list(a));
  }

  double _n(dynamic v) => v is num ? v.toDouble() : (double.tryParse('$v') ?? 0);

  /// Monthly price for a set of product keys: a matching bundle first, else the flat sum, else null (not priced).
  double? monthly(List<String> keys) {
    final k = [...keys]..sort();
    for (final b in bundles) {
      final bk = [for (final x in (b['feature_keys'] as List? ?? const [])) '$x']..sort();
      if (bk.join(',') == k.join(',')) return _n(b['monthly_price']);
    }
    var t = 0.0;
    for (final x in k) {
      final p = prices[x];
      if (p == null || _n(p['monthly_price']) <= 0) return null;
      t += _n(p['monthly_price']);
    }
    return k.isEmpty ? null : t;
  }

  double monthlyOf(String key) => _n(prices[key]?['monthly_price']);
  double yearlyOf(String key) => _n(prices[key]?['yearly_price']);
  double renewalYearlyOf(String key) => _n(prices[key]?['renewal_yearly_price']);
  bool gstExempt(String key) => prices[key]?['gst_exempt'] == true;
  bool setupExempt(String key) => prices[key]?['setup_fee_exempt'] == true;
  double get addonPrice => addons.isEmpty ? 0 : _n(addons.first['monthly_price']);
  double n(dynamic v) => _n(v);
}

String inr(num v) {
  final neg = v < 0;
  final whole = v.abs().round() == v.abs() ? v.abs().round().toString() : v.abs().toStringAsFixed(2);
  final parts = whole.split('.');
  var s = parts[0];
  if (s.length > 3) {
    final last = s.substring(s.length - 3);
    var rest = s.substring(0, s.length - 3);
    final groups = <String>[];
    while (rest.length > 2) {
      groups.insert(0, rest.substring(rest.length - 2));
      rest = rest.substring(0, rest.length - 2);
    }
    if (rest.isNotEmpty) groups.insert(0, rest);
    s = '${groups.join(',')},$last';
  }
  return '${neg ? '-' : ''}₹$s${parts.length > 1 ? '.${parts[1]}' : ''}';
}
