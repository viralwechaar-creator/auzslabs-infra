import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart' hide Text;
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';
import '../core/menu_import.dart';
import 'ds.dart';
import 'home.dart';
import 'i18n.dart';
import 'kit.dart';
import 'media.dart';
import 'theme.dart';

String _s(dynamic v) => v == null ? '' : '$v';

Future<void> _saveSettings(HomeState h, Map<String, dynamic> patch) async {
  final s = h.s;
  if (s.role != 'owner') {
    h.toast('Only the owner can change business settings');
    return;
  }
  await s.repo!.save('settings', {...s.cfg, ...patch}, id: 'settings');
  s.sync();
}

Widget _ownerOnly(HomeState h, Widget child) => h.s.role == 'owner' ? child : const Empty(Icons.lock_outline, 'Owner only', 'Ask the business owner to change this.');

// ------------------------------------------------------------ website & booking content

/// The text and photos of the public ordering website. Same settings fields as Management > Website & Booking on the web console.
class WebsiteContentPage extends StatefulWidget {
  const WebsiteContentPage(this.h, {super.key});
  final HomeState h;
  @override
  State<WebsiteContentPage> createState() => _WebsiteContentPageState();
}

class _WebsiteContentPageState extends State<WebsiteContentPage> {
  HomeState get h => widget.h;
  Map<String, dynamic> get cfg => h.s.cfg;

  Future<void> text() => formSheet(
        context,
        'Website text',
        [
          F('siteKicker', 'Small tagline above the headline', value: cfg['siteKicker']),
          F('siteTag', 'Headline', type: 'multiline', value: cfg['siteTag']),
          F('siteSub', 'Subheading', value: cfg['siteSub']),
          F('siteHours', 'Opening hours text', value: cfg['siteHours']),
          F('siteInsta', 'Instagram link (optional)', value: cfg['siteInsta']),
          F('siteMaps', 'Google Maps link (optional)', value: cfg['siteMaps']),
          F('siteAbout', 'About text', type: 'multiline', value: cfg['siteAbout']),
        ],
        (v) async {
          await _saveSettings(h, {for (final k in ['siteKicker', 'siteTag', 'siteSub', 'siteHours', 'siteInsta', 'siteMaps', 'siteAbout']) k: v[k]});
          if (mounted) setState(() {});
          return true;
        },
      );

  Future<void> photo(String key, String prefix) async {
    final u = await Media.pick(context, prefix);
    if (u == null) return;
    await _saveSettings(h, {key: u});
    if (mounted) setState(() {});
  }

  List<String> list(String key) => _s(cfg[key]).split(',').map((x) => x.trim()).where((x) => x.isNotEmpty).toList();

  Future<void> addTo(String key, String prefix) async {
    final u = await Media.pick(context, prefix);
    if (u == null) return;
    await _saveSettings(h, {key: [...list(key), u].join(',')});
    if (mounted) setState(() {});
  }

  Future<void> removeFrom(String key, String url) async {
    await _saveSettings(h, {key: list(key).where((x) => x != url).join(',')});
    if (mounted) setState(() {});
  }

  Widget strip(String title, String key, String prefix) {
    final l = list(key);
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [Expanded(child: Text(title, style: const TextStyle(fontWeight: FontWeight.w700))), TextButton.icon(onPressed: () => addTo(key, prefix), icon: const Icon(Icons.add_photo_alternate_outlined), label: const Text('Add photo'))]),
        if (l.isEmpty) Text('No photos yet', style: TextStyle(color: Tk.label2)) else SizedBox(height: 92, child: ListView(scrollDirection: Axis.horizontal, children: [
          for (final u in l) Padding(padding: const EdgeInsets.only(right: 8), child: Stack(children: [
            ClipRRect(borderRadius: BorderRadius.circular(10), child: Image.network(u, width: 92, height: 92, fit: BoxFit.cover, errorBuilder: (_, __, ___) => Container(width: 92, height: 92, color: Tk.fill, child: Icon(Icons.broken_image_outlined, color: Tk.label3)))),
            Positioned(top: 2, right: 2, child: InkWell(onTap: () => removeFrom(key, u), child: Container(decoration: const BoxDecoration(color: Colors.black54, shape: BoxShape.circle), padding: const EdgeInsets.all(3), child: const Icon(Icons.close, size: 16, color: Colors.white)))),
          ])),
        ])),
      ]),
    );
  }

  @override
  Widget build(BuildContext context) => _ownerOnly(h, ListView(padding: const EdgeInsets.only(bottom: 28), children: [
        const PageHead('Website & Booking', sub: 'What guests see on your ordering website'),
        const SizedBox(height: 8),
        Group([Li('Website text', sub: _s(cfg['siteTag']).isEmpty ? 'Headline, about text, hours, links' : _s(cfg['siteTag']).replaceAll('\n', ' '), icon: Icons.edit_note, onTap: text)]),
        const SectionLabel('Photos'),
        Padding(padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4), child: PhotoField(label: 'Hero photo', url: _s(cfg['siteHero']), onPick: () => photo('siteHero', 'hero'), onClear: () async {
          await _saveSettings(h, {'siteHero': ''});
          if (mounted) setState(() {});
        })),
        Padding(padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4), child: PhotoField(label: 'About-section photo', url: _s(cfg['siteAboutImg']), onPick: () => photo('siteAboutImg', 'about'), onClear: () async {
          await _saveSettings(h, {'siteAboutImg': ''});
          if (mounted) setState(() {});
        })),
        Padding(padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4), child: PhotoField(label: 'Logo', url: _s(cfg['logo']), onPick: () => photo('logo', 'logo'), onClear: () async {
          await _saveSettings(h, {'logo': ''});
          if (mounted) setState(() {});
        })),
        strip('Gallery photos', 'siteGallery', 'gallery'),
        strip('Ordering banners', 'qrBanners', 'qrbanner'),
      ]));
}

// ------------------------------------------------------------ physical menu files

/// Photos of printed menu pages kept with the business.
class PhysicalMenuPage extends StatefulWidget {
  const PhysicalMenuPage(this.h, {super.key});
  final HomeState h;
  @override
  State<PhysicalMenuPage> createState() => _PhysicalMenuPageState();
}

class _PhysicalMenuPageState extends State<PhysicalMenuPage> {
  HomeState get h => widget.h;
  List<Map<String, dynamic>> get files => ((h.s.cfg['physicalMenus'] as List?) ?? const []).cast<Map>().map((m) => Map<String, dynamic>.from(m)).toList();

  Future<void> add() async {
    final u = await Media.pick(context, 'menu-files');
    if (u == null) return;
    await _saveSettings(h, {'physicalMenus': [...files, {'name': 'Menu page ${files.length + 1}', 'url': u, 'at': DateTime.now().toUtc().toIso8601String()}]});
    if (mounted) setState(() {});
  }

  @override
  Widget build(BuildContext context) => _ownerOnly(h, ListView(padding: const EdgeInsets.only(bottom: 28), children: [
        PageHead('Physical Menu', sub: 'Photos of your printed menu pages', trailing: FilledButton.icon(onPressed: add, icon: const Icon(Icons.add_photo_alternate_outlined), label: const Text('Add photo'))),
        const SizedBox(height: 8),
        if (files.isEmpty)
          const Empty(Icons.menu_book_outlined, 'No menu photos yet', 'Add a clear photo of each page of your printed menu.')
        else
          Group([
            for (final f in files)
              Li(_s(f['name']), sub: _s(f['at']).length >= 10 ? _s(f['at']).substring(0, 10) : '', icon: Icons.image_outlined, chevron: false, trailing: IconButton(icon: Icon(Icons.delete_outline, color: Tk.red), onPressed: () async {
                await _saveSettings(h, {'physicalMenus': files.where((x) => x['url'] != f['url']).toList()});
                if (mounted) setState(() {});
              })),
          ]),
      ]));
}

// ------------------------------------------------------------ bulk photos

/// Every item with no photo, one tap to add it.
class BulkPhotosPage extends StatefulWidget {
  const BulkPhotosPage(this.h, {super.key});
  final HomeState h;
  @override
  State<BulkPhotosPage> createState() => _BulkPhotosPageState();
}

class _BulkPhotosPageState extends State<BulkPhotosPage> {
  HomeState get h => widget.h;

  Future<void> addFor(Map<String, dynamic> it) async {
    final u = await Media.pick(context, 'menu');
    if (u == null) return;
    await h.s.repo!.save('item', {...it, 'img': u}, id: '${it['id']}');
    h.s.sync();
    if (mounted) setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    final all = h.s.repo!.ofAll('item').toList()..sort((a, b) => _s(a['name']).compareTo(_s(b['name'])));
    final missing = all.where((i) => _s(i['img']).isEmpty).toList();
    return _ownerOnly(h, ListView(padding: const EdgeInsets.only(bottom: 28), children: [
      PageHead('Bulk Photos', sub: '${missing.length} of ${all.length} items have no photo'),
      const SizedBox(height: 8),
      if (missing.isEmpty)
        const Empty(Icons.check_circle_outline, 'Every item has a photo', 'Nothing left to add.')
      else
        Group([for (final i in missing) Li(_s(i['name']), sub: '₹${i['price'] ?? 0}', icon: Icons.add_photo_alternate_outlined, onTap: () => addFor(i))]),
    ]));
  }
}

// ------------------------------------------------------------ bulk menu import

/// Paste or type a menu as rows (Category, Item, Price, Type, Description) and add it in one go.
class MenuImportPage extends StatefulWidget {
  const MenuImportPage(this.h, {super.key});
  final HomeState h;
  @override
  State<MenuImportPage> createState() => _MenuImportPageState();
}

class _MenuImportPageState extends State<MenuImportPage> {
  HomeState get h => widget.h;
  final ctl = TextEditingController();
  MenuParse? parsed;
  bool busy = false;

  @override
  void dispose() {
    ctl.dispose();
    super.dispose();
  }

  Future<void> run() async {
    final p = parsed;
    if (p == null || p.rows.isEmpty || busy) return;
    setState(() => busy = true);
    final r = h.s.repo!;
    final cats = <String, String>{}; // lower-case name -> id
    for (final c in r.ofAll('cat')) {
      cats[_s(c['name']).toLowerCase()] = '${c['id']}';
    }
    var added = 0, updated = 0, newCats = 0;
    for (final row in p.rows) {
      var cid = cats[row.cat.toLowerCase()];
      if (cid == null) {
        final rec = await r.save('cat', {'name': row.cat, 'active': true, 'n': cats.length});
        cid = rec.id;
        cats[row.cat.toLowerCase()] = cid;
        newCats++;
      }
      final existing = r.ofAll('item').where((i) => i['cat'] == cid && _s(i['name']).toLowerCase() == row.name.toLowerCase()).firstOrNull;
      if (existing != null) {
        await r.save('item', {...existing, 'price': row.price, if (row.desc.isNotEmpty) 'desc': row.desc}, id: '${existing['id']}');
        updated++;
      } else {
        await r.save('item', {'name': row.name, 'cat': cid, 'price': row.price, 'veg': row.veg, 'desc': row.desc, 'sizes': <dynamic>[], 'off': false});
        added++;
      }
    }
    h.s.sync();
    if (!mounted) return;
    setState(() {
      busy = false;
      parsed = null;
      ctl.clear();
    });
    h.toast('$added added, $updated updated${newCats > 0 ? ', $newCats new categories' : ''}');
  }

  @override
  Widget build(BuildContext context) {
    final p = parsed;
    return ListView(padding: const EdgeInsets.fromLTRB(16, 0, 16, 28), children: [
      const PageHead('Import menu', sub: 'Paste rows: Category, Item, Price, Type, Description'),
      const SizedBox(height: 8),
      Text('One item per line. Type is veg, non-veg or egg (optional). An item that already exists in the same category gets its price updated. You can copy the rows straight from Excel or Google Sheets.', style: TextStyle(color: Tk.label2)),
      const SizedBox(height: 10),
      TextField(controller: ctl, minLines: 8, maxLines: 14, decoration: const InputDecoration(hintText: 'Hot drinks, Masala Chai, 20, veg\nSnacks, Chicken Roll, 80, non-veg', border: OutlineInputBorder()), onChanged: (_) => setState(() => parsed = null)),
      const SizedBox(height: 10),
      Row(children: [
        Expanded(child: OutlinedButton(onPressed: () => setState(() => parsed = parseMenuText(ctl.text)), child: const Text('Check rows'))),
        const SizedBox(width: 10),
        Expanded(child: FilledButton(onPressed: p != null && p.rows.isNotEmpty && !busy ? run : null, child: Text(busy ? 'Adding…' : 'Add to menu'))),
      ]),
      if (p != null) ...[
        const SizedBox(height: 12),
        Text('${p.rows.length} items ready${p.problems.isEmpty ? '' : ', ${p.problems.length} lines skipped'}', style: const TextStyle(fontWeight: FontWeight.w700)),
        for (final x in p.problems) Padding(padding: const EdgeInsets.only(top: 4), child: Text(x, style: TextStyle(color: Tk.red, fontSize: 13))),
        const SizedBox(height: 6),
        for (final row in p.rows.take(30)) Padding(padding: const EdgeInsets.symmetric(vertical: 2), child: Text('${row.cat} · ${row.name} · ₹${row.price}', style: TextStyle(color: Tk.label2, fontSize: 13))),
        if (p.rows.length > 30) Text('and ${p.rows.length - 30} more', style: TextStyle(color: Tk.label3, fontSize: 13)),
      ],
    ]);
  }
}

// ------------------------------------------------------------ my data

String dataCsv(Map<String, dynamic> d) {
  String cell(dynamic v) {
    if (v == null) return '';
    final t = v is Map || v is List ? jsonEncode(v) : '$v';
    return RegExp(r'[",\n\r]').hasMatch(t) ? '"${t.replaceAll('"', '""')}"' : t;
  }

  final out = <String>['AUZslab export - ${(d['business'] as Map)['name']} - ${d['exported_at']}'];
  (d['tables'] as Map).forEach((name, rows) {
    final list = (rows as List).cast<Map>();
    final cols = <String>[];
    for (final r in list) {
      for (final c in r.keys) {
        if (!cols.contains('$c')) cols.add('$c');
      }
    }
    out
      ..add('')
      ..add('## $name (${list.length} rows)')
      ..add(cols.map(cell).join(','));
    for (final r in list) {
      out.add(cols.map((c) => cell(r[c])).join(','));
    }
  });
  return out.join('\r\n');
}

/// Backup, Excel export and Clear all data. Owner only; the server refuses anyone else and demo businesses.
class DataPage extends StatefulWidget {
  const DataPage(this.h, {super.key});
  final HomeState h;
  @override
  State<DataPage> createState() => _DataPageState();
}

class _DataPageState extends State<DataPage> {
  HomeState get h => widget.h;
  bool backedUp = false, busy = false;

  Future<Map<String, dynamic>?> fetch() async {
    setState(() => busy = true);
    try {
      return Map<String, dynamic>.from(await h.s.api.rpc('my_data_export') as Map);
    } catch (e) {
      h.toast('$e');
      return null;
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> share(String name, String text, {bool csv = false}) async {
    final dir = await getTemporaryDirectory();
    final f = File('${dir.path}/$name');
    await f.writeAsString(csv ? '\u{FEFF}$text' : text);
    await SharePlus.instance.share(ShareParams(files: [XFile(f.path)], text: name));
  }

  Future<void> backup() async {
    final d = await fetch();
    if (d == null) return;
    await share('auzslab-backup-${(d['business'] as Map)['slug']}-${DateTime.now().toIso8601String().substring(0, 10)}.json', const JsonEncoder.withIndent(' ').convert(d));
    if (mounted) setState(() => backedUp = true);
  }

  Future<void> exportCsv() async {
    final d = await fetch();
    if (d == null) return;
    await share('auzslab-export-${(d['business'] as Map)['slug']}-${DateTime.now().toIso8601String().substring(0, 10)}.csv', dataCsv(d), csv: true);
  }

  Future<void> clearAll() async {
    if (!backedUp) {
      h.toast('Save a backup first (the first button).');
      return;
    }
    final name = h.s.slug;
    final ok = await showDialog<bool>(context: context, builder: (ctx) {
      final c = TextEditingController();
      return AlertDialog(
        title: const Text('Clear all data'),
        content: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
          const Text('This permanently deletes your orders, bills, customers, stock and attendance in every AUZslab app. Your logins, settings, plan and menu setup stay. It cannot be undone.'),
          const SizedBox(height: 12),
          Text('Type "$name" to confirm:'),
          TextField(controller: c, autocorrect: false),
        ]),
        actions: [TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Back')), FilledButton(style: FilledButton.styleFrom(backgroundColor: Tk.red), onPressed: () => Navigator.pop(ctx, c.text.trim() == name), child: const Text('Clear everything'))],
      );
    });
    if (ok != true) return;
    try {
      await h.s.api.rpc('my_data_clear', {'p_confirm': name});
      await h.s.repo!.wipe();
      await h.s.sync();
      h.toast('All data cleared.');
    } catch (e) {
      h.toast('$e');
    }
  }

  @override
  Widget build(BuildContext context) => _ownerOnly(h, ListView(padding: const EdgeInsets.only(bottom: 28), children: [
        const PageHead('My data', sub: 'Only the business owner can use these. Passwords and secrets are never included.'),
        const SizedBox(height: 8),
        Group([
          Li('Backup (full copy)', sub: 'A .json file with everything. Keep it safe.', icon: Icons.cloud_download_outlined, onTap: busy ? null : backup),
          Li('Export to Excel', sub: 'A .csv file you can open in Excel or Google Sheets', icon: Icons.table_chart_outlined, onTap: busy ? null : exportCsv),
        ]),
        const SectionLabel('Danger zone'),
        Group([Li('Clear all data…', sub: backedUp ? 'Backup saved. You can clear now.' : 'Save a backup first', icon: Icons.delete_forever_outlined, tone: Tk.red, titleColor: Tk.red, onTap: busy ? null : clearAll)]),
      ]));
}
