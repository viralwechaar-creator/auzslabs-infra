import 'package:flutter/material.dart';
import 'core/session.dart';
import 'ui/login.dart';
import 'ui/home.dart';
import 'ui/launch.dart';
import 'ui/theme.dart';

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
          home: Launch(child: s.signedIn ? Home(s) : Login(s)),
        );
      },
    );
  }
}
