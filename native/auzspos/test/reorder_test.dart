import 'package:auzspos/core/reorder.dart';
import 'package:flutter_test/flutter_test.dart';
import 'sync_test.dart' show FakeServer, mk;

/// Category drag-order (menu/categories) was sorted alphabetically with no way to reorder at all before
/// this -- confirmed missing against the website's move() (app/public/console/p-menu.js). reorderRank is
/// the swap arithmetic that powers it, tested directly since it has no UI dependency.
void main() {
  test('reorderRank swaps the two neighbours\' rank, moving one place at a time', () async {
    final repo = mk(FakeServer());
    final a = await repo.save('cat', {'name': 'Tea', 'n': 0});
    final b = await repo.save('cat', {'name': 'Snacks', 'n': 1});
    final c = await repo.save('cat', {'name': 'Meals', 'n': 2});
    final ordered = repo.of('cat').toList()..sort((x, y) => ((x['n'] as num?) ?? 0).compareTo((y['n'] as num?) ?? 0));
    await reorderRank(repo, 'cat', ordered, repo.rec(b.id)!, -1); // move Snacks up, ahead of Tea
    final after = repo.of('cat').toList()..sort((x, y) => ((x['n'] as num?) ?? 0).compareTo((y['n'] as num?) ?? 0));
    expect(after.map((x) => x['name']), ['Snacks', 'Tea', 'Meals']);
    expect(repo.rec(a.id)!['n'], 1, reason: 'Tea took the slot Snacks vacated');
    expect(repo.rec(c.id)!['n'], 2, reason: 'Meals, untouched, keeps its rank');
  });

  test('reorderRank does nothing at either end of the list', () async {
    final repo = mk(FakeServer());
    await repo.save('cat', {'name': 'First', 'n': 0});
    final last = await repo.save('cat', {'name': 'Last', 'n': 1});
    final ordered = repo.of('cat').toList()..sort((x, y) => ((x['n'] as num?) ?? 0).compareTo((y['n'] as num?) ?? 0));
    await reorderRank(repo, 'cat', ordered, repo.rec(last.id)!, 1); // already last, moving further down is a no-op
    expect(repo.rec(last.id)!['n'], 1, reason: 'unchanged');
  });
}
