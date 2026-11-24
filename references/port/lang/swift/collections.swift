// DualCraft language idioms — Swift collections.
import Foundation

// @idiom list-ops — map, filter, reduce, sort, take
func topNames(_ users: [User]) -> [String] {
    Array(users.filter { $0.email != nil }.sorted { $0.name < $1.name }.map(\.name).prefix(3)) // prefix → ArraySlice
}
func totalLength(_ xs: [String]) -> Int { xs.reduce(0) { $0 + $1.count } }
func anyEmpty(_ xs: [String]) -> Bool { xs.contains { $0.isEmpty } }

// @idiom map-ops — Dictionaries: count, lookup, iterate
func countWords(_ words: [String]) -> [String: Int] { words.reduce(into: [:]) { $0[$1, default: 0] += 1 } }
func lookup(_ m: [String: String], _ k: String) -> String? { m[k] } // nil if missing
func entryLabels(_ m: [String: Int]) -> [String] { m.sorted { $0.key < $1.key }.map { "\($0.key)=\($0.value)" } } // Dictionary has NO stable order

// @idiom set — Sets
func common(_ a: Set<String>, _ b: Set<String>) -> Set<String> { a.intersection(b) }
func merged(_ a: Set<String>, _ b: Set<String>) -> Set<String> { a.union(b) }

// @idiom immutability — Read-only and copied collections
func frozen() -> [Int] { [1, 2, 3] } // arrays are values: a `let` array can't change, copies are independent
let fixed = [1, 2, 3]
func appended(_ xs: [Int], _ x: Int) -> [Int] { xs + [x] }

// @idiom grouping — groupBy, first-or-null
func byHasEmail(_ users: [User]) -> [Bool: [User]] { Dictionary(grouping: users) { $0.email != nil } }
func firstWithEmail(_ users: [User]) -> User? { users.first { $0.email != nil } }
