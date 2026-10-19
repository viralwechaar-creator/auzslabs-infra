import 'repo.dart';

/// Swaps two records' sort rank ('n') so the console list keeps a stable, owner-controlled order. Port of
/// move() in the website console (app/public/console/p-menu.js, used for category reordering). A free
/// function over a Repo (not a State instance method) so it is unit-testable directly, same pattern as
/// core/stock.dart.
Future<void> reorderRank(Repo repo, String kind, List<Map<String, dynamic>> ordered, Map<String, dynamic> c, int d) async {
  final i = ordered.indexWhere((x) => x['id'] == c['id']);
  final j = i + d;
  if (i < 0 || j < 0 || j >= ordered.length) return;
  final a = ordered[i], b = ordered[j];
  final an = (a['n'] as num?) ?? i, bn = (b['n'] as num?) ?? j;
  await repo.save(kind, {...a, 'n': bn == an ? bn + d : bn}, id: '${a['id']}');
  await repo.save(kind, {...b, 'n': an == bn ? an - d : an}, id: '${b['id']}');
}
