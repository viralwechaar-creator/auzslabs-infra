import 'package:flutter/material.dart' hide Text;
import '../core/session.dart';
import 'i18n.dart';
import 'mk.dart';
import 'theme.dart';

/// The contact form (same call as the website: submit_lead).
class ContactForm extends StatefulWidget {
  const ContactForm(this.s, {super.key});
  final HubSession s;
  @override
  State<ContactForm> createState() => _ContactFormState();
}

class _ContactFormState extends State<ContactForm> {
  final name = TextEditingController(), biz = TextEditingController(), contact = TextEditingController(), msg = TextEditingController();
  String niche = '';
  bool busy = false, done = false;
  String? err;

  @override
  void dispose() {
    for (final c in [name, biz, contact, msg]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _send() async {
    if (name.text.trim().isEmpty || contact.text.trim().isEmpty) {
      setState(() => err = 'Please add your name and a phone or email.');
      return;
    }
    setState(() {
      busy = true;
      err = null;
    });
    try {
      await widget.s.api.rpc('submit_lead', {'p_name': name.text.trim(), 'p_contact': contact.text.trim(), 'p_business': biz.text.trim(), 'p_message': msg.text.trim(), 'p_niche': niche, 'p_hp': ''});
      if (mounted) setState(() => done = true);
    } catch (e) {
      if (mounted) setState(() => err = 'Could not send. Please check your connection and try again.');
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => _FormCard(
        title: 'Send us a message',
        done: done,
        doneTitle: 'Got it.',
        doneText: 'We will reach out to ${contact.text.trim().isEmpty ? 'you' : contact.text.trim()} shortly.',
        err: err,
        busy: busy,
        send: _send,
        sendLabel: 'Send',
        children: [
          Fld('Name', name),
          gap(),
          Fld('Business', biz),
          gap(),
          Fld('Phone or email', contact),
          gap(),
          Sel('What are you running?', niche, const [('', 'Not sure yet'), ('cafe', 'Cafe, restaurant, bar and more'), ('salon', 'Salon / spa'), ('retail', 'Retail (shoes, clothing, books)'), ('general', 'Something else')], (v) => setState(() => niche = v)),
          gap(),
          Fld('Message', msg, multiline: true, hint: 'What are you running today?'),
        ],
      );
}

/// "Join our team" application (same call as the website: submit_team_application).
class JoinForm extends StatefulWidget {
  const JoinForm(this.s, {super.key});
  final HubSession s;
  @override
  State<JoinForm> createState() => _JoinFormState();
}

class _JoinFormState extends State<JoinForm> {
  final name = TextEditingController(), email = TextEditingController(), phone = TextEditingController(), city = TextEditingController(), exp = TextEditingController(), about = TextEditingController();
  String role = 'salesman';
  bool busy = false, done = false;
  String? err;

  @override
  void dispose() {
    for (final c in [name, email, phone, city, exp, about]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _send() async {
    if (name.text.trim().isEmpty || !email.text.contains('@') || phone.text.trim().isEmpty) {
      setState(() => err = 'Please add your name, email and phone.');
      return;
    }
    setState(() {
      busy = true;
      err = null;
    });
    try {
      await widget.s.api.rpc('submit_team_application', {'p_name': name.text.trim(), 'p_email': email.text.trim(), 'p_phone': phone.text.trim(), 'p_city': city.text.trim(), 'p_role': role, 'p_experience': exp.text.trim(), 'p_about': about.text.trim(), 'p_hp': ''});
      if (mounted) setState(() => done = true);
    } catch (e) {
      if (mounted) setState(() => err = e.toString().replaceFirst('Exception: ', '').isEmpty ? 'Could not send. Please try again.' : e.toString().replaceFirst('Exception: ', ''));
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => _FormCard(
        title: 'Apply',
        done: done,
        doneTitle: 'Application sent.',
        doneText: 'We will look at it and get back to you.',
        err: err,
        busy: busy,
        send: _send,
        sendLabel: 'Send application',
        children: [
          Fld('Full name', name),
          gap(),
          Fld('Email (use the Google email you will sign in with)', email),
          gap(),
          Fld('Phone / WhatsApp', phone, phone: true),
          gap(),
          Fld('City', city),
          gap(),
          Sel('What would you like to do?', role, const [('salesman', 'Salesman: find clients and run demos'), ('setup', 'Client setup: get new clients ready'), ('support', 'Support: help clients after go-live'), ('other', 'Something else')], (v) => setState(() => role = v.isEmpty ? 'salesman' : v)),
          gap(),
          Fld('Your experience (optional)', exp, multiline: true),
          gap(),
          Fld('Why do you want to join? (optional)', about, multiline: true),
        ],
      );
}

class _FormCard extends StatelessWidget {
  const _FormCard({required this.title, required this.done, required this.doneTitle, required this.doneText, required this.err, required this.busy, required this.send, required this.sendLabel, required this.children});
  final String title, doneTitle, doneText, sendLabel;
  final bool done, busy;
  final String? err;
  final VoidCallback send;
  final List<Widget> children;
  @override
  Widget build(BuildContext context) => Container(
        margin: const EdgeInsets.fromLTRB(16, 8, 16, 8),
        padding: const EdgeInsets.all(18),
        decoration: BoxDecoration(color: Tk.card, border: Border.all(color: Tk.line), borderRadius: BorderRadius.circular(22), boxShadow: Tk.sh1),
        child: done
            ? Column(children: [
                Icon(Icons.check_circle_outline, color: Tk.green, size: 44),
                const SizedBox(height: 10),
                Text(doneTitle, style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800)),
                const SizedBox(height: 6),
                Text(doneText, textAlign: TextAlign.center, style: TextStyle(fontSize: 16, color: Tk.label2)),
              ])
            : Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                Text(title, style: const TextStyle(fontSize: 21, fontWeight: FontWeight.w800)),
                const SizedBox(height: 14),
                ...children,
                if (err != null) Padding(padding: const EdgeInsets.only(top: 12), child: Text(err!, style: TextStyle(color: Tk.red, fontSize: 15))),
                const SizedBox(height: 16),
                FilledButton(onPressed: busy ? null : send, style: FilledButton.styleFrom(backgroundColor: Tk.accent, minimumSize: const Size(0, 52), shape: const StadiumBorder()), child: Text(busy ? 'Sending...' : sendLabel, style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700))),
              ]),
      );
}
