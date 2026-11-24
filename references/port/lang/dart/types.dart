// DualCraft language idioms — Dart types.

// @idiom class — Class with constructor, private state and getter
class Counter {
  Counter(this.name, {int start = 0}) : _value = start;
  final String name;
  int _value; // `_` = library-private
  int get value => _value;
  void increment() => _value++;
}

// @idiom data-class — Immutable value with copy and value equality
class User {
  const User({required this.id, required this.name, this.email});
  final String id;
  final String name;
  final String? email;
  User copyWith({String? name, String? email}) => User(id: id, name: name ?? this.name, email: email ?? this.email);
  @override
  bool operator ==(Object other) => other is User && other.id == id && other.name == name && other.email == email;
  @override
  int get hashCode => Object.hash(id, name, email);
}
// freezed generates the same: @freezed class User with _$User { const factory User({...}) = _User; }
typedef LabelCount = ({String label, int count}); // Dart 3 record
LabelCount makePair() => (label: 'a', count: 1);

// @idiom enum — Enum with values and behaviour
enum Plan {
  free(0),
  pro(999);

  const Plan(this.priceCents);
  final int priceCents;
  bool get isPaid => priceCents > 0;
}
Plan parsePlan(String s) => Plan.values.byName(s); // throws if unknown

// @idiom sealed — Closed hierarchy + exhaustive switch
sealed class LoadState {}
class Loading extends LoadState {}
class Loaded extends LoadState {
  Loaded(this.items);
  final List<String> items;
}
class Failed extends LoadState {
  Failed(this.message);
  final String message;
}
String render(LoadState s) => switch (s) {
      Loading() => 'loading',
      Loaded(:final items) => '${items.length} items',
      Failed(:final message) => 'error: $message',
    };

// @idiom extension — Add members to an existing type
extension StringX on String {
  String get initials => split(' ').where((w) => w.isNotEmpty).map((w) => w[0].toUpperCase()).join();
}

// @idiom interface — Interfaces, default behaviour (mixins), implementation
abstract interface class Repository<T> {
  Future<T?> byId(String id);
  Future<void> save(T item);
}
mixin Loggable {
  final logs = <String>[];
  void info(String m) => logs.add(m);
}
class MemoryRepository with Loggable implements Repository<User> {
  final _items = <String, User>{};
  @override
  Future<User?> byId(String id) async => _items[id];
  @override
  Future<void> save(User item) async {
    info('save ${item.id}');
    _items[item.id] = item;
  }
}

// @idiom generics — Generic classes, bounds and functions
class Box<T extends Comparable<T>> {
  Box(this.value);
  final T value;
  bool isBigger(Box<T> other) => value.compareTo(other.value) > 0;
}
T firstOr<T>(List<T> xs, T fallback) => xs.isEmpty ? fallback : xs.first;
