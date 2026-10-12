import 'package:flutter_test/flutter_test.dart';
import 'package:auzsmob/ui/i18n.dart';

void main() {
  tearDown(() => Lang.code = 'en');
  test('English stays as written', () {
    expect(tr('New sale'), 'New sale');
    expect(trv('Voided {n}', {'n': 3}), 'Voided 3');
  });
  test('Hindi labels come from the website translations', () {
    Lang.code = 'hi';
    expect(tr('Save'), isNot('Save'));
    expect(tr('Repairs'), 'मरम्मत');
    expect(tr('Some text nobody translated'), 'Some text nobody translated');
    expect(trv('Voided {n}', {'n': 3}), contains('3'));
    expect(trv('Voided {n}', {'n': 3}), isNot('Voided 3'));
  });
}
