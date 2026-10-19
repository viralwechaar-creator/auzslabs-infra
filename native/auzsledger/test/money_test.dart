import 'package:flutter/material.dart' hide Text;
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:auzsledger/core/api.dart';
import 'package:auzsledger/core/calc.dart';
import 'package:auzsledger/core/session.dart';
import 'package:auzsledger/core/store.dart';
import 'package:auzsledger/ui/p_books.dart';
import 'package:auzsledger/ui/theme.dart';

/// Stage 1 (Collect / Pay suppliers parity): KPI maths, the ageing dashboard, the Collect/Pay
/// action (including the duplicate-payment guard acc_save_payment itself has no protection
/// against), payment detail (allocations, journal lines, cancel-with-reason) and error handling.
/// Mirrors the website's own moneyPage()/page('payment',...) in app/public/accounts/p-money.js,
/// using the exact same RPCs (acc_ageing, acc_list_payments, acc_get_payment, acc_save_payment,
/// acc_cancel_payment) -- nothing here is a new or invented backend call.

class _Api extends ApiClient {
  final saveCalls = <Map<String, dynamic>>[];
  final cancelCalls = <Map<String, dynamic>>[];
  ApiError? failAgeing, failSave, failCancel;
  int ageingCalls = 0;

  @override
  Future<dynamic> rpc(String fn, [Map<String, dynamic> args = const {}]) async {
    switch (fn) {
      case 'my_dashboard':
        return {'my_role': 'owner', 'my_email': 'o@x.in', 'tenant': {'slug': 'nbw', 'name': 'New Book World'}, 'features': {'accounting': true}, 'enabled_features': {}};
      case 'acc_bootstrap':
        return {
          'org': {'state_code': '08', 'reg_type': 'regular', 'trade_name': 'New Book World'},
          'perms': {'acc_view': true, 'acc_sales': true, 'acc_purchase': true, 'acc_cancel': true, 'acc_admin': false},
          'accounts': [
            {'id': 'cash1', 'is_cash': true, 'active': true, 'name': 'Cash'},
            {'id': 'bank1', 'is_bank': true, 'active': true, 'name': 'Bank'},
          ],
          'taxcodes': [
            {'kind': 'taxable', 'rate': 0, 'active': true},
          ],
          'branches': [], 'warehouses': [],
        };
      case 'acc_list_products':
        return {'rows': []};
      case 'acc_list_parties':
        return {'rows': [
          {'id': 'pt1', 'name': 'Ravi', 'kind': 'customer', 'active': true},
          {'id': 'pt2', 'name': 'Sharma Traders', 'kind': 'supplier', 'active': true},
        ]};
      case 'acc_ageing':
        ageingCalls++;
        if (failAgeing != null) throw failAgeing!;
        final receivable = (args['p'] as Map)['kind'] == 'receivable';
        return receivable
            ? {
                'kind': 'receivable', 'as_of': '2026-10-16',
                'rows': [
                  {'party_id': 'pt1', 'name': 'Ravi', 'phone': '999', 'current': 500.0, 'd30': 200.0, 'd60': 0, 'd90': 0, 'd90p': 0, 'advance': 0, 'total': 700.0},
                ],
                'totals': {'current': 500.0, 'd30': 200.0, 'd60': 0, 'd90': 0, 'd90p': 0, 'advance': 0, 'total': 700.0},
              }
            : {
                'kind': 'payable', 'as_of': '2026-10-16',
                'rows': [
                  {'party_id': 'pt2', 'name': 'Sharma Traders', 'phone': '888', 'current': 0, 'd30': 0, 'd60': 0, 'd90': 300.0, 'd90p': 0, 'advance': -50.0, 'total': 250.0},
                ],
                'totals': {'current': 0, 'd30': 0, 'd60': 0, 'd90': 300.0, 'd90p': 0, 'advance': -50.0, 'total': 250.0},
              };
      case 'acc_list_payments':
        return {'rows': [
          {'id': 'pay1', 'kind': (args['p'] as Map)['kind'], 'number': 'RCT/1', 'pay_date': '2026-10-01', 'party_name': 'Ravi', 'amount': 500.0, 'allocated': 500.0, 'unallocated': 0, 'mode': 'Cash', 'status': 'posted', 'account': 'Cash'},
        ]};
      case 'acc_list_documents':
        return {'rows': [
          {'id': 'doc1', 'number': 'INV/1', 'status': 'posted', 'doc_date': '2026-09-01', 'due_date': '2026-09-15', 'outstanding': 700.0},
        ]};
      case 'acc_save_payment':
        saveCalls.add(Map<String, dynamic>.from(args['p'] as Map));
        if (failSave != null) throw failSave!;
        return {'id': 'pay2', 'number': 'RCT/2', 'amount': (args['p'] as Map)['amount'], 'allocated': 0, 'unallocated': (args['p'] as Map)['amount']};
      case 'acc_get_payment':
        return {
          'payment': {'id': 'pay1', 'kind': 'receipt', 'number': 'RCT/1', 'pay_date': '2026-10-01', 'party_id': 'pt1', 'amount': 500.0, 'allocated': 500.0, 'mode': 'Cash', 'reference': 'UTR123', 'notes': 'Thanks', 'status': 'posted', 'cancel_reason': null},
          'party': {'id': 'pt1', 'name': 'Ravi'},
          'account': 'Cash',
          'allocations': [
            {'id': 'al1', 'amount': 500.0, 'doc_id': 'doc1', 'doc_number': 'INV/1', 'doc_type': 'invoice', 'reversed': false},
          ],
          'journal_lines': [
            {'account': 'Cash', 'debit': 500.0, 'credit': 0},
            {'account': 'Accounts receivable', 'debit': 0, 'credit': 500.0},
          ],
          'journal': {'id': 'j1', 'number': 'JNL/1'},
          'attachments': [
            {'name': 'receipt.jpg', 'created_at': '2026-10-01T10:00:00Z'},
          ],
        };
      case 'acc_cancel_payment':
        cancelCalls.add(Map<String, dynamic>.from(args));
        if (failCancel != null) throw failCancel!;
        return {'id': args['p_payment'], 'status': 'cancelled'};
    }
    return null;
  }
}

class _S extends LedgerSession {
  _S(this._a);
  final _Api _a;
  @override
  ApiClient get api => _a;
}

Future<(_S, _Api)> boot(WidgetTester t) async {
  SharedPreferences.setMockInitialValues({});
  final api = _Api();
  final s = _S(api);
  // openWith() starts a real Timer.periodic(60s) (the background flush loop); run it outside
  // the fake-async test zone, exactly like every other test file in this suite, or that timer
  // never settles and the test hangs forever instead of finishing in milliseconds.
  await t.runAsync(() => s.openWith({'id': 'u1', 'email': 'o@x.in'}, MemoryStore()));
  return (s, api);
}

void phone(WidgetTester t) {
  t.view.physicalSize = const Size(1080, 2200);
  t.view.devicePixelRatio = 2.75;
  addTearDown(t.view.reset);
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  // ---- pure KPI/ageing math (no widget, same formula as the website's moneyPage()) ----
  group('ageingOverdue', () {
    test('sums the three overdue buckets, excludes current and advance', () {
      expect(ageingOverdue({'current': 500, 'd30': 200, 'd60': 0, 'd90': 0, 'd90p': 0, 'advance': -1000}), 200);
      expect(ageingOverdue({'d30': 100, 'd60': 50, 'd90': 25, 'd90p': 10}), 185);
      expect(ageingOverdue({}), 0);
    });
  });

  // ---- Collect dashboard ----
  testWidgets('Collect shows the KPI totals and the ageing list from acc_ageing, not a flat list', (t) async {
    phone(t);
    final (s, api) = await boot(t);
    await t.pumpWidget(MaterialApp(theme: Tk.theme(), home: MoneyPage(s, kind: 'receipt')));
    await t.pump(const Duration(milliseconds: 300));
    expect(find.text('Collect'), findsWidgets, reason: 'the website calls this page Collect, not "Receipts and payments"');
    expect(find.textContaining('700'), findsWidgets, reason: 'To collect KPI (acc_ageing totals.total)');
    expect(find.textContaining('200'), findsWidgets, reason: 'Overdue KPI = d30+d60+d90+d90p = 200 for this fixture');
    expect(find.textContaining('500'), findsWidgets, reason: 'Not yet due KPI = totals.current');
    expect(find.text('Ravi'), findsWidgets, reason: 'the ageing row for the one customer with a balance');
    expect(find.text('Collect'), findsWidgets);
    expect(t.takeException(), isNull);
  });

  testWidgets('Pay suppliers shows "To pay" and the advance note for a negative advance bucket', (t) async {
    phone(t);
    final (s, _) = await boot(t);
    await t.pumpWidget(MaterialApp(theme: Tk.theme(), home: MoneyPage(s, kind: 'payment')));
    await t.pump(const Duration(milliseconds: 300));
    expect(find.text('Pay suppliers'), findsWidgets);
    expect(find.textContaining('300'), findsWidgets, reason: 'Overdue KPI for the payable side (only d90 is set)');
    expect(find.textContaining('in advances'), findsWidgets);
    expect(find.text('Sharma Traders'), findsWidgets);
    expect(t.takeException(), isNull);
  });

  testWidgets('tapping a recent payment opens the payment detail page with allocations and journal lines', (t) async {
    phone(t);
    final (s, _) = await boot(t);
    await t.pumpWidget(MaterialApp(theme: Tk.theme(), home: MoneyPage(s, kind: 'receipt')));
    await t.pump(const Duration(milliseconds: 300));
    await t.ensureVisible(find.textContaining('RCT/1'));
    await t.pump(const Duration(milliseconds: 100));
    await t.tap(find.textContaining('RCT/1'));
    await t.pump(const Duration(milliseconds: 300));
    await t.pump(const Duration(milliseconds: 300));
    expect(find.textContaining('INV/1'), findsWidgets, reason: 'the allocation against the original invoice');
    expect(find.textContaining('Accounts receivable'), findsWidgets, reason: 'the journal line the receipt actually posted');
    expect(find.text('receipt.jpg'), findsWidgets, reason: 'attachment is listed (read-only -- no download action exists yet)');
    expect(t.takeException(), isNull);
  });

  testWidgets('cancelling a payment needs a non-empty reason and calls acc_cancel_payment exactly once', (t) async {
    phone(t);
    final (s, api) = await boot(t);
    await t.pumpWidget(MaterialApp(theme: Tk.theme(), home: PaymentDetailPage(s, 'pay1')));
    await t.pump(const Duration(milliseconds: 300));
    await t.tap(find.byIcon(Icons.cancel_outlined));
    await t.pump(const Duration(milliseconds: 200));
    // Empty reason: confirm the dialog with nothing typed.
    await t.tap(find.text('Cancel payment'));
    await t.pump(const Duration(milliseconds: 200));
    expect(api.cancelCalls, isEmpty, reason: 'an empty reason must never reach acc_cancel_payment');
    await t.tap(find.byIcon(Icons.cancel_outlined));
    await t.pump(const Duration(milliseconds: 200));
    await t.enterText(find.byType(TextField), 'Customer asked to redo it');
    await t.tap(find.text('Cancel payment'));
    await t.pump(const Duration(milliseconds: 300));
    expect(api.cancelCalls, hasLength(1));
    expect(api.cancelCalls.single['p_payment'], 'pay1');
    expect(api.cancelCalls.single['p_reason'], 'Customer asked to redo it');
    expect(t.takeException(), isNull);
  });

  testWidgets('a genuine refusal (e.g. already cancelled) is shown as an error, not silently retried', (t) async {
    phone(t);
    final (s, api) = await boot(t);
    api.failCancel = ApiError('RCT/1 is already cancelled', status: 400);
    await t.pumpWidget(MaterialApp(theme: Tk.theme(), home: PaymentDetailPage(s, 'pay1')));
    await t.pump(const Duration(milliseconds: 300));
    await t.tap(find.byIcon(Icons.cancel_outlined));
    await t.pump(const Duration(milliseconds: 200));
    await t.enterText(find.byType(TextField), 'test');
    await t.tap(find.text('Cancel payment'));
    await t.pump(const Duration(milliseconds: 300));
    expect(find.text('RCT/1 is already cancelled'), findsOneWidget);
    expect(t.takeException(), isNull);
  });

  testWidgets('a failed ageing load shows the retry screen, not a crash or a blank page', (t) async {
    phone(t);
    final (s, _) = await boot(t);
    final api = (s.api as _Api)..failAgeing = ApiError('down', networkError: true);
    api.failAgeing = ApiError('down', networkError: true);
    await t.pumpWidget(MaterialApp(theme: Tk.theme(), home: MoneyPage(s, kind: 'receipt')));
    await t.pump(const Duration(milliseconds: 300));
    expect(find.text('Try again'), findsOneWidget);
    expect(t.takeException(), isNull);
  });

  // ---- duplicate-payment guard: acc_save_payment itself has no idempotency key ----
  testWidgets('tapping Record receipt twice in quick succession sends acc_save_payment only once', (t) async {
    phone(t);
    final (s, api) = await boot(t);
    await t.pumpWidget(MaterialApp(theme: Tk.theme(), home: MoneyPage(s, kind: 'receipt')));
    await t.pump(const Duration(milliseconds: 300));
    // "Collect" on Ravi's ageing row pre-fills the party, so the sheet opens with no dropdown
    // to drive -- only the amount needs typing before Record receipt is reachable.
    await t.tap(find.widgetWithText(OutlinedButton, 'Collect'));
    await t.pump(const Duration(milliseconds: 300));
    await t.enterText(find.widgetWithText(TextField, 'Amount (₹)'), '500');
    await t.pump(const Duration(milliseconds: 200));
    final btnFinder = find.ancestor(of: find.text('Record receipt'), matching: find.byType(FilledButton));
    expect(btnFinder, findsOneWidget);
    final btn = t.widget(btnFinder) as FilledButton;
    // Fire both taps before either completes -- this is exactly the double-tap acc_save_payment
    // itself cannot deduplicate; the native-side guard must catch it instead.
    btn.onPressed!();
    btn.onPressed!();
    await t.pump(const Duration(milliseconds: 50));
    await t.pump(const Duration(milliseconds: 300));
    expect(api.saveCalls, hasLength(1), reason: 'the second, overlapping tap must be dropped by the in-flight guard, not sent to the server');
    expect(t.takeException(), isNull);
  });
}
