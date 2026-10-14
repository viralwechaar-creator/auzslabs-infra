import 'package:flutter/material.dart' hide Text;
import '../../core/session.dart';
import '../ds.dart';
import '../i18n.dart';
import '../mk.dart';
import '../theme.dart';
import 'legal_data.dart';

/// "Legal" (native equivalent of `site/terms.html` and the policies it links to): a table of
/// contents of every legal document, each opened as its own native, word-for-word reader
/// ([LegalDocPage]) built from [legal_data.dart].
class LegalHubPage extends StatelessWidget {
  const LegalHubPage(this.s, {super.key});
  final HubSession s;

  static const _docs = <(String, String, List<LSec>)>[
    ('Terms & conditions', 'The agreement covering your use of AUZslab', termsSections),
    ('Privacy policy', 'What we collect, why, who sees it, and your rights', privacySections),
    ('Refund & cancellation policy', 'Cancelling, and getting money back', refundSections),
    ('Cookie policy', "What cookies we use, and the ones we don't", cookiesSections),
    ('Security policy', 'What we actually do to keep your account and data safe', securitySections),
    ('Acceptable use policy', "What you can and can't do with AUZslab", acceptableUseSections),
    ('Ownership & custom development', 'Who owns the software, your data, and custom work', ipCustomDevSections),
    ('Hardware integration terms', "We don't sell hardware -- how integration requests work", hardwareTermsSections),
    ('Delete your account', 'How to delete your account and what happens to your data', deleteAccountSections),
  ];

  @override
  Widget build(BuildContext context) => SubPage('Legal', [
        const Hint('Every policy, reproduced word for word from the published page. Last updated October 2026.'),
        Group([
          for (final d in _docs)
            Li(
              d.$1,
              sub: d.$2,
              icon: Icons.gavel_outlined,
              tone: Tk.label2,
              onTap: () => Navigator.push(context, MaterialPageRoute<void>(builder: (_) => LegalDocPage(d.$1, d.$3))),
            ),
        ]),
        const SizedBox(height: 16),
      ]);
}

/// A plain, scrollable reader for one legal document: every [LSec] from `legal_data.dart`,
/// rendered verbatim as a heading followed by its paragraphs and bullet lists. This is a
/// generic renderer -- the words come entirely from the data file, never from this page.
class LegalDocPage extends StatelessWidget {
  const LegalDocPage(this.title, this.sections, {super.key});
  final String title;
  final List<LSec> sections;

  Widget _block(LB b) {
    if (b.para != null) {
      return Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
        child: Text(b.para!, style: TextStyle(fontSize: 14.5, height: 1.5, color: Tk.label)),
      );
    }
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        for (final it in b.items!)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('•  ', style: TextStyle(fontSize: 14.5, height: 1.5, color: Tk.label2)),
              Expanded(child: Text(it, style: TextStyle(fontSize: 14.5, height: 1.5, color: Tk.label))),
            ]),
          ),
      ]),
    );
  }

  @override
  Widget build(BuildContext context) => SubPage(title, [
        const Hint('Reproduced word for word from the published policy on auzslab.in.'),
        for (final sec in sections) ...[
          if (sec.heading.isNotEmpty) SectionLabel(sec.heading),
          for (final b in sec.blocks) _block(b),
        ],
        const SizedBox(height: 24),
      ]);
}
