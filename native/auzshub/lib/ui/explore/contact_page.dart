import 'package:flutter/material.dart' hide Text;
import 'package:url_launcher/url_launcher.dart';
import '../../core/api.dart';
import '../../core/orderdata.dart';
import '../../core/session.dart';
import '../ds.dart';
import '../i18n.dart';
import '../mk.dart';
import '../theme.dart';

/// "Contact us" (native equivalent of `site/contact.html`): the same channels the website
/// offers -- WhatsApp, phone and email to AUZslab's own number, plus the "tell us how your
/// business works" form (`submit_lead`, the same RPC the website's contact modal calls) -- and
/// the site's own "before you write in" FAQ, word for word.
class ContactPage extends StatefulWidget {
  const ContactPage(this.s, {super.key});
  final HubSession s;
  @override
  State<ContactPage> createState() => _ContactPageState();
}

/// Real support number from `site/company.js` (`CO.phone`): used for the call and WhatsApp
/// quick actions below, same as the website's footer and "Talk to us on WhatsApp" links.
const _supportPhone = '+91 9251250829';
const _supportEmail = 'helloauzslab@gmail.com';

class _ContactPageState extends State<ContactPage> {
  final name = TextEditingController(), business = TextEditingController(), contact = TextEditingController(), message = TextEditingController();
  String niche = '';
  bool busy = false, sent = false;
  String? err;

  static const _nicheOptions = <(String, String)>[
    ('', 'Not sure yet'),
    ...nicheOptions,
  ];

  Future<void> _call() => launchUrl(Uri.parse('tel:$_supportPhone'));
  Future<void> _whatsapp() => launchUrl(Uri.parse('https://wa.me/${_supportPhone.replaceAll(RegExp(r'\D'), '')}?text=${Uri.encodeComponent('Hi AUZslab')}'), mode: LaunchMode.externalApplication);
  Future<void> _email() => launchUrl(Uri.parse('mailto:$_supportEmail'));

  Future<void> _send() async {
    String? bad;
    if (name.text.trim().isEmpty) {
      bad = 'Please enter your name.';
    } else if (contact.text.trim().isEmpty) {
      bad = 'Please tell us how to reach you (phone or email).';
    }
    if (bad != null) {
      setState(() => err = bad);
      return;
    }
    setState(() {
      busy = true;
      err = null;
    });
    try {
      await widget.s.api.rpc('submit_lead', {
        'p_name': name.text.trim(),
        'p_contact': contact.text.trim(),
        'p_business': business.text.trim(),
        'p_message': message.text.trim(),
        'p_niche': niche,
        'p_hp': '',
      });
      if (!mounted) return;
      setState(() {
        busy = false;
        sent = true;
      });
    } on ApiError catch (e) {
      if (mounted) {
        setState(() {
          busy = false;
          err = e.message;
        });
      }
    }
  }

  Widget _quick(IconData icon, String label, Color tone, VoidCallback onTap) => Expanded(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 4),
          child: Material(
            color: Tk.card,
            borderRadius: BorderRadius.circular(16),
            child: InkWell(
              borderRadius: BorderRadius.circular(16),
              onTap: onTap,
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: 14),
                child: Column(children: [
                  Icon(icon, color: tone, size: 26),
                  const SizedBox(height: 6),
                  Text(label, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700)),
                ]),
              ),
            ),
          ),
        ),
      );

  Widget _faq(String q, String a) => Padding(
        padding: const EdgeInsets.only(bottom: 14),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(q, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w800)),
          const SizedBox(height: 6),
          Text(a, style: TextStyle(color: Tk.label2, fontSize: 14, height: 1.4)),
        ]),
      );

  @override
  Widget build(BuildContext context) => SubPage('Contact us', [
        Container(
          margin: const EdgeInsets.fromLTRB(16, 10, 16, 6),
          padding: const EdgeInsets.all(20),
          decoration: BoxDecoration(color: Tk.accent, borderRadius: BorderRadius.circular(22)),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            const Text('CONTACT', style: TextStyle(color: Colors.white70, fontWeight: FontWeight.w800, fontSize: 12, letterSpacing: 1.1)),
            const SizedBox(height: 10),
            const Text('Tell us how your business works.', style: TextStyle(color: Colors.white, fontSize: 24, fontWeight: FontWeight.w800, height: 1.15, letterSpacing: -.4)),
            const SizedBox(height: 10),
            Text("We'll help you find the right AUZslab setup, from ready-to-use software to a system shaped around your workflow. We reply within a day.", style: TextStyle(color: Colors.white.withValues(alpha: .88), fontSize: 15, height: 1.35)),
          ]),
        ),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
          child: Row(children: [
            _quick(Icons.chat_outlined, 'WhatsApp', Tk.green, _whatsapp),
            _quick(Icons.call_outlined, 'Call', Tk.blue, _call),
            _quick(Icons.mail_outline, 'Email', Tk.orange, _email),
          ]),
        ),
        const SectionLabel('Reach us directly'),
        const Hint('Prefer to skip the form? Write to us directly.'),
        Pad(Text(_supportEmail, style: TextStyle(color: Tk.accentText, fontWeight: FontWeight.w700, fontSize: 16))),
        const SectionLabel('Or send us the details'),
        if (sent)
          Pad(Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(color: Tk.green.withValues(alpha: .12), borderRadius: BorderRadius.circular(16)),
            child: Row(children: [
              Icon(Icons.check_circle, color: Tk.green),
              const SizedBox(width: 10),
              Expanded(child: Text('Got it. We will reach out to ${contact.text.trim().isEmpty ? 'you' : contact.text.trim()} shortly.', style: const TextStyle(fontWeight: FontWeight.w600))),
            ]),
          ))
        else ...[
          Pad(Fld('Name', name)),
          Pad(Fld('Business', business)),
          Pad(Fld('Phone or email', contact)),
          Pad(Sel('What are you running?', niche, _nicheOptions, (v) => setState(() => niche = v))),
          Pad(Fld('Message', message, multiline: true, hint: 'What are you running today?')),
          if (err != null) Note(err!, bad: true),
          Pad(FilledButton(onPressed: busy ? null : _send, child: Text(busy ? 'Sending...' : 'Send'))),
        ],
        const SectionLabel('Before you write in'),
        const Hint('A few things people usually ask.'),
        Pad(Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          _faq('Can I run more than one outlet on this?', 'Yes — every outlet shares one account, one login and one customer list. No separate sign-ups per branch.'),
          _faq('Is my business data actually mine?', 'We look after it for you, and your data stays yours.'),
          _faq("We already use another POS — can we switch?", "Tell us what you're on today in the form above — we'll map out the switch before you commit to anything."),
          _faq('How fast do you reply?', 'Within a day, usually sooner.'),
        ])),
        const SizedBox(height: 16),
      ]);
}
