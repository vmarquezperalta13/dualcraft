// DualCraft UI idioms — SwiftUI forms and feedback.
import SwiftUI

// @idiom text-field — Text input bound to state
struct NameField: View {
    @Binding var text: String // the parent owns the value
    var body: some View {
        TextField("Nombre", text: $text)
            .textFieldStyle(.roundedBorder)
            .submitLabel(.next)
    }
}

// @idiom validation — Validate fields and submit
struct SignUpForm: View {
    let onSubmit: (String) -> Void
    @State private var email = ""
    @State private var showErrors = false
    private var error: String? { email.contains("@") ? nil : "Email no válido" }
    var body: some View {
        Form {
            TextField("Email", text: $email)
            #if os(iOS)
                .keyboardType(.emailAddress)
                .textInputAutocapitalization(.never)
            #endif
            if showErrors, let error { Text(error).font(.caption).foregroundStyle(.red) }
            Button("Enviar") {
                showErrors = true
                if error == nil { onSubmit(email) }
            }
        }
    }
}

// @idiom dialog — Confirmation dialog returning a value
struct DeleteButton: View {
    let onDelete: () -> Void
    @State private var confirming = false
    var body: some View {
        Button("Eliminar", role: .destructive) { confirming = true }
            .confirmationDialog("¿Eliminar?", isPresented: $confirming) { // or .alert(...)
                Button("Eliminar", role: .destructive, action: onDelete)
            }
    }
}

// @idiom snackbar — Transient message
// SwiftUI has no snackbar: a transient overlay (or a toast library)
struct SavedToastButton: View {
    @State private var visible = false
    var body: some View {
        Button("Guardar") {
            visible = true
            Task {
                try? await Task.sleep(for: .seconds(2))
                visible = false
            }
        }
        .overlay(alignment: .bottom) {
            if visible { Text("Guardado").padding().background(.thinMaterial, in: Capsule()).transition(.opacity) }
        }
    }
}

// @idiom bottom-sheet — Modal bottom sheet
struct OptionsButton: View {
    @State private var showing = false
    var body: some View {
        Button("Opciones") { showing = true }
            .sheet(isPresented: $showing) {
                List { Text("Compartir") }
                    .presentationDetents([.medium])
                    .presentationDragIndicator(.visible)
            }
    }
}
