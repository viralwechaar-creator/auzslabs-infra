import 'dart:io' show Platform;
import 'package:flutter/material.dart';
import 'core/session.dart';
import 'ui/login.dart';
import 'ui/home.dart';
import 'ui/launch.dart';
import 'ui/theme.dart';
import 'ui/nobusiness.dart';
import 'ui/notonplan.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final s = Session();
  await s.restore();
  runApp(App(s));
}

class App extends StatelessWidget {
  const App(this.s, {super.key});
  final Session s;
  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: s,
      builder: (_, _) {
        Tk.accent = Tk.parse(s.signedIn ? '${s.cfg['col'] ?? ''}' : null);
        return MaterialApp(
          title: 'AUZsPOS',
          debugShowCheckedModeBanner: false,
          theme: Tk.theme(),
          themeMode: ThemeMode.light,
          builder: (ctx, child) => _Fit(child: child!),
          home: Launch(child: !s.signedIn ? Login(s) : (!s.hasBusiness ? NoBusiness(s) : (s.posAllowed ? Home(s) : NotOnPlan(s)))),
        );
      },
    );
  }
}

/// The screens were drawn at iPhone sizes; Android phones show the same dp larger. Draw the whole app
/// slightly smaller on Android (and ignore huge system font sizes) so it matches the website POS.
class _Fit extends StatelessWidget {
  const _Fit({required this.child});
  final Widget child;
  static const k = 0.84;
  @override
  Widget build(BuildContext context) {
    if (!Platform.isAndroid) return child;
    final mq = MediaQuery.of(context);
    final inner = mq.copyWith(
      size: mq.size / k,
      padding: mq.padding / k,
      viewPadding: mq.viewPadding / k,
      viewInsets: mq.viewInsets / k,
      textScaler: TextScaler.noScaling,
    );
    return ClipRect(
      child: OverflowBox(
        alignment: Alignment.topLeft,
        minWidth: 0, minHeight: 0,
        maxWidth: mq.size.width / k, maxHeight: mq.size.height / k,
        child: Transform.scale(
          scale: k,
          alignment: Alignment.topLeft,
          child: SizedBox(width: mq.size.width / k, height: mq.size.height / k, child: MediaQuery(data: inner, child: child)),
        ),
      ),
    );
  }
}
