import 'dart:async';
import 'dart:convert';
import 'package:http/http.dart' as http;

const defaultApiBase = 'https://api.auzslab.in';

/// Same shape as the website's sb-client: every call returns data or throws [ApiError]. [networkError] is true when the
/// server could not be reached at all (offline, too slow); a real answer with an error status has [status] set.
class ApiError implements Exception {
  ApiError(this.message, {this.status, this.networkError = false});
  final String message;
  final int? status;
  final bool networkError;
  bool get isAuth => status == 401;
  /// 400 / 403 / 409: the server refused this change on a business rule. Do not retry it.
  bool get isRule => status == 400 || status == 403 || status == 409;
  /// Worth retrying later: no answer at all, a server error, a timeout or a rate limit.
  bool get isTransient => networkError || status == null || status! >= 500 || status == 408 || status == 429;
  @override
  String toString() => message;
}

class ApiClient {
  ApiClient({this.base = defaultApiBase, http.Client? client, this.timeout = const Duration(seconds: 20)}) : _http = client ?? http.Client();
  final String base;
  final Duration timeout;
  final http.Client _http;
  String? token;
  void Function()? onSessionExpired;

  Future<dynamic> _request(String method, String path, {Object? body, bool auth = true}) async {
    final headers = <String, String>{'Content-Type': 'application/json'};
    if (auth && token != null) headers['Authorization'] = 'Bearer $token';
    final uri = Uri.parse(base + path);
    http.Response res;
    try {
      final enc = body == null ? null : jsonEncode(body);
      final req = switch (method) {
        'POST' => _http.post(uri, headers: headers, body: enc),
        'PATCH' => _http.patch(uri, headers: headers, body: enc),
        _ => _http.get(uri, headers: headers),
      };
      res = await req.timeout(timeout);
    } on TimeoutException {
      throw ApiError('The connection is too slow or unreachable.', networkError: true);
    } catch (_) {
      throw ApiError('Could not reach the server.', networkError: true);
    }
    dynamic json;
    try {
      json = res.body.isEmpty ? null : jsonDecode(utf8.decode(res.bodyBytes));
    } catch (_) {}
    if (res.statusCode < 200 || res.statusCode >= 300) {
      if (res.statusCode == 401 && auth && token != null) {
        token = null;
        onSessionExpired?.call();
      }
      final msg = json is Map && json['error'] != null ? '${json['error']}' : 'Request failed (${res.statusCode})';
      throw ApiError(msg, status: res.statusCode);
    }
    return json is Map && json.containsKey('data') ? json['data'] : json;
  }

  /// Email + password. Returns the user map; throws [TwoFactorRequired] if the account has 2-step sign-in on.
  Future<Map<String, dynamic>> login(String email, String password) async => _session(await _request('POST', '/auth/login', body: {'email': email, 'password': password}, auth: false));

  /// Shop staff: username + PIN.
  Future<Map<String, dynamic>> staffLogin(String username, String pin) async => _session(await _request('POST', '/auth/staff-login', body: {'username': username, 'pin': pin}, auth: false));

  Future<Map<String, dynamic>> confirm2fa(String challenge, String code) async => _session(await _request('POST', '/auth/2fa/challenge', body: {'challenge': challenge, 'code': code}, auth: false));

  Map<String, dynamic> _session(dynamic data) {
    final m = Map<String, dynamic>.from(data as Map);
    if (m['requires2fa'] == true) throw TwoFactorRequired('${m['challenge']}');
    token = '${m['access_token']}';
    return Map<String, dynamic>.from(m['user'] as Map);
  }

  Future<dynamic> rpc(String fn, [Map<String, dynamic> args = const {}]) => _request('POST', '/rpc/$fn', body: args);

  /// Records changed since [since] (an ISO microsecond string from the server), oldest first.
  Future<List<Map<String, dynamic>>> recordsSince(String since, {int limit = 1000}) async {
    final q = Uri(queryParameters: {'select': 'id,kind,data,deleted,updated_at', 'gte.updated_at': since, 'order': 'updated_at', 'limit': '$limit'}).query;
    final d = await _request('GET', '/db/records?$q');
    return (d as List).map((e) => Map<String, dynamic>.from(e as Map)).toList();
  }

  Future<dynamic> insert(String table, Map<String, dynamic> values) => _request('POST', '/db/$table', body: values);

  Future<dynamic> update(String table, String col, String val, Map<String, dynamic> values) => _request('PATCH', '/db/$table?${Uri(queryParameters: {'eq.$col': val}).query}', body: values);

  Future<Map<String, dynamic>?> one(String table, String col, String val, {String select = '*'}) async {
    final q = Uri(queryParameters: {'select': select, 'eq.$col': val, 'single': '1'}).query;
    final d = await _request('GET', '/db/$table?$q');
    return d == null ? null : Map<String, dynamic>.from(d as Map);
  }

  Future<List<Map<String, dynamic>>> select(String table, {String select = '*', Map<String, String> eq = const {}, String? order, int? limit}) async {
    final p = <String, String>{'select': select, for (final e in eq.entries) 'eq.${e.key}': e.value, if (order != null) 'order': order, if (limit != null) 'limit': '$limit'};
    final d = await _request('GET', '/db/$table?${Uri(queryParameters: p).query}');
    return (d as List).map((e) => Map<String, dynamic>.from(e as Map)).toList();
  }
}

class TwoFactorRequired implements Exception {
  TwoFactorRequired(this.challenge);
  final String challenge;
}
