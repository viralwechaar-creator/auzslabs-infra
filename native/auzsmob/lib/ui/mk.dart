import 'package:flutter/material.dart' hide Text;
import '../core/calc.dart';
import 'ds.dart';
import 'i18n.dart';
import 'theme.dart';

/// Small building blocks shared by the AUZsMob screens.

void toast(BuildContext c, String msg, {bool err = false}) {
  final m = ScaffoldMessenger.maybeOf(c);
  if (m == null) return;
  m.hideCurrentSnackBar();
  m.showSnackBar(SnackBar(content: Row(children: [Icon(err ? Icons.error_outline : Icons.check_circle_outline, color: Colors.white, size: 20), const SizedBox(width: 10), Expanded(child: Text(msg, style: const TextStyle(color: Colors.white)))]), backgroundColor: err ? Tk.red : null, duration: Duration(seconds: err ? 6 : 3)));
}

Future<bool> confirm(BuildContext c, String title, String msg, {String yes = 'Save', bool danger = false}) async =>
    (await showDialog<bool>(
      context: c,
      builder: (d) => AlertDialog(
        title: Text(title),
        content: Text(msg),
        actions: [
          TextButton(onPressed: () => Navigator.pop(d, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(d, true), style: danger ? FilledButton.styleFrom(backgroundColor: Tk.red) : null, child: Text(yes)),
        ],
      ),
    )) ??
    false;

class SheetAction {
  SheetAction(this.label, this.onTap, {this.primary = true, this.danger = false});
  final String label;
  /// Return false to keep the sheet open (a field was missing); throwing shows the error and keeps it open.
  final Future<bool?> Function(BuildContext ctx) onTap;
  final bool primary, danger;
}

/// A bottom sheet with a body and buttons. [body] can redraw itself through `set`.
Future<void> openSheet(BuildContext c, String title, Widget Function(BuildContext ctx, void Function(VoidCallback) set) body, {List<SheetAction> actions = const []}) {
  return showModalBottomSheet<void>(
    context: c,
    isScrollControlled: true,
    useSafeArea: true,
    showDragHandle: true,
    builder: (ctx) => StatefulBuilder(builder: (ctx, set) {
      return Padding(
        padding: EdgeInsets.fromLTRB(16, 0, 16, MediaQuery.of(ctx).viewInsets.bottom + 16),
        child: SingleChildScrollView(
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, mainAxisSize: MainAxisSize.min, children: [
            Text(title, style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800, letterSpacing: -.4)),
            const SizedBox(height: 14),
            body(ctx, set),
            if (actions.isNotEmpty) const SizedBox(height: 16),
            for (final a in actions)
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: a.primary
                    ? FilledButton(
                        style: a.danger ? FilledButton.styleFrom(backgroundColor: Tk.red) : null,
                        onPressed: () async {
                          try {
                            final r = await a.onTap(ctx);
                            if (r != false && ctx.mounted) Navigator.pop(ctx);
                          } catch (e) {
                            if (ctx.mounted) toast(ctx, '$e', err: true);
                          }
                        },
                        child: Text(a.label))
                    : OutlinedButton(
                        style: a.danger ? OutlinedButton.styleFrom(foregroundColor: Tk.red) : null,
                        onPressed: () async {
                          try {
                            final r = await a.onTap(ctx);
                            if (r != false && ctx.mounted) Navigator.pop(ctx);
                          } catch (e) {
                            if (ctx.mounted) toast(ctx, '$e', err: true);
                          }
                        },
                        child: Text(a.label)),
              ),
          ]),
        ),
      );
    }),
  );
}

Widget gap([double h = 12]) => SizedBox(height: h);

/// A text box with a label. [number] gives the decimal keypad.
class Fld extends StatelessWidget {
  const Fld(this.label, this.c, {this.number = false, this.phone = false, this.multiline = false, this.hint, this.autofocus = false, this.onChanged, super.key});
  final String label;
  final TextEditingController c;
  final bool number, phone, multiline, autofocus;
  final String? hint;
  final ValueChanged<String>? onChanged;
  @override
  Widget build(BuildContext context) => TextField(
        controller: c,
        autofocus: autofocus,
        onChanged: onChanged,
        keyboardType: number ? const TextInputType.numberWithOptions(decimal: true) : (phone ? TextInputType.phone : (multiline ? TextInputType.multiline : TextInputType.text)),
        minLines: multiline ? 2 : 1,
        maxLines: multiline ? 4 : 1,
        style: const TextStyle(fontSize: 18),
        decoration: InputDecoration(labelText: tr(label), helperText: hint == null ? null : tr(hint!)),
      );
}

/// A drop-down with a label.
class Sel extends StatelessWidget {
  const Sel(this.label, this.value, this.options, this.onChanged, {super.key});
  final String label;
  final String value;
  final List<(String, String)> options; // (value, shown text; translated here)
  final ValueChanged<String> onChanged;
  @override
  Widget build(BuildContext context) => DropdownButtonFormField<String>(
        initialValue: options.any((o) => o.$1 == value) ? value : null,
        isExpanded: true,
        decoration: InputDecoration(labelText: tr(label)),
        items: [for (final o in options) DropdownMenuItem(value: o.$1, child: Text(o.$2, maxLines: 1, overflow: TextOverflow.ellipsis))],
        onChanged: (v) => onChanged(v ?? ''),
      );
}

class Pill extends StatelessWidget {
  const Pill(this.text, {this.tone, super.key});
  final String text;
  final Color? tone;
  @override
  Widget build(BuildContext context) {
    final c = tone ?? Tk.label2;
    return Container(padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4), decoration: BoxDecoration(color: c.withValues(alpha: .14), borderRadius: BorderRadius.circular(20)), child: Text(text, style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: c)));
  }
}

class Metric extends StatelessWidget {
  const Metric(this.label, this.value, {this.sub, this.tone, this.hero = false, this.onTap, super.key});
  final String label, value;
  final String? sub;
  final Color? tone;
  final bool hero;
  final VoidCallback? onTap;
  @override
  Widget build(BuildContext context) {
    final w = Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(color: hero ? Tk.accent : Tk.card, borderRadius: BorderRadius.circular(18), border: hero ? null : Border.all(color: Tk.line, width: .5)),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
        Text(label, style: TextStyle(fontSize: 13, color: hero ? Colors.white70 : Tk.label2, fontWeight: FontWeight.w600)),
        const SizedBox(height: 4),
        FittedBox(fit: BoxFit.scaleDown, alignment: Alignment.centerLeft, child: Text(value, style: TextStyle(fontSize: hero ? 30 : 22, fontWeight: FontWeight.w800, color: hero ? Colors.white : (tone ?? Tk.label)))),
        if (sub != null) Text(sub!, style: TextStyle(fontSize: 13, color: hero ? Colors.white70 : Tk.label2)),
      ]),
    );
    return onTap == null ? w : GestureDetector(onTap: onTap, child: w);
  }
}

/// Two metric tiles per row.
Widget metricGrid(List<Widget> items) {
  final rows = <Widget>[];
  for (var i = 0; i < items.length; i += 2) {
    rows.add(Row(children: [Expanded(child: items[i]), const SizedBox(width: 10), Expanded(child: i + 1 < items.length ? items[i + 1] : const SizedBox.shrink())]));
    rows.add(const SizedBox(height: 10));
  }
  return Padding(padding: const EdgeInsets.symmetric(horizontal: 16), child: Column(children: rows));
}

class Pad extends StatelessWidget {
  const Pad(this.child, {this.v = 6, super.key});
  final Widget child;
  final double v;
  @override
  Widget build(BuildContext context) => Padding(padding: EdgeInsets.symmetric(horizontal: 16, vertical: v), child: child);
}

class Note extends StatelessWidget {
  const Note(this.text, {this.bad = false, super.key});
  final String text;
  final bool bad;
  @override
  Widget build(BuildContext context) => Container(
        margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(color: (bad ? Tk.red : Tk.blue).withValues(alpha: .1), borderRadius: BorderRadius.circular(14)),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [Icon(bad ? Icons.warning_amber_rounded : Icons.info_outline, color: bad ? Tk.red : Tk.blue, size: 22), const SizedBox(width: 10), Expanded(child: Text(text, style: TextStyle(fontSize: 15, color: Tk.label)))]),
      );
}

class Hint extends StatelessWidget {
  const Hint(this.text, {super.key});
  final String text;
  @override
  Widget build(BuildContext context) => Padding(padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 4), child: Text(text, style: TextStyle(fontSize: 14, color: Tk.label2, height: 1.3)));
}

/// Period picker for reports: ready-made periods or a pair of dates.
class RangeBar extends StatelessWidget {
  const RangeBar({required this.range, required this.from, required this.to, required this.onPick, super.key});
  final String range;
  final String? from, to;
  final void Function(String range, String? from, String? to) onPick;
  static const options = [('today', 'Today'), ('week', 'This week'), ('month', 'This month'), ('lastmonth', 'Last month'), ('year', 'This year'), ('lastyear', 'Last year'), ('custom', 'Pick dates…')];
  Future<void> _date(BuildContext c, bool isFrom) async {
    final (a, b) = rangeDates(range, from: from, to: to);
    final cur = DateTime.tryParse(isFrom ? a : b) ?? DateTime.now();
    final d = await showDatePicker(context: c, initialDate: cur, firstDate: DateTime(2020), lastDate: DateTime.now());
    if (d == null) return;
    onPick('custom', isFrom ? ymd(d) : a, isFrom ? b : ymd(d));
  }

  @override
  Widget build(BuildContext context) {
    final (a, b) = rangeDates(range, from: from, to: to);
    return Pad(Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Sel('Period', range, [for (final o in options) (o.$1, tr(o.$2))], (v) => v == 'custom' ? onPick('custom', a, b) : onPick(v, null, null)),
      if (range == 'custom')
        Padding(
          padding: const EdgeInsets.only(top: 8),
          child: Row(children: [
            Expanded(child: OutlinedButton(onPressed: () => _date(context, true), child: Text('$a'))),
            const Padding(padding: EdgeInsets.symmetric(horizontal: 8), child: Text('→')),
            Expanded(child: OutlinedButton(onPressed: () => _date(context, false), child: Text('$b'))),
          ]),
        )
      else if (range != 'today')
        Padding(padding: const EdgeInsets.only(top: 6), child: Text('$a  →  $b', style: TextStyle(color: Tk.label2, fontSize: 14))),
    ]));
  }
}

/// A page inside a tab: big title, optional actions on the right, then [children] in a scrolling list.
class TabPage extends StatelessWidget {
  const TabPage(this.title, this.children, {this.actions = const [], this.onRefresh, super.key});
  final String title;
  final List<Widget> children;
  final List<Widget> actions;
  final Future<void> Function()? onRefresh;
  @override
  Widget build(BuildContext context) {
    final list = ListView(padding: const EdgeInsets.only(bottom: 32), children: [
      PageHead(title, trailing: actions.isEmpty ? null : Row(mainAxisSize: MainAxisSize.min, children: actions)),
      ...children,
    ]);
    return onRefresh == null ? list : RefreshIndicator(onRefresh: onRefresh!, child: list);
  }
}

/// A pushed page with a back arrow.
class SubPage extends StatelessWidget {
  const SubPage(this.title, this.children, {this.actions = const [], this.bottom, super.key});
  final String title;
  final List<Widget> children;
  final List<Widget> actions;
  final Widget? bottom;
  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: Text(title), actions: actions),
        body: ListView(padding: const EdgeInsets.only(bottom: 90), children: children),
        bottomNavigationBar: bottom == null ? null : SafeArea(child: Container(padding: const EdgeInsets.fromLTRB(16, 8, 16, 12), decoration: BoxDecoration(color: Tk.bar, border: Border(top: BorderSide(color: Tk.line, width: .5))), child: bottom)),
      );
}

Widget iconBtn(IconData i, VoidCallback f, {String? tip}) => IconButton(onPressed: f, tooltip: tip, icon: Icon(i, color: Tk.accent), iconSize: 28);

Widget emptyBox(IconData i, String title, [String hint = '']) => Padding(
      padding: const EdgeInsets.symmetric(vertical: 36, horizontal: 24),
      child: Column(children: [
        Icon(i, size: 40, color: Tk.label3),
        const SizedBox(height: 10),
        Text(title, textAlign: TextAlign.center, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
        if (hint.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 6), child: Text(hint, textAlign: TextAlign.center, style: TextStyle(color: Tk.label2))),
      ]),
    );

String fmtDT(dynamic s) {
  final d = DateTime.tryParse('${s ?? ''}')?.toLocal();
  if (d == null) return '';
  const mo = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return '${d.day} ${mo[d.month - 1]}, ${d.hour.toString().padLeft(2, '0')}:${d.minute.toString().padLeft(2, '0')}';
}

String todayStr() => ymd(DateTime.now());
