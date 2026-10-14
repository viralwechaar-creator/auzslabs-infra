import 'package:url_launcher/url_launcher.dart';
import 'session.dart';

/// One product app. [scheme] is the deep link the app listens on (auzs-name deep link, signin#auz_gt=...), which signs the person in
/// with the hub's session so they do not type a password twice.
class ProductApp {
  const ProductApp(this.id, this.name, this.note, this.scheme, this.release, this.feature);
  final String id, name, note, scheme, release;
  /// Business feature keys that switch this app on (any of them).
  final List<String> feature;
  bool allowedFor(HubSession s) => feature.any(s.own);
}

const releaseBase = 'https://github.com/viralwechaar-creator/auzslabs-infra/releases/tag';

const productApps = <ProductApp>[
  ProductApp('pos', 'AUZsPOS', 'Billing, tables and kitchen', 'auzspos', 'native-pos-latest', ['pos']),
  ProductApp('mob', 'AUZsMob', 'Phone shop stock, sales and repairs', 'auzsmob', 'native-mob-latest', ['mobile']),
  ProductApp('pay', 'AUZsPay', 'Attendance, salary and leave', 'auzspay', 'native-pay-latest', ['payroll']),
  ProductApp('ledger', 'AUZsLedger', 'Invoices, GST and books', 'auzsledger', 'native-ledger-latest', ['accounting']),
  ProductApp('scan', 'AUZsScan', 'Scan, sell and add stock', 'auzsscan', 'native-scan-latest', ['accounting', 'scan']),
];

/// Opens a product app with the hub's session. If the app is not installed, opens its download page instead.
/// Returns true when the app itself was opened.
Future<bool> openProductApp(HubSession s, ProductApp a) async {
  final uri = Uri.parse('${a.scheme}://signin#auz_gt=${s.handoff()}');
  try {
    if (await launchUrl(uri, mode: LaunchMode.externalApplication)) return true;
  } catch (_) {}
  await launchUrl(Uri.parse('$releaseBase/${a.release}'), mode: LaunchMode.externalApplication);
  return false;
}

const siteBase = 'https://auzslab.in/';

/// A page of the website with the signed-in session handed over, so the person is already signed in there.
Uri siteUri(HubSession s, String path) => Uri.parse('$siteBase$path#auz_gt=${s.handoff()}');

Future<void> openSite(HubSession s, String path) => launchUrl(siteUri(s, path), mode: LaunchMode.externalApplication);
