import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:auzsmob/core/api.dart';
import 'package:auzsmob/core/session.dart';
import 'package:auzsmob/core/store.dart';

class _Api extends ApiClient {
  _Api(this.answers);
  final Map<String, Object?> answers;
  @override
  Future<dynamic> rpc(String fn, [Map<String, dynamic> args = const {}]) async {
    if (!answers.containsKey(fn)) throw ApiError('Could not reach the server.', networkError: true);
    final a = answers[fn];
    if (a is ApiError) throw a;
    return a;
  }
}

Map<String, dynamic> ctx(Map<String, dynamic> perms, {Map<String, dynamic>? features, bool rates = false}) => {
      'perms': perms, 'can_see_rates': rates, 'settings': {'shopName': 'Test Mobiles', 'features': features ?? {}}, 'my_language': 'en', 'my_language_set': true,
    };

const owner = {'mob_view': true, 'mob_sell': true, 'mob_purchase': true, 'mob_repair': true, 'mob_manage': true, 'mob_reports': true};
const staff = {'mob_view': true, 'mob_sell': true, 'mob_purchase': true, 'mob_repair': true};

MobSession make(Map<String, dynamic> c) {
  final s = MobSession();
  s.ctx = c;
  s.dash = {'my_role': 'owner', 'tenant': {'slug': 'arpit', 'name': 'Arpit Traders'}, 'features': {'mobile': true}, 'enabled_features': {}};
  return s;
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  SharedPreferences.setMockInitialValues({});
  test('the owner sees every section, a staffer sees My sales instead of Reports', () {
    expect(make(ctx(owner)).allNav, ['home', 'sell', 'repairs', 'stock', 'reports', 'dues', 'settings']);
    expect(make(ctx(staff)).allNav, ['home', 'sell', 'repairs', 'stock', 'myreport', 'dues', 'settings']);
  });

  test('the shop switches hide sections', () {
    final s = make(ctx(owner, features: {'repairs': 'simple', 'stock': false, 'customers': false, 'vendors': false}));
    expect(s.allNav, ['home', 'sell', 'stock', 'reports', 'settings']); // stock stays for the owner who can manage
    expect(s.repairsMode, 'simple');
    expect(s.feat('serials'), isTrue);
  });

  test('the bottom bar shows four sections and More; a custom menu is exactly what the owner chose', () {
    final s = make(ctx(owner));
    expect(s.tabs, ['home', 'sell', 'repairs', 'stock']);
    expect(s.moreList, ['reports', 'dues', 'settings']);
    final c = make(ctx(owner, features: {'nav': ['sell', 'reports', 'more']}));
    expect(c.tabs, ['sell', 'reports']);
    expect(c.showMore, isTrue);
    expect(c.moreList, ['settings']); // settings must always stay reachable
    final noMore = make(ctx(owner, features: {'nav': ['sell', 'home']}));
    expect(noMore.showMore, isFalse);
    expect(noMore.navList, ['sell', 'home', 'settings']);
  });

  test('a staffer keeps My sales whatever menu the owner arranged', () {
    final s = make(ctx(staff, features: {'nav': ['sell', 'more']}));
    expect(s.navList, contains('myreport'));
  });

  test('profit sharing percent is read from the shop settings', () {
    final s = make(ctx(owner, features: {'profitSharePct': 40}));
    expect(s.sharePct, 40);
    expect(s.split(1000).shop, 400);
    expect(make(ctx(owner, features: {'profitSharePct': 150})).sharePct, 0);
  });

  test('a business without AUZsMob is not allowed in; unknown is allowed', () {
    final s = make(ctx(owner));
    s.dash = {'features': {'mobile': false, 'pos': true}, 'enabled_features': {}};
    expect(s.mobAllowed, isFalse);
    s.dash = {'features': {'mobile': true}, 'enabled_features': {'mobile': false}};
    expect(s.mobAllowed, isFalse);
    s.dash = {};
    expect(s.mobAllowed, isTrue);
  });

  test('opening the app with the internet down uses the copy kept on the phone', () async {
    final store = MemoryStore();
    await store.setMeta('dash', '{"my_role":"cashier","my_email":"a@b.c","tenant":{"slug":"arpit","name":"Arpit"},"features":{"mobile":true}}');
    await store.setMeta('ctx', '{"perms":{"mob_view":true,"mob_sell":true},"settings":{"features":{}},"my_language":"en","my_language_set":true}');
    final s = MobSession();
    await s.openWith({'id': 'u1', 'email': 'a@b.c'}, store);
    expect(s.signedIn, isTrue);
    expect(s.can('mob_sell'), isTrue);
    expect(s.can('mob_reports'), isFalse);
    expect(s.role, 'cashier');
    expect(s.origin, 'https://arpit.auzslab.in');
  });

  test('a first sync after the owner cleared all data empties this phone', () async {
    final store = MemoryStore();
    await store.put('sales', {'id': 'old'});
    await store.setMeta('epoch', 'T1');
    final api = _Api({
      'my_dashboard': {'my_role': 'owner', 'tenant': {'slug': 'x', 'name': 'X'}, 'features': {'mobile': true}},
      'mob_context': ctx(owner),
      'mob_data_epoch': {'epoch': 'T2'},
    });
    final s2 = _Session(api);
    await s2.openWith({'id': 'u1'}, store);
    expect(s2.repo!.rows('sales'), isEmpty);
    expect(await store.meta('epoch'), 'T2');
  });
}

/// A session wired to a scripted API.
class _Session extends MobSession {
  _Session(this._fake);
  final ApiClient _fake;
  @override
  ApiClient get api => _fake;
}
