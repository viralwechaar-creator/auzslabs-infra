import 'package:flutter/material.dart' hide Text;
import 'i18n.dart';
import 'theme.dart';

/// One field of [formSheet].
class F {
  F(this.k, this.label, {this.type = 'text', this.value, this.options = const [], this.hint});
  final String k, label, type; // text | number | check | select | multiline
  final dynamic value;
  final List<List<String>> options; // [value, label]
  final String? hint;
}

/// A bottom sheet with a form. [onSave] gets the typed values; return false to keep the sheet open.
Future<void> formSheet(BuildContext c, String title, List<F> fields, Future<bool?> Function(Map<String, dynamic>) onSave, {Future<void> Function()? onDelete, String saveLabel = 'Save'}) async {
  final ctl = {for (final f in fields) f.k: TextEditingController(text: f.value == null ? '' : '${f.value}')};
  final vals = {for (final f in fields) f.k: f.value};
  String? err;
  await showModalBottomSheet<void>(
    context: c,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (ctx) => StatefulBuilder(
      builder: (ctx, set) => Padding(
        padding: EdgeInsets.fromLTRB(16, 0, 16, MediaQuery.of(ctx).viewInsets.bottom + 16),
        child: SingleChildScrollView(
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, mainAxisSize: MainAxisSize.min, children: [
            Text(title, style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800)),
            const SizedBox(height: 12),
            for (final f in fields)
              Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: switch (f.type) {
                  'check' => SwitchListTile(contentPadding: EdgeInsets.zero, title: Text(f.label), value: vals[f.k] == true, onChanged: (v) => set(() => vals[f.k] = v)),
                  'multi' => Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text(f.label, style: const TextStyle(fontWeight: FontWeight.w600)),
                      const SizedBox(height: 6),
                      Wrap(spacing: 8, runSpacing: 4, children: [
                        for (final o in f.options)
                          FilterChip(
                              label: Text(o[1]),
                              selected: ((vals[f.k] as List?) ?? const []).contains(o[0]),
                              onSelected: (on) => set(() {
                                    final l = [...((vals[f.k] as List?) ?? const [])];
                                    on ? l.add(o[0]) : l.remove(o[0]);
                                    vals[f.k] = l;
                                  })),
                      ]),
                    ]),
                  'select' => DropdownButtonFormField<String>(
                      initialValue: f.options.any((o) => o[0] == '${vals[f.k]}') ? '${vals[f.k]}' : null,
                      decoration: InputDecoration(labelText: tr(f.label)),
                      items: [for (final o in f.options) DropdownMenuItem(value: o[0], child: Text(o[1]))],
                      onChanged: (v) => vals[f.k] = v),
                  _ => TextField(controller: ctl[f.k], keyboardType: f.type == 'number' ? const TextInputType.numberWithOptions(decimal: true) : (f.type == 'multiline' ? TextInputType.multiline : TextInputType.text), minLines: f.type == 'multiline' ? 2 : 1, maxLines: f.type == 'multiline' ? 4 : 1, decoration: InputDecoration(labelText: tr(f.label), helperText: f.hint == null ? null : tr(f.hint!))),
                },
              ),
            if (err != null) Padding(padding: const EdgeInsets.only(bottom: 8), child: Text(err!, style: TextStyle(color: Tk.red))),
            Row(children: [
              if (onDelete != null)
                Padding(
                  padding: const EdgeInsets.only(right: 8),
                  child: OutlinedButton(
                    onPressed: () async {
                      if (await askYes(ctx, 'Delete this?', 'This cannot be undone.')) {
                        await onDelete();
                        if (ctx.mounted) Navigator.pop(ctx);
                      }
                    },
                    style: OutlinedButton.styleFrom(foregroundColor: Tk.red),
                    child: const Text('Delete'),
                  ),
                ),
              Expanded(
                child: FilledButton(
                  onPressed: () async {
                    final out = <String, dynamic>{};
                    for (final f in fields) {
                      if (f.type == 'check' || f.type == 'select' || f.type == 'multi') {
                        out[f.k] = vals[f.k];
                      } else if (f.type == 'number') {
                        final t = ctl[f.k]!.text.trim();
                        out[f.k] = t.isEmpty ? null : num.tryParse(t);
                      } else {
                        out[f.k] = ctl[f.k]!.text.trim();
                      }
                    }
                    final r = await onSave(out);
                    if (r == false) {
                      set(() => err = 'Please check the details.');
                      return;
                    }
                    if (ctx.mounted) Navigator.pop(ctx);
                  },
                  child: Text(saveLabel),
                ),
              ),
            ]),
          ]),
        ),
      ),
    ),
  );
}

Future<bool> askYes(BuildContext c, String t, String m) async => (await showDialog<bool>(context: c, builder: (d) => AlertDialog(title: Text(t), content: Text(m), actions: [TextButton(onPressed: () => Navigator.pop(d, false), child: const Text('Back')), FilledButton(onPressed: () => Navigator.pop(d, true), child: const Text('Yes'))]))) ?? false;

/// A friendly empty state: icon, headline, hint and an optional action.
class Empty extends StatelessWidget {
  const Empty(this.icon, this.title, this.hint, {this.action, this.onAction, super.key});
  final IconData icon;
  final String title, hint;
  final String? action;
  final VoidCallback? onAction;
  @override
  Widget build(BuildContext context) => Center(
        child: Padding(
          padding: const EdgeInsets.all(28),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            Container(width: 72, height: 72, decoration: BoxDecoration(color: Tk.accent.withValues(alpha: .1), shape: BoxShape.circle), child: Icon(icon, size: 34, color: Tk.accent)),
            const SizedBox(height: 14),
            Text(title, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
            const SizedBox(height: 6),
            Text(hint, textAlign: TextAlign.center, style: TextStyle(color: Tk.label2)),
            if (action != null) ...[const SizedBox(height: 16), FilledButton(onPressed: onAction, child: Text(action!))],
          ]),
        ),
      );
}

/// Small stat tile used by the dashboards.
class Stat extends StatelessWidget {
  const Stat(this.label, this.value, {this.sub, this.hero = false, super.key});
  final String label, value;
  final String? sub;
  final bool hero;
  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(color: hero ? Tk.accent : Tk.card, borderRadius: BorderRadius.circular(16), border: hero ? null : Border.all(color: Tk.line, width: .5)),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
          Text(label, style: TextStyle(fontSize: 12, color: hero ? Colors.white70 : Tk.label2, fontWeight: FontWeight.w600)),
          const SizedBox(height: 4),
          Text(value, style: TextStyle(fontSize: hero ? 30 : 20, fontWeight: FontWeight.w800, color: hero ? Colors.white : Tk.label)),
          if (sub != null) Text(sub!, style: TextStyle(fontSize: 12, color: hero ? Colors.white70 : Tk.label2)),
        ]),
      );
}
