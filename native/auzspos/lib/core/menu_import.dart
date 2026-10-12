/// Reads a menu typed or pasted as rows: Category, Item, Price, Type (veg / non-veg / egg, optional), Description (optional).
/// Comma, semicolon or tab separated; quotes allowed; a first row that says "category / item / price" is skipped.
class MenuRow {
  MenuRow(this.cat, this.name, this.price, this.veg, this.desc);
  final String cat, name, veg, desc;
  final num price;
}

class MenuParse {
  MenuParse(this.rows, this.problems);
  final List<MenuRow> rows;
  final List<String> problems; // one plain sentence per skipped line
}

List<String> _split(String line, String sep) {
  final out = <String>[];
  final b = StringBuffer();
  var q = false;
  for (var i = 0; i < line.length; i++) {
    final c = line[i];
    if (c == '"') {
      if (q && i + 1 < line.length && line[i + 1] == '"') {
        b.write('"');
        i++;
      } else {
        q = !q;
      }
    } else if (c == sep && !q) {
      out.add(b.toString().trim());
      b.clear();
    } else {
      b.write(c);
    }
  }
  out.add(b.toString().trim());
  return out;
}

String _vegOf(String t) {
  final x = t.toLowerCase().replaceAll(RegExp(r'[^a-z]'), '');
  if (x.startsWith('non') || x == 'nv' || x == 'n' || x == 'chicken' || x == 'meat') return 'nonveg';
  if (x.startsWith('egg') || x == 'e') return 'egg';
  return 'veg';
}

MenuParse parseMenuText(String text) {
  final rows = <MenuRow>[];
  final problems = <String>[];
  final lines = text.split(RegExp(r'\r?\n')).where((l) => l.trim().isNotEmpty).toList();
  var n = 0;
  for (final line in lines) {
    n++;
    final sep = line.contains('\t') ? '\t' : (line.contains(';') && !line.contains(',') ? ';' : ',');
    final p = _split(line, sep);
    if (n == 1 && p.length >= 3 && RegExp(r'^(category|cat|group)$', caseSensitive: false).hasMatch(p[0]) && num.tryParse(p[2].replaceAll(RegExp(r'[^0-9.]'), '')) == null) continue;
    if (p.length < 3) {
      problems.add('Line $n skipped: needs Category, Item and Price.');
      continue;
    }
    final price = num.tryParse(p[2].replaceAll(RegExp(r'[^0-9.]'), ''));
    if (p[0].isEmpty || p[1].isEmpty) {
      problems.add('Line $n skipped: the category or item name is empty.');
      continue;
    }
    if (price == null || price < 0) {
      problems.add('Line $n ("${p[1]}") skipped: the price is not a number.');
      continue;
    }
    rows.add(MenuRow(p[0], p[1], price, p.length > 3 ? _vegOf(p[3]) : 'veg', p.length > 4 ? p[4] : ''));
  }
  return MenuParse(rows, problems);
}
