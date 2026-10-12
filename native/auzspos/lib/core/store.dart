import 'dart:convert';

/// A record exactly as the server keeps it: `data` is the whole JSON document, so fields this app does not know about are
/// carried through untouched and the website and this app can edit the same order.
class Rec {
  Rec({required this.id, required this.kind, required this.data, this.deleted = false, this.updatedAt, this.srv});
  final String id, kind;
  Map<String, dynamic> data;
  bool deleted;
  String? updatedAt; // local change time
  String? srv; // the server's updated_at at last sync: the concurrency token push_record compares
  Map<String, dynamic> toJson() => {'id': id, 'kind': kind, 'data': data, 'deleted': deleted, 'updated_at': updatedAt, 'srv': srv};
  static Rec fromJson(Map<String, dynamic> j) => Rec(id: '${j['id']}', kind: '${j['kind']}', data: Map<String, dynamic>.from(j['data'] as Map), deleted: j['deleted'] == true, updatedAt: j['updated_at'] as String?, srv: j['srv'] as String?);
}

class OutItem {
  OutItem({required this.id, required this.kind, required this.data, required this.deleted, required this.updatedAt, this.base});
  final String id, kind;
  final Map<String, dynamic> data;
  final bool deleted;
  final String updatedAt;
  final String? base;
  Map<String, dynamic> toJson() => {'id': id, 'kind': kind, 'data': data, 'deleted': deleted, 'updated_at': updatedAt, 'base': base};
  static OutItem fromJson(Map<String, dynamic> j) => OutItem(id: '${j['id']}', kind: '${j['kind']}', data: Map<String, dynamic>.from(j['data'] as Map), deleted: j['deleted'] == true, updatedAt: '${j['updated_at']}', base: j['base'] as String?);
}

/// Where records, the unsent outbox and small settings live on the phone.
abstract class LocalStore {
  Future<List<Rec>> allRecs();
  Future<void> putRec(Rec r);
  Future<void> delRec(String id);
  Future<void> clearRecs();
  Future<List<OutItem>> outbox();
  Future<OutItem?> outItem(String id);
  Future<void> putOut(OutItem o);
  Future<void> delOut(String id);
  Future<void> clearOut();
  Future<String?> meta(String k);
  Future<void> setMeta(String k, String? v);
}

class MemoryStore implements LocalStore {
  final recs = <String, Rec>{};
  final out = <String, OutItem>{};
  final _meta = <String, String>{};
  @override
  Future<List<Rec>> allRecs() async => recs.values.toList();
  @override
  Future<void> putRec(Rec r) async => recs[r.id] = Rec.fromJson(jsonDecode(jsonEncode(r.toJson())) as Map<String, dynamic>);
  @override
  Future<void> delRec(String id) async => recs.remove(id);
  @override
  Future<void> clearRecs() async => recs.clear();
  @override
  Future<List<OutItem>> outbox() async => out.values.toList()..sort((a, b) => a.updatedAt.compareTo(b.updatedAt));
  @override
  Future<OutItem?> outItem(String id) async => out[id];
  @override
  Future<void> putOut(OutItem o) async => out[o.id] = o;
  @override
  Future<void> delOut(String id) async => out.remove(id);
  @override
  Future<void> clearOut() async => out.clear();
  @override
  Future<String?> meta(String k) async => _meta[k];
  @override
  Future<void> setMeta(String k, String? v) async => v == null ? _meta.remove(k) : _meta[k] = v;
}
