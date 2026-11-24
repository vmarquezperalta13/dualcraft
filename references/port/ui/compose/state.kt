// DualCraft UI idioms — Compose state (ViewModel + StateFlow).
package idioms.ui

import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update

// @idiom local-state — State owned by one widget
@Composable
fun CounterButton() {
    var count by rememberSaveable { mutableIntStateOf(0) } // survives rotation; remember { } does not
    TextButton(onClick = { count++ }) { Text("$count") }
}

// @idiom shared-state — Screen/app state outside the UI (ViewModel + StateFlow)
data class CartState(val items: List<String> = emptyList(), val busy: Boolean = false)
class CartViewModel : ViewModel() {
    private val _state = MutableStateFlow(CartState())
    val state: StateFlow<CartState> = _state.asStateFlow()
    fun add(id: String) = _state.update { it.copy(items = it.items + id) }
}
@Composable
fun CartBadge(vm: CartViewModel = viewModel { CartViewModel() }) { // Hilt: hiltViewModel() · Koin: koinViewModel()
    val cart by vm.state.collectAsStateWithLifecycle()
    TextButton(onClick = { vm.add("x") }) { Text("${cart.items.size}") }
}

// @idiom async-state — Loading / data / error from an async source
sealed interface UiState<out T> {
    data object Loading : UiState<Nothing>
    data class Data<T>(val value: T) : UiState<T>
    data class Error(val message: String) : UiState<Nothing>
}
class ProductsViewModel : ViewModel() {
    val state: StateFlow<UiState<List<String>>> = flow<UiState<List<String>>> {
        delay(10)
        emit(UiState.Data(listOf("a", "b")))
    }.catch { emit(UiState.Error(it.message ?: "error")) }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), UiState.Loading)
}
@Composable
fun ProductsView(vm: ProductsViewModel = viewModel { ProductsViewModel() }) {
    when (val s = vm.state.collectAsStateWithLifecycle().value) {
        UiState.Loading -> CircularProgressIndicator()
        is UiState.Data -> Text("${s.value.size}")
        is UiState.Error -> Text("Error: ${s.message}")
    }
}

// @idiom effects — Start work when shown, clean up when removed
@Composable
fun TickerText() {
    var value by remember { mutableIntStateOf(0) }
    LaunchedEffect(Unit) { // cancelled automatically when it leaves the composition
        while (true) {
            delay(1_000)
            value++
        }
    }
    DisposableEffect(Unit) { onDispose { /* remove listeners */ } }
    Text("$value")
}
