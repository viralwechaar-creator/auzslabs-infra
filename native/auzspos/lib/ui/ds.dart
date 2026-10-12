import 'package:flutter/material.dart' hide Text;
import 'i18n.dart';
import 'theme.dart';

/// Building blocks that copy the website POS: large page title, segmented control, grouped list, tinted icon tiles.

class PageHead extends StatelessWidget {
  const PageHead(this.title, {this.sub, this.trailing, super.key});
  final String title;
  final String? sub;
  final Widget? trailing;
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.fromLTRB(16, 14, 16, 4),
        child: Row(crossAxisAlignment: CrossAxisAlignment.end, children: [
          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(title, style: const TextStyle(fontSize: 32, fontWeight: FontWeight.w800, letterSpacing: -.8, height: 1.1)),
            if (sub != null) Padding(padding: const EdgeInsets.only(top: 4), child: Text(sub!, style: TextStyle(fontSize: 17, color: Tk.label2))),
          ])),
          ?trailing,
        ]),
      );
}

/// iOS-style segmented control: grey track, white thumb.
class Seg<T> extends StatelessWidget {
  const Seg({required this.items, required this.value, required this.onChanged, this.expand = false, super.key});
  final List<(T, String)> items;
  final T value;
  final ValueChanged<T> onChanged;
  final bool expand;
  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.all(3),
        decoration: BoxDecoration(color: Tk.fill, borderRadius: BorderRadius.circular(14)),
        child: Row(mainAxisSize: expand ? MainAxisSize.max : MainAxisSize.min, children: [
          for (final (v, l) in items)
            Flexible(
              fit: expand ? FlexFit.tight : FlexFit.loose,
              child: GestureDetector(
                behavior: HitTestBehavior.opaque,
                onTap: () => onChanged(v),
                child: AnimatedContainer(
                  duration: const Duration(milliseconds: 180),
                  height: 38,
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  alignment: Alignment.center,
                  decoration: BoxDecoration(color: v == value ? (Tk.dark ? const Color(0xFF48484A) : Colors.white) : Colors.transparent, borderRadius: BorderRadius.circular(11), boxShadow: v == value ? const [BoxShadow(color: Color(0x1F000000), blurRadius: 4, offset: Offset(0, 1))] : null),
                  child: Text(l, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: Tk.label)),
                ),
              ),
            ),
        ]),
      );
}

/// A rounded pill button on the grey fill (the "Table", "Takeaway", "Reservations" buttons).
class PillBtn extends StatelessWidget {
  const PillBtn(this.label, {this.icon, this.onTap, this.fill = false, super.key});
  final String label;
  final IconData? icon;
  final VoidCallback? onTap;
  final bool fill;
  @override
  Widget build(BuildContext context) => Material(
        color: fill ? Tk.accent : Tk.fill,
        borderRadius: BorderRadius.circular(22),
        child: InkWell(
          borderRadius: BorderRadius.circular(22),
          onTap: onTap,
          child: Padding(padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 12), child: Row(mainAxisSize: MainAxisSize.min, children: [
            if (icon != null) ...[Icon(icon, size: 22, color: fill ? Colors.white : Tk.label), const SizedBox(width: 8)],
            Text(label, style: TextStyle(fontSize: 17, fontWeight: FontWeight.w700, color: fill ? Colors.white : Tk.label)),
          ])),
        ),
      );
}

/// Category chip: selected = filled with the accent.
class Cat extends StatelessWidget {
  const Cat(this.label, this.on, this.onTap, {this.count, super.key});
  final String label;
  final bool on;
  final VoidCallback onTap;
  final int? count;
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(right: 8),
        child: Material(
          color: on ? Tk.accent : Tk.fill,
          borderRadius: BorderRadius.circular(24),
          child: InkWell(
            borderRadius: BorderRadius.circular(24),
            onTap: onTap,
            child: Padding(padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 11), child: Row(mainAxisSize: MainAxisSize.min, children: [
              Text(label, style: TextStyle(fontSize: 17, fontWeight: FontWeight.w700, color: on ? Colors.white : Tk.label)),
              if (count != null) ...[const SizedBox(width: 8), Text('$count', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600, color: on ? Colors.white70 : Tk.label2))],
            ])),
          ),
        ),
      );
}

class SectionLabel extends StatelessWidget {
  const SectionLabel(this.t, {super.key});
  final String t;
  @override
  Widget build(BuildContext context) => Padding(padding: const EdgeInsets.fromLTRB(20, 22, 16, 8), child: Text(t, style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800, letterSpacing: -.4)));
}

/// White grouped card whose rows are divided by hairlines inset from the icon.
class Group extends StatelessWidget {
  const Group(this.rows, {super.key});
  final List<Widget> rows;
  @override
  Widget build(BuildContext context) => Container(
        margin: const EdgeInsets.symmetric(horizontal: 16),
        decoration: BoxDecoration(color: Tk.card, borderRadius: BorderRadius.circular(22), border: Border.all(color: Tk.line, width: .5)),
        clipBehavior: Clip.antiAlias,
        child: Column(children: [
          for (var i = 0; i < rows.length; i++) ...[rows[i], if (i < rows.length - 1) const Divider(height: .5, indent: 72)],
        ]),
      );
}

/// A row in a [Group]: tinted icon square, title, optional sub, trailing widget or chevron.
class Li extends StatelessWidget {
  const Li(this.title, {this.sub, this.icon, this.tone, this.trailing, this.value, this.onTap, this.chevron = true, this.titleColor, super.key});
  final String title;
  final String? sub, value;
  final IconData? icon;
  final Color? tone, titleColor;
  final Widget? trailing;
  final VoidCallback? onTap;
  final bool chevron;
  @override
  Widget build(BuildContext context) => InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
          child: Row(children: [
            if (icon != null) ...[Container(width: 44, height: 44, decoration: BoxDecoration(color: tone ?? Tk.label3.withValues(alpha: .9), borderRadius: BorderRadius.circular(12)), child: Icon(icon, color: Colors.white, size: 24)), const SizedBox(width: 14)],
            Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(title, style: TextStyle(fontSize: 19, fontWeight: FontWeight.w600, color: titleColor ?? Tk.label)),
              if (sub != null) Padding(padding: const EdgeInsets.only(top: 2), child: Text(sub!, style: TextStyle(fontSize: 16, color: Tk.label2, height: 1.25))),
            ])),
            if (value != null) Padding(padding: const EdgeInsets.only(left: 8), child: Text(value!, style: TextStyle(fontSize: 18, color: Tk.label2))),
            ?trailing,
            if (trailing == null && chevron && onTap != null) Padding(padding: EdgeInsets.only(left: 8), child: Icon(Icons.chevron_right, color: Tk.label3, size: 26)),
          ]),
        ),
      );
}

/// Top bar of the POS: sync status on the left, optional title, bell on the right.
class NavBar extends StatelessWidget {
  const NavBar({required this.status, required this.statusTone, this.title, this.onStatus, this.onBell, this.badge = 0, super.key});
  final String status;
  final Color statusTone;
  final String? title;
  final VoidCallback? onStatus, onBell;
  final int badge;
  @override
  Widget build(BuildContext context) => Container(
        decoration: BoxDecoration(color: Tk.bar, border: Border(bottom: BorderSide(color: Tk.line, width: .5))),
        padding: EdgeInsets.fromLTRB(16, MediaQuery.of(context).padding.top + 4, 4, 4),
        child: Row(children: [
          if (title != null) Expanded(child: Text(title!, style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800, letterSpacing: -.4))) else const SizedBox.shrink(),
          InkWell(onTap: onStatus, borderRadius: BorderRadius.circular(12), child: Padding(padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 12), child: Row(mainAxisSize: MainAxisSize.min, children: [
            Container(width: 10, height: 10, decoration: BoxDecoration(color: statusTone, shape: BoxShape.circle)),
            const SizedBox(width: 8),
            Text(status, style: TextStyle(fontSize: 16, color: Tk.label2)),
          ]))),
          if (title == null) const Spacer(),
          IconButton(
            iconSize: 28,
            padding: const EdgeInsets.all(12),
            icon: Badge(isLabelVisible: badge > 0, label: Text('$badge'), child: Icon(Icons.notifications_none, color: Tk.accent)),
            onPressed: onBell,
          ),
        ]),
      );
}
