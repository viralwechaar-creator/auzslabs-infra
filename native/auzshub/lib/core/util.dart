String ymd(DateTime d) => '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

/// Indian rupee amount with lakh/crore grouping, no decimals unless the amount has paise.
String inr(num v) {
  final neg = v < 0;
  final x = v.abs();
  final whole = x.truncate();
  final paise = ((x - whole) * 100).round();
  var s = '$whole';
  if (s.length > 3) {
    final last3 = s.substring(s.length - 3);
    var rest = s.substring(0, s.length - 3);
    final parts = <String>[];
    while (rest.length > 2) {
      parts.insert(0, rest.substring(rest.length - 2));
      rest = rest.substring(0, rest.length - 2);
    }
    if (rest.isNotEmpty) parts.insert(0, rest);
    s = '${parts.join(',')},$last3';
  }
  final p = paise == 0 ? '' : '.${paise.toString().padLeft(2, '0')}';
  return '${neg ? '-' : ''}₹$s$p';
}
