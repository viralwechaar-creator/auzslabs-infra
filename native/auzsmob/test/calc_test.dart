import 'package:flutter_test/flutter_test.dart';
import 'package:auzsmob/core/calc.dart';

void main() {
  test('rupees are grouped the Indian way', () {
    expect(inr(0), '₹0');
    expect(inr(999), '₹999');
    expect(inr(1234), '₹1,234');
    expect(inr(123456), '₹1,23,456');
    expect(inr(12345678.5), '₹1,23,45,678.50');
    expect(inr(-2500), '-₹2,500');
  });

  test('stock is the sum of movements, never a counter', () {
    final m = [
      {'item_id': 'a', 'qty': 5},
      {'item_id': 'a', 'qty': -2},
      {'item_id': 'b', 'qty': 9},
    ];
    expect(stockOf(m, 'a'), 3);
    expect(stockOf(m, 'b'), 9);
    expect(stockOf(m, 'zzz'), 0);
  });

  test('a vendor payment clears the OLDEST purchase first', () {
    final purchases = [
      {'id': 'p2', 'vendor_id': 'v', 'total': 200, 'created_at': '2026-10-02T10:00:00Z'},
      {'id': 'p1', 'vendor_id': 'v', 'total': 100, 'created_at': '2026-10-01T10:00:00Z'},
      {'id': 'p3', 'vendor_id': 'v', 'total': 150, 'created_at': '2026-10-03T10:00:00Z'},
      {'id': 'x', 'vendor_id': 'v', 'total': 1000, 'voided': true, 'created_at': '2026-10-04T10:00:00Z'},
      {'id': 'o', 'vendor_id': 'other', 'total': 77, 'created_at': '2026-10-01T10:00:00Z'},
    ];
    final pays = [
      {'kind': 'vendor_due', 'vendor_id': 'v', 'amount': 250},
      {'kind': 'customer_due', 'vendor_id': null, 'amount': 999},
    ];
    final d = vendorPurchaseDues(purchases, pays, 'v');
    expect(d.totalPurchased, 450);
    expect(d.totalPaid, 250);
    final due = {for (final r in d.rows) r['id']: r['_due']};
    expect(due['p1'], 0);
    expect(due['p2'], 50);
    expect(due['p3'], 150);
    expect(d.rows.any((r) => r['id'] == 'x'), isFalse);
    final bal = vendorBalances(purchases, pays);
    expect(bal['v'], 200);
    expect(bal['other'], 77);
  });

  test('report periods', () {
    final now = DateTime(2026, 10, 12);
    expect(rangeDates('today', now: now), ('2026-10-12', '2026-10-12'));
    expect(rangeDates('week', now: now), ('2026-10-06', '2026-10-12'));
    expect(rangeDates('month', now: now), ('2026-10-01', '2026-10-12'));
    expect(rangeDates('lastmonth', now: now), ('2026-09-01', '2026-09-30'));
    expect(rangeDates('year', now: now), ('2026-01-01', '2026-10-12'));
    expect(rangeDates('lastyear', now: now), ('2025-01-01', '2025-12-31'));
    expect(rangeDates('custom', from: '2026-10-09', to: '2026-10-03', now: now), ('2026-10-03', '2026-10-09'));
    expect(rangeDates('custom', from: '2026-10-09', now: now), ('2026-10-09', '2026-10-09'));
    expect(rangeDates('custom', now: now), ('2026-10-12', '2026-10-12'));
    expect(rangeDates('lastmonth', now: DateTime(2026, 1, 5)), ('2025-12-01', '2025-12-31'));
  });

  test('profit sharing takes a percent of positive profit only', () {
    final s = splitProfit(1000, 50);
    expect((s.shop, s.staff), (500.0, 500.0));
    final loss = splitProfit(-200, 50);
    expect((loss.shop, loss.staff), (0.0, -200.0));
    final off = splitProfit(1000, 0);
    expect((off.shop, off.staff), (0.0, 1000.0));
  });

  test('the spreadsheet has one block per staffer with totals and safe quoting', () {
    final csv = ledgerCsv([
      {'sold_by': 'Asha', 'purchased_by': 'Ravi', 'item_name': 'Case, "clear"', 'qty': 2, 'cost_total': 100, 'sale_total': 180, 'profit': 80},
      {'sold_by': 'Asha', 'purchased_by': 'Ravi', 'item_name': 'Charger', 'qty': 1, 'cost_total': 200, 'sale_total': 300, 'profit': 100},
      {'sold_by': 'Mohan', 'purchased_by': '', 'item_name': 'Phone', 'qty': 1, 'cost_total': 5000, 'sale_total': 6000, 'profit': 1000},
    ]);
    expect(csv.startsWith('\u{feff}Sold By,Purchased By'), isTrue);
    expect(csv.contains('"Case, ""clear"""'), isTrue);
    expect(csv.contains(',,Total,3.0,300.0,480.0,180.0'), isTrue);
    expect(csv.split('\r\n').where((l) => l.isEmpty).length, 1);
  });

  test('day cash: cash sales plus cash collected minus cash paid to vendors; voided and credit never count', () {
    final d = DateTime.now().toIso8601String();
    final old = DateTime.now().subtract(const Duration(days: 2)).toIso8601String();
    final c = dayCash([
      {'created_at': d, 'paid': 500, 'payment_mode': 'cash', 'balance': 0},
      {'created_at': d, 'paid': 300, 'payment_mode': 'upi', 'balance': 0},
      {'created_at': d, 'paid': 0, 'payment_mode': 'credit', 'balance': 700},
      {'created_at': d, 'paid': 999, 'payment_mode': 'cash', 'voided': true},
      {'created_at': old, 'paid': 111, 'payment_mode': 'cash'},
    ], [
      {'created_at': d, 'kind': 'customer_due', 'amount': 200, 'method': 'cash'},
      {'created_at': d, 'kind': 'customer_due', 'amount': 50, 'method': 'upi'},
      {'created_at': d, 'kind': 'vendor_due', 'amount': 120, 'method': 'cash'},
    ], ymd(DateTime.now()));
    expect(c.bills, 3);
    expect(c.cash, 500);
    expect(c.upi, 300);
    expect(c.credit, 700);
    expect(c.expected, 580);
  });
}
