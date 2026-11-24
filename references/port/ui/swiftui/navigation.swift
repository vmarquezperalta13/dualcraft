// DualCraft UI idioms — SwiftUI navigation (NavigationStack with a typed path).
import SwiftUI

enum AppRoute: Hashable {
    case product(id: String)
}

// @idiom routes — Route table with parameters
struct AppNavigation: View {
    @State private var path: [AppRoute] = []
    var body: some View {
        NavigationStack(path: $path) {
            HomePage(onOpen: { path.append(.product(id: $0)) })
                .navigationDestination(for: AppRoute.self) { route in
                    switch route {
                    case .product(let id): ProductPage(id: id)
                    }
                }
        }
    }
}
struct HomePage: View {
    let onOpen: (String) -> Void
    var body: some View { Button("Ver") { onOpen("42") } }
}
struct ProductPage: View {
    let id: String
    var body: some View { Text("Producto \(id)") }
}

// @idiom navigate — Push, back, replace the stack, return a result
// push: path.append(.product(id: "42")) · back: path.removeLast() or dismiss() · replace: path = []
// result: pass a closure (or a binding) to the destination
struct PickerPage: View {
    @Environment(\.dismiss) private var dismiss
    let onPick: (String) -> Void
    var body: some View {
        Button("Elegir") {
            onPick("value")
            dismiss()
        }
    }
}

// @idiom tabs — Bottom navigation keeping one stack per tab
struct TabsView: View {
    var body: some View {
        TabView {
            NavigationStack { Text("Inicio") }.tabItem { Label("Inicio", systemImage: "house") }
            NavigationStack { Text("Perfil") }.tabItem { Label("Perfil", systemImage: "person") }
        }
    }
}
