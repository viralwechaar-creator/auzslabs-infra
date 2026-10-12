import 'package:auzspos/core/repo.dart';
import 'package:flutter_test/flutter_test.dart';
import 'sync_test.dart' show FakeServer, mk;

void main() {
  test('per-outlet kinds follow the chosen outlet and new records are stamped with it', () async {
    final r = mk(FakeServer());
    await r.save('table', {'name': 'T1'});
    r.outlet = 'o2';
    await r.save('table', {'name': 'B1'});
    await r.save('item', {'name': 'Tea', 'price': 20});
    expect(r.of('table').map((t) => t['name']), ['B1']);
    expect(r.of('item').length, 1, reason: 'the menu is shared by every outlet');
    r.outlet = 'main';
    expect(r.of('table').map((t) => t['name']), ['T1'], reason: 'a record with no outlet belongs to main');
    r.outlet = 'all';
    expect(r.of('table').length, 2);
    await r.save('table', {'name': 'X'});
    expect(r.ofAll('table').firstWhere((t) => t['name'] == 'X')['outlet'], 'main', reason: 'All outlets stamps new records main');
  });

  test('menuItems drops items switched off here and uses the outlet price', () async {
    final r = mk(FakeServer());
    await r.save('item', {'name': 'Tea', 'price': 20, 'outletPrice': {'o2': 25}});
    await r.save('item', {'name': 'Cake', 'price': 90, 'outletOff': {'o2': true}});
    r.outlet = 'o2';
    final m = r.menuItems();
    expect(m.map((i) => i['name']), ['Tea']);
    expect(m.first['price'], 25);
    r.outlet = 'main';
    expect(r.menuItems().map((i) => '${i['name']}:${i['price']}').toSet(), {'Tea:20', 'Cake:90'});
  });
}
