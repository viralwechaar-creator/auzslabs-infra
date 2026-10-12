import 'dart:async';
import 'dart:convert';
import 'package:app_links/app_links.dart';
import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import '../core/api.dart';
import '../core/session.dart';
import 'theme.dart';

/// Same three doors as the website: Log in (Google, or email + password), Sign up (Google), Staff (username + PIN).
class Login extends StatefulWidget {
  const Login(this.s, {super.key});
  final Session s;
  @override
  State<Login> createState() => _LoginState();
}

class _LoginState extends State<Login> {
  final a = TextEditingController(), b = TextEditingController();
  int tab = 0; // 0 log in, 1 sign up, 2 staff
  bool busy = false, agree = false, updates = false, show = false;
  String? err, info;
  StreamSubscription<Uri>? _sub;

  @override
  void initState() {
    super.initState();
    _sub = AppLinks().uriLinkStream.listen(_onLink);
    AppLinks().getInitialLink().then((u) {
      if (u != null) _onLink(u);
    }).catchError((_) {});
  }

  @override
  void dispose() {
    _sub?.cancel();
    super.dispose();
  }

  Future<void> _onLink(Uri u) async {
    if (u.scheme != 'auzspos' || u.host != 'signin') return;
    final m = RegExp(r'auz_gt=([^&]+)').firstMatch(u.fragment);
    if (m == null) return;
    setState(() => busy = true);
    try {
      var t = m.group(1)!.replaceAll('-', '+').replaceAll('_', '/');
      while (t.length % 4 != 0) {
        t += '=';
      }
      final p = jsonDecode(utf8.decode(base64.decode(t))) as Map;
      final user = widget.s.api.useHandoff('${p['t']}', Map<String, dynamic>.from(p['u'] as Map));
      await widget.s.signIn(user);
    } catch (_) {
      if (mounted) setState(() => err = 'Google sign-in did not finish. Please try again.');
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> google() async {
    if (tab == 1 && !agree) {
      setState(() => err = 'Please tick the box to agree to the Privacy policy and Terms first.');
      return;
    }
    setState(() => err = null);
    final q = {'app': 'pos', 'return': 'auzspos://signin', if (tab == 1) ...{'consent': '1', 'upd': updates ? '1' : '0'}};
    final ok = await launchUrl(Uri.https('auzslab.in', '/signin.html', q), mode: LaunchMode.externalApplication);
    if (!ok && mounted) setState(() => err = 'Could not open the browser for Google sign-in.');
  }

  Future<void> go() async {
    setState(() {
      busy = true;
      err = null;
      info = null;
    });
    try {
      Map<String, dynamic> u;
      try {
        u = tab == 2 ? await widget.s.api.staffLogin(a.text.trim(), b.text.trim()) : await widget.s.api.login(a.text.trim(), b.text);
      } on TwoFactorRequired catch (t) {
        final code = await _ask2fa();
        if (code == null) throw ApiError('Sign in cancelled.');
        u = await widget.s.api.confirm2fa(t.challenge, code);
      }
      await widget.s.signIn(u);
    } on ApiError catch (e) {
      setState(() => err = e.networkError ? 'No connection. Sign in needs the internet the first time.' : e.message);
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> forgot() async {
    final c = TextEditingController(text: a.text.trim());
    final email = await showDialog<String>(
      context: context,
      builder: (_) => AlertDialog(
        title: const Text('Forgot password'),
        content: Column(mainAxisSize: MainAxisSize.min, children: [
          const Text('We will email a link to set a new password.', style: TextStyle(color: Tk.label2)),
          const SizedBox(height: 12),
          TextField(controller: c, keyboardType: TextInputType.emailAddress, autofocus: true, decoration: const InputDecoration(labelText: 'Email')),
        ]),
        actions: [TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')), FilledButton(onPressed: () => Navigator.pop(context, c.text.trim()), child: const Text('Send link'))],
      ),
    );
    if (email == null || email.isEmpty) return;
    try {
      await widget.s.api.forgotPassword(email);
      setState(() {
        err = null;
        info = 'If that address has an account, a reset link is on its way.';
      });
    } on ApiError catch (e) {
      setState(() => err = e.message);
    }
  }

  Future<String?> _ask2fa() {
    final c = TextEditingController();
    return showDialog<String>(
      context: context,
      builder: (_) => AlertDialog(
        title: const Text('Two-step sign in'),
        content: TextField(controller: c, keyboardType: TextInputType.number, autofocus: true, decoration: const InputDecoration(labelText: '6-digit code or backup code')),
        actions: [TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')), FilledButton(onPressed: () => Navigator.pop(context, c.text.trim()), child: const Text('Continue'))],
      ),
    );
  }

  Widget _googleBtn() => OutlinedButton.icon(
        onPressed: busy ? null : google,
        style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(52), backgroundColor: Colors.white, foregroundColor: Tk.label, side: const BorderSide(color: Tk.line)),
        icon: Container(
          width: 22,
          height: 22,
          alignment: Alignment.center,
          decoration: const BoxDecoration(shape: BoxShape.circle, color: Color(0xFF4285F4)),
          child: const Text('G', style: TextStyle(color: Colors.white, fontWeight: FontWeight.w800, fontSize: 13)),
        ),
        label: const Text('Continue with Google', style: TextStyle(fontWeight: FontWeight.w600)),
      );

  @override
  Widget build(BuildContext context) {
    final note = widget.s.notice;
    final titles = ['Welcome back', 'Create your account', 'Staff sign in'];
    final subs = ['Sign in to run your till.', 'Start with your Google account. Then choose your plan.', 'Use the username and PIN your owner gave you.'];
    return Scaffold(
      backgroundColor: Tk.bg,
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(20),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                Image.asset('assets/logo-pos.png', height: 56),
                const SizedBox(height: 20),
                Container(
                  decoration: BoxDecoration(color: Tk.card, borderRadius: BorderRadius.circular(22), border: Border.all(color: Tk.line)),
                  padding: const EdgeInsets.all(20),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                    SegmentedButton<int>(
                      showSelectedIcon: false,
                      segments: const [ButtonSegment(value: 0, label: Text('Log in')), ButtonSegment(value: 1, label: Text('Sign up')), ButtonSegment(value: 2, label: Text('Staff'))],
                      selected: {tab},
                      onSelectionChanged: (v) => setState(() {
                        tab = v.first;
                        err = null;
                        info = null;
                      }),
                    ),
                    const SizedBox(height: 18),
                    Text(titles[tab], style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800)),
                    const SizedBox(height: 4),
                    Text(subs[tab], style: const TextStyle(color: Tk.label2)),
                    const SizedBox(height: 18),
                    if (tab == 1) ...[
                      CheckboxListTile(
                        contentPadding: EdgeInsets.zero,
                        controlAffinity: ListTileControlAffinity.leading,
                        value: agree,
                        onChanged: (v) => setState(() => agree = v == true),
                        title: Text.rich(TextSpan(style: const TextStyle(fontSize: 13), children: <InlineSpan>[
                          const TextSpan(text: 'I agree to the '),
                          TextSpan(text: 'Privacy policy', style: TextStyle(color: Tk.accentText, decoration: TextDecoration.underline)),
                          const TextSpan(text: ' and '),
                          TextSpan(text: 'Terms', style: TextStyle(color: Tk.accentText, decoration: TextDecoration.underline)),
                        ])),
                      ),
                      CheckboxListTile(
                        contentPadding: EdgeInsets.zero,
                        controlAffinity: ListTileControlAffinity.leading,
                        value: updates,
                        onChanged: (v) => setState(() => updates = v == true),
                        title: const Text('Send me product updates (optional)', style: TextStyle(fontSize: 13)),
                      ),
                      const SizedBox(height: 8),
                      _googleBtn(),
                    ] else ...[
                      if (tab == 0) ...[_googleBtn(), const SizedBox(height: 14), Row(children: [const Expanded(child: Divider()), const Padding(padding: EdgeInsets.symmetric(horizontal: 10), child: Text('or', style: TextStyle(color: Tk.label2))), const Expanded(child: Divider())]), const SizedBox(height: 14)],
                      TextField(controller: a, keyboardType: TextInputType.emailAddress, autocorrect: false, decoration: InputDecoration(labelText: tab == 2 ? 'Username' : 'Email')),
                      const SizedBox(height: 12),
                      TextField(
                        controller: b,
                        obscureText: !show,
                        keyboardType: tab == 2 ? TextInputType.number : TextInputType.visiblePassword,
                        decoration: InputDecoration(labelText: tab == 2 ? 'PIN' : 'Password', suffixIcon: IconButton(icon: Icon(show ? Icons.visibility_off : Icons.visibility), onPressed: () => setState(() => show = !show))),
                        onSubmitted: (_) => go(),
                      ),
                      if (tab == 0) Align(alignment: Alignment.centerRight, child: TextButton(onPressed: forgot, child: const Text('Forgot password?'))),
                      const SizedBox(height: 4),
                      FilledButton(onPressed: busy ? null : go, style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(52)), child: Text(busy ? 'Signing in…' : 'Log in')),
                    ],
                    if (err != null || note != null) Padding(padding: const EdgeInsets.only(top: 12), child: Text(err ?? note!, style: const TextStyle(color: Tk.red))),
                    if (info != null) Padding(padding: const EdgeInsets.only(top: 12), child: Text(info!, style: const TextStyle(color: Tk.green))),
                  ]),
                ),
                const SizedBox(height: 16),
                Text(tab == 1 ? 'Already have an account? Use Log in.' : 'New here? Use Sign up to start.', textAlign: TextAlign.center, style: const TextStyle(color: Tk.label2, fontSize: 13)),
              ]),
            ),
          ),
        ),
      ),
    );
  }
}
