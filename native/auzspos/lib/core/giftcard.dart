/// Gift-card lookup/validation -- the client-side half of the website's giftSheet() in pay.js.
/// The server's redeem_giftcard() RPC (db/068_pos_rebuild.sql) is the real authority (it re-checks
/// expiry, balance and is idempotent per order+amount with a row lock) -- these pure functions only
/// give the cashier quick, offline-safe feedback before the call is made, matching pay.js's own
/// `look()` preview exactly (case-insensitive code match; expiry compared as a plain date string).
library;

/// Finds a tenant's gift-card record by code, case-insensitive, among already-synced `giftcard` kind
/// records -- same match as pay.js's `L('giftcard').find(x => (x.code||'').toUpperCase() === ...)`.
Map<String, dynamic>? findGiftCard(Iterable<Map<String, dynamic>> cards, String code) {
  final want = code.trim().toUpperCase();
  if (want.isEmpty) return null;
  for (final c in cards) {
    if ('${c['code'] ?? ''}'.toUpperCase() == want) return c;
  }
  return null;
}

/// Null when the card can cover [amount] right now; otherwise the exact reason it cannot, worded the
/// same way the server would refuse it. Native pays one bill with ONE tender (see home.dart's
/// `_payOnce`), so -- unlike the website, which can combine a partial gift-card redemption with other
/// tenders toward the same bill -- the card must cover the FULL amount due or the cashier is told so
/// plainly rather than the app silently truncating the redemption.
String? giftCardIssue(Map<String, dynamic> card, num amount) {
  final exp = '${card['exp'] ?? ''}';
  if (exp.isNotEmpty) {
    final d = DateTime.tryParse(exp);
    if (d != null && d.isBefore(DateTime.now().subtract(const Duration(days: 1)))) {
      return 'This gift card expired on $exp';
    }
  }
  final bal = (card['bal'] as num?) ?? 0;
  if (amount > bal) return 'Only ₹$bal on this card -- not enough for the full ${amount == amount.roundToDouble() ? amount.toInt() : amount} due';
  return null;
}
