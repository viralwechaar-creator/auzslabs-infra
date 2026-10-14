import 'package:flutter/material.dart' hide Text;
import 'dart:math' as math;
import '../core/site.dart';
import 'i18n.dart';

/// The opening animation (the same idea as the website's): five app tiles fly in and collapse into a spark, rings pulse out, the
/// white AUZslab wordmark scans in from left to right under a wine bar, then the app lifts up. It always plays in full: the app
/// underneath is not built until it ends (so start-up work cannot make it skip frames), and the website pages are decoded in the
/// background meanwhile so the first screen is ready the moment the animation lifts.
class Launch extends StatefulWidget {
  const Launch({super.key, required this.child});
  final Widget child;
  @override
  State<Launch> createState() => _LaunchState();
}

class _LaunchState extends State<Launch> with SingleTickerProviderStateMixin {
  static const total = 3600;
  static const ink = Color(0xFF171717);
  static const wine = Color(0xFFC2183F);
  late final AnimationController c = AnimationController(vsync: this, duration: const Duration(milliseconds: total));
  /// The app can be rebuilt from the top (a theme or language change); the opening must not replay when that happens.
  static bool _played = false;
  bool done = _played;

  @override
  void initState() {
    super.initState();
    c.addStatusListener((st) {
      if (st == AnimationStatus.completed) {
        _played = true;
        if (mounted) setState(() => done = true);
      }
    });
    if (done) return;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      SiteData.load().then((_) {}, onError: (_) {}); // warm the pages off the main thread
      Future.delayed(const Duration(milliseconds: 200), () {
        if (mounted) c.forward();
      });
    });
  }

  @override
  void dispose() {
    c.dispose();
    super.dispose();
  }

  double seg(double t, double a, double b) => ((t - a) / (b - a)).clamp(0.0, 1.0);

  static const tiles = [Color(0xFFF6F4F1), Color(0xFFE8365D), Color(0xFFF6F4F1), Color(0xFFE8365D), Color(0xFFF6F4F1)];

  @override
  Widget build(BuildContext context) {
    if (done) return widget.child;
    return Directionality(
      textDirection: TextDirection.ltr,
      child: AnimatedBuilder(
        animation: c,
        builder: (_, _) {
          final t = c.value;
          final fly = seg(t, 0, .32); // tiles fly in
          final spark = seg(t, .3, .42); // collapse into one point
          final ring = seg(t, .34, .7);
          final scan = Curves.easeInOut.transform(seg(t, .42, .72));
          final tag = seg(t, .66, .8);
          final cover = 1 - Curves.easeIn.transform(seg(t, .9, 1));
          return Opacity(
            opacity: cover,
            child: Transform.scale(
              scale: 1 + .05 * (1 - cover),
              child: Container(
                color: ink,
                alignment: Alignment.center,
                child: Stack(alignment: Alignment.center, children: [
                  // two rings pulsing out
                  for (var i = 0; i < 2; i++)
                    Builder(builder: (_) {
                      final p = seg(ring, i * .25, .75 + i * .25);
                      return Opacity(
                        opacity: (1 - p) * (p > 0 ? .5 : 0),
                        child: Container(width: 60 + 360 * p, height: 60 + 360 * p, decoration: BoxDecoration(shape: BoxShape.circle, border: Border.all(color: wine, width: 2))),
                      );
                    }),
                  // five tiles orbit in, then collapse
                  for (var i = 0; i < 5; i++)
                    Builder(builder: (_) {
                      final a = i / 5 * 6.2832 - 1.5708 + (1 - Curves.easeOut.transform(fly)) * 2.2;
                      final r = 120 * (1 - Curves.easeOut.transform(fly)) * (1 - spark) + 70 * Curves.easeOut.transform(fly) * (1 - spark);
                      final sz = 26.0 * (1 - spark) + 2;
                      return Opacity(
                        opacity: seg(t, 0, .1) * (1 - seg(spark, .6, 1)),
                        child: Transform.translate(
                          offset: Offset(r * _cos(a), r * _sin(a)),
                          child: Container(width: sz, height: sz, decoration: BoxDecoration(color: tiles[i], borderRadius: BorderRadius.circular(6))),
                        ),
                      );
                    }),
                  // the white wordmark scans in from the left
                  Column(mainAxisSize: MainAxisSize.min, children: [
                    SizedBox(
                      width: 236,
                      height: 86,
                      child: Stack(alignment: Alignment.centerLeft, children: [
                        ClipRect(
                          child: Align(
                            alignment: Alignment.centerLeft,
                            widthFactor: scan,
                            child: Image.asset('assets/site/logo.png', width: 236, color: Colors.white, colorBlendMode: BlendMode.srcIn, filterQuality: FilterQuality.high),
                          ),
                        ),
                        if (scan > 0 && scan < 1) Positioned(left: 236 * scan - 1.5, top: 4, bottom: 4, child: Container(width: 3, decoration: BoxDecoration(color: wine, borderRadius: BorderRadius.circular(2)))),
                      ]),
                    ),
                    const SizedBox(height: 16),
                    Opacity(
                      opacity: tag,
                      child: Transform.translate(
                        offset: Offset(0, 6 * (1 - tag)),
                        child: const Text('All your apps. One place.', style: TextStyle(color: Color(0xB3F6F4F1), fontSize: 15, letterSpacing: .3, fontWeight: FontWeight.w500, decoration: TextDecoration.none)),
                      ),
                    ),
                  ]),
                ]),
              ),
            ),
          );
        },
      ),
    );
  }
}

double _cos(double a) => math.cos(a);
double _sin(double a) => math.sin(a);
