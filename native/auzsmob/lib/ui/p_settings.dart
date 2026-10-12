import 'package:flutter/material.dart' hide Text;
import 'package:url_launcher/url_launcher.dart';
import '../core/calc.dart';
import '../core/session.dart';
import 'ds.dart';
import 'i18n.dart';
import 'mk.dart';
import 'mydata.dart';
import 'theme.dart';

const _simplePreset = {'sell': true, 'purchase': true, 'repairs': 'simple', 'stock': false, 'serials': false, 'customers': false, 'vendors': false, 'dayclose': false};
const _fullPreset = {'sell': true, 'purchase': true, 'repairs': 'full', 'stock': true, 'serials': true, 'customers': true, 'vendors': true, 'dayclose': true};
const _navLabels = {'home': 'Home', 'sell': 'New sale', 'repairs': 'Repairs', 'stock': 'Stock', 'reports': 'Reports', 'myreport': 'My sales', 'dues': 'Dues', 'settings': 'Settings', 'more': 'More'};
const _receiptStyles = [('', 'Thermal (default)'), ('modern', 'Modern'), ('bold', 'Bold'), ('classic', 'Classic'), ('stamped', 'Stamped')];

class SettingsPage extends StatefulWidget {
  const SettingsPage(this.s, {super.key});
  final MobSession s;
  @override
  State<SettingsPage> createState() => _SettingsPageState();
}

class _SettingsPageState extends State<SettingsPage> {
  MobSession get s => widget.s;
  late final shop = TextEditingController(text: '${s.settings['shopName'] ?? ''}'), addr = TextEditingController(text: '${s.settings['address'] ?? ''}'), phone = TextEditingController(text: '${s.settings['phone'] ?? ''}'), footer = TextEditingController(text: '${s.settings['billFooter'] ?? ''}');
  late final pct = TextEditingController(text: s.sharePct > 0 ? qtyStr(s.sharePct) : '');
  List<Map<String, dynamic>>? staff;
  Map<String, dynamic>? integ;
  String? integErr;
  List<({String id, bool on})>? navRows;

  @override
  void initState() {
    super.initState();
    if (s.can('mob_reports')) {
      s.staffList(refresh: true).then((v) => mounted ? setState(() => staff = v) : null).catchError((_) {});
      s.api.rpc('mob_integrity_check').then((v) => mounted ? setState(() => integ = Map<String, dynamic>.from(v as Map)) : null).catchError((_) {});
    }
  }

  Future<void> _save(Map<String, dynamic> p) async {
    try {
      await s.api.rpc('mob_save_settings', {'p': p});
      await s.reloadContext();
      if (mounted) {
        toast(context, tr('Saved'));
        setState(() {});
      }
    } catch (e) {
      if (mounted) toast(context, '$e', err: true);
    }
  }

  Widget _sw(String key, String label, String hint) {
    final cur = s.features;
    return Li(label, sub: hint, trailing: Switch(value: cur[key] != false && cur[key] != 'off', onChanged: (v) => _save({'features': {...cur, key: v}})), chevron: false);
  }

  Widget _features() {
    final cur = s.features;
    return Column(children: [
      const SectionLabel('What your shop uses'),
      Pad(Row(children: [
        Expanded(child: OutlinedButton(onPressed: () => _save({'features': _simplePreset, 'staffSeePurchaseRates': true}), child: const Text('Simple shop'))),
        const SizedBox(width: 10),
        Expanded(child: OutlinedButton(onPressed: () => _save({'features': _fullPreset}), child: const Text('Full shop'))),
      ])),
      Group([
        _sw('sell', 'Selling', 'Make bills and sell items.'),
        _sw('purchase', 'Purchases', 'Record what you buy.'),
        _sw('stock', 'Stock counts', 'Track how many of each item are left.'),
        _sw('serials', 'IMEI / serial numbers', 'Track each phone by its IMEI.'),
        _sw('customers', 'Customers and credit', 'Keep customer names and udhaar.'),
        _sw('vendors', 'Vendors', 'Keep vendors and what you owe them.'),
        _sw('dayclose', 'Day close', 'Close the day with a cash count.'),
      ]),
      const SectionLabel('Repairs'),
      Pad(Seg<String>(expand: true, items: [('off', tr('Off')), ('simple', tr('Simple')), ('full', tr('Full job cards'))], value: s.repairsMode, onChanged: (v) => _save({'features': {...cur, 'repairs': v}}))),
    ]);
  }

  Widget _nav() {
    final all = s.allNav;
    final saved = s.customNav;
    navRows ??= () {
      final order = saved != null ? saved.where((id) => id == 'more' || all.contains(id)).toList() : [...s.navList.take(4), 'more'];
      final rest = [...all, 'more'].where((id) => !order.contains(id)).toList();
      return [for (final id in [...order, ...rest]) (id: id, on: order.contains(id))];
    }();
    final rows = navRows!;
    void swap(int a, int b) => setState(() {
          final t = rows[a];
          rows[a] = rows[b];
          rows[b] = t;
        });
    return Column(children: [
      const SectionLabel('Menu buttons'),
      Hint(tr('Choose which buttons show in the bottom bar and their order (up to 5).')),
      Group([
        for (var i = 0; i < rows.length; i++)
          Li(_navLabels[rows[i].id] ?? rows[i].id, sub: rows[i].id == 'settings' ? tr('Always kept so you can change this again.') : null, chevron: false,
              trailing: Row(mainAxisSize: MainAxisSize.min, children: [
                IconButton(onPressed: i == 0 ? null : () => swap(i, i - 1), icon: const Icon(Icons.arrow_upward, size: 22)),
                IconButton(onPressed: i == rows.length - 1 ? null : () => swap(i, i + 1), icon: const Icon(Icons.arrow_downward, size: 22)),
                Switch(value: rows[i].on, onChanged: rows[i].id == 'settings' ? null : (v) {
                  if (v && rows.where((r) => r.on).length >= 5) {
                    toast(context, tr('You can show up to 5 buttons.'));
                    return;
                  }
                  setState(() => rows[i] = (id: rows[i].id, on: v));
                }),
              ])),
      ]),
      Pad(Row(children: [
        Expanded(child: FilledButton(onPressed: () {
          final l = [for (final r in rows) if (r.on) r.id];
          if (l.isEmpty) {
            toast(context, tr('Pick at least one button.'), err: true);
            return;
          }
          _save({'features': {'nav': l}});
        }, child: const Text('Save'))),
        if (saved != null) ...[const SizedBox(width: 10), Expanded(child: OutlinedButton(onPressed: () {
          navRows = null;
          _save({'features': {'nav': <String>[]}});
        }, child: const Text('Use automatic menu')))],
      ])),
    ]);
  }

  @override
  Widget build(BuildContext context) {
    final owner = s.isOwner;
    final cur = '${s.features['receiptStyle'] ?? ''}';
    return TabPage('Settings', [
      const SectionLabel('Language'),
      Pad(Seg<String>(expand: true, items: const [('en', 'English'), ('hi', 'हिंदी')], value: Lang.code, onChanged: (v) async {
        await s.saveLang(v);
        if (mounted) setState(() {});
      })),
      const SectionLabel('Appearance'),
      Pad(Seg<String>(expand: true, items: const [('system', 'Auto'), ('light', 'Light'), ('dark', 'Dark')], value: Tk.mode, onChanged: (v) => Tk.setMode(v))),
      if (owner) ...[
        const SectionLabel('Shop details'),
        Pad(Column(children: [
          Fld('Shop name', shop),
          gap(),
          Fld('Address', addr),
          gap(),
          Fld('Phone', phone, phone: true),
          gap(),
          Fld('Bill footer', footer),
          gap(),
          FilledButton(onPressed: () => _save({'shopName': shop.text.trim(), 'address': addr.text.trim(), 'phone': phone.text.trim(), 'billFooter': footer.text.trim()}), child: const Text('Save')),
        ])),
        _features(),
        const SectionLabel('Profit sharing'),
        Hint(tr('What percent of each staffer\'s profit goes to you, the shop owner. Leave empty for off. Only shown in reports; no sale or stock figure changes.')),
        Pad(Row(children: [
          Expanded(child: Fld('Percent', pct, number: true)),
          const SizedBox(width: 10),
          FilledButton(onPressed: () {
            final v = pct.text.trim().isEmpty ? 0.0 : n(pct.text);
            if (!(v >= 0 && v <= 100)) {
              toast(context, tr('Enter a number from 0 to 100.'), err: true);
              return;
            }
            _save({'features': {'profitSharePct': v}});
          }, child: const Text('Save')),
        ])),
        _nav(),
        const SectionLabel('Receipt style'),
        Hint(tr('The look of the receipt page customers open from the WhatsApp link.')),
        Pad(Row(children: [
          Expanded(child: Sel('Receipt style', cur, [for (final o in _receiptStyles) (o.$1, tr(o.$2))], (v) => _save({'features': {'receiptStyle': v}}))),
        ])),
        Group([Li('See how this style looks', sub: 'Opens a sample bill in your browser', icon: Icons.visibility_outlined, onTap: () => launchUrl(Uri.parse('${s.origin}/mobbill.html?sample=1&style=${Uri.encodeComponent(cur)}&shop=${Uri.encodeComponent('${s.settings['shopName'] ?? ''}')}'), mode: LaunchMode.externalApplication))]),
        Group([Li('Staff can see purchase rates', trailing: Switch(value: s.settings['staffSeePurchaseRates'] == true, onChanged: (v) => _save({'staffSeePurchaseRates': v})), chevron: false)]),
      ],
      if (s.can('mob_reports')) ...[
        const SectionLabel('Staff'),
        if (staff == null) const Padding(padding: EdgeInsets.all(20), child: Center(child: CircularProgressIndicator()))
        else
          Group([for (final x in staff!) Li('${x['name']}', sub: '${x['role']}', icon: Icons.person_outline, tone: Tk.label3, chevron: false)]),
        if (integ != null) ...[
          const SectionLabel('Books health check'),
          Note(integ!['ok'] == true ? tr('All good.') : tr('Problems found.'), bad: integ!['ok'] != true),
          Group([for (final c in (integ!['checks'] as List)) Li('${(c as Map)['name']}', sub: c['ok'] == true ? null : '${c['detail']}', icon: c['ok'] == true ? Icons.check_circle_outline : Icons.warning_amber_rounded, tone: c['ok'] == true ? Tk.green : Tk.red, chevron: false)]),
        ],
      ],
      if (owner) ...[
        const SectionLabel('Backup or clear all data'),
        Pad(OutlinedButton.icon(onPressed: () => openMyData(context, s), icon: const Icon(Icons.download_outlined), label: const Text('Backup or clear all data'))),
      ],
      gap(8),
      Pad(Text('AUZsMob native app · build 1', style: TextStyle(color: Tk.label3, fontSize: 13))),
    ]);
  }
}
