import 'dart:io' show Platform;
import 'package:flutter/material.dart' hide Text;
import 'core/session.dart';
import 'core/version.dart';
import 'ui/i18n.dart';
import 'ui/launch.dart';
import 'ui/login.dart';
import 'ui/nobusiness.dart';
import 'ui/notallowed.dart';
import 'ui/shell.dart';
import 'ui/theme.dart';
import 'ui/updatescreen.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final s = LedgerSession();
  await Tk.loadMode();
  await Lang.load();
  await s.restore();
  final upd = await checkUpdate();
  runApp(App(s, upd));
}

class App extends StatefulWidget {
  const App(this.s, this.upd, {super.key});
  final LedgerSession s;
  final UpdateInfo? upd;
  @override
  State<App> createState() => _AppState();
}

class _AppState extends State<App> with WidgetsBindingObserver {
  LedgerSession get s => widget.s;
  UpdateInfo? get upd => widget.upd;
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangePlatformBrightness() => Tk.rev.value++;

  Widget _home() {
    if (upd?.force ?? false) return UpdateRequired(upd!);
    if (!s.signedIn) return Login(s);
    if (s.dash.isNotEmpty && s.dash["tenant"] == null) return NoBusiness(s);
    if (!s.allowed) return NotAllowed(s);
    return LedgerShell(s);
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: Listenable.merge([s, Tk.rev, Lang.rev]),
      builder: (_, _) {
        Tk.dark = Tk.resolve(WidgetsBinding.instance.platformDispatcher.platformBrightness);
        return MaterialApp(
          key: ValueKey('${Tk.dark}${Lang.code}'),
          title: 'AUZsLedger',
          debugShowCheckedModeBanner: false,
          theme: Tk.theme(),
          themeMode: Tk.dark ? ThemeMode.dark : ThemeMode.light,
          darkTheme: Tk.theme(),
          builder: (ctx, child) => _Fit(child: child!),
          home: Launch(child: _home()),
        );
      },
    );
  }
}

/// The screens were drawn at iPhone sizes; Android phones show the same dp larger. Draw the whole app slightly smaller on
/// Android phones (and ignore huge system font sizes), as the other AUZslab apps do.
class _Fit extends StatelessWidget {
  const _Fit({required this.child});
  final Widget child;
  static const k = 0.84;
  @override
  Widget build(BuildContext context) {
    final mq = MediaQuery.of(context);
    if (!Platform.isAndroid || mq.size.shortestSide >= 600) return child;
    final inner = mq.copyWith(size: mq.size / k, padding: mq.padding / k, viewPadding: mq.viewPadding / k, viewInsets: mq.viewInsets / k, textScaler: TextScaler.noScaling);
    return ClipRect(
      child: OverflowBox(
        alignment: Alignment.topLeft,
        minWidth: 0,
        minHeight: 0,
        maxWidth: mq.size.width / k,
        maxHeight: mq.size.height / k,
        child: Transform.scale(scale: k, alignment: Alignment.topLeft, child: SizedBox(width: mq.size.width / k, height: mq.size.height / k, child: MediaQuery(data: inner, child: child))),
      ),
    );
  }
}
