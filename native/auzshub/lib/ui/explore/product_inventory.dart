import 'package:flutter/material.dart' hide Text;
import '../../core/session.dart';
import '../ds.dart';
import '../i18n.dart';
import '../mk.dart';
import '../theme.dart';
import 'product_billing.dart';
import 'product_common.dart';
import 'product_pos.dart';

/// "Inventory" (native equivalent of site/inventory.html): item and stock levels tracked as you
/// sell, with waste logging, purchase records and reorder forecasting, included with AUZsPOS.
class ProductInventoryPage extends StatelessWidget {
  const ProductInventoryPage(this.s, {super.key});
  final HubSession s;

  @override
  Widget build(BuildContext context) => SubPage('Inventory', [
        productHero('STOCK & INVENTORY', 'Know what is left before it runs out.', 'Item and stock levels tracked as you sell (ingredients, books, garments, products), with waste logging and purchase records kept alongside your daily billing.'),
        const SectionLabel("What's included"),
        productCard([
          includedRow('Stock tracking', 'Item levels update automatically as bills go through.'),
          includedRow('Waste logging', 'Record spoilage and write-offs separately from sales, so your numbers stay honest.'),
          includedRow('Purchase records', 'Log what came in, from whom, and at what cost.'),
          includedRow('Low-stock visibility', 'See what is running low without digging through a spreadsheet.'),
          includedRow('Reorder forecasting', 'A suggested reorder quantity built off real sale velocity from the last two weeks, not a fixed threshold.'),
          includedRow('Stock movement reports', 'Purchased, sold and wasted quantities over any date range, exportable to CSV.'),
        ]),
        const SectionLabel('Any business'),
        productCard([
          Text('Count what you sell, whatever it is: ingredients dropping as drinks and dishes go out for a cafe, titles and copies with reorder suggestions for a bookstore, sizes and colours as separate items for clothing, barcode billing that updates stock on every sale for retail, and phones tracked one by one in AUZsMob for a mobile shop.', style: TextStyle(color: Tk.label2, fontSize: 14.5, height: 1.4)),
        ]),
        const SectionLabel('Get Inventory'),
        LivePriceCard(s, 'pos', includedWith: 'pos'),
        const SectionLabel('Pairs well with'),
        pairsWith([
          ('POS', () => ProductPosPage(s)),
          ('Billing & Invoicing', () => ProductBillingPage(s)),
        ]),
        const SizedBox(height: 16),
      ]);
}
