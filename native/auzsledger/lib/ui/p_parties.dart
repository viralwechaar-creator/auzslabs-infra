import 'package:flutter/material.dart' hide Text;
import '../core/api.dart';
import '../core/calc.dart';
import '../core/session.dart';
import 'ds.dart';
import 'i18n.dart';
import 'kit.dart';
import 'mk.dart';
import 'theme.dart';

/// Customers and suppliers.
class PartiesPage extends StatefulWidget {
  const PartiesPage(this.s, {super.key});
  final LedgerSession s;
  @override
  State<PartiesPage> createState() => _PartiesPageState();
}

class _PartiesPageState extends State<PartiesPage> {
  LedgerSession get s => widget.s;
  String kind = 'customer';
  final q = TextEditingController();

  @override
  void initState() {
    super.initState();
    s.refreshParties();
  }

  void _edit([Map<String, dynamic>? p]) {
    formSheet(context, p == null ? (kind == 'customer' ? 'New customer' : 'New supplier') : '${p['name']}', [
      F('name', 'Name', value: p?['name']),
      F('phone', 'Phone', value: p?['phone']),
      F('email', 'Email', value: p?['email']),
      F('gstin', 'GSTIN (if any)', value: p?['gstin']),
      F('address', 'Address', value: p?['address']),
    ], (v) async {
      if ('${v['name']}'.trim().isEmpty) return false;
      try {
        await s.api.rpc('acc_save_party', {'p': {
          'id': p?['id'], 'kind': p?['kind'] ?? kind, 'name': v['name'], 'phone': v['phone'], 'email': v['email'], 'gstin': v['gstin'], 'address': v['address'],
          'reg_type': '${v['gstin']}'.trim().isEmpty ? 'unregistered' : (p == null || p['reg_type'] == 'unregistered' ? 'regular' : p['reg_type']),
        }});
        await s.refreshParties();
        if (mounted) setState(() {});
        return true;
      } on ApiError catch (e) {
        if (mounted) toast(context, e.message, err: true);
        return false;
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Parties'), actions: [if (s.can('acc_sales') || s.can('acc_purchases') || s.can('acc_admin')) IconButton(onPressed: () => _edit(), icon: const Icon(Icons.add_circle_outline))]),
      body: ListenableBuilder(
        listenable: Listenable.merge([s, q]),
        builder: (ctx, _) {
          final ql = q.text.toLowerCase().trim();
          final l = s.parties.where((p) => p['is_walkin'] != true && p['active'] != false && (p['kind'] == kind || p['kind'] == 'both') && (ql.isEmpty || '${p['name']} ${p['phone']}'.toLowerCase().contains(ql))).toList()
            ..sort((a, b) => '${a['name']}'.toLowerCase().compareTo('${b['name']}'.toLowerCase()));
          return ListView(padding: const EdgeInsets.only(bottom: 40), children: [
            Pad(Seg<String>(expand: true, items: const [('customer', 'Customers'), ('supplier', 'Suppliers')], value: kind, onChanged: (v) => setState(() => kind = v))),
            Pad(TextField(controller: q, decoration: InputDecoration(hintText: tr('Search by name or phone'), prefixIcon: const Icon(Icons.search)))),
            if (l.isEmpty) emptyBox(Icons.groups_outlined, 'Nothing yet') else Group([
              for (final p in l.take(200))
                Li('${p['name']}', sub: [p['phone'], p['gstin']].where((x) => '${x ?? ''}'.isNotEmpty).join(' · '), icon: Icons.person_outline, tone: Tk.accent,
                    value: n(p['outstanding']) != 0 ? inr(n(p['outstanding'])) : null, onTap: () => _edit(p)),
            ]),
          ]);
        },
      ),
    );
  }
}
