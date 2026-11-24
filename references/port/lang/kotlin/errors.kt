// DualCraft language idioms — Kotlin errors and JSON (kotlinx.serialization).
package idioms.errors

import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

// @idiom exceptions — Custom errors, try/catch/finally
class NotFoundException(val id: String) : Exception("NotFound($id)")
fun safeLoad(load: () -> String): String =
    try {
        load()
    } catch (e: NotFoundException) {
        "missing ${e.id}"
    } catch (e: Exception) {
        "error ${e.message}" // in coroutines rethrow CancellationException, never swallow it
    } finally {
        // cleanup
    }

// @idiom result — Errors as values
sealed interface Outcome<out T> {
    data class Ok<T>(val value: T) : Outcome<T>
    data class Err(val error: String) : Outcome<Nothing>
}
fun parseAge(s: String): Outcome<Int> = s.toIntOrNull()?.let { Outcome.Ok(it) } ?: Outcome.Err("not a number: $s")
fun ageOrZero(s: String): Int = when (val r = parseAge(s)) {
    is Outcome.Ok -> r.value
    is Outcome.Err -> 0
}
// stdlib alternative: runCatching { s.toInt() }.getOrDefault(0)

// @idiom json — Decode/encode a model
@Serializable
data class Product(val id: String, val price: Double, val tags: List<String> = emptyList())
private val json = Json { ignoreUnknownKeys = true } // like Dart: extra keys don't fail
fun decodeProduct(body: String): Product = json.decodeFromString(body)
fun encodeProduct(p: Product): String = json.encodeToString(p)
