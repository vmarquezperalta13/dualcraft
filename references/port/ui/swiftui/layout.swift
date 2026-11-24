// DualCraft UI idioms — SwiftUI (iOS 17+). Same "@idiom" ids as references/port/ui/{flutter,compose,react-native}.
// Compiled in CI (swiftc -typecheck, all ui files together): names must be unique across files.
import SwiftUI

// @idiom screen-scaffold — Screen with top bar, body and main action
struct ProfileScreen: View {
    var body: some View {
        NavigationStack { // the bar comes from the enclosing NavigationStack
            ProfileHeader(name: "Ana", avatarUrl: URL(string: "https://example.com/a.png"))
                .navigationTitle("Perfil")
                .toolbar { Button("Añadir", systemImage: "plus") {} } // no FAB on iOS: toolbar button
        }
    }
}

// @idiom stack-layout — Column, Row, spacing, padding, weight, overlap
struct ProfileHeader: View {
    let name: String
    let avatarUrl: URL?
    var body: some View {
        HStack(spacing: 12) { // Row → HStack, Column → VStack, Stack → ZStack
            ZStack(alignment: .bottomTrailing) {
                AsyncImage(url: avatarUrl) { $0.resizable().scaledToFill() } placeholder: { Color.gray }
                    .frame(width: 64, height: 64)
                    .clipShape(Circle())
                Image(systemName: "checkmark.seal.fill").font(.caption)
            }
            VStack(alignment: .leading) {
                Text(name)
                Text("Madrid")
            }
            .frame(maxWidth: .infinity, alignment: .leading) // Expanded → maxWidth .infinity
        }
        .padding(16)
    }
}

// @idiom text-image-button — Styled text, images and buttons
struct ActionsPanel: View {
    let onSave: () -> Void
    var body: some View {
        VStack {
            Text("Título").font(.title2).lineLimit(1)
            AsyncImage(url: URL(string: "https://example.com/cover.png")) { $0.resizable().scaledToFill() } placeholder: { ProgressView() }
                .frame(height: 120)
                .clipped()
            Button("Guardar", action: onSave).buttonStyle(.borderedProminent)
            Button("Deshabilitado") {}.buttonStyle(.bordered).disabled(true)
            Button("Compartir", systemImage: "square.and.arrow.up", action: onSave)
        }
    }
}

// @idiom theme-tokens — Colours and typography from the theme (DualCraft tokens)
struct LabelBadge: View {
    let label: String
    var body: some View {
        Text(label) // DualCraft: DsColor.primary, DsText.labelMedium.font
            .font(.caption)
            .foregroundStyle(Color.accentColor)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(Color.accentColor.opacity(0.15), in: RoundedRectangle(cornerRadius: 8))
    }
}
