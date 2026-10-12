import 'package:flutter/material.dart';
import 'core/session.dart';
import 'ui/login.dart';
import 'ui/home.dart';

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
    const wine = Color(0xFF800020);
    return MaterialApp(
      title: 'AUZsPOS',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(colorScheme: ColorScheme.fromSeed(seedColor: wine), useMaterial3: true, scaffoldBackgroundColor: const Color(0xFFF5F4F2)),
      home: ListenableBuilder(listenable: s, builder: (_, __) => s.signedIn ? Home(s) : Login(s)),
    );
  }
}
