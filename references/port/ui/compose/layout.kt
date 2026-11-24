// DualCraft UI idioms — Jetpack Compose / Compose Multiplatform (same code for android and kmp).
// Same "@idiom" ids as references/port/ui/{flutter,swiftui,react-native}. Compiled in CI (Compose Desktop).
package idioms.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Share
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage

// @idiom screen-scaffold — Screen with top bar, body and main action
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProfileScreen() {
    Scaffold(
        topBar = { TopAppBar(title = { Text("Perfil") }) },
        floatingActionButton = { FloatingActionButton(onClick = {}) { Icon(Icons.Default.Add, contentDescription = "Añadir") } },
    ) { padding -> // insets: always apply the Scaffold padding
        ProfileHeader(name = "Ana", avatarUrl = "https://example.com/a.png", modifier = Modifier.padding(padding))
    }
}

// @idiom stack-layout — Column, Row, spacing, padding, weight, overlap
@Composable
fun ProfileHeader(name: String, avatarUrl: String, modifier: Modifier = Modifier) {
    Row(modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
        Box { // Stack → Box
            AsyncImage(model = avatarUrl, contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.size(64.dp).clip(CircleShape))
            Icon(Icons.Default.CheckCircle, contentDescription = null, modifier = Modifier.size(16.dp).align(Alignment.BottomEnd))
        }
        Spacer(Modifier.width(12.dp)) // or Arrangement.spacedBy(12.dp)
        Column(Modifier.weight(1f)) { // Expanded → Modifier.weight
            Text(name)
            Text("Madrid")
        }
    }
}

// @idiom text-image-button — Styled text, images and buttons
@Composable
fun ActionsPanel(onSave: () -> Unit) {
    Column {
        Text("Título", style = MaterialTheme.typography.titleLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
        AsyncImage(model = "https://example.com/cover.png", contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.height(120.dp).fillMaxWidth())
        Button(onClick = onSave) { Text("Guardar") }
        OutlinedButton(onClick = {}, enabled = false) { Text("Deshabilitado") }
        TextButton(onClick = onSave) {
            Icon(Icons.Default.Share, contentDescription = null)
            Text("Compartir")
        }
    }
}

// @idiom theme-tokens — Colours and typography from the theme (DualCraft tokens)
@Composable
fun LabelBadge(label: String) {
    Surface(color = MaterialTheme.colorScheme.primaryContainer, shape = RoundedCornerShape(8.dp)) { // DualCraft: DsTheme / LocalDs
        Text(
            label,
            Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onPrimaryContainer,
        )
    }
}
