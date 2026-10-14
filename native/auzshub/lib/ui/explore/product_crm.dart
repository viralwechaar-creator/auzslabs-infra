import 'package:flutter/material.dart' hide Text;
import '../../core/session.dart';
import '../ds.dart';
import '../i18n.dart';
import '../mk.dart';
import '../theme.dart';
import 'product_billing.dart';
import 'product_common.dart';
import 'product_pos.dart';

/// "CRM" (native equivalent of site/crm.html): the same customer record, automatically built
/// from the bills already made, included with AUZsPOS and AUZslab Salon.
class ProductCrmPage extends StatelessWidget {
  const ProductCrmPage(this.s, {super.key});
  final HubSession s;

  @override
  Widget build(BuildContext context) => SubPage('CRM', [
        productHero('CUSTOMER RELATIONSHIP MANAGEMENT', 'Know your regulars. Bring them back.', 'Every visit, every rupee spent, every repeat customer -- tracked automatically from the same bills you already make.'),
        const SectionLabel('Any business'),
        productCard([
          Text('The same customer record works for every kind of shop. What you track is simply what matters in your business: a cafe keeps the favourite order, a salon keeps service history and preferred stylist, a bookstore keeps past purchases, a clothing shop keeps sizes and styles, a mobile shop keeps phones bought and repairs done.', style: TextStyle(color: Tk.label2, fontSize: 14.5, height: 1.4)),
        ]),
        const SectionLabel("What's included"),
        productCard([
          includedRow('Customer profiles', 'A running record for every customer -- contact details, order history, notes -- built up automatically as they visit.'),
          includedRow('Visit history', 'See exactly what someone bought last time, and when, right from the billing screen.'),
          includedRow('Repeat-visit tracking', "Spot your regulars automatically -- who's coming back, who's gone quiet."),
          includedRow('Spend insight', 'Total spend per customer, at a glance -- no spreadsheet exports needed.'),
          includedRow('Loyalty & coupons', 'Points redeemable at billing, and coupon codes with an expiry or use-limit whenever you want to run one.'),
          includedRow('Customer feedback', 'A star rating and comment box on every printed or shared receipt -- feedback comes back to you, not a review site.'),
        ]),
        const SectionLabel('Get CRM'),
        LivePriceCard(s, 'pos', includedWith: 'pos'),
        const SectionLabel('Pairs well with'),
        pairsWith([
          ('POS', () => ProductPosPage(s)),
          ('Billing & Invoicing', () => ProductBillingPage(s)),
        ]),
        const SizedBox(height: 16),
      ]);
}
