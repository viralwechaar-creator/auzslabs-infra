/// Pure helpers (no screens, no phone storage) so they can be tested: numbers, rupees, dates and times like the website's Payroll.
library;

double n(dynamic v) {
  if (v is num) return v.toDouble();
  final x = double.tryParse('${v ?? ''}'.replaceAll(',', '').trim());
  return x == null || x.isNaN || x.isInfinite ? 0 : x;
}

double r2(num v) => (v * 100).roundToDouble() / 100;

String qtyStr(num v) => v == v.roundToDouble() ? '${v.toInt()}' : '${r2(v)}';

String _indian(String intPart) {
  if (intPart.length <= 3) return intPart;
  final last3 = intPart.substring(intPart.length - 3);
  var rest = intPart.substring(0, intPart.length - 3);
  rest = rest.replaceAllMapped(RegExp(r'(\d)(?=(\d\d)+$)'), (m) => '${m[1]},');
  return '$rest,$last3';
}

/// ₹1,23,456 (no decimals when whole, else two).
String inr(num v, {int? dp}) {
  final d = dp ?? (v == v.roundToDouble() ? 0 : 2);
  final s = v.abs().toStringAsFixed(d);
  final parts = s.split('.');
  final body = _indian(parts[0]) + (parts.length > 1 ? '.${parts[1]}' : '');
  return '${v < 0 ? '-' : ''}₹$body';
}

String ymd(DateTime d) => '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

const _mo = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const _moFull = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const _wd = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/// "5 Oct 2026" from a 2026-10-05 string (or an ISO time).
String fmtD(dynamic s, {bool noYear = false, bool weekday = false}) {
  final d = DateTime.tryParse('${s ?? ''}'.length >= 10 ? '${s}'.substring(0, 10) : '${s ?? ''}');
  if (d == null) return '';
  return '${weekday ? '${_wd[d.weekday - 1]}, ' : ''}${d.day} ${_mo[d.month - 1]}${noYear ? '' : ' ${d.year}'}';
}

/// "9:05 AM" in the phone's own time.
String fmtT(dynamic s) {
  final d = DateTime.tryParse('${s ?? ''}')?.toLocal();
  if (d == null) return '';
  final h = d.hour % 12 == 0 ? 12 : d.hour % 12;
  return '$h:${d.minute.toString().padLeft(2, '0')} ${d.hour >= 12 ? 'PM' : 'AM'}';
}

/// "October 2026" from 2026-10 (or 2026-10-01).
String monthName(dynamic m, {bool short = false}) {
  final s = '${m ?? ''}';
  if (s.length < 7) return s;
  final i = int.tryParse(s.substring(5, 7)) ?? 1;
  return '${short ? _mo[i - 1] : _moFull[i - 1]} ${s.substring(0, 4)}';
}

String monthOf(String date) => date.substring(0, 7);

String monthAdd(String m, int by) {
  final y = int.parse(m.substring(0, 4)), mo = int.parse(m.substring(5, 7));
  final t = y * 12 + (mo - 1) + by;
  return '${t ~/ 12}-${(t % 12 + 1).toString().padLeft(2, '0')}';
}

/// 125 minutes -> "2h 5m".
String mins(num m) {
  final t = m.round();
  if (t < 60) return '${t}m';
  final h = t ~/ 60, r = t % 60;
  return r == 0 ? '${h}h' : '${h}h ${r}m';
}

/// What can be done next on a payroll run, from its state and who is looking. Same rules as the website's run page.
/// ids: calculate, submit, approve, approve_finalise, send_back, finalise, pay, close, cancel
List<String> runActions({required String status, required String kind, required bool canRun, required bool canApprove, required bool canPay, required bool needsReview, bool paidInFull = false}) {
  final a = <String>[];
  if (kind == 'legacy' || status == 'cancelled') return a;
  if (status == 'draft' && canRun) a.add('calculate');
  if (['draft', 'calculated'].contains(status) && canRun) {
    if (needsReview || !canApprove) {
      a.add('submit');
    } else {
      a.add('approve_finalise');
    }
  }
  if (status == 'review') {
    if (canApprove) a.add('approve');
    if (canRun || canApprove) a.add('send_back');
  }
  if (status == 'approved') {
    if (canApprove || canRun) a.add('finalise');
    if (canRun || canApprove) a.add('send_back');
  }
  if (status == 'finalized' && canPay) a.add('pay');
  if (status == 'paid' && canApprove) a.add('close');
  if (['draft', 'calculated', 'review', 'approved'].contains(status) && canRun) a.add('cancel');
  return a;
}

/// The payload of pay_me_claim. The attachment is the path the receipt upload returned (or null).
Map<String, dynamic> claimPayload({required String category, required String amount, required String date, String description = '', String? attachment}) => {
      'category': category,
      'amount': n(amount),
      'date': date.trim(),
      'description': description.trim(),
      'attachment': (attachment ?? '').isEmpty ? null : attachment,
    };
