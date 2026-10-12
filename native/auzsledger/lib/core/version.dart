import 'dart:convert';
import 'package:http/http.dart' as http;

/// Bump with every release you ship. `min` in site/native-version.json forces older builds to update.
const int kBuild = 1;

class UpdateInfo {
  UpdateInfo(this.force, this.available, this.url, this.note);
  final bool force, available;
  final String url, note;
}

/// Asks the website which version is current. Any failure (offline, bad answer) means "no update needed".
Future<UpdateInfo?> checkUpdate() async {
  try {
    final r = await http.get(Uri.https('auzslab.in', '/native-version.json')).timeout(const Duration(seconds: 4));
    if (r.statusCode != 200) return null;
    final p = (jsonDecode(r.body) as Map)['ledger'] as Map;
    final min = (p['min'] as num).toInt(), latest = (p['latest'] as num).toInt();
    return UpdateInfo(kBuild < min, kBuild < latest, '${p['url']}', '${p['note'] ?? ''}');
  } catch (_) {
    return null;
  }
}
