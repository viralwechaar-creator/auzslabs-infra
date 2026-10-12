import 'package:flutter/material.dart' hide Text;
import '../core/session.dart';
import 'ds.dart';
import 'i18n.dart';
import 'mk.dart';
import 'theme.dart';

class HistLine {
  HistLine(this.title, this.sub, this.value);
  final String title, sub, value;
}

/// A history list (sales or purchases). Owner/manager can switch on "Select" and void several at once (never a hard delete:
/// the bulk call just voids each one, so one that is already voided never blocks the rest).
class VoidableHistory extends StatefulWidget {
  const VoidableHistory({required this.s, required this.title, required this.canVoid, required this.rows, required this.idOf, required this.isVoided, required this.line, required this.onOpen, required this.rpcBulk, required this.idsParam, required this.confirmText, required this.applyVoided, super.key});
  final MobSession s;
  final String title, rpcBulk, idsParam;
  final bool canVoid;
  final List<Map<String, dynamic>> Function() rows;
  final String Function(Map<String, dynamic>) idOf;
  final bool Function(Map<String, dynamic>) isVoided;
  final HistLine Function(Map<String, dynamic>) line;
  final void Function(Map<String, dynamic>) onOpen;
  final String Function(int n) confirmText;
  final Future<void> Function(String id) applyVoided;
  @override
  State<VoidableHistory> createState() => _VoidableHistoryState();
}

class _VoidableHistoryState extends State<VoidableHistory> {
  bool mode = false;
  final sel = <String>{};

  Future<void> _void() async {
    final n = sel.length;
    final ok = await confirm(context, 'Void selected', widget.confirmText(n), yes: 'Void selected', danger: true);
    if (!ok || !mounted) return;
    try {
      final ids = sel.toList();
      final r = Map<String, dynamic>.from(await widget.s.api.rpc(widget.rpcBulk, {widget.idsParam: ids, 'p_reason': null}) as Map);
      final failed = {for (final f in (r['failed'] as List? ?? const [])) '${(f as Map)['id']}'};
      for (final id in ids) {
        if (!failed.contains(id)) await widget.applyVoided(id);
      }
      if (!mounted) return;
      toast(context, failed.isNotEmpty ? trv('Voided {n}, {m} could not be voided (already voided or already sold on)', {'n': r['voided'], 'm': failed.length}) : trv('Voided {n}', {'n': r['voided']}));
      setState(() {
        sel.clear();
        mode = false;
      });
    } catch (e) {
      if (mounted) toast(context, '$e', err: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final rows = widget.rows();
    return SubPage(
      widget.title,
      [
        if (rows.isEmpty) emptyBox(Icons.receipt_long_outlined, tr('Nothing yet'))
        else
          Group([
            for (final r in rows)
              () {
                final id = widget.idOf(r), voided = widget.isVoided(r), ln = widget.line(r);
                return Li(ln.title + (voided ? ' (${tr('Voided')})' : ''), sub: ln.sub, value: ln.value, chevron: !mode,
                    trailing: mode && !voided ? Checkbox(value: sel.contains(id), onChanged: (v) => setState(() => v == true ? sel.add(id) : sel.remove(id))) : null,
                    onTap: mode ? (voided ? null : () => setState(() => sel.contains(id) ? sel.remove(id) : sel.add(id))) : () => widget.onOpen(r));
              }(),
          ]),
      ],
      actions: [if (widget.canVoid) TextButton(onPressed: () => setState(() {
            mode = !mode;
            sel.clear();
          }), child: Text(mode ? 'Done' : 'Select'))],
      bottom: mode ? Row(children: [Expanded(child: Text(trv('{n} selected', {'n': sel.length}), style: TextStyle(color: Tk.label2))), FilledButton(style: FilledButton.styleFrom(backgroundColor: Tk.red), onPressed: sel.isEmpty ? null : _void, child: const Text('Void selected'))]) : null,
    );
  }
}
