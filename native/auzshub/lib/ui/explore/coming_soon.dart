import 'package:flutter/material.dart' hide Text;
import '../../core/launcher.dart';
import '../../core/session.dart';
import '../ds.dart';
import '../i18n.dart';
import '../theme.dart';

/// Fallback for an Explore section with no native screen yet: say so plainly, then open the real
/// page on the website (same `#auz_gt` session hand-over every other browser tile already uses).
class ComingSoonPage extends StatelessWidget {
  const ComingSoonPage(this.s, this.title, this.sitePath, {super.key});
  final HubSession s;
  final String title, sitePath;

  @override
  Widget build(BuildContext context) => SubPage(title, [
        Padding(
          padding: const EdgeInsets.all(16),
          child: Column(children: [
            Icon(Icons.auto_awesome_outlined, size: 44, color: Tk.label3),
            const SizedBox(height: 14),
            const Text('Coming soon, natively', style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800)),
            const SizedBox(height: 8),
            Text("We haven't built a native screen for this yet. It's ready on the website, with you already signed in.", textAlign: TextAlign.center, style: TextStyle(color: Tk.label2, fontSize: 15, height: 1.35)),
            const SizedBox(height: 20),
            SizedBox(width: double.infinity, child: FilledButton(onPressed: () => openSite(s, sitePath), child: const Text('Open on the website'))),
          ]),
        ),
      ]);
}
