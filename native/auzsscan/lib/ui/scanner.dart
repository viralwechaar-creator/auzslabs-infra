import 'package:flutter/material.dart' hide Text;
import 'package:flutter/services.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import 'i18n.dart';

/// Opens the camera and returns the first bar code it reads (an IMEI sticker, a box code), or null if closed.
Future<String?> scanCode(BuildContext c) => Navigator.push<String>(c, MaterialPageRoute<String>(fullscreenDialog: true, builder: (_) => const _Scanner()));

class _Scanner extends StatefulWidget {
  const _Scanner();
  @override
  State<_Scanner> createState() => _ScannerState();
}

class _ScannerState extends State<_Scanner> {
  final ctl = MobileScannerController();
  bool done = false;
  @override
  void dispose() {
    ctl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        backgroundColor: Colors.black,
        appBar: AppBar(backgroundColor: Colors.black, foregroundColor: Colors.white, title: const Text('Scan the IMEI or bar code', style: TextStyle(color: Colors.white)), actions: [IconButton(icon: const Icon(Icons.flash_on), onPressed: ctl.toggleTorch)]),
        body: Stack(children: [
          MobileScanner(
            controller: ctl,
            onDetect: (cap) {
              if (done) return;
              final v = cap.barcodes.firstOrNull?.rawValue;
              if (v == null || v.isEmpty) return;
              done = true;
              HapticFeedback.mediumImpact();
              Navigator.pop(context, v);
            },
            errorBuilder: (_, e) => Center(child: Padding(padding: const EdgeInsets.all(24), child: Text(tr('The camera is not available. Allow camera access for AUZsMob in your phone settings.'), textAlign: TextAlign.center, style: const TextStyle(color: Colors.white)))),
          ),
          Center(child: Container(width: 280, height: 160, decoration: BoxDecoration(border: Border.all(color: Colors.white, width: 3), borderRadius: BorderRadius.circular(18)))),
        ]),
      );
}
