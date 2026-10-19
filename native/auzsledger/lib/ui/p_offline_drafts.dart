import 'package:flutter/material.dart' hide Text;
import '../core/calc.dart';
import '../core/session.dart';
import 'ds.dart';
import 'i18n.dart';
import 'mk.dart';
import 'theme.dart';

/// Bills, expenses and credit notes written while offline or during a lost connection. They sit here,
/// kept on this phone, until the books accept them as unposted drafts -- never posted automatically.
/// This reads and acts on LedgerSession's existing queue (the same one the Sell screen uses for
/// offline sales); it is not a second storage or sync mechanism.
class OfflineDraftsPage extends StatelessWidget {
  const OfflineDraftsPage(this.s, {super.key});
  final LedgerSession s;

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: s,
      builder: (context, _) {
        final items = s.queue.where((q) => q['kind'] == 'draft').toList()..sort((a, b) => n(a['at']).compareTo(n(b['at'])));
        return Scaffold(
          appBar: AppBar(title: Text(tr('Offline drafts'))),
          body: items.isEmpty
              ? emptyBox(Icons.cloud_done_outlined, tr('Nothing waiting'))
              : ListView(padding: const EdgeInsets.only(top: 4, bottom: 24), children: [
                  Pad(Hint(tr('Written while offline or when the books could not be reached. These have NOT been posted -- they are sent as drafts once the connection is back, for you to check and post as usual.'))),
                  Group([
                    for (final it in items) _row(context, it),
                  ]),
                ]),
        );
      },
    );
  }

  Widget _row(BuildContext context, Map<String, dynamic> it) {
    final meta = (it['meta'] as Map?) ?? const {};
    final refused = it['state'] == 'refused';
    final total = meta['total'];
    final party = '${meta['party'] ?? ''}'.isEmpty ? tr('Walk-in') : '${meta['party']}';
    return Li(
      '${meta['label'] ?? tr('Draft')} · $party',
      sub: refused ? '${tr('Refused')}: ${it['error'] ?? ''}' : (total != null ? '${tr('Waiting to send')} · ${inr(n(total))}' : tr('Waiting to send')),
      icon: refused ? Icons.error_outline : Icons.schedule,
      tone: refused ? Tk.red : Tk.orange,
      chevron: false,
      trailing: Row(mainAxisSize: MainAxisSize.min, children: [
        TextButton(
          onPressed: () => refused ? s.retry('${it['op']}') : s.flush(),
          child: Text(tr(refused ? 'Retry' : 'Send now')),
        ),
        TextButton(
          onPressed: () async {
            final ok = await confirm(context, tr('Discard this draft?'), tr('It has not reached your books and cannot be brought back.'), yes: tr('Discard'), danger: true);
            if (ok) await s.discard('${it['op']}');
          },
          child: Text(tr('Discard'), style: TextStyle(color: Tk.red)),
        ),
      ]),
    );
  }
}
