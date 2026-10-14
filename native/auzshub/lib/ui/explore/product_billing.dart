import 'package:flutter/material.dart' hide Text;
import '../../core/session.dart';
import '../ds.dart';
import '../i18n.dart';
import '../mk.dart';
import '../theme.dart';
import 'product_common.dart';
import 'product_crm.dart';
import 'product_pos.dart';

/// "Billing & Invoicing" (native equivalent of site/billing.html): GST-ready invoices, automatic
/// numbering, due/credit tracking and returns, included with AUZsPOS and AUZslab Salon.
class ProductBillingPage extends StatelessWidget {
  const ProductBillingPage(this.s, {super.key});
  final HubSession s;

  @override
  Widget build(BuildContext context) => SubPage('Billing & Invoicing', [
        productHero('BILLING & INVOICING', 'Invoices that hold up to scrutiny.', 'Automatic invoice numbering, tax breakdowns for your jurisdiction, and receipts ready to print, share or send straight to WhatsApp.'),
        const SectionLabel("What's included"),
        productCard([
          includedRow('GST-ready invoices', 'Proper tax breakdowns -- CGST/SGST split or any other model your jurisdiction needs.'),
          includedRow('Automatic numbering', 'Every invoice gets its own sequential number, per financial year, with no manual bookkeeping.'),
          includedRow('Print, share or WhatsApp', "Hand over a printed slip, or send a digital copy straight to a customer's phone."),
          includedRow('Custom footer and branding', 'Your business name, GSTIN and a footer message on every receipt.'),
          includedRow('Due & credit sales', "Let a trusted customer settle later -- the sale still logs now, and the balance shows up as due until it's settled."),
          includedRow('Returns & exchanges', 'Return or exchange a sold item against its original invoice, with stock adjusted automatically either way.'),
        ]),
        const SectionLabel('Any business'),
        productCard([
          Text('The same invoice engine, set up for how you actually sell: dine-in, takeaway and split bills for a cafe; service bills with the staff member for a salon; barcode billing, discounts and returns for retail; exchanges against the original bill for clothing; phone, accessory and repair bills for a mobile shop.', style: TextStyle(color: Tk.label2, fontSize: 14.5, height: 1.4)),
        ]),
        const SectionLabel('Get Billing & Invoicing'),
        LivePriceCard(s, 'pos', includedWith: 'pos'),
        const SectionLabel('Pairs well with'),
        pairsWith([
          ('POS', () => ProductPosPage(s)),
          ('CRM', () => ProductCrmPage(s)),
        ]),
        const SizedBox(height: 16),
      ]);
}
