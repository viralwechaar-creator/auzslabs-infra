import 'package:flutter/material.dart' hide Text;
import '../core/session.dart';
import 'home.dart';
import 'site.dart';

/// The hub's main screen. Anyone can look around: the website's home page opens first, exactly as on the web (its own top bar has
/// the light / dark switch, GET STARTED or MY APPS, and MENU for every other page). People who work in the apps (business owner, staff,
/// team, admin) open on their apps; there is no bottom bar.
class HubShell extends StatelessWidget {
  const HubShell(this.s, {super.key});
  final HubSession s;

  @override
  Widget build(BuildContext context) => ListenableBuilder(
        listenable: s,
        builder: (context, _) {
          final work = s.signedIn && s.kind != Kind.customer;
          return work ? HubHome(s, key: const ValueKey('apps')) : SitePage(s, 'index', top: true, key: const ValueKey('site'));
        },
      );
}
