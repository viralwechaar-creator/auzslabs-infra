import 'package:flutter/material.dart' hide Text;
import '../core/api.dart';
import 'i18n.dart';
import 'theme.dart';

/// Loads something from the server and shows it; spinner while waiting, a retry button when it fails.
class Loader<T> extends StatefulWidget {
  const Loader({required this.load, required this.builder, super.key});
  final Future<T> Function() load;
  final Widget Function(BuildContext ctx, T data, Future<void> Function() reload) builder;
  @override
  State<Loader<T>> createState() => _LoaderState<T>();
}

class _LoaderState<T> extends State<Loader<T>> {
  T? data;
  String? error;
  bool loading = true;

  @override
  void initState() {
    super.initState();
    reload();
  }

  Future<void> reload() async {
    try {
      final d = await widget.load();
      if (!mounted) return;
      setState(() {
        data = d;
        error = null;
        loading = false;
      });
    } on ApiError catch (e) {
      if (!mounted) return;
      setState(() {
        error = e.message;
        loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        error = '$e';
        loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    if (data != null) return widget.builder(context, data as T, reload);
    if (loading) return const Center(child: CircularProgressIndicator());
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(28),
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Icon(Icons.cloud_off, size: 44, color: Tk.label3),
          const SizedBox(height: 12),
          Text(error ?? 'Could not load', textAlign: TextAlign.center, style: TextStyle(color: Tk.label2)),
          const SizedBox(height: 12),
          FilledButton(onPressed: () {
            setState(() => loading = true);
            reload();
          }, child: const Text('Try again')),
        ]),
      ),
    );
  }
}

/// Runs [fn] and shows the error as a toast-style message on failure. Returns true when it worked.
Future<bool> guarded(BuildContext c, Future<void> Function() fn, void Function(BuildContext, String, {bool err}) toast) async {
  try {
    await fn();
    return true;
  } on ApiError catch (e) {
    if (c.mounted) toast(c, e.message, err: true);
    return false;
  }
}
