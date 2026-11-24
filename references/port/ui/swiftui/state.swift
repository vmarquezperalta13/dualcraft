// DualCraft UI idioms — SwiftUI state (Observation, iOS 17+).
import Observation
import SwiftUI

// @idiom local-state — State owned by one widget
struct CounterButton: View {
    @State private var count = 0
    var body: some View { Button("\(count)") { count += 1 } }
}

// @idiom shared-state — Screen/app state outside the UI (@Observable model)
@Observable final class CartModel {
    private(set) var items: [String] = []
    var busy = false
    func add(_ id: String) { items.append(id) }
}
struct CartBadge: View {
    @Environment(CartModel.self) private var cart // inject at the root: .environment(CartModel())
    var body: some View { Button("\(cart.items.count)") { cart.add("x") } }
}

// @idiom async-state — Loading / data / error from an async source
enum Loadable<T> {
    case loading
    case loaded(T)
    case failed(String)
}
@MainActor @Observable final class ProductsModel {
    var state: Loadable<[String]> = .loading
    func load() async {
        do {
            try await Task.sleep(for: .milliseconds(10))
            state = .loaded(["a", "b"])
        } catch {
            state = .failed(error.localizedDescription)
        }
    }
}
struct ProductsView: View {
    @State private var model = ProductsModel() // the view owns it: @State; passed in: plain property
    var body: some View {
        Group {
            switch model.state {
            case .loading: ProgressView()
            case .loaded(let items): Text("\(items.count)")
            case .failed(let message): Text("Error: \(message)")
            }
        }
        .task { await model.load() }
    }
}

// @idiom effects — Start work when shown, clean up when removed
struct TickerText: View {
    @State private var value = 0
    var body: some View {
        Text("\(value)")
            .task { // cancelled automatically when the view disappears
                while !Task.isCancelled {
                    try? await Task.sleep(for: .seconds(1))
                    value += 1
                }
            }
            .onDisappear { /* remove listeners */ }
    }
}
