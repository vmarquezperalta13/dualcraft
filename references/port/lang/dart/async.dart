// DualCraft language idioms — Dart async.
import 'dart:async';
import 'dart:isolate';

import 'types.dart';

// @idiom future — Async function and await
Future<User?> loadUser(Repository<User> repo, String id) async {
  final user = await repo.byId(id);
  return user;
}

// @idiom parallel — Run several operations at once
Future<int> loadBoth(Future<int> Function() a, Future<int> Function() b) async {
  final results = await Future.wait([a(), b()]); // Dart 3: final (x, y) = await (a(), b()).wait;
  return results[0] + results[1];
}

// @idiom stream — Streams of values (cold and hot)
Stream<int> ticker(int n) async* {
  for (var i = 0; i < n; i++) {
    await Future<void>.delayed(const Duration(milliseconds: 10));
    yield i;
  }
}
Future<int> sumTicks() async {
  var s = 0;
  await for (final t in ticker(3)) {
    s += t;
  }
  return s;
}
Stream<String> evenLabels(Stream<int> s) => s.where((x) => x.isEven).map((x) => 'n$x');
final events = StreamController<int>.broadcast(); // hot: events.add(1); listeners get later values only

// @idiom timeout — Timeouts and cancellation
Future<String> loadWithTimeout(Future<String> f) => f.timeout(const Duration(seconds: 5), onTimeout: () => 'timeout');
StreamSubscription<int> listenTo(Stream<int> s) => s.listen((_) {}); // stop with sub.cancel(); Futures can't be cancelled

// @idiom background — Heavy work off the UI thread
Future<int> heavySum(List<int> xs) => Isolate.run(() => xs.fold<int>(0, (a, b) => a + b)); // Flutter: compute(fn, arg)
