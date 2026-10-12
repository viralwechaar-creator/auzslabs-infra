import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import '../core/session.dart';
import 'theme.dart';

/// Shown when the business signed in here has not bought AUZsPOS: the till never opens for it.
class NotOnPlan extends StatelessWidget {
  const NotOnPlan(this.s, {super.key});
  final Session s;
  @override
  Widget build(BuildContext context) {
    final apps = <(String, String, String)>[
      if (s.featureOn('mobile')) ('AUZsMob', 'app.auzslab.in', '/mob.html'),
      if (s.featureOn('payroll')) ('AUZsPay', 'app.auzslab.in', '/payroll.html'),
      if (s.featureOn('accounting')) ('AUZsLedger', 'app.auzslab.in', '/accounts.html'),
    ];
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: Padding(
            padding: const EdgeInsets.all(28),
            child: Column(mainAxisSize: MainAxisSize.min, children: [
              Icon(Icons.lock_outline, size: 52, color: Tk.accent),
              const SizedBox(height: 16),
              const Text('AUZsPOS is not part of your plan', textAlign: TextAlign.center, style: TextStyle(fontSize: 22, fontWeight: FontWeight.w800)),
              const SizedBox(height: 8),
              const Text('Your business has not been given access to AUZsPOS. Ask AUZslab to add it, or open the app you have.', textAlign: TextAlign.center, style: TextStyle(color: Tk.label2)),
              const SizedBox(height: 20),
              for (final a in apps)
                Padding(padding: const EdgeInsets.only(bottom: 8), child: SizedBox(width: double.infinity, child: FilledButton(onPressed: () => launchUrl(Uri.https(a.$2, a.$3), mode: LaunchMode.externalApplication), child: Text('Open ${a.$1}')))),
              TextButton(onPressed: () => s.signOut(), child: const Text('Sign out')),
            ]),
          ),
        ),
      ),
    );
  }
}
