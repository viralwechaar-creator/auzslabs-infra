import 'dart:convert';
import 'package:path/path.dart' as p;
import 'package:sqflite/sqflite.dart';
import 'store.dart';

/// The phone's database. One file per login (see [open]) so a different login on the same phone can never see the previous
/// business's records.
class SqliteStore implements LocalStore {
  SqliteStore._(this._db);
  final Database _db;

  static Future<SqliteStore> open(String userId) async {
    final path = p.join(await getDatabasesPath(), 'auzspos_${userId.replaceAll(RegExp(r'[^A-Za-z0-9_-]'), '_')}.db');
    final db = await openDatabase(path, version: 1, onCreate: (d, v) async {
      await d.execute('create table rec(id text primary key, kind text, j text)');
      await d.execute('create index rec_kind on rec(kind)');
      await d.execute('create table outbox(id text primary key, t text, j text)');
      await d.execute('create table meta(k text primary key, v text)');
    });
    return SqliteStore._(db);
  }

  @override
  Future<List<Rec>> allRecs() async => (await _db.query('rec')).map((r) => Rec.fromJson(jsonDecode(r['j'] as String) as Map<String, dynamic>)).toList();
  @override
  Future<void> putRec(Rec r) => _db.insert('rec', {'id': r.id, 'kind': r.kind, 'j': jsonEncode(r.toJson())}, conflictAlgorithm: ConflictAlgorithm.replace);
  @override
  Future<void> delRec(String id) => _db.delete('rec', where: 'id=?', whereArgs: [id]);
  @override
  Future<void> clearRecs() => _db.delete('rec');
  @override
  Future<List<OutItem>> outbox() async => (await _db.query('outbox', orderBy: 't')).map((r) => OutItem.fromJson(jsonDecode(r['j'] as String) as Map<String, dynamic>)).toList();
  @override
  Future<OutItem?> outItem(String id) async {
    final r = await _db.query('outbox', where: 'id=?', whereArgs: [id]);
    return r.isEmpty ? null : OutItem.fromJson(jsonDecode(r.first['j'] as String) as Map<String, dynamic>);
  }
  @override
  Future<void> putOut(OutItem o) => _db.insert('outbox', {'id': o.id, 't': o.updatedAt, 'j': jsonEncode(o.toJson())}, conflictAlgorithm: ConflictAlgorithm.replace);
  @override
  Future<void> delOut(String id) => _db.delete('outbox', where: 'id=?', whereArgs: [id]);
  @override
  Future<void> clearOut() => _db.delete('outbox');
  @override
  Future<String?> meta(String k) async {
    final r = await _db.query('meta', where: 'k=?', whereArgs: [k]);
    return r.isEmpty ? null : r.first['v'] as String?;
  }
  @override
  Future<void> setMeta(String k, String? v) => v == null ? _db.delete('meta', where: 'k=?', whereArgs: [k]) : _db.insert('meta', {'k': k, 'v': v}, conflictAlgorithm: ConflictAlgorithm.replace);
}
