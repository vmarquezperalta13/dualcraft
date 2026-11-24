// DualCraft language idioms — Swift concurrency.
import Foundation

// @idiom future — Async function and await
func loadUser<R: Repository>(_ repo: R, id: String) async -> R.Item? {
    let user = await repo.byId(id)
    return user
}

// @idiom parallel — Run several operations at once
func loadBoth(_ a: @escaping @Sendable () async -> Int, _ b: @escaping @Sendable () async -> Int) async -> Int {
    async let x = a()
    async let y = b()
    return await x + y // dynamic number of tasks: withTaskGroup
}

// @idiom stream — Streams of values (cold and hot)
func ticker(_ n: Int) -> AsyncStream<Int> {
    AsyncStream { continuation in
        let task = Task {
            for i in 0..<n {
                try? await Task.sleep(for: .milliseconds(10))
                continuation.yield(i)
            }
            continuation.finish()
        }
        continuation.onTermination = { _ in task.cancel() }
    }
}
func sumTicks() async -> Int {
    var s = 0
    for await t in ticker(3) { s += t }
    return s
}
func evenLabels(_ s: AsyncStream<Int>) -> some AsyncSequence { s.filter { $0 % 2 == 0 }.map { "n\($0)" } }
let events = AsyncStream.makeStream(of: Int.self) // hot: events.continuation.yield(1); UI state → @Observable

// @idiom timeout — Timeouts and cancellation
func loadWithTimeout(_ f: @escaping @Sendable () async -> String) async -> String {
    await withTaskGroup(of: String?.self) { group in
        group.addTask { await f() }
        group.addTask { try? await Task.sleep(for: .seconds(5)); return nil }
        let first = await group.next() ?? nil
        group.cancelAll()
        return first ?? "timeout"
    }
}
func listenTo(_ s: AsyncStream<Int>) -> Task<Void, Never> { Task { for await _ in s {} } } // stop with task.cancel()

// @idiom background — Heavy work off the UI thread
func heavySum(_ xs: [Int]) async -> Int {
    await Task.detached(priority: .userInitiated) { xs.reduce(0, +) }.value // UI updates back on @MainActor
}
