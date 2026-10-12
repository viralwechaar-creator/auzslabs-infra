import 'package:flutter_test/flutter_test.dart';
import 'package:auzspos/ui/i18n.dart';

void main() {
  test('Hindi translates fixed labels and leaves other text alone', () {
    Lang.code = 'en';
    expect(tr('Sell'), 'Sell');
    Lang.code = 'hi';
    expect(tr('Sell'), 'बिक्री');
    expect(tr('Take payment'), 'भुगतान लें');
    expect(tr('3 items'), '3 आइटम');
    expect(tr('Some long unknown sentence.'), 'Some long unknown sentence.');
    Lang.code = 'en';
  });
}
