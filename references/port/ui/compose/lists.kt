// DualCraft UI idioms — Compose lists.
package idioms.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Card
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.ListItem
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.lazy.grid.items as gridItems

data class Item(val id: String, val title: String)

// @idiom lazy-list — Long list built lazily, with stable keys and item tap
@Composable
fun ItemList(items: List<Item>, onTap: (Item) -> Unit) {
    LazyColumn {
        items(items, key = { it.id }) { item ->
            ListItem(headlineContent = { Text(item.title) }, modifier = Modifier.clickable { onTap(item) })
            HorizontalDivider()
        }
    }
}

// @idiom pull-refresh — Pull to refresh
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RefreshableList(items: List<Item>, refreshing: Boolean, onRefresh: () -> Unit) {
    PullToRefreshBox(isRefreshing = refreshing, onRefresh = onRefresh) { ItemList(items) {} }
}

// @idiom grid — Adaptive grid
@Composable
fun ItemGrid(items: List<Item>) {
    LazyVerticalGrid(
        columns = GridCells.Adaptive(160.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        gridItems(items, key = { it.id }) { item ->
            Card { Box(Modifier.fillMaxSize().padding(16.dp), contentAlignment = Alignment.Center) { Text(item.title) } }
        }
    }
}
