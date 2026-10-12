import 'package:auzspos/core/api.dart';
import 'package:auzspos/ui/website.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

void main() {
  test('export CSV has one block per table, quotes commas and writes lists as JSON', () {
    final csv = dataCsv({
      'business': {'name': 'Cafe'},
      'exported_at': '2026-10-12',
      'tables': {
        'orders': [
          {'id': 1, 'note': 'a, b', 'lines': [1, 2]},
          {'id': 2, 'extra': 'x'}
        ]
      }
    });
    expect(csv, contains('## orders (2 rows)'));
    expect(csv, contains('id,note,lines,extra'));
    expect(csv, contains('1,"a, b","[1,2]",'));
  });

  test('uploadImage posts the raw bytes with the token and returns the full public address', () async {
    late http.Request seen;
    final api = ApiClient(client: MockClient((r) async {
      seen = r;
      return http.Response('{"path":"/uploads/site/cafe/menu/1.jpg"}', 200);
    }))
      ..token = 'tok';
    final url = await api.uploadImage([0xff, 0xd8, 0xff, 1, 2, 3], 'menu/../x');
    expect(url, '$defaultApiBase/uploads/site/cafe/menu/1.jpg');
    expect(seen.url.path, '/storage/site/menux');
    expect(seen.headers['Authorization'], 'Bearer tok');
    expect(seen.bodyBytes.length, 6);
  });

  test('a refused upload says why', () async {
    final api = ApiClient(client: MockClient((r) async => http.Response('{"error":"owner only"}', 403)))..token = 't';
    expect(() => api.uploadImage([1], 'menu'), throwsA(isA<ApiError>().having((e) => e.message, 'message', 'owner only')));
  });
}
