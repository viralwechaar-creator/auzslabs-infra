import 'package:flutter_test/flutter_test.dart';
import 'package:auzsledger/core/calc.dart';
import 'package:auzsledger/ui/p_reports.dart';

void main() {
  test('report periods follow the Indian financial year', () {
    final now = DateTime(2026, 10, 12);
    expect(reportPeriod('month', now), ('2026-10-01', '2026-10-31'));
    expect(reportPeriod('lastmonth', now), ('2026-09-01', '2026-09-30'));
    expect(reportPeriod('fy', now), ('2026-04-01', '2027-03-31'));
    expect(reportPeriod('lastfy', now), ('2025-04-01', '2026-03-31'));
    expect(reportPeriod('fy', DateTime(2027, 2, 3)), ('2026-04-01', '2027-03-31'));
    expect(reportPeriod('lastmonth', DateTime(2027, 1, 5)), ('2026-12-01', '2026-12-31'));
  });

  test('every report turns the server answer into figures and CSV', () {
    final pnl = buildReport('pnl', {'revenue': 1000, 'gross_profit': 400, 'gross_margin': 40, 'expense': 700, 'net_profit': 300, 'net_margin': 30, 'groups': [{'grp': 'Revenue', 'total': 1000, 'accounts': [{'name': 'Sales', 'amount': 1000}]}]}, inr);
    expect(pnl.metrics.first.$2, '₹1,000');
    expect(pnl.csv.last, ['Net profit', 300.0]);
    final tb = buildReport('tb', {'rows': [{'name': 'Cash', 'code': '1', 'type': 'asset', 'debit': 5, 'credit': 0, 'closing': 5}, {'name': 'Capital', 'code': '2', 'type': 'equity', 'debit': 0, 'credit': 5, 'closing': -5}]}, inr);
    expect(tb.metrics[1].$3, 'Balanced');
    final ar = buildReport('ar', {'totals': {'total': 90, 'd30': 40, 'd60': 0, 'd90': 0, 'd90p': 0, 'current': 50}, 'rows': [{'name': 'Ravi', 'total': 90, 'd30': 40}]}, inr);
    expect(ar.metrics[1].$2, '₹40');
    expect(csvText(ar.csv).split('\n').length, 2);
    final gst = buildReport('gst', {'output': {'cgst': 9, 'sgst': 9, 'igst': 0, 'cess': 0, 'taxable': 100}, 'itc': {'cgst': 4, 'sgst': 4, 'igst': 0, 'cess': 0}, 'payable': {'cgst': 5, 'sgst': 5, 'igst': 0, 'cess': 0}}, inr);
    expect(gst.metrics.first.$2, '₹18');
    final cf = buildReport('cf', {'opening': 10, 'net': 5, 'closing': 15, 'rows': [{'activity': 'Operating', 'name': 'Sales', 'amount': 5}]}, inr);
    expect(cf.csv.length, 2);
    final bs = buildReport('bs', {'groups': [], 'assets': 10, 'liabilities': 4, 'equity': 6, 'balanced': true, 'retained_prior': 1, 'current_profit': 5}, inr);
    expect(bs.metrics[1].$3, 'Balanced');
  });
}
