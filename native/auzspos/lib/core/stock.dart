// Stock movements triggered by a sale: recipe ingredients and retail variants. Ports of deduRecipe()/dedu()/
// deduVariant() in the website POS (app/public/pos/core.js) -- there is no database function, trigger or RPC
// for this on either platform; it is plain client-side record arithmetic applied through the same push_record
// path as every other write, so it inherits that path's upsert semantics but NOT any exactly-once guarantee
// against this logic itself running twice for the same sale (see the "known limitation" note on callers).
// Free functions over a Repo (not a Session/HomeState instance method) so this can be unit-tested directly,
// the same way the sync/outlet logic in repo.dart already is.
import 'billing.dart' show r2;
import 'repo.dart';

/// Reasons offered for a manual stock adjustment -- same list as adjustForm() in the website's
/// app/public/console/p-inventory.js. Kept here (not a free-text field) so every adjustment leaves
/// a consistent, reportable reason, same discipline as the existing wastage/void reason lists.
const List<String> adjustReasons = ['Count correction', 'Damaged / spoiled', 'Expired', 'Found later', 'Other'];

/// Whether a transfer of [q] units is allowed, given the CURRENT on-hand stock [liveQty] at the
/// moment of saving -- never a stale quantity captured when the transfer sheet was first opened,
/// since real stock can change in the meantime (a sale, another transfer, an adjustment) for reasons
/// that have nothing to do with a double-tap. Validating against a stale number would let a transfer
/// push real stock negative.
bool transferQtyOk(num? q, num liveQty) => q != null && q > 0 && q <= liveQty;

/// The raw material matching [name] (case-insensitive) that already exists at [outlet] ('main' when
/// absent, matching the website's own `(x.outlet||'main')` convention) -- the find-or-create lookup
/// transferForm() does before deciding whether to add to an existing destination record or start a
/// new one.
Map<String, dynamic>? ingAtOutlet(Iterable<Map<String, dynamic>> ings, String name, String outlet) {
  final want = name.trim().toLowerCase();
  for (final i in ings) {
    if ('${i['name'] ?? ''}'.trim().toLowerCase() == want && '${i['outlet'] ?? 'main'}' == outlet) return i;
  }
  return null;
}

/// Deduct ingredient stock for one item's recipe string (e.g. "Milk:200,Sugar:10"), scaled by [mult].
Future<void> deduRecipe(Repo repo, String recipe, num mult) async {
  for (final part in recipe.split(',')) {
    final bits = part.split(':');
    final n = bits.first.trim().toLowerCase();
    final q = bits.length > 1 ? num.tryParse(bits[1].trim()) : null;
    if (n.isEmpty || q == null || q == 0) continue;
    final g = repo.of('ing').where((x) => '${x['name']}'.toLowerCase() == n).firstOrNull;
    if (g == null) continue;
    final used = q * mult;
    final usage = ((g['usage'] as List?) ?? []).toList()..add({'q': used, 'd': nowIso().substring(0, 10), 'at': nowIso()});
    await repo.save('ing', {...g, 'qty': r2((g['qty'] as num? ?? 0) - used), 'usage': usage.length > 200 ? usage.sublist(usage.length - 200) : usage}, id: '${g['id']}');
  }
}

/// Deduct every line's recipe on a paid order. A combo item deducts each of its named component items' own
/// recipe, scaled by the combo's own quantity for that component times the line's qty -- matches the website's
/// own comboText parsing ("Name:qty,Name:qty").
Future<void> dedu(Repo repo, Map<String, dynamic> o) async {
  for (final l in (o['lines'] as List).cast<Map<String, dynamic>>()) {
    final it = repo.rec('${l['id']}');
    if (it == null) continue;
    final qty = (l['qty'] as num?) ?? 0;
    if (it['combo'] == true && '${it['comboText'] ?? ''}'.isNotEmpty) {
      for (final part in '${it['comboText']}'.split(',')) {
        final bits = part.split(':');
        final cn = bits.first.trim();
        if (cn.isEmpty) continue;
        final c = repo.of('item').where((x) => '${x['name']}'.toLowerCase() == cn.toLowerCase()).firstOrNull;
        final cq = bits.length > 1 ? (num.tryParse(bits[1].trim()) ?? 1) : 1;
        if (c != null && '${c['rec'] ?? ''}'.isNotEmpty) await deduRecipe(repo, '${c['rec']}', cq * qty);
      }
      continue;
    }
    if ('${it['rec'] ?? ''}'.isNotEmpty) await deduRecipe(repo, '${it['rec']}', qty);
  }
}

/// Deduct retail variant (size/colour) stock sold on this order.
Future<void> deduVariant(Repo repo, Map<String, dynamic> o) async {
  for (final l in (o['lines'] as List).cast<Map<String, dynamic>>()) {
    final it = repo.rec('${l['id']}');
    final variants = (it?['variants'] as List?)?.cast<Map>();
    final lv = l['variant'] as Map?;
    if (it == null || variants == null || variants.isEmpty || lv == null) continue;
    final idx = variants.indexWhere((x) => x['size'] == lv['size'] && (x['color'] ?? '') == (lv['color'] ?? ''));
    if (idx < 0) continue;
    final v = Map<String, dynamic>.from(variants[idx]);
    final qty = (l['qty'] as num?) ?? 0;
    final usage = ((v['usage'] as List?) ?? []).toList()..add({'q': qty, 'd': nowIso().substring(0, 10), 'at': nowIso()});
    v['qty'] = r2(((v['qty'] as num?) ?? 0) - qty);
    v['usage'] = usage.length > 200 ? usage.sublist(usage.length - 200) : usage;
    final newVariants = [...variants]..[idx] = v;
    await repo.save('item', {...it, 'variants': newVariants}, id: '${it['id']}');
  }
}
