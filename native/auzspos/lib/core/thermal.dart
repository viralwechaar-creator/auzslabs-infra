import 'package:permission_handler/permission_handler.dart';
import 'package:print_bluetooth_thermal/print_bluetooth_thermal.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'session.dart';

/// Direct receipt printing on a Bluetooth thermal (ESC/POS) printer, 58 mm (32 characters) or 80 mm (48).
class Thermal {
  static Future<String?> savedMac() async => (await SharedPreferences.getInstance()).getString('printer.mac');
  static Future<String?> savedName() async => (await SharedPreferences.getInstance()).getString('printer.name');
  static Future<int> cols() async => (await SharedPreferences.getInstance()).getInt('printer.cols') ?? 32;
  static Future<void> save(String mac, String name) async {
    final p = await SharedPreferences.getInstance();
    await p.setString('printer.mac', mac);
    await p.setString('printer.name', name);
  }

  static Future<void> setCols(int c) async => (await SharedPreferences.getInstance()).setInt('printer.cols', c);
  static Future<void> forget() async {
    final p = await SharedPreferences.getInstance();
    await p.remove('printer.mac');
    await p.remove('printer.name');
  }

  static Future<List<BluetoothInfo>> paired() async {
    await [Permission.bluetoothConnect, Permission.bluetoothScan].request();
    if (!await PrintBluetoothThermal.isPermissionBluetoothGranted) return [];
    return PrintBluetoothThermal.pairedBluetooths;
  }

  static String _ascii(String s) => s.replaceAll('₹', 'Rs ').replaceAll('×', 'x').replaceAll('·', '-').replaceAll(RegExp(r'[^\x20-\x7E]'), '?');

  static String _two(String a, String b, int w) {
    a = _ascii(a);
    b = _ascii(b);
    final room = w - b.length - 1;
    if (a.length > room) a = a.substring(0, room < 1 ? 1 : room);
    return a + ' ' * (w - a.length - b.length) + b;
  }

  static String _inr(num n) => 'Rs ${n.toStringAsFixed(n == n.roundToDouble() ? 0 : 2)}';

  /// Builds the ESC/POS bytes of a bill (same content as the PDF receipt).
  static List<int> receipt(Session s, Map<String, dynamic> o, int w) {
    final t = (o['t'] as Map?) ?? {};
    final b = <int>[0x1B, 0x40];
    void text(String x) => b.addAll(_ascii(x).codeUnits);
    void line(String x) {
      text(x);
      b.add(10);
    }

    void align(int a) => b.addAll([0x1B, 0x61, a]);
    void bold(bool on) => b.addAll([0x1B, 0x45, on ? 1 : 0]);
    final rule = '-' * w;
    align(1);
    bold(true);
    line('${s.cfg['name'] ?? ''}');
    bold(false);
    for (final k in ['addr', 'phone']) {
      if ('${s.cfg[k] ?? ''}'.isNotEmpty) line('${s.cfg[k]}');
    }
    if ('${s.cfg['gstin'] ?? ''}'.isNotEmpty) line('GSTIN ${s.cfg['gstin']}');
    align(0);
    line(rule);
    line(_two('Bill ${o['no']}', '${o['type'] ?? ''}', w));
    final when = '${o['paidAt'] ?? o['created'] ?? ''}'.replaceFirst('T', ' ');
    if (when.length >= 16) line(when.substring(0, 16));
    line(rule);
    for (final l in ((o['lines'] as List?) ?? []).cast<Map>()) {
      final sz = (l['size'] ?? '') != '' ? ' (${l['size']})' : '';
      line(_two('${l['qty']} x ${l['name']}$sz', _inr((l['price'] as num) * (l['qty'] as num)), w));
    }
    line(rule);
    line(_two('Subtotal', _inr((t['sub'] ?? 0) as num), w));
    if (((t['d'] ?? 0) as num) > 0) line(_two('Discount', '-${_inr(t['d'] as num)}', w));
    if (((t['svc'] ?? 0) as num) > 0) line(_two('Service charge', _inr(t['svc'] as num), w));
    if (((t['tax'] ?? 0) as num) > 0) line(_two('Tax', _inr(t['tax'] as num), w));
    if (((t['round'] ?? 0) as num) != 0) line(_two('Round off', _inr(t['round'] as num), w));
    bold(true);
    line(_two('TOTAL', _inr((t['total'] ?? 0) as num), w));
    bold(false);
    for (final p in ((o['pays'] as List?) ?? []).cast<Map>()) {
      line(_two('Paid by ${p['m']}', _inr((p['amt'] ?? 0) as num), w));
    }
    align(1);
    b.add(10);
    line('${s.cfg['ftr'] ?? 'Thank you!'}');
    b.addAll([10, 10, 10]);
    return b;
  }

  /// Prints a bill. Returns null when it worked, otherwise a plain-language reason.
  static Future<String?> printBill(Session s, Map<String, dynamic> o) async {
    final mac = await savedMac();
    if (mac == null) return 'No printer chosen yet. Pick one in More > Printer.';
    await [Permission.bluetoothConnect, Permission.bluetoothScan].request();
    if (!await PrintBluetoothThermal.isPermissionBluetoothGranted) return 'Allow Bluetooth for this app in the phone settings.';
    if (!await PrintBluetoothThermal.bluetoothEnabled) return 'Turn Bluetooth on and try again.';
    if (!await PrintBluetoothThermal.connectionStatus) {
      final ok = await PrintBluetoothThermal.connect(macPrinterAddress: mac);
      if (!ok) return 'Could not reach the printer. Switch it on, keep it close, and try again.';
    }
    final ok = await PrintBluetoothThermal.writeBytes(receipt(s, o, await cols()));
    return ok ? null : 'The printer did not accept the bill. Try again.';
  }
}
