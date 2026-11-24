// DualCraft language idioms — Kotlin types.
package idioms.types

// @idiom class — Class with constructor, private state and getter
class Counter(val name: String, start: Int = 0) {
    var value: Int = start // public get, private set
        private set
    fun increment() { value++ }
}

// @idiom data-class — Immutable value with copy and value equality
data class User(val id: String, val name: String, val email: String? = null)
// copy(), equals/hashCode, toString and componentN are generated: user.copy(name = "x")
data class LabelCount(val label: String, val count: Int) // Dart records → small data class (or Pair)
fun makePair(): LabelCount = LabelCount("a", 1)

// @idiom enum — Enum with values and behaviour
enum class Plan(val priceCents: Int) {
    FREE(0),
    PRO(999);

    val isPaid: Boolean get() = priceCents > 0
}
fun parsePlan(s: String): Plan = Plan.valueOf(s.uppercase()) // throws if unknown; entries.firstOrNull { } to be safe

// @idiom sealed — Closed hierarchy + exhaustive switch
sealed interface LoadState {
    data object Loading : LoadState
    data class Loaded(val items: List<String>) : LoadState
    data class Failed(val message: String) : LoadState
}
fun render(s: LoadState): String = when (s) {
    LoadState.Loading -> "loading"
    is LoadState.Loaded -> "${s.items.size} items"
    is LoadState.Failed -> "error: ${s.message}"
}

// @idiom extension — Add members to an existing type
val String.initials: String
    get() = split(" ").filter { it.isNotEmpty() }.joinToString("") { it[0].uppercase() }

// @idiom interface — Interfaces, default behaviour (mixins), implementation
interface Repository<T> {
    suspend fun byId(id: String): T?
    suspend fun save(item: T)
}
interface Loggable { // interfaces can have default methods (no state: implementers hold it)
    val logs: MutableList<String>
    fun info(m: String) { logs += m }
}
class MemoryRepository : Repository<User>, Loggable {
    override val logs = mutableListOf<String>()
    private val items = mutableMapOf<String, User>()
    override suspend fun byId(id: String): User? = items[id]
    override suspend fun save(item: User) {
        info("save ${item.id}")
        items[item.id] = item
    }
}

// @idiom generics — Generic classes, bounds and functions
class Box<T : Comparable<T>>(val value: T) {
    fun isBigger(other: Box<T>): Boolean = value > other.value
}
fun <T> firstOr(xs: List<T>, fallback: T): T = if (xs.isEmpty()) fallback else xs.first()
