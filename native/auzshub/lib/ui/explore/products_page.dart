import 'package:flutter/material.dart' hide Text;
import '../../core/launcher.dart';
import '../../core/session.dart';
import '../ds.dart';
import '../i18n.dart';
import '../mk.dart';
import '../theme.dart';
import 'product_accounting.dart';
import 'product_billing.dart';
import 'product_crm.dart';
import 'product_inventory.dart';
import 'product_payroll.dart';
import 'product_pos.dart';
import 'product_qr_ordering.dart';
import 'product_scan.dart';

/// "Every product in detail" (native equivalent of site/products.html): one row per product,
/// tapping opens that product's own native detail page. AUZslab Salon is listed on the site page
/// too, but it has no marketing page of its own (`business-salons.html` covers it as a business
/// type instead), so its row opens that on the website rather than inventing a page here.
class ProductsHubPage extends StatelessWidget {
  const ProductsHubPage(this.s, {super.key});
  final HubSession s;

  Widget _row(BuildContext context, String no, String name, String blurb, IconData icon, Color tone, Widget Function() page) => Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 5),
        child: Material(
          color: Tk.card,
          borderRadius: BorderRadius.circular(18),
          child: InkWell(
            borderRadius: BorderRadius.circular(18),
            onTap: () => Navigator.push(context, MaterialPageRoute<void>(builder: (_) => page())),
            child: Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(borderRadius: BorderRadius.circular(18), border: Border.all(color: Tk.line, width: .5)),
              child: Row(children: [
                Container(width: 46, height: 46, decoration: BoxDecoration(color: tone, borderRadius: BorderRadius.circular(13)), child: Icon(icon, color: Colors.white, size: 24)),
                const SizedBox(width: 14),
                Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Row(children: [
                    Text(name, style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800)),
                    const SizedBox(width: 8),
                    Text(no, style: TextStyle(color: Tk.label3, fontSize: 12, fontWeight: FontWeight.w700)),
                  ]),
                  Padding(padding: const EdgeInsets.only(top: 2), child: Text(blurb, style: TextStyle(color: Tk.label2, fontSize: 14, height: 1.3))),
                ])),
                Icon(Icons.chevron_right, color: Tk.label3, size: 26),
              ]),
            ),
          ),
        ),
      );

  @override
  Widget build(BuildContext context) => SubPage('Every product in detail', [
        const Hint('Connected systems for every part of your business. Start with what you need, add more as you grow.'),
        const SectionLabel('Front of house'),
        _row(context, '01', 'AUZsPOS', 'Order taking, GST billing, table floor plan, kitchen tickets and day settlement, all in one till.', Icons.point_of_sale, Tk.accent, () => ProductPosPage(s)),
        _row(context, '02', 'CRM', 'Customer profiles, automatic segments, loyalty points and feedback, included with AUZsPOS.', Icons.favorite_outline, Tk.purple, () => ProductCrmPage(s)),
        _row(context, '03', 'Billing & Invoicing', 'GST invoices with automatic numbering, shareable receipts and due/credit tracking.', Icons.receipt_long_outlined, Tk.green, () => ProductBillingPage(s)),
        _row(context, '04', 'Inventory', 'Stock tracking, purchase entry, wastage logging and reorder forecasting.', Icons.inventory_2_outlined, Tk.orange, () => ProductInventoryPage(s)),
        _row(context, '05', 'QR Ordering', 'A QR code on every table: guests browse and order from their own phone, straight to the kitchen.', Icons.qr_code, Tk.blue, () => ProductQrOrderingPage(s)),
        const SectionLabel('Your team and your books'),
        _row(context, '06', 'AUZsPay', 'Attendance-based staff pay: clock-ins, adjustments and a payslip history you can export.', Icons.groups_outlined, Tk.teal, () => ProductPayrollPage(s)),
        _row(context, '07', 'AUZsLedger', 'A real double-entry ledger with GST, purchases, stock and bank reconciliation.', Icons.account_balance_outlined, Tk.purple, () => ProductAccountingPage(s)),
        _row(context, '08', 'AUZsScan', 'Point your phone at a barcode to bill it with GST, take payment and send the invoice on WhatsApp.', Icons.qr_code_scanner, Tk.red, () => ProductScanPage(s)),
        const SectionLabel('For salons & spas'),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 5),
          child: Material(
            color: Tk.card,
            borderRadius: BorderRadius.circular(18),
            child: InkWell(
              borderRadius: BorderRadius.circular(18),
              onTap: () => openSite(s, 'business-salons.html'),
              child: Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(borderRadius: BorderRadius.circular(18), border: Border.all(color: Tk.line, width: .5)),
                child: Row(children: [
                  Container(width: 46, height: 46, decoration: BoxDecoration(color: Tk.label3, borderRadius: BorderRadius.circular(13)), child: const Icon(Icons.content_cut, color: Colors.white, size: 24)),
                  const SizedBox(width: 14),
                  Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    const Text('AUZslab Salon', style: TextStyle(fontSize: 17, fontWeight: FontWeight.w800)),
                    Padding(padding: const EdgeInsets.only(top: 2), child: Text('Your own booking site, billing, clients and analytics, styled with your logo. Open on the website.', style: TextStyle(color: Tk.label2, fontSize: 14, height: 1.3))),
                  ])),
                  Icon(Icons.open_in_new, color: Tk.label3, size: 22),
                ]),
              ),
            ),
          ),
        ),
        const SizedBox(height: 16),
      ]);
}
