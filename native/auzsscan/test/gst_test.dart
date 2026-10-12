import 'package:flutter_test/flutter_test.dart';
import 'package:auzsscan/core/calc.dart';

void main() {
  const org = {'state_code': '08', 'reg_type': 'regular', 'round_off_sales': false};
  test('prices that include GST are split into taxable value and CGST/SGST', () {
    final c = calcSales([{'qty': 2, 'rate': 118, 'tax_rate': 18}], inclusive: true, org: org);
    expect(c.taxable, 200);
    expect(c.cgst, 18);
    expect(c.sgst, 18);
    expect(c.igst, 0);
    expect(c.total, 236);
  });
  test('prices without GST get the tax added on top', () {
    final c = calcSales([{'qty': 1, 'rate': 1000, 'tax_rate': 12}], inclusive: false, org: org);
    expect(c.taxable, 1000);
    expect(c.cgst + c.sgst, 120);
    expect(c.total, 1120);
  });
  test('a customer in another state gets IGST', () {
    final c = calcSales([{'qty': 1, 'rate': 100, 'tax_rate': 18}], inclusive: false, org: org, party: {'state_code': '27', 'reg_type': 'regular'});
    expect(c.supply, 'inter');
    expect(c.igst, 18);
    expect(c.cgst, 0);
  });
  test('discounts come off before tax, percent or rupees', () {
    final a = calcSales([{'qty': 1, 'rate': 200, 'disc_pct': 10, 'tax_rate': 5}], inclusive: false, org: org);
    expect(a.discount, 20);
    expect(a.taxable, 180);
    expect(a.total, 189);
    final b = calcSales([{'qty': 1, 'rate': 200, 'disc_amt': 50, 'tax_rate': 0}], inclusive: false, org: org);
    expect(b.total, 150);
  });
  test('a business that is not GST-registered charges no tax; zero-rated items carry none', () {
    final c = calcSales([{'qty': 1, 'rate': 100, 'tax_rate': 18}], inclusive: false, org: {...org, 'reg_type': 'unregistered'});
    expect(c.total, 100);
    final z = calcSales([{'qty': 3, 'rate': 45, 'tax_rate': 0}], inclusive: true, org: org);
    expect(z.total, 135);
    expect(z.cgst, 0);
  });
  test('round off to the nearest rupee when the business asks for it', () {
    final c = calcSales([{'qty': 1, 'rate': 99.5, 'tax_rate': 0}], inclusive: false, org: {...org, 'round_off_sales': true});
    expect(c.roundoff, 0.5);
    expect(c.total, 100);
  });
  test('the same product written as UPC-A or EAN-13', () {
    expect(waNumber('98765 43210'), '919876543210');
    expect(waNumber('+91 98765-43210'), '919876543210');
  });
}
