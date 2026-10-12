import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import '../core/session.dart';
import 'theme.dart';

/// A signed-in person whose account has no business yet (new Google sign-up): send them to pick a plan on the website.
class NoBusiness extends StatelessWidget {
  const NoBusiness(this.s, {super.key});
  final Session s;
  @override
  Widget build(BuildContext context) => Scaffold(
        body: SafeArea(
          child: Center(
            child: Padding(
              padding: const EdgeInsets.all(28),
              child: Column(mainAxisSize: MainAxisSize.min, children: [
                Icon(Icons.storefront_outlined, size: 56, color: Tk.accent),
                const SizedBox(height: 16),
                const Text('Welcome to AUZslab', style: TextStyle(fontSize: 24, fontWeight: FontWeight.w800)),
                const SizedBox(height: 8),
                Text('${s.user?['email'] ?? 'Your account'} is ready, but it has no business yet. Choose your plan on the website and we will set up your till.', textAlign: TextAlign.center, style: const TextStyle(color: Tk.label2)),
                const SizedBox(height: 24),
                FilledButton(onPressed: () => launchUrl(Uri.https('auzslab.in', '/cart.html'), mode: LaunchMode.externalApplication), child: const Text('Choose a plan')),
                const SizedBox(height: 8),
                OutlinedButton(onPressed: () => launchUrl(Uri.https('auzslab.in', '/contact.html'), mode: LaunchMode.externalApplication), child: const Text('Talk to us')),
                TextButton(onPressed: () => s.signOut(), child: const Text('Sign out')),
              ]),
            ),
          ),
        ),
      );
}
