import 'package:flutter/material.dart' hide Text;
import 'i18n.dart';
import '../core/thermal.dart';
import 'ds.dart';
import 'theme.dart';

/// Pick the paired Bluetooth thermal printer (pair it first in the phone's Bluetooth settings).
Future<void> printerSheet(BuildContext context) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (ctx) => const _PrinterSheet(),
  );
}

class _PrinterSheet extends StatefulWidget {
  const _PrinterSheet();
  @override
  State<_PrinterSheet> createState() => _PrinterSheetState();
}

class _PrinterSheetState extends State<_PrinterSheet> {
  List<(String, String)> list = [];
  String? mac, name;
  int cols = 32;
  bool loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    mac = await Thermal.savedMac();
    name = await Thermal.savedName();
    cols = await Thermal.cols();
    final p = await Thermal.paired();
    if (!mounted) return;
    setState(() {
      list = [for (final b in p) (b.macAdress, b.name)];
      loading = false;
    });
  }

  @override
  Widget build(BuildContext context) => SafeArea(
        child: ConstrainedBox(
          constraints: BoxConstraints(maxHeight: MediaQuery.of(context).size.height * .8),
          child: ListView(shrinkWrap: true, padding: const EdgeInsets.fromLTRB(16, 0, 16, 16), children: [
            const Text('Receipt printer', style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800)),
            const SizedBox(height: 4),
            Text('Switch the printer on and pair it once in the phone\'s Bluetooth settings. Then pick it here.', style: TextStyle(color: Tk.label2)),
            const SizedBox(height: 12),
            Seg<int>(items: const [(32, '58 mm paper'), (48, '80 mm paper')], value: cols, expand: true, onChanged: (v) async {
              await Thermal.setCols(v);
              setState(() => cols = v);
            }),
            const SizedBox(height: 12),
            if (loading) const Center(child: Padding(padding: EdgeInsets.all(20), child: CircularProgressIndicator())),
            if (!loading && list.isEmpty) const Padding(padding: EdgeInsets.all(12), child: Text('No paired printer found. Pair it in Bluetooth settings, allow Bluetooth for this app, then reopen this screen.')),
            if (list.isNotEmpty)
              Group([
                for (final (m, n) in list)
                  Li(n.isEmpty ? m : n, sub: m, icon: Icons.print, tone: m == mac ? Tk.accent : null, chevron: false, trailing: m == mac ? Icon(Icons.check_circle, color: Tk.accent) : null, onTap: () async {
                    await Thermal.save(m, n);
                    setState(() {
                      mac = m;
                      name = n;
                    });
                  }),
              ]),
            const SizedBox(height: 12),
            Row(children: [
              Expanded(
                child: OutlinedButton(
                  onPressed: mac == null
                      ? null
                      : () async {
                          await Thermal.forget();
                          setState(() {
                            mac = null;
                            name = null;
                          });
                        },
                  child: const Text('Forget printer'),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(child: FilledButton(onPressed: () => Navigator.pop(context), child: const Text('Done'))),
            ]),
          ]),
        ),
      );
}
