// DualCraft language idioms — Dart errors and JSON.
import 'dart:convert';

// @idiom exceptions — Custom errors, try/catch/finally
class NotFoundException implements Exception {
  NotFoundException(this.id);
  final String id;
  @override
  String toString() => 'NotFound($id)';
}
String safeLoad(String Function() load) {
  try {
    return load();
  } on NotFoundException catch (e) {
    return 'missing ${e.id}';
  } catch (e) {
    return 'error $e'; // also catches Errors (bugs): prefer `on Exception catch`
  } finally {
    // cleanup
  }
}

// @idiom result — Errors as values
sealed class Result<T> {
  const Result();
}
final class Ok<T> extends Result<T> {
  const Ok(this.value);
  final T value;
}
final class Err<T> extends Result<T> {
  const Err(this.error);
  final String error;
}
Result<int> parseAge(String s) {
  final n = int.tryParse(s);
  return n == null ? Err('not a number: $s') : Ok(n);
}
int ageOrZero(String s) => switch (parseAge(s)) {
      Ok(:final value) => value,
      Err() => 0,
    };

// @idiom json — Decode/encode a model
class Product {
  Product({required this.id, required this.price, this.tags = const []});
  factory Product.fromJson(Map<String, dynamic> j) => Product(
        id: j['id'] as String,
        price: (j['price'] as num).toDouble(), // JSON numbers may arrive as int
        tags: (j['tags'] as List<dynamic>? ?? []).cast<String>(),
      );
  final String id;
  final double price;
  final List<String> tags;
  Map<String, dynamic> toJson() => {'id': id, 'price': price, 'tags': tags};
}
Product decodeProduct(String body) => Product.fromJson(jsonDecode(body) as Map<String, dynamic>);
String encodeProduct(Product p) => jsonEncode(p.toJson());
