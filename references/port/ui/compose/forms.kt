// DualCraft UI idioms — Compose forms and feedback.
package idioms.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ListItem
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import kotlinx.coroutines.launch

// @idiom text-field — Text input bound to state
@Composable
fun NameField(onChanged: (String) -> Unit) {
    var text by rememberSaveable { mutableStateOf("") } // no controller: the value lives in state
    OutlinedTextField(
        value = text,
        onValueChange = { text = it; onChanged(it) },
        label = { Text("Nombre") },
        singleLine = true,
        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
    )
}

// @idiom validation — Validate fields and submit
@Composable
fun SignUpForm(onSubmit: (String) -> Unit) {
    var email by rememberSaveable { mutableStateOf("") }
    var showErrors by remember { mutableStateOf(false) }
    val error = if (email.contains("@")) null else "Email no válido"
    Column {
        OutlinedTextField(
            value = email,
            onValueChange = { email = it },
            label = { Text("Email") },
            isError = showErrors && error != null,
            supportingText = { if (showErrors && error != null) Text(error) },
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
        )
        Button(onClick = { showErrors = true; if (error == null) onSubmit(email) }) { Text("Enviar") }
    }
}

// @idiom dialog — Confirmation dialog returning a value
// Dialogs are state: `if (confirming) ConfirmDeleteDialog { ok -> confirming = false; ... }`
@Composable
fun ConfirmDeleteDialog(onResult: (Boolean) -> Unit) {
    AlertDialog(
        onDismissRequest = { onResult(false) },
        title = { Text("¿Eliminar?") },
        confirmButton = { Button(onClick = { onResult(true) }) { Text("Eliminar") } },
        dismissButton = { TextButton(onClick = { onResult(false) }) { Text("Cancelar") } },
    )
}

// @idiom snackbar — Transient message
@Composable
fun SavedSnackbarScreen() {
    val host = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    Scaffold(snackbarHost = { SnackbarHost(host) }) { padding ->
        Button(onClick = { scope.launch { host.showSnackbar("Guardado") } }, modifier = Modifier.padding(padding)) { Text("Guardar") }
    }
}

// @idiom bottom-sheet — Modal bottom sheet
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun OptionsSheet(onDismiss: () -> Unit) {
    ModalBottomSheet(onDismissRequest = onDismiss) { ListItem(headlineContent = { Text("Compartir") }) }
}
