import 'dart:async';
import 'package:flutter/material.dart' hide Text;
import 'i18n.dart';
import '../core/billing.dart' show r2;
import '../core/customer.dart';
import '../core/linekey.dart';
import '../core/repo.dart';
import '../core/session.dart';
import 'home.dart';
import 'receipt.dart';
import 'theme.dart';
import 'ds.dart';

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
          Text(detail, style: TextStyle(color: Tk.label2)),
          const SizedBox(height: 12),
          TextField(controller: pin, obscureText: true, keyboardType: TextInputType.number, maxLength: 8, autofocus: true, decoration: InputDecoration(labelText: tr('Manager PIN'), errorText: err)),
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
          TextField(controller: other, decoration: InputDecoration(labelText: tr('Other reason'))),
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
            TextField(controller: why, decoration: InputDecoration(labelText: tr('Reason (optional)'))),
            if (!s.can('m')) Padding(padding: const EdgeInsets.only(top: 8), child: Text(lim > 0 ? 'Up to $lim% without a manager.' : 'A manager approves discounts.', style: TextStyle(color: Tk.label2))),
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
            TextField(controller: code, textCapitalization: TextCapitalization.characters, autofocus: true, decoration: InputDecoration(labelText: tr('Coupon code'), errorText: err)),
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

/// Customer + note on the bill, with the same CRM fields and loyalty-history preview as
/// customerSheet() in the website's pos/sell.js: a GSTIN for business bills, email, birthday,
/// anniversary, tags, a favourite-guest switch and a no-marketing-messages opt-out -- persisted as a
/// `customer` record keyed by the phone's digits (universal-write kind, db/068_pos_rebuild.sql), the
/// exact same record the website/console's CRM screens read.
Future<void> customerSheet(BuildContext context, Session s, Map<String, dynamic> o, VoidCallback changed) async {
  final cust = Map<String, dynamic>.from((o['cust'] as Map?) ?? {});
  final ph0 = digitsOnly('${cust['phone'] ?? ''}');
  final prof = ph0.length >= 10 ? s.repo!.rec(ph0) : null;
  final name = TextEditingController(text: '${cust['name'] ?? prof?['name'] ?? ''}');
  final phone = TextEditingController(text: '${cust['phone'] ?? ''}');
  final note = TextEditingController(text: '${o['note'] ?? ''}');
  final gst = TextEditingController(text: '${cust['gst'] ?? prof?['gst'] ?? ''}');
  final email = TextEditingController(text: '${prof?['email'] ?? ''}');
  final dob = TextEditingController(text: '${prof?['dob'] ?? ''}');
  final ann = TextEditingController(text: '${prof?['anniversary'] ?? ''}');
  final tags = TextEditingController(text: ((prof?['tags'] as List?) ?? const []).join(', '));
  var fav = prof?['favorite'] == true;
  var optOut = prof?['optOut'] == true;
  await showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    builder: (ctx) => StatefulBuilder(builder: (ctx, set) {
      final hist = digitsOnly(phone.text).length >= 10 ? loyaltySummary(s.repo!.of('order'), phone.text, '${o['id']}', earnPerRs: (s.cfg['loyaltyEarnRs'] as num?) ?? 100) : null;
      return SafeArea(
        child: Padding(
          padding: EdgeInsets.fromLTRB(16, 16, 16, 16 + MediaQuery.of(ctx).viewInsets.bottom),
          child: SingleChildScrollView(
            child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              const Text('Customer', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
              if (hist != null && hist.visits > 0) ...[
                const SizedBox(height: 10),
                Row(children: [
                  Expanded(child: _kpi('${hist.visits}', 'Visits')),
                  Expanded(child: _kpi(inr(hist.lifetime), 'Spent')),
                  Expanded(child: _kpi('${hist.points}', 'Points')),
                ]),
              ],
              const SizedBox(height: 12),
              TextField(controller: name, textCapitalization: TextCapitalization.words, decoration: InputDecoration(labelText: tr('Name'))),
              const SizedBox(height: 10),
              TextField(controller: phone, keyboardType: TextInputType.phone, decoration: InputDecoration(labelText: tr('Phone')), onChanged: (_) => set(() {})),
              const SizedBox(height: 10),
              TextField(controller: gst, textCapitalization: TextCapitalization.characters, maxLength: 15, decoration: const InputDecoration(labelText: '15-character GSTIN (business bills)')),
              const SizedBox(height: 10),
              Row(children: [
                Expanded(child: TextField(controller: email, keyboardType: TextInputType.emailAddress, decoration: InputDecoration(labelText: tr('Email')))),
                const SizedBox(width: 10),
                Expanded(child: TextField(controller: tags, decoration: const InputDecoration(labelText: 'Tags (Regular, VIP)'))),
              ]),
              const SizedBox(height: 10),
              Row(children: [
                Expanded(child: TextField(controller: dob, keyboardType: TextInputType.datetime, decoration: const InputDecoration(labelText: 'Birthday (YYYY-MM-DD)'))),
                const SizedBox(width: 10),
                Expanded(child: TextField(controller: ann, keyboardType: TextInputType.datetime, decoration: const InputDecoration(labelText: 'Anniversary (YYYY-MM-DD)'))),
              ]),
              SwitchListTile(contentPadding: EdgeInsets.zero, title: const Text('Favourite guest'), value: fav, onChanged: (v) => set(() => fav = v)),
              SwitchListTile(contentPadding: EdgeInsets.zero, title: const Text('No marketing messages'), value: optOut, onChanged: (v) => set(() => optOut = v)),
              const Divider(height: 24),
              TextField(controller: note, decoration: InputDecoration(labelText: tr('Note for this order'))),
              const SizedBox(height: 12),
              FilledButton(
                onPressed: () {
                  final gstVal = gst.text.trim().toUpperCase();
                  if (gstVal.isNotEmpty && !isValidGstin(gstVal)) {
                    ScaffoldMessenger.of(ctx).showSnackBar(const SnackBar(content: Text('A GSTIN has 15 characters, starting with the 2-digit state code')));
                    return;
                  }
                  o['cust'] = {'name': name.text.trim(), 'phone': phone.text.trim(), if (gstVal.isNotEmpty) 'gst': gstVal};
                  o['note'] = note.text.trim().isEmpty ? null : note.text.trim();
                  final p = digitsOnly(phone.text);
                  if (p.length >= 10) {
                    unawaited(s.repo!.save('customer', {
                      ...?prof,
                      'phone': p,
                      'name': name.text.trim().isEmpty ? (prof?['name']) : name.text.trim(),
                      'gst': gstVal.isEmpty ? null : gstVal,
                      'email': email.text.trim(),
                      'dob': dob.text.trim().isEmpty ? null : dob.text.trim(),
                      'anniversary': ann.text.trim().isEmpty ? null : ann.text.trim(),
                      'tags': tags.text.split(',').map((x) => x.trim()).where((x) => x.isNotEmpty).toList(),
                      'optOut': optOut,
                      'favorite': fav,
                    }, id: p));
                  }
                  Navigator.pop(ctx);
                  changed();
                },
                child: const Text('Save'),
              ),
            ]),
          ),
        ),
      );
    }),
  );
}

Widget _kpi(String value, String label) => Column(children: [
      Text(value, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
      Text(label, style: TextStyle(fontSize: 12, color: Tk.label2)),
    ]);

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
/// Order detail sheet (open or paid), laid out like the website POS: number + Done, status pills, created, items, totals, actions, one big button.
Future<void> orderSheet(BuildContext context, HomeState h, Map<String, dynamic> o) async {
  await showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    builder: (ctx) {
      final t = ((o['t'] as Map?) ?? h.s.tot(o).toJson());
      final refunds = ((o['refunds'] as List?) ?? []).cast<Map>();
      final refunded = refunds.fold<num>(0, (a, r) => a + ((r['amt'] ?? 0) as num));
      final st = '${o['status']}';
      final voided = st == 'void';
      final isOpen = st == 'open';
      final lines = ((o['lines'] as List?) ?? []).cast<Map>();
      final created = DateTime.tryParse('${o['created']}')?.toLocal();
      const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      String two(int n) => n.toString().padLeft(2, '0');
      final when = created == null ? '' : '${created.day} ${mon[created.month - 1]} ${created.year}, ${created.hour % 12 == 0 ? 12 : created.hour % 12}:${two(created.minute)} ${created.hour >= 12 ? 'PM' : 'AM'}';
      Widget pill(String l, Color bg, Color fg) => Container(padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8), decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(20)), child: Text(l, style: TextStyle(fontSize: 17, fontWeight: FontWeight.w700, color: fg)));
      Widget kv(String k, String v, {bool bold = false}) => Padding(padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 16), child: Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [Text(k, style: TextStyle(fontSize: bold ? 22 : 20, fontWeight: bold ? FontWeight.w800 : FontWeight.w500)), Text(v, style: TextStyle(fontSize: bold ? 24 : 20, fontWeight: bold ? FontWeight.w800 : FontWeight.w600))]));
      final tb = o['table'] == null ? '' : ' · ${h.s.repo!.rec('${o['table']}')?['name'] ?? ''}';
      final kst = o['kstat'];
      return SafeArea(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Padding(padding: const EdgeInsets.fromLTRB(20, 0, 8, 6), child: Row(children: [
            Expanded(child: Text('${o['no'] ?? 'New order'}', style: const TextStyle(fontSize: 26, fontWeight: FontWeight.w800, letterSpacing: -.4))),
            TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Done', style: TextStyle(fontSize: 20))),
          ])),
          const Divider(),
          Flexible(
            child: ListView(padding: const EdgeInsets.only(bottom: 12, top: 14), children: [
              Padding(padding: const EdgeInsets.symmetric(horizontal: 16), child: Wrap(spacing: 10, runSpacing: 8, children: [
                pill(isOpen ? 'Open' : voided ? 'Cancelled' : 'Paid', isOpen ? Tk.orangeBg : voided ? Tk.redBg : Tk.greenBg, isOpen ? Tk.orange : voided ? Tk.red : Tk.green),
                pill('${o['type']}$tb', Tk.fill, Tk.label),
                if (kst != null) pill(kst == 'new' ? 'In kitchen' : kst == 'ready' ? 'Ready' : kst == 'delivered' ? 'Delivered' : '$kst', Tk.orangeBg, Tk.orange),
              ])),
              const SizedBox(height: 14),
              Group([kv('Created', when)]),
              const SizedBox(height: 14),
              Group([for (final l in lines) kv('${l['qty']} × ${l['name']}${(l['size'] ?? '') != '' ? ' (${l['size']})' : ''}', inr((l['price'] as num) * (l['qty'] as num)))]),
              const SizedBox(height: 14),
              Group([
                kv('Subtotal', inr((t['sub'] ?? 0) as num)),
                if (((t['d'] ?? 0) as num) > 0) kv('Discount', '−${inr((t['d']) as num)}'),
                if (((t['svc'] ?? 0) as num) > 0) kv('Service charge', inr((t['svc']) as num)),
                if (((t['tax'] ?? 0) as num) > 0) kv('GST', inr((t['tax']) as num)),
                if (((t['round'] ?? 0) as num) != 0) kv('Round off', inr((t['round']) as num)),
                kv('Total', inr((t['total'] ?? 0) as num), bold: true),
                if (refunded > 0) kv('Refunded', '−${inr(refunded)}'),
              ]),
              const SizedBox(height: 14),
              Group([
                Li(isOpen ? 'Print bill for the guest' : 'WhatsApp the bill', sub: isOpen ? 'Provisional' : null, icon: isOpen ? Icons.print_outlined : Icons.chat_outlined, tone: isOpen ? Tk.label3.withValues(alpha: .9) : Tk.green, onTap: () => isOpen ? printReceipt(h.s, o) : sendWhatsApp(context, h.s, o)),
                if (!isOpen && !voided) Li('Print bill', icon: Icons.print_outlined, onTap: () => printReceipt(h.s, o)),
                if (isOpen && kst != null) Li('Reprint kitchen ticket', icon: Icons.receipt_outlined, tone: const Color(0xFFF09A2E), onTap: () => h.toast('Kitchen tickets print from the Kitchen tab')),
                if (!isOpen && !voided) Li('Refund', icon: Icons.undo, tone: Tk.orange, onTap: () { Navigator.pop(ctx); refundSheet(context, h, o); }),
                if (!isOpen && !voided) Li('Cancel bill', icon: Icons.cancel_outlined, tone: Tk.red, titleColor: Tk.red, onTap: () async { Navigator.pop(ctx); await voidPaid(context, h, o); }),
              ]),
              if (voided) Padding(padding: const EdgeInsets.all(18), child: Text('Cancelled${o['voidReason'] != null ? ' · ${o['voidReason']}' : ''}', style: TextStyle(color: Tk.label2, fontSize: 17))),
            ]),
          ),
          if (isOpen) Container(
            decoration: BoxDecoration(color: Tk.card2, border: Border(top: BorderSide(color: Tk.line, width: .5))),
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
            child: FilledButton(style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(60), shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20))), onPressed: () { Navigator.pop(ctx); h.openOrder(o); }, child: const Text('Open order', style: TextStyle(fontSize: 22))),
          ),
        ]),
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
            Text('Refunds are added to the bill; the original payment is never changed.', style: TextStyle(color: Tk.label2, fontSize: 12)),
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

/// The existing open order at [tableId], if any (same lookup as floor.dart's tableState()'s .o,
/// duplicated here as a one-line query rather than importing floor.dart just for this).
Map<String, dynamic>? _openOrderAt(Session s, String tableId) =>
    s.repo!.of('order').where((x) => x['status'] == 'open' && x['table'] == tableId && ((x['lines'] as List?)?.isNotEmpty ?? false)).firstOrNull;

/// Move some items to a new bill, a different table's bill (merging into it if one is already open
/// there), or a takeaway -- same three destinations as splitSheet() in the website's tables.js.
/// Sent quantities travel with the items and the move is logged either way.
Future<void> splitSheet(BuildContext context, HomeState h, Map<String, dynamic> o) async {
  final s = h.s;
  final lines = (o['lines'] as List).cast<Map<String, dynamic>>();
  if (lines.isEmpty) return;
  if (s.repo!.rec('${o['id']}') == null) await h.persist(o);
  final pick = <int, int>{};
  final otherTables = s.repo!.of('table').where((t) => t['id'] != o['table']).toList()..sort((a, b) => '${a['name']}'.compareTo('${b['name']}'));
  var dest = 'new'; // 'new' | 'table' | 'take'
  String? destTable;
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
            Text('Choose what goes on the new bill.', style: TextStyle(color: Tk.label2)),
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
            const Padding(padding: EdgeInsets.only(bottom: 6), child: Text('New bill is for', style: TextStyle(fontWeight: FontWeight.w600))),
            Seg<String>(
              expand: true,
              value: dest,
              items: [('new', 'New bill'), if (otherTables.isNotEmpty) ('table', 'Another table'), ('take', 'Takeaway')],
              onChanged: (v) => set(() { dest = v; if (v != 'table') destTable = null; }),
            ),
            if (dest == 'table')
              Padding(
                padding: const EdgeInsets.only(top: 10),
                child: OutlinedButton(
                  onPressed: () async {
                    final picked = await showModalBottomSheet<String>(
                      context: ctx,
                      showDragHandle: true,
                      builder: (c) => SafeArea(child: ListView(shrinkWrap: true, children: [
                        for (final t in otherTables)
                          ListTile(
                            title: Text('${t['name']}'),
                            subtitle: Text(_openOrderAt(s, '${t['id']}') != null ? 'Already has an open bill -- items will be added to it' : 'Free'),
                            onTap: () => Navigator.pop(c, '${t['id']}'),
                          ),
                      ])),
                    );
                    if (picked != null) set(() => destTable = picked);
                  },
                  child: Text(destTable == null ? 'Choose a table' : '${s.repo!.rec(destTable!)?['name'] ?? 'Chosen'}'),
                ),
              ),
            const SizedBox(height: 10),
            FilledButton(
              onPressed: () async {
                final moving = [for (final e in pick.entries) if (e.value > 0) e];
                if (moving.isEmpty) {
                  h.toast('Choose at least one item');
                  return;
                }
                if (moving.length == lines.length && moving.every((e) => e.value >= (lines[e.key]['qty'] as num))) {
                  h.toast('Leave something on this bill, or move the whole table instead');
                  return;
                }
                if (dest == 'table' && destTable == null) {
                  h.toast('Choose a table');
                  return;
                }
                // Merge into the target table's already-open order, if there is one, exactly as
                // mergeOrders()/splitSheet() do on the website -- never silently open a second
                // simultaneous bill at an occupied table.
                final target = dest == 'table' ? _openOrderAt(s, destTable!) : null;
                final n = target != null
                    ? (Map<String, dynamic>.from(target)..['lines'] = [for (final l in (target['lines'] as List)) Map<String, dynamic>.from(l as Map)])
                    : h.newOrder(type: dest == 'take' ? 'Takeaway' : '${o['type']}', table: dest == 'take' ? null : (dest == 'table' ? destTable : o['table'] as String?));
                if (target == null) {
                  n['cust'] = Map<String, dynamic>.from((o['cust'] as Map?) ?? {});
                  n['kfrom'] = o['id'];
                  n['splitFrom'] = o['no'];
                }
                n['no'] ??= await s.nextNo();
                final moved = <Map<String, dynamic>>[];
                for (final e in moving) {
                  final l = lines[e.key];
                  final q = e.value;
                  final sentMove = ((l['sent'] ?? 0) as num).toInt().clamp(0, q);
                  moved.add({'q': sentMove, 'name': l['name'], 'qty': q});
                  final nl = (n['lines'] as List).cast<Map<String, dynamic>>();
                  final same = nl.where((x) => lineKey(x) == lineKey(l) && x['price'] == l['price']).firstOrNull;
                  if (same != null) {
                    same['qty'] = (same['qty'] as num) + q;
                    same['sent'] = ((same['sent'] ?? 0) as num) + sentMove;
                  } else {
                    nl.add({...l, 'qty': q, 'sent': sentMove});
                  }
                  l['qty'] = (l['qty'] as num) - q;
                  l['sent'] = ((l['sent'] ?? 0) as num) - sentMove;
                }
                o['lines'] = lines.where((l) => (l['qty'] as num) > 0).toList();
                o['moves'] = [...((o['moves'] as List?) ?? []), {'at': nowIso(), 'to': n['id'], 'toNo': n['no'], 'items': moved}];
                await h.persist(n);
                await h.persist(o);
                if (ctx.mounted) Navigator.pop(ctx);
                h.refresh(() => h.cur = n);
                h.toast(target != null ? 'Merged into ${n['no']}' : 'Split to ${n['no']}');
              },
              child: const Text('Split'),
            ),
          ]),
        ),
      );
    }),
  );
}
