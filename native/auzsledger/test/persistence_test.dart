import 'package:flutter_test/flutter_test.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';
import 'package:auzsledger/core/store.dart';

/// Proves the offline-draft queue genuinely survives the app being closed and reopened --
/// not just kept in memory for the lifetime of one LedgerSession object. SqliteStore writes
/// to a real file-backed sqlite database (the same class a real phone uses); sqflite_common_ffi
/// lets that real class run here, in a plain `flutter test`, instead of standing in with
/// MemoryStore the way every other test in this suite does.
///
/// What this test does NOT prove: that the *same guarantee* holds across an actual device
/// reboot. That rests on Android's own well-established promise that a file under an app's
/// private storage (where getDatabasesPath() points) survives a reboot unless the app's data
/// is cleared or the app is uninstalled -- the same guarantee every other installed app's local
/// database relies on. Closing and reopening the store object here (a fresh SqliteStore.open()
/// against the same on-disk file, exactly as openWith() does on every real app launch) is the
/// strongest check obtainable without a physical device.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  sqfliteFfiInit();
  databaseFactory = databaseFactoryFfi;

  const uid = 'persist-test-user';

  Future<void> wipeDbFile() async {
    final s = await SqliteStore.open(uid);
    await s.wipe();
  }

  setUp(wipeDbFile);
  tearDown(wipeDbFile);

  test('a queued draft survives the store object being closed and a fresh one reopened against the same file', () async {
    final draft = {'id': 'op-1', 'op': 'op-1', 'at': 1000, 'kind': 'draft', 'payload': {'doc_type': 'bill', 'post': false, 'lines': []}, 'state': 'waiting', 'meta': {'label': 'Bill', 'total': 500}};

    // First "app session": write the draft, then simulate the app being closed (just drop the
    // Dart object -- there is no explicit close() in this store, matching how a real app is
    // simply killed by the OS without an orderly database shutdown).
    final first = await SqliteStore.open(uid);
    await first.put('queue', draft);

    // Second "app session": a brand-new SqliteStore instance, same user id -- exactly what
    // LedgerSession.openWith() does on the next real app launch.
    final second = await SqliteStore.open(uid);
    final rows = await second.all('queue');
    expect(rows, hasLength(1), reason: 'the draft written in the "previous session" must still be on disk');
    expect(rows.single['op'], 'op-1');
    expect(rows.single['state'], 'waiting');
    expect(rows.single['payload']['doc_type'], 'bill');
  });

  test('a refused draft keeps its error text and state across a reopen, and discard actually removes the row from disk', () async {
    final draft = {'id': 'op-2', 'op': 'op-2', 'at': 1000, 'kind': 'draft', 'payload': {'doc_type': 'expense', 'post': false, 'lines': []}, 'state': 'refused', 'error': 'The accounting period is locked.', 'meta': {'label': 'Expense'}};
    final first = await SqliteStore.open(uid);
    await first.put('queue', draft);

    final second = await SqliteStore.open(uid);
    final before = await second.all('queue');
    expect(before.single['state'], 'refused');
    expect(before.single['error'], 'The accounting period is locked.');

    await second.del('queue', 'op-2');
    final third = await SqliteStore.open(uid);
    expect(await third.all('queue'), isEmpty, reason: 'Discard must remove the row for good, not just hide it in memory');
  });

  test('retry() rewriting the same row never leaves two copies on disk (no local duplicate from the primary key)', () async {
    final s = await SqliteStore.open(uid);
    final draft = {'id': 'op-3', 'op': 'op-3', 'at': 1000, 'kind': 'draft', 'payload': {'doc_type': 'bill', 'post': false, 'lines': []}, 'state': 'refused', 'error': 'down'};
    await s.put('queue', draft);
    // retry() in LedgerSession does exactly this: same id, state flipped back to waiting.
    await s.put('queue', {...draft, 'state': 'waiting'}..remove('error'));
    final rows = await (await SqliteStore.open(uid)).all('queue');
    expect(rows, hasLength(1), reason: 'put() with the same id must replace, not insert a second row');
    expect(rows.single['state'], 'waiting');
  });
}
