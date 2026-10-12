import 'dart:async';
import 'dart:convert';
import 'package:app_links/app_links.dart';
import 'package:flutter/material.dart' hide Text;
import 'i18n.dart';
import 'package:flutter/material.dart' as m;
import 'package:url_launcher/url_launcher.dart';
import '../core/api.dart';
import '../core/session.dart';
import 'ds.dart';
import 'theme.dart';

/// Same three doors as the website: Log in (Google, or email + password), Sign up (Google), Staff (username + PIN).
class Login extends StatefulWidget {
  const Login(this.s, {super.key});
  final MobSession s;
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
    if (u.scheme != 'auzsmob' || u.host != 'signin') return;
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
    final q = {'app': 'mob', 'return': 'auzsmob://signin', if (tab == 1) ...{'consent': '1', 'upd': updates ? '1' : '0'}};
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
          Text('We will email a link to set a new password.', style: TextStyle(color: Tk.label2)),
          const SizedBox(height: 12),
          TextField(controller: c, keyboardType: TextInputType.emailAddress, autofocus: true, decoration: InputDecoration(labelText: tr('Email'))),
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
        content: TextField(controller: c, keyboardType: TextInputType.number, autofocus: true, decoration: InputDecoration(labelText: tr('6-digit code or backup code'))),
        actions: [TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')), FilledButton(onPressed: () => Navigator.pop(context, c.text.trim()), child: const Text('Continue'))],
      ),
    );
  }

  Widget _googleBtn() => OutlinedButton(
        onPressed: busy ? null : google,
        style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(56), backgroundColor: Tk.fill3, side: BorderSide(color: Tk.line2, width: 1), shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18))),
        child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [
          Container(width: 24, height: 24, alignment: Alignment.center, decoration: const BoxDecoration(shape: BoxShape.circle, color: Colors.white), child: const Text('G', style: TextStyle(color: Color(0xFF4285F4), fontWeight: FontWeight.w900, fontSize: 18))),
          const SizedBox(width: 12),
          const Text('Continue with Google', style: TextStyle(fontSize: 19, fontWeight: FontWeight.w700)),
        ]),
      );

  @override
  Widget build(BuildContext context) {
    final note = widget.s.notice;
    final staff = tab == 2;
    return Scaffold(
      backgroundColor: Tk.bg,
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(14),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 480),
              child: Container(
                padding: const EdgeInsets.fromLTRB(28, 32, 28, 28),
                decoration: BoxDecoration(color: Tk.card, borderRadius: BorderRadius.circular(32), border: Border.all(color: Tk.line, width: .5)),
                child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                  Align(alignment: Alignment.centerRight, child: Seg<String>(items: const [('en', 'English'), ('hi', 'हिंदी')], value: Lang.code, onChanged: (v) => Lang.set(v))),
                  const SizedBox(height: 14),
                  Align(alignment: Alignment.centerLeft, child: Image.asset('assets/icon.png', height: 52, filterQuality: FilterQuality.high)),
                  const SizedBox(height: 22),
                  Text(tab == 1 ? 'Create account' : 'Sign in', style: const TextStyle(fontSize: 34, fontWeight: FontWeight.w800, letterSpacing: -.8)),
                  const SizedBox(height: 10),
                  Text(tab == 1 ? 'Start with your Google account, then choose your plan.' : staff ? 'Use the username and PIN your owner gave you.' : 'Use the email and password your business gave you.', style: TextStyle(fontSize: 20, color: Tk.label2, height: 1.3)),
                  const SizedBox(height: 22),
                  if (tab == 1) ...[
                    CheckboxListTile(
                      contentPadding: EdgeInsets.zero,
                      controlAffinity: ListTileControlAffinity.leading,
                      value: agree,
                      onChanged: (v) => setState(() => agree = v == true),
                      title: m.Text.rich(TextSpan(style: const TextStyle(fontSize: 16), children: <InlineSpan>[const TextSpan(text: 'I agree to the '), TextSpan(text: 'Privacy policy', style: TextStyle(color: Tk.accentText, decoration: TextDecoration.underline)), const TextSpan(text: ' and '), TextSpan(text: 'Terms', style: TextStyle(color: Tk.accentText, decoration: TextDecoration.underline))])),
                    ),
                    CheckboxListTile(contentPadding: EdgeInsets.zero, controlAffinity: ListTileControlAffinity.leading, value: updates, onChanged: (v) => setState(() => updates = v == true), title: const Text('Send me product updates (optional)', style: TextStyle(fontSize: 16))),
                    const SizedBox(height: 8),
                    _googleBtn(),
                  ] else ...[
                    if (tab == 0) ...[_googleBtn(), const SizedBox(height: 16), Center(child: Text('or', style: TextStyle(fontSize: 18, color: Tk.label2))), const SizedBox(height: 16)],
                    Seg<int>(expand: true, items: const [(0, 'Email'), (2, 'Staff')], value: tab, onChanged: (v) => setState(() {
                          tab = v;
                          err = null;
                          info = null;
                        })),
                    const SizedBox(height: 16),
                    TextField(controller: a, style: const TextStyle(fontSize: 19), keyboardType: TextInputType.emailAddress, autocorrect: false, decoration: InputDecoration(hintText: staff ? 'Username' : 'Email', contentPadding: const EdgeInsets.symmetric(horizontal: 20, vertical: 20), border: OutlineInputBorder(borderRadius: BorderRadius.circular(18), borderSide: BorderSide.none), enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(18), borderSide: BorderSide.none))),
                    const SizedBox(height: 14),
                    TextField(
                      controller: b,
                      obscureText: !show,
                      style: const TextStyle(fontSize: 19),
                      keyboardType: staff ? TextInputType.number : TextInputType.visiblePassword,
                      decoration: InputDecoration(hintText: staff ? 'PIN' : 'Password', contentPadding: const EdgeInsets.symmetric(horizontal: 20, vertical: 20), border: OutlineInputBorder(borderRadius: BorderRadius.circular(18), borderSide: BorderSide.none), enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(18), borderSide: BorderSide.none), suffixIcon: IconButton(icon: Icon(show ? Icons.visibility_off_outlined : Icons.visibility_outlined, color: Tk.label2), onPressed: () => setState(() => show = !show))),
                      onSubmitted: (_) => go(),
                    ),
                    if (!staff) Align(alignment: Alignment.centerRight, child: TextButton(onPressed: forgot, child: const Text('Forgot password?', style: TextStyle(fontSize: 18)))) else const SizedBox(height: 14),
                    FilledButton(onPressed: busy ? null : go, style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(64), shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(22)), textStyle: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800)), child: Text(busy ? 'Signing in…' : 'Sign in')),
                  ],
                  if (err != null || note != null) Padding(padding: const EdgeInsets.only(top: 14), child: Text(err ?? note!, style: TextStyle(color: Tk.red, fontSize: 17))),
                  if (info != null) Padding(padding: const EdgeInsets.only(top: 14), child: Text(info!, style: TextStyle(color: Tk.green, fontSize: 17))),
                  const SizedBox(height: 26),
                  Center(
                    child: Wrap(alignment: WrapAlignment.center, children: [
                      const Text('New to AUZslab? ', style: TextStyle(fontSize: 18)),
                      GestureDetector(onTap: () => setState(() {
                            tab = tab == 1 ? 0 : 1;
                            err = null;
                          }), child: Text(tab == 1 ? 'Sign in' : 'Create an account', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800, color: Tk.accent))),
                      const Text(' · ', style: TextStyle(fontSize: 18)),
                      GestureDetector(onTap: () => launchUrl(Uri.https('auzslab.in', '/pricing.html'), mode: LaunchMode.externalApplication), child: Text('See plans', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800, color: Tk.accent))),
                    ]),
                  ),
                ]),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
