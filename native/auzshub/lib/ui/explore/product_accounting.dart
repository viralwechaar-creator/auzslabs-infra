import 'package:flutter/material.dart' hide Text;
import '../../core/session.dart';
import '../ds.dart';
import '../mk.dart';
import 'product_common.dart';
import 'product_inventory.dart';
import 'product_payroll.dart';
import 'product_pos.dart';
import 'product_scan.dart';

/// "AUZsLedger" (native equivalent of site/accounting.html): a real double-entry ledger with
/// GST, connected to sales, purchases and stock -- every figure traces back to the bill behind
/// it.
class ProductAccountingPage extends StatelessWidget {
  const ProductAccountingPage(this.s, {super.key});
  final HubSession s;

  @override
  Widget build(BuildContext context) => SubPage('AUZsLedger', [
        productHero('AUZSLEDGER · ACCOUNTING', 'Accounting that knows the business behind it.', 'A real double-entry ledger with GST, connected to your sales, purchases and stock. Every figure traces back to the bill behind it, so the reports tell you what is actually happening.'),
        const Note('AUZsLedger is still in testing: sign up as an early tester and your first month, plus the one-time setup fee, is free.'),
        const SectionLabel('Everything included, one place'),
        productCard([
          includedRow('GST that works itself out', 'CGST and SGST within your state, IGST across states, reverse charge and input credit. Rates are a setting.'),
          includedRow('One entry, everywhere', 'Post an invoice and the ledger, stock, cost of goods, receivable and GST update together, in one step.'),
          includedRow('Quotes to cash', 'Quotation, order, challan, invoice, receipt. Part payments, advances and credit notes all settle against the right invoice.'),
          includedRow('Purchases and suppliers', 'Bills with supplier invoice numbers, debit notes, payments, and a GSTR-2B match so you claim only the credit you are owed.'),
          includedRow('Stock and warehouses', 'Average cost, batches and expiry, transfers between godowns, stock counts and reorder alerts, tied to the ledger.'),
          includedRow('Bank reconciliation', 'Import your statement from net banking, match it to your books, and reconcile to zero.'),
          includedRow('Reports that drill down', 'Trial balance, profit and loss, balance sheet, cash flow, ageing and GST registers -- tap any figure to reach the invoice behind it.'),
          includedRow("Nothing silently changes", "Posted entries can't be edited, only reversed. Dates can be locked, every action is logged."),
          includedRow('Roles and approvals', 'Owner, manager, cashier or a custom role. Set an approval limit so large bills wait for a manager.'),
          includedRow('Scan to bill', 'Point your phone camera at a barcode to add the item, take payment and post a GST invoice -- AUZsScan uses the same books.', optional: true),
        ]),
        const SectionLabel('Get AUZsLedger'),
        LivePriceCard(s, 'accounting'),
        const SectionLabel('Pairs well with'),
        pairsWith([
          ('Inventory', () => ProductInventoryPage(s)),
          ('AUZsPay', () => ProductPayrollPage(s)),
          ('POS', () => ProductPosPage(s)),
          ('AUZsScan', () => ProductScanPage(s)),
        ]),
        const SizedBox(height: 16),
      ]);
}
