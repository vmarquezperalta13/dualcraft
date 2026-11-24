// DualCraft language idioms — Dart collections.
import 'types.dart';

// @idiom list-ops — map, filter, reduce, sort, take
List<String> topNames(List<User> users) {
  final active = users.where((u) => u.email != null).toList()..sort((a, b) => a.name.compareTo(b.name)); // sort() mutates
  return active.map((u) => u.name).take(3).toList(); // map/where are lazy Iterables: .toList()
}
int totalLength(List<String> xs) => xs.fold(0, (acc, s) => acc + s.length);
bool anyEmpty(List<String> xs) => xs.any((s) => s.isEmpty);

// @idiom map-ops — Dictionaries: count, lookup, iterate
Map<String, int> countWords(List<String> words) {
  final counts = <String, int>{};
  for (final w in words) {
    counts.update(w, (c) => c + 1, ifAbsent: () => 1);
  }
  return counts;
}
String? lookup(Map<String, String> m, String k) => m[k]; // null if missing
Iterable<String> entryLabels(Map<String, int> m) => m.entries.map((e) => '${e.key}=${e.value}'); // insertion order

// @idiom set — Sets
Set<String> common(Set<String> a, Set<String> b) => a.intersection(b);
Set<String> merged(Set<String> a, Set<String> b) => a.union(b);

// @idiom immutability — Read-only and copied collections
List<int> frozen() => List.unmodifiable([1, 2, 3]); // throws on add at runtime
const fixed = [1, 2, 3]; // const = deeply immutable
List<int> appended(List<int> xs, int x) => [...xs, x];

// @idiom grouping — groupBy, first-or-null
Map<bool, List<User>> byHasEmail(List<User> users) {
  final m = <bool, List<User>>{};
  for (final u in users) {
    (m[u.email != null] ??= []).add(u);
  }
  return m; // package:collection: users.groupListsBy((u) => u.email != null)
}
User? firstWithEmail(List<User> users) {
  for (final u in users) {
    if (u.email != null) return u;
  }
  return null; // package:collection: users.firstWhereOrNull(...)
}
