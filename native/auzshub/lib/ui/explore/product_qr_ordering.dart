import 'package:flutter/material.dart' hide Text;
import '../../core/session.dart';
import '../ds.dart';
import '../mk.dart';
import 'product_billing.dart';
import 'product_common.dart';
import 'product_pos.dart';

/// "QR Ordering" (native equivalent of site/qr-ordering.html): a QR code on every table, guests
/// browse and order from their own phone straight to the kitchen -- no app, no waiter to take it
/// down.
class ProductQrOrderingPage extends StatelessWidget {
  const ProductQrOrderingPage(this.s, {super.key});
  final HubSession s;

  @override
  Widget build(BuildContext context) => SubPage('QR Ordering', [
        productHero('SELF-ORDER', 'Scan the table. Skip the wait.', "A QR code on every table opens your live menu in the guest's own browser -- their order goes straight to the kitchen, no app, no waiter needed to take it down."),
        const SectionLabel('How an order actually happens'),
        productCard([
          includedRow('Table-side QR menus', "Each table gets its own code -- scan it, see your live menu, order in seconds."),
          includedRow('No app to download', "Opens straight in the phone's browser -- nothing to install, nothing to explain."),
          includedRow('Straight to the kitchen', 'Orders land on the kitchen ticket the moment they are placed.'),
          includedRow('Print-ready QR codes', "Generate and print every table's code straight from the till."),
        ]),
        const SectionLabel('Get QR Ordering'),
        LivePriceCard(s, 'self_order'),
        const SectionLabel('Pairs well with'),
        pairsWith([
          ('POS', () => ProductPosPage(s)),
          ('Billing & Invoicing', () => ProductBillingPage(s)),
        ]),
        const SizedBox(height: 16),
      ]);
}
