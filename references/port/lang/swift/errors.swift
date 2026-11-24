// DualCraft language idioms — Swift errors and JSON (Codable).
import Foundation

// @idiom exceptions — Custom errors, try/catch/finally
struct NotFoundError: Error { let id: String }
// Swift functions declare `throws` and callers must write `try`: errors are part of the signature
func safeLoad(_ load: () throws -> String) -> String {
    defer { /* cleanup (finally) */ }
    do {
        return try load()
    } catch let e as NotFoundError {
        return "missing \(e.id)"
    } catch {
        return "error \(error)"
    }
}

// @idiom result — Errors as values
enum AgeError: Error { case notANumber(String) }
func parseAge(_ s: String) -> Result<Int, AgeError> { Int(s).map { .success($0) } ?? .failure(.notANumber(s)) }
func ageOrZero(_ s: String) -> Int { (try? parseAge(s).get()) ?? 0 }

// @idiom json — Decode/encode a model
struct Product: Codable {
    let id: String
    let price: Double
    let tags: [String]? // a missing key fails decoding unless the property is optional (or a custom init(from:))
}
func decodeProduct(_ body: Data) throws -> Product { try JSONDecoder().decode(Product.self, from: body) }
func encodeProduct(_ p: Product) throws -> Data { try JSONEncoder().encode(p) }
