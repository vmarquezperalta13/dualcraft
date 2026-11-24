// DualCraft language idioms — Kotlin coroutines (kotlinx-coroutines).
package idioms.async

import idioms.types.Repository
import idioms.types.User
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.launchIn
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull

// @idiom future — Async function and await
// Future<T> + async/await → suspend fun returning T (called from a coroutine: viewModelScope.launch { })
suspend fun loadUser(repo: Repository<User>, id: String): User? {
    val user = repo.byId(id)
    return user
}

// @idiom parallel — Run several operations at once
suspend fun loadBoth(a: suspend () -> Int, b: suspend () -> Int): Int = coroutineScope {
    val x = async { a() }
    val y = async { b() }
    x.await() + y.await() // if one fails, the other is cancelled (structured concurrency)
}

// @idiom stream — Streams of values (cold and hot)
fun ticker(n: Int): Flow<Int> = flow {
    for (i in 0 until n) {
        delay(10)
        emit(i)
    }
}
suspend fun sumTicks(): Int {
    var s = 0
    ticker(3).collect { s += it }
    return s
}
fun evenLabels(s: Flow<Int>): Flow<String> = s.filter { it % 2 == 0 }.map { "n$it" }
val events = MutableSharedFlow<Int>() // hot: events.emit(1); for state use MutableStateFlow(initial)

// @idiom timeout — Timeouts and cancellation
suspend fun loadWithTimeout(f: suspend () -> String): String = withTimeoutOrNull(5_000) { f() } ?: "timeout"
fun listenTo(scope: CoroutineScope, s: Flow<Int>): Job = s.onEach { }.launchIn(scope) // stop with job.cancel()
// Cancellation is cooperative and automatic when the scope (viewModelScope, LaunchedEffect) ends

// @idiom background — Heavy work off the UI thread
suspend fun heavySum(xs: List<Int>): Int = withContext(Dispatchers.Default) { xs.sum() } // IO work: Dispatchers.IO
