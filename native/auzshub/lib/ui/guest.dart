import 'package:flutter/material.dart' hide Text;
import '../core/session.dart';
import 'i18n.dart';
import 'login.dart';
import 'theme.dart';

/// Opens the sign in / create account screen on top of whatever the person is looking at.
Future<void> openLogin(BuildContext c, HubSession s, {int tab = 0}) => Navigator.push(c, MaterialPageRoute<void>(builder: (_) => Login(s, startTab: tab, closable: true)));

/// Exploring the app needs no account. Anything that does (sending a request, My account) asks first and carries on after.
/// Returns true when the person is signed in afterwards.
Future<bool> requireAccount(BuildContext c, HubSession s, {int tab = 0}) async {
  if (s.signedIn) return true;
  await openLogin(c, s, tab: tab);
  return s.signedIn;
}

/// The last tab for someone who is not signed in yet: a calm invitation, never a wall.
class GuestPanel extends StatelessWidget {
  const GuestPanel(this.s, {super.key});
  final HubSession s;
  @override
  Widget build(BuildContext context) => Scaffold(
        backgroundColor: Tk.bg,
        body: SafeArea(
          child: Center(
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(20),
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 460),
                child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                  Align(alignment: Alignment.centerLeft, child: ClipRRect(borderRadius: BorderRadius.circular(14), child: Image.asset('assets/icon.png', height: 52, filterQuality: FilterQuality.high))),
                  const SizedBox(height: 22),
                  if (s.notice != null) Padding(padding: const EdgeInsets.only(bottom: 14), child: Text(s.notice!, style: TextStyle(color: Tk.label2, fontSize: 15))),
                  const Text('Your AUZslab account', style: TextStyle(fontSize: 30, fontWeight: FontWeight.w800, letterSpacing: -.6)),
                  const SizedBox(height: 10),
                  Text('Keep looking around as long as you like. Create an account when you are ready to ask for a quote, or sign in to open your apps.', style: TextStyle(fontSize: 17, color: Tk.label2, height: 1.35)),
                  const SizedBox(height: 24),
                  FilledButton(
                    onPressed: () => openLogin(context, s, tab: 1),
                    style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(54), shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16))),
                    child: const Text('Create an account', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
                  ),
                  const SizedBox(height: 12),
                  OutlinedButton(
                    onPressed: () => openLogin(context, s),
                    style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(54), side: BorderSide(color: Tk.line2), shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16))),
                    child: const Text('Sign in', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
                  ),
                  const SizedBox(height: 12),
                  TextButton(onPressed: () => openLogin(context, s, tab: 2), child: const Text('Staff sign in (username and PIN)')),
                ]),
              ),
            ),
          ),
        ),
      );
}
