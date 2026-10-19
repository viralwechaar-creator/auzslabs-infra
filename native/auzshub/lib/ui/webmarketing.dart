import 'dart:async';
import 'package:flutter/material.dart' hide Text;
import 'package:url_launcher/url_launcher.dart' as ul;
import 'package:webview_flutter/webview_flutter.dart';
import '../core/session.dart';
import '../core/webflag.dart';
import 'i18n.dart';
import 'mkt.dart';
import 'site.dart' show MktHeader;

/// Home-page WebView pilot (see docs/HUB_WEBVIEW_PILOT.md). Shows the REAL, live
/// `https://auzslab.in/index.html` inside the app instead of `SitePage(s, 'index')`'s native
/// renderer. Only reachable when `WebPilot.homeEnabled` is true (off by default, see
/// `core/webflag.dart`) -- every other tab (Products, Pricing, Menu, Account, Admin, Team, Cart)
/// is untouched and keeps using the native renderer regardless of this flag.
///
/// Safety rules enforced here, not left to the website to assume:
/// - the user agent includes "AUZslabApp" so the website's own in-app mode (`ds/appshell.js`)
///   applies automatically, with no change to the website itself;
/// - navigation is restricted to `auzslab.in` / `*.auzslab.in` -- any other address (a payment
///   gateway redirect, a third-party link) opens the system browser instead of loading inside
///   this WebView, the same restriction the existing Capacitor wrapper already applies
///   (`mobile/build.mjs`: `allowNavigation: ['auzslab.in','*.auzslab.in']`);
/// - no session token, cookie or `#auz_gt` hand-off is ever injected -- the Home page is public,
///   so this pilot carries no authentication data into the WebView at all;
/// - a load failure shows a plain retry/fallback screen, never a blank or stuck page, and the
///   fallback button switches back to the native Home page immediately.
class WebMarketingHome extends StatefulWidget {
  const WebMarketingHome(this.s, {super.key});
  final HubSession s;
  @override
  State<WebMarketingHome> createState() => _WebMarketingHomeState();
}

class _WebMarketingHomeState extends State<WebMarketingHome> {
  static const _url = 'https://auzslab.in/index.html';

  WebViewController? _c;
  bool _loading = true;
  bool _error = false;

  bool _hostAllowed(String host) => host == 'auzslab.in' || host.endsWith('.auzslab.in');

  @override
  void initState() {
    super.initState();
    _init();
  }

  Future<void> _init() async {
    setState(() {
      _loading = true;
      _error = false;
    });
    try {
      final c = WebViewController();
      await c.setJavaScriptMode(JavaScriptMode.unrestricted);
      final ua = await c.getUserAgent();
      await c.setUserAgent('${ua ?? ''} AUZslabApp'.trim());
      await c.setBackgroundColor(M.page);
      await c.setNavigationDelegate(NavigationDelegate(
        onPageStarted: (_) {
          if (mounted) setState(() => _loading = true);
        },
        onPageFinished: (_) {
          if (mounted) setState(() => _loading = false);
        },
        onWebResourceError: (e) {
          // Only a failure loading the Home page itself counts as an error here -- a blocked
          // sub-resource (an analytics script, a web font) must not flip the whole screen over.
          if (mounted && (e.isForMainFrame ?? true)) {
            setState(() {
              _loading = false;
              _error = true;
            });
          }
        },
        onNavigationRequest: (req) {
          final uri = Uri.tryParse(req.url);
          if (uri == null) return NavigationDecision.prevent;
          if (_hostAllowed(uri.host)) return NavigationDecision.navigate;
          unawaited(ul.launchUrl(uri, mode: ul.LaunchMode.externalApplication));
          return NavigationDecision.prevent;
        },
      ));
      await c.loadRequest(Uri.parse(_url));
      if (mounted) setState(() => _c = c);
    } catch (_) {
      if (mounted) {
        setState(() {
          _loading = false;
          _error = true;
        });
      }
    }
  }

  Future<bool> _goBackIfPossible() async {
    final c = _c;
    if (c == null) return true;
    if (await c.canGoBack()) {
      await c.goBack();
      return false;
    }
    return true;
  }

  void _useNativeInstead() => WebPilot.set(false);

  @override
  Widget build(BuildContext context) {
    final c = _c;
    return Theme(
      data: marketingTheme(),
      child: Scaffold(
        backgroundColor: M.page,
        body: PopScope(
          canPop: false,
          onPopInvokedWithResult: (didPop, _) async {
            if (didPop) return;
            // Home is the first (bottom-most) tab of the hub, not a pushed route -- there is
            // nothing above it to pop. If the in-page site has its own history (a link was
            // followed), go back a page there; otherwise there is simply nothing to do.
            await _goBackIfPossible();
          },
          child: Stack(children: [
            if (_error)
              _ErrorView(onRetry: _init, onUseNative: _useNativeInstead)
            else if (c != null)
              WebViewWidget(controller: c)
            else
              const SizedBox.shrink(),
            if (_loading && !_error) const Positioned.fill(child: Center(child: CircularProgressIndicator(color: M.wine))),
            Positioned(top: 0, left: 0, right: 0, child: MktHeader(widget.s, back: false)),
          ]),
        ),
      ),
    );
  }
}

class _ErrorView extends StatelessWidget {
  const _ErrorView({required this.onRetry, required this.onUseNative});
  final VoidCallback onRetry, onUseNative;
  @override
  Widget build(BuildContext context) => Center(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(32, 130, 32, 32),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            const Icon(Icons.wifi_off_outlined, size: 40, color: M.faint),
            const SizedBox(height: 12),
            Text('Could not load the live Home page', style: inter(16, w: 700, color: M.ink), textAlign: TextAlign.center),
            const SizedBox(height: 6),
            Text('Check your connection and try again, or use the app’s own Home page.', textAlign: TextAlign.center, style: inter(13.5, color: M.dim)),
            const SizedBox(height: 18),
            FilledButton(onPressed: onRetry, child: Text('Try again')),
            const SizedBox(height: 8),
            TextButton(onPressed: onUseNative, child: Text('Use the app’s Home page instead')),
          ]),
        ),
      );
}
