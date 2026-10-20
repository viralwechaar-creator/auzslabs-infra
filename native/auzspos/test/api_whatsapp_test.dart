import 'dart:convert';
import 'package:auzspos/core/api.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

/// ApiClient.connectWhatsApp (added for the native mgmt/whatsapp console page) must call the exact
/// same endpoint, body shape and auth header as the website's sb.whatsapp.connect (server/src/routes/whatsapp.js
/// POST /whatsapp/connect): this is the one thing a widget test cannot see, since it is a network call, so
/// it is proven directly against a fake server instead.
void main() {
  test('connectWhatsApp posts to /whatsapp/connect with the right body and bearer token', () async {
    http.Request? seen;
    final client = MockClient((r) async {
      seen = r;
      return http.Response(jsonEncode({'ok': true, 'number': '+91 98765 43210'}), 200);
    });
    final api = ApiClient(client: client);
    api.token = 'tok-123';
    final r = await api.connectWhatsApp(phoneNumberId: '105873456789012', wabaId: 'waba-9', token: 'meta-permanent-token');
    expect(seen!.method, 'POST');
    expect(seen!.url.path, '/whatsapp/connect');
    expect(seen!.headers['Authorization'], 'Bearer tok-123');
    final body = jsonDecode(seen!.body) as Map;
    expect(body['phone_number_id'], '105873456789012');
    expect(body['waba_id'], 'waba-9');
    expect(body['token'], 'meta-permanent-token');
    expect(r['number'], '+91 98765 43210');
  });

  test('connectWhatsApp surfaces the server\'s refusal message on a 400 (e.g. "owner access required")', () async {
    final client = MockClient((_) async => http.Response(jsonEncode({'error': 'owner access required'}), 403));
    final api = ApiClient(client: client)..token = 't';
    await expectLater(
      () => api.connectWhatsApp(phoneNumberId: '1', wabaId: null, token: 'x'),
      throwsA(isA<ApiError>().having((e) => e.message, 'message', 'owner access required')),
    );
  });
}
