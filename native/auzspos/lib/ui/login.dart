import 'package:flutter/material.dart';
import '../core/api.dart';
import '../core/session.dart';

class Login extends StatefulWidget {
  const Login(this.s, {super.key});
  final Session s;
  @override
  State<Login> createState() => _LoginState();
}

class _LoginState extends State<Login> {
  final a = TextEditingController(), b = TextEditingController();
  bool staff = false, busy = false;
  String? err;

  Future<void> go() async {
    setState(() {
      busy = true;
      err = null;
    });
    try {
      Map<String, dynamic> u;
      try {
        u = staff ? await widget.s.api.staffLogin(a.text.trim(), b.text.trim()) : await widget.s.api.login(a.text.trim(), b.text);
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

  @override
  Widget build(BuildContext context) {
    final note = widget.s.notice;
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 400),
              child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                const Text('AUZsPOS', textAlign: TextAlign.center, style: TextStyle(fontSize: 30, fontWeight: FontWeight.w800)),
                const SizedBox(height: 24),
                SegmentedButton<bool>(
                  segments: const [ButtonSegment(value: false, label: Text('Owner / manager')), ButtonSegment(value: true, label: Text('Staff'))],
                  selected: {staff},
                  onSelectionChanged: (v) => setState(() => staff = v.first),
                ),
                const SizedBox(height: 16),
                TextField(controller: a, keyboardType: TextInputType.emailAddress, autocorrect: false, decoration: InputDecoration(labelText: staff ? 'Username' : 'Email', border: const OutlineInputBorder())),
                const SizedBox(height: 12),
                TextField(controller: b, obscureText: true, keyboardType: staff ? TextInputType.number : TextInputType.visiblePassword, decoration: InputDecoration(labelText: staff ? 'PIN' : 'Password', border: const OutlineInputBorder())),
                if (err != null || note != null) Padding(padding: const EdgeInsets.only(top: 12), child: Text(err ?? note!, style: const TextStyle(color: Colors.red))),
                const SizedBox(height: 16),
                FilledButton(onPressed: busy ? null : go, style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(52)), child: Text(busy ? 'Signing in…' : 'Sign in')),
              ]),
            ),
          ),
        ),
      ),
    );
  }
}
