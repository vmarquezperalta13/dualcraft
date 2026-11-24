// DualCraft UI idioms — SwiftUI lists.
import SwiftUI

struct Item: Identifiable, Hashable {
    let id: String
    let title: String
}

// @idiom lazy-list — Long list built lazily, with stable keys and item tap
struct ItemList: View {
    let items: [Item]
    let onTap: (Item) -> Void
    var body: some View {
        List(items) { item in // Identifiable = stable keys
            Button(item.title) { onTap(item) }
        }
    }
}

// @idiom pull-refresh — Pull to refresh
struct RefreshableList: View {
    let items: [Item]
    let onRefresh: () async -> Void
    var body: some View {
        ItemList(items: items) { _ in }
            .refreshable { await onRefresh() }
    }
}

// @idiom grid — Adaptive grid
struct ItemGrid: View {
    let items: [Item]
    var body: some View {
        ScrollView {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 160), spacing: 8)], spacing: 8) {
                ForEach(items) { item in
                    Text(item.title).frame(maxWidth: .infinity, minHeight: 80).background(.thinMaterial)
                }
            }
        }
    }
}
