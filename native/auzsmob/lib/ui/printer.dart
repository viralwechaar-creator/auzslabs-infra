import 'package:flutter/material.dart' hide Text;
import '../core/thermal.dart';
import 'ds.dart';
import 'i18n.dart';
import 'mk.dart';
import 'theme.dart';

/// Pick the paired Bluetooth thermal printer (pair it once in the phone's Bluetooth settings first).
Future<void> openPrinterSheet(BuildContext context) async {
  var mac = await Thermal.savedMac();
  var cols = await Thermal.cols();
  final paired = await Thermal.paired();
  if (!context.mounted) return;
  await openSheet(context, 'Receipt printer', (ctx, set) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Text(tr('Switch the printer on and pair it once in the phone\'s Bluetooth settings. Then pick it here.'), style: TextStyle(color: Tk.label2)),
        gap(),
        Seg<int>(expand: true, items: const [(32, '58 mm'), (48, '80 mm')], value: cols, onChanged: (v) async {
          await Thermal.setCols(v);
          set(() => cols = v);
        }),
        gap(),
        if (paired.isEmpty) Text(tr('No paired printer found. Pair it in Bluetooth settings, allow Bluetooth for this app, then reopen this screen.'))
        else Group([
          for (final b in paired)
            Li(b.name.isEmpty ? b.macAdress : b.name, sub: b.macAdress, icon: Icons.print, chevron: false, trailing: b.macAdress == mac ? Icon(Icons.check_circle, color: Tk.accent) : null, onTap: () async {
              await Thermal.save(b.macAdress, b.name);
              set(() => mac = b.macAdress);
            }),
        ]),
      ]), actions: [
    SheetAction('Test print', (ctx) async {
      final why = await Thermal.printSale({'shopName': 'Test print'}, {'items': [{'name': 'Printer works', 'qty': 1, 'price': 0}], 'total': 0, 'paid': 0, 'created_at': DateTime.now().toIso8601String()});
      if (ctx.mounted) toast(ctx, why ?? tr('Printed'), err: why != null);
      return false;
    }, primary: false),
    SheetAction('Forget printer', (ctx) async {
      await Thermal.forget();
      return true;
    }, primary: false, danger: true),
  ]);
}
