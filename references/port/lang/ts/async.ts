// DualCraft language idioms — TypeScript async.
import type { Repository, User } from './types'

declare function setTimeout(cb: () => void, ms: number): unknown
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

// @idiom future — Async function and await
export async function loadUser(repo: Repository<User>, id: string): Promise<User | undefined> {
  const user = await repo.byId(id)
  return user
}

// @idiom parallel — Run several operations at once
export async function loadBoth(a: () => Promise<number>, b: () => Promise<number>): Promise<number> {
  const [x, y] = await Promise.all([a(), b()]) // the other keeps running if one fails (no cancellation)
  return x + y
}

// @idiom stream — Streams of values (cold and hot)
export async function* ticker(n: number): AsyncGenerator<number> {
  for (let i = 0; i < n; i++) {
    await sleep(10)
    yield i
  }
}
export async function sumTicks(): Promise<number> {
  let s = 0
  for await (const t of ticker(3)) s += t
  return s
}
export async function* evenLabels(s: AsyncIterable<number>): AsyncGenerator<string> {
  for await (const x of s) if (x % 2 === 0) yield `n${x}`
}
// Hot streams: an event emitter, RxJS Subject, or a store (zustand) in UI code

// @idiom timeout — Timeouts and cancellation
export function loadWithTimeout(f: () => Promise<string>, ms = 5000): Promise<string> {
  return Promise.race([f(), sleep(ms).then(() => 'timeout')]) // real cancellation: AbortController + fetch(signal)
}

// @idiom background — Heavy work off the UI thread
// JS is single-threaded: chunk the work, or use a Web Worker (React Native: a native module / worklet)
export async function heavySum(xs: number[]): Promise<number> {
  return xs.reduce((a, b) => a + b, 0)
}
