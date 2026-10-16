import 'package:flutter/material.dart' hide Text;
import 'i18n.dart';
import '../core/billing.dart' show r2;
import '../core/purchase_orders.dart';
import '../core/repo.dart' show nowIso;
import '../core/session.dart';
import 'console.dart' show Kpis;
import 'ds.dart';
import 'home.dart';
import 'kit.dart';
import 'theme.dart';

String _s(dynamic v) => v == null ? '' : '$v';

/// Purchase Orders: draft -> received, matching poForm()/receivePO() on the website exactly (same `po`
/// record, same two-status model -- see core/purchase_orders.dart's own header comment for what is and
/// isn't tracked). Gated to owner/manager, matching pos_kind_ok()'s server-side rule for the `po` kind
/// (db/172_pos_offers.sql) -- a cashier never sees this tab at all, rather than tapping it and getting a
/// refusal back from the server.
class PoOrdersTab extends StatefulWidget {
  const PoOrdersTab(this.h, {super.key});
  final HomeState h;
  @override
  State<PoOrdersTab> createState() => _PoOrdersTabState();
}

class _PoOrdersTabState extends State<PoOrdersTab> {
  String status = 'all';
  String q = '';
  Session get s => widget.h.s;

  Future<void> edit([Map<String, dynamic>? po]) async {
    final vendors = s.repo!.of('vendor').toList();
    final ings = s.repo!.of('ing').toList()..sort((a, b) => '${a['name']}'.compareTo('${b['name']}'));
    if (ings.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Add raw materials first')));
      return;
    }
    var items = ((po?['items'] as List?) ?? const []).map((e) => Map<String, dynamic>.from(e as Map)).toList();
    if (items.isEmpty) items = [{'ing': '', 'qty': null, 'price': null}];
    final supplierCtl = TextEditingController(text: '${po?['supplier'] ?? ''}');
    final noteCtl = TextEditingController(text: '${po?['note'] ?? ''}');

    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (ctx) => StatefulBuilder(builder: (ctx, set) {
        return SafeArea(
          child: Padding(
            padding: EdgeInsets.fromLTRB(16, 0, 16, MediaQuery.of(ctx).viewInsets.bottom + 16),
            child: SingleChildScrollView(
              child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                Padding(padding: const EdgeInsets.symmetric(vertical: 14), child: Text(po == null ? 'New purchase order' : 'Edit purchase order', style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800))),
                DropdownButtonFormField<String>(
                  initialValue: vendors.any((v) => v['name'] == supplierCtl.text) ? supplierCtl.text : null,
                  decoration: const InputDecoration(labelText: 'Vendor'),
                  items: [for (final v in vendors) DropdownMenuItem(value: '${v['name']}', child: Text('${v['name']}'))],
                  onChanged: (v) => set(() => supplierCtl.text = v ?? ''),
                ),
                const SizedBox(height: 10),
                TextField(controller: noteCtl, decoration: const InputDecoration(labelText: 'Note (optional)')),
                const SizedBox(height: 14),
                const Align(alignment: Alignment.centerLeft, child: Text('Items', style: TextStyle(fontWeight: FontWeight.w700))),
                for (final line in items)
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 4),
                    child: Row(children: [
                      Expanded(
                        flex: 2,
                        child: DropdownButtonFormField<String>(
                          initialValue: ings.any((g) => g['name'] == line['ing']) ? line['ing'] as String? : null,
                          decoration: const InputDecoration(isDense: true, labelText: 'Material'),
                          items: [for (final g in ings) DropdownMenuItem(value: '${g['name']}', child: Text('${g['name']} (${g['unit'] ?? ''})'))],
                          onChanged: (v) => set(() => line['ing'] = v),
                        ),
                      ),
                      const SizedBox(width: 6),
                      Expanded(child: TextField(decoration: const InputDecoration(isDense: true, labelText: 'Qty'), keyboardType: TextInputType.number, controller: TextEditingController(text: '${line['qty'] ?? ''}'), onChanged: (v) => line['qty'] = num.tryParse(v))),
                      const SizedBox(width: 6),
                      Expanded(child: TextField(decoration: const InputDecoration(isDense: true, labelText: 'Price'), keyboardType: TextInputType.number, controller: TextEditingController(text: '${line['price'] ?? ''}'), onChanged: (v) => line['price'] = num.tryParse(v))),
                      if (items.length > 1) IconButton(icon: const Icon(Icons.close, size: 18), onPressed: () => set(() => items.remove(line))),
                    ]),
                  ),
                Align(alignment: Alignment.centerLeft, child: TextButton(onPressed: () => set(() => items.add({'ing': '', 'qty': null, 'price': null})), child: const Text('Add line'))),
                const SizedBox(height: 10),
                Row(children: [
                  Expanded(child: OutlinedButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel'))),
                  const SizedBox(width: 8),
                  Expanded(
                    child: FilledButton(
                      onPressed: () async {
                        final valid = items.where((l) => '${l['ing'] ?? ''}'.isNotEmpty && (l['qty'] as num?) != null && (l['qty'] as num) > 0).toList();
                        if (valid.isEmpty) {
                          ScaffoldMessenger.of(ctx).showSnackBar(const SnackBar(content: Text('Add at least one material and quantity')));
                          return;
                        }
                        final items2 = [for (final l in valid) {'ing': l['ing'], 'qty': l['qty'], 'price': (l['price'] as num?) ?? 0}];
                        await s.repo!.save('po', {
                          ...?po,
                          'supplier': supplierCtl.text,
                          'note': noteCtl.text,
                          'items': items2,
                          'status': po?['status'] ?? 'draft',
                          'createdAt': po?['createdAt'] ?? nowIso(),
                          'no': po?['no'] ?? nextPoNo(s.repo!),
                        }, id: po?['id'] as String?);
                        s.sync();
                        if (ctx.mounted) Navigator.pop(ctx);
                        setState(() {});
                      },
                      child: const Text('Save order'),
                    ),
                  ),
                ]),
              ]),
            ),
          ),
        );
      }),
    );
  }

  Future<void> receive(Map<String, dynamic> po) async {
    final items = ((po['items'] as List?) ?? const []).map((e) => Map<String, dynamic>.from(e as Map)).toList();
    final rows = [for (final it in items) {'ing': it['ing'], 'ordered': it['qty'], 'qty': it['qty'], 'price': it['price']}];
    final vendors = s.repo!.of('vendor').toList();

    final confirmed = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (ctx) => StatefulBuilder(builder: (ctx, set) {
        return SafeArea(
          child: Padding(
            padding: EdgeInsets.fromLTRB(16, 0, 16, MediaQuery.of(ctx).viewInsets.bottom + 16),
            child: SingleChildScrollView(
              child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                Padding(padding: const EdgeInsets.symmetric(vertical: 14), child: Text('Receive ${po['no'] ?? 'order'} — ${_s(po['supplier'])}', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800))),
                for (final r in rows)
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 4),
                    child: Row(children: [
                      Expanded(flex: 2, child: Text('${r['ing']}', style: const TextStyle(fontWeight: FontWeight.w600))),
                      Text('of ${r['ordered']}', style: TextStyle(color: Tk.label2, fontSize: 13)),
                      const SizedBox(width: 8),
                      Expanded(child: TextField(decoration: const InputDecoration(isDense: true, labelText: 'Received'), keyboardType: TextInputType.number, controller: TextEditingController(text: '${r['qty'] ?? ''}'), onChanged: (v) => r['qty'] = num.tryParse(v))),
                      const SizedBox(width: 6),
                      Expanded(child: TextField(decoration: const InputDecoration(isDense: true, labelText: 'Price/unit'), keyboardType: TextInputType.number, controller: TextEditingController(text: '${r['price'] ?? ''}'), onChanged: (v) => r['price'] = num.tryParse(v))),
                    ]),
                  ),
                const SizedBox(height: 14),
                Row(children: [
                  Expanded(child: OutlinedButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel'))),
                  const SizedBox(width: 8),
                  Expanded(child: FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Confirm receipt'))),
                ]),
              ]),
            ),
          ),
        );
      }),
    );
    if (confirmed != true) return;
    final vv = vendors.where((v) => v['name'] == po['supplier']).firstOrNull;
    final ok = await receivePurchaseOrder(s.repo!, po, rows, vendorId: vv == null ? null : '${vv['id']}', vendorName: '${po['supplier'] ?? ''}');
    s.sync();
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(ok ? 'Stock updated' : 'Already received')));
    setState(() {});
  }

  Future<void> delete(Map<String, dynamic> po) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete this order?'),
        actions: [TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')), FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Delete'))],
      ),
    );
    if (ok != true) return;
    await s.repo!.save('po', po, id: '${po['id']}', deleted: true);
    s.sync();
    setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    final all = s.repo!.of('po').toList();
    final list = all.where((p) {
      if (status != 'all' && '${p['status'] ?? 'draft'}' != status) return false;
      if (q.isEmpty) return true;
      final hay = '${p['supplier'] ?? ''} ${p['no'] ?? ''} ${((p['items'] as List?) ?? []).map((i) => i['ing']).join(' ')}'.toLowerCase();
      return hay.contains(q.toLowerCase());
    }).toList()
      ..sort((a, b) => '${b['createdAt'] ?? ''}'.compareTo('${a['createdAt'] ?? ''}'));
    final open = all.where((p) => '${p['status'] ?? 'draft'}' != 'received').length;
    final thisMonth = nowIso().substring(0, 7);
    final receivedThisMonth = all.where((p) => p['status'] == 'received' && '${p['receivedAt'] ?? ''}'.startsWith(thisMonth)).length;
    final spendThisMonth = s.repo!.of('purchase').where((p) => '${p['date'] ?? ''}'.startsWith(thisMonth)).fold<num>(0, (a, p) => a + ((p['amount'] ?? 0) as num));

    return ListView(padding: const EdgeInsets.only(bottom: 90), children: [
      PageHead('Purchase Orders', sub: 'Order from vendors, then receive the goods to add them to stock.', trailing: PillBtn('New order', icon: Icons.add, fill: true, onTap: () => edit())),
      Kpis('Open orders', '$open', 'Received this month: $receivedThisMonth', [('Spend this month', inr(r2(spendThisMonth)), null)]),
      Padding(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
        child: Row(children: [
          Expanded(child: TextField(decoration: const InputDecoration(prefixIcon: Icon(Icons.search), hintText: 'Search orders…', isDense: true), onChanged: (v) => setState(() => q = v))),
          const SizedBox(width: 8),
          Seg<String>(items: const [('all', 'All'), ('draft', 'Open'), ('received', 'Received')], value: status, onChanged: (v) => setState(() => status = v)),
        ]),
      ),
      const SizedBox(height: 10),
      if (list.isEmpty)
        const Empty(Icons.receipt_long_outlined, 'No purchase orders', 'Create one when stock runs low.')
      else
        Group([
          for (final p in list)
            Li(
              '${p['no'] ?? 'PO'}',
              sub: '${_s(p['supplier']).isEmpty ? '—' : p['supplier']} · ${((p['items'] as List?) ?? []).map((i) => '${i['qty']} ${i['ing']}').join(', ')}',
              icon: Icons.receipt_long_outlined,
              tone: p['status'] == 'received' ? Tk.green : Tk.orange,
              value: p['status'] == 'received' ? 'Received' : 'Open',
              onTap: () => p['status'] == 'received' ? null : edit(p),
              trailing: p['status'] == 'received'
                  ? null
                  : PopupMenuButton<String>(
                      onSelected: (v) => v == 'receive' ? receive(p) : v == 'edit' ? edit(p) : delete(p),
                      itemBuilder: (_) => const [PopupMenuItem(value: 'receive', child: Text('Receive')), PopupMenuItem(value: 'edit', child: Text('Edit')), PopupMenuItem(value: 'delete', child: Text('Delete'))],
                    ),
            ),
        ]),
    ]);
  }
}
