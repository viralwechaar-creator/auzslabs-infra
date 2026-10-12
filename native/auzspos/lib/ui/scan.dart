import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import 'package:url_launcher/url_launcher.dart';
import 'home.dart';
import 'theme.dart';

/// Opens the camera, reads one QR code and acts on it: a table QR of this business starts a dine-in order,
/// anything else offers to open or copy the link.
Future<void> scanAndHandle(BuildContext c, HomeState h) async {
  final code = await Navigator.push<String>(c, MaterialPageRoute<String>(fullscreenDialog: true, builder: (_) => const _Scanner()));
  if (code == null || !c.mounted) return;
  final u = Uri.tryParse(code);
  final tid = u?.queryParameters['t'];
  final mine = u != null && u.host == '${h.s.slug}.auzslab.in';
  if (mine && tid != null && h.s.repo!.rec(tid) != null) {
    final t = h.s.repo!.rec(tid)!;
    Navigator.popUntil(c, (r) => r.isFirst);
    h.startDineIn(tid);
    h.toast('Table ${t['name']} selected');
    return;
  }
  if (!c.mounted) return;
  await showModalBottomSheet<void>(
    context: c,
    showDragHandle: true,
    builder: (_) => SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(20, 0, 20, 20),
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          const Text('QR code read', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
          const SizedBox(height: 8),
          Text(mine && tid != null ? 'This is a table QR of your business, but that table is not in your list yet.' : code, style: const TextStyle(color: Tk.label2)),
          const SizedBox(height: 14),
          if (u != null && (u.scheme == 'https' || u.scheme == 'http')) FilledButton.icon(onPressed: () => launchUrl(u, mode: LaunchMode.externalApplication), icon: const Icon(Icons.open_in_new), label: const Text('Open link')),
          const SizedBox(height: 8),
          OutlinedButton.icon(onPressed: () => Clipboard.setData(ClipboardData(text: code)), icon: const Icon(Icons.copy), label: const Text('Copy')),
        ]),
      ),
    ),
  );
}

class _Scanner extends StatefulWidget {
  const _Scanner();
  @override
  State<_Scanner> createState() => _ScannerState();
}

class _ScannerState extends State<_Scanner> {
  final ctl = MobileScannerController(formats: const [BarcodeFormat.qrCode]);
  bool done = false;
  @override
  void dispose() {
    ctl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        backgroundColor: Colors.black,
        appBar: AppBar(backgroundColor: Colors.black, foregroundColor: Colors.white, title: const Text('Scan a QR code', style: TextStyle(color: Colors.white)), actions: [IconButton(icon: const Icon(Icons.flash_on), onPressed: ctl.toggleTorch)]),
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
            errorBuilder: (_, e) => const Center(child: Padding(padding: EdgeInsets.all(24), child: Text('The camera is not available. Allow camera access for AUZsPOS in your phone settings.', textAlign: TextAlign.center, style: TextStyle(color: Colors.white)))),
          ),
          Center(child: Container(width: 250, height: 250, decoration: BoxDecoration(border: Border.all(color: Colors.white, width: 3), borderRadius: BorderRadius.circular(24)))),
          const Align(alignment: Alignment.bottomCenter, child: Padding(padding: EdgeInsets.all(32), child: Text('Point the camera at a table or website QR code', style: TextStyle(color: Colors.white)))),
        ]),
      );
}
