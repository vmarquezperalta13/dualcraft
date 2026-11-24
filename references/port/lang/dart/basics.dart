// DualCraft language idioms — Dart. Every "@idiom <id>" section has a counterpart with the same id
// in references/port/lang/{kotlin,swift,ts}. Compiled in CI (flutter analyze): keep it valid.

// @idiom variables — Variables, constants, type inference
const maxItems = 20; // compile-time constant
final startedAt = DateTime.now(); // assigned once, at runtime
String describe() {
  var count = 0; // mutable, inferred int
  count += 1;
  late final String label; // assigned later, exactly once
  label = 'items: $count';
  return label;
}

// @idiom null-safety — Nullable types and null operators
int nameLength(String? name) {
  final n = name ?? 'anonymous'; // default value
  final upper = name?.toUpperCase(); // safe call
  if (name == null) return 0; // flow promotion: name is String below
  return name.length + n.length + (upper?.length ?? 0);
}

String forceUnwrap(String? s) => s!; // throws if null

// @idiom strings — Interpolation, multiline, number formatting
String greeting(String user, double total) =>
    'Hola $user, total: ${total.toStringAsFixed(2)} €\n'
    '''Línea 1
Línea 2''';

// @idiom functions — Named, optional and default parameters
String formatPrice(double amount, {String currency = 'EUR', bool withSymbol = true, int? decimals}) =>
    '${amount.toStringAsFixed(decimals ?? 2)} ${withSymbol ? '€' : currency}';
final priceExample = formatPrice(9.5, withSymbol: false);

// @idiom lambdas — Closures and higher-order functions
int applyTwice(int Function(int) f, int x) => f(f(x));
final doubled = applyTwice((x) => x * 2, 3);
int Function() counter() {
  var c = 0;
  return () => c++;
}

// @idiom control-flow — if/switch as expressions, loops
String grade(int score) => switch (score) {
      >= 90 => 'A',
      >= 70 && < 90 => 'B',
      _ => 'C',
    };
int sumEven(List<int> xs) {
  var s = 0;
  for (final x in xs) {
    if (x.isEven) s += x;
  }
  return s;
}
