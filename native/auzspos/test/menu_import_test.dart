import 'package:auzspos/core/menu_import.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('reads comma, tab and semicolon rows, skips the header, flags bad lines', () {
    final r = parseMenuText('Category,Item,Price,Type\nHot drinks,Masala Chai,20,veg\nSnacks\tEgg Roll\t₹60\tegg\nSnacks;Chicken Roll;80;non-veg\nBroken line\nDesserts,Brownie,abc');
    expect(r.rows.map((x) => '${x.cat}|${x.name}|${x.price}|${x.veg}'), ['Hot drinks|Masala Chai|20|veg', 'Snacks|Egg Roll|60|egg', 'Snacks|Chicken Roll|80|nonveg']);
    expect(r.problems.length, 2);
  });
  test('quoted names keep their commas and the type is optional', () {
    final r = parseMenuText('Mains,"Dal, Rice combo",120');
    expect(r.rows.single.name, 'Dal, Rice combo');
    expect(r.rows.single.veg, 'veg');
  });
}
