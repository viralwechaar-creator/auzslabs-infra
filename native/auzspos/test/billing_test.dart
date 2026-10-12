import 'dart:convert';
import 'dart:io';
import 'package:auzspos/core/billing.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  // Every vector was produced by running the website's own tot() (tool/make_vectors.mjs).
  final vectors = (jsonDecode(File('test/billing_vectors.json').readAsStringSync()) as List).cast<Map<String, dynamic>>();
  for (final v in vectors) {
    test('bill matches the website: ${v['name']}', () {
      final records = <String, Map<String, dynamic>>{};
      for (final r in ((v['records'] as List?) ?? const []).cast<Map<String, dynamic>>()) {
        records[r['id']] = r;
      }
      final taxes = {for (final e in records.entries) if (e.value['kind'] == 'tax') e.key: e.value};
      final items = {for (final e in records.entries) if (e.value['kind'] == 'item') e.key: e.value};
      final offers = [for (final r in records.values) if (r['kind'] == 'offer') r];
      final t = tot(Map<String, dynamic>.from(v['order']), Map<String, dynamic>.from(v['cfg']), taxes: taxes, items: items, offerRecords: offers, today: '2026-10-12').toJson();
      final e = Map<String, dynamic>.from(v['expect']);
      for (final k in ['sub', 'd', 'tax', 'round', 'total', 'net', 'svc', 'pack', 'deliv', 'offer']) {
        expect((t[k] ?? 0) as num, closeTo((e[k] ?? 0) as num, 0.0001), reason: k);
      }
      final er = Map<String, dynamic>.from(e['rates']);
      final tr = Map<String, dynamic>.from(t['rates']);
      expect(tr.keys.toSet(), er.keys.toSet(), reason: 'tax rates present');
      for (final k in er.keys) {
        expect((tr[k]['base'] as num), closeTo(er[k]['base'] as num, 0.0001), reason: 'base at $k%');
        expect((tr[k]['tax'] as num), closeTo(er[k]['tax'] as num, 0.0001), reason: 'tax at $k%');
      }
    });
  }
}
