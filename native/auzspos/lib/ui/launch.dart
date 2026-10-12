import 'package:flutter/material.dart';

/// The opening animation: the AUZsPOS mark grows in on ink, glows, then the app fades up.
class Launch extends StatefulWidget {
  const Launch({super.key, required this.child});
  final Widget child;
  @override
  State<Launch> createState() => _LaunchState();
}

class _LaunchState extends State<Launch> with SingleTickerProviderStateMixin {
  late final AnimationController c = AnimationController(vsync: this, duration: const Duration(milliseconds: 1700))..forward();
  bool done = false;

  @override
  void initState() {
    super.initState();
    c.addStatusListener((st) {
      if (st == AnimationStatus.completed && mounted) setState(() => done = true);
    });
  }

  @override
  void dispose() {
    c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (done) return widget.child;
    return Stack(children: [
      widget.child,
      AnimatedBuilder(
        animation: c,
        builder: (_, _) {
          final t = c.value;
          final scale = Curves.easeOutBack.transform((t / 0.45).clamp(0, 1)) * .4 + .6;
          final logoOpacity = (t / 0.3).clamp(0, 1).toDouble();
          final cover = t < 0.78 ? 1.0 : 1 - ((t - 0.78) / 0.22).clamp(0, 1).toDouble();
          return IgnorePointer(
            ignoring: cover < .05,
            child: Opacity(
              opacity: cover,
              child: Container(
                color: const Color(0xFF171717),
                alignment: Alignment.center,
                child: Opacity(
                  opacity: logoOpacity,
                  child: Transform.scale(
                    scale: scale,
                    child: Column(mainAxisSize: MainAxisSize.min, children: [
                      Container(
                        decoration: BoxDecoration(borderRadius: BorderRadius.circular(28), boxShadow: [BoxShadow(color: const Color(0xFFC2183F).withValues(alpha: .35 * (1 - (t - .3).abs().clamp(0, 1))), blurRadius: 46, spreadRadius: 4)]),
                        child: ClipRRect(borderRadius: BorderRadius.circular(28), child: Image.asset('assets/icon.png', width: 112, height: 112)),
                      ),
                      const SizedBox(height: 18),
                      const Text('AUZsPOS', style: TextStyle(color: Colors.white, fontSize: 22, fontWeight: FontWeight.w800, letterSpacing: 1.2, decoration: TextDecoration.none)),
                    ]),
                  ),
                ),
              ),
            ),
          );
        },
      ),
    ]);
  }
}
