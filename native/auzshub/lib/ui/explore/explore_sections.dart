import 'package:flutter/material.dart' hide Text;
import '../../core/session.dart';
import '../pricing.dart';
import '../theme.dart';
import 'home_page.dart';
import 'products_page.dart';
import 'why_page.dart';

/// One row of the "Explore AUZslab" table of contents.
///
/// THIS LIST is the one file follow-up work needs to touch to add a new Explore page: append an
/// [ExploreSection] below, point [builder] at the real screen once it is built. Nothing in
/// `ExplorePage` or `home.dart` needs to change -- it already renders whatever is here.
///
/// An entry with no [builder] (its native screen isn't built yet) is a placeholder: `ExplorePage`
/// pushes `ComingSoonPage(sitePath)` for it instead, which opens that page on the website with the
/// session handed over (`#auz_gt`), same as every other still-browser tile in the hub.
class ExploreSection {
  const ExploreSection(this.id, this.title, this.sub, this.icon, this.tone, {this.builder, this.sitePath = ''});

  /// Stable id (not shown), the tile's title and subtitle, its icon and tint.
  final String id, title, sub;
  final IconData icon;
  final Color tone;

  /// The path on auzslab.in this section covers (what ComingSoonPage opens, and what a finished
  /// native screen is standing in for). '' is the site's homepage.
  final String sitePath;

  /// Builds the native screen for this section. Null until that screen exists.
  final Widget Function(HubSession s)? builder;
}

/// Native so far: the homepage, "Why AUZslab", Products & pricing (with live RPC-driven prices)
/// and "Every product in detail" (the 8 product pages, each with its own live price/Add to cart
/// where it has one). Everything else is a placeholder entry -- real, named, reachable -- until
/// its own native screen is built in a later pass.
List<ExploreSection> exploreSections(HubSession s) => [
      ExploreSection('home', 'AUZslab', 'Software built around the way you work', Icons.home_outlined, Tk.accent, builder: (hs) => HomePage(hs)),
      ExploreSection('why', 'Why AUZslab', 'Businesses differ. Software should too.', Icons.lightbulb_outline, Tk.orange, builder: (hs) => WhyAuzslabPage(hs)),
      ExploreSection('pricing', 'Products and pricing', 'See what each product does and costs, with live prices', Icons.sell_outlined, Tk.green, builder: (hs) => ProductsPricingPage(hs)),
      ExploreSection('products', 'Every product in detail', 'AUZsPOS, CRM, Billing, Inventory, QR Ordering, AUZsPay, AUZsLedger, AUZsScan, one page each', Icons.apps_outlined, Tk.purple, builder: (hs) => ProductsHubPage(hs), sitePath: 'products.html'),
      ExploreSection('business', 'Built for your business', 'Cafes, salons, retail, clothing and mobile repair shops, each shown its own way', Icons.store_outlined, Tk.teal, sitePath: 'business-cafes.html'),
      ExploreSection('studio', 'AUZslab Studio', 'Custom builds and bespoke development', Icons.design_services_outlined, Tk.blue, sitePath: 'studio.html'),
      ExploreSection('intelligence', 'AUZslab Intelligence', "Don't just see your business. Understand it.", Icons.insights_outlined, Tk.purple, sitePath: 'intelligence.html'),
      ExploreSection('learn', 'Learn & resources', 'Guides to get the most from AUZslab', Icons.menu_book_outlined, Tk.orange, sitePath: 'learn.html'),
      ExploreSection('legal', 'Legal', 'Terms, privacy, refund and other policies', Icons.gavel_outlined, Tk.label2, sitePath: 'terms.html'),
      ExploreSection('contact', 'Contact us', 'Get in touch with the team', Icons.mail_outline, Tk.blue, sitePath: 'contact.html'),
    ];
