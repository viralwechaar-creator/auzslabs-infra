import 'dart:convert';
import 'dart:io';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart' hide Text;
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';
import '../core/api.dart';
import '../core/calc.dart';
import '../core/session.dart';
import 'ds.dart';
import 'i18n.dart';
import 'kit.dart';
import 'lv.dart';
import 'mk.dart';
import 'p_reports.dart' show csvText;
import 'theme.dart';

List<Map<String, dynamic>> _maps(dynamic l) => ((l as List?) ?? const []).map((e) => Map<String, dynamic>.from(e as Map)).toList();
Map<String, dynamic> _map(dynamic m) => m is Map ? Map<String, dynamic>.from(m) : <String, dynamic>{};

Future<String?> _pickCsv() async {
  final r = await FilePicker.platform.pickFiles(type: FileType.custom, allowedExtensions: const ['csv', 'txt'], withData: true);
  final f = r?.files.firstOrNull;
  if (f == null) return null;
  final bytes = f.bytes ?? await File(f.path!).readAsBytes();
  return utf8.decode(bytes, allowMalformed: true);
}

Future<void> _shareCsv(BuildContext c, String name, List<List<Object?>> rows) async {
  try {
    final f = File('${(await getTemporaryDirectory()).path}/$name.csv');
    await f.writeAsString('﻿${csvText(rows)}');
    await SharePlus.instance.share(ShareParams(files: [XFile(f.path)], text: name));
  } catch (e) {
    if (c.mounted) toast(c, '$e', err: true);
  }
}

// ---------------------------------------------------------------- receipts and payments

/// Money received from customers / paid to suppliers: ageing dashboard (matches the website's
/// moneyPage() in p-money.js -- same acc_ageing/acc_list_payments RPCs, same KPI shape), the
/// existing settle-oldest-first "Receive/Pay money" sheet, and a tappable Recent list leading
/// to the full payment detail (allocations, journal lines, cancel).
class MoneyPage extends StatefulWidget {
  const MoneyPage(this.s, {required this.kind, super.key});
  final LedgerSession s;
  /// 'receipt' (Collect, money in from customers) or 'payment' (Pay suppliers, money out).
  final String kind;
  @override
  State<MoneyPage> createState() => _MoneyPageState();
}

class _MoneyPageState extends State<MoneyPage> {
  LedgerSession get s => widget.s;
  String get kind => widget.kind;
  bool get isIn => kind == 'receipt';
  int tick = 0;
  // Re-entrancy guard: acc_save_payment has no client-side idempotency key (unlike the
  // offline-draft RPCs), so a double tap would create two real payments server-side. Guarded
  // here rather than in the shared openSheet()/SheetAction widget, which every other screen's
  // sheet relies on unchanged.
  bool _submitting = false;

  bool get canWrite => s.can(isIn ? 'acc_sales' : 'acc_purchase') || s.can('acc_admin');

  void _new({Map<String, dynamic>? presetParty}) {
    var party = presetParty;
    var loadedPreset = presetParty == null; // true once the preset party's own docs are fetched
    var docs = <Map<String, dynamic>>[];
    final amt = TextEditingController(), ref = TextEditingController(), note = TextEditingController();
    var date = ymd(DateTime.now());
    var mode = isIn ? 'Cash' : 'Bank';
    final accts = s.payAccounts(mode == 'Cash' ? 'cash' : 'bank');
    var acct = accts.firstOrNull?['id'];
    Future<void> loadDocs(void Function(VoidCallback) set, String partyId) async {
      set(() => docs = []);
      try {
        final r = _map(await s.api.rpc('acc_list_documents', {'p': {'types': isIn ? ['invoice'] : ['bill', 'expense'], 'party_id': partyId, 'limit': 200}}));
        set(() => docs = _maps(r['rows']).where((d) => d['status'] == 'posted' && n(d['outstanding']) > 0).toList());
      } on ApiError catch (_) {}
    }

    openSheet(context, isIn ? 'Receive money' : 'Pay money', (ctx, set) {
      final cands = s.parties.where((p) => p['is_walkin'] != true && p['active'] != false && (isIn ? (p['kind'] == 'customer' || p['kind'] == 'both') : (p['kind'] == 'supplier' || p['kind'] == 'both'))).toList()
        ..sort((a, b) => '${a['name']}'.toLowerCase().compareTo('${b['name']}'.toLowerCase()));
      if (!loadedPreset) {
        // Kick off the preset party's outstanding docs once, on the very first build.
        loadedPreset = true;
        loadDocs(set, '${party!['id']}');
      }
      final alloc = allocateOldestFirst(n(amt.text), docs);
      final used = alloc.fold<double>(0, (a, x) => a + n(x['amount']));
      return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        DropdownButtonFormField<String>(
          initialValue: party?['id'] as String?,
          isExpanded: true,
          decoration: InputDecoration(labelText: tr(isIn ? 'Received from' : 'Paid to')),
          items: [for (final p in cands) DropdownMenuItem(value: '${p['id']}', child: Text('${p['name']}'))],
          onChanged: (v) {
            party = cands.firstWhere((p) => '${p['id']}' == v);
            loadDocs(set, v!);
          },
        ),
        gap(),
        TextField(controller: amt, keyboardType: const TextInputType.numberWithOptions(decimal: true), onChanged: (_) => set(() {}), decoration: InputDecoration(labelText: tr('Amount (₹)'))),
        gap(8),
        TextField(controller: TextEditingController(text: date), onChanged: (v) => date = v, decoration: InputDecoration(labelText: tr('Date (YYYY-MM-DD)'))),
        gap(8),
        Seg<String>(expand: true, items: const [('Cash', 'Cash'), ('UPI', 'UPI'), ('Bank', 'Bank')], value: mode, onChanged: (v) {
          mode = v;
          final l = s.payAccounts(v == 'Cash' ? 'cash' : 'bank');
          acct = l.firstOrNull?['id'];
          set(() {});
        }),
        gap(8),
        DropdownButtonFormField<String>(
          key: ValueKey(mode),
          initialValue: acct as String?,
          decoration: InputDecoration(labelText: tr(isIn ? 'Into account' : 'From account')),
          items: [for (final a in s.payAccounts(mode == 'Cash' ? 'cash' : 'bank')) DropdownMenuItem(value: '${a['id']}', child: Text('${a['name']}'))],
          onChanged: (v) => acct = v,
        ),
        gap(8),
        TextField(controller: ref, decoration: InputDecoration(labelText: tr('UTR / cheque number'))),
        gap(8),
        TextField(controller: note, decoration: InputDecoration(labelText: tr('Note (optional)'))),
        if (party != null) ...[
          const Align(alignment: Alignment.centerLeft, child: SectionLabel('Settles')),
          if (docs.isEmpty) Hint('Nothing is outstanding. It will be kept as an advance.') else Group([for (final d in docs) Li('${d['number']}', sub: 'due ${fmtD(d['due_date'] ?? d['doc_date'])}', value: inr(n(d['outstanding'])), chevron: false)]),
          if (n(amt.text) > 0) Hint(used < n(amt.text) - .005 ? '${inr(n(amt.text) - used)} ${tr('will be kept as an advance')}' : tr('Fully settled')),
        ],
      ]);
    }, actions: [
      SheetAction(isIn ? 'Record receipt' : 'Record payment', (ctx) async {
        if (_submitting) return false; // already in flight -- never send the same tap twice
        final a = n(amt.text);
        if (party == null) {
          toast(ctx, tr('Choose a party'), err: true);
          return false;
        }
        if (a <= 0 || acct == null) {
          toast(ctx, tr(a <= 0 ? 'Enter the amount' : 'No cash or bank account is set up'), err: true);
          return false;
        }
        _submitting = true;
        try {
          final r = _map(await s.api.rpc('acc_save_payment', {'p': {'kind': kind, 'party_id': party!['id'], 'account_id': acct, 'amount': a, 'date': date, 'mode': mode, 'reference': ref.text.trim(), 'notes': note.text.trim(), 'allocations': allocateOldestFirst(a, docs)}}));
          if (mounted) {
            toast(context, '${isIn ? tr('Received') : tr('Paid')} ${inr(a)} · ${r['number'] ?? ''}');
            setState(() => tick++);
          }
          await s.refreshParties();
          return true;
        } finally {
          _submitting = false;
        }
      }),
    ]);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(isIn ? tr('Collect') : tr('Pay suppliers')), actions: [if (canWrite) iconBtn(Icons.add_circle_outline, _new, tip: 'New')]),
      body: Loader<Map<String, dynamic>>(
        key: ValueKey(tick),
        load: () async {
          final r = await Future.wait([
            s.api.rpc('acc_ageing', {'p': {'kind': isIn ? 'receivable' : 'payable'}}),
            s.api.rpc('acc_list_payments', {'p': {'kind': kind, 'limit': 100}}),
          ]);
          return {'ageing': _map(r[0]), 'payments': _map(r[1])};
        },
        builder: (ctx, d, reload) {
          final age = _map(d['ageing']);
          final totals = _map(age['totals']);
          final overdue = ageingOverdue(totals);
          final rows = _maps(age['rows']).where((r) => n(r['total']) > 0).take(12).toList();
          final pays = _maps(_map(d['payments'])['rows']);
          return RefreshIndicator(
            onRefresh: reload,
            child: ListView(padding: const EdgeInsets.only(bottom: 40), children: [
              metricGrid([
                Metric(isIn ? tr('To collect') : tr('To pay'), inr(n(totals['total']), dp: 0), sub: n(totals['advance']) != 0 ? '${inr(n(totals['advance']).abs(), dp: 0)} ${tr('in advances')}' : null, hero: true),
                Metric(tr('Overdue'), inr(overdue, dp: 0), sub: overdue > 0 ? tr('Past the due date') : tr('Nothing overdue'), tone: overdue > 0 ? Tk.red : null),
                Metric(tr('Not yet due'), inr(n(totals['current']), dp: 0)),
              ]),
              SectionLabel(isIn ? 'Who owes you' : 'Who you owe'),
              if (rows.isEmpty)
                emptyBox(Icons.check_circle_outline, tr(isIn ? 'Nothing to collect' : 'Nothing to pay'), tr('Everything is settled.'))
              else
                Group([
                  for (final r in rows)
                    Li('${r['name']}', sub: ageingOverdue(r) > 0 ? '${inr(ageingOverdue(r), dp: 0)} ${tr('overdue')}' : tr('Within terms'), value: inr(n(r['total']), dp: 0), chevron: false,
                        trailing: canWrite
                            ? Padding(padding: const EdgeInsets.only(left: 8), child: OutlinedButton(onPressed: () => _new(presetParty: {'id': r['party_id'], 'name': r['name'], 'kind': isIn ? 'customer' : 'supplier'}), child: Text(tr(isIn ? 'Collect' : 'Pay'))))
                            : null),
                ]),
              SectionLabel(isIn ? 'Recent receipts' : 'Recent payments'),
              if (pays.isEmpty)
                emptyBox(Icons.account_balance_wallet_outlined, tr('Nothing yet'))
              else
                Group([
                  for (final r in pays)
                    Li('${r['party_name'] ?? ''}', sub: '${r['number']} · ${fmtD(r['pay_date'])}${r['status'] == 'cancelled' ? ' · ${tr('cancelled')}' : ''}', value: inr(n(r['amount'])), icon: isIn ? Icons.south_west : Icons.north_east, tone: isIn ? Tk.green : Tk.orange,
                        onTap: () async {
                          await Navigator.push(context, MaterialPageRoute(builder: (_) => PaymentDetailPage(s, '${r['id']}')));
                          if (mounted) setState(() => tick++);
                        }),
                ]),
            ]),
          );
        },
      ),
    );
  }
}

/// One payment/receipt's detail: amount, party, allocations against documents, the accounting
/// entries it created, attachments (read-only -- no screen in this app fetches a private file
/// yet, so there is nothing to wire a download/upload action to), and Cancel with a reason
/// (acc_cancel_payment, same reversal the website uses).
class PaymentDetailPage extends StatefulWidget {
  const PaymentDetailPage(this.s, this.id, {super.key});
  final LedgerSession s;
  final String id;
  @override
  State<PaymentDetailPage> createState() => _PaymentDetailPageState();
}

class _PaymentDetailPageState extends State<PaymentDetailPage> {
  LedgerSession get s => widget.s;
  bool _cancelling = false;

  Future<void> _cancel(Map<String, dynamic> p, Future<void> Function() reload) async {
    if (_cancelling) return;
    final reasonCtrl = TextEditingController();
    final reason = await showDialog<String>(
      context: context,
      builder: (d) => AlertDialog(
        title: Text(tr('Cancel ${p['number'] ?? ''}?')),
        content: TextField(controller: reasonCtrl, autofocus: true, decoration: InputDecoration(labelText: tr('Reason (required)'))),
        actions: [
          TextButton(onPressed: () => Navigator.pop(d), child: Text(tr('Back'))),
          FilledButton(style: FilledButton.styleFrom(backgroundColor: Tk.red), onPressed: () => Navigator.pop(d, reasonCtrl.text.trim()), child: Text(tr('Cancel payment'))),
        ],
      ),
    );
    if (reason == null) return;
    if (reason.isEmpty) {
      if (mounted) toast(context, tr('A reason is required'), err: true);
      return;
    }
    _cancelling = true;
    try {
      await s.api.rpc('acc_cancel_payment', {'p_payment': widget.id, 'p_reason': reason});
      if (mounted) toast(context, tr('Cancelled'));
      await reload();
    } on ApiError catch (e) {
      if (mounted) toast(context, e.message, err: true);
    } finally {
      _cancelling = false;
    }
  }

  @override
  Widget build(BuildContext context) {
    return Loader<Map<String, dynamic>>(
      load: () async => _map(await s.api.rpc('acc_get_payment', {'p_id': widget.id})),
      builder: (ctx, r, reload) {
        final p = _map(r['payment']);
        final party = _map(r['party']);
        final isIn = p['kind'] == 'receipt';
        final cancelled = p['status'] == 'cancelled';
        final unallocated = n(p['amount']) - n(p['allocated']);
        final allocations = _maps(r['allocations']);
        final journalLines = _maps(r['journal_lines']);
        final attachments = _maps(r['attachments']);
        return Scaffold(
          appBar: AppBar(title: Text('${p['number'] ?? ''}'), actions: [
            if (!cancelled && s.can('acc_cancel')) IconButton(onPressed: () => _cancel(p, reload), icon: Icon(Icons.cancel_outlined, color: Tk.red), tooltip: tr('Cancel')),
          ]),
          body: ListView(padding: const EdgeInsets.only(bottom: 40), children: [
            Pad(Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(children: [
                Expanded(child: Text(inr(n(p['amount'])), style: const TextStyle(fontSize: 28, fontWeight: FontWeight.w800))),
                Pill(cancelled ? tr('Cancelled') : (unallocated > .005 ? tr('Open') : tr('Posted')), tone: cancelled ? Tk.red : (unallocated > .005 ? Tk.orange : Tk.green)),
              ]),
              Text('${isIn ? tr('From') : tr('To')} ${party['name'] ?? '—'}', style: TextStyle(color: Tk.label2, fontSize: 15)),
              Text('${fmtD(p['pay_date'])} · ${r['account'] ?? ''}${p['mode'] != null && '${p['mode']}'.isNotEmpty ? ' · ${p['mode']}' : ''}', style: TextStyle(color: Tk.label2, fontSize: 13)),
              if (p['reference'] != null && '${p['reference']}'.isNotEmpty) Text('${tr('Reference')} ${p['reference']}', style: TextStyle(color: Tk.label2, fontSize: 13)),
              if (p['notes'] != null && '${p['notes']}'.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 4), child: Text('${p['notes']}')),
            ])),
            if (cancelled) Note('${tr('Cancelled')}${p['cancel_reason'] != null && '${p['cancel_reason']}'.isNotEmpty ? ': ${p['cancel_reason']}' : ''}', bad: true)
            else if (unallocated > .005) Note('${inr(unallocated)} ${tr('is not yet allocated to a document (held as an advance)')}'),
            const SectionLabel('Settled documents'),
            allocations.isEmpty
                ? Group([Li(tr('Not allocated to any document'), chevron: false)])
                : Group([for (final a in allocations) Li('${a['doc_type']} ${a['doc_number']}', sub: a['reversed'] == true ? tr('Unlinked') : null, value: inr(n(a['amount'])), icon: Icons.receipt_long_outlined, tone: a['reversed'] == true ? Tk.label3 : Tk.green, chevron: false)]),
            if (journalLines.isNotEmpty) ...[
              const SectionLabel('Accounting entries'),
              Group([for (final j in journalLines) Li('${j['account']}', value: n(j['debit']) > 0 ? '${inr(n(j['debit']))} Dr' : '${inr(n(j['credit']))} Cr', chevron: false)]),
            ],
            const SectionLabel('Attachments'),
            attachments.isEmpty
                ? Group([Li(tr('No files attached'), chevron: false)])
                // Read-only: nothing in this app has a way to fetch a private file yet, so there is
                // no "open" action to wire here without inventing a new authenticated-download path.
                : Group([for (final a in attachments) Li('${a['name'] ?? ''}', sub: fmtD(a['created_at']), chevron: false, icon: Icons.attach_file, tone: Tk.label3)]),
          ]),
        );
      },
    );
  }
}

// ---------------------------------------------------------------- credit notes

/// Pick a sales invoice, choose how much of each line comes back, post a credit note.
class CreditNotePage extends StatefulWidget {
  const CreditNotePage(this.s, {super.key});
  final LedgerSession s;
  @override
  State<CreditNotePage> createState() => _CreditNotePageState();
}

class _CreditNotePageState extends State<CreditNotePage> {
  LedgerSession get s => widget.s;
  String q = '';

  Future<void> _open(Map<String, dynamic> inv) async {
    try {
      final full = _map(await s.api.rpc('acc_get_document', {'p_id': inv['id']}));
      final doc = _map(full['doc']);
      final lines = _maps(full['lines']);
      final qty = {for (final l in lines) '${l['id']}': 0.0};
      final reason = TextEditingController();
      if (!mounted) return;
      await openSheet(context, 'Credit note for ${doc['number']}', (ctx, set) {
        final chosen = creditLines(lines, qty);
        return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Hint('Type how many of each item came back. Leave 0 for the rest.'),
          for (final l in lines)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Row(children: [
                Expanded(child: Text('${l['description']}\n${tr('Sold')}: ${qtyStr(n(l['qty']))} × ${inr(n(l['rate']))}', style: const TextStyle(fontSize: 14))),
                SizedBox(
                  width: 90,
                  child: TextField(
                    keyboardType: const TextInputType.numberWithOptions(decimal: true),
                    textAlign: TextAlign.right,
                    decoration: const InputDecoration(hintText: '0'),
                    onChanged: (v) {
                      final x = n(v);
                      qty['${l['id']}'] = x > n(l['qty']) ? n(l['qty']) : x;
                      set(() {});
                    },
                  ),
                ),
              ]),
            ),
          TextField(controller: reason, decoration: InputDecoration(labelText: tr('Reason (optional)'))),
          gap(4),
          Text('${chosen.length} ${tr('items')}', style: TextStyle(color: Tk.label2)),
        ]);
      }, actions: [
        SheetAction('Post credit note', (ctx) async {
          final chosen = creditLines(lines, qty);
          if (chosen.isEmpty) {
            toast(ctx, tr('Enter a quantity for at least one item'), err: true);
            return false;
          }
          final payload = {
            'id': null, 'doc_type': 'credit_note', 'doc_date': ymd(DateTime.now()), 'party_id': doc['party_id'], 'branch_id': doc['branch_id'], 'warehouse_id': doc['warehouse_id'],
            'place_of_supply': doc['place_of_supply'], 'reverse_charge': false, 'itc_eligible': true, 'price_includes_tax': doc['price_includes_tax'] == true,
            'ref_doc_id': doc['id'], 'source_doc_id': doc['id'], 'notes': reason.text.trim(), 'post': true, 'lines': chosen, 'payments': const [],
          };
          // Same offline-draft fallback as a purchase bill/expense: a lost connection or a 5xx
          // never loses the credit note, it is kept as an unposted draft instead. Opening this
          // sheet in the first place still needs a connection (it reads the original invoice's
          // own lines via acc_get_document, which has no offline copy) -- unchanged from today.
          if (s.offline) {
            await _queueOffline(payload, doc, chosen);
            return true;
          }
          try {
            final r = _map(await s.api.rpc('acc_save_document', {'p': payload}));
            if (mounted) toast(context, '${tr('Posted')} ${r['number'] ?? ''}');
            return true;
          } on ApiError catch (e) {
            if (LedgerSession.transient(e)) {
              await _queueOffline(payload, doc, chosen);
              return true;
            }
            if (mounted) toast(context, e.message, err: true);
            return false;
          }
        }),
      ]);
    } on ApiError catch (e) {
      if (mounted) toast(context, e.message, err: true);
    }
  }

  Future<void> _queueOffline(Map<String, dynamic> payload, Map<String, dynamic> doc, List<Map<String, dynamic>> chosen) async {
    final p = Map<String, dynamic>.from(payload)..remove('id');
    final total = chosen.fold<double>(0, (t, l) => t + n(l['qty']) * n(l['rate']));
    await s.enqueue('draft', p, meta: {'label': tr('Credit note'), 'party': doc['party_name'], 'total': total, 'date': p['doc_date']});
    if (!mounted) return;
    toast(context, tr('Saved offline. It will reach your books as a draft once you are back online.'));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Credit note')),
      body: ListView(padding: const EdgeInsets.only(bottom: 40), children: [
        Pad(Hint('Pick the invoice the goods or money came back against.')),
        Pad(TextField(onChanged: (v) => setState(() => q = v.toLowerCase()), decoration: InputDecoration(hintText: tr('Search invoice number or customer'), prefixIcon: const Icon(Icons.search)))),
        Loader<Map<String, dynamic>>(
          load: () async => _map(await s.api.rpc('acc_list_documents', {'p': {'types': ['invoice'], 'limit': 200}})),
          builder: (ctx, d, _) {
            final rows = _maps(d['rows']).where((r) => r['status'] == 'posted' && (q.isEmpty || '${r['number']} ${r['party_name']}'.toLowerCase().contains(q))).toList();
            if (rows.isEmpty) return emptyBox(Icons.receipt_long_outlined, 'No invoices found');
            return Group([for (final r in rows.take(100)) Li('${r['number']}', sub: '${r['party_name'] ?? tr('Walk-in')} · ${fmtD(r['doc_date'])}', value: inr(n(r['total'])), icon: Icons.receipt_long_outlined, tone: Tk.accent, onTap: () => _open(r))]);
          },
        ),
      ]),
    );
  }
}

// ---------------------------------------------------------------- journals

class JournalPage extends StatefulWidget {
  const JournalPage(this.s, {super.key});
  final LedgerSession s;
  @override
  State<JournalPage> createState() => _JournalPageState();
}

class _JournalPageState extends State<JournalPage> {
  LedgerSession get s => widget.s;
  int tick = 0;

  void _transfer() {
    final pa = s.accounts.where((a) => (a['is_bank'] == true || a['is_cash'] == true) && a['active'] == true).toList();
    if (pa.length < 2) return toast(context, tr('You need two cash or bank accounts'), err: true);
    formSheet(context, 'Transfer money', [
      F('from', 'From', type: 'select', value: pa[0]['id'], options: [for (final a in pa) ['${a['id']}', '${a['name']}']]),
      F('to', 'To', type: 'select', value: pa[1]['id'], options: [for (final a in pa) ['${a['id']}', '${a['name']}']]),
      F('amount', 'Amount (₹)', type: 'number'),
      F('date', 'Date (YYYY-MM-DD)', value: ymd(DateTime.now())),
      F('narration', 'Narration (optional)'),
    ], (v) async {
      if (v['from'] == v['to'] || n(v['amount']) <= 0) {
        toast(context, tr('Choose two different accounts and an amount'), err: true);
        return false;
      }
      try {
        final r = _map(await s.api.rpc('acc_save_voucher', {'p': {'type': 'contra', 'from_account': v['from'], 'to_account': v['to'], 'amount': n(v['amount']), 'date': v['date'], 'narration': v['narration']}}));
        if (mounted) {
          toast(context, '${tr('Posted')} ${r['number'] ?? ''}');
          setState(() => tick++);
        }
        return true;
      } on ApiError catch (e) {
        if (mounted) toast(context, e.message, err: true);
        return false;
      }
    });
  }

  void _journal() {
    final accts = s.accounts.where((a) => a['active'] == true).toList()..sort((a, b) => '${a['code']}'.compareTo('${b['code']}'));
    final rows = [
      {'acc': null as String?, 'dr': TextEditingController(), 'cr': TextEditingController()},
      {'acc': null as String?, 'dr': TextEditingController(), 'cr': TextEditingController()},
    ];
    final nar = TextEditingController();
    var date = ymd(DateTime.now());
    openSheet(context, 'Journal entry', (ctx, set) {
      double sum(String k) => rows.fold<double>(0, (a, r) => a + n((r[k] as TextEditingController).text));
      final d = sum('dr'), c = sum('cr');
      return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        TextField(controller: TextEditingController(text: date), onChanged: (v) => date = v, decoration: InputDecoration(labelText: tr('Date (YYYY-MM-DD)'))),
        gap(8),
        for (var i = 0; i < rows.length; i++)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Column(children: [
              DropdownButtonFormField<String>(
                initialValue: rows[i]['acc'] as String?,
                isExpanded: true,
                decoration: InputDecoration(labelText: '${tr('Account')} ${i + 1}'),
                items: [for (final a in accts) DropdownMenuItem(value: '${a['id']}', child: Text('${a['code']} · ${a['name']}', overflow: TextOverflow.ellipsis))],
                onChanged: (v) => rows[i]['acc'] = v,
              ),
              const SizedBox(height: 6),
              Row(children: [
                Expanded(child: TextField(controller: rows[i]['dr'] as TextEditingController, onChanged: (_) => set(() {}), keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: InputDecoration(labelText: tr('Debit')))),
                const SizedBox(width: 8),
                Expanded(child: TextField(controller: rows[i]['cr'] as TextEditingController, onChanged: (_) => set(() {}), keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: InputDecoration(labelText: tr('Credit')))),
              ]),
            ]),
          ),
        TextButton.icon(onPressed: () => set(() => rows.add({'acc': null, 'dr': TextEditingController(), 'cr': TextEditingController()})), icon: const Icon(Icons.add), label: const Text('Add a line')),
        TextField(controller: nar, decoration: InputDecoration(labelText: tr('Narration'))),
        gap(4),
        Text('${tr('Debit')} ${inr(d)} · ${tr('Credit')} ${inr(c)}${(d - c).abs() > .004 ? ' · ${tr('Difference')} ${inr(d - c)}' : ''}', style: TextStyle(color: (d - c).abs() > .004 ? Tk.red : Tk.label2, fontWeight: FontWeight.w600)),
      ]);
    }, actions: [
      SheetAction('Post journal', (ctx) async {
        final lines = [for (final r in rows) if (r['acc'] != null && (n((r['dr'] as TextEditingController).text) > 0 || n((r['cr'] as TextEditingController).text) > 0)) {'account_id': r['acc'], 'party_id': null, 'debit': n((r['dr'] as TextEditingController).text), 'credit': n((r['cr'] as TextEditingController).text)}];
        final d = lines.fold<double>(0, (a, l) => a + n(l['debit'])), c = lines.fold<double>(0, (a, l) => a + n(l['credit']));
        if (lines.length < 2 || (d - c).abs() > .004) {
          toast(ctx, tr(lines.length < 2 ? 'A journal needs at least two lines' : 'Debits and credits must be equal'), err: true);
          return false;
        }
        if (!await askYes(ctx, 'Post journal of ${inr(d)}?', 'It cannot be edited afterwards, only reversed.')) return false;
        final r = _map(await s.api.rpc('acc_save_voucher', {'p': {'type': 'journal', 'date': date, 'narration': nar.text, 'lines': lines}}));
        if (mounted) {
          toast(context, '${tr('Posted')} ${r['number'] ?? ''}');
          setState(() => tick++);
        }
        return true;
      }),
    ]);
  }

  @override
  Widget build(BuildContext context) {
    final m = DateTime.now();
    return Scaffold(
      appBar: AppBar(title: const Text('Journals and transfers')),
      body: ListView(padding: const EdgeInsets.only(bottom: 40), children: [
        Group([
          Li('Transfer between cash and bank', icon: Icons.swap_horiz, tone: Tk.blue, onTap: _transfer),
          if (s.can('acc_journal') || s.can('acc_admin')) Li('Journal entry', sub: 'For an accountant', icon: Icons.menu_book_outlined, tone: Tk.orange, onTap: _journal),
        ]),
        const SectionLabel('This month'),
        Loader<Map<String, dynamic>>(
          key: ValueKey(tick),
          load: () async => _map(await s.api.rpc('acc_daybook', {'p_from': '${m.year}-${m.month.toString().padLeft(2, '0')}-01', 'p_to': ymd(m), 'p_type': null})),
          builder: (ctx, d, _) {
            final rows = _maps(d['rows']);
            if (rows.isEmpty) return emptyBox(Icons.menu_book_outlined, 'No entries this month');
            return Group([for (final r in rows.take(120)) Li('${r['number'] ?? r['jv'] ?? ''}', sub: '${fmtD(r['jdate'])} · ${r['narration'] ?? r['type'] ?? ''}', value: inr(n(r['amount'] ?? r['debit'])), chevron: false)]);
          },
        ),
      ]),
    );
  }
}

// ---------------------------------------------------------------- banking

class BankingPage extends StatefulWidget {
  const BankingPage(this.s, {super.key});
  final LedgerSession s;
  @override
  State<BankingPage> createState() => _BankingPageState();
}

class _BankingPageState extends State<BankingPage> {
  LedgerSession get s => widget.s;
  String? acct;
  String tab = 'unmatched';
  int tick = 0;

  List<Map<String, dynamic>> get banks => s.accounts.where((a) => a['is_bank'] == true && a['active'] == true).toList();

  @override
  void initState() {
    super.initState();
    acct = banks.firstOrNull?['id'] as String?;
  }

  Future<void> _import() async {
    final text = await _pickCsv();
    if (text == null || acct == null) return;
    final table = parseCsv(text);
    if (table.length < 2) return toast(context, tr('The file has no rows'), err: true);
    final col = guessBankColumns(table.first);
    final rows = bankRows(table, col);
    if (rows.isEmpty) return toast(context, tr('No dated rows found. Check the first line has column names like Date, Narration, Withdrawal, Deposit.'), err: true);
    if (!mounted) return;
    final ok = await askYes(context, '${rows.length} ${tr('rows found')}', '${tr('Date')}: ${table.first[col['date']!]} · ${tr('Money out')}: ${col['debit']! >= 0 ? table.first[col['debit']!] : '-'} · ${tr('Money in')}: ${col['credit']! >= 0 ? table.first[col['credit']!] : '-'}');
    if (!ok) return;
    try {
      final r = _map(await s.api.rpc('acc_bank_import', {'p_account': acct, 'p_rows': rows, 'p_batch': 'phone-${DateTime.now().millisecondsSinceEpoch}'}));
      if (mounted) {
        toast(context, '${r['inserted'] ?? r['ok'] ?? rows.length} ${tr('rows added')}${n(r['duplicates']) > 0 ? ', ${n(r['duplicates']).toInt()} ${tr('already there')}' : ''}');
        setState(() => tick++);
      }
    } on ApiError catch (e) {
      if (mounted) toast(context, e.message, err: true);
    }
  }

  Future<void> _rowSheet(Map<String, dynamic> t) async {
    final isIn = n(t['credit']) > 0;
    final amount = isIn ? n(t['credit']) : n(t['debit']);
    await openSheet(context, '${t['description'] ?? tr('Bank row')}', (ctx, set) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text('${fmtD(t['txn_date'])} · ${isIn ? '+' : '-'}${inr(amount)}${'${t['reference'] ?? ''}'.isNotEmpty ? ' · ${t['reference']}' : ''}', style: TextStyle(color: Tk.label2)),
          gap(),
          Group([
            if (t['status'] != 'matched' && t['status'] != 'ignored')
              Li('Match to an entry in my books', icon: Icons.link, tone: Tk.accent, onTap: () {
                Navigator.pop(ctx);
                _matchSheet(t, amount, isIn);
              }),
            if (t['status'] != 'matched' && t['status'] != 'ignored')
              Li(isIn ? 'Record as money received from...' : 'Record as money paid to...', icon: Icons.add_circle_outline, tone: Tk.green, onTap: () {
                Navigator.pop(ctx);
                _createSheet(t, isIn);
              }),
            if (t['status'] == 'matched') Li('Undo the match', icon: Icons.link_off, tone: Tk.orange, onTap: () => _act(ctx, () => s.api.rpc('acc_bank_unmatch', {'p_txn': t['id']}))),
            if (t['status'] == 'ignored') Li('Stop ignoring', icon: Icons.visibility_outlined, tone: Tk.blue, onTap: () => _act(ctx, () => s.api.rpc('acc_bank_ignore', {'p_txn': t['id'], 'p_ignore': false}))),
            if (t['status'] != 'matched' && t['status'] != 'ignored') Li('Ignore this row', icon: Icons.visibility_off_outlined, tone: Tk.label3, onTap: () => _act(ctx, () => s.api.rpc('acc_bank_ignore', {'p_txn': t['id'], 'p_ignore': true}))),
          ]),
        ]));
  }

  Future<void> _act(BuildContext ctx, Future<dynamic> Function() f) async {
    try {
      await f();
      if (ctx.mounted) Navigator.pop(ctx);
      if (mounted) setState(() => tick++);
    } on ApiError catch (e) {
      if (ctx.mounted) toast(ctx, e.message, err: true);
    }
  }

  Future<void> _matchSheet(Map<String, dynamic> t, double amount, bool isIn) async {
    try {
      final r = _map(await s.api.rpc('acc_bank_book_lines', {'p_account': acct, 'p_upto': null}));
      var lines = _maps(r['rows']);
      // the matching side: money in = a debit in the books
      lines = lines.where((l) => (isIn ? n(l['debit']) : n(l['credit'])) > 0).toList()
        ..sort((a, b) => ((isIn ? n(a['debit']) : n(a['credit'])) - amount).abs().compareTo(((isIn ? n(b['debit']) : n(b['credit'])) - amount).abs()));
      if (!mounted) return;
      await openSheet(context, 'Match to an entry', (ctx, set) => lines.isEmpty
          ? Hint('Nothing in your books is waiting for a match.')
          : Group([
              for (final l in lines.take(40))
                Li('${l['doc_number'] ?? l['number'] ?? ''} ${l['narration'] ?? ''}'.trim(), sub: fmtD(l['jdate']), value: inr(isIn ? n(l['debit']) : n(l['credit'])), tone: Tk.accent, icon: Icons.link, onTap: () => _act(ctx, () => s.api.rpc('acc_bank_match', {'p_txn': t['id'], 'p_line': l['id']}))),
            ]));
    } on ApiError catch (e) {
      if (mounted) toast(context, e.message, err: true);
    }
  }

  void _createSheet(Map<String, dynamic> t, bool isIn) {
    final cands = s.parties.where((p) => p['is_walkin'] != true && p['active'] != false).toList();
    formSheet(context, isIn ? 'Money received' : 'Money paid', [
      F('party_id', isIn ? 'From (customer)' : 'To (supplier)', type: 'select', options: [for (final p in cands.where((p) => isIn ? p['kind'] != 'supplier' : p['kind'] != 'customer')) ['${p['id']}', '${p['name']}']]),
      F('narration', 'Note (optional)', value: t['description']),
    ], (v) async {
      if ('${v['party_id'] ?? ''}'.isEmpty) {
        toast(context, tr('Choose a party'), err: true);
        return false;
      }
      try {
        await s.api.rpc('acc_bank_create_entry', {'p_txn': t['id'], 'p': {'party_id': v['party_id'], 'narration': v['narration']}});
        if (mounted) setState(() => tick++);
        return true;
      } on ApiError catch (e) {
        if (mounted) toast(context, e.message, err: true);
        return false;
      }
    });
  }

  void _reconcile() {
    formSheet(context, 'Reconcile', [
      F('date', 'Statement date (YYYY-MM-DD)', value: ymd(DateTime.now())),
      F('balance', 'Closing balance on the statement (₹)', type: 'number'),
    ], (v) async {
      try {
        final r = _map(await s.api.rpc('acc_bank_reconcile', {'p_account': acct, 'p_date': v['date'], 'p_balance': n(v['balance']), 'p_commit': false}));
        final diff = n(r['difference'] ?? r['diff']);
        if (!mounted) return false;
        final ok = await askYes(context, diff.abs() < .01 ? tr('Everything agrees') : '${tr('Difference')} ${inr(diff)}', diff.abs() < .01 ? tr('Mark the matched rows as reconciled?') : tr('There is still a difference. Reconcile anyway?'));
        if (!ok) return false;
        await s.api.rpc('acc_bank_reconcile', {'p_account': acct, 'p_date': v['date'], 'p_balance': n(v['balance']), 'p_commit': true});
        if (mounted) {
          toast(context, tr('Reconciled'));
          setState(() => tick++);
        }
        return true;
      } on ApiError catch (e) {
        if (mounted) toast(context, e.message, err: true);
        return false;
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final b = banks;
    return Scaffold(
      appBar: AppBar(title: const Text('Banking'), actions: [
        if (acct != null && s.can('acc_banking')) iconBtn(Icons.upload_file, _import, tip: 'Import a statement'),
        if (acct != null && s.can('acc_banking')) iconBtn(Icons.fact_check_outlined, _reconcile, tip: 'Reconcile'),
      ]),
      body: b.isEmpty
          ? emptyBox(Icons.account_balance_outlined, 'No bank account is set up', 'Add one in AUZsLedger on the web.')
          : ListView(padding: const EdgeInsets.only(bottom: 40), children: [
              if (b.length > 1)
                Pad(DropdownButtonFormField<String>(initialValue: acct, decoration: InputDecoration(labelText: tr('Bank account')), items: [for (final a in b) DropdownMenuItem(value: '${a['id']}', child: Text('${a['name']}'))], onChanged: (v) => setState(() => acct = v))),
              Pad(Seg<String>(expand: true, items: const [('unmatched', 'To match'), ('matched', 'Matched'), ('ignored', 'Ignored')], value: tab, onChanged: (v) => setState(() => tab = v))),
              Loader<Map<String, dynamic>>(
                key: ValueKey('$acct$tab$tick'),
                load: () async => _map(await s.api.rpc('acc_bank_list', {'p': {'account_id': acct, 'status': tab, 'limit': 300}})),
                builder: (ctx, d, _) {
                  final rows = _maps(d['rows']);
                  return Column(children: [
                    metricGrid([Metric('Book balance', inr(n(d['book_balance']), dp: 0)), Metric('To match', '${n(d['unmatched']).toInt()}', sub: d['last_recon'] != null ? '${tr('Last reconciled')} ${fmtD(d['last_recon'])}' : null)]),
                    gap(),
                    if (rows.isEmpty) emptyBox(Icons.account_balance_outlined, tab == 'unmatched' ? 'Nothing to match' : 'No rows', tab == 'unmatched' ? 'Import a statement to start matching.' : '')
                    else
                      Group([
                        for (final t in rows)
                          Li('${t['description'] ?? tr('Bank row')}', sub: '${fmtD(t['txn_date'])}${'${t['reference'] ?? ''}'.isNotEmpty ? ' · ${t['reference']}' : ''}', value: n(t['credit']) > 0 ? '+${inr(n(t['credit']))}' : '-${inr(n(t['debit']))}', tone: n(t['credit']) > 0 ? Tk.green : Tk.orange, icon: n(t['credit']) > 0 ? Icons.south_west : Icons.north_east, onTap: () => _rowSheet(t)),
                      ]),
                  ]);
                },
              ),
            ]),
    );
  }
}

// ---------------------------------------------------------------- GST returns

const _gstTypes = [('b2b', 'B2B sales'), ('b2c', 'B2C sales'), ('cdn', 'Credit/debit notes'), ('hsn', 'HSN summary'), ('exempt', 'Nil / exempt'), ('purchases', 'Purchases'), ('itc', 'Input credit'), ('rcm', 'Reverse charge')];

class GstReturnsPage extends StatefulWidget {
  const GstReturnsPage(this.s, {super.key});
  final LedgerSession s;
  @override
  State<GstReturnsPage> createState() => _GstReturnsPageState();
}

class _GstReturnsPageState extends State<GstReturnsPage> {
  LedgerSession get s => widget.s;
  String month = ymd(DateTime.now()).substring(0, 7);
  String type = 'b2b';
  int tick = 0;

  String get from => '$month-01';
  String get to => '$month-${DateTime(int.parse(month.substring(0, 4)), int.parse(month.substring(5)) + 1, 0).day}';

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('GST returns')),
      body: ListView(padding: const EdgeInsets.only(bottom: 40), children: [
        Row(mainAxisAlignment: MainAxisAlignment.center, children: [
          IconButton(onPressed: () => setState(() => month = _addMonth(month, -1)), icon: const Icon(Icons.chevron_left)),
          Text(_monthLabel(month), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 17)),
          IconButton(onPressed: () => setState(() => month = _addMonth(month, 1)), icon: const Icon(Icons.chevron_right)),
        ]),
        Loader<Map<String, dynamic>>(
          key: ValueKey('sum$month$tick'),
          load: () async => _map(await s.api.rpc('acc_gst_summary', {'p_from': from, 'p_to': to})),
          builder: (ctx, g, _) {
            double tax(dynamic m) => n(_map(m)['cgst']) + n(_map(m)['sgst']) + n(_map(m)['igst']) + n(_map(m)['cess']);
            return Column(children: [
              metricGrid([
                Metric('Output tax', inr(tax(g['output']), dp: 0), sub: '${tr('On sales of')} ${inr(n(_map(g['output'])['taxable']), dp: 0)}'),
                Metric('Input credit', inr(tax(g['itc']), dp: 0)),
                Metric('Net payable', inr(tax(g['payable']), dp: 0), sub: tr('After set-off, indicative'), hero: true),
                if (g['locked'] == true) Metric('Filed', tr('Locked'), sub: tr('This month is marked filed')),
              ]),
              if (s.can('acc_admin') || s.can('acc_gst'))
                Pad(OutlinedButton.icon(
                  onPressed: () async {
                    final locked = g['locked'] == true;
                    formSheet(context, locked ? 'Reopen this month' : 'Mark as filed', [if (!locked) F('ref', 'Acknowledgement number (optional)')], (v) async {
                      try {
                        await s.api.rpc('acc_mark_gst_filed', {'p_period': month, 'p_filed': !locked, 'p_ref': locked ? null : '${v['ref'] ?? ''}'});
                        if (mounted) setState(() => tick++);
                        return true;
                      } on ApiError catch (e) {
                        if (mounted) toast(context, e.message, err: true);
                        return false;
                      }
                    });
                  },
                  icon: Icon(g['locked'] == true ? Icons.lock_open : Icons.lock_outline),
                  label: Text(g['locked'] == true ? tr('Reopen this month') : tr('Mark the month as filed')),
                )),
            ]);
          },
        ),
        const SectionLabel('Registers'),
        SizedBox(height: 46, child: ListView(scrollDirection: Axis.horizontal, padding: const EdgeInsets.symmetric(horizontal: 12), children: [
          for (final t in _gstTypes) Padding(padding: const EdgeInsets.symmetric(vertical: 4), child: Cat(t.$2, type == t.$1, () => setState(() => type = t.$1))),
        ])),
        Loader<Map<String, dynamic>>(
          key: ValueKey('reg$month$type$tick'),
          load: () async => _map(await s.api.rpc('acc_gst_register', {'p': {'type': type, 'from': from, 'to': to}})),
          builder: (ctx, g, _) {
            final rows = _maps(g['rows']);
            if (rows.isEmpty) return emptyBox(Icons.receipt_long_outlined, 'Nothing in this register for the month');
            final keys = rows.first.keys.toList();
            return Column(children: [
              Pad(OutlinedButton.icon(onPressed: () => _shareCsv(ctx, 'gst-$type-$month', [keys, for (final r in rows) [for (final k in keys) r[k]]]), icon: const Icon(Icons.ios_share), label: Text(tr('Share as a spreadsheet')))),
              Group([for (final r in rows.take(200)) Li(_regTitle(r), sub: _regSub(r), value: inr(n(r['total'] ?? r['taxable'])), chevron: false)]),
              if (rows.length > 200) Pad(Text('${tr('Showing the first 200 of')} ${rows.length}', style: TextStyle(color: Tk.label2, fontSize: 13))),
            ]);
          },
        ),
        const SectionLabel('To fix before filing'),
        Loader<Map<String, dynamic>>(
          key: ValueKey('ex$month$tick'),
          load: () async => _map(await s.api.rpc('acc_gst_exceptions', {'p_from': from, 'p_to': to})),
          builder: (ctx, g, _) {
            final rows = _maps(g['rows']);
            if (rows.isEmpty) return Pad(Text(tr('Nothing to fix. Every document looks complete.'), style: TextStyle(color: Tk.green)));
            return Group([for (final r in rows.take(60)) Li('${r['number'] ?? r['doc_number'] ?? ''}', sub: '${r['issue'] ?? r['problem'] ?? r['reason'] ?? ''}', icon: Icons.warning_amber_outlined, tone: Tk.orange, chevron: false)]);
          },
        ),
      ]),
    );
  }
}

String _regTitle(Map<String, dynamic> r) => '${r['number'] ?? r['hsn'] ?? r['party_name'] ?? r['place_of_supply'] ?? r['label'] ?? ''}';
String _regSub(Map<String, dynamic> r) => [r['party_name'], r['gstin'], r['doc_date'] != null ? fmtD(r['doc_date']) : null, r['rate'] != null ? '${r['rate']}%' : null].where((x) => '${x ?? ''}'.isNotEmpty && x != r['number']).join(' · ');

String _addMonth(String m, int by) {
  final d = DateTime(int.parse(m.substring(0, 4)), int.parse(m.substring(5)) + by, 1);
  return '${d.year}-${d.month.toString().padLeft(2, '0')}';
}

String _monthLabel(String m) => fmtD('$m-01').replaceFirst(RegExp(r'^\d+ '), '');

// ---------------------------------------------------------------- import

final _imports = <(String, String, List<(String, RegExp, bool)>)>[
  ('customers', 'Customers', [('name', RegExp(r'name|customer|party'), true), ('gstin', RegExp(r'gstin|gst no'), false), ('phone', RegExp(r'phone|mobile'), false), ('email', RegExp(r'mail'), false), ('billing_address', RegExp(r'address'), false)]),
  ('suppliers', 'Suppliers', [('name', RegExp(r'name|supplier|vendor|party'), true), ('gstin', RegExp(r'gstin|gst no'), false), ('phone', RegExp(r'phone|mobile'), false), ('email', RegExp(r'mail'), false), ('billing_address', RegExp(r'address'), false)]),
  ('products', 'Products and services', [('sku', RegExp(r'sku|code|item code'), false), ('name', RegExp(r'name|item|product|desc'), true), ('hsn', RegExp(r'hsn|sac'), false), ('tax_rate', RegExp(r'gst|tax|rate %'), false), ('unit', RegExp(r'unit|uom'), false), ('sale_price', RegExp(r'sale|sell|price|mrp'), false), ('purchase_price', RegExp(r'purchase|cost'), false), ('barcode', RegExp(r'barcode|ean'), false)]),
  ('opening_stock', 'Opening stock', [('sku', RegExp(r'sku|code'), true), ('qty', RegExp(r'qty|quantity'), true), ('unit_cost', RegExp(r'cost|rate|price'), false)]),
  ('party_openings', 'Customer and supplier balances', [('name', RegExp(r'name|party'), true), ('kind', RegExp(r'kind|type'), false), ('amount', RegExp(r'amount|balance|outstanding'), true)]),
];

/// Column index per field for a CSV header (-1 = none), each header used once.
Map<String, int> guessImportColumns(List<String> head, List<(String, RegExp, bool)> fields) {
  final used = <int>{};
  final out = <String, int>{};
  for (final f in fields) {
    final i = head.indexWhere((h) => !used.contains(head.indexOf(h)) && f.$2.hasMatch(h.toLowerCase()));
    out[f.$1] = i;
    if (i >= 0) used.add(i);
  }
  return out;
}

List<Map<String, dynamic>> importRows(List<List<String>> table, Map<String, int> col) => [
      for (final r in table.skip(1))
        if (r.any((c) => c.trim().isNotEmpty))
          {
            for (final e in col.entries)
              if (e.value >= 0 && e.value < r.length && r[e.value].trim().isNotEmpty) e.key: r[e.value].trim(),
          },
    ];

class ImportPage extends StatefulWidget {
  const ImportPage(this.s, {super.key});
  final LedgerSession s;
  @override
  State<ImportPage> createState() => _ImportPageState();
}

class _ImportPageState extends State<ImportPage> {
  LedgerSession get s => widget.s;
  var ent = _imports[2];
  List<List<String>>? table;
  Map<String, int> col = {};
  Map<String, dynamic>? check;
  bool busy = false;

  Future<void> _pick() async {
    final text = await _pickCsv();
    if (text == null) return;
    final t = parseCsv(text);
    if (t.length < 2) return toast(context, tr('The file has no rows'), err: true);
    setState(() {
      table = t;
      col = guessImportColumns(t.first, ent.$3);
      check = null;
    });
  }

  Future<void> _run(bool commit) async {
    final rows = importRows(table!, col);
    setState(() => busy = true);
    try {
      final r = _map(await s.api.rpc('acc_import', {'p_entity': ent.$1, 'p_rows': rows, 'p_commit': commit, 'p_strict': false, 'p_options': const {}}));
      if (!mounted) return;
      setState(() => check = commit ? null : r);
      if (commit) {
        toast(context, '${tr('Imported')}: ${r['ok'] ?? rows.length}${n(r['failed']) > 0 ? ' · ${n(r['failed']).toInt()} ${tr('skipped')}' : ''}');
        await s.refreshProducts();
        await s.refreshParties();
        if (mounted) setState(() => table = null);
      }
    } on ApiError catch (e) {
      if (mounted) toast(context, e.message, err: true);
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final head = table?.first ?? const <String>[];
    final missing = [for (final f in ent.$3) if (f.$3 && (col[f.$1] ?? -1) < 0) f.$1];
    return SubPage('Import', [
      const SectionLabel('What are you importing?'),
      Pad(Wrap(spacing: 8, runSpacing: 8, children: [for (final e in _imports) ChoiceChip(label: Text(e.$2), selected: ent.$1 == e.$1, onSelected: (_) => setState(() {
            ent = e;
            table = null;
            check = null;
          }))])),
      Pad(Hint('Use a CSV file (save your Excel, Busy or Tally list as CSV). The first line must hold the column names.')),
      Pad(FilledButton.icon(onPressed: busy ? null : _pick, icon: const Icon(Icons.upload_file), label: Text(table == null ? tr('Choose a CSV file') : tr('Choose another file')))),
      if (table != null) ...[
        const SectionLabel('Columns'),
        Group([
          for (final f in ent.$3)
            Li(tr(f.$1.replaceAll('_', ' ')), sub: f.$3 ? tr('Required') : null, value: (col[f.$1] ?? -1) >= 0 ? head[col[f.$1]!] : tr('Not used'), icon: Icons.view_column_outlined, tone: (col[f.$1] ?? -1) >= 0 ? Tk.green : (f.$3 ? Tk.red : Tk.label3), onTap: () async {
              final pick = await showModalBottomSheet<int>(context: context, builder: (ctx) => SafeArea(child: ListView(shrinkWrap: true, children: [
                    ListTile(title: Text(tr('Not used')), onTap: () => Navigator.pop(ctx, -1)),
                    for (var i = 0; i < head.length; i++) ListTile(title: Text(head[i].isEmpty ? '${tr('Column')} ${i + 1}' : head[i]), subtitle: table!.length > 1 && i < table![1].length ? Text(table![1][i]) : null, onTap: () => Navigator.pop(ctx, i)),
                  ])));
              if (pick != null) setState(() {
                    col[f.$1] = pick;
                    check = null;
                  });
            }),
        ]),
        Pad(Text('${table!.length - 1} ${tr('rows found')}', style: TextStyle(color: Tk.label2))),
        if (missing.isNotEmpty) Note('${tr('Pick a column for')}: ${missing.join(', ')}', bad: true),
        if (check != null) Note('${tr('Ready')}: ${check!['ok'] ?? 0} ${tr('good')}, ${check!['failed'] ?? 0} ${tr('with problems')}${n(check!['duplicates']) > 0 ? ', ${n(check!['duplicates']).toInt()} ${tr('already there')}' : ''}', bad: n(check!['failed']) > 0),
        Pad(Row(children: [
          Expanded(child: OutlinedButton(onPressed: busy || missing.isNotEmpty ? null : () => _run(false), child: Text(tr('Check the file')))),
          const SizedBox(width: 10),
          Expanded(child: FilledButton(onPressed: busy || missing.isNotEmpty || check == null ? null : () => _run(true), child: Text(tr('Import')))),
        ])),
      ],
    ]);
  }
}

// ---------------------------------------------------------------- settings

class OrgSettingsPage extends StatefulWidget {
  const OrgSettingsPage(this.s, {super.key});
  final LedgerSession s;
  @override
  State<OrgSettingsPage> createState() => _OrgSettingsPageState();
}

const invoiceLayouts = [('', 'Standard'), ('classic', 'Classic tax invoice'), ('noir', 'Noir'), ('playful', 'Playful'), ('bold', 'Bold'), ('minimal', 'Minimal'), ('stamped', 'Stamped')];

class _OrgSettingsPageState extends State<OrgSettingsPage> {
  LedgerSession get s => widget.s;
  late final Map<String, dynamic> o = s.org;
  late final f = {for (final k in const ['legal_name', 'trade_name', 'gstin', 'pan', 'state_code', 'address', 'city', 'pincode', 'phone', 'email', 'invoice_terms', 'invoice_footer']) k: TextEditingController(text: '${o[k] ?? ''}')};
  late String reg = '${o['reg_type'] ?? 'regular'}';
  late bool round = o['round_off_sales'] != false, neg = o['allow_negative_stock'] == true;
  late String layout = '${_map(_map(o['settings'])['brand'])['invoiceStyle'] ?? ''}';
  bool busy = false;

  Future<void> _save() async {
    setState(() => busy = true);
    try {
      final brand = _map(_map(o['settings'])['brand']);
      brand['invoiceStyle'] = layout;
      final r = _map(await s.api.rpc('acc_save_org', {'p': {
        for (final e in f.entries) e.key: e.value.text.trim(),
        'reg_type': reg, 'round_off_sales': round, 'allow_negative_stock': neg, 'settings': {'brand': brand},
      }}));
      if (!mounted) return;
      toast(context, tr('Saved'));
      await s.reloadContext();
      if (r.isEmpty) return;
    } on ApiError catch (e) {
      if (mounted) toast(context, e.message, err: true);
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final can = s.can('acc_admin');
    Widget tf(String k, String label, {int lines = 1}) => Pad(TextField(controller: f[k], enabled: can, maxLines: lines, decoration: InputDecoration(labelText: tr(label))));
    return SubPage('Business settings', [
      if (!can) Note('Only the owner can change these.'),
      const SectionLabel('Business'),
      tf('legal_name', 'Legal name'),
      tf('trade_name', 'Trade name'),
      tf('gstin', 'GSTIN'),
      tf('pan', 'PAN'),
      tf('state_code', 'State code (2 digits)'),
      tf('address', 'Address', lines: 2),
      tf('city', 'City'),
      tf('pincode', 'Pincode'),
      tf('phone', 'Phone'),
      tf('email', 'Email'),
      const SectionLabel('GST'),
      Pad(Seg<String>(expand: true, items: const [('regular', 'Regular'), ('composition', 'Composition'), ('unregistered', 'No GST')], value: reg, onChanged: can ? (v) => setState(() => reg = v) : (_) {})),
      const SectionLabel('Bills'),
      Pad(DropdownButtonFormField<String>(initialValue: invoiceLayouts.any((l) => l.$1 == layout) ? layout : '', decoration: InputDecoration(labelText: tr('Invoice layout')), items: [for (final l in invoiceLayouts) DropdownMenuItem(value: l.$1, child: Text(tr(l.$2)))], onChanged: can ? (v) => setState(() => layout = v ?? '') : null)),
      tf('invoice_terms', 'Terms on invoices', lines: 3),
      tf('invoice_footer', 'Footer line'),
      Pad(SwitchListTile(contentPadding: EdgeInsets.zero, title: Text(tr('Round off sales totals')), value: round, onChanged: can ? (v) => setState(() => round = v) : null)),
      Pad(SwitchListTile(contentPadding: EdgeInsets.zero, title: Text(tr('Allow selling more than is in stock')), value: neg, onChanged: can ? (v) => setState(() => neg = v) : null)),
      if (can) Pad(FilledButton(onPressed: busy ? null : _save, child: Text(tr('Save')))),
    ]);
  }
}
