import 'package:permission_handler/permission_handler.dart';
import 'package:print_bluetooth_thermal/print_bluetooth_thermal.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'calc.dart';

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

  static String ascii(String s) => s.replaceAll('₹', 'Rs ').replaceAll('×', 'x').replaceAll('·', '-').replaceAll(RegExp(r'[^\x20-\x7E]'), '?');

  static String _two(String a, String b, int w) {
    a = ascii(a);
    b = ascii(b);
    final room = w - b.length - 1;
    if (a.length > room) a = a.substring(0, room < 1 ? 1 : room);
    return a + ' ' * (w - a.length - b.length) + b;
  }

  static String _rs(num v) => 'Rs ${v.toStringAsFixed(v == v.roundToDouble() ? 0 : 2)}';

  /// The ESC/POS bytes of a sale bill (same content as the PDF receipt). [settings] is the shop's settings map.
  static List<int> receipt(Map<String, dynamic> settings, Map<String, dynamic> sale, int w) {
    final b = <int>[0x1B, 0x40];
    void line(String x) {
      b.addAll(ascii(x).codeUnits);
      b.add(10);
    }

    void align(int a) => b.addAll([0x1B, 0x61, a]);
    void bold(bool on) => b.addAll([0x1B, 0x45, on ? 1 : 0]);
    final rule = '-' * w;
    align(1);
    bold(true);
    line('${settings['shopName'] ?? 'Shop'}');
    bold(false);
    for (final k in ['address', 'phone']) {
      if ('${settings[k] ?? ''}'.isNotEmpty) line('${settings[k]}');
    }
    align(0);
    line(rule);
    line(_two('Bill ${sale['bill_no'] ?? '(saving)'}', '', w));
    final when = '${sale['created_at'] ?? ''}'.replaceFirst('T', ' ');
    if (when.length >= 16) line(when.substring(0, 16));
    if ('${sale['customer_name'] ?? ''}'.isNotEmpty) line('${sale['customer_name']}');
    line(rule);
    for (final it in (sale['items'] as List? ?? const []).cast<Map>()) {
      line(_two('${qtyStr(n(it['qty']))} x ${it['name']}', _rs(n(it['price']) * n(it['qty'])), w));
    }
    line(rule);
    if (n(sale['discount']) > 0) line(_two('Discount', '-${_rs(n(sale['discount']))}', w));
    bold(true);
    line(_two('TOTAL', _rs(n(sale['total'])), w));
    bold(false);
    if (n(sale['balance']) > 0) line(_two('Due', _rs(n(sale['balance'])), w));
    line(_two('Paid by ${sale['payment_mode'] ?? 'cash'}', _rs(n(sale['paid'])), w));
    align(1);
    b.add(10);
    line('${settings['billFooter'] ?? ''}'.isNotEmpty ? '${settings['billFooter']}' : 'Thank you!');
    b.addAll([10, 10, 10]);
    return b;
  }

  /// Prints a sale. Returns null when it worked, otherwise a plain-language reason.
  static Future<String?> printSale(Map<String, dynamic> settings, Map<String, dynamic> sale) async {
    final mac = await savedMac();
    if (mac == null) return 'No printer chosen yet. Pick one under More > Receipt printer.';
    await [Permission.bluetoothConnect, Permission.bluetoothScan].request();
    if (!await PrintBluetoothThermal.isPermissionBluetoothGranted) return 'Allow Bluetooth for this app in the phone settings.';
    if (!await PrintBluetoothThermal.bluetoothEnabled) return 'Turn Bluetooth on and try again.';
    if (!await PrintBluetoothThermal.connectionStatus) {
      final ok = await PrintBluetoothThermal.connect(macPrinterAddress: mac);
      if (!ok) return 'Could not reach the printer. Switch it on, keep it close, and try again.';
    }
    final ok = await PrintBluetoothThermal.writeBytes(receipt(settings, sale, await cols()));
    return ok ? null : 'The printer did not accept the bill. Try again.';
  }
}
