// Daily Business Summary: one read-only view combining sales, expenses, purchase spend, wastage
// and day-close status for a single business date -- the four business automations already built
// in this mission (reorder, day-close reminder, Purchase Orders, wastage, the Alerts Center) each
// read one slice of this picture; this view is the first place that puts all of them side by side
// for one day, without inventing a new combined figure for any of them.
//
// Every number here is read through the SAME existing function that already owns that calculation,
// never a second, parallel formula:
//   - sales/bills/payment-mode breakdown/day-close status: dayCash() (console_more.dart, itself a
//     port of the website's dayCash() in app/public/console/p-finance.js).
//   - purchase spend: purchaseRows() (core/purchases.dart) filtered to this one date -- the same
//     normalized reader the Direct-purchase list and the Purchase Orders "Spend this month" KPI
//     already use, so this can never disagree with either of them about what a purchase is worth.
//   - wastage cost: wastageRows()/wastageCost() (core/wastage.dart), called with from==to==this
//     date -- the same reader the Wastage report tab already uses.
// The one genuinely new read is total expenses for the day (ALL payment modes) -- dayCash() only
// ever subtracts the CASH-mode subset of a day's expenses (for drawer reconciliation, a different,
// narrower purpose), so a summary wanting "what did the business spend today" cannot reuse that
// number without quietly changing what it means. Confirmed directly against dayCash()'s own source
// in console_more.dart: `exp` there is a private local variable, never exposed on `_DayCash`, so
// there is nothing of the wrong shape to accidentally reuse here.
//
// Sales, expenses, purchase spend and wastage cost are kept as four SEPARATE fields, each clearly
// its own number, on purpose -- this file never sums them into a "profit" or "net cash flow" figure.
// A true profit figure needs COGS, tax and other inputs this view does not have reliably for every
// tenant; the existing Console dashboard already has its own, separately-labelled "Profit (rough)"
// tile (sales minus expenses only) -- that tile is untouched by this file and is not duplicated or
// contradicted here, since this file simply never computes a combined figure of its own.
import 'package:flutter/material.dart' hide Text;
import '../core/purchases.dart' show purchaseRows;
import '../core/repo.dart';
import '../core/wastage.dart' show wastageCost, wastageRows;
import 'console.dart' show Kpis, dayKey;
import 'console_more.dart' show dayCash;
import 'ds.dart';
import 'home.dart' show HomeState, inr;
import 'i18n.dart';
import 'theme.dart';

class DailySummary {
  DailySummary({
    required this.date,
    required this.isToday,
    required this.salesNet,
    required this.bills,
    required this.cash,
    required this.card,
    required this.online,
    required this.other,
    required this.expensesTotal,
    required this.purchaseSpend,
    required this.purchaseCount,
    required this.wastageCost,
    required this.wastageEntries,
    required this.closed,
    required this.pendingSync,
  });

  /// 'YYYY-MM-DD', the business date this summary is for.
  final String date;

  /// True when [date] is the device's own current local date -- the day is still in progress, so
  /// every figure here is necessarily a running total, not a final one (the day is not expected to
  /// be closed yet; see findDayNeedingClose() for that judgement, which this file does not repeat).
  final bool isToday;

  /// Net revenue of paid bills on this date (dayCash()'s own `sales`), and how many bills that is.
  final num salesNet;
  final int bills;

  /// Payment-mode breakdown of that same sales figure -- dayCash()'s own cash/card/other/online,
  /// unchanged (including its own change-given subtraction on cash sales).
  final num cash, card, online, other;

  /// ALL expenses recorded for this date, in every payment mode -- deliberately NOT the cash-only
  /// subset dayCash() uses internally for drawer reconciliation (see file header). This is "what
  /// the business spent today," not "what left the cash drawer today."
  final num expensesTotal;

  /// Total value of purchases (direct or Purchase-Order-received) dated this day, and how many
  /// purchase records that is -- read through purchaseRows(), the same normalizer every other
  /// purchase screen in this app already uses.
  final num purchaseSpend;
  final int purchaseCount;

  /// Total cost of wastage recorded on this date, and how many wastage entries that is.
  final num wastageCost;
  final int wastageEntries;

  /// Whether this date has a `dayclose` record -- dayCash()'s own `close` field, the same lookup
  /// the Cash Management screen and the day-close reminder already use.
  final bool closed;

  /// The LOCAL device's own outbox length at the moment this summary was built (Repo.pending) --
  /// not zero just because every figure above happens to look complete. A non-zero value means
  /// this device has local changes not yet confirmed by the server, so this summary (like every
  /// other screen in this app that reads the same Repo) is only as current as the last successful
  /// sync, not necessarily "right now." This file never claims otherwise.
  final int pendingSync;
}

/// Builds the Daily Business Summary for [date] ('YYYY-MM-DD'). Reads only the local Repo -- the
/// exact same data every other report/reminder/alert in this app already reads -- so it works
/// offline exactly as well (or as staleness-limited) as they do, and respects tenant isolation for
/// free (whichever tenant's Repo is passed in is the only data that can ever appear).
DailySummary buildDailySummary(Repo repo, String date, {DateTime? now}) {
  final cash = dayCash(repo, date);
  final expensesTotal = repo.of('exp').where((e) => '${e['d'] ?? ''}' == date).fold<num>(0, (a, e) => a + ((e['amt'] ?? 0) as num));
  final purchasesToday = purchaseRows(repo).where((p) => p.date == date).toList();
  final purchaseSpend = purchasesToday.fold<num>(0, (a, p) => a + p.amount);
  final wasteToday = wastageRows(repo, from: date, to: date);
  final wasteSpend = wasteToday.fold<num>(0, (a, w) => a + wastageCost(repo, w));

  return DailySummary(
    date: date,
    isToday: date == dayKey(now ?? DateTime.now()),
    salesNet: cash.sales,
    bills: cash.bills,
    cash: cash.cash,
    card: cash.card,
    online: cash.online,
    other: cash.other,
    expensesTotal: expensesTotal,
    purchaseSpend: purchaseSpend,
    purchaseCount: purchasesToday.length,
    wastageCost: wasteSpend,
    wastageEntries: wasteToday.length,
    closed: cash.close != null,
    pendingSync: repo.pending,
  );
}

/// The read-only console page, reachable from Reports -> Daily Summary. Shows one day at a time
/// (Today or Yesterday only, by design -- a wider date-range view belongs on the existing Sales
/// Reports page, which already has one; this page's job is a quick "how did today/yesterday go
/// across every area" check, not a second report builder). Nothing here writes anything: it only
/// ever calls buildDailySummary(), a pure read.
class DailySummaryPage extends StatefulWidget {
  const DailySummaryPage(this.h, {super.key});
  final HomeState h;
  @override
  State<DailySummaryPage> createState() => _DailySummaryPageState();
}

class _DailySummaryPageState extends State<DailySummaryPage> {
  int _offset = 0; // 0 = today, 1 = yesterday
  HomeState get h => widget.h;

  @override
  Widget build(BuildContext context) {
    final now = DateTime.now();
    final date = dayKey(now.subtract(Duration(days: _offset)));
    final s = buildDailySummary(h.s.repo!, date, now: now);

    return ListView(padding: const EdgeInsets.only(bottom: 28), children: [
      const PageHead('Daily Summary', sub: 'Sales, expenses, purchases and wastage for one day -- kept separate, never added together.'),
      Padding(
        padding: const EdgeInsets.fromLTRB(16, 4, 16, 10),
        child: Row(children: [
          for (final (v, l) in const [(0, 'Today'), (1, 'Yesterday')])
            Padding(
              padding: const EdgeInsets.only(right: 10),
              child: GestureDetector(
                onTap: () => setState(() => _offset = v),
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 10),
                  decoration: BoxDecoration(color: _offset == v ? Tk.accent : Tk.card, borderRadius: BorderRadius.circular(22), border: Border.all(color: _offset == v ? Tk.accent : Tk.line)),
                  child: Text(l, style: TextStyle(fontSize: 17, fontWeight: FontWeight.w600, color: _offset == v ? Colors.white : Tk.label)),
                ),
              ),
            ),
        ]),
      ),
      if (s.pendingSync > 0)
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 10),
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
            decoration: BoxDecoration(color: Tk.orange.withValues(alpha: .1), borderRadius: BorderRadius.circular(14), border: Border.all(color: Tk.orange.withValues(alpha: .35))),
            child: Row(children: [
              Icon(Icons.cloud_off_outlined, size: 18, color: Tk.orange),
              const SizedBox(width: 8),
              Expanded(child: Text('${s.pendingSync} change${s.pendingSync == 1 ? '' : 's'} on this device not yet confirmed by the server -- these figures may still change once they sync.', style: TextStyle(fontSize: 13, color: Tk.orange, fontWeight: FontWeight.w600))),
            ]),
          ),
        ),
      Kpis(
        'Sales (${s.bills} bill${s.bills == 1 ? '' : 's'})',
        inr(s.salesNet),
        s.isToday ? 'Still in progress -- today\'s numbers are running totals' : (s.closed ? 'Day closed' : 'Not closed yet'),
        [
          ('Expenses', inr(s.expensesTotal), Tk.red),
          ('Purchases', inr(s.purchaseSpend), Tk.orange),
          ('Wastage', inr(s.wastageCost), Tk.red),
        ],
      ),
      Group([
        Li('Cash', icon: Icons.payments_outlined, value: inr(s.cash), chevron: false),
        Li('Card', icon: Icons.credit_card_outlined, value: inr(s.card), chevron: false),
        Li('Online / UPI', icon: Icons.qr_code_outlined, value: inr(s.online), chevron: false),
        Li('Other', icon: Icons.more_horiz, value: inr(s.other), chevron: false),
      ]),
      Group([
        Li('Purchases this day', sub: '${s.purchaseCount} record${s.purchaseCount == 1 ? '' : 's'}', icon: Icons.local_shipping_outlined, value: inr(s.purchaseSpend), chevron: false),
        Li('Wastage this day', sub: '${s.wastageEntries} entr${s.wastageEntries == 1 ? 'y' : 'ies'}', icon: Icons.delete_outline, tone: Tk.red, value: inr(s.wastageCost), chevron: false),
        Li(s.closed ? 'Day closed' : (s.isToday ? 'Day still open (in progress)' : 'Not closed yet'), icon: s.closed ? Icons.lock_outline : Icons.lock_open_outlined, tone: s.closed ? Tk.green : (s.isToday ? Tk.label2 : Tk.orange), chevron: false),
      ]),
    ]);
  }
}
