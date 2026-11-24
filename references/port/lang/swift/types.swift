// DualCraft language idioms — Swift types.
import Foundation

// @idiom class — Class with constructor, private state and getter
final class Counter {
    let name: String
    private(set) var value: Int // public get, private set
    init(name: String, start: Int = 0) {
        self.name = name
        self.value = start
    }
    func increment() { value += 1 }
}

// @idiom data-class — Immutable value with copy and value equality
// Structs are values: `var u2 = u; u2.name = "x"` copies, so no copyWith is needed
struct User: Equatable, Hashable, Codable {
    let id: String
    var name: String
    var email: String?
}
typealias LabelCount = (label: String, count: Int) // Dart records → tuple (or a small struct)
func makePair() -> LabelCount { (label: "a", count: 1) }

// @idiom enum — Enum with values and behaviour
enum Plan: String, CaseIterable, Codable {
    case free, pro
    var priceCents: Int {
        switch self {
        case .free: 0
        case .pro: 999
        }
    }
    var isPaid: Bool { priceCents > 0 }
}
func parsePlan(_ s: String) -> Plan? { Plan(rawValue: s) } // nil if unknown

// @idiom sealed — Closed hierarchy + exhaustive switch
enum LoadState { // enum with associated values = sealed class
    case loading
    case loaded(items: [String])
    case failed(message: String)
}
func render(_ s: LoadState) -> String {
    switch s {
    case .loading: return "loading"
    case .loaded(let items): return "\(items.count) items"
    case .failed(let message): return "error: \(message)"
    }
}

// @idiom extension — Add members to an existing type
extension String {
    var initials: String { split(separator: " ").compactMap { word in word.first.map { String($0).uppercased() } }.joined() }
}

// @idiom interface — Interfaces, default behaviour (mixins), implementation
protocol Repository {
    associatedtype Item
    func byId(_ id: String) async -> Item?
    func save(_ item: Item) async
}
protocol Loggable: AnyObject { var logs: [String] { get set } }
extension Loggable { func info(_ m: String) { logs.append(m) } } // protocol extension = default implementation
final class MemoryRepository: Repository, Loggable {
    var logs: [String] = []
    private var items: [String: User] = [:]
    func byId(_ id: String) async -> User? { items[id] }
    func save(_ item: User) async {
        info("save \(item.id)")
        items[item.id] = item
    }
}

// @idiom generics — Generic classes, bounds and functions
struct Box<T: Comparable> {
    let value: T
    func isBigger(_ other: Box<T>) -> Bool { value > other.value }
}
func firstOr<T>(_ xs: [T], _ fallback: T) -> T { xs.first ?? fallback }
