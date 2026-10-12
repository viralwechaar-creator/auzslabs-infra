import 'package:flutter/material.dart';
import '../core/billing.dart' show r2;
import '../core/repo.dart';
import '../core/session.dart';
import 'home.dart';
import 'theme.dart';

/// Manager approval (same rules as approve() in the website POS): an owner/manager signs for themselves, anyone else
/// types a manager's PIN, and the server returns a signed approval for this one action on this one record.
Future<Map<String, dynamic>?> approve(BuildContext context, Session s, String action, String ref, String detail) async {
  if (s.can('m')) {
    try {
      final d = await s.api.rpc('pos_sign_approval', {'p_action': action, 'p_ref': ref});
      if (d is Map && d['ok'] == true) return {'id': d['id'], 'name': d['name'], 'action': action, 'exp': d['exp'], 'token': d['token']};
    } catch (_) {}
    return {'id': s.user!['id'], 'name': '${s.user!['email'] ?? 'owner'}', 'action': action, 'self': true};
  }
  final pin = TextEditingController();
  String? err;
  bool busy = false;
  return showDialog<Map<String, dynamic>>(
    context: context,
    barrierDismissible: false,
    builder: (ctx) => StatefulBuilder(builder: (ctx, set) {
      return AlertDialog(
        title: const Text('Manager approval'),
        content: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(detail, style: const TextStyle(color: Tk.label2)),
          const SizedBox(height: 12),
          TextField(controller: pin, obscureText: true, keyboardType: TextInputType.number, maxLength: 8, autofocus: true, decoration: InputDecoration(labelText: 'Manager PIN', errorText: err)),
        ]),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
          FilledButton(
            onPressed: busy
                ? null
                : () async {
                    if (pin.text.length < 4) return set(() => err = 'Enter at least 4 digits');
                    set(() {
                      busy = true;
                      err = null;
                    });
                    try {
                      final d = await s.api.rpc('pos_verify_pin', {'p_pin': pin.text, 'p_action': action, 'p_ref': ref});
                      if (d is Map && d['ok'] == true) return Navigator.pop(ctx, {'id': d['id'], 'name': d['name'], 'action': action, 'exp': d['exp'], 'token': d['token']});
                      set(() => err = 'That PIN is not right');
                    } catch (e) {
                      set(() => err = '$e');
                    }
                    set(() => busy = false);
                  },
            child: const Text('Approve'),
          ),
        ],
      );
    }),
  );
}

Future<String?> pickReason(BuildContext context, Session s, String title) async {
  final reasons = [for (final r in s.repo!.of('reason')) '${r['name']}'].where((e) => e.isNotEmpty && e != 'null').toList();
  final other = TextEditingController();
  return showModalBottomSheet<String>(
    context: context,
    isScrollControlled: true,
    builder: (ctx) => SafeArea(
      child: Padding(
        padding: EdgeInsets.fromLTRB(16, 16, 16, 16 + MediaQuery.of(ctx).viewInsets.bottom),
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text(title, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
          const SizedBox(height: 8),
          for (final r in reasons) ListTile(dense: true, title: Text(r), onTap: () => Navigator.pop(ctx, r)),
          TextField(controller: other, decoration: const InputDecoration(labelText: 'Other reason')),
          const SizedBox(height: 8),
          FilledButton(onPressed: () => other.text.trim().isEmpty ? null : Navigator.pop(ctx, other.text.trim()), child: const Text('Use this reason')),
        ]),
      ),
    ),
  );
}

Future<bool> confirm(BuildContext context, String title, String msg, String yes) async =>
    (await showDialog<bool>(context: context, builder: (c) => AlertDialog(title: Text(title), content: Text(msg), actions: [TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('Back')), FilledButton(onPressed: () => Navigator.pop(c, true), child: Text(yes))]))) ?? false;

/// Manual discount: a cashier may give up to Settings > maxDiscountPct without a manager (0 = every discount needs one).
bool discNeedsManager(Session s, Map<String, dynamic> o, num v, String kind) {
  if (s.can('m')) return false;
  final lim = (s.cfg['maxDiscountPct'] ?? 0) as num;
  final sub = s.tot(o).sub;
  final pct = kind == '%' ? v : (sub > 0 ? 100 * v / sub : 100);
  return !(lim > 0 && pct <= lim + 0.001);
}

Future<void> discountSheet(BuildContext context, Session s, Map<String, dynamic> o, VoidCallback changed) async {
  if (o['complimentary'] == true) return compSheet(context, s, o, changed);
  var kind = (o['disc'] is Map && o['disc']['src'] == 'manual') ? '${o['disc']['t']}' : '%';
  final val = TextEditingController(text: (o['disc'] is Map && o['disc']['src'] == 'manual') ? '${o['disc']['v']}' : '');
  final why = TextEditingController(text: (o['disc'] is Map ? o['disc']['reason'] : null) ?? '');
  final lim = (s.cfg['maxDiscountPct'] ?? 0) as num;
  await showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    builder: (ctx) => StatefulBuilder(builder: (ctx, set) {
      return SafeArea(
        child: Padding(
          padding: EdgeInsets.fromLTRB(16, 16, 16, 16 + MediaQuery.of(ctx).viewInsets.bottom),
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            const Text('Discount', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
            const SizedBox(height: 12),
            SegmentedButton<String>(segments: const [ButtonSegment(value: '%', label: Text('Percent')), ButtonSegment(value: '₹', label: Text('Amount'))], selected: {kind}, onSelectionChanged: (v) => set(() => kind = v.first)),
            const SizedBox(height: 12),
            TextField(controller: val, keyboardType: const TextInputType.numberWithOptions(decimal: true), autofocus: true, decoration: InputDecoration(labelText: kind == '%' ? 'Discount %' : 'Discount ₹')),
            const SizedBox(height: 8),
            Wrap(spacing: 8, children: [for (final v in kind == '%' ? [5, 10, 15, 20, 25] : [50, 100, 200, 500]) ActionChip(label: Text(kind == '%' ? '$v%' : '₹$v'), onPressed: () => val.text = '$v')]),
            const SizedBox(height: 8),
            TextField(controller: why, decoration: const InputDecoration(labelText: 'Reason (optional)')),
            if (!s.can('m')) Padding(padding: const EdgeInsets.only(top: 8), child: Text(lim > 0 ? 'Up to $lim% without a manager.' : 'A manager approves discounts.', style: const TextStyle(color: Tk.label2))),
            const SizedBox(height: 12),
            Row(children: [
              if (o['disc'] != null)
                Expanded(child: OutlinedButton(onPressed: () { o['disc'] = null; o['coupon'] = null; o['loyaltyRedeemed'] = 0; Navigator.pop(ctx); changed(); }, child: const Text('Remove'))),
              if (o['disc'] != null) const SizedBox(width: 8),
              Expanded(
                child: FilledButton(
                  onPressed: () async {
                    final v = double.tryParse(val.text) ?? 0;
                    if (v <= 0) return;
                    if (kind == '%' && v > 100) return;
                    Map<String, dynamic>? ap;
                    if (discNeedsManager(s, o, v, kind)) {
                      ap = await approve(ctx, s, 'discount', '${o['id']}', '${kind == '%' ? '$v%' : '₹$v'} off ₹${s.tot(o).sub}');
                      if (ap == null) return;
                    }
                    o['disc'] = {'t': kind, 'v': v, 'src': 'manual', if (why.text.trim().isNotEmpty) 'reason': why.text.trim(), 'by': s.user!['id'], if (ap != null) 'approvedBy': ap};
                    o['coupon'] = null;
                    o['loyaltyRedeemed'] = 0;
                    if (ctx.mounted) Navigator.pop(ctx);
                    changed();
                  },
                  child: const Text('Apply'),
                ),
              ),
            ]),
          ]),
        ),
      );
    }),
  );
}

Future<void> couponSheet(BuildContext context, Session s, Map<String, dynamic> o, VoidCallback changed) async {
  final code = TextEditingController(text: '${o['coupon'] ?? ''}');
  String? err;
  await showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    builder: (ctx) => StatefulBuilder(builder: (ctx, set) {
      return SafeArea(
        child: Padding(
          padding: EdgeInsets.fromLTRB(16, 16, 16, 16 + MediaQuery.of(ctx).viewInsets.bottom),
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            const Text('Coupon', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
            const SizedBox(height: 12),
            TextField(controller: code, textCapitalization: TextCapitalization.characters, autofocus: true, decoration: InputDecoration(labelText: 'Coupon code', errorText: err)),
            const SizedBox(height: 12),
            Row(children: [
              if (o['coupon'] != null) Expanded(child: OutlinedButton(onPressed: () { o['coupon'] = null; o['disc'] = null; Navigator.pop(ctx); changed(); }, child: const Text('Remove'))),
              if (o['coupon'] != null) const SizedBox(width: 8),
              Expanded(
                child: FilledButton(
                  onPressed: () {
                    final c = s.repo!.of('coupon').where((x) => '${x['code'] ?? ''}'.toUpperCase() == code.text.trim().toUpperCase()).firstOrNull;
                    final d = DateTime.now();
                    final today = '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
                    if (c == null) return set(() => err = 'No coupon with that code');
                    if (c['expiry'] != null && '${c['expiry']}'.isNotEmpty && '${c['expiry']}'.compareTo(today) < 0) return set(() => err = 'This coupon has expired');
                    if (c['maxUses'] != null && (c['maxUses'] as num) > 0) {
                      final used = s.repo!.of('order').where((x) => (x['status'] == 'paid' || x['status'] == 'due') && x['coupon'] == c['code'] && x['id'] != o['id']).length;
                      if (used >= (c['maxUses'] as num)) return set(() => err = 'This coupon has been used up');
                    }
                    if (c['minBill'] != null && s.tot(o).sub < (c['minBill'] as num)) return set(() => err = 'Needs a bill of at least ₹${c['minBill']}');
                    o['coupon'] = c['code'];
                    o['disc'] = {'t': c['type'], 'v': c['value'], 'src': 'coupon'};
                    o['loyaltyRedeemed'] = 0;
                    o['complimentary'] = false;
                    Navigator.pop(ctx);
                    changed();
                  },
                  child: const Text('Apply'),
                ),
              ),
            ]),
          ]),
        ),
      );
    }),
  );
}

Future<void> compSheet(BuildContext context, Session s, Map<String, dynamic> o, VoidCallback changed) async {
  if (o['complimentary'] == true) {
    if (await confirm(context, 'Remove complimentary?', 'The bill goes back to its normal amount.', 'Remove')) {
      o['complimentary'] = false;
      o['compReason'] = null;
      o['compApprovedBy'] = null;
      changed();
    }
    return;
  }
  final reason = await pickReason(context, s, 'Why is this bill complimentary?');
  if (reason == null || !context.mounted) return;
  final ap = await approve(context, s, 'comp', '${o['id']}', 'Complimentary bill of ₹${s.tot(o).sub}');
  if (ap == null) return;
  o['complimentary'] = true;
  o['compReason'] = reason;
  o['compApprovedBy'] = ap;
  o['disc'] = null;
  o['coupon'] = null;
  o['loyaltyRedeemed'] = 0;
  changed();
}

Future<void> customerSheet(BuildContext context, Map<String, dynamic> o, VoidCallback changed) async {
  final cust = Map<String, dynamic>.from((o['cust'] as Map?) ?? {});
  final name = TextEditingController(text: '${cust['name'] ?? ''}'), phone = TextEditingController(text: '${cust['phone'] ?? ''}'), note = TextEditingController(text: '${o['note'] ?? ''}');
  await showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    builder: (ctx) => SafeArea(
      child: Padding(
        padding: EdgeInsets.fromLTRB(16, 16, 16, 16 + MediaQuery.of(ctx).viewInsets.bottom),
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          const Text('Customer and note', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
          const SizedBox(height: 12),
          TextField(controller: name, textCapitalization: TextCapitalization.words, decoration: const InputDecoration(labelText: 'Name')),
          const SizedBox(height: 10),
          TextField(controller: phone, keyboardType: TextInputType.phone, decoration: const InputDecoration(labelText: 'Phone')),
          const SizedBox(height: 10),
          TextField(controller: note, decoration: const InputDecoration(labelText: 'Note for this order')),
          const SizedBox(height: 12),
          FilledButton(
            onPressed: () {
              o['cust'] = {'name': name.text.trim(), 'phone': phone.text.trim()};
              o['note'] = note.text.trim().isEmpty ? null : note.text.trim();
              Navigator.pop(ctx);
              changed();
            },
            child: const Text('Save'),
          ),
        ]),
      ),
    ),
  );
}

/// Cancel an order that is not paid. Items already sent to the kitchen need a manager's approval.
Future<bool> cancelOrder(BuildContext context, HomeState h, Map<String, dynamic> o) async {
  final s = h.s;
  final saved = s.repo!.rec('${o['id']}');
  if (saved == null) return true; // nothing was ever saved
  final sent = ((saved['lines'] as List?) ?? []).any((l) => ((l as Map)['sent'] ?? 0) > 0);
  if (!await confirm(context, 'Cancel order ${o['no']}?', sent ? 'The kitchen already has items from it. They will be logged as cancelled.' : 'It will be marked as cancelled.', 'Cancel order')) return false;
  if (!context.mounted) return false;
  final reason = await pickReason(context, s, 'Why cancel this order?');
  if (reason == null || !context.mounted) return false;
  Map<String, dynamic>? ap;
  if (sent) {
    ap = await approve(context, s, 'void', '${o['id']}', 'Cancel order ${o['no']} after it reached the kitchen');
    if (ap == null) return false;
  }
  final c = Map<String, dynamic>.from(saved);
  c['status'] = 'void';
  c['voidReason'] = reason;
  if (ap != null) c['voidApprovedBy'] = ap;
  c['voidAt'] = nowIso();
  await s.repo!.save('order', c, id: '${o['id']}');
  await s.repo!.save('voidlog', {'order': o['id'], 'no': o['no'], 'reason': reason, 'by': s.user!['email'] ?? s.user!['id'], 'approvedBy': ap?['name'], 'at': nowIso()});
  if (sent && c['table'] != null) {
    final t = s.repo!.rec('${c['table']}');
    if (t != null) await s.repo!.save('table', {...t, 'cleaned': false}, id: '${c['table']}');
  }
  s.sync();
  return true;
}

/// A paid bill: view, refund, cancel.
Future<void> billSheet(BuildContext context, HomeState h, Map<String, dynamic> o) async {
  await showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    builder: (ctx) {
      final t = (o['t'] as Map?) ?? {};
      final refunds = ((o['refunds'] as List?) ?? []).cast<Map>();
      final refunded = refunds.fold<num>(0, (a, r) => a + ((r['amt'] ?? 0) as num));
      final void_ = o['status'] == 'void';
      final lines = ((o['lines'] as List?) ?? []).cast<Map>();
      return SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(16),
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Text('${o['no']} · ${o['type']}', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
            Text(void_ ? 'Cancelled${o['voidReason'] != null ? ' · ${o['voidReason']}' : ''}' : 'Paid ${(o['pays'] as List?)?.map((p) => (p as Map)['m']).join(', ') ?? ''}', style: const TextStyle(color: Tk.label2)),
            const Divider(),
            for (final l in lines) Padding(padding: const EdgeInsets.symmetric(vertical: 2), child: Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [Expanded(child: Text('${l['qty']} × ${l['name']}${(l['size'] ?? '') != '' ? ' (${l['size']})' : ''}')), Text(inr((l['price'] as num) * (l['qty'] as num)))])),
            const Divider(),
            Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [const Text('Total', style: TextStyle(fontWeight: FontWeight.w800)), Text(inr((t['total'] ?? 0) as num), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 18))]),
            if (refunded > 0) Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [const Text('Refunded'), Text('−${inr(refunded)}')]),
            if (!void_) ...[
              const SizedBox(height: 12),
              Row(children: [
                Expanded(child: OutlinedButton(onPressed: () { Navigator.pop(ctx); refundSheet(context, h, o); }, child: const Text('Refund'))),
                const SizedBox(width: 8),
                Expanded(child: OutlinedButton(onPressed: () async { Navigator.pop(ctx); await voidPaid(context, h, o); }, child: const Text('Cancel bill'))),
              ]),
            ],
          ]),
        ),
      );
    },
  );
}

Future<void> refundSheet(BuildContext context, HomeState h, Map<String, dynamic> o) async {
  final s = h.s;
  final total = (((o['t'] as Map?)?['total']) ?? 0) as num;
  final done = ((o['refunds'] as List?) ?? []).fold<num>(0, (a, r) => a + ((r as Map)['amt'] ?? 0));
  final max = r2(total - done);
  if (max <= 0) return h.toast('This bill has already been refunded in full');
  final amt = TextEditingController(text: '$max');
  var mode = (((o['pays'] as List?)?.firstOrNull as Map?)?['m'] ?? 'cash') == 'giftcard' ? 'cash' : '${((o['pays'] as List?)?.firstOrNull as Map?)?['m'] ?? 'cash'}';
  await showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    builder: (ctx) => StatefulBuilder(builder: (ctx, set) {
      return SafeArea(
        child: Padding(
          padding: EdgeInsets.fromLTRB(16, 16, 16, 16 + MediaQuery.of(ctx).viewInsets.bottom),
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Text('Refund · ${o['no']}', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
            const SizedBox(height: 12),
            TextField(controller: amt, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: InputDecoration(labelText: 'Amount (up to ${inr(max)})')),
            const SizedBox(height: 12),
            SegmentedButton<String>(segments: const [ButtonSegment(value: 'cash', label: Text('Cash')), ButtonSegment(value: 'upi', label: Text('UPI')), ButtonSegment(value: 'card', label: Text('Card')), ButtonSegment(value: 'other', label: Text('Other'))], selected: {mode}, onSelectionChanged: (v) => set(() => mode = v.first)),
            const SizedBox(height: 6),
            const Text('Refunds are added to the bill; the original payment is never changed.', style: TextStyle(color: Tk.label2, fontSize: 12)),
            const SizedBox(height: 12),
            FilledButton(
              onPressed: () async {
                final v = r2(double.tryParse(amt.text) ?? 0);
                if (v <= 0 || v > max) return;
                final reason = await pickReason(ctx, s, 'Why refund?');
                if (reason == null || !ctx.mounted) return;
                final ap = await approve(ctx, s, 'refund', '${o['id']}', 'Refund ${inr(v)} on ${o['no']}');
                if (ap == null) return;
                final c = Map<String, dynamic>.from(s.repo!.rec('${o['id']}') ?? o);
                c['refunds'] = [...((c['refunds'] as List?) ?? []), {'amt': v, 'm': mode, 'reason': reason, 'by': s.user!['email'] ?? s.user!['id'], 'at': nowIso(), 'approvedBy': ap}];
                await s.repo!.save('order', c, id: '${o['id']}');
                s.sync();
                if (ctx.mounted) Navigator.pop(ctx);
                h.toast('Refunded ${inr(v)}');
              },
              child: const Text('Refund'),
            ),
          ]),
        ),
      );
    }),
  );
}

Future<void> voidPaid(BuildContext context, HomeState h, Map<String, dynamic> o) async {
  final s = h.s;
  if (!await confirm(context, 'Cancel bill ${o['no']}?', 'The bill stays on record, marked cancelled. Refund any money separately.', 'Cancel bill')) return;
  if (!context.mounted) return;
  final reason = await pickReason(context, s, 'Why cancel this bill?');
  if (reason == null || !context.mounted) return;
  final total = (((o['t'] as Map?)?['total']) ?? 0) as num;
  final ap = await approve(context, s, 'void', '${o['id']}', 'Cancel paid bill ${o['no']} (${inr(total)})');
  if (ap == null) return;
  final c = Map<String, dynamic>.from(s.repo!.rec('${o['id']}') ?? o);
  c['status'] = 'void';
  c['voidReason'] = reason;
  c['voidApprovedBy'] = ap;
  c['voidAt'] = nowIso();
  await s.repo!.save('order', c, id: '${o['id']}');
  await s.repo!.save('voidlog', {'order': o['id'], 'no': o['no'], 'reason': reason, 'by': s.user!['email'] ?? s.user!['id'], 'approvedBy': ap['name'], 'at': nowIso()});
  s.sync();
  h.toast('Bill cancelled');
}

/// Move some items to a new bill (same rule as splitSheet in the website POS: sent quantities travel with the items and the move is logged).
Future<void> splitSheet(BuildContext context, HomeState h, Map<String, dynamic> o) async {
  final s = h.s;
  final lines = (o['lines'] as List).cast<Map<String, dynamic>>();
  if (lines.isEmpty) return;
  if (s.repo!.rec('${o['id']}') == null) await h.persist(o);
  final pick = <int, int>{};
  await showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    builder: (ctx) => StatefulBuilder(builder: (ctx, set) {
      var sum = 0.0;
      for (final e in pick.entries) {
        sum += e.value * (lines[e.key]['price'] as num);
      }
      return SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            const Text('Split bill', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
            const Text('Choose what goes on the new bill.', style: TextStyle(color: Tk.label2)),
            Flexible(
              child: ListView(shrinkWrap: true, children: [
                for (var i = 0; i < lines.length; i++)
                  ListTile(
                    dense: true,
                    title: Text('${lines[i]['name']}${(lines[i]['size'] ?? '') != '' ? ' (${lines[i]['size']})' : ''}'),
                    subtitle: Text('${inr(lines[i]['price'] as num)} each · ${lines[i]['qty']} on the bill'),
                    trailing: Row(mainAxisSize: MainAxisSize.min, children: [
                      IconButton(icon: const Icon(Icons.remove_circle_outline), onPressed: () => set(() => pick[i] = ((pick[i] ?? 0) - 1).clamp(0, (lines[i]['qty'] as num).toInt()))),
                      Text('${pick[i] ?? 0}', style: const TextStyle(fontWeight: FontWeight.w700)),
                      IconButton(icon: const Icon(Icons.add_circle_outline), onPressed: () => set(() => pick[i] = ((pick[i] ?? 0) + 1).clamp(0, (lines[i]['qty'] as num).toInt()))),
                    ]),
                  ),
              ]),
            ),
            Padding(padding: const EdgeInsets.symmetric(vertical: 8), child: Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [const Text('New bill subtotal'), Text(inr(sum), style: const TextStyle(fontWeight: FontWeight.w800))])),
            FilledButton(
              onPressed: () async {
                final moving = [for (final e in pick.entries) if (e.value > 0) e];
                if (moving.isEmpty) return;
                if (moving.length == lines.length && moving.every((e) => e.value >= (lines[e.key]['qty'] as num))) {
                  h.toast('Leave something on this bill, or move the whole table instead');
                  return;
                }
                final n = h.newOrder(type: '${o['type']}', table: o['table'] as String?);
                n['cust'] = Map<String, dynamic>.from((o['cust'] as Map?) ?? {});
                n['kfrom'] = o['id'];
                n['splitFrom'] = o['no'];
                n['no'] = await s.nextNo();
                final moved = <Map<String, dynamic>>[];
                for (final e in moving) {
                  final l = lines[e.key];
                  final q = e.value;
                  final sentMove = ((l['sent'] ?? 0) as num).toInt().clamp(0, q);
                  moved.add({'q': sentMove, 'name': l['name'], 'qty': q});
                  (n['lines'] as List).add({...l, 'qty': q, 'sent': sentMove});
                  l['qty'] = (l['qty'] as num) - q;
                  l['sent'] = ((l['sent'] ?? 0) as num) - sentMove;
                }
                o['lines'] = lines.where((l) => (l['qty'] as num) > 0).toList();
                o['moves'] = [...((o['moves'] as List?) ?? []), {'at': nowIso(), 'to': n['id'], 'toNo': n['no'], 'items': moved}];
                await h.persist(n);
                await h.persist(o);
                if (ctx.mounted) Navigator.pop(ctx);
                h.refresh(() => h.cur = n);
                h.toast('Split to ${n['no']}');
              },
              child: const Text('Split'),
            ),
          ]),
        ),
      );
    }),
  );
}
