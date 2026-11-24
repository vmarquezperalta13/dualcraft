// DualCraft UI idioms — Compose navigation (type-safe Navigation Compose; Android: androidx.navigation,
// KMP: org.jetbrains.androidx.navigation). Navigation 3 is the newer alternative on Android.
package idioms.ui

import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Person
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.navigation.NavDestination.Companion.hasRoute
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.toRoute
import kotlinx.serialization.Serializable

@Serializable data object HomeRoute
@Serializable data object ProfileRoute
@Serializable data class ProductRoute(val id: String)

// @idiom routes — Route table with parameters
@Composable
fun AppNavHost(nav: NavHostController = rememberNavController()) {
    NavHost(nav, startDestination = HomeRoute) {
        composable<HomeRoute> { HomePage(onOpen = { nav.navigate(ProductRoute(it)) }) }
        composable<ProductRoute> { entry -> ProductPage(id = entry.toRoute<ProductRoute>().id) }
    }
}
@Composable
fun HomePage(onOpen: (String) -> Unit) { // screens get callbacks, not the NavController
    TextButton(onClick = { onOpen("42") }) { Text("Ver") }
}
@Composable
fun ProductPage(id: String) { Text("Producto $id") }

// @idiom navigate — Push, back, replace the stack, return a result
fun navigateExamples(nav: NavHostController) {
    nav.navigate(ProductRoute("42")) // push
    nav.popBackStack() // back
    nav.navigate(HomeRoute) { popUpTo(nav.graph.id) { inclusive = true } } // replace the stack (e.g. after login)
    nav.previousBackStackEntry?.savedStateHandle?.set("picked", "value") // result: the previous screen reads its savedStateHandle
}

// @idiom tabs — Bottom navigation keeping one stack per tab
@Composable
fun TabsScaffold() {
    val nav = rememberNavController()
    val current by nav.currentBackStackEntryAsState()
    val tabs = listOf(Triple(HomeRoute, "Inicio", Icons.Default.Home), Triple(ProfileRoute, "Perfil", Icons.Default.Person))
    Scaffold(bottomBar = {
        NavigationBar {
            tabs.forEach { (route, label, icon) ->
                NavigationBarItem(
                    selected = current?.destination?.hasRoute(route::class) == true,
                    onClick = {
                        nav.navigate(route) {
                            popUpTo(nav.graph.findStartDestination().id) { saveState = true }
                            launchSingleTop = true
                            restoreState = true
                        }
                    },
                    icon = { Icon(icon, contentDescription = null) },
                    label = { Text(label) },
                )
            }
        }
    }) { padding ->
        NavHost(nav, startDestination = HomeRoute, modifier = Modifier.padding(padding)) {
            composable<HomeRoute> { Text("Inicio") }
            composable<ProfileRoute> { Text("Perfil") }
        }
    }
}
