import 'dart:convert';
import 'package:path/path.dart' as p;
import 'package:sqflite/sqflite.dart';

/// The names of the document stores, exactly the ones the website keeps in IndexedDB (`mob1`).

class OutRow {
  OutRow(this.oid, this.fn, this.args, this.createdAt);
  final int oid;
  final String fn;
  final Map<String, dynamic> args;
  final int createdAt;
}

/// Where the shop's copy, the unsent outbox and small settings live on the phone.
abstract class LocalStore {
  Future<List<Map<String, dynamic>>> all(String store);
  Future<void> put(String store, Map<String, dynamic> row);
  Future<void> putMany(String store, List<Map<String, dynamic>> rows);
  Future<void> del(String store, String id);
  Future<int> outAdd(String fn, Map<String, dynamic> args);
  Future<List<OutRow>> outAll();
  Future<void> outDel(int oid);
  Future<String?> meta(String k);
  Future<void> setMeta(String k, String? v);
  /// Empties everything (used after the owner clears all data).
  Future<void> wipe();
}

class MemoryStore implements LocalStore {
  final docs = <String, Map<String, Map<String, dynamic>>>{};
  final out = <int, OutRow>{};
  final _meta = <String, String>{};
  int _seq = 0;
  Map<String, dynamic> _copy(Map<String, dynamic> r) => Map<String, dynamic>.from(jsonDecode(jsonEncode(r)) as Map);
  @override
  Future<List<Map<String, dynamic>>> all(String store) async => (docs[store]?.values ?? const <Map<String, dynamic>>[]).map(_copy).toList();
  @override
  Future<void> put(String store, Map<String, dynamic> row) async => (docs[store] ??= {})['${row['id']}'] = _copy(row);
  @override
  Future<void> putMany(String store, List<Map<String, dynamic>> rows) async {
    for (final r in rows) {
      await put(store, r);
    }
  }
  @override
  Future<void> del(String store, String id) async => docs[store]?.remove(id);
  @override
  Future<int> outAdd(String fn, Map<String, dynamic> args) async {
    final o = ++_seq;
    out[o] = OutRow(o, fn, _copy(args), DateTime.now().millisecondsSinceEpoch);
    return o;
  }
  @override
  Future<List<OutRow>> outAll() async => (out.values.toList()..sort((a, b) => a.oid.compareTo(b.oid)));
  @override
  Future<void> outDel(int oid) async => out.remove(oid);
  @override
  Future<String?> meta(String k) async => _meta[k];
  @override
  Future<void> setMeta(String k, String? v) async => v == null ? _meta.remove(k) : _meta[k] = v;
  @override
  Future<void> wipe() async {
    docs.clear();
    out.clear();
    _meta.clear();
  }
}

/// The phone's database. One file per login so a different login on the same phone never sees another business's data.
class SqliteStore implements LocalStore {
  SqliteStore._(this._db);
  final Database _db;

  static Future<SqliteStore> open(String userId) async {
    final path = p.join(await getDatabasesPath(), 'auzsledger_${userId.replaceAll(RegExp(r'[^A-Za-z0-9_-]'), '_')}.db');
    final db = await openDatabase(path, version: 1, onCreate: (d, v) async {
      await d.execute('create table doc(s text, id text, j text, primary key(s, id))');
      await d.execute('create table outbox(oid integer primary key autoincrement, fn text, a text, t integer)');
      await d.execute('create table meta(k text primary key, v text)');
    });
    return SqliteStore._(db);
  }

  @override
  Future<List<Map<String, dynamic>>> all(String store) async => (await _db.query('doc', where: 's=?', whereArgs: [store])).map((r) => Map<String, dynamic>.from(jsonDecode(r['j'] as String) as Map)).toList();
  @override
  Future<void> put(String store, Map<String, dynamic> row) => _db.insert('doc', {'s': store, 'id': '${row['id']}', 'j': jsonEncode(row)}, conflictAlgorithm: ConflictAlgorithm.replace);
  @override
  Future<void> putMany(String store, List<Map<String, dynamic>> rows) async {
    if (rows.isEmpty) return;
    final b = _db.batch();
    for (final r in rows) {
      b.insert('doc', {'s': store, 'id': '${r['id']}', 'j': jsonEncode(r)}, conflictAlgorithm: ConflictAlgorithm.replace);
    }
    await b.commit(noResult: true);
  }
  @override
  Future<void> del(String store, String id) => _db.delete('doc', where: 's=? and id=?', whereArgs: [store, id]);
  @override
  Future<int> outAdd(String fn, Map<String, dynamic> args) => _db.insert('outbox', {'fn': fn, 'a': jsonEncode(args), 't': DateTime.now().millisecondsSinceEpoch});
  @override
  Future<List<OutRow>> outAll() async => (await _db.query('outbox', orderBy: 'oid')).map((r) => OutRow(r['oid'] as int, '${r['fn']}', Map<String, dynamic>.from(jsonDecode(r['a'] as String) as Map), r['t'] as int)).toList();
  @override
  Future<void> outDel(int oid) => _db.delete('outbox', where: 'oid=?', whereArgs: [oid]);
  @override
  Future<String?> meta(String k) async {
    final r = await _db.query('meta', where: 'k=?', whereArgs: [k]);
    return r.isEmpty ? null : r.first['v'] as String?;
  }
  @override
  Future<void> setMeta(String k, String? v) => v == null ? _db.delete('meta', where: 'k=?', whereArgs: [k]) : _db.insert('meta', {'k': k, 'v': v}, conflictAlgorithm: ConflictAlgorithm.replace);
  @override
  Future<void> wipe() async {
    await _db.delete('doc');
    await _db.delete('outbox');
    await _db.delete('meta');
  }
}
