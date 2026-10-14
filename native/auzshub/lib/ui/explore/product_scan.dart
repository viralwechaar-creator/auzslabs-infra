import 'package:flutter/material.dart' hide Text;
import '../../core/session.dart';
import '../ds.dart';
import '../mk.dart';
import 'product_accounting.dart';
import 'product_common.dart';
import 'product_inventory.dart';
import 'product_pos.dart';

/// "AUZsScan" (native equivalent of site/scan-and-bill.html): point your phone at a barcode to
/// bill it with GST, take payment and send the invoice on WhatsApp, or scan stock in the same way.
class ProductScanPage extends StatelessWidget {
  const ProductScanPage(this.s, {super.key});
  final HubSession s;

  @override
  Widget build(BuildContext context) => SubPage('AUZsScan', [
        productHero('AUZSSCAN · SCAN AND BILL', 'Point. Scan. Bill it.', 'Scan a barcode with your phone and the item is on the bill, with its price and GST. Take payment, post a real invoice, and send it on WhatsApp. Scan stock in the same way when new goods arrive.'),
        const SectionLabel("What's included"),
        productCard([
          includedRow('Your phone is the scanner', 'Open the camera, point at the barcode, done. Works on Android and iPhone, or with a Bluetooth/USB scanner.'),
          includedRow('A real GST invoice', 'Each scan fills in the price, HSN and GST from your product. Charging posts a numbered invoice and takes stock down.'),
          includedRow('A new barcode? Add it once', 'It asks for the name, price, GST, unit, HSN and stock one time. Next time the scan fills everything in.'),
          includedRow('Scan stock in', 'Switch to Add stock, scan what arrived, set the quantity and cost, and post it as one stock entry.'),
          includedRow('Cash, UPI, bank or credit', 'Cash shows the change to give back. A sale on credit needs a named customer.'),
          includedRow('Send it on WhatsApp', 'One tap opens WhatsApp with the invoice link ready to send. Or print it, or save it as a PDF.'),
          includedRow('Never oversell', 'If a product is not in stock, the scan says so. Stock can only be sold once.'),
          includedRow('Install it like an app', 'Add AUZsScan to your home screen. A dropped connection saves a sale as a draft and sends it on later.'),
        ]),
        const SectionLabel('Get AUZsScan'),
        LivePriceCard(s, 'scan'),
        const SectionLabel('Pairs well with'),
        pairsWith([
          ('AUZsLedger', () => ProductAccountingPage(s)),
          ('Inventory', () => ProductInventoryPage(s)),
          ('POS', () => ProductPosPage(s)),
        ]),
        const SizedBox(height: 16),
      ]);
}
