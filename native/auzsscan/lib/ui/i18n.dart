import 'package:flutter/material.dart' as m;
import 'package:flutter/widgets.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'hi_map.dart';

/// English / Hindi. The choice is saved on the phone; [rev] changes so the whole app redraws.
class Lang {
  static String code = 'en';
  static final ValueNotifier<int> rev = ValueNotifier(0);
  static bool get hi => code == 'hi';
  static Future<void> load() async => code = (await SharedPreferences.getInstance()).getString('lang') ?? 'en';
  static Future<void> set(String c) async {
    code = c;
    await (await SharedPreferences.getInstance()).setString('lang', c);
    rev.value++;
  }
}

/// Translates a fixed label. Text that is not in the Hindi list stays as written.
String tr(String s) {
  if (!Lang.hi) return s;
  return hiMap[s] ?? _pattern(s);
}

final _count = RegExp(r'^(\d+) (items?|orders?|customers?|tables?|bills?)$');
String _pattern(String s) {
  final c = _count.firstMatch(s);
  if (c != null) {
    final w = {'item': 'आइटम', 'order': 'ऑर्डर', 'customer': 'ग्राहक', 'table': 'टेबल', 'bill': 'बिल'}[c.group(2)!.replaceAll(RegExp(r's$'), '')];
    return '${c.group(1)} $w';
  }
  return s;
}

/// Drop-in for Flutter's Text that translates fixed labels when Hindi is on.
class Text extends StatelessWidget {
  const Text(this.data, {super.key, this.style, this.textAlign, this.maxLines, this.overflow, this.softWrap});
  final String data;
  final TextStyle? style;
  final TextAlign? textAlign;
  final int? maxLines;
  final TextOverflow? overflow;
  final bool? softWrap;
  @override
  Widget build(BuildContext context) => m.Text(tr(data), style: style, textAlign: textAlign, maxLines: maxLines, overflow: overflow, softWrap: softWrap);
}

/// Translates a template with {blanks} ("Not synced ({n})"), then fills the blanks in.
String trv(String template, Map<String, Object?> vars) {
  var s = tr(template);
  vars.forEach((k, v) => s = s.replaceAll('{$k}', '$v'));
  return s;
}
