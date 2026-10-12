import 'dart:io';
import 'dart:convert';
import 'package:flutter/material.dart' hide Text;
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';
import '../core/session.dart';
import 'i18n.dart';
import 'mk.dart';

/// Backup / export / clear all data (business owner only). Same server calls as the website's "My data" panel.
void openMyData(BuildContext c, MobSession s) {
  var backedUp = false;
  final confirmCtl = TextEditingController();
  Future<Map<String, dynamic>?> fetch(BuildContext ctx) async {
    try {
      return Map<String, dynamic>.from(await s.api.rpc('my_data_export') as Map);
    } catch (e) {
      if (ctx.mounted) toast(ctx, '$e', err: true);
      return null;
    }
  }

  Future<void> share(BuildContext ctx, String name, String text) async {
    final dir = await getTemporaryDirectory();
    final f = File('${dir.path}/$name');
    await f.writeAsString(text);
    await SharePlus.instance.share(ShareParams(files: [XFile(f.path)], text: name));
  }

  openSheet(c, 'My data', (ctx, set) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Text(tr('Only the business owner can use these. Passwords and secrets are never included.')),
        gap(),
        OutlinedButton(onPressed: () async {
          final d = await fetch(ctx);
          if (d == null) return;
          await share(ctx, 'auzslab-backup-${(d['business'] as Map)['slug']}.json', const JsonEncoder.withIndent(' ').convert(d));
          set(() => backedUp = true);
        }, child: const Text('Backup (full copy, .json)')),
        gap(8),
        Text(tr('This permanently deletes your orders, bills, customers, stock, staff attendance, payroll runs and accounting entries in every AUZslab app. Your logins, settings, plan and menu setup stay. It cannot be undone.')),
        gap(),
        Fld('Type your business address name to confirm', confirmCtl),
      ]), actions: [
    SheetAction('Clear all data now', (ctx) async {
      if (!backedUp) {
        toast(ctx, tr('Download the backup first (button above).'), err: true);
        return false;
      }
      await s.api.rpc('my_data_clear', {'p_confirm': confirmCtl.text.trim()});
      await s.repo!.wipeLocal();
      if (c.mounted) toast(c, tr('All data cleared.'));
      return true;
    }, danger: true),
  ]);
}
