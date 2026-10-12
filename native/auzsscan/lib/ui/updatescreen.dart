import 'package:flutter/material.dart' hide Text;
import 'i18n.dart';
import 'package:url_launcher/url_launcher.dart';
import '../core/version.dart';
import 'theme.dart';

/// Full-screen "please update" when this build is older than the minimum the website asks for.
class UpdateRequired extends StatelessWidget {
  const UpdateRequired(this.info, {super.key});
  final UpdateInfo info;
  @override
  Widget build(BuildContext context) => Scaffold(
        body: SafeArea(
          child: Center(
            child: Padding(
              padding: const EdgeInsets.all(28),
              child: Column(mainAxisSize: MainAxisSize.min, children: [
                Icon(Icons.system_update, size: 56, color: Tk.accent),
                const SizedBox(height: 16),
                const Text('Please update AUZsScan', style: TextStyle(fontSize: 22, fontWeight: FontWeight.w800)),
                const SizedBox(height: 8),
                Text(info.note.isEmpty ? 'This version is out of date. Update to keep billing safely.' : info.note, textAlign: TextAlign.center, style: TextStyle(color: Tk.label2)),
                const SizedBox(height: 20),
                FilledButton(onPressed: () => launchUrl(Uri.parse(info.url), mode: LaunchMode.externalApplication), child: const Text('Update now')),
              ]),
            ),
          ),
        ),
      );
}
