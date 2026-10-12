import 'package:flutter/material.dart' hide Text;
import 'package:flutter/services.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import 'i18n.dart';

/// What happened with a scanned code: shown at the bottom of the camera; [bad] gives a stronger buzz.
class ScanResult {
  const ScanResult(this.text, {this.bad = false, this.stop = false});
  final String text;
  final bool bad, stop;
}

/// A camera that stays open: every code it reads goes to [onCode]; the same code is ignored for 1.6 s so a steady hand
/// does not add it twice. [summary] is the line under the camera (e.g. "3 items · Rs 450").
class ContinuousScanner extends StatefulWidget {
  const ContinuousScanner({required this.title, required this.onCode, required this.summary, super.key});
  final String title;
  final Future<ScanResult> Function(String code) onCode;
  final String Function() summary;
  @override
  State<ContinuousScanner> createState() => _ContinuousScannerState();
}

class _ContinuousScannerState extends State<ContinuousScanner> {
  final ctl = MobileScannerController();
  String last = '';
  DateTime lastAt = DateTime.fromMillisecondsSinceEpoch(0);
  bool busy = false;
  String msg = '';
  bool bad = false;

  @override
  void dispose() {
    ctl.dispose();
    super.dispose();
  }

  Future<void> _got(String code) async {
    final now = DateTime.now();
    if (busy || (code == last && now.difference(lastAt) < const Duration(milliseconds: 1600))) return;
    busy = true;
    last = code;
    lastAt = now;
    try {
      final r = await widget.onCode(code);
      if (r.bad) {
        HapticFeedback.heavyImpact();
        SystemSound.play(SystemSoundType.alert);
      } else {
        HapticFeedback.mediumImpact();
        SystemSound.play(SystemSoundType.click);
      }
      if (mounted) setState(() {
            msg = r.text;
            bad = r.bad;
          });
      if (r.stop && mounted) Navigator.pop(context);
    } finally {
      busy = false;
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        backgroundColor: Colors.black,
        appBar: AppBar(backgroundColor: Colors.black, foregroundColor: Colors.white, title: Text(widget.title, style: const TextStyle(color: Colors.white)), actions: [
          IconButton(icon: const Icon(Icons.flash_on), onPressed: ctl.toggleTorch),
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('Done', style: TextStyle(color: Colors.white, fontSize: 17))),
        ]),
        body: Stack(children: [
          MobileScanner(
            controller: ctl,
            onDetect: (cap) {
              final v = cap.barcodes.firstOrNull?.rawValue;
              if (v != null && v.isNotEmpty) _got(v);
            },
            errorBuilder: (_, e) => Center(child: Padding(padding: const EdgeInsets.all(24), child: Text(tr('The camera is not available. Allow camera access for AUZsLedger in your phone settings.'), textAlign: TextAlign.center, style: const TextStyle(color: Colors.white)))),
          ),
          Center(child: Container(width: 300, height: 170, decoration: BoxDecoration(border: Border.all(color: bad ? Colors.redAccent : Colors.white, width: 3), borderRadius: BorderRadius.circular(18)))),
          Align(
            alignment: Alignment.bottomCenter,
            child: Container(
              width: double.infinity,
              color: Colors.black87,
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 28),
              child: Column(mainAxisSize: MainAxisSize.min, children: [
                if (msg.isNotEmpty) Text(msg, textAlign: TextAlign.center, style: TextStyle(color: bad ? Colors.redAccent : Colors.greenAccent, fontSize: 17, fontWeight: FontWeight.w700)),
                const SizedBox(height: 6),
                Text(widget.summary(), style: const TextStyle(color: Colors.white, fontSize: 17, fontWeight: FontWeight.w600)),
              ]),
            ),
          ),
        ]),
      );
}
