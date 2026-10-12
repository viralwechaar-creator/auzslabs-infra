import 'package:flutter/material.dart';
import '../core/calc.dart';

class SellLine {
  SellLine(this.p, {this.qty = 1, String? rate}) : rate = rate ?? '${p['sale_price'] ?? 0}';
  Map<String, dynamic> p;
  double qty;
  String rate, disc = '', dtype = 'pct';
  String? gst; // GST for this bill only
  double gstRate() => gst != null && gst!.isNotEmpty ? n(gst) : n(p['tax_rate']);
}

class RecvLine {
  RecvLine(this.p, {this.qty = 1, String? cost}) : cost = cost ?? '${p['avg_cost'] ?? p['purchase_price'] ?? ''}';
  Map<String, dynamic> p;
  double qty;
  String cost;
}

/// The bill (or stock receipt) being made. Kept above the tabs so switching tab never loses it.
class ScanCart extends ChangeNotifier {
  String mode = 'sell'; // sell | add
  final sell = <SellLine>[];
  final recv = <RecvLine>[];
  final name = TextEditingController(), phone = TextEditingController(), ref = TextEditingController();
  Map<String, dynamic>? party;
  String pay = 'cash';
  bool? incl;

  void changed() => notifyListeners();
  void setMode(String m) {
    mode = m;
    notifyListeners();
  }

  int get count => mode == 'sell' ? sell.length : recv.length;
  double get units => mode == 'sell' ? sell.fold(0.0, (a, l) => a + l.qty) : recv.fold(0.0, (a, l) => a + l.qty);

  void reset() {
    sell.clear();
    recv.clear();
    name.clear();
    phone.clear();
    ref.clear();
    party = null;
    pay = 'cash';
    incl = null;
    notifyListeners();
  }

  /// Lines as the books' GST maths wants them.
  List<Map<String, dynamic>> calcLines() => [
        for (final l in sell)
          {'qty': l.qty, 'rate': l.rate, 'disc_pct': l.dtype == 'pct' ? l.disc : '', 'disc_amt': l.dtype == 'amt' ? l.disc : '', 'tax_rate': l.gstRate()}
      ];
}
