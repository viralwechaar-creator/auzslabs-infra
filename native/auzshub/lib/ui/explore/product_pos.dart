import 'package:flutter/material.dart' hide Text;
import '../../core/session.dart';
import '../ds.dart';
import '../mk.dart';
import 'product_billing.dart';
import 'product_common.dart';
import 'product_crm.dart';
import 'product_inventory.dart';
import 'product_qr_ordering.dart';

/// "AUZsPOS" (native equivalent of site/pos.html): billing, tables, kitchen tickets and stock,
/// kept selling when the internet drops, with every sale flowing into accounts and Intelligence.
class ProductPosPage extends StatelessWidget {
  const ProductPosPage(this.s, {super.key});
  final HubSession s;

  @override
  Widget build(BuildContext context) => SubPage('AUZsPOS', [
        productHero('AUZSPOS · POINT OF SALE', 'Built around the way you sell.', "Bill, send to the kitchen, track stock and customers, and keep selling when the internet drops. Every sale flows into your accounts and Intelligence."),
        const SectionLabel("What's included"),
        productCard([
          includedRow('Billing & checkout', 'Fast line-item entry, discounts, split payments and instant receipts.'),
          includedRow('Table management', "See every table's status at a glance -- open, occupied, billed -- and move orders between them."),
          includedRow('Kitchen order tickets', "Every order prints or displays in the kitchen the instant it's placed -- no shouting across the counter."),
          includedRow('Staff & shifts', 'Role-based logins for owners, managers and cashiers, with a shift log for every till session.'),
          includedRow('Size & color billing', 'Running a clothing or retail shop instead? The same till bills against size/color stock, with barcode scanning and returns built in.'),
          includedRow('Barcode scanning', 'Off by default -- turn it on if you have a scanner, and scanning an item adds it to the bill instantly.', optional: true),
        ]),
        const SectionLabel('Get AUZsPOS'),
        LivePriceCard(s, 'pos'),
        const SectionLabel('Pairs well with'),
        pairsWith([
          ('CRM', () => ProductCrmPage(s)),
          ('Billing & Invoicing', () => ProductBillingPage(s)),
          ('Inventory', () => ProductInventoryPage(s)),
          ('QR Ordering', () => ProductQrOrderingPage(s)),
        ]),
        const SizedBox(height: 16),
      ]);
}
