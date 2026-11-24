// DualCraft language idioms — Kotlin. Same "@idiom" ids as references/port/lang/{dart,swift,ts}.
// Compiled in CI (Kotlin/JVM): keep it valid. Notes marked JVM need a helper in KMP commonMain.
package idioms.basics

import kotlin.time.TimeSource

// @idiom variables — Variables, constants, type inference
const val MAX_ITEMS = 20 // compile-time constant (primitives and String only)
val startedAt = TimeSource.Monotonic.markNow() // assigned once; wall clock in KMP: kotlinx-datetime Clock.System.now()
fun describe(): String {
    var count = 0 // mutable, inferred Int
    count += 1
    val label: String // assigned later, exactly once (properties: lateinit var / by lazy)
    label = "items: $count"
    return label
}

// @idiom null-safety — Nullable types and null operators
fun nameLength(name: String?): Int {
    val n = name ?: "anonymous" // default value (elvis)
    val upper = name?.uppercase() // safe call
    if (name == null) return 0 // smart cast: name is String below
    return name.length + n.length + (upper?.length ?: 0)
}

fun forceUnwrap(s: String?): String = s!! // throws NullPointerException if null

// @idiom strings — Interpolation, multiline, number formatting
fun greeting(user: String, total: Double): String =
    "Hola $user, total: ${"%.2f".format(total)} €\n" + // String.format is JVM-only
        """Línea 1
Línea 2"""

// @idiom functions — Named, optional and default parameters
fun formatPrice(amount: Double, currency: String = "EUR", withSymbol: Boolean = true, decimals: Int? = null): String =
    "%.${decimals ?: 2}f %s".format(amount, if (withSymbol) "€" else currency)
val priceExample = formatPrice(9.5, withSymbol = false) // any parameter can be passed by name

// @idiom lambdas — Closures and higher-order functions
fun applyTwice(f: (Int) -> Int, x: Int): Int = f(f(x))
val doubled = applyTwice({ it * 2 }, 3)
fun counter(): () -> Int {
    var c = 0
    return { c++ }
}

// @idiom control-flow — if/switch as expressions, loops
fun grade(score: Int): String = when {
    score >= 90 -> "A"
    score in 70..89 -> "B"
    else -> "C"
}
fun sumEven(xs: List<Int>): Int {
    var s = 0
    for (x in xs) if (x % 2 == 0) s += x
    return s
}
