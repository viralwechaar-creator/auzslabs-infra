import 'package:flutter/material.dart';
import '../core/session.dart';
import 'ds.dart';
import 'explore/coming_soon.dart';
import 'explore/explore_sections.dart';
import 'mk.dart';

/// "Explore AUZslab": a table of contents, one native row per section of the marketing site
/// (`exploreSections` in `ui/explore/explore_sections.dart`). A section with its own native
/// screen pushes straight to it; a section not built yet pushes `ComingSoonPage`, which opens
/// the matching page on the website instead. Add a new section there, not here.
class ExplorePage extends StatelessWidget {
  const ExplorePage(this.s, {super.key});
  final HubSession s;

  @override
  Widget build(BuildContext context) {
    final sections = exploreSections(s);
    return SubPage('Explore AUZslab', [
      const Hint('Everything about AUZslab: why it exists, what it costs, and where to look next.'),
      Group([
        for (final sec in sections)
          Li(
            sec.title,
            sub: sec.sub,
            icon: sec.icon,
            tone: sec.tone,
            onTap: () => Navigator.push(context, MaterialPageRoute<void>(builder: (_) => sec.builder != null ? sec.builder!(s) : ComingSoonPage(s, sec.title, sec.sitePath))),
          ),
      ]),
      const SizedBox(height: 16),
    ]);
  }
}
