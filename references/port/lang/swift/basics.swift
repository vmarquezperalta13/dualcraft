// DualCraft language idioms — Swift. Same "@idiom" ids as references/port/lang/{dart,kotlin,ts}.
// Compiled in CI (swiftc -typecheck, all lang files together): names must be unique across files.
import Foundation

// @idiom variables — Variables, constants, type inference
let maxItems = 20 // constant
let startedAt = Date() // assigned once
func describe() -> String {
    var count = 0 // mutable, inferred Int
    count += 1
    let label: String // assigned later, exactly once (properties: lazy var)
    label = "items: \(count)"
    return label
}

// @idiom null-safety — Nullable types and null operators
func nameLength(_ name: String?) -> Int {
    let n = name ?? "anonymous" // default value
    let upper = name?.uppercased() // optional chaining
    guard let name else { return 0 } // unwrap: name is String below
    return name.count + n.count + (upper?.count ?? 0)
}

func forceUnwrap(_ s: String?) -> String { s! } // crashes if nil

// @idiom strings — Interpolation, multiline, number formatting
func greeting(user: String, total: Double) -> String {
    "Hola \(user), total: \(String(format: "%.2f", total)) €\n" + """
    Línea 1
    Línea 2
    """
}

// @idiom functions — Named, optional and default parameters
// Swift labels are part of the call: `_` removes the label for the first argument
func formatPrice(_ amount: Double, currency: String = "EUR", withSymbol: Bool = true, decimals: Int? = nil) -> String {
    String(format: "%.\(decimals ?? 2)f %@", amount, withSymbol ? "€" : currency)
}
let priceExample = formatPrice(9.5, withSymbol: false)

// @idiom lambdas — Closures and higher-order functions
func applyTwice(_ f: (Int) -> Int, _ x: Int) -> Int { f(f(x)) }
let doubled = applyTwice({ $0 * 2 }, 3)
func counter() -> () -> Int {
    var c = 0
    return {
        defer { c += 1 }
        return c
    }
}

// @idiom control-flow — if/switch as expressions, loops
func grade(_ score: Int) -> String {
    switch score {
    case 90...: return "A"
    case 70..<90: return "B"
    default: return "C"
    }
}
func sumEven(_ xs: [Int]) -> Int {
    var s = 0
    for x in xs where x % 2 == 0 { s += x }
    return s
}
