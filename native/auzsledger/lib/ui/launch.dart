import 'package:flutter/material.dart' hide Text;
import 'i18n.dart';

/// The opening animation (same idea as the website's launch screen): the mark rises on ink with a glow,
/// the name appears letter by letter, a small bar runs, then the app lifts up. Always shown for 3 seconds.
class Launch extends StatefulWidget {
  const Launch({super.key, required this.child});
  final Widget child;
  @override
  State<Launch> createState() => _LaunchState();
}

class _LaunchState extends State<Launch> with SingleTickerProviderStateMixin {
  static const total = 3200;
  late final AnimationController c = AnimationController(vsync: this, duration: const Duration(milliseconds: total));
  bool done = false;

  @override
  void initState() {
    super.initState();
    c.addStatusListener((st) {
      if (st == AnimationStatus.completed && mounted) setState(() => done = true);
    });
    // start after the first frame so the animation is not eaten by the app's start-up work
    WidgetsBinding.instance.addPostFrameCallback((_) => Future.delayed(const Duration(milliseconds: 250), () {
          if (mounted) c.forward();
        }));
  }

  @override
  void dispose() {
    c.dispose();
    super.dispose();
  }

  double seg(double t, double a, double b) => ((t - a) / (b - a)).clamp(0.0, 1.0);

  @override
  Widget build(BuildContext context) {
    if (done) return widget.child;
    const word = 'AUZsLedger';
    return Stack(children: [
      widget.child,
      AnimatedBuilder(
        animation: c,
        builder: (_, _) {
          final t = c.value;
          final tile = Curves.easeOutBack.transform(seg(t, 0, .2));
          final glow = Curves.easeOut.transform(seg(t, .05, .5));
          final cover = 1 - Curves.easeIn.transform(seg(t, .86, 1));
          final lift = 1 + .04 * (1 - cover);
          return IgnorePointer(
            ignoring: cover < .05,
            child: Opacity(
              opacity: cover,
              child: Transform.scale(
                scale: lift,
                child: Container(
                  color: const Color(0xFF171717),
                  alignment: Alignment.center,
                  child: Stack(alignment: Alignment.center, children: [
                    Container(
                      width: 420,
                      height: 420,
                      decoration: BoxDecoration(shape: BoxShape.circle, gradient: RadialGradient(colors: [const Color(0xFFC2183F).withValues(alpha: .34 * glow), const Color(0x00C2183F)])),
                    ),
                    Column(mainAxisSize: MainAxisSize.min, children: [
                      Opacity(
                        opacity: seg(t, 0, .15),
                        child: Transform.scale(
                          scale: .7 + .3 * tile,
                          child: ClipRRect(borderRadius: BorderRadius.circular(26), child: Image.asset('assets/icon.png', width: 116, height: 116, filterQuality: FilterQuality.high)),
                        ),
                      ),
                      const SizedBox(height: 24),
                      Row(mainAxisSize: MainAxisSize.min, children: [
                        for (var i = 0; i < word.length; i++)
                          Builder(builder: (_) {
                            final p = seg(t, .28 + i * .035, .28 + i * .035 + .14);
                            return Opacity(
                              opacity: p,
                              child: Transform.translate(
                                offset: Offset(0, 8 * (1 - p)),
                                child: Text(word[i], style: TextStyle(color: i >= 4 ? const Color(0xFFE8365D) : const Color(0xFFF6F4F1), fontSize: 24, fontWeight: i >= 4 ? FontWeight.w800 : FontWeight.w600, letterSpacing: -.2, decoration: TextDecoration.none)),
                              ),
                            );
                          }),
                      ]),
                      const SizedBox(height: 22),
                      Opacity(
                        opacity: seg(t, .5, .6),
                        child: Container(
                          width: 64,
                          height: 3,
                          decoration: BoxDecoration(color: Colors.white12, borderRadius: BorderRadius.circular(2)),
                          alignment: Alignment(-1 + 2 * ((t * 3) % 1), 0),
                          child: FractionallySizedBox(widthFactor: .4, child: Container(decoration: BoxDecoration(color: const Color(0xFFC2183F), borderRadius: BorderRadius.circular(2)))),
                        ),
                      ),
                    ]),
                  ]),
                ),
              ),
            ),
          );
        },
      ),
    ]);
  }
}
