import 'package:flutter_test/flutter_test.dart';
import 'package:auzsledger/core/calc.dart';
import 'package:auzsledger/ui/p_books.dart';

void main() {
  test('CSV: quotes, commas, doubled quotes, CRLF and a BOM', () {
    final t = parseCsv('﻿Date,Narration,Amount\r\n05/10/2026,"Rent, shop",1000\r\n06/10/2026,"He said ""hi""",5\r\n');
    expect(t.length, 3);
    expect(t[1], ['05/10/2026', 'Rent, shop', '1000']);
    expect(t[2][1], 'He said "hi"');
  });

  test('bank dates in the usual Indian formats', () {
    expect(bankDate('05/10/2026'), '2026-10-05');
    expect(bankDate('5-10-26'), '2026-10-05');
    expect(bankDate('2026-10-05'), '2026-10-05');
    expect(bankDate('5 Oct 2026'), '2026-10-05');
    expect(bankDate('Opening balance'), '');
  });

  test('statement columns are guessed and rows keep only dated lines', () {
    final t = parseCsv('Txn Date,Narration,Chq/Ref No,Withdrawal Amt,Deposit Amt,Balance\n01/10/2026,UPI Ravi,123,500,,9500\nTotal,,,,,\n02/10/2026,Salary,,,2000,11500');
    final col = guessBankColumns(t.first);
    expect(col['date'], 0);
    expect(col['debit'], 3);
    expect(col['credit'], 4);
    final rows = bankRows(t, col);
    expect(rows.length, 2);
    expect(rows.first, {'date': '2026-10-01', 'description': 'UPI Ravi', 'reference': '123', 'debit': '500', 'credit': ''});
  });

  test('a payment settles the oldest dues first and never more than is owed', () {
    final docs = [
      {'id': 'b', 'doc_date': '2026-09-20', 'outstanding': 300},
      {'id': 'a', 'doc_date': '2026-09-01', 'outstanding': 100},
      {'id': 'c', 'doc_date': '2026-10-01', 'outstanding': 50},
    ];
    expect(allocateOldestFirst(250, docs), [{'doc_id': 'a', 'amount': 100.0}, {'doc_id': 'b', 'amount': 150.0}]);
    expect(allocateOldestFirst(1000, docs).fold<double>(0, (s, x) => s + (x['amount'] as double)), 450);
    expect(allocateOldestFirst(0, docs), isEmpty);
  });

  test('credit note lines only carry what comes back', () {
    final lines = [
      {'id': 1, 'description': 'Pen', 'qty': 10, 'rate': 5, 'tax_rate': 18, 'hsn': '9608'},
      {'id': 2, 'description': 'Book', 'qty': 2, 'rate': 100, 'tax_rate': 0},
    ];
    final c = creditLines(lines, {'1': 3.0, '2': 0.0});
    expect(c.length, 1);
    expect(c.first['qty'], '3');
    expect(c.first['tax_rate'], '18');
  });

  test('import columns follow the header names and rows skip blanks', () {
    final prod = importProducts();
    final t = parseCsv('Item Name,HSN Code,GST %,Selling Price\nPen,9608,18,5\nNotebook,,12,\n');
    final col = guessImportColumns(t.first, prod);
    expect(col['name'], 0);
    expect(col['hsn'], 1);
    expect(col['sale_price'], 3);
    final rows = importRows(t, col);
    expect(rows[1], {'name': 'Notebook', 'tax_rate': '12'});
  });
}

List<(String, RegExp, bool)> importProducts() => [('name', RegExp(r'name|item|product|desc'), true), ('hsn', RegExp(r'hsn|sac'), false), ('tax_rate', RegExp(r'gst|tax|rate %'), false), ('sale_price', RegExp(r'sale|sell|price|mrp'), false)];
