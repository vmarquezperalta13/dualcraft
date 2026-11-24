// DualCraft language idioms — Kotlin collections.
package idioms.collections

import idioms.types.User

// @idiom list-ops — map, filter, reduce, sort, take
fun topNames(users: List<User>): List<String> =
    users.filter { it.email != null }.sortedBy { it.name }.map { it.name }.take(3) // eager; .asSequence() for lazy
fun totalLength(xs: List<String>): Int = xs.sumOf { it.length } // or xs.fold(0) { acc, s -> acc + s.length }
fun anyEmpty(xs: List<String>): Boolean = xs.any { it.isEmpty() }

// @idiom map-ops — Dictionaries: count, lookup, iterate
fun countWords(words: List<String>): Map<String, Int> = words.groupingBy { it }.eachCount()
fun lookup(m: Map<String, String>, k: String): String? = m[k] // null if missing; getValue(k) throws
fun entryLabels(m: Map<String, Int>): List<String> = m.map { (k, v) -> "$k=$v" } // mapOf keeps insertion order

// @idiom set — Sets
fun common(a: Set<String>, b: Set<String>): Set<String> = a intersect b
fun merged(a: Set<String>, b: Set<String>): Set<String> = a union b

// @idiom immutability — Read-only and copied collections
fun frozen(): List<Int> = listOf(1, 2, 3) // read-only interface; mutableListOf() to mutate
val fixed = listOf(1, 2, 3)
fun appended(xs: List<Int>, x: Int): List<Int> = xs + x // new list

// @idiom grouping — groupBy, first-or-null
fun byHasEmail(users: List<User>): Map<Boolean, List<User>> = users.groupBy { it.email != null }
fun firstWithEmail(users: List<User>): User? = users.firstOrNull { it.email != null }
