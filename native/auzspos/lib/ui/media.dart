import 'package:flutter/material.dart' hide Text;
import 'package:image_picker/image_picker.dart';
import '../core/api.dart';
import 'i18n.dart';
import 'theme.dart';

/// Picking a photo from the phone and sending it to the business's storage.
/// Photos are shrunk by the picker (1400 px wide, quality 80) before they leave the phone, like the website does.
/// Gallery only: the camera app takes the photo first, so the app never needs the camera permission for this.
class Media {
  static ApiClient? api;

  static Future<String?> pick(BuildContext c, String prefix) async {
    final a = api;
    if (a == null) return null;
    final messenger = ScaffoldMessenger.of(c);
    XFile? f;
    try {
      f = await ImagePicker().pickImage(source: ImageSource.gallery, maxWidth: 1400, imageQuality: 80);
    } catch (_) {
      messenger.showSnackBar(SnackBar(content: Text(tr('Could not open your photos'))));
      return null;
    }
    if (f == null) return null;
    messenger.showSnackBar(SnackBar(content: Text(tr('Uploading…')), duration: const Duration(seconds: 20)));
    try {
      final url = await a.uploadImage(await f.readAsBytes(), prefix);
      messenger.hideCurrentSnackBar();
      return url;
    } on ApiError catch (e) {
      messenger.hideCurrentSnackBar();
      messenger.showSnackBar(SnackBar(content: Text('${tr('Upload failed')}: ${e.message}')));
      return null;
    }
  }
}

/// A small photo preview with a Choose / Remove button, used by forms.
class PhotoField extends StatelessWidget {
  const PhotoField({required this.label, required this.url, required this.onPick, required this.onClear, super.key});
  final String label;
  final String? url;
  final VoidCallback onPick, onClear;
  @override
  Widget build(BuildContext context) => Row(children: [
        ClipRRect(
          borderRadius: BorderRadius.circular(10),
          child: Container(
            width: 64,
            height: 64,
            color: Tk.fill,
            child: (url ?? '').isEmpty ? Icon(Icons.image_outlined, color: Tk.label3) : Image.network(url!, fit: BoxFit.cover, errorBuilder: (_, __, ___) => Icon(Icons.broken_image_outlined, color: Tk.label3)),
          ),
        ),
        const SizedBox(width: 12),
        Expanded(child: Text(label, style: const TextStyle(fontWeight: FontWeight.w600))),
        TextButton(onPressed: onPick, child: Text((url ?? '').isEmpty ? 'Choose photo' : 'Change')),
        if ((url ?? '').isNotEmpty) IconButton(onPressed: onClear, icon: const Icon(Icons.close), tooltip: 'Remove'),
      ]);
}
